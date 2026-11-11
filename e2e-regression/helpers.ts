// UI steps shared by several regression tests
import type { Page } from '@playwright/test'
import { expect } from './fixtures'

export const memberRow = (page: Page, name: string) => page.locator(`[data-testid="member-row"][data-name="${name}"]`)

// Owner / partner dashboard → + Add member → name + amount (1 Month, starts today, no login) → Save
export async function addMemberViaUI(page: Page, name: string, amount = '1000') {
  await page.goto('/company')
  await expect(page.getByTestId('page-company')).toBeVisible()
  await page.getByTestId('add-member-open').click()
  const form = page.getByTestId('add-member-form')
  await form.getByPlaceholder('Full name').fill(name)
  await form.getByPlaceholder(/^Amount/).fill(amount)
  await form.getByTestId('add-member-save').click()
  await expect(form).toBeHidden({ timeout: 30_000 })
  await expect(memberRow(page, name)).toBeVisible()
}

// Dashboard row → client page
export async function openMember(page: Page, name: string) {
  await memberRow(page, name).click()
  await page.waitForURL(u => u.pathname.startsWith('/company/client/'))
  await expect(page.getByTestId('page-client')).toContainText(name)
}

// Client page header ⋯ → a menu item (never "Delete")
export async function memberAction(page: Page, item: 'Edit' | 'Archive' | 'Restore') {
  await page.getByRole('button', { name: 'Member actions' }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

// Today in India (the QA companies are Indian; the browser runs in Asia/Kolkata)
export function todayIST(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
}
export function weekdayIST(): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.now() + 5.5 * 3600_000).getUTCDay()]
}

// A 10-digit Indian mobile number nobody has (only ever saved in dev, never messaged)
export function fakeIndianMobile(): string {
  return '9' + String(Date.now()).slice(-9)
}
