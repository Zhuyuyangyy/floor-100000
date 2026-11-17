import { describe, expect, it } from 'vitest';

import {
  MONOLOGUE_LINE_COUNT,
  MONOLOGUE_TRIGGER_PRIORITY,
  STATUS_PANEL_BALANCE,
  chooseMonologue,
  crossedBelow,
  freshMonologueMemory,
  isGoodLoot,
  monologueVoiceFor,
  statusSummaryLine,
  type MonologueTrigger,
  type MonologueVoice,
  type StatusPanelBalance,
} from '../data/monologue';
import { HUD_LAYOUT } from '../render/hudLayout';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../core/design';

// AG-67 单测：右下角色状态面板 + 角色自言自语。纯函数层（台词表、节流门、
// 处境摘要、卡片车道契约），Phaser 渲染由 e2e（ag67-status.spec.ts）实测。

const CFG = STATUS_PANEL_BALANCE;
const VOICES: MonologueVoice[] = ['player', 'alin', 'xiaozhou'];
const TRIGGERS: MonologueTrigger[] = [
  'hp_low',
  'hunger_low',
  'thirst_low',
  'energy_low',
  'night_fall',
  'new_floor',
  'good_loot',
  'combat_win',
];
/** rng 恒 0：总挑池中第一句，挑句结果可预期。 */
const rngFirst = (): number => 0;

describe('AG-67 config wiring (config/game-balance.json → statusPanel)', () => {
  it('reads the balance file section, not just the defaults', () => {
    expect(CFG.monologue.tickMs).toBe(250);
    expect(CFG.monologue.minGapMs).toBe(9000);
    expect(CFG.monologue.lineCooldownMs).toBe(45000);
    expect(CFG.monologue.bubbleMs).toBe(2600);
    expect(CFG.monologue.triggers.hpRatio).toBe(0.3);
    expect(CFG.monologue.triggers.hungerRatio).toBe(0.25);
    expect(CFG.summary.hpDangerRatio).toBe(0.3);
    expect(CFG.summary.statLowRatio).toBe(0.25);
    expect(CFG.summary.stressHigh).toBe(70);
  });
});

describe('AG-67 monologue table', () => {
  it('holds 20+ lines split across the eight situations', () => {
    expect(MONOLOGUE_LINE_COUNT).toBeGreaterThanOrEqual(20);
  });

  it('every voice covers every trigger, and ids are unique', () => {
    const ids = new Set<string>();
    for (const voice of VOICES) {
      for (const trigger of TRIGGERS) {
        // 表本身不导出，经 chooseMonologue 逐格探：每格至少能挑出一句。
        const picked = chooseMonologue(freshMonologueMemory(), 0, trigger, voice, CFG, rngFirst);
        expect(picked, `${voice}.${trigger} has a line`).not.toBeNull();
        expect(picked?.line.text.length).toBeGreaterThan(0);
        ids.add(picked!.line.id);
      }
    }
    expect(ids.size).toBe(VOICES.length * TRIGGERS.length);
  });

  it('priority order covers every trigger exactly once', () => {
    expect([...MONOLOGUE_TRIGGER_PRIORITY].sort()).toEqual([...TRIGGERS].sort());
  });

  it('maps the meta pick to a voice, unknown picks fall back to the player set', () => {
    expect(monologueVoiceFor('player')).toBe('player');
    expect(monologueVoiceFor('npc_alin')).toBe('alin');
    expect(monologueVoiceFor('npc_xiaozhou')).toBe('xiaozhou');
    expect(monologueVoiceFor('wanderer')).toBe('player');
    expect(monologueVoiceFor('npc_zhouhe')).toBe('player');
    expect(monologueVoiceFor('')).toBe('player');
  });

  it('good loot is the valuable handful, not every pickup', () => {
    expect(isGoodLoot('medkit')).toBe(true);
    expect(isGoodLoot('filter')).toBe(true);
    expect(isGoodLoot('crowbar')).toBe(true);
    expect(isGoodLoot('battery')).toBe(true);
    expect(isGoodLoot('clean_water')).toBe(true);
    expect(isGoodLoot('bread')).toBe(false);
    expect(isGoodLoot('scrap_metal')).toBe(false);
    expect(isGoodLoot('')).toBe(false);
  });
});

