import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { addItem } from '../systems/InventorySystem';
import type { GameState } from '../core/gameTypes';
import {
  MAX_UTTERANCE,
  MIN_CONFIDENCE,
  sanitizeUtterance,
  validateProposal,
  type NpcFact,
} from './rulesExecutor';
import type { NpcActionProposal } from './types';

// 规则执行器测试：AI 的一切越界建议都必须在这里被拒（RFC §4 护栏 1）。
// 全部用 createNewGame 真实状态，不手搓半成品状态，避免测出一个
// 「只在夹具里成立」的执行器。

function game(overrides: Partial<GameState> = {}): GameState {
  const state = createNewGame(7);
  return { ...state, ...overrides };
}

const alin: NpcFact = {
  id: 'alin',
  archetype: 'ally',
  floor: 2,
  x: 480,
  hp: 30,
  // 阿林的静态持有：电线×2（由报价表推导，见 npcInventory.ts）
  inventory: [{ itemId: 'wire', quantity: 2 }],
};

const wanderer: NpcFact = {
  id: 'wanderer',
  archetype: 'hostile',
  floor: 2,
  x: 480,
  hp: 40,
  inventory: [],
};

function proposal(overrides: Partial<NpcActionProposal> = {}): NpcActionProposal {
  return { action: { type: 'refuse' }, confidence: 0.9, ...overrides };
}

