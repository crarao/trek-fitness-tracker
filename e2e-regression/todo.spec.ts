// To do: tests that need a fake "today" (Playwright clock + dev data dated around it). Listed so they show in the
// report as skipped; each says what it would check.
import { test } from './fixtures'

test.describe('To do (needs a fake today)', () => {
  test.fixme('T1 member turns Expiring 7 days before the end date, Expired after it (status chip, filter tabs, Remind)', async () => {})
  test.fixme('T2 dojo fee reminder: "Send reminder" only when the fee is due today or within 7 days', async () => {})
  test.fixme('T3 Today\'s schedule: Expected → Not logged 60 minutes after the workout time', async () => {})
  test.fixme('T4 trial / subscription countdown banner (green / amber / red)', async () => {})
  test.fixme('T5 lead follow-up: "Due" list on the follow-up day, overdue after it', async () => {})
  test.fixme('T6 attendance month counts from the day the student joined (monthStats)', async () => {})
  test.fixme('T7 a plan starting next week is "upcoming" and not on today\'s coach list', async () => {})
})
