// Dojo activity items by belt (QA Dojo owner; db/2026-11-20-activity-items.md). Skipped until that SQL ran on dev
// (no parent_id column) or when QA Dojo has no belt ladder. Its own E2E item under "Kata practice", first taught at
// the second belt (Yellow); an E2E batch with a White and a Yellow E2E student. Everything archived at the end.
import { test, expect, rest, e2eName, myCompanyId, createMember, archiveMember } from './fixtures'

type Rank = { id: string; rank_order: number; belt_name: string; is_active: boolean }

test.describe.serial('Dojo activity items by belt', () => {
  const item = e2eName('kata')
  const white = e2eName('white'), yellow = e2eName('yellow')
  const ids: string[] = []
  let batchId = ''

  test('R42 item under a category, shown only when the belt is in class, counted only for that belt', async ({ as }) => {
    const owner = rest('dojoOwner')
    const probe = await owner.get('dojo_activities?select=parent_id&limit=1')
    test.skip(probe.status >= 400, 'db/2026-11-20-activity-items.md has not run on dev yet')
    const ranks = (await owner.get<Rank>('belt_ranks?select=id,rank_order,belt_name,is_active&is_active=eq.true&order=rank_order')).rows
    test.skip(ranks.length < 2, 'QA Dojo has no belt ladder on this database')
    const companyId = await myCompanyId('dojoOwner')
    const page = await as('dojoOwner')

    // 1. Activities page: + Add item under Kata practice, first taught at the second belt
    await page.goto('/company/activities')
    await expect(page.getByTestId('page-activities')).toBeVisible()
    await page.getByRole('button', { name: 'Add item to Kata practice' }).click()
    await page.getByLabel('Activity name').fill(item)
    await page.getByLabel('First taught at').selectOption(ranks[1].id)
    await page.getByRole('button', { name: 'Add activity', exact: true }).click()
    const row = page.locator(`[data-testid="activity-row"][data-name="${item}"]`)
    await expect(row.getByTestId('item-belt')).toContainText('and above')
    const saved = (await owner.get<{ parent_id: string; min_rank_id: string }>(`dojo_activities?select=parent_id,min_rank_id&name=eq.${encodeURIComponent(item)}`)).rows[0]
    expect(saved?.min_rank_id).toBe(ranks[1].id)
    expect(saved?.parent_id).toBeTruthy()

    // 2. A batch with only a White student: the Yellow+ item isn't offered
    const { rows: branches } = await owner.get<{ id: string }>(`branches?select=id&is_archived=eq.false&limit=1`)
    const made = await owner.post<{ id: string }>('batches', {
      company_id: companyId, branch_id: branches[0].id, name: e2eName('batch'),
      days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], start_time: '05:00', end_time: '05:30',
    })
    expect(made.status, 'could not add the E2E batch').toBeLessThan(300)
    batchId = made.rows[0].id
    await page.goto('/company')
    const place = { branch_id: branches[0].id, batch_id: batchId }
    const since = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10)
    ids.push(await createMember(page, companyId, white, { ...place, current_rank_id: ranks[0].id, rank_achieved_on: since }))
    await page.goto(`/company/attendance/${batchId}`)
    const card = page.getByTestId('class-activities')
    await expect(card).toBeVisible()
    const openKata = async () => {
      const toggle = card.getByRole('button', { name: 'Kata practice items' })
      if (await toggle.count() && (await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
    }
    await openKata()
    await expect(card.getByRole('checkbox', { name: item })).toHaveCount(0)

    // 3. A Yellow student joins: offered; tick it with both present
    ids.push(await createMember(page, companyId, yellow, { ...place, current_rank_id: ranks[1].id, rank_achieved_on: since }))
    await page.reload()
    await expect(card).toBeVisible()
    await openKata()
    await page.getByRole('button', { name: white }).click()
    await page.getByRole('button', { name: yellow }).click()
    await expect(card).toContainText('· saved')
    const itemBox = card.getByRole('checkbox', { name: item })
    await itemBox.click()
    await expect(itemBox).toHaveAttribute('aria-checked', 'true')

    // 4. Reports by student: counted for the Yellow student, not the White one
    await page.goto('/company/attendance/reports')
    await page.getByRole('tab', { name: /^By student/ }).click()
    const pick = page.getByRole('combobox')
    await pick.selectOption({ label: `${yellow} · ${(await owner.get<{ name: string }>(`batches?select=name&id=eq.${batchId}`)).rows[0].name}` })
    await expect(page.getByTestId('student-activity-totals')).toContainText(item)
    await pick.selectOption({ index: (await pick.locator('option').allTextContents()).findIndex(t => t.startsWith(white)) })
    await expect(page.getByTestId('student-came')).toHaveText('1')
    await expect(page.getByTestId('student-activity-totals')).not.toContainText(item)

    for (const id of ids) await archiveMember('dojoOwner', id)
    await owner.patch(`batches?id=eq.${batchId}&name=like.E2E*`, { is_archived: true })
    await owner.patch(`dojo_activities?name=eq.${encodeURIComponent(item)}`, { is_archived: true })
  })
})
