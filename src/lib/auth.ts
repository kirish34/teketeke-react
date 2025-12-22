import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from './env'

type StorageKey = 'auth_token' | 'tt_root_token' | 'tt_admin_token'
const STORAGE_KEYS: StorageKey[] = ['auth_token', 'tt_root_token', 'tt_admin_token']

let supabase: SupabaseClient | null = null

const hasWindow = typeof window !== 'undefined'

function safeRun(action: () => void, label?: string) {
  try {
    action()
  } catch (error) {
    if (label) console.warn(label, error)
  }
}

function getStores() {
  const stores: Storage[] = []
  if (!hasWindow) return stores
  safeRun(() => {
    if (window.localStorage) stores.push(window.localStorage)
  })
  safeRun(() => {
    if (window.sessionStorage) stores.push(window.sessionStorage)
  })
  return stores
}

export function persistToken(token: string | null) {
  if (!token || !hasWindow) return
  getStores().forEach((store) => {
    safeRun(() => store.setItem('auth_token', token))
  })
}

export function getStoredToken() {
  if (!hasWindow) return ''
  for (const store of getStores()) {
    let value = ''
    safeRun(() => {
      value = store.getItem('auth_token') || ''
    })
    if (value) return value
  }
  return ''
}

export function clearAuthStorage() {
  if (!hasWindow) return
  getStores().forEach((store) => {
    STORAGE_KEYS.forEach((key) => {
      safeRun(() => store.removeItem(key))
    })
    safeRun(() => {
      for (let i = store.length - 1; i >= 0; i -= 1) {
        const key = store.key(i)
        if (!key) continue
        if (key.startsWith('sb-') || key.toLowerCase().includes('supabase')) {
          store.removeItem(key)
        }
      }
    })
  })
}

export function ensureSupabaseClient() {
  if (supabase) return supabase
  if (!env.supabaseUrl || !env.supabaseAnonKey) return null
  supabase = createClient(env.supabaseUrl, env.supabaseAnonKey)
  return supabase
}

export async function getAccessToken() {
  const client = ensureSupabaseClient()
  const fallback = getStoredToken()
  if (!client) return fallback || null
  try {
    const { data } = await client.auth.getSession()
    return data.session?.access_token || fallback || null
  } catch (err) {
    console.warn('[auth] session lookup failed', err)
    return fallback || null
  }
}

export async function signOutEverywhere() {
  try {
    await ensureSupabaseClient()?.auth.signOut()
  } catch (err) {
    console.warn('[auth] supabase sign-out failed', err)
  }
  clearAuthStorage()
}

export async function authFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = typeof input === 'string' ? input : (input instanceof URL ? input.pathname : '')
  const isRelative = typeof url === 'string' && url.startsWith('/')
  const isPublicAsset = /^\/public\//.test(url)

  if (!isRelative || isPublicAsset || typeof fetch === 'undefined') {
    return fetch(input, init)
  }

  const headers = new Headers(init?.headers || {})
  try {
    const token = await getAccessToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  } catch (error) {
    console.warn('[auth] unable to attach token', error)
  }

  let target: RequestInfo | URL = input
  if (isRelative) {
    const base = env.apiBase || '/'
    const baseUrl = base.endsWith('/') ? base : `${base}/`
    target = new URL(url.replace(/^\//, ''), baseUrl).toString()
  }

  return fetch(target, { ...(init || {}), headers })
}
