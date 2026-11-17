// Login guards: archived clients are locked out (and back in on Restore), turned-off coaches stay locked out, and
// create-user / create-login check logins on the server (lib/login-rules.ts). QA Gym / QA Dojo only; every member
// made here is "E2E …" and archived at the end (the coach is turned off: coaches are never deleted).
import type { Browser, Page } from '@playwright/test'
import { devices } from '@playwright/test'
import { test, expect, rest, e2eName, myCompanyId, callApi, createMember, archiveMember } from './fixtures'
import { checkTarget, isForeignSupabase } from './target'
import { usernameEmail } from '../lib/phone'
import { token } from './session'
import { submitLogin } from '../e2e/fixtures'
import { fakeIndianMobile } from './helpers'

const CLIENT_OFF = 'Your account is inactive. Please contact your gym.'
const COACH_OFF = 'Your coach login is turned off. Ask the gym owner.'
const PASSWORD = 'e2e-pass-123'
const uname = (tag: string) => `e2e${tag}${Date.now().toString(36)}`.slice(0, 20)

// A fresh phone-sized browser with nobody logged in (a new login, like a phone that never used the app)
async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ ...devices['Pixel 7'], baseURL: checkTarget().baseUrl, timezoneId: 'Asia/Kolkata' })
  return context.newPage()
}
const loginAt = async (page: Page, slug: string, id: string, password: string) => {
  await page.goto(`/login?company=${slug}`)
  await submitLogin(page, id, password)
}
// The client API route (ai-insights) with no sessions: 200 { insight: null } without any AI call, 403 when refused
const clientApi = async (page: Page) => (await page.request.post('/api/ai-insights', { data: { sessions: [] } })).status()
const setArchived = (id: string, archived: boolean) =>
  rest('gymOwner').patch(`profiles?id=eq.${id}&full_name=like.E2E*`, { archived_at: archived ? new Date().toISOString() : null })

