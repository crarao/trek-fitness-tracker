// Cross-company isolation: QA Gym and QA Solo can't see or change each other's members.
// "Change" attempts write the record's own current name back, so even a broken rule would change nothing.
import { test, expect, rest, seeded, callApi } from './fixtures'
import type { Role } from './session'

async function cannotReachMember(as: (r: Role) => Promise<import('@playwright/test').Page>, role: Role, home: string,
  target: { id: string }, name: string) {
  const r = rest(role)
  expect((await r.get(`profiles?select=id,full_name&id=eq.${target.id}`)).rows, `${role} read ${name}`).toEqual([])
  expect((await r.get(`profiles?select=id&full_name=eq.${encodeURIComponent(name)}`)).rows, `${role} found ${name} by name`).toEqual([])
  expect((await r.get(`memberships?select=id&profile_id=eq.${target.id}`)).rows, `${role} read ${name}'s memberships`).toEqual([])
  expect((await r.get(`logged_sessions?select=id&client_id=eq.${target.id}`)).rows, `${role} read ${name}'s sessions`).toEqual([])
  const upd = await r.patch(`profiles?id=eq.${target.id}`, { full_name: name })
  expect(upd.rows, `${role} updated ${name}`).toEqual([])

  const page = await as(role)
  await page.goto(home)
  await page.waitForURL(u => u.pathname === home)
  const api = await callApi(page, '/api/update-client', { user_id: target.id, full_name: name })
  expect(api.status, `${role} changed ${name} through /api/update-client`).toBeGreaterThanOrEqual(400)

  await page.goto(`/company/client/${target.id}`)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('body')).not.toContainText(name)
}

test.describe('Cross-company isolation', () => {
  // Expected refusals show up as failed requests in the console: /api/update-client (403, the test's own attempt)
  // and /api/ai-plan-usage (403, the other gym's client page asking for its AI count)
  test.use({ allowedConsoleErrors: /\/api\/(update-client|ai-plan-usage)\b|status of 40[46]|PGRST116|Cannot coerce/ })

  test('R1 QA Gym owner cannot see or change QA Solo Client', async ({ as }) => {
    const solo = await seeded('soloOwner', 'profiles', 'QA Solo Client')
    await cannotReachMember(as, 'gymOwner', '/company', solo, 'QA Solo Client')
  })

  test('R2 QA Gym coach cannot see or change QA Solo Client', async ({ as }) => {
    const solo = await seeded('soloOwner', 'profiles', 'QA Solo Client')
    await cannotReachMember(as, 'gymCoach', '/coach', solo, 'QA Solo Client')
  })

  test('R3 QA Solo owner cannot see or change QA Gym members (QA Active, QA PT)', async ({ as }) => {
    const active = await seeded('gymOwner', 'profiles', 'QA Active')
    await cannotReachMember(as, 'soloOwner', '/company', active, 'QA Active')
    const pt = await seeded('gymOwner', 'profiles', 'QA PT')
    const r = rest('soloOwner')
    expect((await r.get(`profiles?select=id&id=eq.${pt.id}`)).rows).toEqual([])
    expect((await r.get(`weekly_plans?select=id&client_id=eq.${pt.id}`)).rows).toEqual([])
  })

  test('R4 QA Solo owner cannot see or change QA Gym leads', async () => {
    const lead = await seeded('gymOwner', 'leads', 'QA Lead', 'name')
    const r = rest('soloOwner')
    expect((await r.get(`leads?select=id&id=eq.${lead.id}`)).rows).toEqual([])
    expect((await r.patch(`leads?id=eq.${lead.id}`, { name: 'QA Lead' })).rows).toEqual([])
    // And QA Gym's owner can't read QA Solo's company row
    const soloCompany = (await seeded('soloOwner', 'profiles', 'QA Solo Client')).company_id
    expect((await rest('gymOwner').get(`companies?select=id&id=eq.${soloCompany}`)).rows).toEqual([])
  })
})
