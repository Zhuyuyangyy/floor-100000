# B3-18 — 宿舍防御与夜袭后果

- 里程碑：M1 可玩原型
- 目标：让 shelter 的 `repair` 选项产生可感知的夜间收益，让夜间决策不再只有压力和资源变化。
- 设计依据：[`plans/2026-11-08-twom-survival-slice-design.md`](plans/2026-11-08-twom-survival-slice-design.md) 预留的 `shelter_attacked` 日记事件。

## 行为

- 每次睡眠结算前记录本夜的起始日、run seed 和 shelter action。
- `rest`、`treat`、`care` 使用 `deriveSeed(runSeed, day, 'shelter-attack')` 做一次 25% 夜袭判定。
- `repair` 直接阻止本夜袭击，作为加固门的确定性收益。
- 夜袭造成 12 点 HP 损失、压力 +10，并写入 `shelter_attacked` 日记事件。
- 同一 seed、同一天、同一 shelter action 的结果完全一致；不使用 `Math.random()`。
- 夜袭结果会进入次日 HUD flash，格式为 `夜袭 -12 HP`；若因此归零则进入失败场景。

## 验收

- `ShelterSystem.test.ts` 验证种子 1 可复现夜袭，修门可阻止夜袭，日记和 HP 变化一致。
- `e2e/shelter.spec.ts` 验证真实键盘流程：首层 20:00 → 打开 shelter → 安排休息 → 睡眠 → 第 2 天 HP 88 且日记包含 `shelter_attacked`。
- 种子 42 的原有 shelter 流程仍保持压力下降、保存重载和次日醒来行为。

## 范围边界

本轮没有新增 NPC 战斗、门损坏持久状态或复杂入侵场景；只把已有 shelter 计划、压力和日记数据接成一条可复现的夜间后果链。