describe('AG-67 crossedBelow (threshold crossings)', () => {
  it('fires on the crossing and only on the crossing', () => {
    expect(crossedBelow(0.5, 0.29, 0.3)).toBe(true);
    expect(crossedBelow(0.31, 0.29, 0.3)).toBe(true);
    // 两边都在线上：没跨线
    expect(crossedBelow(0.5, 0.4, 0.3)).toBe(false);
    // 恢复不算跨线
    expect(crossedBelow(0.2, 0.5, 0.3)).toBe(false);
    // 一直在线下不重复触发
    expect(crossedBelow(0.1, 0.05, 0.3)).toBe(false);
  });

  it('the first tick has no previous value and never fires', () => {
    expect(crossedBelow(null, 0.1, 0.3)).toBe(false);
  });

  it('the boundary itself is still safe (>= threshold)', () => {
    expect(crossedBelow(0.3, 0.3, 0.3)).toBe(false);
    expect(crossedBelow(0.300001, 0.299999, 0.3)).toBe(true);
  });
});

describe('AG-67 chooseMonologue (the anti-spam gate)', () => {
  const cfg: StatusPanelBalance = CFG;

  it('speaks on a fresh memory and records the pick', () => {
    const picked = chooseMonologue(freshMonologueMemory(), 1000, 'hp_low', 'player', cfg, rngFirst);
    expect(picked).not.toBeNull();
    expect(picked!.line.id).toBe('player.hp_low.0');
    expect(picked!.memory.lastSpokenAt).toBe(1000);
    expect(picked!.memory.lastLineId).toBe('player.hp_low.0');
    expect(picked!.memory.lineReadyAt['player.hp_low.0']).toBe(1000 + cfg.monologue.lineCooldownMs);
  });

  it('refuses anything inside the global gap', () => {
    const first = chooseMonologue(freshMonologueMemory(), 1000, 'hp_low', 'player', cfg, rngFirst)!;
    // 8.9s later：总闸（9s）还没开
    expect(chooseMonologue(first.memory, 1000 + cfg.monologue.minGapMs - 100, 'hunger_low', 'player', cfg, rngFirst)).toBeNull();
    // 9.1s later：开
    const second = chooseMonologue(first.memory, 1000 + cfg.monologue.minGapMs + 100, 'hunger_low', 'player', cfg, rngFirst);
    expect(second).not.toBeNull();
  });

  it('a line on cooldown is skipped for a fresh one', () => {
    const first = chooseMonologue(freshMonologueMemory(), 1000, 'hp_low', 'player', cfg, rngFirst)!;
    const second = chooseMonologue(first.memory, 20_000, 'hp_low', 'player', cfg, rngFirst)!;
    expect(second.line.id).not.toBe(first.line.id);
    // 被跳过的那句确实进了冷却
    expect(second.memory.lineReadyAt[first.line.id]).toBeGreaterThan(20_000);
  });

  it('refuses when every line of the situation is on cooldown', () => {
    let memory = freshMonologueMemory();
    let now = 1000;
    const spoken: string[] = [];
    for (let i = 0; i < 3; i++) {
      const picked = chooseMonologue(memory, now, 'hp_low', 'player', cfg, rngFirst)!;
      expect(picked).not.toBeNull();
      spoken.push(picked.line.id);
      memory = picked.memory;
      now += cfg.monologue.minGapMs + 1000;
    }
    expect(new Set(spoken).size).toBe(3);
    // 三句全在 45s 冷却里：第 4 次闭嘴
    expect(chooseMonologue(memory, now, 'hp_low', 'player', cfg, rngFirst)).toBeNull();
    // 第一句的冷却到期后允许复读它（单句池的最后手段）
    const later = chooseMonologue(memory, 1000 + cfg.monologue.lineCooldownMs + 1, 'hp_low', 'player', cfg, rngFirst);
    expect(later?.line.id).toBe(spoken[0]);
  });

  it('never repeats the previous line while alternatives exist', () => {
    const first = chooseMonologue(freshMonologueMemory(), 1000, 'good_loot', 'player', cfg, rngFirst)!;
    // rng 恒 0 也挑不到刚说过的那句：备选还有两句
    const second = chooseMonologue(first.memory, 20_000, 'good_loot', 'player', cfg, rngFirst)!;
    expect(second.line.id).not.toBe(first.line.id);
  });

  it('clamps a rogue rng instead of crashing', () => {
    const picked = chooseMonologue(freshMonologueMemory(), 0, 'night_fall', 'player', cfg, () => 1);
    expect(picked).not.toBeNull();
  });
});

