// Dojo class activities + 7-day lock (QA Dojo owner; db/2026-11-19-dojo-activities-absences.md, run on dev 19 Nov).
// Uses its own E2E activity and an E2E batch that meets every day; the seeded QA data and the 13 seeded activities
// are only read. The activity and the batch are archived at the end (and by global teardown). Nothing is deleted.
import { test, expect, rest, e2eName, myCompanyId } from './fixtures'
import { todayIST } from './helpers'

type Cls = { id: string; logged_at: string | null; unlocked_at: string | null }
type Act = { activity_id: string; removed_at: string | null }

const daysBack = (n: number) => {
  const d = new Date(`${todayIST()}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

test.describe.serial('Dojo class activities', () => {
  const activity = e2eName('activity')
  const renamed = `${activity} kata`
  let activityId = ''
  let batchId = ''

  const classRow = async (date: string) => (await rest('dojoOwner').get<Cls>(
    `batch_classes?select=id,logged_at,unlocked_at&batch_id=eq.${batchId}&class_date=eq.${date}`)).rows[0] ?? null

  test('R31 activities page: add, rename, pre-tick on / off', async ({ as }) => {
    const page = await as('dojoOwner')
    await page.goto('/company/activities')
    await expect(page.getByTestId('page-activities')).toBeVisible()
    // The two seeded warm-ups are pre-ticked
    await expect(page.locator('[data-testid="activity-row"][data-name="General warm-up"]')).toContainText('Pre-ticked')

    await page.getByRole('button', { name: '+ Add activity' }).click()
    await page.getByLabel('Activity name').fill(activity)
    await page.getByRole('button', { name: 'Add activity', exact: true }).click()
    const row = page.locator(`[data-testid="activity-row"][data-name="${activity}"]`)
    await expect(row).toBeVisible()
    const { rows } = await rest('dojoOwner').get<{ id: string }>(`dojo_activities?select=id&name=eq.${encodeURIComponent(activity)}`)
    activityId = rows[0]?.id
    expect(activityId, 'activity not saved').toBeTruthy()

    await row.getByRole('button', { name: 'Edit' }).click()
    await page.getByLabel('Activity name').fill(renamed)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    const again = page.locator(`[data-testid="activity-row"][data-name="${renamed}"]`)
    await expect(again).toBeVisible()
    await again.getByRole('button', { name: 'Pre-tick' }).click()
    await expect(again).toContainText('Pre-ticked')
    await again.getByRole('button', { name: 'Stop pre-ticking' }).click()
    await expect(again).not.toContainText('Pre-ticked')
    await expect.poll(async () => (await rest('dojoOwner').get<{ name: string; is_default: boolean }>(
      `dojo_activities?select=name,is_default&id=eq.${activityId}`)).rows[0]).toEqual({ name: renamed, is_default: false })
  })

  test('R32 roll call: warm-ups pre-ticked, a tap saves the class, untick keeps the row', async ({ as }) => {
    test.skip(!activityId, 'R31 did not run')
    const companyId = await myCompanyId('dojoOwner')
    const { rows: branches } = await rest('dojoOwner').get<{ id: string }>(`branches?select=id&is_archived=eq.false&limit=1`)
    const made = await rest('dojoOwner').post<{ id: string }>('batches', {
      company_id: companyId, branch_id: branches[0].id, name: e2eName('batch'),
      days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], start_time: '05:00', end_time: '05:30',
    })
    expect(made.status, 'could not add the E2E batch').toBeLessThan(300)
    batchId = made.rows[0].id

    const page = await as('dojoOwner')
    await page.goto(`/company/attendance/${batchId}`)
    const card = page.getByTestId('class-activities')
    await expect(card).toBeVisible()
    await expect(card.getByRole('checkbox', { name: 'General warm-up' })).toHaveAttribute('aria-checked', 'true')
    await expect(card.getByRole('checkbox', { name: 'Hard warm-up' })).toHaveAttribute('aria-checked', 'true')
    expect(await classRow(todayIST()), 'nothing saved just by opening').toBeNull()

    const mine = card.getByRole('checkbox', { name: renamed })
    await mine.click()
    await expect(mine).toHaveAttribute('aria-checked', 'true')
    await expect(card).toContainText('3 activities · saved')
    await expect.poll(async () => !!(await classRow(todayIST()))?.logged_at).toBe(true)
    const cls = (await classRow(todayIST()))!
    const acts = async () => (await rest('dojoOwner').get<Act>(`batch_class_activities?select=activity_id,removed_at&class_id=eq.${cls.id}`)).rows
    await expect.poll(async () => (await acts()).filter(a => !a.removed_at).length).toBe(3)

    await mine.click()
    await expect(mine).toHaveAttribute('aria-checked', 'false')
    // Never deleted: the row stays with removed_at set
    await expect.poll(async () => (await acts()).find(a => a.activity_id === activityId)?.removed_at).toBeTruthy()
    await page.reload()
    await expect(page.getByTestId('class-activities').getByRole('checkbox', { name: renamed })).toHaveAttribute('aria-checked', 'false')
  })

  test('R33 a day 8 days back is locked; the owner unlocks and locks it again', async ({ as }) => {
    test.skip(!batchId, 'R32 did not run')
    const old = daysBack(8)
    const page = await as('dojoOwner')
    await page.goto(`/company/attendance/${batchId}?date=${old}`)
    const banner = page.getByTestId('lock-banner')
    await expect(banner).toContainText('Locked — older than 7 days')
    await expect(page.getByTestId('class-activities').getByRole('checkbox', { name: 'General warm-up' })).toBeDisabled()

    await banner.getByRole('button', { name: 'Unlock' }).click()
    await expect(banner).toContainText('Unlocked by the owner')
    await expect.poll(async () => !!(await classRow(old))?.unlocked_at).toBe(true)
    await expect(page.getByTestId('class-activities').getByRole('checkbox', { name: 'General warm-up' })).toBeEnabled()

    await banner.getByRole('button', { name: 'Lock again' }).click()
    await expect(banner).toContainText('Locked — older than 7 days')
    await expect.poll(async () => (await classRow(old))?.unlocked_at ?? null).toBeNull()
  })

  test('R34 archive the E2E activity: off the list and the roll call', async ({ as }) => {
    test.skip(!activityId, 'R31 did not run')
    const page = await as('dojoOwner')
    await page.goto('/company/activities')
    await page.locator(`[data-testid="activity-row"][data-name="${renamed}"]`).getByRole('button', { name: 'Archive' }).click()
    await expect(page.locator(`[data-testid="activity-row"][data-name="${renamed}"]`)).toBeHidden()
    await expect.poll(async () => (await rest('dojoOwner').get<{ is_archived: boolean }>(
      `dojo_activities?select=is_archived&id=eq.${activityId}`)).rows[0]?.is_archived).toBe(true)
    if (batchId) {
      // Archived and never ticked on today's class (R32 unticked it): not offered any more
      await page.goto(`/company/attendance/${batchId}`)
      await expect(page.getByTestId('class-activities')).toBeVisible()
      await expect(page.getByTestId('class-activities').getByRole('checkbox', { name: renamed })).toHaveCount(0)
      await rest('dojoOwner').patch(`batches?id=eq.${batchId}&name=like.E2E*`, { is_archived: true })
    }
  })
})
