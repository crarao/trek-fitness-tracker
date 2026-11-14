// Regression tests (e2e-regression/). Run: npm run test:regression. See CLAUDE.md → Regression tests.
// They WRITE, so they run only against dev: the dev link, a Vercel preview of a dev branch, or localhost, with the
// dev Supabase project. Settings come from the environment, or locally from .env.regression (never committed).
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'
import { checkTarget } from './e2e-regression/target'

const envFile = path.join(__dirname, '.env.regression')
if (fs.existsSync(envFile)) dotenv.config({ path: envFile, quiet: true })
// Refuses to start unless the target is dev (throws here, before any browser opens)
const { baseUrl, supabaseUrl } = checkTarget()
if (!process.env.TEST_WORKER_INDEX) console.log(`Regression tests against: ${baseUrl} (Supabase ${supabaseUrl})`)

const CI = !!process.env.CI

export default defineConfig({
  testDir: 'e2e-regression',
  globalSetup: './e2e-regression/global-setup.ts',
  globalTeardown: './e2e-regression/global-teardown.ts',
  // One at a time: tests share the QA companies (client limit, today's attendance count)
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['html', { open: 'never', outputFolder: 'playwright-report-regression' }], ['list']],
  outputDir: 'test-results-regression',
  use: {
    baseURL: baseUrl,
    // The QA companies are Indian; "today" in the app is the device's day
    timezoneId: 'Asia/Kolkata',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-phone',
      use: {
        ...devices['Pixel 7'],
        ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
      },
    },
  ],
})
