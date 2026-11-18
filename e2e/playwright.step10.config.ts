import { defineConfig, devices } from '@playwright/test';
import base from '../playwright.config';

// RC-03 拆分第 10 步（InteractionController）专用冻结探针 config：端口取
// STEP10_PORT（默认 5259；迁前基线 worktree 用 5260——同 spec 同 tag 跑两遍
// 做像素 diff）。netstat 预检无人占用；--force 允许 Vite 忽略缓存提示，
// outputDir 独立到 test-results/step10。视觉证据走显式 page.screenshot，落
// 仓库外 /d/ZYY_Inovation/game/tmp/qa-evidence/split-step10/（不进版本库）。
// trace/video 全关。用法：
//   npm run dev -- --port 5259 --force --strictPort   # 先手动起 server 复用
//   STEP10_SPECS=split-step10-freeze.spec.ts npx playwright test \
//     --config=e2e/playwright.step10.config.ts --workers=1
// 迁前基线：cccef3c 的 baseline worktree 起 5260，同 spec 同 STEP10_TAG。

const PORT = process.env.STEP10_PORT ?? '5259';

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: process.env.STEP10_SPECS ? process.env.STEP10_SPECS.split(',') : 'split-step10-freeze.spec.ts',
  outputDir: 'test-results/step10',
  globalSetup: './verifyServerIdentity.ts',
  use: {
    ...base.use,
    baseURL: `http://[::1]:${PORT}`,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --force --strictPort`,
    url: `http://[::1]:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    cwd: '..',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.CI ? {} : { channel: 'chrome' as const }),
        viewport: { width: 1280, height: 800 },
        baseURL: `http://[::1]:${PORT}`,
      },
    },
  ],
});