describe('validateProposal：低置信度与畸形输入', () => {
  it('置信度低于阈值一律拒绝', () => {
    const result = validateProposal(game(), alin, proposal({ confidence: MIN_CONFIDENCE - 0.01 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('置信度越界');
  });

  it('confidence 不是数字时拒绝而不是抛错', () => {
    const bad = proposal({ confidence: Number.NaN });
    const result = validateProposal(game(), alin, bad);
    expect(result.ok).toBe(false);
  });

  it('未知 action.type 拒绝', () => {
    const bad = { action: { type: 'mind_control' }, confidence: 1 } as unknown as NpcActionProposal;
    const result = validateProposal(game(), alin, bad);
    expect(result.ok).toBe(false);
    // 白名单先于 switch 命中：未知类型同样不在任何原型的允许集里
    if (!result.ok) expect(result.reason).toContain('不允许 mind_control');
  });
});

describe('validateProposal：无条件合法动作', () => {
  it('dialogue / refuse 对合作型放行，flee 只有敌对型有', () => {
    for (const type of ['dialogue', 'refuse'] as const) {
      const result = validateProposal(game(), alin, proposal({ action: { type, ...(type === 'dialogue' ? { text: '' } : {}) } as NpcActionProposal['action'] }));
      expect(result.ok).toBe(true);
    }
    // ally 的白名单里没有 flee——合作型不临阵脱逃
    expect(validateProposal(game(), alin, proposal({ action: { type: 'flee' } })).ok).toBe(false);
    const hostileGame = game({
      currentFloor: 2,
      worldEvents: {
        history: [],
        activeEvent: { type: 'wanderer', floor: 2, source: 'night', status: 'active', message: 'test' },
      },
    });
    expect(validateProposal(hostileGame, { ...wanderer, event: {
      type: 'wanderer', floor: 2, source: 'night', status: 'active', distance: 120, playerX: 600, npcX: 480,
    } }, proposal({ action: { type: 'flee' } })).ok).toBe(true);
    const silent = validateProposal(game(), alin, proposal({ action: { type: 'dialogue', text: '你好' } }));
    expect(silent.ok).toBe(true);
    if (silent.ok && silent.action.type === 'dialogue') expect(silent.action.text).toBe('你好');
  });

  it('dialogue 没有文本时落占位台词，交互不卡死', () => {
    const result = validateProposal(game(), alin, proposal({ action: { type: 'dialogue', text: '' } }));
    expect(result.ok).toBe(true);
    if (result.ok && result.action.type === 'dialogue') expect(result.action.text).toBe('……');
  });
});

describe('validateProposal：交易必须过现有守恒规则', () => {
  it('NPC 有货、玩家有钱付：放行', () => {
    const state = game();
    addItem(state.player.inventory, 'scrap_metal', 1);
    const result = validateProposal(
      state,
      alin,
      proposal({
        action: { type: 'trade', give: { itemId: 'wire', quantity: 1 }, get: { itemId: 'scrap_metal', quantity: 1 } },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('NPC 没有的货：拒绝（AI 不能虚空造物）', () => {
    const state = game();
    const result = validateProposal(
      state,
      alin,
      proposal({
        action: { type: 'trade', give: { itemId: 'battery', quantity: 1 }, get: { itemId: 'scrap_metal', quantity: 1 } },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('NPC 没有');
  });

  it('玩家付不起：拒绝', () => {
    const state = game();
    const result = validateProposal(
      state,
      alin,
      proposal({
        action: { type: 'trade', give: { itemId: 'wire', quantity: 1 }, get: { itemId: 'scrap_metal', quantity: 1 } },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('玩家没有');
  });

  it('数量非正整数：拒绝', () => {
    const state = game();
    addItem(state.player.inventory, 'scrap_metal', 5);
    const result = validateProposal(
      state,
      alin,
      proposal({
        action: { type: 'trade', give: { itemId: 'wire', quantity: 0 }, get: { itemId: 'scrap_metal', quantity: 1 } },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('数量无效');
  });
});

describe('validateProposal：攻击只在既有危险窗口内放行', () => {
  it('非敌对原型永远不能提议攻击（原型白名单先于窗口判定）', () => {
    const night = game({ gameMinuteOfDay: 1320 }); // 22:00，夜间
    const result = validateProposal(night, alin, proposal({ action: { type: 'attack' } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('原型 ally 不允许 attack');
  });

  it('敌对原型在白天无停留压力时不能攻击', () => {
    const noon = game({ gameMinuteOfDay: 720, currentFloor: 2 });
    const result = validateProposal(noon, wanderer, proposal({ action: { type: 'attack' } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('敌对行为窗口');
  });

  it('敌对原型在夜间放行', () => {
    const night = game({ gameMinuteOfDay: 1320, currentFloor: 2 });
    const result = validateProposal(night, wanderer, proposal({ action: { type: 'attack' } }));
    expect(result.ok).toBe(true);
  });

  it('白天 + 该层有停留压力也放行（复用 dwell 规则，不自造窗口）', () => {
    const state = game({
      gameMinuteOfDay: 720,
      currentFloor: 2,
      worldEvents: { history: [], activeEvent: null, dwell: { floor: 2, minutes: 90, nextRollAt: 600, rolls: 2 } },
    });
    const result = validateProposal(state, wanderer, proposal({ action: { type: 'attack' } }));
    expect(result.ok).toBe(true);
  });

  it('停留压力在别的层时不放行', () => {
    const state = game({
      gameMinuteOfDay: 720,
      worldEvents: { history: [], activeEvent: null, dwell: { floor: 3, minutes: 90, nextRollAt: 600, rolls: 2 } },
    });
    const result = validateProposal(state, wanderer, proposal({ action: { type: 'attack' } }));
    expect(result.ok).toBe(false);
  });
});

describe('sanitizeUtterance', () => {
  it('去掉控制字符并截断超长台词', () => {
    expect(sanitizeUtterance('你\u0000好\u001f')).toBe('你好');
    const long = '啊'.repeat(MAX_UTTERANCE + 10);
    expect(sanitizeUtterance(long)?.length).toBe(MAX_UTTERANCE);
  });

  it('空白字符串返回 undefined', () => {
    expect(sanitizeUtterance('   ')).toBeUndefined();
    expect(sanitizeUtterance(undefined)).toBeUndefined();
  });
});
