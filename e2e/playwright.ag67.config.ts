import { defineConfig, devices } from '@playwright/test';
import base from '../playwright.config';

// AG-67（右下角色状态面板 + 角色自言自语）专用 config，按 AG-54/AG-55 的
// 先例写：整体继承主 config，只把 dev server 与 baseURL 挪到 5467（总控分配
// 的独占端口，规避 reuseExistingServer 静默复用其它 worktree 服务的事故；
// verifyServerIdentity 的 REPO_ROOT 按本文件位置（e2e/..）推算，仍指向本
// worktree 根，指纹比对不受影响）。
//
// outputDir 单独指到 test-results/ag67：主 config 用默认的 test-results/，
// Playwright 每次启动会整体清空它——那个目录里可能有其它 Agent/轮次的失败
// 痕迹（批量删除守卫）。独立子目录让本轮只清自己那一份。探针的视觉证据是
// 显式 page.screenshot（落 output/ag67/，gitignored），trace/screenshot/
// video 全关，避免每轮在 test-results 里堆几百个文件。
//
// 用法：npx playwright test --config=e2e/playwright.ag67.config.ts --workers=1

export default defineConfig({
  ...base,
  testDir: '.',
  // 只跑本工单的探针：testDir '.' 会圈进 e2e/ 下全部 spec。
  testMatch: 'ag67-status.spec.ts',
  outputDir: 'test-results/ag67',
  globalSetup: './verifyServerIdentity.ts',
  // 自言自语节流实测要跨 9s 总闸等第二句，单测 60s 宽限。
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
  use: {
    ...base.use,
    baseURL: 'http://localhost:5467',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev -- --port 5467 --strictPort',
    url: 'http://localhost:5467',
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
        baseURL: 'http://localhost:5467',
      },
    },
  ],
});
