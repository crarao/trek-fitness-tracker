// Coach (QA Gym): makes this week's plan with AI (mocked, no Anthropic call), logs today's session;
// it shows on the client page, the coach's list and the owner's member row.
// Uses an E2E PT member (QA PT is only read), so its plans and sessions never change.
import { test, expect, rest, e2eName, myCompanyId, createMember, archiveMember } from './fixtures'
import { memberRow } from './helpers'

test('R20 coach logs a session for a PT member; it shows on the cards', async ({ as, report }) => {
  const name = e2eName('pt')
  const owner = await as('gymOwner')
  await owner.goto('/company')
  const companyId = await myCompanyId('gymOwner')
  const id = await createMember(owner, companyId, name, { client_type: 'pt' })
  try {
    const coach = await as('gymCoach')
    await coach.goto(`/company/client/${id}?tab=plans`)
    await expect(coach.getByTestId('page-client')).toContainText(name)
    await coach.getByRole('button', { name: '+ New plan' }).first().click()
    await coach.getByRole('button', { name: /Generate with AI/ }).click()
    await coach.getByRole('button', { name: 'Assign plan to client' }).first().click()
    expect(report.aiMocked, 'the AI plan request was not mocked').toBe(1)
    await expect.poll(async () => (await rest('gymCoach').get(`weekly_plans?select=id&client_id=eq.${id}`)).rows.length).toBe(1)

    // Today's day of this week's plan (every day is a workout day in the mocked plan)
    await coach.goto(`/company/client/${id}?tab=plans&day=today`)
    await coach.getByRole('button', { name: 'Mark done for E2E' }).click()
    await coach.getByLabel('Minutes').fill('45')
    const notes = `${name} session`
    const notesBox = coach.getByPlaceholder('How did it go? Anything to share…')
    if (await notesBox.count()) await notesBox.fill(notes)
    await coach.getByRole('button', { name: 'Done ✓ for E2E' }).click()
    await expect.poll(async () => (await rest('gymCoach').get(`logged_sessions?select=id&client_id=eq.${id}`)).rows.length).toBe(1)

    // Client page → Sessions
    await coach.goto(`/company/client/${id}?tab=sessions`)
    await expect(coach.getByText('Last trained today')).toBeVisible()
    await expect(coach.getByText('45 min').first()).toBeVisible()

    // Coach home: ✓ Done on the member's card
    await coach.goto('/coach')
    await expect(coach.locator(`[data-testid="coach-row"][data-name="${name}"]`)).toContainText('✓ Done')

    // Owner dashboard: the member's row shows this week's progress
    await owner.goto('/company')
    await expect(memberRow(owner, name)).toContainText(/1\/\d+ this wk/)
  } finally {
    await archiveMember('gymOwner', id)
  }
})
