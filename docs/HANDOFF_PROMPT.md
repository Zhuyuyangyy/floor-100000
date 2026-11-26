# 交接提示词：《第100000层：末日宿舍》R3 收尾

> 用途：把这份文件的全文贴给新的 Agent，它就能接手所有未完成事项。
> 写于 2026-11-26。`wt-r2` 工作区已全部提交推送，与 `origin/deploy-ms-20261125`
> 同在 `b1395a5`，领先 0 / 落后 0，工作区（含未跟踪文件）全干净。

---

## 你现在接手的项目

《第100000层：末日宿舍 / Floor 100000》，Phaser 4 + TypeScript strict + Vite
的末日居民社会模拟游戏。参赛方向是「AI 驱动的末日居民社会模拟」。

- 工作目录：`/d/ZYY_Inovation/game/wt-r2`（Git Bash；Windows）
- 分支：`deploy-ms-20261125`，已与远端同步
- 线上 API：`https://studio-a1578804454-floor-100000.api-inference.modelscope.net`
- 参赛检查表：`docs/COMPETITION_SUBMISSION_CHECKLIST.md`
- 验收说明：`artifacts/online-verify/README.md`

### 开局先做这三件事

1. `git rev-parse --show-toplevel && git branch --show-current && git status --porcelain`
   确认仓库根、分支、干净工作区。
2. `npx tsc --noEmit && npx vitest run && npm run build && npm run test:collection`
   基线应为：tsc 0 错；1203 passed / 6 skipped / 1209 项 / 86 文件；build 0；收集门禁 OK。
3. `md5sum artifacts/online-verify/api-verify.json`
   应为 `cb827d5a957974ea382672f07469c804`。**这份是唯一入库的线上真证据，任何操作都不能覆盖它。**

### 已经做完、不要重做的

- 四个审查问题（CI 真失败 / 模型行动未接线 / 关键词语义错 / 结构化记忆丢失）已全部修复。
- 名场面 B（失败后改变计划）、C（居民资源协作）有本地证据链；阿珍负向记忆已落地为 2 条正式断言。
- 服务端 `GET /%` 打死进程的 bug 已修（`0914cc1`），9 个畸形载荷全部 403。
- `tools/verify-online-api.mjs` 的 7 条假绿判据、落盘门控、路径穿越判据已全部修完，定版在 `9db9ec8` 之后。
- `recentEvents` 死字段已标注释（不接、不删，理由见 `src/ai/types.ts:66`）。
- `LICENSE` 草稿、`THIRD_PARTY_NOTICES.md`、`docs/npc-sdk-example/` 已入库。

### 硬约束（违反会造成事故）

- **不要**用 `git add -A`。仓库曾有预暂存文件被误提交（`4dcd5e6` 已作废）。只提交指定路径，用 `git commit -- <path>`。
- **不要**在测试里用夹具冒充真实玩家体验，不要用规则 fallback 冒充真实推理。
- **不要**为了凑测试数量加测试；不要在这份验收脚本里再加门控或改判据，它已经冻结。
- **不要**把桩数据（在 `tmp/`，已被 .gitignore）当线上证据。
- 配色遵循中国习惯：涨红跌绿。货币符号用 ¥。

---

## 待办清单（按优先级）

### P0 — 唯一外部阻塞，只有用户本人能做

**把 ModelScope 创空间从 private 改成 public。**

- 现状：`curl https://studio-a1578804454-floor-100000.api-inference.modelscope.net/` → 401；
  `/healthz` → `Authentication failed`；门户 `.ms.show/` → 403。连静态首页都要身份。
- 401 拦在**平台网关**，不是应用层。补 `MS_TOKEN` 不解决——那只证明「持证人能访问」，
  证明不了「评委无需登录能访问」。
- `docs/COMPETITION_SUBMISSION_CHECKLIST.md:12` 早就写着「已部署，仍为 private」。

public 之后，按顺序执行：

1. **先探活**，不过就别跑判据：
   ```bash
   curl -s -o /dev/null -w '%{http_code}' <base>/          # 期望 200
   curl -s <base>/healthz                                  # 期望 ok:true
   ```
   若 `/` 仍 401，说明不是 private 开关的问题（可能是域名解析到门户前端），
   按 SKIP 记账，**不要**写成「产品不合格」。
