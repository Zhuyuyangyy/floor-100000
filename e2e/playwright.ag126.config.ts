import { defineConfig, devices } from '@playwright/test';
import base from '../playwright.config';

// AG-126（tier2+ 阻碍物可达性）e2e config：独占端口 5241。
// 模板同 e2e/playwright.ag66.config.ts——独占端口防 reuseExistingServer
// 静默测错分支；verifyServerIdentity 按本文件位置推算 REPO_ROOT 仍指向本坞。
//
// 用法：npx playwright test --config=e2e/playwright.ag126.config.ts --workers=1

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'ag126-tier2-reachability.spec.ts',
  outputDir: 'test-results/ag126',
  globalSetup: './verifyServerIdentity.ts',
  use: {
    ...base.use,
    baseURL: 'http://localhost:5241',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev -- --port 5241 --strictPort',
    url: 'http://localhost:5241',
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
        baseURL: 'http://localhost:5241',
        launchOptions: { args: ['--no-proxy-server'] },
      },
    },
  ],
});