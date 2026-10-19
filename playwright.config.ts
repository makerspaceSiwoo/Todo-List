import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:4322', browserName: 'chromium' },
  webServer: {
    command: 'npm run dev -- --port 4322',
    url: 'http://127.0.0.1:4322',
    reuseExistingServer: false,
    env: { SCHEDULE_DATA_DIR: `.data/test-${Date.now()}`, SCHEDULE_NAMESPACE: 'test' },
  },
});
