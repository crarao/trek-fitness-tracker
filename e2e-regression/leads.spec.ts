// Leads (QA Gym owner): add an enquiry, mark it trial, convert it to a member.
import { test, expect, rest, e2eName, archiveMember } from './fixtures'
import { memberRow, fakeIndianMobile } from './helpers'

type Lead = { id: string; status: string; converted_profile_id: string | null }
const leadByName = async (name: string) =>
  (await rest('gymOwner').get<Lead>(`leads?select=id,status,converted_profile_id&name=eq.${encodeURIComponent(name)}`)).rows[0]

test.describe.serial('Leads', () => {
  const name = e2eName('lead')

  test('R14 add an enquiry', async ({ as }) => {
    const page = await as('gymOwner')
    await page.goto('/company/leads')
    await page.getByRole('button', { name: '+ Add enquiry' }).click()
    await page.getByPlaceholder('Name', { exact: true }).fill(name)
    await page.locator('input[type="tel"]').first().fill(fakeIndianMobile())
    await page.getByRole('button', { name: 'Add enquiry', exact: true }).click()
    await expect.poll(async () => (await leadByName(name))?.status).toBe('new')
    await page.getByTestId('leads-filter-open').click()
    await expect(page.locator(`[data-testid="lead-row"][data-name="${name}"]`)).toBeVisible()
  })

  test('R15 mark it as trial', async ({ as }) => {
    const page = await as('gymOwner')
    await page.goto('/company/leads')
    await page.getByTestId('leads-filter-open').click()
    await page.locator(`[data-testid="lead-row"][data-name="${name}"]`).click()
    await page.getByRole('button', { name: 'Mark as trial' }).first().click()
    await page.getByRole('button', { name: 'Mark as trial' }).last().click()
    await expect(page.getByText('✓ Marked as trial')).toBeVisible()
    await expect.poll(async () => (await leadByName(name))?.status).toBe('trial')
  })

  test('R16 convert it to a member', async ({ as }) => {
    const page = await as('gymOwner')
    await page.goto('/company/leads')
    await page.getByTestId('leads-filter-open').click()
    await page.locator(`[data-testid="lead-row"][data-name="${name}"]`).click()
    await page.getByRole('button', { name: /^Convert to / }).click()
    await page.waitForURL(u => u.pathname === '/company')
    const form = page.getByTestId('add-member-form')
    await expect(form.getByPlaceholder('Full name')).toHaveValue(name)
    await form.getByPlaceholder(/^Amount/).fill('2000')
    await form.getByTestId('add-member-save').click()
    await expect(page.getByText(/enquiry marked Joined/)).toBeVisible()
    await expect(memberRow(page, name)).toBeVisible()
    const lead = await leadByName(name)
    expect(lead.status).toBe('joined')
    expect(lead.converted_profile_id).toBeTruthy()
    await archiveMember('gymOwner', lead.converted_profile_id!)
  })
})
