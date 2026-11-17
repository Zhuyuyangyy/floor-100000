import { defineConfig, devices } from '@playwright/test';
import base from '../playwright.config';

// AG-64（入夜二选一 + NPC 偷东西）实测探针 config：独占端口 5464。
//
// 为什么不用默认的 5199：5199 上可能有总控/其它 worktree 的活 dev server，
// 而 reuseExistingServer 会静默复用任何应答的服务——整轮 e2e 会静默测错
// 分支的代码。独占一个没人用的端口把这个风险整体消除；verifyServerIdentity
// 的 REPO_ROOT 按本文件位置（e2e/..）推算，仍指向本 worktree 根。
//
// 用法：npx playwright test --config=e2e/playwright.ag64.config.ts --workers=1

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'ag64-night-choice.spec.ts',
  // 落在 OS 临时目录：safe-delete 守卫对临时根放行（shouldBypassSafeDelete），
  // Playwright 每轮启动时清 outputDir 不会再去撞回收站二进制（本环境它 5s 超时）。
  // 视觉证据另走 page.screenshot 落 output/ag64/，与 test-results 无关。
  outputDir: 'C:/Users/联想/AppData/Local/Temp/ag64-test-results',
  globalSetup: './verifyServerIdentity.ts',
  use: {
    ...base.use,
    baseURL: 'http://localhost:5464',
    // 视觉证据是显式 page.screenshot（落 output/ag64/）；trace 的 screencast
    // 每轮在 test-results 里堆几百个文件，下一轮启动时的整体清空会撞上批量
    // 删除守卫。失败信息有 line reporter 的断言输出就够定位。
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev -- --port 5464 --strictPort',
    url: 'http://localhost:5464',
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
        baseURL: 'http://localhost:5464',
      },
    },
  ],
});
