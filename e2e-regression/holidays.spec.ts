// Dojo holidays (QA Dojo owner; db/2026-11-19-dojo-activities-absences.md, run on dev 19 Nov).
// Adds an "E2E …" all-branches holiday on YESTERDAY (never today, so the other attendance tests are untouched),
// checks the roll call and All of today are closed, then removes it (removed_at; global teardown removes leftovers).
import { test, expect, rest, e2eName, myCompanyId } from './fixtures'
import { todayIST } from './helpers'

const yesterday = () => {
  const d = new Date(`${todayIST()}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

test.describe.serial('Dojo holidays', () => {
  const name = e2eName('holiday')
  let batchId = ''

  const rows = async () => (await rest('dojoOwner').get<{ id: string; branch_id: string | null; removed_at: string | null }>(
    `holidays?select=id,branch_id,removed_at&name=eq.${encodeURIComponent(name)}`)).rows

  test('R37 add a holiday: roll call and All of today closed; remove it: open again', async ({ as }) => {
    const day = yesterday()
    const companyId = await myCompanyId('dojoOwner')
    const { rows: branches } = await rest('dojoOwner').get<{ id: string }>(`branches?select=id&is_archived=eq.false&limit=1`)
    const made = await rest('dojoOwner').post<{ id: string }>('batches', {
      company_id: companyId, branch_id: branches[0].id, name: e2eName('batch'),
      days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], start_time: '05:00', end_time: '05:30',
    })
    expect(made.status, 'could not add the E2E batch').toBeLessThan(300)
    batchId = made.rows[0].id

    const page = await as('dojoOwner')
    await page.goto('/company/holidays')
    await expect(page.getByTestId('page-holidays')).toBeVisible()
    if (day.slice(0, 7) !== todayIST().slice(0, 7)) await page.getByRole('button', { name: 'Previous month' }).click()
    // One branch: no chips, the holiday is for all branches. With 2+ branches pick "All branches" (the default).
    await page.locator(`[data-date="${day}"]`).click()
    const sheet = page.getByRole('dialog', { name: 'Holiday' })
    await sheet.getByLabel('Holiday name').fill(name)
    await sheet.getByRole('button', { name: 'Add holiday' }).click()
    await expect(sheet).toBeHidden()
    await expect(page.locator(`[data-date="${day}"]`)).toContainText('E2E')
    await expect.poll(async () => (await rows()).map(r => [r.branch_id, r.removed_at])).toEqual([[null, null]])

    await page.goto(`/company/attendance/${batchId}?date=${day}`)
    await expect(page.getByTestId('holiday-banner')).toContainText(`No classes — ${name}`)
    await expect(page.getByTestId('class-activities').getByRole('checkbox').first()).toBeDisabled()
    await expect(page.getByRole('button', { name: /Drop-in from another batch/ })).toHaveCount(0)

    await page.goto(`/company/attendance/today?date=${day}`)
    await expect(page.getByTestId('page-attendance-today')).toBeVisible()
    await expect(page.getByTestId('holiday-chip').first()).toBeVisible()

    // Remove it again
    await page.goto('/company/holidays')
    if (day.slice(0, 7) !== todayIST().slice(0, 7)) await page.getByRole('button', { name: 'Previous month' }).click()
    await page.locator(`[data-date="${day}"]`).click()
    await sheet.getByTestId('holiday-item').filter({ hasText: name }).getByRole('button', { name: 'Remove' }).click()
    await expect(page.locator(`[data-date="${day}"]`)).not.toContainText('E2E')
    await expect.poll(async () => !!(await rows())[0]?.removed_at).toBe(true)

    await page.goto(`/company/attendance/${batchId}?date=${day}`)
    await expect(page.getByTestId('came-count')).toBeVisible()
    await expect(page.getByTestId('holiday-banner')).toHaveCount(0)
    await rest('dojoOwner').patch(`batches?id=eq.${batchId}&name=like.E2E*`, { is_archived: true })
  })
})
