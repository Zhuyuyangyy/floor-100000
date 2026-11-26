import { defineConfig, devices } from '@playwright/test';

// 「线上公开地址」冒烟专用配置。
//
// 与 playwright.config.ts / playwright.live.config.ts 的区别只有一件事：
// 它**不起任何本地服务**，直接打线上的公开地址。
//
//   playwright.config.ts        → 本地 Vite dev server（开发期）
//   playwright.live.config.ts   → 本地构建产物 + 本地代理 + 假上游（可复现的链路验收）
//   playwright.public.config.ts → 线上公开地址（评委视角：新设备能不能直接玩）
//
// 为什么单独一份而不是复用 live 那份：live 的用例断言「上游收到什么」，
// 它依赖本机那个假上游的日志文件；打线上时那些断言的前提不存在。
// 硬套会得到一堆「装置坏了」的假红，而不是真结论。
//
// 用法：
//   PUBLIC_BASE=https://<ns>-<name>.ms.show npx playwright test -c playwright.public.config.ts
// 不设 PUBLIC_BASE 时，用例整体 skip —— 线上空间临时不可用不该让 CI 红，
// 但「没跑过」也不能被写成「跑过且通过」。
const BASE = process.env.PUBLIC_BASE ?? 'http://127.0.0.1:1';

export default defineConfig({
  testDir: './e2e-public',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 120_000,
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.CI ? {} : { channel: 'chrome' as const }),
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});
