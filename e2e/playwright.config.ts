import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a running stack with mock AI providers: either the compose stack
 * (`docker compose up -d --build --wait`) or the local dev servers (`pnpm dev`).
 * E2E_BASE_URL / E2E_API_URL override the web and API URLs.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
