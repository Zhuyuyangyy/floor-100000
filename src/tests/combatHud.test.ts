import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// AG-63（战斗 HUD + debuff 绿光提示）的单元测试。
//
// 钉三件事：
//   1. 战斗脚注怎么回答「用什么攻击」——武器名按 COMBAT_WEAPON_PRIORITY 取
//      包里最重的一件，伤害数走 playerCombatant 的真口径（撬棍 +3，其余按
//      空手），两个数都对得上引擎，不另养一套；
//   2. debuff 提示文案——绿光出现/消失各一句、左下角常驻标记的三种形态，
//      全部纯函数，场景每帧画的就是这些返回值；
//   3. 场景接线（源码断言）——flash 挂在边沿上而非每帧、标记挂在脚注条上方
//      的 debuffMark 键上、面板攻击行与血条行真的调用这些纯函数。
//      运行期行为（光在不在、字在不在）由 Playwright 实测（ag63 spec）。
//
// GameScene 的导入：vitest 跑在 node 环境，而 GameScene 的模块图里有 Phaser。
// 模块体只在运行期碰 Phaser，导入期一个都不碰——所以一个「可调用可构造」的
// 桩就够把整张模块图求值到导出表。桩只在本文件内生效（与
// labelsAndView.test.ts 同款），不碰共享 vitest.config。

vi.mock('phaser', () => {
  const anyThing = new Proxy(function () {}, {
    get: () => anyThing,
    apply: () => ({}),
    construct: () => ({}),
  });
  return { default: anyThing };
});

import { createNewGame } from '../core/gameState';
import { addItem } from '../systems/InventorySystem';
import { playerCombatant } from '../systems/combat';
import {
  DEBUFF_CLEARED_MESSAGE,
  combatBehaviorLabel,
  combatFootHint,
  combatWeaponLabel,
  debuffEnterMessage,
  debuffMarkLabel,
} from '../scenes/GameScene';
import { HUD_LAYOUT } from '../render/hudLayout';
import { DESIGN_HEIGHT } from '../core/design';
import { HUD_FOOT_H, TYPE, fontLineBox } from '../render/uiKit';
import type { ItemId } from '../core/gameTypes';

const SCENE_SRC = readFileSync(join(process.cwd(), 'src/scenes/GameScene.ts'), 'utf8');

/** 一个只装了给定物品的槽位表——武器判定只读 itemId。 */
function slotsOf(...ids: string[]): Array<{ itemId: string }> {
  return ids.map((itemId) => ({ itemId }));
}

describe('combatWeaponLabel — 包里有什么就报什么', () => {
  it('一件武器都没有时是空手', () => {
    expect(combatWeaponLabel(slotsOf())).toBe('空手');
    expect(combatWeaponLabel(slotsOf('bread', 'scrap_metal', 'flashlight'))).toBe('空手');
  });

  it('五件武器各有各的名字', () => {
    expect(combatWeaponLabel(slotsOf('crowbar'))).toBe('撬棍');
    expect(combatWeaponLabel(slotsOf('dagger'))).toBe('匕首');
    expect(combatWeaponLabel(slotsOf('short_sword'))).toBe('短剑');
    expect(combatWeaponLabel(slotsOf('cleaver'))).toBe('砍刀');
    expect(combatWeaponLabel(slotsOf('fire_axe'))).toBe('消防斧');
  });

  it('撬棍压过一切：它是唯一接进伤害口径的武器，也是幸存者手里挥的那件', () => {
    expect(combatWeaponLabel(slotsOf('dagger', 'crowbar', 'fire_axe'))).toBe('撬棍');
  });

  it('没有撬棍时报最重的刃具，而不是随便一件', () => {
    expect(combatWeaponLabel(slotsOf('dagger', 'short_sword'))).toBe('短剑');
    expect(combatWeaponLabel(slotsOf('cleaver', 'dagger'))).toBe('砍刀');
    expect(combatWeaponLabel(slotsOf('fire_axe', 'cleaver'))).toBe('消防斧');
  });
});

describe('combatFootHint — 左下角那句战斗提示', () => {
  it('先答「用什么攻击」，再给三个动作的键', () => {
    const hint = combatFootHint('撬棍', 7);
    expect(hint.startsWith('当前武器：撬棍（伤害 7）')).toBe(true);
    expect(hint).toContain('Enter 出招');
    expect(hint).toContain('↑/↓ 选择');
    expect(hint).toContain('ESC 撤退');
  });

  it('空手也照实说', () => {
    expect(combatFootHint('空手', 4)).toContain('当前武器：空手（伤害 4）');
  });

  it('伤害数与 playerCombatant 同源：裸装 4，撬棍 7', () => {
    // XP-1（2026-11-18）：裸装 2→4、撬棍 5→7（RC-02 前段刮痧修复）。
    // 数值现走 config/game-balance.json 的 combat 段；这里钉「同源」这一
    // 契约，具体数以 balance 文件为准。
    const bare = createNewGame(42);
    expect(playerCombatant(bare).damage).toBe(4);
    expect(combatFootHint(combatWeaponLabel(bare.player.inventory.slots), playerCombatant(bare).damage)).toBe(
      '当前武器：空手（伤害 4）· Enter 出招 · ↑/↓ 选择 · ESC 撤退',
    );
    addItem(bare.player.inventory, 'crowbar' as ItemId, 1);
    expect(playerCombatant(bare).damage).toBe(7);
    expect(combatFootHint(combatWeaponLabel(bare.player.inventory.slots), playerCombatant(bare).damage)).toBe(
      '当前武器：撬棍（伤害 7）· Enter 出招 · ↑/↓ 选择 · ESC 撤退',
    );
  });
});

