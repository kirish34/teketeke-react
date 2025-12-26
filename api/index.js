import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

let handler
try {
  const app = require('../server/server')
  // Export the Express app directly; Vercel Node runtime will invoke it as a request handler.
  handler = app
} catch (e) {
  console.error('[boot] server failed to start:', e && e.message ? e.message : e)
  handler = (_req, res) => {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    const msg = e && e.message ? e.message : String(e)
    res.end(JSON.stringify({ error: 'boot_failed', message: msg }))
  }
}

export default handler
