import { authFetch } from '../lib/auth'

export function saccoFetch(url: string, saccoId: string | null | undefined, init?: RequestInit) {
  const headers = new Headers(init?.headers || {})
  if (saccoId) {
    headers.set('x-sacco-id', saccoId)
  }
  return authFetch(url, { ...(init || {}), headers })
}
