import { describe, expect, it } from 'vitest';
import { addToInventory, createNewGame } from '../core/gameState';
import { inflict } from '../systems/SicknessSystem';
import { availableShelterActions, finishNight, resolveShelterAction, shouldShelterBeAttacked } from '../systems/ShelterSystem';
import { diaryOf, hasDiaryKind } from '../systems/DiarySystem';

describe('ShelterSystem', () => {
  it('offers the four shelter actions on the starting floor', () => {
    const state = createNewGame(42);
    expect(availableShelterActions(state)).toEqual(['rest', 'treat', 'repair', 'care']);
  });

  it('rest succeeds once and rejects a second action', () => {
    const state = createNewGame(42);
    const first = resolveShelterAction(state, 'rest');
    expect(first.ok).toBe(true);
    expect(state.shelterPlan).toEqual({ day: 1, action: 'rest', resolved: true });
    expect(state.player.stress).toBe(14);

    const second = resolveShelterAction(state, 'care');
    expect(second.ok).toBe(false);
    expect(second.reason).toContain('已经安排');
  });

  it('treatment fails without a medkit and does not remove anything', () => {
    const state = createNewGame(42);
    inflict(state, 'wound', 50, 360);
    const result = resolveShelterAction(state, 'treat');
    expect(result.ok).toBe(false);
    expect(state.player.inventory.slots).toHaveLength(3);
    expect(state.player.ailments?.map((a) => a.id)).toEqual(['wound']);
    expect(state.shelterPlan).toBeUndefined();
  });

  it('treatment consumes one medkit and clears a wound atomically', () => {
    const state = createNewGame(42);
    addToInventory(state.player.inventory, 'medkit', 1);
    inflict(state, 'wound', 50, 360);
    const result = resolveShelterAction(state, 'treat');
    expect(result.ok).toBe(true);
    expect(state.player.ailments).toEqual([]);
    expect(state.player.inventory.slots.some((slot) => slot.itemId === 'medkit')).toBe(false);
  });

  it('care consumes food and repair uses the existing reinforced-door recipe', () => {
    const state = createNewGame(42);
    addToInventory(state.player.inventory, 'ration_pack', 1);
    expect(resolveShelterAction(state, 'care').ok).toBe(true);

    const repairState = createNewGame(42);
    addToInventory(repairState.player.inventory, 'wood', 2);
    addToInventory(repairState.player.inventory, 'tape', 1);
    expect(resolveShelterAction(repairState, 'repair').ok).toBe(true);
    expect(repairState.player.homeUpgrades).toContain('reinforced_door');
  });

  it('requires a resolved shelter action before sleep and advances to next day', () => {
    const state = createNewGame(42);
    state.gameMinuteOfDay = 1200;
    expect(finishNight(state).ok).toBe(false);
    resolveShelterAction(state, 'rest');
    const result = finishNight(state);
    expect(result.ok).toBe(true);
    expect(state.day).toBe(2);
    expect(state.gameMinuteOfDay).toBe(360);
    expect(state.shelterPlan).toBeUndefined();
    // RC-01：休息写结构化 dwellerMorale（宿舍面板「上次：…」读它）
    expect(diaryOf(state).some((e) => e.kind === 'dwellerMorale' && e.text.includes('把门关好'))).toBe(true);
  });

  it('rest clears sleep-cured ailments during the night settlement', () => {
    const state = createNewGame(42);
    state.gameMinuteOfDay = 1200;
    inflict(state, 'cold', 40, 360);
    resolveShelterAction(state, 'rest');
    const result = finishNight(state);
    expect(result.healedAilments).toEqual(['cold']);
    expect(state.player.ailments).toEqual([]);
  });

  it('replays a shelter attack for the same seed and repair blocks it', () => {
    expect(shouldShelterBeAttacked(1, 1, 'rest')).toBe(true);
    expect(shouldShelterBeAttacked(1, 1, 'rest')).toBe(true);
    expect(shouldShelterBeAttacked(1, 1, 'repair')).toBe(false);

    const attacked = createNewGame(1);
    attacked.gameMinuteOfDay = 1200;
    resolveShelterAction(attacked, 'rest');
    const attackResult = finishNight(attacked);
    expect(attackResult.attacked).toBe(true);
    expect(attackResult.attackDamage).toBe(12);
    expect(attacked.player.hp).toBe(88);
    // RC-01：夜袭写结构化 shelterAttacked（群体态，伤害进文案，可按旗查询）
    expect(hasDiaryKind(attacked, 'shelterAttacked')).toBe(true);
    expect(diaryOf(attacked).some((e) => e.kind === 'shelterAttacked' && e.text.includes('HP -12'))).toBe(true);

    const repaired = createNewGame(1);
    repaired.gameMinuteOfDay = 1200;
    repaired.player.inventory.slots.push({ itemId: 'wood', quantity: 2 }, { itemId: 'tape', quantity: 1 });
    resolveShelterAction(repaired, 'repair');
    const repairResult = finishNight(repaired);
    expect(repairResult.attacked).toBe(false);
    expect(repaired.player.hp).toBe(100);
  });
});

