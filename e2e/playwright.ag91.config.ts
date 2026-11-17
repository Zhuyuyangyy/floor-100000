import { defineConfig, devices } from '@playwright/test';
import base from '../playwright.config';

// AG-91（战斗 juice 层）专用 config：继承主 config，dev server 与 baseURL
// 挪到 5202（netstat 确认无人占用；--force 允许 Vite 忽略缓存提示），
// outputDir 独立到 test-results/ag91。视觉证据走显式 page.screenshot，
// 落仓库外 /d/ZYY_Inovation/game/tmp/qa-evidence/juice/（不进版本库）。
// trace/video 全关—— screencast 每轮在 test-results 里堆文件。
//
// 用法：
//   find test-results -type f -delete
//   npm run dev -- --port 5202 --force --strictPort   # 先手动起 server 复用
//   AG91_SPECS=ag91-juice.spec.ts npx playwright test --config=e2e/playwright.ag91.config.ts --workers=1

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: process.env.AG91_SPECS ? process.env.AG91_SPECS.split(',') : 'ag91-juice.spec.ts',
  outputDir: 'test-results/ag91',
  globalSetup: './verifyServerIdentity.ts',
  use: {
    ...base.use,
    baseURL: 'http://[::1]:5202',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev -- --port 5202 --force --strictPort',
    url: 'http://[::1]:5202',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // 主 config 的 webServer 以仓库根为 cwd；本 config 在 e2e/ 下，
    // 必须显式指回仓库根，否则 npm run dev 找不到 package.json。
    cwd: '..',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.CI ? {} : { channel: 'chrome' as const }),
        viewport: { width: 1280, height: 800 },
        baseURL: 'http://[::1]:5202',
      },
    },
  ],
});
