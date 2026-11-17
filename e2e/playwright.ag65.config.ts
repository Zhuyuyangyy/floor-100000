import { defineConfig, devices } from '@playwright/test';
import base from '../playwright.config';

// AG-65（楼层几何：长度不一 / 梯口随机 / 洞与中梯 / NPC 散步）实测探针 config：
// 独占端口 5465。同 AG-51 的理由——5199 上可能有别的 worktree 的活 dev server，
// reuseExistingServer 会静默复用，整轮 e2e 静默测错代码。
//
// 用法：npx playwright test --config=e2e/playwright.ag65.config.ts --workers=1

export default defineConfig({
  ...base,
  testDir: '.',
  // 默认只跑本任务的探针；存量回归（stairNavigation/firstChapter/survival/
  // npc/gameplay）用 CLI 文件名过滤跑，端口仍锁 5465——5199 在本环境被系统
  // 代理挡成 502，默认 config 的 reuseExistingServer 会把它当成「有服务」静默
  // 复用，整轮测错代码。
  testMatch: /.+\.spec\.ts/,
  outputDir: 'test-results/ag65',
  globalSetup: './verifyServerIdentity.ts',
  use: {
    ...base.use,
    baseURL: 'http://localhost:5465',
    // 视觉证据是显式 page.screenshot（落 output/ag65/）；trace 的 screencast
    // 每轮在 test-results 里堆几百个文件，下一轮启动时的整体清空会撞上批量
    // 删除守卫。失败信息有 line reporter 的断言输出就够定位。
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev -- --port 5465 --strictPort',
    url: 'http://localhost:5465',
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
        baseURL: 'http://localhost:5465',
      },
    },
  ],
});
