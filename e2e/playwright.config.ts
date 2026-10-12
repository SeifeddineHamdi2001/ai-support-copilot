import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the full compose stack (mock AI providers).
 * Start it first: `docker compose up -d --build --wait`. Flows are added in Phase 8.
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
