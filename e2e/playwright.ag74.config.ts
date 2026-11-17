import { defineConfig, devices } from '@playwright/test';
import base from '../playwright.config';

// AG-74（BGM 音乐层 + 音效扩展）专用 config：继承主 config，dev server 与
// baseURL 挪到 5474，outputDir 独立到 test-results/ag74（启动清空只清自己
// 那份，不撞批量删除守卫）。testMatch 走 AG74_SPECS 环境变量，便于逐个跑。
//
// 用法：
//   find test-results -type f -delete
//   AG74_SPECS=ag74-audio.spec.ts npx playwright test --config=e2e/playwright.ag74.config.ts --workers=1

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: process.env.AG74_SPECS ? process.env.AG74_SPECS.split(',') : 'ag74-audio.spec.ts',
  outputDir: 'test-results/ag74',
  globalSetup: './verifyServerIdentity.ts',
  use: {
    ...base.use,
    baseURL: 'http://localhost:5474',
    // 视觉证据走显式 page.screenshot；trace 的 screencast 每轮在
    // test-results 里堆文件，启动清空会撞批量删除守卫。
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev -- --port 5474 --strictPort',
    url: 'http://localhost:5474',
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
        baseURL: 'http://localhost:5474',
        // Playwright 默认给 Chromium 加 --autoplay-policy=no-user-gesture-
        // required。显式要回真实浏览器的默认策略——注意本机安装的 Chrome
        // (channel chrome) 实测忽略该 flag 且 Playwright 预激活页面，所以
        // spec 的"手势前"断言看的是意图（pending/track）而非 suspended 态。
        launchOptions: { args: ['--autoplay-policy=user-gesture-required'] },
      },
    },
  ],
});
