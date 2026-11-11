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

// Phase 2, PR B: schedule an exam, pick an eligible student, a not-yet one can't be ticked, untick keeps the row,
// sensei sees it read-only; the exam is cancelled and the students archived at the end (nothing deleted).
test.describe.serial('Grading exam: schedule + pick', () => {
  const ready = e2eName('grading ready')
  const notYet = e2eName('grading not yet')
  const ids: string[] = []
  let examId = ''

  const isoDaysFromToday = (n: number) => {
    const d = new Date(Date.now() + 5.5 * 3600_000)
    d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().slice(0, 10)
  }

  test('R22 schedule an exam and pick students', async ({ as }) => {
    const ranks = (await rest('dojoOwner').get<Rank>('belt_ranks?select=id,rank_order,belt_name,kyu,is_active&is_active=eq.true&order=rank_order')).rows
    test.skip(ranks.length < 2, 'QA Dojo has no belt ladder on this database (grading not set up)')
    const page = await as('dojoOwner')
    await page.goto('/company')
    const companyId = await myCompanyId('dojoOwner')
    // White for 200 days (ready for Yellow) and White since today (not yet)
    ids.push(await createMember(page, companyId, ready, { current_rank_id: ranks[0].id, rank_achieved_on: isoDaysFromToday(-200) }))
    ids.push(await createMember(page, companyId, notYet, { current_rank_id: ranks[0].id, rank_achieved_on: todayIST() }))

    await page.goto('/company/grading')
    await expect(page.getByTestId('page-grading')).toBeVisible()
    await page.getByTestId('exam-new').click()
    await page.getByLabel('Exam date').fill(isoDaysFromToday(14))
    await page.getByLabel('Exam time').fill('09:30')
    await page.getByTestId('exam-save').click()
    await page.waitForURL(u => /\/company\/grading\/[0-9a-f-]{36}$/.test(u.pathname))
    examId = page.url().split('/').pop()!.split('?')[0]
    await expect(page.getByTestId('page-grading-exam')).toBeVisible()
    await expect(page.getByTestId('picked-count')).toHaveText('0')

    const readyBox = page.getByRole('checkbox', { name: `${ready} sits the exam` })
    const notYetBox = page.getByRole('checkbox', { name: `${notYet} sits the exam` })
    await expect(notYetBox).toBeDisabled()
    await expect(page.locator(`[data-testid="candidate-row"][data-name="${notYet}"]`)).toContainText('to go')

    await readyBox.click()
    await expect(readyBox).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('picked-count')).toHaveText('1')
    const cand = async () => (await rest('dojoOwner').get<{ removed_at: string | null; from_rank_id: string; to_rank_id: string }>(
      `grading_exam_candidates?select=removed_at,from_rank_id,to_rank_id&exam_id=eq.${examId}&student_id=eq.${ids[0]}`)).rows
    await expect.poll(cand).toEqual([expect.objectContaining({ removed_at: null, from_rank_id: ranks[0].id, to_rank_id: ranks[1].id })])

    // Untick: the row stays, marked removed (never erased); tick again brings it back
    await readyBox.click()
    await expect(readyBox).toHaveAttribute('aria-checked', 'false')
    await expect.poll(async () => (await cand())[0]?.removed_at).not.toBeNull()
    await readyBox.click()
    await expect(readyBox).toHaveAttribute('aria-checked', 'true')
    await expect.poll(async () => (await cand())[0]?.removed_at).toBeNull()

    // Sensei: sees the exam and the picked student, no checkboxes
    const sensei = await as('dojoSensei')
    await sensei.goto(`/company/grading/${examId}`)
    await expect(sensei.getByTestId('page-grading-exam')).toBeVisible()
    await expect(sensei.locator(`[data-testid="candidate-row"][data-name="${ready}"]`)).toBeVisible()
    await expect(sensei.getByRole('checkbox')).toHaveCount(0)

    // Cancel the exam (kept, status cancelled)
    page.once('dialog', d => d.accept())
    await page.getByTestId('exam-cancel').click()
    await expect.poll(async () => (await rest('dojoOwner').get<{ status: string }>(`grading_exams?select=status&id=eq.${examId}`)).rows[0]?.status)
      .toBe('cancelled')
  })

  test.afterAll(async () => {
    if (examId) await rest('dojoOwner').patch(`grading_exams?id=eq.${examId}&status=eq.scheduled`, { status: 'cancelled' })
    for (const id of ids) await archiveMember('dojoOwner', id)
  })
})
