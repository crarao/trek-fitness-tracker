// Monthly progress report (#104, Share progress → Month) for an E2E PT member of QA Gym (QA PT is only read).
// Two sessions are added straight through Supabase as the owner: one today and one in the middle of last
// month (no plan, so the counts are exact whatever day the suite runs). The test checks the month picker
// (this month "(so far)" first, last month listed because of the older session, every value YYYY-MM so
// December → January can't mix up), the WhatsApp text for each month, Week still working, and the PDF
// download's name. Nothing is sent: WhatsApp is never opened.
import { test, expect, rest, e2eName, myCompanyId, createMember, archiveMember } from './fixtures'
import { todayIST } from './helpers'

// "2026-11" → the month before ("2026-01" → "2025-12")
const prevMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}
const monthLong = (month: string) =>
  new Intl.DateTimeFormat('en-IN', { month: 'long', timeZone: 'UTC' }).format(new Date(`${month}-15T00:00:00Z`))
const lastDay = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

test('R24 monthly report: month picker, message for this and last month, PDF', async ({ as }) => {
  const name = e2eName('report')
  const owner = await as('gymOwner')
  await owner.goto('/company')
  const companyId = await myCompanyId('gymOwner')
  const id = await createMember(owner, companyId, name, { client_type: 'pt' })
  try {
    const today = todayIST()
    const thisMonth = today.slice(0, 7)
    const lastMonth = prevMonth(thisMonth)
    const ownerRest = rest('gymOwner')
    for (const [session_date, minutes] of [[today, 45], [`${lastMonth}-15`, 30]] as const) {
      const r = await ownerRest.post('logged_sessions', {
        client_id: id, session_date, duration_minutes: minutes, notes: `${name} ${session_date}`, logged_by: ownerRest.userId,
      })
      expect(r.status, `adding the ${session_date} session`).toBe(201)
    }

    await owner.goto(`/company/client/${id}`)
    await expect(owner.getByTestId('page-client')).toContainText(name)
    await owner.getByRole('tab', { name: 'Progress', exact: true }).click()
    await owner.getByRole('button', { name: '📤 Share progress' }).click()
    const message = owner.locator('#share-preview')

    // Week | Month: Month shows the picker
    await owner.getByTestId('share-kind-month').click()
    const picker = owner.getByTestId('share-month')
    await expect(picker).toBeVisible()
    const values = await picker.locator('option').evaluateAll(os => os.map(o => (o as HTMLOptionElement).value))
    expect(values.slice(0, 2), 'this month first, then last month (it has a session)').toEqual([thisMonth, lastMonth])
    expect(values.every(v => /^\d{4}-\d{2}$/.test(v))).toBe(true)
    await expect(picker.locator('option').first()).toHaveText(/\(so far\)$/)
    await expect(picker.locator('option').nth(1)).not.toHaveText(/so far/)

    // This month: today's session only, counted to today
    await picker.selectOption(thisMonth)
    await expect(message).toHaveValue(new RegExp(`your ${monthLong(thisMonth)} at QA Gym`))
    await expect(message).toHaveValue(/\(so far\)/)
    await expect(message).toHaveValue(/✅ 1 session logged/)
    await expect(message).toHaveValue(/⏱ 45 min · 1 active day/)

    // Last month: the whole month, the 15th's session only
    await picker.selectOption(lastMonth)
    await expect(message).toHaveValue(new RegExp(`your ${monthLong(lastMonth)} at QA Gym`))
    await expect(message).toHaveValue(new RegExp(`\\n1–${lastDay(lastMonth)} .*${lastMonth.slice(0, 4)}\\n`))
    await expect(message).not.toHaveValue(/so far/)
    await expect(message).toHaveValue(/✅ 1 session logged/)
    await expect(message).toHaveValue(/⏱ 30 min · 1 active day/)

    // PDF of the month: file named with the month
    const [download] = await Promise.all([
      owner.waitForEvent('download'),
      owner.getByRole('button', { name: /Download PDF/ }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(new RegExp(`-progress-${lastMonth}\\.pdf$`))
    await expect(owner.getByText('✓ PDF downloaded')).toBeVisible()

    // Back to Week: the weekly message again, the month picker gone
    await owner.getByTestId('share-kind-week').click()
    await expect(picker).toBeHidden()
    await expect(message).toHaveValue(/Week of /)
  } finally {
    await archiveMember('gymOwner', id)
  }
})
