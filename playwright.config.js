import { defineConfig } from '@playwright/test';

// Run through `npm run test:e2e`, which starts the Auth + Firestore emulators first.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5055', browserName: 'chromium', viewport: { width: 1360, height: 900 }, trace: 'retain-on-failure' },
  webServer: { command: 'node tests/serve.mjs 5055', url: 'http://127.0.0.1:5055', reuseExistingServer: true }
});
