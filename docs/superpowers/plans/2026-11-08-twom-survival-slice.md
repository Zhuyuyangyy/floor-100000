# 首层 TWOM 式生存纵切片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在第 1 层实现一个可保存、可复现、可试玩的“白天探索 → 回宿舍决策 → 睡眠结算 → 次日后果”循环，并把三种刀剑/招架战斗特效接入现有 Phaser 反馈层。

**Architecture:** 保持 `GameState` 为唯一状态源；新增 `DiarySystem` 与 `ShelterSystem` 两个纯 TypeScript 模块，负责事件记录、压力变化、夜间决策和结算。`GameScene` 只负责阶段输入、面板与渲染同步。pixelfx 只以 Phaser atlas 资产进入 `src/render/fx.ts`，不参与战斗判定。

**Tech Stack:** Phaser 4.2.1、TypeScript strict、Vitest、Playwright、现有 pixelfx atlas 管线、seeded RNG。

**Spec:** `docs/plans/2026-11-08-twom-survival-slice-design.md`

## Global Constraints

- 遵守 `docs/GAME_DESIGN_LOCK.md`：玩家从第 1 层开始，向上攀升，资源具有生存/经济/社会多重价值。
- 所有随机使用 `deriveSeed` / `makeRng`；禁止 `Math.random()` 和基于墙钟的随机。
- 核心规则必须是纯 TypeScript；Phaser 只处理输入、绘制和动画。
- 旧存档缺失新字段时必须可继续；坏字段必须显示存档损坏提示。
- 每个 gameplay 规则同时覆盖成功路径和失败/边界路径。
- 不复制逆向包中的专有代码、角色、台词、素材、二进制或具体数值。
- pixelfx 只导入本轮三个效果，保留 MIT 来源到 `THIRD_PARTY_NOTICES.md`。
- 保留用户现有未提交的角色 PNG 和 `re/` 诊断脚本，不在任务中覆盖或清理。

---

### Task 1: Add diary and stress data contracts

**Files:**
- Modify: `src/core/gameTypes.ts`
- Modify: `src/core/gameState.ts`
- Test: `src/tests/gameState.test.ts`
- Test: `src/tests/save.test.ts`

**Interfaces:**
- Add `DiaryEventKind`, `DiaryEvent`, `ShelterAction`, `ShelterPlan` exactly as defined in `docs/plans/2026-11-08-twom-survival-slice-design.md`.
- Add optional `player.stress?: number`, `diary?: DiaryEvent[]`, `shelterPlan?: ShelterPlan` to `GameState`.
- New game defaults: `stress: 20`, `diary: []`, `shelterPlan: undefined`.

- [ ] **Step 1: Write failing state/default tests**

```ts
it('new state starts with low stress and an empty diary', () => {
  const state = createInitialGameState(42);
  expect(state.player.stress).toBe(20);
  expect(state.diary).toEqual([]);
  expect(state.shelterPlan).toBeUndefined();
});
```

- [ ] **Step 2: Write backward-compatibility tests**

```ts
it('accepts saves that omit the new optional fields', () => {
  const legacy = createInitialGameState(42) as GameState;
  delete legacy.player.stress;
  delete legacy.diary;
  delete legacy.shelterPlan;
  expect(validateGameState(legacy)).toEqual([]);
});
```

- [ ] **Step 3: Implement types and defaults**

Use `Math.max(0, Math.min(100, value))` only in normalization helpers; do not clamp arbitrary state mutations silently in render code.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- --run src/tests/gameState.test.ts src/tests/SaveSystem.test.ts`

Expected: PASS, with existing save tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/core/gameTypes.ts src/core/gameState.ts src/tests/gameState.test.ts src/tests/save.test.ts
git commit -m "feat: add diary stress and shelter state contracts"
```

### Task 2: Implement deterministic diary and stress rules

**Files:**
- Create: `src/systems/DiarySystem.ts`
- Test: `src/tests/DiarySystem.test.ts`

**Interfaces:**
- `appendDiaryEvent(state: GameState, event: DiaryEvent): void`
- `recentDiary(state: GameState, limit?: number): DiaryEvent[]`
- `stressAfterEvent(state: GameState, delta: number): number`
- `makeDiaryEvent(state: GameState, input: Omit<DiaryEvent, 'id' | 'day' | 'minute'>): DiaryEvent`

- [ ] **Step 1: Write failing tests for ordering, cap and clamp**

```ts
it('keeps diary order and caps it at 64 events', () => {
  const state = createInitialGameState(42);
  for (let i = 0; i < 70; i++) appendDiaryEvent(state, makeTestEvent(state, i));
  expect(state.diary).toHaveLength(64);
  expect(state.diary?.[0].id).toBe('event-6');
  expect(recentDiary(state, 3).map((e) => e.id)).toEqual(['event-67', 'event-68', 'event-69']);
});

it('clamps stress to 0..100', () => {
  const state = createInitialGameState(42);
  state.player.stress = 99;
  expect(stressAfterEvent(state, 10)).toBe(100);
  expect(stressAfterEvent(state, -200)).toBe(0);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run src/tests/DiarySystem.test.ts`

