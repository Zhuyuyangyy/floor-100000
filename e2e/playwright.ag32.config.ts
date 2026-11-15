import { defineConfig, devices } from '@playwright/test';
import base from '../playwright.config';

// AG-32（TWOM 对齐 e2e）专用临时 config：整体继承主 config，只把 dev
// server 与 baseURL 挪到 5420。
//
// 为什么不用默认的 5199：5199 上可能有总控/其它 worktree 的活 dev server，
// 而 reuseExistingServer 会静默复用任何应答的服务——整轮 e2e 会静默测错
// 分支的代码（AG-24 报告 §7.1 的事故）。verifyServerIdentity 只在
// globalSetup 那一刻探测端口，之后到 webServer 启动之间有个抢驻窄窗，
// 独占一个没人用的端口（5420）把这个风险整体消除。
//
// 本文件只改端口，其余（trace 策略、identity guard、viewport、channel）
// 全部继承主 config。verifyServerIdentity 的 REPO_ROOT 按本文件位置
// （e2e/..）推算，仍指向本 worktree 根，指纹比对不受影响。
//
// 用法：npx playwright test --config=e2e/playwright.ag32.config.ts --workers=1

export default defineConfig({
  ...base,
  testDir: '.',
  globalSetup: './verifyServerIdentity.ts',
  use: {
    ...base.use,
    baseURL: 'http://localhost:5420',
  },
  webServer: {
    command: 'npm run dev -- --port 5420 --strictPort',
    url: 'http://localhost:5420',
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
        baseURL: 'http://localhost:5420',
      },
    },
  ],
});
