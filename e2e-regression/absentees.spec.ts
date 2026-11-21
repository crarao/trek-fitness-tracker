// Today's absentees + the absence WhatsApp (QA Dojo owner; db/2026-11-19-dojo-activities-absences.md, run on dev 19 Nov).
// Own E2E batch (every day) with four E2E students: A (parent phone) and C (no phone) absent, B came, D on leave.
// B's present mark logs the class. wa.me is never really opened: the request is recorded, then aborted. The seeded QA data is only read.
// The template test writes QA Dojo's absence message and then saves the one that was there before (or the standard
// one when there was none; rows are never deleted, and the standard text behaves exactly like no row).
import { test, expect, rest, e2eName, myCompanyId, createMember, archiveMember } from './fixtures'
import { todayIST, fakeIndianMobile } from './helpers'

test.describe.serial("Dojo today's absentees", () => {
  const A = e2eName('absent parent'), B = e2eName('came'), C = e2eName('absent nophone'), D = e2eName('on leave')
  const ids: string[] = []
  let batchId = ''

  test('R38 list: absent with and without phone, came and on leave left out; Send opens WhatsApp', async ({ as }) => {
    const companyId = await myCompanyId('dojoOwner')
    const owner = rest('dojoOwner')
    const { rows: branches } = await owner.get<{ id: string }>(`branches?select=id&is_archived=eq.false&limit=1`)
    const made = await owner.post<{ id: string }>('batches', {
      company_id: companyId, branch_id: branches[0].id, name: e2eName('batch'),
      days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], start_time: '05:00', end_time: '05:30',
    })
    expect(made.status, 'could not add the E2E batch').toBeLessThan(300)
    batchId = made.rows[0].id
    const page = await as('dojoOwner')
    const wa: string[] = []
    await page.context().route('https://wa.me/**', r => { wa.push(r.request().url()); return r.abort() })
    await page.goto('/company')
    const place = { branch_id: branches[0].id, batch_id: batchId }
    ids.push(await createMember(page, companyId, A, { ...place, guardian_name: 'E2E Parent', guardian_phone: fakeIndianMobile(), guardian_relation: 'Mother' }))
    ids.push(await createMember(page, companyId, B, { ...place, guardian_phone: fakeIndianMobile() }))
    ids.push(await createMember(page, companyId, C, place))
    ids.push(await createMember(page, companyId, D, { ...place, guardian_phone: fakeIndianMobile() }))

    // Not logged yet: the batch is listed under "Roll call not taken yet", nobody from it is absent
    await page.goto('/company/absentees')
    await expect(page.getByTestId('page-absentees')).toBeVisible()
    await expect(page.getByTestId('not-logged')).toBeVisible()
    await expect(page.locator(`[data-testid="absent-row"][data-name="${A}"]`)).toHaveCount(0)

    // B came, D is on leave, the class is logged
    const today = todayIST()
    expect((await owner.post('attendance', { company_id: companyId, batch_id: batchId, profile_id: ids[1], class_date: today, present: true, is_drop_in: false, marked_by: owner.userId })).status).toBeLessThan(300)
    expect((await owner.post('student_leaves', { company_id: companyId, profile_id: ids[3], from_date: today, to_date: today, marked_by: owner.userId })).status).toBeLessThan(300)

    await page.reload()
    await expect(page.getByTestId('page-absentees')).toBeVisible()
    const rowA = page.locator(`[data-testid="absent-row"][data-name="${A}"]`)
    const rowC = page.locator(`[data-testid="absent-row"][data-name="${C}"]`)
    await expect(rowA).toContainText('to Mother (E2E Parent)')
    await expect(rowC).toContainText('No WhatsApp number')
    await expect(page.locator(`[data-testid="absent-row"][data-name="${B}"]`)).toHaveCount(0)
    await expect(page.locator(`[data-testid="absent-row"][data-name="${D}"]`)).toHaveCount(0)

    await rowA.getByRole('button', { name: 'Send' }).click()
    await expect.poll(() => wa.length).toBe(1)
    const url = decodeURIComponent(wa[0])
    expect(url).toContain('https://wa.me/91')
    expect(url).toContain('Namaste E2E 🙏')
    expect(url).toContain('did not attend today')
    await expect(rowA.getByRole('button', { name: 'Again' })).toBeVisible()   // ticked for this visit only
  })

  test('R39 Send to all walks the list and ends with a summary', async ({ as }) => {
    test.skip(!batchId, 'R38 did not run')
    const page = await as('dojoOwner')
    const wa: string[] = []
    await page.context().route('https://wa.me/**', r => { wa.push(r.request().url()); return r.abort() })
    await page.goto('/company/absentees')
    await expect(page.getByTestId('page-absentees')).toBeVisible()
    await page.getByTestId('send-all').click()
    await expect.poll(() => wa.length).toBe(1)   // the first chat opens straight away
    const bar = page.getByTestId('send-run')
    // Skip through whatever else is on QA Dojo's list today, then the summary
    for (let i = 0; i < 200 && !(await bar.textContent())?.includes('Done:'); i++) await bar.getByRole('button', { name: 'Skip' }).click()
    await expect(bar).toContainText(/Done: 1 opened, \d+ skipped/)
    await bar.getByRole('button', { name: 'Close' }).click()
    await expect(bar).toHaveCount(0)
  })

  test('R40 message template: edit with live preview, save, put back', async ({ as }) => {
    test.skip(!batchId, 'R38 did not run')
    const owner = rest('dojoOwner')
    const before = (await owner.get<{ body: string }>(`message_templates?select=body&kind=eq.absence`)).rows[0]?.body ?? null
    const page = await as('dojoOwner')
    await page.goto('/company/absentees')
    const box = page.getByTestId('absence-template')
    await box.getByRole('button', { name: 'Edit message' }).click()
    await box.getByLabel('Absence message').fill('E2E check {child_name} {nope}')
    await expect(box).toContainText('Not a placeholder: {nope}')
    await expect(page.getByTestId('absence-preview')).toContainText('E2E check')
    await box.getByRole('button', { name: 'Save message' }).click()
    await expect.poll(async () => (await owner.get<{ body: string }>(`message_templates?select=body&kind=eq.absence`)).rows[0]?.body).toBe('E2E check {child_name} {nope}')

    // Put it back (the standard text when there was no row before)
    await box.getByRole('button', { name: 'Edit message' }).click()
    if (before) await box.getByLabel('Absence message').fill(before)
    else await box.getByRole('button', { name: 'Use the standard message' }).click()
    await box.getByRole('button', { name: 'Save message' }).click()
    await expect(page.getByTestId('absence-preview')).not.toContainText('E2E check')

    for (const id of ids) await archiveMember('dojoOwner', id)
    await owner.patch(`batches?id=eq.${batchId}&name=like.E2E*`, { is_archived: true })
  })
})
