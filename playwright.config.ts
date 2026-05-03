import { defineConfig, devices } from '@playwright/test';

/**
 * VOYO Music — Playwright smoke test config.
 *
 * Tests run against the Vite dev server (port 5173).
 * The webServer block auto-starts it if not already running.
 *
 * Run:  npx playwright test --project=pixel7 --reporter=line
 * Debug: npx playwright test --headed
 * One test: npx playwright test -g "cold boot"
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  reporter: [['line'], ['json', { outputFile: 'e2e/results/latest.json' }]],

  use: {
    baseURL: 'http://localhost:5173',
    // Mobile-first — VOYO is a PWA, primary target is Pixel 7 (Dash's device)
    ...devices['Pixel 7'],
    // Headless by default; set PWDEBUG=1 or headless:false for visual
    headless: true,
    // Record video on first retry so failures are inspectable
    video: 'on-first-retry',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'pixel7',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Auto-start VOYO dev server before tests, tear down after.
  // reuseExistingServer: skip restart if already running on 5173.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
