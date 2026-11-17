import { defineConfig, devices } from '@playwright/test';
import base from '../playwright.config';

// AG-90（角色动作 GIF 全量接线）专用 config：继承主 config，dev server 与
// baseURL 挪到 5201（本轮指定端口，先 netstat 确认无人占），outputDir 独立
// 到 test-results/ag90。testMatch 走 AG90_SPECS 环境变量，便于逐个 spec 跑。
// 视觉证据走显式 page.screenshot（落 output/ag90/，gitignored）。
//
// 用法：
//   npm run dev -- --port 5201 --strictPort   # 先手动起 server 复用
//   AG90_SPECS=ag90-char-anims.spec.ts npx playwright test --config=e2e/playwright.ag90.config.ts --workers=1

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: process.env.AG90_SPECS ? process.env.AG90_SPECS.split(',') : 'ag90-char-anims.spec.ts',
  outputDir: 'test-results/ag90',
  globalSetup: './verifyServerIdentity.ts',
  use: {
    ...base.use,
    // vite 只绑 IPv6：localhost 会随机 ECONNREFUSED，[::1] 是稳定地址。
    baseURL: 'http://[::1]:5201',
    // 视觉证据走显式 page.screenshot（落 output/ag90/）；trace 的 screencast
    // 每轮在 test-results 里堆文件。
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev -- --port 5201 --strictPort',
    url: 'http://[::1]:5201',
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
        baseURL: 'http://[::1]:5201',
      },
    },
  ],
});
