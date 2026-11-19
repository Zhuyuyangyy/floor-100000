import { defineConfig, devices } from '@playwright/test';
import base from '../playwright.config';

// AG-127（设置系统全链路 e2e）专用 config：继承主 config，dev server 与
// baseURL 挪到 5242（本 agent 独占端口），outputDir 独立到 test-results/ag127
// （启动清空只清自己那份，不撞批量删除守卫）。testMatch 走 AG127_SPECS 环境
// 变量，便于逐个 spec 跑。
//
// 用法：
//   npx playwright test --config=e2e/playwright.ag127.config.ts --workers=1

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: process.env.AG127_SPECS ? process.env.AG127_SPECS.split(',') : 'ag127-settings-fullchain.spec.ts',
  outputDir: 'test-results/ag127',
  globalSetup: './verifyServerIdentity.ts',
  use: {
    ...base.use,
    baseURL: 'http://localhost:5242',
    // 视觉证据走显式 page.screenshot（落 output/ag127/*.png，gitignore 内）；
    // trace 的 screencast 每轮在 test-results 里堆文件，启动清空会撞批量
    // 删除守卫。
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev -- --port 5242 --strictPort',
    url: 'http://localhost:5242',
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
        baseURL: 'http://localhost:5242',
        launchOptions: {
          // --no-proxy-server：本机代理会拦 localhost dev server 的请求。
          // --autoplay-policy=no-user-gesture-required：让 AudioContext 起播，
          // 增益/总线断言才有真实 WebAudio 状态可测（SFX 解锁仍走真实按键手势）。
          args: ['--no-proxy-server', '--autoplay-policy=no-user-gesture-required'],
        },
      },
    },
  ],
});
