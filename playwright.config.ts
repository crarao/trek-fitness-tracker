// Smoke tests (e2e/). Run: npm run test:smoke. See CLAUDE.md → Smoke tests.
// Base URL and QA logins come from the environment, or from .env.e2e locally (never committed: .env* is ignored).
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'

const envFile = path.join(__dirname, '.env.e2e')
if (fs.existsSync(envFile)) dotenv.config({ path: envFile, quiet: true })

const CI = !!process.env.CI

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: CI,
  workers: 2,
  // A test that passes only on retry is reported as "flaky", not hidden
  retries: CI ? 1 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      // Owners use phones: Pixel 7 is a Chromium phone profile (viewport, touch, mobile user agent)
      name: 'chromium-phone',
      use: {
        ...devices['Pixel 7'],
        // Optional: a Chromium already on the machine instead of `npx playwright install chromium`
        ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
      },
    },
  ],
})
