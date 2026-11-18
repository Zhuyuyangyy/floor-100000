import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// 核心冒烟门禁（阻断级）——RC-01 E2E 复判外部审查第 3 项
// 「将稳定的核心冒烟测试设为阻断门禁」的落地。
//
// 两级门禁设计：
//   · 全量 213 test 的 E2E 仍是观测项（.github/workflows/ci.yml 的 e2e job，
//     continue-on-error 不动）——驱动真实 Phaser 帧循环的剩余抖动不拦合并；
//   · 本 config 圈出的 12 个核心冒烟 spec 由 smoke-e2e job 单独跑，失败即红 CI。
//
// 为什么圈这 12 个：RC-01 E2E 复判 3 轮稳定性实证（repeat3-4，12 spec /
// 38 test / 114 runs），37 个 test 3/3 全绿；唯一 N/3 的 ag70③「敌人反击」
// 帧时序已阈值稳定化（前冲断言 8px→4px，见 e2e/ag70-combat-stage.spec.ts ③
// 的注释与权威状态佐证），12 个 spec 达到整 spec 可阻断的稳定性。
// 逐 spec 理由：tmp/qa-evidence/rc01-e2e/REPORT.md §4。
//
// 为什么是独立 config 而不是改主 config：主 config 服务全量观测 job，冒烟集
// 与它只差一个 testMatch；本文件 import 并展开主 config（仓库既有惯例，见
// playwright.hud/qa/ag77 config），trace 策略、globalSetup 身份守卫、
// viewport、worker 语义全部继承——零重复维护，主 config 的任何调整自动生效，
// 也不会因为「两处配置漂移」重演 BUG-QA-03/05 类事故。
//
// 专用端口 5236（而非主 config 的 5199）：与观测 job 的 dev server 隔离，
// 同时避开多 agent 并行 worktree 抢 5199 的老问题（BUG-QA-05 同源类；
// 主 config 注释里 5199 的由来与此同源）。

/** 12 个核心冒烟 spec（RC-01 §4 逐 spec 论证过稳定性）。 */
const SMOKE_SPECS = [
  'smoke.spec.ts',
  'gameplay.spec.ts',
  'survivalJourney.spec.ts',
  'ag63-combat-hud.spec.ts',
  'ag70-combat-stage.spec.ts',
  'ag74-audio.spec.ts',
  'ag90-char-anims.spec.ts',
  'ag91-juice.spec.ts',
  'combat.spec.ts',
  'crafting.spec.ts',
  'diary.spec.ts',
  'integration.spec.ts',
];

const SMOKE_PORT = 5236;
const SMOKE_BASE_URL = `http://localhost:${SMOKE_PORT}`;

export default defineConfig({
  ...base,
  // 只跑冒烟集：$ 锚定文件名，匹配与目录前缀无关；冒烟集增删只改 SMOKE_SPECS。
  // （Playwright testMatch 支持 RegExp；main config 未设 testMatch，此处为纯新增，
  //  全量 job 走主 config 不受影响。）
  testMatch: SMOKE_SPECS.map((f) => new RegExp(`${f.replace(/\./g, '\\.')}$`)),
  use: {
    ...base.use,
    baseURL: SMOKE_BASE_URL,
    // 本机 http_proxy=127.0.0.1:60725 一类代理会把 localhost 请求劫去代理，
    // 本地 Chrome 显式直连；CI 无代理不加（与主 config 的 channel 切换同款写法）。
    ...(process.env.CI ? {} : { launchOptions: { args: ['--no-proxy-server'] } }),
  },
  webServer: {
    // reuseExistingServer/timeout 继承主 config：本地手动起的 5236 dev server
    // 会被复用（netstat 预检 + 身份守卫保证服务的就是本 worktree 的代码），
    // CI 上则由 Playwright 自己拉一个。
    ...base.webServer,
    command: `npm run dev -- --port ${SMOKE_PORT} --strictPort`,
    url: SMOKE_BASE_URL,
  },
});