describe('AG-67 statusSummaryLine (the card\'s one-liner)', () => {
  const full = { hp: 100, hunger: 80, thirst: 80, energy: 80, stress: 20 };
  const cfg = CFG;

  it('says 状态尚可 when nothing is wrong', () => {
    expect(statusSummaryLine(full, cfg)).toEqual({ text: '状态尚可', tone: 'ok' });
  });

  it('hp outranks everything', () => {
    const s = statusSummaryLine({ ...full, hp: 29, hunger: 10, thirst: 10, energy: 10 }, cfg);
    expect(s).toEqual({ text: '伤痕累累，得处理下了', tone: 'danger' });
  });

  it('starving and parched together is its own line', () => {
    const s = statusSummaryLine({ ...full, hunger: 20, thirst: 20 }, cfg);
    expect(s).toEqual({ text: '又饿又渴，撑不了多久', tone: 'danger' });
  });

  it('each single failing stat has its own line, in a fixed order', () => {
    expect(statusSummaryLine({ ...full, hunger: 20 }, cfg).text).toBe('饥肠辘辘');
    expect(statusSummaryLine({ ...full, thirst: 20 }, cfg).text).toBe('口干舌燥');
    expect(statusSummaryLine({ ...full, energy: 20 }, cfg).text).toBe('疲惫不堪');
    expect(statusSummaryLine({ ...full, stress: 90 }, cfg).text).toBe('心力交瘁');
    expect(statusSummaryLine({ ...full, hunger: 20 }, cfg).tone).toBe('warn');
  });

  it('the threshold itself is still fine (strictly below counts)', () => {
    expect(statusSummaryLine({ ...full, hp: 30 }, cfg).text).toBe('状态尚可');
    expect(statusSummaryLine({ ...full, hp: 29.9 }, cfg).text).toBe('伤痕累累，得处理下了');
    expect(statusSummaryLine({ ...full, hunger: 25 }, cfg).text).toBe('状态尚可');
    expect(statusSummaryLine({ ...full, hunger: 24.9 }, cfg).text).toBe('饥肠辘辘');
    expect(statusSummaryLine({ ...full, stress: 70 }, cfg).text).toBe('心力交瘁');
    expect(statusSummaryLine({ ...full, stress: 69.9 }, cfg).text).toBe('状态尚可');
  });

  it('a missing stress reads as the default 20, not a crisis', () => {
    const { stress: _dropped, ...noStress } = full;
    expect(statusSummaryLine(noStress, cfg).text).toBe('状态尚可');
  });
});

describe('AG-67 status card lane contract (hudLayout keys)', () => {
  const hud = HUD_LAYOUT;
  const right = hud.statusCardX + hud.statusCardW;
  const bottom = hud.statusCardY + hud.statusCardH;

  it('hangs in the right-bottom lane, on canvas', () => {
    // 与按钮行同一个 16px 右边距，不出画布
    expect(right).toBe(DESIGN_WIDTH - 16);
    expect(hud.statusCardX).toBeGreaterThan(0);
    expect(bottom).toBeLessThanOrEqual(DESIGN_HEIGHT);
  });

  it('never prints through the lanes it shares the corner with', () => {
    // 底边压在 feedback 车道上沿；按钮行（DESIGN_HEIGHT-56）与脚条都在下面
    expect(bottom).toBe(hud.feedbackY);
    expect(bottom).toBeLessThan(DESIGN_HEIGHT - 56);
    // 顶边在顶部铆钉板（contextBottom）之下
    expect(hud.statusCardY).toBeGreaterThan(hud.contextBottom);
    // 与金币/分数段（row1Y..row1Y+53）不同带，不压钱
    expect(hud.statusCardY).toBeGreaterThan(hud.row1Y + 53);
  });

  it('keeps the four stat rows and the summary inside the card', () => {
    const lastRow = hud.statusRowFirstCY + 3 * hud.statusRowPitch;
    expect(lastRow).toBeLessThan(bottom - 8);
    expect(hud.statusSummaryCY).toBeGreaterThan(lastRow);
    expect(hud.statusSummaryCY).toBeLessThan(bottom - 4);
    // 行内：label + bar + value 不超出卡宽
    expect(hud.statusRowBarX + hud.statusRowBarW).toBeLessThan(hud.statusCardW - 12);
  });

  it('leaves the top plate\'s own lanes untouched (AG-54 regression guard)', () => {
    expect(hud.statX + 3 * hud.statPitch + hud.statWidth).toBeLessThan(hud.moneyX);
    expect(hud.contextBottom).toBeLessThan(hud.feedbackY);
  });
});
