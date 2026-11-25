import { defineConfig, devices } from '@playwright/test';

// A3 视觉审查专用配置。
//
// 目的：给「美术与 UI 产品负责人」一份可重复的真实截图取证，不参与任何功能断言。
// 与 playwright.config.ts 的区别：
//   1. testDir 是 ./e2e-audit，只跑审查脚本，不跑功能 spec；
//   2. 自带 webServer，跑在一个专用端口（默认 5731），不复用 5173 ——
//      仓库里同时有多个 Agent 在跑 E2E，共用端口会互相踢服务；
//   3. workers=1，截图串行，防止同一份游戏实例被并发覆盖。
//
// 用法：
//   npx playwright test -c playwright.audit.config.ts --workers=1
const PORT = Number(process.env.AUDIT_PORT ?? 5731);

export default defineConfig({
  testDir: './e2e-audit',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 150_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'audit',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.CI ? {} : { channel: 'chrome' as const }),
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});