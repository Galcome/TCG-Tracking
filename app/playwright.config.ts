import { defineConfig } from '@playwright/test';
const api = 'http://127.0.0.1:8101';
const web = 'http://127.0.0.1:5373';
export default defineConfig({
  testDir: './e2e', workers: 1, fullyParallel: false, forbidOnly: Boolean(process.env.CI),
  timeout: 45000, expect: { timeout: 15000 },
  use: { baseURL: web, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [
    { command: 'uv run python -m tests.e2e.prepare && uv run uvicorn tests.e2e.server:app --host 127.0.0.1 --port 8101 --no-access-log',
      cwd: '..', url: api + '/health', reuseExistingServer: false, timeout: 120000,
      env: { APP_ENV:'test', APP_ROLE:'test', FIREBASE_PROJECT_ID:'test-firebase-project',
        ALLOWED_MEMBER_EMAILS:'', ALLOWED_ORIGINS:web, ALLOWED_ORIGIN_REGEX:'', SENTRY_DSN:'' } },
    { command:'npx expo export --platform web --output-dir dist --clear --max-workers 2 && uv run --project .. python ../tests/e2e/expo_static.py',
      cwd: '.', url:web, reuseExistingServer:false, timeout:180000,
      env:{ EXPO_PUBLIC_API_URL:api, EXPO_PUBLIC_FIREBASE_API_KEY:'e2e-public-placeholder',
        EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN:'test-firebase-project.firebaseapp.com',
        EXPO_PUBLIC_FIREBASE_PROJECT_ID:'test-firebase-project', CI:'1' } },
  ],
});
