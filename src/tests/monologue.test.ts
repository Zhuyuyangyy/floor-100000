import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MONOLOGUE_LINE_COUNT,
  MONOLOGUE_TRIGGER_PRIORITY,
  STATUS_PANEL_BALANCE,
  chooseMonologue,
  crossedBelow,
  freshMonologueMemory,
  isGoodLoot,
  monologueRng,
  monologueVoiceFor,
  statusSummaryLine,
  type MonologueTrigger,
  type MonologueVoice,
  type StatusPanelBalance,
} from '../data/monologue';
import { HUD_LAYOUT } from '../render/hudLayout';

// AG-67 单测：角色自言自语。纯函数层（台词表、节流门、处境摘要），Phaser
// 渲染由 e2e（ag67-status.spec.ts）实测。2026-11-19 用户裁决拆除右下常驻
// 状态卡后，卡片车道契约 describe 退役，AG-54 顶带守卫独立保留。

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

// statusSummaryLine 是纯函数（原状态卡摘要句的数据源）。卡已拆除，函数与
// 契约测试保留——摘要文案表仍是独白台词体系的同源数据，未来面板可复用。
describe('AG-67 statusSummaryLine (the situational one-liner)', () => {
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

// 原「AG-67 status card lane contract」describe 随卡退役（2026-11-19）：
// statusCard*/statusRow*/statusSummaryCY 键已从 hudLayout 删除。其中与卡
// 无关的 AG-54 顶带守卫独立保留如下。
describe('AG-54 top plate lane guard (regression)', () => {
  const hud = HUD_LAYOUT;

  it('leaves the top plate\'s own lanes untouched', () => {
    expect(hud.statX + 3 * hud.statPitch + hud.statWidth).toBeLessThan(hud.moneyX);
    expect(hud.contextBottom).toBeLessThan(hud.feedbackY);
  });
});

// AG-67 确定性（外部审查 P2 修复的回归钉子）：选句随机曾直接传 Math.random，
// 违反 CLAUDE.md「世界生成与事件判定禁 Math.random」。现在走
// monologueRng——(runSeed, day, floor, trigger, 已飘字数) 的派生 rng。这里钉
// 三件事：同 seed 重放一致（连开两局同一触发点选同一句）、不同 seed 有变化
// （确定性但不恒定）、异常 seed 不崩；外加行为探针与源码断言。
describe('AG-67 monologue determinism (seeded pick, no Math.random)', () => {
  const cfg: StatusPanelBalance = CFG;

  /** 一局里的自言自语序列：memory 递进、已飘字数递增，与 GameScene 同构。 */
  function replaySession(seed: number): string[] {
    let memory = freshMonologueMemory();
    let spokenCount = 0;
    let now = 1000;
    const said: string[] = [];
    const script: MonologueTrigger[] = [
      'hp_low',
      'hunger_low',
      'night_fall',
      'good_loot',
      'hp_low',
      'combat_win',
      'new_floor',
      'thirst_low',
      'energy_low',
      'good_loot',
    ];
    for (const trigger of script) {
      const rng = monologueRng(seed, 1, 1, trigger, spokenCount);
      const picked = chooseMonologue(memory, now, trigger, 'player', cfg, rng);
      if (picked) {
        said.push(picked.line.id);
        memory = picked.memory;
        spokenCount += 1;
        now += cfg.monologue.minGapMs + 1000;
      }
    }
    return said;
  }

  it('same seed, two runs: the same trigger point picks the same line', () => {
    // 连开两局：同一 seed、同一脚本，逐句一致——回放可复现。
    const runA = replaySession(20261118);
    const runB = replaySession(20261118);
    expect(runA.length).toBeGreaterThan(3); // 脚本真的说出了不少句，别 vacuously 过
    expect(runB).toEqual(runA);
  });

  it('same seed: the first pick at a trigger point is stable across calls', () => {
    for (const trigger of TRIGGERS) {
      const pick = (): string =>
        chooseMonologue(freshMonologueMemory(), 1000, trigger, 'player', cfg, monologueRng(777, 3, 5, trigger, 0))!.line.id;
      expect(pick(), trigger).toBe(pick());
    }
  });

  it('different seeds can produce different lines — deterministic, not constant', () => {
    // 每个处境扫 48 个 seed：同一点位必须能选出至少两种句子（钉「不恒定」）。
    for (const trigger of TRIGGERS) {
      const picks = new Set<string>();
      for (let seed = 1; seed <= 48; seed++) {
        const rng = monologueRng(seed, 1, 1, trigger, 0);
        picks.add(chooseMonologue(freshMonologueMemory(), 1000, trigger, 'player', cfg, rng)!.line.id);
      }
      expect(picks.size, `${trigger} 的选句应随 seed 变化`).toBeGreaterThan(1);
    }
  });

  it('different seeds: whole sessions are not all identical', () => {
    const sessions = new Set<string>();
    for (let seed = 1; seed <= 24; seed++) sessions.add(JSON.stringify(replaySession(seed)));
    expect(sessions.size).toBeGreaterThan(1);
  });

  it('day/floor/spoken move the pick (the derivation is real, not a constant)', () => {
    const lineAt = (day: number, floor: number, spoken: number): string =>
      chooseMonologue(freshMonologueMemory(), 1000, 'hp_low', 'player', cfg, monologueRng(42, day, floor, 'hp_low', spoken))!.line.id;
    const seen = new Set<string>();
    for (const day of [1, 2, 3]) for (const floor of [1, 2, 3]) for (const spoken of [0, 1, 2]) {
      seen.add(lineAt(day, floor, spoken));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('rogue seeds never crash the pick (NaN / negative / zero / huge / fractional)', () => {
    const rogue: Array<[string, number]> = [
      ['NaN', Number.NaN],
      ['negative', -1],
      ['zero', 0],
      ['huge', 2 ** 32],
      ['fractional', 1.5],
      ['Infinity', Number.POSITIVE_INFINITY],
    ];
    for (const [label, seed] of rogue) {
      const rng = monologueRng(seed, 1, 1, 'hp_low', 0);
      const picked = chooseMonologue(freshMonologueMemory(), 1000, 'hp_low', 'player', cfg, rng);
      expect(picked, label).not.toBeNull();
      expect(picked!.line.text.length, label).toBeGreaterThan(0);
    }
  });

  it('rogue day/floor/spoken values never crash either', () => {
    const rng = monologueRng(7, Number.NaN, -3, 'night_fall', Number.NEGATIVE_INFINITY);
    expect(() => chooseMonologue(freshMonologueMemory(), 1000, 'night_fall', 'player', cfg, rng)).not.toThrow();
    expect(chooseMonologue(freshMonologueMemory(), 1000, 'night_fall', 'player', cfg, rng)).not.toBeNull();
  });

  it('the pick never touches Math.random (probe: one call throws)', () => {
    // 行为探针：重放期间任何一次 Math.random 都直接炸——选句链路的确定性不
    // 靠「今天没走到」，靠「走到就抛」。
    const original = Math.random;
    Math.random = (): number => {
      throw new Error('自言自语选句禁 Math.random：必须走 monologueRng 派生');
    };
    try {
      expect(() => replaySession(4242)).not.toThrow();
      expect(replaySession(4242).length).toBeGreaterThan(3);
    } finally {
      Math.random = original;
    }
  });

  it('控制器的选句站点已接派生 rng、不再出现 Math.random（源码断言）', () => {
    // RC-03 拆分第 2 步：选句站点随面板 ticker 迁入 MonologueController
    // （原 GameScene.speakMonologue→私有 speak）——断言改盯控制器文件，
    // 守护的不变量没变：选句必须走 monologueRng 派生、禁 Math.random。
    const src = readFileSync(join(process.cwd(), 'src/scenes/controllers/MonologueController.ts'), 'utf8');
    const site = src.slice(src.indexOf('private speak('), src.indexOf('private spawnBubble('));
    expect(site).toContain('monologueRng(state.runSeed');
    // 旧的违规调用（chooseMonologue 第六参直接收 Math.random）必须绝迹；
    // 注释里出现「Math.random」字样是文档，不算违规——所以按调用模式断言。
    expect(site, '选句站点禁把 Math.random 传给 chooseMonologue').not.toContain('STATUS_PANEL_BALANCE, Math.random');
    expect(site).toContain('STATUS_PANEL_BALANCE, rng)');
  });
});