test.describe.serial('Login guards', () => {
  // The 400s / 403s the tests ask for are logged by the browser as failed requests
  test.use({ allowedConsoleErrors: /\/api\/(create-user|create-login|ai-insights)\b|status of 40[03]/ })

  let clientId = ''
  const username = uname('a')

  test('R25 archived client: login blocked, open session signed out; Restore lets them back in', async ({ as, browser }) => {
    const owner = await as('gymOwner')
    await owner.goto('/company')
    const companyId = await myCompanyId('gymOwner')
    clientId = await createMember(owner, companyId, e2eName('archived client'), { no_login: false, username, password: PASSWORD })

    // Logged in and working
    const client = await freshPage(browser)
    await loginAt(client, 'qagym', username, PASSWORD)
    await client.waitForURL(u => u.pathname === '/client')
    expect(await clientApi(client)).toBe(200)

    // Archived while the session is open: the API refuses, the next page load signs them out
    await setArchived(clientId, true)
    expect(await clientApi(client)).toBe(403)
    await client.goto('/client')
    await client.waitForURL(u => u.pathname === '/login' && u.search.includes('off=client'))
    await expect(client.getByTestId('login-error')).toHaveText(CLIENT_OFF)
    // Signed out: the Supabase session cookie is gone
    await expect.poll(async () => (await client.context().cookies()).some(c => c.name.includes('-auth-token'))).toBe(false)

    // A new login is refused with the same message
    await loginAt(client, 'qagym', username, PASSWORD)
    await expect(client.getByTestId('login-error')).toHaveText(CLIENT_OFF)
    expect(new URL(client.url()).pathname).toBe('/login')

    // Restore: in again straight away
    await setArchived(clientId, false)
    await loginAt(client, 'qagym', username, PASSWORD)
    await client.waitForURL(u => u.pathname === '/client')
    expect(await clientApi(client)).toBe(200)
    await client.context().close()
    await archiveMember('gymOwner', clientId)
  })

  test('R26 turned-off coach: still blocked (open session and new login)', async ({ as, browser }) => {
    const owner = await as('gymOwner')
    await owner.goto('/company')
    const companyId = await myCompanyId('gymOwner')
    const phone = fakeIndianMobile()
    const made = await callApi(owner, '/api/create-user', {
      email: `${phone}@getcoachboard.in`, password: phone, full_name: e2eName('coach'), company_id: companyId, role: 'coach', phone,
    })
    expect(made.status, JSON.stringify(made.json)).toBe(200)
    const coachId = made.json.userId as string

    const coach = await freshPage(browser)
    await loginAt(coach, 'qagym', phone, phone)
    await coach.waitForURL(u => u.pathname === '/coach')

    const off = await callApi(owner, '/api/set-coach-active', { coachId, active: false })
    expect(off.status, JSON.stringify(off.json)).toBe(200)
    await coach.goto('/coach')
    await coach.waitForURL(u => u.pathname === '/login' && u.search.includes('off=coach'))
    await expect(coach.getByTestId('login-error')).toHaveText(COACH_OFF)
    await loginAt(coach, 'qagym', phone, phone)
    await expect(coach.getByTestId('login-error')).toHaveText(COACH_OFF)
    await coach.context().close()
  })

  test('R27 create-user / create-login refuse bad logins (400)', async ({ as }) => {
    const owner = await as('gymOwner')
    await owner.goto('/company')
    const companyId = await myCompanyId('gymOwner')
    const base = { full_name: e2eName('bad login'), company_id: companyId, role: 'client', phone: null }
    const expect400 = async (label: string, body: object, route = '/api/create-user') => {
      const r = await callApi(owner, route, body)
      expect(r.status, `${label}: ${JSON.stringify(r.json)}`).toBe(400)
      expect(typeof r.json.error, label).toBe('string')
      expect(String(r.json.error), label).not.toMatch(/supabase|AuthApiError|duplicate key|violates/i)
    }
    // 4. Our own domains (country US so the email path is open: the domain rule is what refuses them)
    for (const email of ['x@user.getcoachboard.in', '9876543210@getcoachboard.in', 'x@nologin.getcoachboard.in'])
      await expect400(email, { ...base, country: 'US', email, password: PASSWORD })
    // 5. Email login for an Indian client (the gym's country, and said outright)
    await expect400('email, India (gym)', { ...base, email: `e2e-${Date.now()}@example.com`, password: PASSWORD })
    await expect400('email, India (sent)', { ...base, country: 'IN', email: `e2e-${Date.now()}@example.com`, password: PASSWORD })
    await expect400('bad email format', { ...base, country: 'US', email: 'not-an-email', password: PASSWORD })
    // 6. Usernames the form would refuse
    for (const u of ['admin', 'ab', '9876543210', 'bad name']) await expect400(`username ${u}`, { ...base, username: u, password: PASSWORD })
    // 7. Short passwords, every path
    await expect400('username, 5-char password', { ...base, username: uname('p'), password: '12345' })
    await expect400('email, 5-char password', { ...base, country: 'US', email: `e2e-${Date.now()}@example.com`, password: '12345' })
    const phone = fakeIndianMobile()
    await expect400('coach, 5-char password', { ...base, role: 'coach', email: `${phone}@getcoachboard.in`, password: '12345', phone })
    // create-login: same username and password rules
    const noLoginId = await createMember(owner, companyId, e2eName('create-login'))
    await expect400('create-login, 5-char password', { userId: noLoginId, username: uname('c'), password: '12345' }, '/api/create-login')
    await expect400('create-login, reserved username', { userId: noLoginId, username: 'admin', password: PASSWORD }, '/api/create-login')
    await expect400('create-login, our domain', { userId: noLoginId, username: 'x@user.getcoachboard.in', password: PASSWORD }, '/api/create-login')
    // Nothing was made for any of those (only the no-login member above)
    const { rows } = await rest('gymOwner').get(`profiles?select=id&full_name=eq.${encodeURIComponent(base.full_name)}`)
    expect(rows).toEqual([])
    await archiveMember('gymOwner', noLoginId)
  })

  test('R28 normal adds still work: username, email outside India, no login, dojo child, create-login', async ({ as }) => {
    const owner = await as('gymOwner')
    await owner.goto('/company')
    const companyId = await myCompanyId('gymOwner')
    const made: string[] = []
    const ok = async (label: string, page: Page, body: object) => {
      const r = await callApi(page, '/api/create-user', body)
      expect(r.status, `${label}: ${JSON.stringify(r.json)}`).toBe(200)
      return r.json.userId as string
    }
    const u = uname('u')
    made.push(await ok('username', owner, { full_name: e2eName('username'), company_id: companyId, role: 'client', phone: null, username: u.toUpperCase() + ' ', password: PASSWORD }))
    made.push(await ok('email outside India', owner, { full_name: e2eName('email'), company_id: companyId, role: 'client', phone: null, country: 'US', email: `  E2E-${Date.now()}@Example.com `, password: PASSWORD }))
    const noLogin = await createMember(owner, companyId, e2eName('no login'))
    made.push(noLogin)
    const login = await callApi(owner, '/api/create-login', { userId: noLogin, username: uname('l'), password: PASSWORD })
    expect(login.status, JSON.stringify(login.json)).toBe(200)

    const { rows } = await rest('gymOwner').get<{ id: string; email: string }>(`profiles?select=id,email&id=in.(${made.join(',')})`)
    const emailOf = (id: string) => rows.find(r => r.id === id)?.email
    expect(emailOf(made[0])).toBe(`${u}@user.getcoachboard.in`)
    expect(emailOf(made[1])).toMatch(/^e2e-\d+@example\.com$/) // trimmed + lowercased
    for (const id of made) await archiveMember('gymOwner', id)

    // Dojo child: no phone of their own, parent's phone only (generated login)
    const dojo = await as('dojoOwner')
    await dojo.goto('/company')
    const dojoId = await myCompanyId('dojoOwner')
    const child = await ok('dojo child', dojo, {
      no_login: true, full_name: e2eName('dojo child'), company_id: dojoId, role: 'client', phone: null,
      guardian_name: 'E2E Parent', guardian_phone: '+91' + fakeIndianMobile(), guardian_relation: 'Mother',
    })
    const { rows: c } = await rest('dojoOwner').get<{ email: string }>(`profiles?select=email&id=eq.${child}`)
    expect(c[0]?.email).toMatch(/^student-[a-z0-9]{8}@getcoachboard\.in$/)
    await archiveMember('dojoOwner', child)
  })

  // Database-level block (db/2026-11-17-archived-logins-rls.md): with a token taken straight from Supabase Auth
  // (not through the app), an archived member gets nothing but their own profile row; Restore gives it all back.
  test('R29 archived member: the database refuses their token (RLS), Restore gives access back', async ({ as }) => {
    const owner = await as('gymOwner')
    await owner.goto('/company')
    const companyId = await myCompanyId('gymOwner')
    const user = uname('r')
    const name = e2eName('rls archived')
    const id = await createMember(owner, companyId, name, { no_login: false, username: user, password: PASSWORD })

    // Sign in through Supabase Auth directly (the publishable key the app itself sends), dev project only
    const { supabaseUrl } = checkTarget()
    const apikey = token('gymOwner').apikey
    const login = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey, 'content-type': 'application/json' },
      body: JSON.stringify({ email: usernameEmail(user), password: PASSWORD }),
    })
    expect(login.status, 'Supabase Auth still accepts the password (the block is in the data, not the login)').toBe(200)
    const accessToken = (await login.json()).access_token as string
    const call = async (method: string, path: string, body?: object) => {
      const url = `${supabaseUrl}/rest/v1/${path}`
      if (isForeignSupabase(url)) throw new Error('Refused: not the dev project')
      const res = await fetch(url, {
        method, body: body ? JSON.stringify(body) : undefined,
        headers: { apikey, authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', prefer: 'return=representation' },
      })
      const text = await res.text()
      let rows: unknown = []
      try { rows = text ? JSON.parse(text) : [] } catch { rows = [] }
      return { status: res.status, rows: Array.isArray(rows) ? rows : [] }
    }
    const count = async (path: string) => (await call('GET', path)).rows.length

    // Active: their gym and the starter exercise list are readable
    expect(await count(`companies?select=id&id=eq.${companyId}`), 'active: own gym').toBe(1)
    expect(await count('exercises?select=id&limit=1'), 'active: exercise list').toBe(1)

    await setArchived(id, true)
    expect(await count(`profiles?select=id&id=eq.${id}`), 'archived: own profile row (login message)').toBe(1)
    expect(await count('profiles?select=id&limit=5'), 'archived: nobody else').toBe(1)
    expect(await count(`companies?select=id&id=eq.${companyId}`), 'archived: gym').toBe(0)
    expect(await count('exercises?select=id&limit=1'), 'archived: exercise list').toBe(0)
    for (const table of ['memberships', 'weekly_plans', 'logged_sessions', 'session_feedback', 'attendance', 'exercise_logs'])
      expect(await count(`${table}?select=id&limit=1`), `archived: ${table}`).toBe(0)
    const logSession = await call('POST', 'logged_sessions', { client_id: id, session_date: new Date().toISOString().slice(0, 10), duration_minutes: 30 })
    expect(logSession.status, 'archived: logging a session is refused').toBeGreaterThanOrEqual(400)
    const rename = await call('PATCH', `profiles?id=eq.${id}`, { full_name: name })
    expect(rename.rows, 'archived: own profile can\'t be changed').toEqual([])
    const staff = await call('POST', 'rpc/gym_staff', {})
    expect(staff.rows, 'archived: no staff names').toEqual([])

    // Restore: the same token works again straight away
    await setArchived(id, false)
    expect(await count(`companies?select=id&id=eq.${companyId}`), 'restored: own gym').toBe(1)
    expect(await count('exercises?select=id&limit=1'), 'restored: exercise list').toBe(1)
    await archiveMember('gymOwner', id)
  })
})
