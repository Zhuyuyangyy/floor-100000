# E2E 全量集成报告（AG-18 / e2e 收尾）

- **分支/提交**：`agent/2026-11-15/ag-17-e2e-verify` @ `6493b3f`（基线 `9b81369`，集成分支较早merge 点）
- **日期**：2026-11-15
- **范围**：全量 Playwright e2e（`--workers=1`）+ 失败复跑 + `tsc --noEmit` + 全量 vitest
- **总结**：**83 passed / 1 failed（84 个测试，15m44s）**。唯一失败是真实产品缺陷（塔楼总览文本重叠），
  与本轮接手的"5 个 NPC setup 腐烂"无关——该腐烂在本基线不存在（详见 §3）。

---

## 1. 验证命令与结果

| 验证 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npx tsc --noEmit` | 干净 |
| 单元/组件测试 | `VITE_NPC_MODEL= npx vitest run` | **68 文件 / 1083 测试全过**（与预期基线 1083 一致） |
| 全量 e2e | `npx playwright test --workers=1` | **83 passed / 1 failed**（15m44s） |
| 失败复跑 | `npx playwright test e2e/firstChapter.spec.ts --workers=1` | 5 passed / 1 failed，**同一处稳定复现，非 flake** |

全量跑必须 1 worker（>1 workers 时多页面共用一个 Vite cold load 会成片超时，AG-03 本地 8/2 workers 均复现）。

## 2. 全量结果表（按 spec 文件）

| spec | 测试数 | 结果 | 备注 |
| --- | --- | --- | --- |
| actionCosts | 3 | ✓ | |
| art | 1 | ✓ | |
| bagFullWarning | 1 | ✓ | 1.2m |
| combat | 3 | ✓ | |
| crafting | 4 | ✓ | 含「净化器把脏水变成净水」4.5s（flash 正确报「2 瓶」，历史失败已修） |
| dwellPressure | 1 | ✓ | 23.9s |
| events | 3 | ✓ | |
| firstChapter | 6 | **5 ✓ / 1 ✗** | 失败在塔楼总览段（§4）；背包/工作台/对话段全过 |
| gameplay | 1 | ✓ | |
| hudFeedback | 2 | ✓ | |
| hudLayout | 5 | ✓ | 4 种视口 + 金钱刷新 |
| integration | 1 | ✓ | |
| inventory | 2 | ✓ | |
| npc | 4 | ✓ | 4.0–4.6s，**静态坐标 setup 未坏（§3）** |
| saveFailure | 2 | ✓ | 5.8s / 3.9s，teardown 无卡死（§5） |
| shelter | 2 | ✓ | |
| smoke | 1 | ✓ | |
| stairNavigation | 6 | ✓ | 含 50010→50009 下行 2.0m（AG-17 过冲修复后稳定）；第 10 层电梯文案 16.3s |
| survival | 6 | ✓ | |
| survivalJourney | 4.1m | ✓ | teardown 正常完成（§5） |
| survivalLoop | 4 | ✓ | |
| tower | 10 | ✓ | locked floor 16.2s；devfloor 6.0s |
| ui | 13 | ✓ | |
| uiAll | 2 | ✓ | |
| **合计** | **84** | **83 ✓ / 1 ✗** | 15m44s |

证据：全量日志（跑时临时文件，已删）；失败产物保留在 `test-results/firstChapter-the-bag-workb-a6e62-e-canvas-and-off-each-other-chromium/`
（test-failed-1.png + trace.zip + error-context.md，Playwright outputDir，gitignored）。

## 3. 「NPC 移动导致 5 个 setup 腐烂」——本基线不成立，未改任何 spec

派工单的判断（AG-11 接入 `npcAutonomyFor` 后 NPC 按日程移动、静态坐标寻路失效）描述的是**集成分支合入
AG-11 wiring 之后**的状态，不是本 worktree 的状态。核实：

- 本基线（`9b81369`）里 `npcAutonomyFor`/`npcAutonomyAt` 只被 `src/tests/npcBehavior.test.ts` 消费；
  `GameScene.drawNpcs()`（src/scenes/GameScene.ts:3072）仍把精灵放在 `data/npcs.ts` 的静态 `npc.x`
  （alin=480、xiaozhou=800），没有任何每帧重定位。
- AG-11 的场景接线在 `8d67a9e`（`syncNpcs` 每帧按 `npcAutonomyFor(...).x` 摆精灵，`nearestNpc` 改用实时 x），
  以 `d700953` 合入 `ag-11-wiring` / `integrate/sprint-01`——`git merge-base --is-ancestor` 确认**不在本分支历史**。
- 实测佐证：全量跑里 `npc.spec.ts` 4/4 原样通过；`firstChapter.spec.ts:426` 的
  `setX(NEIGHBOUR_X)` → E → 「阿林（维修工）」对话段在该测试内通过（该测试失败点在更后面的塔楼总览段，见 §4）。

**结论：5 处 setup（npc.spec.ts:160/186/209/225、firstChapter.spec.ts:426）无需改动。**
不在本基线做"读实时坐标"的预防性改造：那是对一个尚不存在的分支状态过度工程，且 AG-11 的场景内部
（如 `npcObjs` 命名）合并前还可能变。

### 合并 AG-11 wiring 后的修法配方（留给集成方）

- NPC 位置 = `npcAutonomyFor(npc, {day, minuteOfDay, runSeed, stock}).x`，场景每帧 `syncNpcs()` 重摆精灵；
  `nearestNpc()` 按同一实时 x 判定，所以 E 对"眼里看见的位置"有效。
- setup 应：① 读实时精灵 x——合并后若 `sc.npcObjs`（Map<npcId,{sprite,…}>）仍在，直接取；
  否则扫 Game children list 里 `walkSheetKey('npc_alin'|'npc_xiaozhou')` 的 Sprite，**先用 `sc.spotMarkers`
  的 x 集合排除行商**（商店行商共用 alin 行走图，固定在自己的 spot x 附近）再取第一个；
  ② setX 到该 x 后按 E，并且放进"每轮重读位置"的重试循环里——居民会漂移（到达锚点后每 15 游戏分钟
  在 ±28px 内闲逛；步行 40px/游戏分钟 ≈ 120px/真实秒，`INTERACT_DISTANCE=44`），一次性 setX 一秒内就可能过期。
- 断言期望值不动。

## 4. 唯一失败的定性：真实产品缺陷（塔楼总览文本重叠）

- **测试**：`firstChapter.spec.ts:393` › the bag, workbench, dialogue and tower panels stay inside the canvas and off each other
- **失败点**：该测试第 449 行，塔楼总览段的 `expectNoOverlap`（第 276–289 行：任意两块面板文本重叠面积超过较小块的
  15% 即失败）。前面的背包段、工作台段、对话段（含 NEIGHBOUR_X setup）全部通过。
- **错误**：`tower overview: overlapping text` — `"终点 第100000层" × "缩放 1x"`。
- **证据**：
  1. 全量跑与单独复跑均稳定复现（复跑 5 passed / 1 failed，同一对文本）；
  2. 失败截图 `test-results/…/test-failed-1.png`：右上角「终点 第100000层」与「缩放 1x」互相压字；
  3. **产品源码自认此重叠**：`src/scenes/TowerOverviewScene.ts:295` 注释原文
     "the top-right is already crowded (the zoom chip overlaps the 终点 tag by 88x12px)"。
- **几何**：终点标签（「终点 第100000层」，TYPE_AUX 下约 169px 宽）由 `drawEndpoints()`（同文件 520–523 行）
  放在右边距 `TOWER_TAG_X`、条带最顶行；缩放芯片 `infoText` 在 `(DESIGN_WIDTH-12, 12)`、origin (1,0)
  （`buildHud()`，303–307 行）——两者同占右上角。
- **与存量缺陷的关系**：这是 BUG-QA-01（AG-03 记录的起点/终点标签出界）的同族残留。AG-08 已修掉出界
  （`TOWER_ENDPOINT_MARGIN`，见 70–75 行注释），canvas 内断言现已通过；但缩放芯片与终点标签的重叠一直在，
  被本条 e2e 不变量正确抓住。
- **定性：真实产品缺陷（UI 重叠），不是 spec bug**。断言本身是正当的产品不变量，且源码注释已承认该重叠。
- **修法方向（属 src 持有方，本轮越界未动）**：把缩放芯片移出右上角（如底栏图例行、或标题下方左侧），
  或把终点标签下移/左移出芯片行。
- **硬纪律执行**：未删测试、未 skip/only、未放宽断言；`src/**` 零改动。

## 5. teardown 性能：修前 / 修后

- **修前**（AG-03，`docs/qa/STALE_E2E.md` §2）：journey 主体 254.6s，After Hooks 254.7s 开始，context close
  到 600s 超时仍未结束 → 失败；tower locked floor（主体 114s）、saveFailure rejected save（主体 46s）同样死于
  teardown；疑似根因是本机负载，其中一项是 qa worktree 里 1.1G 历史 `test-results/` trace 堆积。
  （注意：AG-03 的测量在 `--trace on` 下进行。）
- **修后**（本轮，配置默认 `trace: retain-on-failure`）：84 个测试**无一 teardown 超时**；
  survivalJourney 含 teardown 共 4.1m 正常结束；tower locked floor 16.2s；saveFailure 5.8s/3.9s。
  两次测量条件不同（trace 策略、机器负载），对比为指示性而非受控实验。
- **本轮为此做的处置**：每轮 Playwright 启动前把陈旧 `test-results/` 改名移出 outputDir（见 §6），
  runner 以空 outputDir 启动，不再需要开机 wipe 4098 个陈旧文件；跑期间 worktree 内无 trace 归档堆积。

## 6. 环境阻塞与处置（如实记录）

### 6.1 批量删除被主机 guard 拦截——归档未能删除

本机安装了 safe-delete 防护（`node-safe-delete-shim.cjs` + `safe-delete-bulk-guard.cjs`）：单次工具调用删除
>50 个文件即要求人工 UI 确认（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`），阈值 50/turn。它同时拦截 shell `rm`
（bash 的 rm 被包装到 safe-bin）和子进程内 Node 的 `fs.rm`——后者意味着 **Playwright 本身无法启动**：
它在 startup 时用 `fs.rm` wipe outputDir。

- 我**没有**用 guard 自带的 `approve` 子命令自我审批（等同伪造人工确认），**没有**把删除拆成 <50 文件/次
  的批次绕过阈值（规避行为），**没有**经 temp 目录路由删除。
- 我**做了**的：先用 `ls`/`find` 核实 7 个 `test-results-old-*`（约 850MB）内容全部是 Playwright 产物
  （trace/network/png/jpeg/woff2 + error-context.md + trace 内嵌页面快照），随后 `rm -rf` 两次被确定性拦截。
- **后果**：850MB 归档 + 343MB 陈旧 `test-results/`（4098 文件）未能删除，全部以改名方式保留：
  `test-results-old-ag18-prerun`（陈旧 outputDir）、`test-results-old-ag18-npc-run`、
  `test-results-old-ag18-full-run`、`test-results-old-ag18-firstchapter-rerun`。
- **让测试能跑的变通**：每轮 Playwright 调用前 `mv test-results test-results-old-ag18-<轮次>`。
  `fs.rename` 不被 guard 拦截（它只拦 rm/unlink/rmdir），runner 随后创建全新 outputDir，无需任何删除。
  数据完整保留，可被人工确认后删除。
- **待人工处理**：在本 worktree 批准删除上述 `test-results-old-*` 目录（本轮结束后合计约 1.2GB），
  或在不受该 guard 影响的 shell 里清理。

### 6.2 磁盘濒满

D: 326G 已用 100%，全程可用空间仅 ~1.9–2.6GB。全量 e2e 每 4 个通过用例约写 50MB（screencast 帧约
12MB/测试），全量一轮新增约 600MB。**再跑一轮全量前必须先清归档**，否则可能磁盘耗尽。

### 6.3 后台 shell 不可用

bash 后台启动器在本环境失败（`/tmp` 缺失 + 沙箱拒绝读 PortableGit 配置）；PowerShell 后台沙箱拦截
npx.ps1/Add-Type。长跑以前台 + 10 分钟超时后自动转后台的方式完成（全量跑即如此，15m44s）。

## 7. 本轮修复记录

| # | 提交/改动 | 文件 | 内容 |
| --- | --- | --- | --- |
| 1 | `6493b3f`（接手 AG-17 未提交工作，已核实质量：LIFT_X=1165/LIFT_REACH=30 与注释一致、产品断言未动） | e2e/stairNavigation.spec.ts | 修 `walkToLift` 过冲：卡帧会把角色带进下楼口区（实测 110 层走到 x=1240）；改为提前到 1140 松键 + 小步点按修正 + 每步读真实 x，稳定落在 1145..1190 安全窗。只改 setup |
| 2 | 待提交（本轮） | e2e/tower.spec.ts:487 | `?devfloor` 测试名/注释刷新：原名 "starts the retired dev dorm scene and nothing else" 名义过期（顶点现为第六段可玩终局真内容，测试只断言楼层路由）。断言零改动；复跑通过（6.8s） |
| 3 | 无 | e2e/npc.spec.ts、e2e/firstChapter.spec.ts | **未改**：本基线 NPC 静止，5 处 setup 无腐烂（§3） |

## 8. 存量失败背景核对

| 派工单提到的存量问题 | 本轮结果 |
| --- | --- |
| crafting「净化器把脏水变成净水」（AG-03 说已修） | ✓ 通过（4.5s，flash 报真实瓶数「2 瓶」） |
| survivalJourney teardown 病态慢 | ✓ 通过（4.1m 含 teardown，见 §5） |
| tower `?devfloor=100000` 名义过期 | ✓ 通过；测试名/注释已刷新（§7 #2） |
| BUG-QA-01 塔楼标签出界（AG-08 已修） | canvas 内断言 ✓；但残留缩放芯片重叠，即本轮唯一失败（§4） |

## 9. 没处理干净的地方

1. **塔楼总览「终点 × 缩放」重叠未修**：真实产品缺陷，需 `src/scenes/TowerOverviewScene.ts` 持有方处理
   （修法方向见 §4）。按派工纪律未越界改 src。
2. **约 1.2GB trace 归档未能删除**：被主机 safe-delete guard 拦截，需人工 UI 确认后删除（§6.1）。
3. **NPC setup 合并后配方未应用**：本基线不需要；AG-11 wiring 合入时按 §3 配方改造。
4. **磁盘濒满**：下一轮全量 e2e 前必须先清归档（§6.2）。
