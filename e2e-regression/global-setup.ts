// Before any test: check the target again, then log each QA role in once and keep the session.
// After the first login, every Supabase request the app made must have gone to the dev project; otherwise stop.
import fs from 'node:fs'
import { chromium, devices } from '@playwright/test'
import { qaLogin, submitLogin } from '../e2e/fixtures'
import { checkTarget, isForeignSupabase, DEV_REF } from './target'
import { AUTH_DIR, ROLES, ROLE_HOME, captureToken, loginPath, saveToken, statePath } from './session'

export default async function globalSetup() {
  const { baseUrl } = checkTarget()
  fs.mkdirSync(AUTH_DIR, { recursive: true })
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {})
  try {
    for (const role of ROLES) {
      const context = await browser.newContext({ ...devices['Pixel 7'], baseURL: baseUrl, timezoneId: 'Asia/Kolkata' })
      const bypass = process.env.E2E_VERCEL_BYPASS
      const appHost = new URL(baseUrl).host
      if (bypass) await context.route(u => u.host === appHost, r => r.fallback({ headers: { ...r.request().headers(), 'x-vercel-protection-bypass': bypass } }))
      const foreign: string[] = []
      let devCalls = 0
      await context.route(u => isForeignSupabase(u.href), r => { foreign.push(r.request().url()); return r.abort('blockedbyclient') })
      const page = await context.newPage()
      page.on('request', req => { if (req.url().includes(`${DEV_REF}.supabase.co`)) devCalls++ })
      const getToken = captureToken(page)
      const { id, password } = qaLogin(role)
      await page.goto(loginPath(role))
      await submitLogin(page, id, password)
      try {
        await page.waitForURL(u => u.pathname === ROLE_HOME[role], { timeout: 45_000 })
      } catch {
        const err = await page.getByTestId('login-error').textContent().catch(() => null)
        throw new Error(`${role} could not log in on ${baseUrl}${err ? `: ${err}` : ''}` +
          (foreign.length ? `\nThe app called another Supabase project: ${foreign[0]}` : ''))
      }
      await page.waitForLoadState('networkidle').catch(() => {})
      if (foreign.length) throw new Error(`STOP: ${baseUrl} talks to a Supabase project that is not dev:\n  ${foreign.join('\n  ')}`)
      if (!devCalls) throw new Error(`STOP: no request to the dev project (${DEV_REF}) seen after logging in on ${baseUrl}`)
      const t = getToken()
      if (!t) throw new Error(`Logged in as ${role} but did not see the app's Supabase token`)
      saveToken(role, t)
      await context.storageState({ path: statePath(role) })
      await context.close()
    }
  } finally {
    await browser.close()
  }
}