describe('combatBehaviorLabel — 敌人类型那半个字', () => {
  it('七种行为各有能拿去决策的词', () => {
    expect(combatBehaviorLabel('normal')).toBe('普通');
    expect(combatBehaviorLabel('fast')).toBe('迅捷');
    expect(combatBehaviorLabel('slow')).toBe('笨重');
    expect(combatBehaviorLabel('ranged')).toBe('远程');
    expect(combatBehaviorLabel('ambusher')).toBe('伏击');
    expect(combatBehaviorLabel('coward')).toBe('怯战');
    expect(combatBehaviorLabel('brute')).toBe('蛮力');
  });

  it('未知值退回「普通」而不是抛异常', () => {
    expect(combatBehaviorLabel('')).toBe('普通');
    expect(combatBehaviorLabel('dig')).toBe('普通');
  });
});

describe('debuff 文案 — 给那片绿光一个名字', () => {
  it('进入时按饥饿/口渴/两者点不同的名，且都点到绿光', () => {
    const hungryOnly = debuffEnterMessage(true, false);
    const parchedOnly = debuffEnterMessage(false, true);
    const both = debuffEnterMessage(true, true);
    for (const line of [hungryOnly, parchedOnly, both]) {
      expect(line).toContain('绿光');
    }
    expect(hungryOnly).toContain('吃的');
    expect(parchedOnly).toContain('水');
    expect(both).toContain('又饿又渴');
  });

  it('退出时是另一句，且与进入文案不同名', () => {
    expect(DEBUFF_CLEARED_MESSAGE).toContain('缓过来');
    expect(DEBUFF_CLEARED_MESSAGE).not.toBe(debuffEnterMessage(false, false));
  });

  it('常驻标记三种形态：饥饿 / 干渴 / 又饿又渴', () => {
    expect(debuffMarkLabel(true, false)).toBe('状态：饥饿');
    expect(debuffMarkLabel(false, true)).toBe('状态：干渴');
    expect(debuffMarkLabel(true, true)).toBe('状态：又饿又渴');
  });
});

describe('HUD_LAYOUT.debuffMark — 左下角那一根线的位置契约', () => {
  it('与脚注条同一条左边缘', () => {
    // hud-hint 创建于 x=8（origin 0）。标记压在它正上方，读起来像脚注条
    // 自己的状态行，而不是又一块新板子。
    expect(HUD_LAYOUT.debuffMarkX).toBe(8);
  });

  it('盒体夹在「背包已满」lane 与脚注条之间，两边都不进', () => {
    const box = fontLineBox(TYPE.caption); // caption 的行盒，25
    const bagBottom = HUD_LAYOUT.bagY + box + 6; // bagFullText：行盒 + padding y:3
    const hintTop = DESIGN_HEIGHT - HUD_FOOT_H / 2 - box / 2; // hud-hint 的盒顶
    expect(HUD_LAYOUT.debuffMarkY - box / 2).toBeGreaterThanOrEqual(bagBottom);
    expect(HUD_LAYOUT.debuffMarkY + box / 2).toBeLessThanOrEqual(hintTop - 6);
  });
});

// ── 场景接线（源码断言） ──────────────────────────────────────────────────
// 纯函数答得好不够，场景真的调用它们、且调用点长对了才行。运行期证据在
// e2e/ag63-combat-hud.spec.ts（截图 + getBounds）。
describe('GameScene AG-63 wiring', () => {
  it('战斗脚注走纯函数，武器与伤害都从真来源读', () => {
    expect(SCENE_SRC).toContain(
      'return combatFootHint(combatWeaponLabel(state.player.inventory.slots), playerCombatant(state).damage);',
    );
  });

  it('debuff 的 flash 挂在边沿上，不是每帧刷', () => {
    expect(SCENE_SRC).toContain('if (starving !== this.debuffAnnounced) {');
    expect(SCENE_SRC).toContain('this.flash(starving ? debuffEnterMessage(hungry, parched) : DEBUFF_CLEARED_MESSAGE);');
  });

  it('绿光特效本身保留，且场景重启后的陈旧 sprite 被当不存在', () => {
    expect(SCENE_SRC).toContain("startFxLoop(this, 'poisoned'");
    expect(SCENE_SRC).toContain('if (this.debuffFx && !this.debuffFx.scene) {');
  });

  it('常驻标记创建在脚注条上方，由 debuff 块驱动显隐', () => {
    expect(SCENE_SRC).toContain(".setName('hud-debuff-mark')");
    expect(SCENE_SRC).toContain('const label = debuffMarkLabel(hungry, parched);');
  });

  it('面板自己也不再说「造成武器伤害」这种废话', () => {
    expect(SCENE_SRC).toContain('${combatWeaponLabel(state.player.inventory.slots)} · 伤害 ${playerCombatant(state).damage}');
    expect(SCENE_SRC).not.toContain("'造成武器伤害'");
    expect(SCENE_SRC).toContain('combatBehaviorLabel(combat.monster.behavior)');
  });
});
