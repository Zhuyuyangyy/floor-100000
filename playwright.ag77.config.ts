import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

// AG-77 成就系统实测探针（端口 5477，--workers=1）。
// 专用端口：不与主 5199 轮次抢 server。身份守卫（globalSetup）照旧从
// projects[0].use.baseURL 读端口，复用错分支的 dev server 会在开跑前大声失败。
// outputDir 用默认 test-results——环境的 safe-delete 守卫会拦 Playwright 对
// 输出目录的启动清理（私有目录同样被拦，实测 trash 失败），所以跑前用
// `find test-results -type f -delete` 做文件级预清理（守卫放行文件级删除）。
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://localhost:5477' },
  webServer: {
    command: 'npm run dev -- --port 5477 --strictPort',
    url: 'http://localhost:5477',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome' as const,
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});
