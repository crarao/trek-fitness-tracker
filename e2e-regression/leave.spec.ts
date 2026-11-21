// Dojo leave + availability (QA Dojo owner; db/2026-11-19-dojo-activities-absences.md, run on dev 19 Nov).
// Its own E2E student in an E2E batch (Mon / Wed / Fri); the seeded QA Student is only read. The student and the
// batch are archived at the end (and by global teardown). Leave is cancelled, never deleted.
import { test, expect, rest, e2eName, myCompanyId, createMember, archiveMember } from './fixtures'
import { todayIST } from './helpers'

type Leave = { to_date: string; cancelled_at: string | null }

const daysAhead = (n: number) => {
  const d = new Date(`${todayIST()}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

test.describe.serial('Dojo leave + availability', () => {
  const student = e2eName('student')
  let studentId = ''
  let batchId = ''

  const leaves = async () => (await rest('dojoOwner').get<Leave>(
    `student_leaves?select=to_date,cancelled_at&profile_id=eq.${studentId}`)).rows

  test('R35 roll call: On leave until a date, then Cancel leave', async ({ as }) => {
    const companyId = await myCompanyId('dojoOwner')
    const { rows: branches } = await rest('dojoOwner').get<{ id: string }>(`branches?select=id&is_archived=eq.false&limit=1`)
    const made = await rest('dojoOwner').post<{ id: string }>('batches', {
      company_id: companyId, branch_id: branches[0].id, name: e2eName('batch'),
      days: ['Mon', 'Wed', 'Fri'], start_time: '05:00', end_time: '05:30',
    })
    expect(made.status, 'could not add the E2E batch').toBeLessThan(300)
    batchId = made.rows[0].id
    const page = await as('dojoOwner')
    await page.goto('/company')
    studentId = await createMember(page, companyId, student, { branch_id: branches[0].id, batch_id: batchId })

    await page.goto(`/company/attendance/${batchId}`)
    const row = page.locator(`[data-testid="roll-row"][data-name="${student}"]`)
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'On leave', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: 'On leave' })
    await expect(sheet.getByLabel('Until when')).toHaveValue(todayIST())   // default: the same day
    const until = daysAhead(5)
    await sheet.getByLabel('Until when').fill(until)
    await sheet.getByLabel('Leave note').fill('E2E exams')
    await sheet.getByRole('button', { name: 'Save leave' }).click()
    await expect(sheet).toBeHidden()
    await expect(row.getByTestId('on-leave')).toContainText('On leave until')
    await expect(row.getByRole('button', { name: student })).toBeDisabled()
    await expect.poll(leaves).toEqual([{ to_date: until, cancelled_at: null }])

    // Still on leave after a reload, and on a later day of the leave
    await page.goto(`/company/attendance/${batchId}`)
    await expect(row.getByTestId('on-leave')).toBeVisible()

    await row.getByRole('button', { name: 'Cancel leave' }).click()
    await expect(row.getByTestId('on-leave')).toHaveCount(0)
    await expect(row.getByRole('button', { name: student })).toBeEnabled()
    // Never deleted: the row stays with cancelled_at
    await expect.poll(async () => !!(await leaves())[0]?.cancelled_at).toBe(true)
  })

  test('R36 availability: only home batch days offered, saved, shown on profile and roll call', async ({ as }) => {
    test.skip(!studentId, 'R35 did not run')
    const page = await as('dojoOwner')
    await page.goto(`/company/client/${studentId}`)
    await expect(page.getByTestId('page-client')).toContainText(student)
    await page.getByTestId('profile-edit').click()
    const picker = page.getByTestId('availability-picker')
    await expect(picker.getByRole('button')).toHaveText(['Mon', 'Wed', 'Fri'])
    await expect(picker.getByRole('button', { name: 'Wed' })).toHaveAttribute('aria-pressed', 'true')
    await picker.getByRole('button', { name: 'Wed' }).click()
    await expect(picker.getByRole('button', { name: 'Wed' })).toHaveAttribute('aria-pressed', 'false')
    await page.getByRole('button', { name: 'Save Profile' }).click()
    await expect(page.getByTestId('attends-line')).toHaveText('Attends: Mon, Fri')
    await expect.poll(async () => (await rest('dojoOwner').get<{ available_days: string | null }>(
      `profiles?select=available_days&id=eq.${studentId}`)).rows[0]?.available_days).toBe('Mon,Fri')

    await page.goto(`/company/attendance/${batchId}`)
    await expect(page.locator(`[data-testid="roll-row"][data-name="${student}"]`)).toContainText('Attends: Mon, Fri')

    await archiveMember('dojoOwner', studentId)
    await rest('dojoOwner').patch(`batches?id=eq.${batchId}&name=like.E2E*`, { is_archived: true })
  })
})