// RC-01 日记统一：四种宿舍行动的写入面。契约 §5 的 11 种 kind 没有宿舍
// 行动的专属种类，映射为（message 原样进 text，故事精度不丢）：
//   休息/加固 → dwellerMorale（玩家自己）；处理伤势 → dwellerWounded；
//   照顾邻居 → visitor（actorId='xiaozhou'，他因此亲历，能进他的对话上下文）。
describe('ShelterSystem · 结构化日记写入（RC-01）', () => {
  it('rest 写 dwellerMorale，压力 -6（旧 appendDiaryEvent 的 stressDelta）', () => {
    const state = createNewGame(42);
    expect(resolveShelterAction(state, 'rest').ok).toBe(true);
    const entry = diaryOf(state)[0];
    expect(entry.kind).toBe('dwellerMorale');
    expect(entry.actorId).toBe('player');
    expect(entry.text).toBe('你把门关好，先让身体恢复一点。');
    expect(entry.day).toBe(1);
    expect(Number.isInteger(entry.minute)).toBe(true);
    expect(state.player.stress).toBe(14); // 20 - 6
  });

  it('treat 写 dwellerWounded，压力 -10', () => {
    const state = createNewGame(42);
    addToInventory(state.player.inventory, 'medkit', 1);
    inflict(state, 'wound', 50, 360);
    expect(resolveShelterAction(state, 'treat').ok).toBe(true);
    const entry = diaryOf(state)[0];
    expect(entry.kind).toBe('dwellerWounded');
    expect(entry.text).toBe('你用医疗包处理了伤口。');
    expect(state.player.stress).toBe(10); // 20 - 10
  });

  it('repair 写 dwellerMorale，压力 -4', () => {
    const state = createNewGame(42);
    addToInventory(state.player.inventory, 'wood', 2);
    addToInventory(state.player.inventory, 'tape', 1);
    expect(resolveShelterAction(state, 'repair').ok).toBe(true);
    const entry = diaryOf(state)[0];
    expect(entry.kind).toBe('dwellerMorale');
    expect(entry.text).toContain('宿舍门重新加固');
    expect(state.player.stress).toBe(16); // 20 - 4
  });

  it('care 写 visitor 且 actorId=小周（他亲历，能进他的对话上下文），压力 -12', () => {
    const state = createNewGame(42);
    addToInventory(state.player.inventory, 'ration_pack', 1);
    expect(resolveShelterAction(state, 'care').ok).toBe(true);
    const entry = diaryOf(state)[0];
    expect(entry.kind).toBe('visitor');
    expect(entry.actorId).toBe('xiaozhou');
    expect(entry.text).toContain('分给小周');
    expect(state.player.stress).toBe(8); // 20 - 12
  });

  it('夜袭写 shelterAttacked（群体态），压力 +10，finishNight 的 stressDelta 含它', () => {
    const attacked = createNewGame(1); // seed 1 第 1 天 rest 必被袭
    attacked.gameMinuteOfDay = 1200;
    resolveShelterAction(attacked, 'rest');
    const stressBefore = attacked.player.stress ?? 20;
    const result = finishNight(attacked);
    const entry = diaryOf(attacked).find((e) => e.kind === 'shelterAttacked');
    expect(entry?.actorId).toBeNull();
    expect(attacked.player.stress ?? 20).toBe(Math.min(100, stressBefore + 10));
    expect(result.stressDelta).toBe((attacked.player.stress ?? 20) - stressBefore);
  });
});
