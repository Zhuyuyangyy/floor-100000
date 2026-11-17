import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// AG-67 的专用轮次：右下角色状态面板 + 角色自言自语的实测。
// 端口 5467（总控分配），与其它 agent 的轮次端口互不抢占；
// reuseExistingServer: true —— 先手动起一个 5467 的 dev server 复用，
// 身份仍由 globalSetup 的 verifyServerIdentity 指纹核对（本 worktree 的
// 服务才通得过）。
export default defineConfig({
  ...base,
  // 自言自语节流实测要跨 9s 总闸等第二句，单测 60s 宽限。
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
  use: { ...base.use, baseURL: 'http://localhost:5467' },
  webServer: {
    command: 'npm run dev -- --port 5467 --strictPort',
    url: 'http://localhost:5467',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
