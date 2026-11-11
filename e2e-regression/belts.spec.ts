// Belt grading Phase 2, PR A (QA Dojo, dev only: grading is on for QA Dojo there): belt chips + belt history.
// Own E2E student: joins as White, then moves to the next belt; archived at the end. Seeded records are not touched.
import { test, expect, rest, e2eName, myCompanyId, createMember, callApi, archiveMember } from './fixtures'
import { todayIST } from './helpers'

type Rank = { id: string; rank_order: number; belt_name: string; kyu: number | null; is_active: boolean }

test.describe.serial('Belt chips + history', () => {
  const student = e2eName('belt student')
  let studentId = ''
  let white: Rank | undefined
  let next: Rank | undefined

  test('R21 chip on the student page and the sensei home; history shows Joined then Changed', async ({ as }) => {
    const ranks = (await rest('dojoOwner').get<Rank>('belt_ranks?select=id,rank_order,belt_name,kyu,is_active&is_active=eq.true&order=rank_order')).rows
    test.skip(ranks.length < 2, 'QA Dojo has no belt ladder on this database (grading not set up)')
    ;[white, next] = ranks

    const page = await as('dojoOwner')
    await page.goto('/company')
    const companyId = await myCompanyId('dojoOwner')
    studentId = await createMember(page, companyId, student, { current_rank_id: white!.id, rank_achieved_on: '2026-01-05' })
    // A belt change through the app's own route (as Profile → Edit does); it appends the 'manual' history row
    const changed = await callApi(page, '/api/update-client', { user_id: studentId, current_rank_id: next!.id, rank_achieved_on: todayIST() })
    expect(changed.status, JSON.stringify(changed.json)).toBe(200)

    await page.goto(`/company/client/${studentId}`)
    await expect(page.getByTestId('page-client')).toContainText(student)
    const nextChip = next!.kyu ? `${next!.kyu} kyu` : next!.belt_name
    await expect(page.getByTestId('page-client').getByTestId('belt-chip').first()).toContainText(nextChip)
    const rows = page.getByTestId('belt-history-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('Changed')
    await expect(rows.nth(1)).toContainText('Joined')
    await expect(rows.nth(1)).toContainText(white!.belt_name)

    // Sensei: sees the chip on their home list and the history (read-only)
    const sensei = await as('dojoSensei')
    await sensei.goto('/coach')
    const row = sensei.locator(`[data-testid="coach-row"][data-name="${student}"]`)
    await expect(row.getByTestId('belt-chip')).toContainText(nextChip)
    await sensei.goto(`/company/client/${studentId}`)
    await expect(sensei.getByTestId('belt-history-row')).toHaveCount(2)
  })

  test.afterAll(async () => {
    if (studentId) await archiveMember('dojoOwner', studentId)
  })
})
