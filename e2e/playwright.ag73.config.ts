import { defineConfig, devices } from '@playwright/test';
import base from '../playwright.config';

// AG-73（新手教程）专用 config：继承主 config，dev server 与 baseURL 挪到
// 5473，outputDir 独立到 test-results/ag73。与 AG-71 同款做法。
//
// 用法（先手动起 server 复用）：
//   npm run dev -- --port 5473 --strictPort   （另一个终端）
//   find test-results -type f -delete
//   npx playwright test --config=e2e/playwright.ag73.config.ts --workers=1

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'ag73-tutorial.spec.ts',
  outputDir: 'test-results/ag73',
  globalSetup: './verifyServerIdentity.ts',
  use: {
    ...base.use,
    baseURL: 'http://localhost:5473',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev -- --port 5473 --strictPort',
    url: 'http://localhost:5473',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    cwd: '..',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.CI ? {} : { channel: 'chrome' as const }),
        viewport: { width: 1280, height: 800 },
        baseURL: 'http://localhost:5473',
      },
    },
  ],
});
