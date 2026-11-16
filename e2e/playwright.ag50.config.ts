import { defineConfig, devices } from '@playwright/test';
import base from '../playwright.config';

// AG-50（鼠标/触屏操控 + 爬梯交互侧）专用临时 config：整体继承主 config，
// 只把 dev server 与 baseURL 挪到 5450。
//
// 为什么不用默认的 5199：5199 上可能有总控/其它 worktree 的活 dev server，
// 而 reuseExistingServer 会静默复用任何应答的服务——整轮 e2e 会静默测错
// 分支的代码。独占一个没人用的端口（5450）把这个风险整体消除。
// verifyServerIdentity 的 REPO_ROOT 按本文件位置（e2e/..）推算，仍指向本
// worktree 根，指纹比对不受影响。
//
// outputDir 每轮一个唯一子目录：Playwright 启动时会整体清空 outputDir，
// 而本机 safe-delete shim 对已存在目录的删除会超时（genie-trash ETIMEDOUT，
// 连撞三次）。唯一目录名让每轮都落在全新路径上，启动时无目录可清。
// test-results/ 在 .gitignore 里，残留不污染提交。
//
// 用法：npx playwright test --config=e2e/playwright.ag50.config.ts --workers=1
// 本文件只改端口与产物目录，跑完即删，不提交。

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: process.env.AG50_SPECS ? process.env.AG50_SPECS.split(',') : '*.spec.ts',
  outputDir: `test-results/ag50-${Date.now()}`,
  globalSetup: './verifyServerIdentity.ts',
  use: {
    ...base.use,
    baseURL: 'http://localhost:5450',
  },
  webServer: {
    command: 'npm run dev -- --port 5450 --strictPort',
    url: 'http://localhost:5450',
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
        baseURL: 'http://localhost:5450',
      },
    },
  ],
});
