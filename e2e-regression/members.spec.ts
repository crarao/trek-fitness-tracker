// Members (QA Gym owner): add, edit, renew, archive, restore; the client limit blocks the next add.
import { test, expect, rest, e2eName, myCompanyId, createMember, archiveMember } from './fixtures'
import { addMemberViaUI, openMember, memberAction, memberRow } from './helpers'
import type { Role } from './session'

type Row = { id: string; full_name: string; archived_at: string | null }
const byName = async (name: string) =>
  (await rest('gymOwner').get<Row>(`profiles?select=id,full_name,archived_at&full_name=eq.${encodeURIComponent(name)}`)).rows[0]

test.describe.serial('Members', () => {
  let name = e2eName('member')
  let id = ''

  test('R9 add a member with a membership', async ({ as }) => {
    const page = await as('gymOwner')
    await addMemberViaUI(page, name, '1000')
    const row = await byName(name)
    expect(row?.archived_at).toBeNull()
    id = row.id
    const { rows } = await rest('gymOwner').get<{ amount_paid: number; plan_type: string }>(`memberships?select=amount_paid,plan_type&profile_id=eq.${id}`)
    expect(rows).toEqual([expect.objectContaining({ plan_type: '1 Month', amount_paid: 1000 })])
  })

  test('R10 edit the name', async ({ as }) => {
    test.skip(!id, 'R9 did not add the member')
    const page = await as('gymOwner')
    await page.goto('/company')
    await openMember(page, name)
    await memberAction(page, 'Edit')
    const panel = page.getByTestId('edit-member-panel')
    const newName = name.replace('member', 'edited')
    await panel.getByPlaceholder('Full name').fill(newName)
    await panel.getByRole('button', { name: /^Save (Name|Details)/ }).click()
    await expect(page.getByTestId('page-client')).toContainText(newName)
    await expect.poll(async () => (await byName(newName))?.id).toBe(id)
    name = newName
  })

  test('R11 renew adds a second membership', async ({ as }) => {
    test.skip(!id, 'R9 did not add the member')
    const page = await as('gymOwner')
    await page.goto(`/company/client/${id}`)
    await expect(page.getByTestId('page-client')).toContainText(name)
    await memberAction(page, 'Edit')
    const panel = page.getByTestId('edit-member-panel')
    await panel.getByRole('tab', { name: 'Renew' }).click()
    await panel.getByPlaceholder(/^Amount paid/).fill('1500')
    await panel.getByRole('button', { name: 'Renew membership' }).click()
    await expect(page.getByText(/Membership renewed/)).toBeVisible()
    const { rows } = await rest('gymOwner').get<{ amount_paid: number; start_date: string }>(
      `memberships?select=amount_paid,start_date&profile_id=eq.${id}&order=start_date.asc`)
    expect(rows.map(r => r.amount_paid)).toEqual([1000, 1500])
    expect(rows[1].start_date > rows[0].start_date).toBe(true)
  })

  test('R12 archive, then restore from the Archived tab', async ({ as }) => {
    test.skip(!id, 'R9 did not add the member')
    const page = await as('gymOwner')
    await page.goto(`/company/client/${id}`)
    await expect(page.getByTestId('page-client')).toContainText(name)
    await memberAction(page, 'Archive')
    await page.waitForURL(u => u.pathname === '/company')
    await expect(page.getByTestId('page-company')).toBeVisible()
    await expect(memberRow(page, name)).toHaveCount(0)
    expect((await byName(name)).archived_at).toBeTruthy()

    await page.getByTestId('members-filter-archived').click()
    const row = memberRow(page, name)
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Restore' }).click()
    await expect.poll(async () => (await byName(name)).archived_at).toBeNull()
    await page.getByRole('button', { name: 'All', exact: true }).click()
    await expect(memberRow(page, name)).toBeVisible()
    await archiveMember('gymOwner', id) // done with it
  })

  test('R13 the client limit blocks the next add', async ({ as }) => {
    // Fills the gym up to its limit with E2E members (archived after), then tries one more in the UI.
    // Only when that takes a few members: a big gap would mean creating dozens of rows on every run.
    const maxFill = Number(process.env.E2E_MAX_FILL || 5)
    const candidates: Role[] = ['gymOwner', 'soloOwner']
    let pick: { role: Role; gap: number } | null = null
    for (const role of candidates) {
      const page = await as(role)
      await page.goto('/company')
      const slots = page.getByTestId('slots')
      await expect(slots).toBeVisible()
      const used = Number(await slots.getAttribute('data-used'))
      const limit = Number(await slots.getAttribute('data-limit'))
      const gap = limit - used
      if (!pick || gap < pick.gap) pick = { role, gap }
      await page.context().close()
    }
    console.log(`R13: smallest gap ${pick?.gap} free slot(s) (${pick?.role})`)
    test.skip(!pick || pick.gap > maxFill,
      `QA Gym / QA Solo have ${pick?.gap} free slots (over E2E_MAX_FILL=${maxFill}). Lower QA Solo's client limit on dev to its member count + 1 to run this.`)

    const { role, gap } = pick!
    const page = await as(role)
    await page.goto('/company')
    const companyId = await myCompanyId(role)
    const made: string[] = []
    try {
      for (let i = 0; i < gap; i++) made.push(await createMember(page, companyId, e2eName('limit filler')))
      await page.reload()
      await page.getByTestId('add-member-open').click()
      const form = page.getByTestId('add-member-form')
      await form.getByPlaceholder('Full name').fill(e2eName('over limit'))
      await form.getByTestId('add-member-save').click()
      await expect(form.getByTestId('add-member-message')).toContainText('Client limit reached')
      // And the server refuses too
      const over = await page.evaluate(async (cid) => {
        const res = await fetch('/api/create-user', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ no_login: true, full_name: 'E2E over limit (api)', company_id: cid, role: 'client', phone: null }) })
        return res.status
      }, companyId)
      expect(over).toBeGreaterThanOrEqual(400)
    } finally {
      for (const m of made) await archiveMember(role, m)
    }
  })
})
