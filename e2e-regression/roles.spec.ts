// Role limits: a coach sees no amounts, leads or settings; a partner can do what the owner can.
import { test, expect, rest, seeded, callApi, myCompanyId, e2eName, archiveMember } from './fixtures'
import { addMemberViaUI, openMember, memberAction, memberRow } from './helpers'

test.describe('Role limits', () => {
  // R7's own attempt: /api/update-client answers 403 to a coach, which the browser logs as a failed request
  test.use({ allowedConsoleErrors: /\/api\/update-client\b/ })
  test('R5 coach sees no amounts (memberships table, QA PT page)', async ({ as }) => {
    const r = rest('gymCoach')
    const pt = await seeded('gymOwner', 'profiles', 'QA PT')
    expect((await r.get('memberships?select=id,amount_paid&limit=5')).rows, 'coach read memberships').toEqual([])
    // Plan + dates only, through the RPC
    const rpc = await r.post('rpc/pt_membership_status', {})
    expect(rpc.status).toBeLessThan(400)
    expect(JSON.stringify(rpc.rows)).not.toMatch(/amount/i)

    const page = await as('gymCoach')
    const membershipReads: string[] = []
    page.on('request', req => { if (req.url().includes('/rest/v1/memberships')) membershipReads.push(req.url()) })
    await page.goto(`/company/client/${pt.id}`)
    const client = page.getByTestId('page-client')
    await expect(client).toContainText('QA PT')
    await expect(client).not.toContainText('₹')
    await expect(client).not.toContainText(/amount paid/i)
    expect(membershipReads).toEqual([])
  })

  test('R6 coach cannot open or read leads', async ({ as }) => {
    expect((await rest('gymCoach').get('leads?select=id&limit=5')).rows).toEqual([])
    const page = await as('gymCoach')
    await page.goto('/company/leads')
    await page.waitForURL(u => u.pathname === '/coach')
    await expect(page.getByTestId('page-coach')).toBeVisible()
  })

  test('R7 coach cannot open the dashboard / settings or change members', async ({ as }) => {
    const r = rest('gymCoach')
    const companyId = await myCompanyId('gymCoach')
    const { rows } = await r.get<{ name: string }>(`companies?select=name&id=eq.${companyId}`)
    // Writing the gym's own name back: refused (0 rows) for a coach
    expect((await r.patch(`companies?id=eq.${companyId}`, { name: rows[0]?.name ?? 'QA Gym' })).rows).toEqual([])
    const page = await as('gymCoach')
    await page.goto('/company')
    await page.waitForURL(u => u.pathname === '/coach')
    const active = await seeded('gymOwner', 'profiles', 'QA Active')
    const api = await callApi(page, '/api/update-client', { user_id: active.id, full_name: 'QA Active' })
    expect(api.status).toBe(403)
  })

  test('R8 partner sees amounts and leads, adds and archives a member', async ({ as }) => {
    const page = await as('gymPartner')
    await page.goto('/company')
    await expect(page.getByTestId('page-company')).toContainText('₹')
    expect((await rest('gymPartner').get('memberships?select=id&limit=1')).rows.length).toBe(1)

    await page.goto('/company/leads')
    await page.getByTestId('leads-filter-open').click()
    await expect(page.getByTestId('page-leads')).toContainText('QA Lead')

    const name = e2eName('partner member')
    await addMemberViaUI(page, name)
    await openMember(page, name)
    await memberAction(page, 'Archive')
    await page.waitForURL(u => u.pathname === '/company')
    await expect(memberRow(page, name)).toHaveCount(0)
    const { rows } = await rest('gymPartner').get<{ id: string; archived_at: string | null }>(
      `profiles?select=id,archived_at&full_name=eq.${encodeURIComponent(name)}`)
    expect(rows[0]?.archived_at).toBeTruthy()
    if (rows[0]) await archiveMember('gymOwner', rows[0].id)
  })
})
