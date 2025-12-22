import "jsr:@supabase/functions-js/edge-runtime.d.ts"

function json(resBody: unknown, status = 200) {
  return new Response(JSON.stringify(resBody), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

export default async (req: Request) => {
  const CALLBACK_SECRET = Deno.env.get("CALLBACK_SECRET")
  if (CALLBACK_SECRET) {
    const got = req.headers.get("x-callback-secret")
    if (got !== CALLBACK_SECRET) return json({ ok: false, error: "unauthorized" }, 401)
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

  const body = await req.json().catch(() => ({}))
  const result = (body as any).Result ?? (body as any).result ?? body

  const code = Number(result?.ResultCode ?? -1)
  const desc = String(result?.ResultDesc ?? "Unknown")
  const originator = result?.OriginatorConversationID
  const conversationId = result?.ConversationID ?? null
  const transactionId = result?.TransactionID ?? null

  if (!originator) return json({ ok: true })

  const providerRef = transactionId || conversationId || originator
  const status = code === 0 ? "paid" : "failed"
  const reason = code === 0 ? null : `${desc} (code=${code})`

  await fetch(`${SUPABASE_URL}/rest/v1/rpc/finalize_payout`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      p_payout_id: originator,
      p_status: status,
      p_provider_reference: providerRef,
      p_failure_reason: reason,
    }),
  })

  return json({ ok: true })
}
