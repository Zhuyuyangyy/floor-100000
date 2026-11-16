import { defineConfig, devices } from '@playwright/test';
import base from '../playwright.config';

// AG-55（跑动画）专用 config：整体继承主 config，只把 dev server 与 baseURL
// 挪到 5455。为什么不用默认的 5199：5199 上可能有总控/其它 worktree 的活
// dev server，reuseExistingServer 会静默复用任何应答的服务——整轮 e2e 会
// 静默测错分支的代码（AG-44 config 注释里记着同一事故）。独占一个没人用的
// 端口把这个风险整体消除；verifyServerIdentity 的 REPO_ROOT 按本文件位置
// （e2e/..）推算，仍指向本 worktree 根，指纹比对不受影响。
//
// outputDir 单独指到 test-results/ag55：主 config 用默认的 test-results/，
// Playwright 每次启动会整体清空它——那个目录里可能有其它 Agent/轮次的失败
// 痕迹（批量删除守卫）。独立子目录让本轮只清自己那一份。探针的视觉证据是
// 显式 page.screenshot（落 output/ag55/，gitignored），trace/screenshot/video
// 全关，避免每轮在 test-results 里堆几百个文件。
//
// 用法：npx playwright test --config=e2e/playwright.ag55.config.ts --workers=1

export default defineConfig({
  ...base,
  testDir: '.',
  // 只跑本工单的探针：testDir '.' 会圈进 e2e/ 下全部 spec。
  testMatch: process.env.AG55_SPECS ? process.env.AG55_SPECS.split(',') : 'runAnim.spec.ts',
  outputDir: 'test-results/ag55',
  globalSetup: './verifyServerIdentity.ts',
  use: {
    ...base.use,
    baseURL: 'http://localhost:5455',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev -- --port 5455 --strictPort',
    url: 'http://localhost:5455',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // 主 config 的 webServer 以仓库根为 cwd；本 config 在 e2e/ 下，必须显式
    // 指回仓库根，否则 npm run dev 找不到 package.json。
    cwd: '..',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.CI ? {} : { channel: 'chrome' as const }),
        viewport: { width: 1280, height: 800 },
        // 在 project 层也钉一次 baseURL：verifyServerIdentity 读的是
        // config.projects[0].use.baseURL，缺省它会去探 5199。
        baseURL: 'http://localhost:5455',
      },
    },
  ],
});
