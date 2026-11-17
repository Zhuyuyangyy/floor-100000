import { defineConfig, devices } from '@playwright/test';
import base from '../playwright.config';

// AG-71（HUD 底部导航条）专用 config：继承主 config，dev server 与 baseURL
// 挪到 5471，outputDir 独立到 test-results/ag71（启动清空只清自己那份，
// 不撞批量删除守卫）。testMatch 走 AG71_SPECS 环境变量，便于逐个 spec 跑。
//
// 用法：
//   find test-results -type f -delete
//   AG71_SPECS=hudNav.spec.ts npx playwright test --config=e2e/playwright.ag71.config.ts --workers=1

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: process.env.AG71_SPECS ? process.env.AG71_SPECS.split(',') : 'ag71-hud-nav.spec.ts',
  outputDir: 'test-results/ag71',
  globalSetup: './verifyServerIdentity.ts',
  use: {
    ...base.use,
    baseURL: 'http://localhost:5471',
    // 视觉证据走显式 page.screenshot（落 output/ag71/）；trace 的 screencast
    // 每轮在 test-results 里堆文件，启动清空会撞批量删除守卫。
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev -- --port 5471 --strictPort',
    url: 'http://localhost:5471',
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
        baseURL: 'http://localhost:5471',
      },
    },
  ],
});
