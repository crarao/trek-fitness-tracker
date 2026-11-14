// Dojo (QA Dojo owner): mark attendance, undo it, drop-in from another batch; today's count follows.
// Uses its own E2E student (home batch QA Daily) and an E2E batch for the drop-in; the seeded QA Student is only read.
import { test, expect, rest, e2eName, myCompanyId, createMember, seeded } from './fixtures'
import { todayIST, weekdayIST } from './helpers'

type Att = { present: boolean; is_drop_in: boolean; batch_id: string }

test.describe.serial('Dojo attendance', () => {
  const student = e2eName('student')
  let studentId = ''
  let daily: { id: string; branch_id: string; days: string[] } | null = null
  let otherBatchId = ''
  let boardBefore = 0

  const attendance = async () => (await rest('dojoOwner').get<Att>(
    `attendance?select=present,is_drop_in,batch_id&profile_id=eq.${studentId}&class_date=eq.${todayIST()}`)).rows

  test('R17 mark a student present: roll call and today count go up by one', async ({ as }) => {
    const { rows } = await rest('dojoOwner').get<{ id: string; branch_id: string; days: string[] }>(
      `batches?select=id,branch_id,days&name=eq.QA%20Daily&is_archived=eq.false`)
    daily = rows[0] ?? null
    if (!daily) await seeded('dojoOwner', 'batches', 'QA Daily', 'name') // fails with the "re-create the QA data" message
    test.skip(!daily!.days?.includes(weekdayIST()), `QA Daily does not meet on ${weekdayIST()}, so it is not on today's board`)

    const page = await as('dojoOwner')
    await page.goto('/company')
    const companyId = await myCompanyId('dojoOwner')
    studentId = await createMember(page, companyId, student, { branch_id: daily!.branch_id, batch_id: daily!.id })
    // Another batch at the same branch, every day, for the drop-in (archived by teardown)
    const made = await rest('dojoOwner').post<{ id: string }>('batches', {
      company_id: companyId, branch_id: daily!.branch_id, name: e2eName('batch'),
      days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], start_time: '05:00', end_time: '05:30',
    })
    expect(made.status, 'could not add the E2E batch').toBeLessThan(300)
    otherBatchId = made.rows[0].id

    await page.goto('/company/attendance/today')
    await expect(page.getByTestId('page-attendance-today')).toBeVisible()
    boardBefore = Number(await page.getByTestId('came-count').textContent())

    await page.goto(`/company/attendance/${daily!.id}`)
    const count = page.getByTestId('came-count')
    await expect(count).toBeVisible()
    const before = Number(await count.textContent())
    const btn = page.getByRole('button', { name: student })
    await expect(btn).toHaveAttribute('aria-pressed', 'false')
    await btn.click()
    await expect(btn).toHaveAttribute('aria-pressed', 'true')
    await expect(count).toHaveText(String(before + 1))
    await expect.poll(attendance).toEqual([expect.objectContaining({ present: true, is_drop_in: false, batch_id: daily!.id })])

    await page.goto('/company/attendance/today')
    await expect(page.getByTestId('came-count')).toHaveText(String(boardBefore + 1))
    await expect(page.getByRole('checkbox', { name: `${student} came` })).toHaveAttribute('aria-checked', 'true')
  })

  test('R18 undo: tap again, counts go back', async ({ as }) => {
    test.skip(!studentId, 'R17 did not run')
    const page = await as('dojoOwner')
    await page.goto(`/company/attendance/${daily!.id}`)
    const count = page.getByTestId('came-count')
    await expect(count).toBeVisible()
    const before = Number(await count.textContent())
    const btn = page.getByRole('button', { name: student })
    await expect(btn).toHaveAttribute('aria-pressed', 'true')
    await btn.click()
    await expect(btn).toHaveAttribute('aria-pressed', 'false')
    await expect(count).toHaveText(String(before - 1))
    // Never deleted: the row stays with present = false
    await expect.poll(attendance).toEqual([expect.objectContaining({ present: false })])
    await page.goto('/company/attendance/today')
    await expect(page.getByTestId('came-count')).toHaveText(String(boardBefore))
  })

  test('R19 drop-in from another batch', async ({ as }) => {
    test.skip(!studentId || !otherBatchId, 'R17 did not run')
    const page = await as('dojoOwner')
    await page.goto(`/company/attendance/${otherBatchId}`)
    const count = page.getByTestId('came-count')
    await expect(count).toHaveText('0')
    await page.getByRole('button', { name: /Drop-in from another batch/ }).click()
    await page.getByRole('searchbox').fill(student)
    await page.getByRole('button', { name: new RegExp(student) }).first().click()
    const btn = page.getByRole('button', { name: new RegExp(student) }).first()
    await expect(btn).toHaveAttribute('aria-pressed', 'true')
    await expect(btn).toContainText('Drop-in')
    await expect(count).toHaveText('1')
    await expect.poll(async () => (await attendance()).find(a => a.batch_id === otherBatchId))
      .toEqual(expect.objectContaining({ present: true, is_drop_in: true }))
    await page.goto('/company/attendance/today')
    await expect(page.getByTestId('came-count')).toHaveText(String(boardBefore + 1))
  })
})
