import { defineConfig, devices } from '@playwright/test';
import base from '../playwright.config';

// AG-52（容器隐形标签 + 只画本层）专用临时 config：整体继承主 config，
// 只把 dev server 与 baseURL 挪到 5452（没人用的独占端口，规避
// reuseExistingServer 静默复用其它 worktree 服务的事故）。
// 其余（trace 策略、identity guard、viewport、channel）全部继承主 config。
// outputDir 单独指到 test-results/ag52，只清自己那一份。
//
// 用法：npx playwright test --config=e2e/playwright.ag52.config.ts --workers=1
//        AG52_SPECS 可临时指定别的 spec 做存量回归。

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: process.env.AG52_SPECS ? process.env.AG52_SPECS.split(',') : 'ag52-labels-view.spec.ts',
  outputDir: 'test-results/ag52',
  globalSetup: './verifyServerIdentity.ts',
  use: {
    ...base.use,
    baseURL: 'http://localhost:5452',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev -- --port 5452 --strictPort',
    url: 'http://localhost:5452',
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
        baseURL: 'http://localhost:5452',
      },
    },
  ],
});
