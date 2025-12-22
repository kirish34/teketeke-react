import "jsr:@supabase/functions-js/edge-runtime.d.ts"

function json(resBody: unknown, status = 200) {
  return new Response(JSON.stringify(resBody), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function nowPlusSeconds(sec: number) {
  const d = new Date()
  d.setSeconds(d.getSeconds() + sec)
  return d.toISOString()
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
  const originator = result?.OriginatorConversationID

  if (originator) {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/schedule_payout_retry`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        p_payout_id: originator,
        p_next_retry_at: nowPlusSeconds(60),
        p_error: "Daraja timeout",
      }),
    })
  }

  return json({ ok: true })
}