Expected: FAIL because `DiarySystem.ts` does not exist.

- [ ] **Step 3: Implement deterministic IDs and mutations**

Use `state.day`, `state.gameMinuteOfDay`, `input.kind` and the current diary length to create IDs. Initialize missing `state.diary` and `state.player.stress` for legacy saves.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- --run src/tests/DiarySystem.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/systems/DiarySystem.ts src/tests/DiarySystem.test.ts
git commit -m "feat: record deterministic survival diary events"
```

### Task 3: Implement shelter actions and night settlement

**Files:**
- Create: `src/systems/ShelterSystem.ts`
- Modify: `src/systems/SurvivalSystem.ts`
- Modify: `src/systems/SicknessSystem.ts`
- Test: `src/tests/ShelterSystem.test.ts`

**Interfaces:**
- `availableShelterActions(state: GameState): ShelterAction[]`
- `resolveShelterAction(state: GameState, action: ShelterAction): ShelterResolution`
- `finishNight(state: GameState): NightResolution`
- `ShelterResolution` must include `ok`, `action`, `message`, `events`, `itemChanges`, and `stressDelta`.
- `NightResolution` must include `nextDay`, `hpLost`, `stressDelta`, `healedAilments`, and `events`.

- [ ] **Step 1: Write failing tests for all four actions**

Cover: rest always succeeds; treat fails without a medkit and does not remove items; repair consumes the exact material once; care fails when the player lacks the required food; a second action on the same night is rejected.

- [ ] **Step 2: Write failing tests for night settlement**

Cover: sleep before 20:00 is rejected; sleep after 20:00 advances to day + 1 at 06:00; hunger/thirst are charged using existing `sleepNightMinutes`; stress and ailments are updated exactly once.

- [ ] **Step 3: Implement action availability and atomic mutations**

Use existing `InventorySystem` helpers. Apply item removal only after all preconditions pass. Append diary events through `DiarySystem` rather than mutating `state.diary` directly.

- [ ] **Step 4: Integrate with existing sleep rules**

Keep the existing `sleep(state)` calculation as the source of time and survival decay. `finishNight` must call the named helpers rather than duplicate their formulas.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- --run src/tests/ShelterSystem.test.ts src/tests/sickness.test.ts src/tests/save.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/systems/ShelterSystem.ts src/systems/SurvivalSystem.ts src/systems/SicknessSystem.ts src/tests/ShelterSystem.test.ts
git commit -m "feat: add shelter decisions and night settlement"
```

### Task 4: Add shelter phase to the GameScene UI flow

**Files:**
- Modify: `src/scenes/GameScene.ts`
- Modify: `src/render/uiKit.ts`
- Modify: `src/render/panels.ts`
- Test: `e2e/survivalJourney.spec.ts`
- Test: `e2e/uiAll.spec.ts`

**Interfaces:**
- Add a scene-local `shelterSelected: number` cursor and a `renderShelterPanel()` view.
- The panel must call `availableShelterActions` and `resolveShelterAction`; it must not change `GameState` directly.

- [ ] **Step 1: Add a failing E2E flow**

The test should start a new game with `?seed=42`, return to the bed after nightfall, assert the shelter panel contains `休息`, `治疗`, `修理`, and `照顾`, choose `休息`, press Enter to sleep, and assert the next-day clock plus a diary summary are visible.

- [ ] **Step 2: Run the focused E2E and capture the failure**

Run: `npx playwright test e2e/survivalJourney.spec.ts --workers=1`

Expected: FAIL because no shelter phase exists.

- [ ] **Step 3: Implement input and panel rendering**

Use the same panel depth constants as the existing encounter/combat panels. Support ArrowLeft/ArrowRight, Enter, and Escape. Escape must leave the shelter panel without applying an action; only a successful `resolveShelterAction` can set `shelterPlan`.

- [ ] **Step 4: Add HUD stress and diary summary**

Render a compact `压力` value and the last diary event. Keep text within the existing 1280×720 design resolution and do not change the core HUD layout outside the new fields.

- [ ] **Step 5: Run focused browser tests and inspect a screenshot**

Run: `npx playwright test e2e/survivalJourney.spec.ts e2e/uiAll.spec.ts --workers=1`

Expected: PASS, with screenshot evidence under `test-results/` showing the shelter panel and next-day summary.

- [ ] **Step 6: Commit**

```bash
git add src/scenes/GameScene.ts src/render/uiKit.ts src/render/panels.ts e2e/survivalJourney.spec.ts e2e/uiAll.spec.ts
git commit -m "feat: add shelter decision phase to the first floor"
```

### Task 5: Add the three melee feedback atlases

