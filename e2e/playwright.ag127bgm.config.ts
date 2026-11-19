import { defineConfig, devices } from '@playwright/test';
import base from '../playwright.config';

// BUG-AG127-01 回归守卫 config：标题屏 BGM 即时生效。独占端口 5246。
// 模板同 e2e/playwright.ag66.config.ts。
// 用法：npx playwright test --config=e2e/playwright.ag127bgm.config.ts --workers=1

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'ag127-title-bgm.spec.ts',
  outputDir: 'test-results/ag127bgm',
  globalSetup: './verifyServerIdentity.ts',
  use: {
    ...base.use,
    baseURL: 'http://localhost:5246',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev -- --port 5246 --strictPort',
    url: 'http://localhost:5246',
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
        baseURL: 'http://localhost:5246',
        launchOptions: { args: ['--no-proxy-server', '--autoplay-policy=no-user-gesture-required'] },
      },
    },
  ],
});