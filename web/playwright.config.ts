/**
 * End-to-end configuration.
 *
 * Two servers, both real: the FastAPI app against a real Postgres carrying real
 * migrations, and the shipped React bundle built by Vite. Only the Firebase Auth SDK is
 * stubbed (see e2e/firebase-stub.ts) - there is no way to obtain a genuine ID token in
 * CI, and faking one would mean weakening src/auth.py.
 *
 * The suite drives the real app, so it writes real rows. It gets its own database -
 * DATABASE_URL's name with `_e2e` appended, created and migrated by tests/e2e/prepare.py -
 * because sharing the development one makes the next `pytest` run fail on store-wide
 * aggregates that now include browser-test data.
 */
import { defineConfig, devices } from '@playwright/test'

const API_PORT = 8001
// Deliberately not 5173/5174: those are Vite's defaults and collide with a dev server
// somebody left running, which fails the suite for a reason that has nothing to do with it.
const WEB_PORT = 5273
const API_URL = `http://127.0.0.1:${API_PORT}`
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`

export default defineConfig({
  testDir: './e2e',
  // Shared database, and several specs assert on store-wide figures. Running them in
  // parallel would have them reading each other's writes.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      // prepare.py creates and migrates the throwaway database; server.py resolves the
      // same URL itself before importing the app, so no shell interpolation is involved
      // and this works the same on Windows and Linux.
      command:
        'uv run python -m tests.e2e.prepare && ' +
        `uv run uvicorn tests.e2e.server:app --host 127.0.0.1 --port ${API_PORT}`,
      cwd: '..',
      url: `${API_URL}/health`,
      // Never reuse. A server left running from an earlier run may be pointed at the
      // development database, and Playwright's readiness probe cannot tell - it just
      // finds something answering on the port and carries on. That silently put e2e rows
      // in the dev database and broke the backend suite.
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 120_000,
      env: {
        ...process.env,
        // Overrides whatever a developer's .env says. Environment wins over .env in
        // pydantic-settings, so a real allowlist or the production CORS list cannot leak
        // in and fail the suite for reasons unrelated to the code under test.
        APP_ENV: 'test',
        ALLOWED_MEMBER_EMAILS: '',
        ALLOWED_ORIGINS: WEB_URL,
        ALLOWED_ORIGIN_REGEX: '',
        SENTRY_DSN: '',
      },
    },
    {
      // --host is load-bearing: without it Vite binds "localhost", which on Windows
      // resolves to ::1 only, and the 127.0.0.1 readiness probe below never answers.
      command: `npx vite --config vite.e2e.config.ts --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      // Never reuse. A server left running from an earlier run may be pointed at the
      // development database, and Playwright's readiness probe cannot tell - it just
      // finds something answering on the port and carries on. That silently put e2e rows
      // in the dev database and broke the backend suite.
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_API_URL: API_URL,
        // The stub ignores these, but config.ts validates that they are present, and that
        // validation is part of what the suite exercises.
        VITE_FIREBASE_API_KEY: 'e2e',
        VITE_FIREBASE_AUTH_DOMAIN: 'e2e.firebaseapp.com',
        VITE_FIREBASE_PROJECT_ID: 'e2e',
        VITE_SENTRY_DSN: '',
      },
    },
  ],
})
