// Smoke tests: run after every production deploy, daily, and by hand (CLAUDE.md → Smoke tests).
// Read-only: the fixture aborts and fails any write. Each test logs in fresh. Text checks only for seeded QA names.
// Only S3 and S15 are failed logins, so Supabase's login rate limit is never close.
import { test, expect, gymUrl, rootHost, loginAs, qaLogin, submitLogin } from './fixtures'

const member = (name: string) => `[data-testid="member-row"][data-name="${name}"]`

test.describe('@smoke', () => {
  test('S1 home page @smoke', async ({ page }) => {
    const res = await page.goto('/')
    expect(res?.status()).toBe(200)
    await expect(page).toHaveTitle(/CoachBoard/)
  })

  test('S2 login page @smoke', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByTestId('login-identifier')).toBeVisible()
    await expect(page.getByTestId('login-password')).toBeVisible()
    await expect(page.getByTestId('login-submit')).toBeVisible()
  })

  test.describe('wrong password', () => {
    // Supabase answers a wrong password with 400, which Chromium logs as a console error. Expected here only.
    test.use({ allowedConsoleErrors: /status of 400|\/auth\/v1\/token/ })

    test('S3 wrong password @smoke', async ({ page }) => {
      const { id } = qaLogin('gymOwner')
      await page.goto(gymUrl('qagym', '/login'))
      await submitLogin(page, id, `wrong-${Date.now()}`)
      await expect(page.getByTestId('login-error')).toBeVisible()
      expect(new URL(page.url()).pathname).toBe('/login')
    })
  })

  test('S4 logged-out guard @smoke', async ({ page }) => {
    await page.goto('/company')
    await page.waitForURL(url => url.pathname === '/login')
  })

  test('S5 branded login @smoke', async ({ page }) => {
    await page.goto(gymUrl('qagym', '/login'))
    await expect(page.getByRole('heading', { name: 'QA Gym' }).first()).toBeVisible()
  })

  test('S6 unknown gym @smoke', async ({ page }) => {
    await page.goto(gymUrl('qa-nope-xyz', '/'))
    const root = rootHost()
    await page.waitForURL(url => url.host === root || url.host === `www.${root}`)
  })

  test('S7 owner dashboard @smoke', async ({ page }) => {
    await loginAs(page, 'gymOwner')
    await expect(page.getByTestId('page-company')).toBeVisible()
    await expect(page.locator(member('QA Active'))).toBeVisible()
    await expect(page.getByTestId('coaches-section')).toBeVisible()
  })

  test('S8 owner pages @smoke', async ({ page }) => {
    await loginAs(page, 'gymOwner')
    await page.goto(gymUrl('qagym', '/company/leads'))
    // The list opens on "Due"; the seeded lead may not have a follow-up today, so look at all open leads
    await page.getByTestId('leads-filter-open').click()
    await expect(page.getByTestId('page-leads')).toContainText('QA Lead')
    await page.goto(gymUrl('qagym', '/company/today'))
    await expect(page.getByTestId('page-today')).toBeVisible()
  })

  test('S9 partner @smoke', async ({ page }) => {
    await loginAs(page, 'gymPartner')
    await expect(page.getByTestId('page-company')).toBeVisible()
  })

  test('S10 coach home + role guard @smoke', async ({ page }) => {
    await loginAs(page, 'gymCoach')
    await expect(page.getByTestId('page-coach')).toBeVisible()
    await page.goto(gymUrl('qagym', '/company'))
    await page.waitForURL(url => url.pathname === '/coach')
    await expect(page.getByTestId('page-coach')).toBeVisible()
  })

  test('S11 coach opens PT client @smoke', async ({ page }) => {
    // A coach must never read memberships (amounts); plan + dates only via rpc('pt_membership_status')
    const membershipReads: string[] = []
    page.on('request', req => { if (req.url().includes('/rest/v1/memberships')) membershipReads.push(req.url()) })

    await loginAs(page, 'gymCoach')
    await page.getByTestId('page-coach').getByText('QA PT', { exact: true }).first().click()
    await page.waitForURL(url => url.pathname.startsWith('/company/client/'))
    const client = page.getByTestId('page-client')
    await expect(client).toBeVisible()
    await expect(client).toContainText('QA PT')
    await expect(client).not.toContainText('₹')
    await expect(client).not.toContainText(/amount paid/i)
    expect(membershipReads, 'coach read the memberships table').toEqual([])
  })

  test('S12 solo coach @smoke', async ({ page }) => {
    await loginAs(page, 'soloOwner')
    await expect(page.getByTestId('page-company')).toBeVisible()
    await expect(page.locator(member('QA Solo Client'))).toBeVisible()
    await expect(page.getByTestId('coaches-section')).toHaveCount(0)
  })

  test('S13 dojo owner @smoke', async ({ page }) => {
    await loginAs(page, 'dojoOwner')
    await expect(page.getByTestId('page-company')).toBeVisible()
    await expect(page.getByText(/\bStudents\b/).filter({ visible: true }).first()).toBeVisible()
    await expect(page.locator(member('QA Student'))).toBeVisible()
    await page.goto(gymUrl('qadojo', '/company/batches'))
    await expect(page.getByTestId('page-batches')).toContainText('QA Daily')
    await page.goto(gymUrl('qadojo', '/company/attendance/today'))
    await expect(page.getByTestId('page-attendance-today')).toBeVisible()
  })

  test('S14 sensei @smoke', async ({ page }) => {
    await loginAs(page, 'dojoSensei')
    await expect(page.getByTestId('page-coach')).toContainText('QA Daily')
  })

  test('S15 wrong gym address @smoke', async ({ page }) => {
    // The solo owner's login is real, but not for qagym's address: refused and signed out
    const { id, password } = qaLogin('soloOwner')
    await page.goto(gymUrl('qagym', '/login'))
    await submitLogin(page, id, password)
    await expect(page.getByTestId('login-error')).toBeVisible()
    expect(new URL(page.url()).pathname).not.toBe('/company')
  })

  test('S16 super admin (local only) @smoke', async ({ page }) => {
    const id = process.env.SUPERADMIN_ID
    const password = process.env.SUPERADMIN_PASSWORD
    test.skip(!id || !password, 'SUPERADMIN_ID / SUPERADMIN_PASSWORD not set (local only, never in CI)')
    await page.goto('/login')
    await submitLogin(page, id!, password!)
    await page.waitForURL(url => url.pathname === '/admin', { timeout: 30_000 })
    await expect(page.getByTestId('page-admin')).toBeVisible()
    await page.getByRole('button', { name: /^Companies/ }).click()
    // The three QA companies (QA Gym, the solo coach, the dojo): each marked as a test account
    const qaRows = page.locator('[id^="company-"]').filter({ hasText: /\bQA\b/ })
    await expect(qaRows.first()).toBeVisible()
    expect(await qaRows.count()).toBeGreaterThanOrEqual(3)
    for (const row of await qaRows.all()) await expect(row).toContainText('TEST')
  })
})
