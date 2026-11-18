import { defineConfig, devices } from '@playwright/test';
import base from '../playwright.config';

// RC-03 拆分第 9 步（HudController）专用冻结探针 config：端口 5258
// （netstat 预检无人占用；--force 允许 Vite 忽略缓存提示），outputDir 独立
// 到 test-results/step9。视觉证据走显式 page.screenshot，落仓库外
// /d/ZYY_Inovation/game/tmp/qa-evidence/split-step9/（不进版本库）。
// trace/video 全关。用法：
//   npm run dev -- --port 5258 --force --strictPort   # 先手动起 server 复用
//   STEP9_SPECS=split-step9-freeze.spec.ts npx playwright test \
//     --config=e2e/playwright.step9.config.ts --workers=1
// 迁前基线：dd282d0 的 baseline worktree 起 5259，同 spec 同 STEP9_TAG。

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: process.env.STEP9_SPECS ? process.env.STEP9_SPECS.split(',') : 'split-step9-freeze.spec.ts',
  outputDir: 'test-results/step9',
  globalSetup: './verifyServerIdentity.ts',
  use: {
    ...base.use,
    baseURL: 'http://[::1]:5258',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev -- --port 5258 --force --strictPort',
    url: 'http://[::1]:5258',
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
        baseURL: 'http://[::1]:5258',
      },
    },
  ],
});
