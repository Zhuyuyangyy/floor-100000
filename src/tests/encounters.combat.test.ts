import { describe, expect, it } from 'vitest';

import {
  COMBAT_KINDS,
  combatIntroMessage,
  combatMonsterId,
  isCombatKind,
  rollEncounter,
  resolveEncounter,
} from '../systems/encounters';
import { createNewGame } from '../core/gameState';

// OVERHAUL Wave A：战斗型遭遇的路由面。旧有的 resolveEncounter 单 roll 路径
// 对 ambush/boss 仍然有效（非战斗模式的 fallback），这些测试钉住新加法不破坏
// 旧行为，同时锁定 GameScene 接线要用的三个新导出。

describe('combat encounter routing (Wave A)', () => {
  it('declares exactly the two combat kinds', () => {
    expect([...COMBAT_KINDS]).toEqual(['ambush', 'boss']);
  });

  it('routes every kind correctly', () => {
    const all = ['loot', 'ambush', 'trader', 'note', 'cache', 'boss'] as const;
    expect(all.filter(isCombatKind)).toEqual(['ambush', 'boss']);
    for (const k of all) expect(isCombatKind(k)).toBe(k === 'ambush' || k === 'boss');
  });

  it('gives ambush no fixed monster and boss the 900 guardian', () => {
    expect(combatMonsterId('ambush')).toBe(0);
    expect(combatMonsterId('boss')).toBe(900);
  });

  it('writes the intro line with the monster name in it', () => {
    const ambush = combatIntroMessage('ambush', '拾荒者');
    const boss = combatIntroMessage('boss', '守门人');
    expect(ambush).toContain('拾荒者');
    expect(boss).toContain('守门人');
    expect(ambush).not.toBe(boss);
    // Boss 的文案要说「无路可退」——它是守楼关底，不是路边遭遇。
    expect(boss).toContain('无路可退');
  });

  it('keeps the legacy single-roll path working for ambush', () => {
    // 非战斗模式（例如未来的简单模式）仍然走一次性判定，这条保险钉住它。
    const s = createNewGame(42);
    const enc = rollEncounter(s, 3, '3:spot0');
    const forced = { ...enc, kind: 'ambush' as const };
    const r = resolveEncounter(s, forced, 'flee');
    expect(r.consumed).toBe(true);
    expect(r.hpChange).toBeLessThanOrEqual(0);
    expect(r.message.length).toBeGreaterThan(0);
  });
});