2. **跑全量**：`MS_TOKEN=<有效令牌> node tools/verify-online-api.mjs`，
   六份产物落到 `output/online-verify/`。
3. **出 8 条记忆判据逐条结果**，连同 `memory-evidence.json` 的三合判据
   (`united.passed`、`polarityGainTotal`、三组 `moved`) 一起给，不包装；某组 `moved:false` 就如实写。
4. **确认路径穿越判据在真服务端落在哪一档**（能 FAIL 还是与基线相同）。
5. **同步进 `artifacts/`**，更新 md5 记录。旧那份标明跑于何时、当时条数，
   不能让两份长得一样躺在仓库里。
6. 提交推送。

### P1 — 用户拍板后立刻可做

**`LICENSE` 定稿。** 当前是 `PENDING OWNER CONFIRMATION`，需版权方决定三件事：

1. 是否采用 MIT，著作权人署名填什么（现在是占位符 `The "第100000层：末日宿舍 / Floor 100000" project authors`）。
2. 美术资源是否排除在 MIT 外（`public/assets/artpack/`、`ui/frame-*.png`、
   `ui/slot.png`、`env/`、`title/`、`weapons/` 由 owner 提供，条款未声明）。
3. 第三方是否各自保留原许可（Phaser MIT / 方舟像素字体 OFL 1.1 / Kenney CC0 / pixelfx MIT）。

**不要替用户填**——填了就是伪造法律声明。`THIRD_PARTY_NOTICES.md` 已把素材查清，那是素材不是结论。

### P2 — 参赛材料可选补强

`docs/BENCHMARK_REPORT.md` 的方法论段可以加一条判断标准，但**不要列举「犯了几次错」**：

> 如果一个结论是靠数代码里某个字符串出现了几次得出的，它只能证明「那个字符串还在」。
> 要证明判据生效、要证明模型被调了几次，只能跑。

建议放一条可复现的假结论，而不是一张同构的表：

```
桩只让限流段那 15 次成功，其余全 503 时，同一屏出现：
PASS  限流前先有成功请求 :: 序列 200×15
目标 …｜本轮 0 次模型回复：token 无效、或平台网关挡住了
```

这条比「我们审出了 N 处证据瑕疵」对评委更有价值。

### P3 — 明确的技术债，本轮不做

| 项 | 现状 | 为什么不动 |
|---|---|---|
| `requestBlackoutHelp(game,'azhen')` 缺幂等守卫 | 连点 5 次信任 46→90，多写 5 条 help 记忆 | 当前无 UI 入口，是潜伏 bug；修要按 npcId 分 `promiseDay` flag，涉及 flag 命名迁移 |
| `weight` 在 Spark 直连链路 | 已修（`00e93f9`），但词表仍只认 5 种 kind，`flee`/`observed` 落兜底「相遇」 | 改词表是语义决策，需产品判断 |
| `recentEvents` 真接线 | 生成 3 处、消费 0 处 | 接上要改 `server/` 白名单并扩大线上验证面，待 public 之后 |
| `dialogue-fit-probe.spec.ts` 补 360x900 | 现只跑 1280x800 和 390x844，碰不到 7 行路径 | 低优先级 |
| `isDecisionFresh` 未接线 | 生产零调用点，已登记为已知限制 | 不影响赛前演示 |

---

## 团队状态

五个 agent（a1-ai-action / a2-gameplay / a3-visual / a5-qa-ci / a7-deliverables）
在上一轮中断时已全部停止，且无法恢复（尝试恢复报 `Not in a team`）。
**不要假设它们还在运行。** 如需继续工作，重新起 agent 并把本文件中对应段落作为它的 prompt。

它们各自未完成的收尾，已由我接手做掉的：

- a1：`tools/` 定版、注释纪律、路径穿越判据 → 已修已推。
- a2：阿珍负向记忆测试 → 已落地为 `blackoutCrisis.test.ts` 2 条断言，探针已删。
- a3：`docs/VISUAL_SPEC.md` 视口推导更正 → 已提交（`918c733`）。
- a5：全部是复核报告，无代码产出；其发现的真 bug 已由我修复。
- a7：`artifacts/online-verify/README.md` 与验收材料口径 → 已提交（`918c733`）。

真正没做完的只有上面 P0/P1 两项，都卡在用户本人。
