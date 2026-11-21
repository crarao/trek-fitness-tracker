// All of today saves the class's activities (21 Nov): marking a student there records the class with its pre-ticked
// activities (the warm-ups), like the roll call, and each batch shows a read-only "Activities: …" line.
// QA Dojo owner; its own E2E batch (every day) + E2E student, archived at the end. The seeded QA data is only read.
import { test, expect, rest, e2eName, myCompanyId, createMember, archiveMember } from './fixtures'
import { todayIST } from './helpers'

test('R43 All of today: a mark saves the class with the pre-ticked warm-ups; read-only line + Edit link', async ({ as }) => {
  const owner = rest('dojoOwner')
  const probe = await owner.get('dojo_activities?select=id&is_default=eq.true&is_archived=eq.false')
  test.skip(probe.status >= 400 || probe.rows.length === 0, 'No class activities on this database')
  const companyId = await myCompanyId('dojoOwner')
  const { rows: branches } = await owner.get<{ id: string }>(`branches?select=id&is_archived=eq.false&limit=1`)
  const batchName = e2eName('batch')
  const made = await owner.post<{ id: string }>('batches', {
    company_id: companyId, branch_id: branches[0].id, name: batchName,
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], start_time: '05:00', end_time: '05:30',
  })
  expect(made.status, 'could not add the E2E batch').toBeLessThan(300)
  const batchId = made.rows[0].id
  const page = await as('dojoOwner')
  await page.goto('/company')
  const student = e2eName('student')
  const studentId = await createMember(page, companyId, student, { branch_id: branches[0].id, batch_id: batchId })

  await page.goto('/company/attendance/today')
  await expect(page.getByTestId('page-attendance-today')).toBeVisible()
  const group = page.locator('section').filter({ hasText: batchName })
  await expect(group.getByTestId('today-activities')).toContainText('Pre-ticked')
  await group.getByRole('checkbox', { name: `${student} came` }).click()
  await expect(group.getByRole('checkbox', { name: `${student} came` })).toHaveAttribute('aria-checked', 'true')
  await expect(group.getByTestId('today-activities')).toContainText('Activities: ')
  await expect(group.getByTestId('today-activities')).toContainText('General warm-up')

  const cls = async () => (await owner.get<{ id: string; logged_at: string | null }>(
    `batch_classes?select=id,logged_at&batch_id=eq.${batchId}&class_date=eq.${todayIST()}`)).rows[0]
  await expect.poll(async () => !!(await cls())?.logged_at).toBe(true)
  const acts = (await owner.get<{ removed_at: string | null }>(`batch_class_activities?select=removed_at&class_id=eq.${(await cls())!.id}`)).rows
  expect(acts.filter(a => !a.removed_at).length).toBe(probe.rows.length)

  await group.getByRole('button', { name: 'Edit activities →' }).click()
  await page.waitForURL(u => u.pathname === `/company/attendance/${batchId}`)
  await expect(page.getByTestId('class-activities')).toContainText('· saved')

  await archiveMember('dojoOwner', studentId)
  await owner.patch(`batches?id=eq.${batchId}&name=like.E2E*`, { is_archived: true })
})
