// Logins for the regression suite: global setup logs each QA role in ONCE (Supabase has a login rate limit),
// saves the browser state, and the token the app itself used, under e2e-regression/.auth/ (ignored by git).
import fs from 'node:fs'
import path from 'node:path'
import type { BrowserContext, Page } from '@playwright/test'
import { ROLE_GYM, ROLE_HOME, type Role } from '../e2e/fixtures'
import { DEV_REF } from './target'

export type { Role }
export const ROLES: Role[] = ['gymOwner', 'gymPartner', 'gymCoach', 'soloOwner', 'dojoOwner', 'dojoSensei']
export const AUTH_DIR = path.join(__dirname, '.auth')
export const statePath = (role: Role) => path.join(AUTH_DIR, `${role}.json`)
const tokenPath = (role: Role) => path.join(AUTH_DIR, `${role}.token.json`)

export { ROLE_GYM, ROLE_HOME }

// The gym's login on any address: /login?company=<slug> works on the dev link (no gym subdomains on vercel.app)
// and on localhost alike
export const loginPath = (role: Role) => `/login?company=${ROLE_GYM[role]}`

export type Token = { apikey: string; authorization: string; userId: string }

export function saveToken(role: Role, t: Token) {
  fs.mkdirSync(AUTH_DIR, { recursive: true })
  fs.writeFileSync(tokenPath(role), JSON.stringify(t))
}

export function token(role: Role): Token {
  const p = tokenPath(role)
  if (!fs.existsSync(p)) throw new Error(`No saved login for ${role}: global setup did not log it in`)
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

// The apikey + Authorization the app sends to dev Supabase (watch the page while it logs in)
export function captureToken(page: Page): () => Token | null {
  let found: Token | null = null
  page.on('request', req => {
    const url = req.url()
    if (!url.includes(`${DEV_REF}.supabase.co/rest/v1/`)) return
    const h = req.headers()
    if (!h.apikey || !h.authorization?.startsWith('Bearer ')) return
    // The publishable key is also sent as a Bearer when logged out; only keep a user's token (a JWT with a sub)
    try {
      const payload = JSON.parse(Buffer.from(h.authorization.slice(7).split('.')[1], 'base64url').toString())
      if (payload.sub) found = { apikey: h.apikey, authorization: h.authorization, userId: payload.sub }
    } catch { /* not a JWT */ }
  })
  return () => found
}

export async function newRoleContext(browser: { newContext: (o?: object) => Promise<BrowserContext> }, role: Role, options: object = {}) {
  return browser.newContext({ ...options, storageState: statePath(role) })
}
