import { defineConfig, devices } from '@playwright/test';

// 「生产形态」验证专用配置。
//
// 与 playwright.config.ts 的区别只有一件事：它跑的是**构建后的 dist**，
// 由 server/npc-proxy.mjs 以「单容器」形态托管，而不是 Vite dev server。
// 这样浏览器里发生的请求才是评委真的会看到的那条链路：
//   dist 里的前端 → 同源 /api/npc/decide → 代理 → 上游模型
//
// 之所以要单独一份配置而不是塞进默认套件：这条用例依赖一个在跑的上游
// （真模型或假上游）。放进默认套件会让 `npm run e2e` 在没起服务时红掉。
//
// 用法：npm run test:live-proxy
//   该脚本会先 `npm run build`（构建必须发生，用例断言的是构建产物），
//   再由本配置托管假上游 + 代理两个服务。

const PROXY_PORT = 7910;
const UPSTREAM_PORT = 7906;

export default defineConfig({
  testDir: './e2e-live',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 90_000,
  use: {
    baseURL: `http://127.0.0.1:${PROXY_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: [
    {
      // 假上游：冒充魔搭 API-Inference，固定回一条合法提案。
      // 有它，这条用例在没有真 Key 的环境里也能跑，且结论可复现。
      command: 'node e2e-live/fake-upstream.mjs',
      url: `http://127.0.0.1:${UPSTREAM_PORT}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { PORT: String(UPSTREAM_PORT) },
    },
    {
      // 真代理 + 真静态资源，就是 Dockerfile 里那个 CMD 跑的东西。
      command: 'node server/npc-proxy.mjs',
      url: `http://127.0.0.1:${PROXY_PORT}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        PORT: String(PROXY_PORT),
        NPC_UPSTREAM_URL: `http://127.0.0.1:${UPSTREAM_PORT}`,
        // 假 Key：用来验证「Key 只在服务端」——它绝不能出现在浏览器请求里。
        NPC_API_KEY: 'sk-live-test-must-not-leak',
        NPC_MODEL_ID: 'pinned-model-xyz',
      },
    },
  ],
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