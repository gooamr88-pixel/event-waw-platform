// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Event Waw — Playwright E2E Configuration
 * ─────────────────────────────────────────
 * Optimized for a Vanilla JS + Supabase SaaS platform.
 * Tests run against a live dev server on port 3000.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',

  /* Maximum time one test can run */
  timeout: 60_000,

  /* Expect assertions timeout */
  expect: {
    timeout: 10_000,
  },

  /* Run tests in files in parallel */
  fullyParallel: false, // Sequential for auth-dependent flows

  /* Fail the build on CI if you accidentally left test.only */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Limit parallel workers on CI */
  workers: process.env.CI ? 1 : 2,

  /* Reporter */
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],

  /* Shared settings for all projects */
  use: {
    /* Base URL for navigation */
    baseURL: process.env.BASE_URL || 'http://localhost:3000',

    /* Collect trace on first retry */
    trace: 'on-first-retry',

    /* Screenshot on failure */
    screenshot: 'only-on-failure',

    /* Video on first retry */
    video: 'on-first-retry',

    /* Action timeout */
    actionTimeout: 10_000,

    /* Navigation timeout */
    navigationTimeout: 30_000,
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],

  /* Run local dev server before starting the tests */
  webServer: {
    command: 'npx serve . -l 3000 --cors --no-clipboard',
    port: 3000,
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
  },

  /* Output directory for test artifacts */
  outputDir: 'test-results/artifacts',
});
