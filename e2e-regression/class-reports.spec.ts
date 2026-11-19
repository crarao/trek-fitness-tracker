// Dojo class reports (QA Dojo owner; db/2026-11-19-dojo-activities-absences.md, run on dev 19 Nov).
// Own E2E batch (every day) + E2E student, marked present today on the roll call (which saves the class with the
// pre-ticked warm-ups), then the report tabs show it. Archived at the end. Reports only read.
import { test, expect, rest, e2eName, myCompanyId, createMember, archiveMember } from './fixtures'

test.describe.serial('Dojo class reports', () => {
  const batchName = e2eName('batch')
  const student = e2eName('student')

  test('R41 by day, by student and by activity show a marked class and its activities', async ({ as }) => {
    const companyId = await myCompanyId('dojoOwner')
    const owner = rest('dojoOwner')
    const { rows: branches } = await owner.get<{ id: string }>(`branches?select=id&is_archived=eq.false&limit=1`)
    const made = await owner.post<{ id: string }>('batches', {
      company_id: companyId, branch_id: branches[0].id, name: batchName,
      days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], start_time: '05:00', end_time: '05:30',
    })
    expect(made.status, 'could not add the E2E batch').toBeLessThan(300)
    const batchId = made.rows[0].id
    const page = await as('dojoOwner')
    await page.goto('/company')
    const studentId = await createMember(page, companyId, student, { branch_id: branches[0].id, batch_id: batchId })

    // Roll call: mark present (the class is saved with the pre-ticked warm-ups)
    await page.goto(`/company/attendance/${batchId}`)
    await expect(page.getByTestId('class-activities')).toBeVisible()
    await page.getByRole('button', { name: student }).click()
    await expect(page.getByTestId('class-activities')).toContainText('· saved')

    await page.goto('/company/attendance/reports')
    await expect(page.getByTestId('page-class-reports')).toBeVisible()
    const day = page.locator(`[data-testid="day-row"][data-name="${batchName}"]`)
    await expect(day).toContainText('1 came')
    await expect(day).toContainText('General warm-up')

    await page.getByRole('tab', { name: /^By student/ }).click()
    await page.getByRole('combobox').selectOption({ label: `${student} · ${batchName}` })
    await expect(page.getByTestId('student-came')).toHaveText('1')
    await expect(page.getByTestId('student-activity-totals')).toContainText('General warm-up')

    await page.getByRole('tab', { name: 'By activity' }).click()
    await expect(page.locator('[data-testid="activity-report-row"][data-name="General warm-up"]')).toContainText(batchName)

    await archiveMember('dojoOwner', studentId)
    await owner.patch(`batches?id=eq.${batchId}&name=like.E2E*`, { is_archived: true })
  })
})
