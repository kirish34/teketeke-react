// supabase/functions/b2c-worker/index.ts
// Cron-triggered worker:
// 1) claims next approved payout (claim_next_payout)
// 2) sends Daraja B2C
// 3) marks processing; relies on callbacks to finalize
// 4) schedules retry with backoff on failure
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

function json(resBody: unknown, status = 200) {
  return new Response(JSON.stringify(resBody), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function normalizePhoneKE(input: string) {
  let p = (input || "").trim().replace(/\s+/g, "")
  if (p.startsWith("+")) p = p.slice(1)
  if (p.startsWith("07") && p.length === 10) return "254" + p.slice(1)
  if (p.startsWith("01") && p.length === 10) return "254" + p.slice(1)
  if (p.startsWith("254") && p.length >= 12) return p
  return p
}

function nowPlusSeconds(sec: number) {
  const d = new Date()
  d.setSeconds(d.getSeconds() + sec)
  return d.toISOString()
}

function computeBackoffSeconds(attempt: number) {
  const base = [15, 30, 120, 600, 1800, 7200, 21600]
  const idx = Math.min(Math.max(attempt - 1, 0), base.length - 1)
  const val = base[idx]
  const jitter = Math.floor(val * (Math.random() * 0.2))
  return val + jitter
}

async function getDarajaToken(baseUrl: string, key: string, secret: string) {
  const basic = btoa(`${key}:${secret}`)
  const url = `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`
  const r = await fetch(url, { headers: { Authorization: `Basic ${basic}` } })
  const t = await r.text()
  if (!r.ok) throw new Error(`Token error ${r.status}: ${t}`)
  const j = JSON.parse(t)
  return j.access_token as string
}

export default async (req: Request) => {
  const CALLBACK_SECRET = Deno.env.get("WORKER_SECRET")
  if (CALLBACK_SECRET) {
    const got = req.headers.get("x-worker-secret")
    if (got !== CALLBACK_SECRET) return json({ ok: false, error: "unauthorized" }, 401)
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

  const DARAJA_ENV = Deno.env.get("DARAJA_ENV") ?? "sandbox"
  const DARAJA_CONSUMER_KEY = Deno.env.get("DARAJA_CONSUMER_KEY")!
  const DARAJA_CONSUMER_SECRET = Deno.env.get("DARAJA_CONSUMER_SECRET")!

  const B2C_SHORTCODE = Deno.env.get("B2C_SHORTCODE")!
  const B2C_INITIATOR_NAME = Deno.env.get("B2C_INITIATOR_NAME")!
  const B2C_SECURITY_CREDENTIAL = Deno.env.get("B2C_SECURITY_CREDENTIAL")!
  const B2C_COMMAND_ID = Deno.env.get("B2C_COMMAND_ID") ?? "BusinessPayment"
  const B2C_REMARKS = Deno.env.get("B2C_REMARKS") ?? "TekeTeke payout"
  const B2C_OCCASION = Deno.env.get("B2C_OCCASION") ?? "TekeTeke"

  const B2C_RESULT_URL = Deno.env.get("B2C_RESULT_URL")!
  const B2C_TIMEOUT_URL = Deno.env.get("B2C_TIMEOUT_URL")!

  const baseUrl =
    DARAJA_ENV === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke"

  // Claim next approved payout
  const claimResp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/claim_next_payout`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ p_domain: "teketeke", p_max_attempts: 8 }),
  })

  const claimText = await claimResp.text()
  if (!claimResp.ok) return json({ ok: false, error: `claim_next_payout failed: ${claimText}` }, 500)

  const job = claimText ? JSON.parse(claimText) : null
  if (!job) {
    await fetch(`${SUPABASE_URL}/rest/v1/worker_heartbeat?id=eq.1`, {
      method: "PATCH",
      headers: {
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ last_tick_at: new Date().toISOString(), note: "cron tick (idle)" }),
    })
    return json({ ok: true, message: "no approved payouts" }, 200)
  }

  const payoutId = job.id as string
  const amount = Number(job.amount)
  const attempts = Number(job.attempts ?? 1)
  const phone = normalizePhoneKE(job.destination_phone as string)

  try {
    const token = await getDarajaToken(baseUrl, DARAJA_CONSUMER_KEY, DARAJA_CONSUMER_SECRET)

    const b2cUrl = `${baseUrl}/mpesa/b2c/v3/paymentrequest`
    const payload = {
      OriginatorConversationID: payoutId,
      InitiatorName: B2C_INITIATOR_NAME,
      SecurityCredential: B2C_SECURITY_CREDENTIAL,
      CommandID: B2C_COMMAND_ID,
      Amount: amount,
      PartyA: B2C_SHORTCODE,
      PartyB: phone,
      Remarks: job.reason_code ? `${B2C_REMARKS} (${job.reason_code})` : B2C_REMARKS,
      QueueTimeOutURL: B2C_TIMEOUT_URL,
      ResultURL: B2C_RESULT_URL,
      Occasion: B2C_OCCASION,
    }

    const r = await fetch(b2cUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    const t = await r.text()
    if (!r.ok) throw new Error(`B2C HTTP ${r.status}: ${t}`)
    const j = JSON.parse(t)

    const providerRef = j.ConversationID ?? j.OriginatorConversationID ?? null

    // mark processing
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_payout_processing`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_payout_id: payoutId, p_provider_reference: providerRef }),
    })

    await fetch(`${SUPABASE_URL}/rest/v1/worker_heartbeat?id=eq.1`, {
      method: "PATCH",
      headers: {
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ last_tick_at: new Date().toISOString(), note: "cron tick" }),
    })

    return json({ ok: true, payoutId, sent: true, providerRef })
  } catch (e) {
    const backoff = computeBackoffSeconds(attempts)
    const next = nowPlusSeconds(backoff)

    await fetch(`${SUPABASE_URL}/rest/v1/rpc/schedule_payout_retry`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        p_payout_id: payoutId,
        p_next_retry_at: next,
        p_error: String(e?.message ?? e).slice(0, 500),
      }),
    })

    return json({ ok: false, payoutId, error: String(e?.message ?? e), next_retry_at: next }, 500)
  }
}
