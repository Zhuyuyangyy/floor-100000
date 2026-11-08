# 首层 TWOM 式生存纵切片设计

**日期**：2026-11-08  
**状态**：已获项目负责人确认，待实现  
**目标里程碑**：M1 / B3 首个完整生存章节  
**参考资料**：`twom-reverse.zip`、`pixelfx-main (1).zip`、`awesome-gamedev-agent-skills-1.1.0.zip`

## 目标

把第 1 层做成一段可以反复试玩的生存纵切片：玩家白天带着有限补给离开床位，探索、搜刮、交易并承担一次可选战斗风险；回到宿舍后处理伤病、取暖、修理或照顾邻居；睡眠推进到第二天，并把当天的行为后果写入可回看的事件日记。

这轮解决的是“行动有没有留下人的后果”，不是扩充十万层地图，也不是复制《This War of Mine》的角色、文本、素材、数值或代码。

## 现状与边界

- 当前工程已经有 `GameState`、生存时钟、饥渴精力、体温、伤病、搜刮、交易、制作、遭遇、回合制战斗、每日目标和 `src/render/fx.ts` 的 pixelfx 图集管线。
- 当前缺口是：没有统一的事件日记模型；没有跨天保存的压力/情绪状态；睡前没有 shelter 决策层；战斗反馈仍只有打击/暴击/闪光等通用特效。
- 逆向包中的 `seen / inferred / unknown` 证据分级只用于参考。只采纳可迁移的结构：事件记录、情绪变化、温度/疾病与睡眠并列处理、搜刮回家后的后果。
- pixelfx 包按 MIT 许可发布；只导入本轮需要的图集和元数据，并在 `THIRD_PARTY_NOTICES.md` 保留来源，不把整套库复制进运行时代码。
- 不改变 `docs/GAME_DESIGN_LOCK.md` 的起点、向上攀升、资源多重价值和长期社会关系目标。

## 体验流程

### 白天

1. 玩家在第 1 层宿舍醒来，看到当天目标、当前压力和上一晚留下的日记摘要。
2. 玩家出门搜刮、交易、制作或触发问号点；每次关键行为消耗游戏时间并产生结构化事件。
3. 战斗继续使用现有 `combat.ts` 的攻/挡/逃；攻击、格挡和命中接入短时刀剑/招架特效。
4. 到达傍晚后，HUD 提示返家；迟归不直接判死，而是生成 `late_return` 事件，增加压力并可能恶化伤病。

### 宿舍与夜间

玩家回到第 1 层床位后，进入一次 shelter 决策面板。首版提供四个互斥选项：

- `rest`：恢复精力，压力小幅下降。
- `treat`：消耗医疗资源，降低伤病；资源不足时保留失败原因，不扣半笔。
- `repair`：消耗木材/废料修复宿舍设施，降低下一天的环境风险。
- `care`：消耗食物或时间照顾邻居，降低压力并写入关系事件。

睡眠只在决策完成后推进到次日 06:00。温度、饥渴、伤病和压力按同一晚结算；结果通过事件日记和 HUD 摘要反馈。

### 日记与压力

日记不是长篇剧情树，而是结构化事实：事件类型、发生日、楼层、参与者、物品影响、压力变化和一条短文案。首轮至少覆盖：

`returned_from_scavenge`、`late_return`、`combat_wounded`、`shelter_rested`、`shelter_treated`、`shelter_repaired`、`neighbor_cared`、`shelter_attacked`。

压力范围为 `0..100`。高压力会降低次日行动效率并改变遭遇文案；低压力会给出“稳定”反馈。压力不直接替代 HP、饥饿或精力，也不使用不可解释的随机秒杀。

## 数据与接口

在 `src/core/gameTypes.ts` 中增加可选字段，保证旧存档仍能加载：

```ts
export type DiaryEventKind =
  | 'returned_from_scavenge'
  | 'late_return'
  | 'combat_wounded'
  | 'shelter_rested'
  | 'shelter_treated'
  | 'shelter_repaired'
  | 'neighbor_cared'
  | 'shelter_attacked';

export interface DiaryEvent {
  id: string;
  day: number;
  minute: number;
  floor: number;
  kind: DiaryEventKind;
  actorIds: string[];
  itemChanges: Array<{ itemId: ItemId; quantity: number }>;
  stressDelta: number;
  message: string;
}

export type ShelterAction = 'rest' | 'treat' | 'repair' | 'care';

export interface ShelterPlan {
  day: number;
  action: ShelterAction;
  resolved: boolean;
}
```

`GameState` 新增：

- `player.stress?: number`，旧存档缺失时按 20 初始化。
- `diary?: DiaryEvent[]`，只保留最近 64 条，旧存档缺失时为空数组。
- `shelterPlan?: ShelterPlan`，仅在宿舍决策阶段存在。

新增纯逻辑模块：

- `src/systems/DiarySystem.ts`
  - `appendDiaryEvent(state, event): void`
  - `recentDiary(state, limit = 5): DiaryEvent[]`
  - `stressAfterEvent(state, delta): number`
- `src/systems/ShelterSystem.ts`
  - `availableShelterActions(state): ShelterAction[]`
  - `resolveShelterAction(state, action): ShelterResolution`
  - `finishNight(state): NightResolution`

所有随机仍由 `deriveSeed` / `makeRng` 驱动；日记 ID 由 `day + minute + kind + sequence` 确定，不使用 `Math.random()`。

## 特效接入

从 pixelfx 只导入并渲染以下三类：

- `melee/sword-slash`：普通攻击命中。
- `impacts/parry`：格挡成功或减伤成功。
- `impacts/hit-flash`：玩家或敌人受击。

通过现有 `tools/render.mjs --sheet` 生成 Phaser atlas 和 JSON 元数据，扩展 `src/render/fx.ts` 的 `FX` 与 `FX_META`。特效只影响表现层：短暂停帧、轻微镜头震动和角色动作同步不能修改战斗纯逻辑的结果。特效不可用时，战斗仍必须完成并显示文字反馈。

## 验收

- 同一种子和同一输入序列，压力、日记、伤病、物品与次日状态一致。
- 迟归、受伤、治疗、修理和照顾邻居至少各产生一条可回看的事件。
- 旧存档缺少新字段时可以继续游戏；坏字段显示存档损坏提示。
- shelter 决策失败时不发生半笔物品扣除。
- 浏览器可完成：首层出门 → 搜刮/战斗 → 回家 → shelter 决策 → 睡眠 → 次日摘要。
- 浏览器截图覆盖白天、夜间、shelter 面板和一次刀剑/招架反馈；控制台无运行时异常或资源 404。
- `npm run typecheck`、相关 Vitest、`npm run build` 和新增 Playwright 流程通过。

## 不在本轮

- 不实现完整 42 类日记、完整 NPC 情绪树或六大阶层的社会模拟。
- 不把逆向包中的专有资产、角色、台词或二进制代码带入项目。
- 不做全套 244 个 pixelfx 效果迁移，只接入本轮战斗必需的三个效果。
- 不改变十万层世界的生成、终局路线或现有存档 key。
