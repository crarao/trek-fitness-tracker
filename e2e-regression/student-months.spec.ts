// Month by month (21 Nov): a dojo student's last 6 months on the student page (Progress) and in Class reports
// (By student → Months). QA Dojo owner; its own E2E batch (every day) + E2E student, marked present today on the roll
// call (saves the class with the pre-ticked warm-ups). Archived at the end. The seeded QA data is only read.
import { test, expect, rest, e2eName, myCompanyId, createMember, archiveMember } from './fixtures'
import { todayIST } from './helpers'

test('R44 month by month: this month shows the class and its activities; opens the calendar; same in Reports', async ({ as }) => {
  const owner = rest('dojoOwner')
  const probe = await owner.get('dojo_activities?select=id&limit=1')
  test.skip(probe.status >= 400, 'Class activities are not set up on this database')
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

  await page.goto(`/company/attendance/${batchId}`)
  await page.getByRole('button', { name: student }).click()
  await expect(page.getByTestId('class-activities')).toContainText('· saved')

  // Student page → Progress: one month (they joined today), 1 of 1 class, the warm-up listed
  await page.goto(`/company/client/${studentId}?tab=progress`)
  const months = page.getByTestId('student-months')
  await expect(months).toBeVisible()
  const row = months.locator(`[data-testid="month-row"][data-month="${todayIST().slice(0, 7)}-01"]`)
  await expect(row.getByTestId('month-came')).toHaveText('1')
  await expect(row).toContainText('of 1 class')
  await expect(row).toContainText('General warm-up')
  await expect(months.getByTestId('month-row')).toHaveCount(1)

  // Tap the month: Class reports → By student, that month's calendar
  await row.getByRole('button').first().click()
  await page.waitForURL(u => u.pathname === '/company/attendance/reports')
  await expect(page.getByTestId('student-came')).toHaveText('1')

  // Months toggle in Reports: the same summary
  await page.getByRole('tab', { name: 'Months' }).click()
  await expect(page.getByTestId('student-months').getByTestId('month-came').first()).toHaveText('1')

  await archiveMember('dojoOwner', studentId)
  await owner.patch(`batches?id=eq.${batchId}&name=like.E2E*`, { is_archived: true })
})
