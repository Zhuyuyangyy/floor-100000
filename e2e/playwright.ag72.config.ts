import { defineConfig, devices } from '@playwright/test';
import base from '../playwright.config';

// AG-72（设置系统）专用 config：继承主 config，dev server 与 baseURL 挪到
// 5472（派工单约定；5471 是 AG-71 的导航条），outputDir 独立到
// test-results/ag72（启动清空只清自己那份，不撞批量删除守卫）。
// testMatch 走 AG72_SPECS 环境变量，便于逐个 spec 跑。
//
// 用法：
//   find test-results -type f -delete
//   AG72_SPECS=ag72-settings.spec.ts npx playwright test --config=e2e/playwright.ag72.config.ts --workers=1

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: process.env.AG72_SPECS ? process.env.AG72_SPECS.split(',') : 'ag72-settings.spec.ts',
  outputDir: 'test-results/ag72',
  globalSetup: './verifyServerIdentity.ts',
  use: {
    ...base.use,
    baseURL: 'http://localhost:5472',
    // 视觉证据走显式 page.screenshot（落 e2e/screenshots/ag72-*.png）；
    // trace 的 screencast 每轮在 test-results 里堆文件，启动清空会撞批量
    // 删除守卫。
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev -- --port 5472 --strictPort',
    url: 'http://localhost:5472',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // 主 config 的 webServer 以仓库根为 cwd；本 config 在 e2e/ 下，
    // 必须显式指回仓库根，否则 npm run dev 找不到 package.json。
    cwd: '..',
  },
  workers: 1,
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.CI ? {} : { channel: 'chrome' as const }),
        viewport: { width: 1280, height: 800 },
        baseURL: 'http://localhost:5472',
      },
    },
  ],
});