**Files:**
- Create: `public/assets/fx/melee/sword-slash/sword-slash.png`
- Create: `public/assets/fx/melee/sword-slash/sword-slash.json`
- Create: `public/assets/fx/impacts/parry/parry.png`
- Create: `public/assets/fx/impacts/parry/parry.json`
- Reuse or create: `public/assets/fx/impacts/hit-flash/*`
- Modify: `src/render/fx.ts`
- Modify: `THIRD_PARTY_NOTICES.md`
- Test: `src/tests/fx.test.ts`

**Interfaces:**
- Extend `FX` with `sword-slash` and `parry` entries.
- Add their exact `FX_META` values from generated JSON; do not hand-invent fps, frame size or pivot.

- [ ] **Step 1: Render candidate sheets in a temporary pixelfx checkout**

Use the supplied zip contents outside the application source tree:

```bash
node tools/render.mjs melee/sword-slash --sheet
node tools/render.mjs impacts/parry --sheet
```

Inspect the contact sheets before copying only the final PNG/JSON pair into `public/assets/fx/`.

- [ ] **Step 2: Write failing registry tests**

Assert that both IDs are in `FX`, their PNG/JSON files exist, and `FX_META` has positive duration, fps, valid pivot, and frame size.

- [ ] **Step 3: Add the registry entries and legal notice**

Record pixelfx MIT plus Sprite Fusion/Hugo Duprez attribution exactly as required by the supplied `LICENSE` and `NOTICE.md`.

- [ ] **Step 4: Run the focused tests and build**

Run: `npm test -- --run src/tests/fx.test.ts && npm run build`

Expected: PASS; Vite must include both atlases without 404s.

- [ ] **Step 5: Commit**

```bash
git add public/assets/fx src/render/fx.ts src/tests/fx.test.ts THIRD_PARTY_NOTICES.md
git commit -m "feat: add melee slash and parry feedback atlases"
```

### Task 6: Wire effects to combat outcomes without changing combat rules

**Files:**
- Modify: `src/scenes/GameScene.ts`
- Modify: `src/render/audio.ts`
- Test: `e2e/combat.spec.ts`

**Interfaces:**
- Add a scene-local `playCombatFeedback(round, action)` that maps `attack` hit to `sword-slash`, guard mitigation to `parry`, and any incoming damage to `hit-flash`.
- The function consumes `CombatRound` only; it must not roll, modify HP, modify loot, or alter turn order.

- [ ] **Step 1: Extend the combat E2E with visible feedback assertions**

After a seeded attack and guard, assert that the expected animation keys are present in the scene and that the combat state still matches the pure `resolveRound` result.

- [ ] **Step 2: Implement the visual mapping**

Use the existing `playFx` helper, `LIGHT_DEPTH`, and action animation timing. Keep hit-stop short and visual-only; no global time-scale mutation in this first slice.

- [ ] **Step 3: Run combat tests**

Run: `npm test -- --run src/tests/combat.test.ts && npx playwright test e2e/combat.spec.ts --workers=1`

Expected: PASS, with no changed damage or flee outcomes.

- [ ] **Step 4: Commit**

```bash
git add src/scenes/GameScene.ts src/render/audio.ts e2e/combat.spec.ts
git commit -m "feat: sync melee feedback with combat outcomes"
```

### Task 7: Full verification and documentation handoff

**Files:**
- Modify: `docs/03_TASKS.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/ARTPACK_INTEGRATION.md`
- Modify: `src/assets/characters/README.md`
- Create: `docs/first-floor-survival-slice-report.md`

- [ ] **Step 1: Run the full required checks**

```bash
npm run typecheck
npm test -- --run
npm run build
npx playwright test --workers=1
```

Record real pass/fail counts; do not copy historical counts from old reports.

- [ ] **Step 2: Run the browser acceptance journey**

Use `?seed=42` and capture title, first-floor day, combat feedback, shelter panel, night result, and next-day summary. Check console messages and network requests for runtime errors or asset 404s.

- [ ] **Step 3: Update progress docs**

Mark only the newly completed B3 slice. Record known limits: one-floor scope, four shelter actions, eight diary kinds, and three imported pixelfx effects.

- [ ] **Step 4: Reconcile stale art documentation**

Make `src/assets/characters/README.md` match the 20-frame runtime contract and update `docs/ARTPACK_INTEGRATION.md` so it no longer claims character integration is absent.

- [ ] **Step 5: Commit the verification report**

```bash
git add docs/03_TASKS.md docs/ROADMAP.md docs/ARTPACK_INTEGRATION.md src/assets/characters/README.md docs/first-floor-survival-slice-report.md
git commit -m "docs: record first-floor survival slice verification"
```

## Self-review checklist

- Diary, stress, shelter, UI, effects, combat mapping and documentation each have a dedicated task.
- All new state is optional for old saves and is validated before use.
- No task changes combat formulas or world-generation randomness.
- The plan does not import the reverse-engineered game's proprietary content.
- The plan uses only three pixelfx effects and preserves attribution.
- Each task ends with a focused test and a small commit.
