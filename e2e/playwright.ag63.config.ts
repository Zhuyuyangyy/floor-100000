import { defineConfig, devices } from '@playwright/test';
import base from '../playwright.config';

// AG-63（战斗 HUD + 左下角攻击提示 + debuff 绿光提示）专用 config：整体继承
// 主 config，只把 dev server 与 baseURL 挪到 5463，并按 AG-44 的先例把
// outputDir 独立到 test-results/ag63——Playwright 每次启动会整体清空默认
// test-results/，那个目录里可能有其它 Agent 的失败痕迹（批量删除守卫）。
// 本 config 只清自己那一份；trace/screenshot/video 全关，视觉证据是显式
// page.screenshot（落 output/ag63/）。
//
// 用法：npx playwright test --config=e2e/playwright.ag63.config.ts --workers=1

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'ag63-combat-hud.spec.ts',
  outputDir: 'test-results/ag63',
  globalSetup: './verifyServerIdentity.ts',
  use: {
    ...base.use,
    baseURL: 'http://localhost:5463',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev -- --port 5463 --strictPort',
    url: 'http://localhost:5463',
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
        baseURL: 'http://localhost:5463',
      },
    },
  ],
});
