import { defineConfig, devices } from '@playwright/test';
import base from '../playwright.config';

// AG-44（场景接线）专用临时 config：整体继承主 config，只把 dev server
// 与 baseURL 挪到 5441。
//
// 为什么不用默认的 5199：5199 上可能有总控/其它 worktree 的活 dev server，
// 而 reuseExistingServer 会静默复用任何应答的服务——整轮 e2e 会静默测错
// 分支的代码（AG-24 报告 §7.1 的事故）。独占一个没人用的端口（5441）
// 把这个风险整体消除。verifyServerIdentity 的 REPO_ROOT 按本文件位置
// （e2e/..）推算，仍指向本 worktree 根，指纹比对不受影响。
//
// 本文件只改端口，其余（trace 策略、identity guard、viewport、channel）
// 全部继承主 config。
//
// outputDir 单独指到 test-results/ag44：主 config 用默认的 test-results/，
// Playwright 每次启动会整体清空它——那个目录里可能有其它 Agent/轮次的
// 失败痕迹（本次就撞上 281 个文件的批量删除守卫）。独立子目录让本轮只清
// 自己那一份。
//
// 用法：npx playwright test --config=e2e/playwright.ag44.config.ts --workers=1

export default defineConfig({
  ...base,
  testDir: '.',
  // 只跑本工单的探针：testDir '.' 会圈进 e2e/ 下全部 spec（第一轮就
  // 误跑了 126 个测试）。testMatch 按文件名收窄；AG44_SPECS 可临时指定别的
  // spec 做回归（如 font.spec.ts 的画布 containment 断言）而不改回全部。
  testMatch: process.env.AG44_SPECS ? process.env.AG44_SPECS.split(',') : 'ag44-scene-wire.spec.ts',
  outputDir: 'test-results/ag44',
  globalSetup: './verifyServerIdentity.ts',
  use: {
    ...base.use,
    baseURL: 'http://localhost:5441',
    // 关掉 trace 与失败截图：本探针的视觉证据是显式 page.screenshot（落
    // output/ag44/<phase>/），而 trace 的 screencast/resources 每轮在
    // test-results 里堆几百个文件，下一轮启动时的整体清空会撞上批量删除
    // 守卫（已连撞三次）。失败信息有 line reporter 的断言输出就够定位。
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev -- --port 5441 --strictPort',
    url: 'http://localhost:5441',
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
        // 在 project 层也钉一次 baseURL：verifyServerIdentity 读的是
        // config.projects[0].use.baseURL，缺省它会去探 5199。
        baseURL: 'http://localhost:5441',
      },
    },
  ],
});
