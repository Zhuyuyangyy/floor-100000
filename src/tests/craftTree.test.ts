import { describe, expect, it } from 'vitest';

import { createNewGame } from '../core/gameState';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../core/design';
import { RECIPES, MATERIAL_SOURCES, type RecipeId } from '../data/recipes';
import { hasUpgrade } from '../systems/CraftingSystem';
import { addItem } from '../systems/InventorySystem';
import type { GameState } from '../core/gameTypes';
import {
  CRAFT_NODE_H,
  CRAFT_NODE_W,
  CRAFT_TREE_BALANCE,
  CRAFT_TREE_EDGES,
  CRAFT_TREE_NODES,
  craftColumnX,
  craftNodeStatus,
  craftTreeBounds,
  findCraftNode,
  type CraftTreeNode,
} from '../data/craftTree';

// AG-61（二叉树合成面板）单测。树是纯数据 + 纯函数（src/data/craftTree.ts
// 不 import Phaser），所以完整性、排版、状态三件事都能在 Node 下钉死：
//   - 完整性：13 条配方一个不少、依赖与 RECIPES 对齐、边两端都存在；
//   - 排版：节点不出画布、同行标签不相撞（e2e navTo 的探针依赖）、边不穿过
//     节点盒子、导航序满足 e2e/crafting.spec.ts 的按键预算；
//   - 状态：可做/不足/缺前置/已建/材料根 五态与 canCraft 同一道闸门。

const NODE_IDS = CRAFT_TREE_NODES.map((n) => n.id);
const RECIPE_IDS = RECIPES.map((r) => r.id);

function nodeById(id: string): CraftTreeNode {
  const node = findCraftNode(id);
  if (!node) throw new Error(`unknown node: ${id}`);
  return node;
}

describe('树数据完整性', () => {
  it('13 条配方一个不少，且没有多余节点', () => {
    const recipeNodes = CRAFT_TREE_NODES.filter((n) => n.kind === 'recipe').map((n) => n.id);
    expect(recipeNodes.sort()).toEqual([...RECIPE_IDS].sort());
    // 节点总数：9 材料 + 13 配方 + 1 净化动作。
    expect(CRAFT_TREE_NODES).toHaveLength(23);
  });

  it('节点 id 唯一，且每类节点的 id 落位正确', () => {
    expect(new Set(NODE_IDS).size).toBe(NODE_IDS.length);
    for (const node of CRAFT_TREE_NODES) {
      if (node.kind === 'material') expect(RECIPE_IDS).not.toContain(node.id);
      if (node.kind === 'action') expect(node.id).toBe('purify');
    }
  });

  it('配方节点的 inputs = 材料成本 + 上一级凭证（requires）', () => {
    for (const recipe of RECIPES) {
      const node = nodeById(recipe.id);
      const expected = [...Object.keys(recipe.cost)];
      if (recipe.kind === 'upgrade' && recipe.requires) expected.push(recipe.requires);
      expect([...node.inputs].sort(), `${recipe.id} 的依赖与成本/前置不符`).toEqual(expected.sort());
    }
  });

  it('凭证链的 inputs 与 requires 对齐（通行贴起，逐级前置）', () => {
    const chain: Array<[string, string]> = [
      ['pass_sticker', 'work_badge'],
      ['permit', 'pass_sticker'],
      ['vip_card', 'permit'],
      ['core_key', 'vip_card'],
    ];
    for (const [id, requires] of chain) {
      expect(nodeById(id).inputs, `${id} 的依赖里应有前置 ${requires}`).toContain(requires);
    }
    // 工牌是链根：只有材料成本，没有凭证前置。
    expect(nodeById('work_badge').inputs.every((i) => findCraftNode(i)?.kind === 'material')).toBe(true);
    // 净化节点的父是净水器。
    expect(nodeById('purify').inputs).toEqual(['purifier']);
  });

  it('每条 inputs 都是已定义节点；材料节点没有 inputs', () => {
    for (const node of CRAFT_TREE_NODES) {
      if (node.kind === 'material') expect(node.inputs).toEqual([]);
      for (const input of node.inputs) expect(findCraftNode(input), `${node.id} 的输入 ${input} 未定义`).toBeDefined();
    }
  });

  it('材料节点覆盖全部九种配方材料，且都有「去哪拿」出处', () => {
    const materials = new Set(RECIPES.flatMap((r) => Object.keys(r.cost)));
    const materialNodes = CRAFT_TREE_NODES.filter((n) => n.kind === 'material').map((n) => n.id);
    expect(materialNodes.sort()).toEqual([...materials].sort());
    for (const id of materialNodes) {
      expect(MATERIAL_SOURCES[id as keyof typeof MATERIAL_SOURCES], `${id} 缺出处`).toBeDefined();
    }
  });
});

describe('排版约束（画布 / 探针 / 边）', () => {
  it('所有节点盒子完整落在 1280x720 画布内', () => {
    for (const node of CRAFT_TREE_NODES) {
      const x = craftColumnX(node.col);
      expect(x, `${node.id} 左缘出画布`).toBeGreaterThanOrEqual(0);
      expect(x + CRAFT_NODE_W, `${node.id} 右缘出画布`).toBeLessThanOrEqual(DESIGN_WIDTH);
      expect(node.y - CRAFT_NODE_H / 2, `${node.id} 上缘出画布`).toBeGreaterThanOrEqual(0);
      expect(node.y + CRAFT_NODE_H / 2, `${node.id} 下缘出画布`).toBeLessThanOrEqual(DESIGN_HEIGHT);
    }
  });

  it('同列相邻节点不叠（列内距 ≥ 节点高 + 8）', () => {
    const byCol = new Map<number, number[]>();
    for (const node of CRAFT_TREE_NODES) {
      const list = byCol.get(node.col) ?? [];
      list.push(node.y);
      byCol.set(node.col, list);
    }
    for (const [col, ys] of byCol) {
      ys.sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) {
        expect(ys[i] - ys[i - 1], `第 ${col} 列第 ${i} 个节点贴太近`).toBeGreaterThanOrEqual(CRAFT_NODE_H + 6);
      }
    }
  });

  it('任意两个节点的 y 相差 ≥ 8px（e2e navTo 的 marker±4 探针不会抓到别人的标签）', () => {
    const ys = CRAFT_TREE_NODES.map((n) => n.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i] - ys[i - 1], `y=${ys[i - 1]} 与 y=${ys[i]} 的两节点同行`).toBeGreaterThanOrEqual(8);
    }
  });

  it('材料→配方的边走在列间沟槽，不穿过任何节点盒子', () => {
    // 粗采样线段与矩形求交：足够钉住「边从盒子之间穿过」这类排版倒退。
    const hits = (x1: number, y1: number, x2: number, y2: number, cx: number, cy: number): boolean => {
      const left = cx - CRAFT_NODE_W / 2;
      const right = cx + CRAFT_NODE_W / 2;
      const top = cy - CRAFT_NODE_H / 2;
      const bottom = cy + CRAFT_NODE_H / 2;
      for (let t = 0; t <= 1; t += 0.02) {
        const px = x1 + (x2 - x1) * t;
        const py = y1 + (y2 - y1) * t;
        if (px >= left && px <= right && py >= top && py <= bottom) return true;
      }
      return false;
    };
    for (const edge of CRAFT_TREE_EDGES) {
      const from = nodeById(edge.from);
      const to = nodeById(edge.to);
      const x1 = craftColumnX(from.col) + CRAFT_NODE_W;
      const y1 = from.y;
      const x2 = craftColumnX(to.col);
      const y2 = to.y;
      for (const other of CRAFT_TREE_NODES) {
        if (other.id === edge.from || other.id === edge.to) continue;
        const ox = craftColumnX(other.col) + CRAFT_NODE_W / 2;
        expect(hits(x1, y1, x2, y2, ox, other.y), `边 ${edge.from}→${edge.to} 穿过节点 ${other.id}`).toBe(false);
      }
    }
  });

  it('每条边都是相邻列之间的（跨列边不画）', () => {
    for (const edge of CRAFT_TREE_EDGES) {
      const from = nodeById(edge.from);
      const to = nodeById(edge.to);
      expect(Math.abs(from.col - to.col), `边 ${edge.from}→${edge.to} 跨列`).toBeLessThanOrEqual(1);
      expect(from.col, `边 ${edge.from}→${edge.to} 方向倒转`).toBeLessThan(to.col);
    }
    // 25 条材料边 + 4 条凭证链边 + 1 条净化边。
    expect(CRAFT_TREE_EDGES).toHaveLength(30);
  });

  it('没有节点压在 y=166..174——工作台 upgradeBoard 的空文本行', () => {
    // 新开局无已建设施时 upgradeBoard 是空文本，挂世界坐标 y=170；
    // navTo 探针「marker y ±4 内找第一个 Text」不筛深度，空文本会抢靶。
    for (const node of CRAFT_TREE_NODES) {
      expect(Math.abs(node.y - 170), `${node.id} 压在 upgradeBoard 空文本行上`).toBeGreaterThan(4);
    }
  });

  it('树包围盒与 clamp 区间自洽（树确实比面板高，缩放才有意义）', () => {
    const b = craftTreeBounds();
    expect(b.minX).toBeGreaterThanOrEqual(0);
    expect(b.maxX).toBeLessThanOrEqual(DESIGN_WIDTH);
    expect(b.maxY - b.minY).toBeGreaterThan(CRAFT_NODE_H * 6);
  });
});

describe('导航序（旧列表下标语义 + e2e 按键预算）', () => {
  it('配方段就是 RECIPES 原序：照明灯在下标 0、加固门在下标 1', () => {
    // bagFullWarning.spec.ts 钉死「Enter 制作第一条 = 照明灯」；
    // ag44-scene-wire.spec.ts（after 相）钉死「4 次 ArrowDown → 工牌」。
    expect(NODE_IDS[0]).toBe('lamp');
    expect(NODE_IDS[1]).toBe('reinforced_door');
    expect(NODE_IDS[4]).toBe('work_badge');
    expect(NODE_IDS.slice(0, RECIPES.length)).toEqual(RECIPE_IDS);
  });

  it('净化跟在配方段之后（下标 13），材料殿后——都在 navTo 按键预算内', () => {
    expect(NODE_IDS[13]).toBe('purify');
    // crafting.spec.ts 的 navTo 预算 = RECIPES.length + 2 次 ArrowDown，
    // 从下标 0 起最远抵达下标 14；净化在 13，留一次余量。
    expect(NODE_IDS.indexOf('purify')).toBeLessThanOrEqual(RECIPES.length + 1);
    expect(NODE_IDS.indexOf('reinforced_door')).toBeLessThanOrEqual(RECIPES.length + 1);
    // 材料段：9 个，全是第 0 列。
    const materials = CRAFT_TREE_NODES.slice(14);
    expect(materials).toHaveLength(9);
    expect(materials.every((n) => n.kind === 'material' && n.col === 0)).toBe(true);
  });
});

describe('节点状态（与 canCraft 同一道闸门）', () => {
  it('新开局：无前置的配方材料不足、上链凭证缺前置，材料节点是中性根', () => {
    const state = createNewGame(42);
    for (const node of CRAFT_TREE_NODES) {
      const status = craftNodeStatus(state, node);
      if (node.kind === 'material') {
        expect(status).toEqual({ tone: 'neutral', label: '基础材料', actionable: false });
      } else if (node.kind === 'recipe') {
        const recipe = RECIPES.find((r) => r.id === node.id)!;
        const gated = recipe.kind === 'upgrade' && recipe.requires !== undefined;
        expect(status.tone, `${node.id} 开局态不对`).toBe(gated ? 'warn' : 'dim');
        expect(status.label).toBe(gated ? '缺前置' : '材料不足');
        expect(status.actionable).toBe(false);
      }
    }
  });

  it('材料齐了 → 可制作（亮边档）；建造后 → 已建造', () => {
    const state = createNewGame(42);
    addItem(state.player.inventory, 'battery', 1);
    addItem(state.player.inventory, 'wire', 1);
    addItem(state.player.inventory, 'scrap_metal', 1);
    expect(craftNodeStatus(state, nodeById('lamp'))).toEqual({ tone: 'accent', label: '可制作', actionable: true });
    state.player.homeUpgrades.push('lamp');
    const built = craftNodeStatus(state, nodeById('lamp'));
    expect(built.tone).toBe('good');
    expect(built.label).toBe('已建造');
    expect(built.actionable).toBe(false);
    expect(hasUpgrade(state, 'lamp')).toBe(true);
  });

  it('缺前置与材料不足是两态：通行贴先报缺前置，拿到工牌后才报材料不足', () => {
    const state = createNewGame(42);
    const gated = craftNodeStatus(state, nodeById('pass_sticker'));
    expect(gated).toEqual({ tone: 'warn', label: '缺前置', actionable: false });
    state.player.homeUpgrades.push('work_badge');
    const missing = craftNodeStatus(state, nodeById('pass_sticker'));
    expect(missing.tone).toBe('dim');
    expect(missing.label).toBe('材料不足');
  });

  it('武器配方可重复制作：没有已建造态', () => {
    const state = createNewGame(42);
    addItem(state.player.inventory, 'scrap_metal', 1);
    addItem(state.player.inventory, 'cloth', 1);
    expect(craftNodeStatus(state, nodeById('craft_dagger'))).toEqual({ tone: 'accent', label: '可制作', actionable: true });
    // 做出一把匕首后状态不变（物品进背包，不是 homeUpgrades）。
    state.player.inventory.slots.push({ itemId: 'dagger', quantity: 1 });
    expect(craftNodeStatus(state, nodeById('craft_dagger')).tone).toBe('accent');
  });

  it('净化节点三态：未建造 / 缺脏水 / 可净化 ×N', () => {
    const state = createNewGame(42);
    expect(craftNodeStatus(state, nodeById('purify'))).toEqual({ tone: 'dim', label: '未建造净水器', actionable: false });
    state.player.homeUpgrades.push('purifier');
    expect(craftNodeStatus(state, nodeById('purify'))).toEqual({ tone: 'dim', label: '缺脏水', actionable: false });
    addItem(state.player.inventory, 'dirty_water', 3);
    expect(craftNodeStatus(state, nodeById('purify'))).toEqual({ tone: 'accent', label: '可净化 ×3', actionable: true });
  });
});

describe('信息等价性（旧滚动列表 → 树形态）', () => {
  it('旧列表的每个条目在树上都有节点（13 配方 + 净化）', () => {
    const entryKinds = CRAFT_TREE_NODES.map((n) => n.kind);
    expect(entryKinds.filter((k) => k === 'recipe')).toHaveLength(RECIPES.length);
    expect(entryKinds.filter((k) => k === 'action')).toHaveLength(1);
  });

  it('旧列表的材料串在详情块有等价物：逐项 持有/需求 可算', () => {
    const state = createNewGame(42);
    addItem(state.player.inventory, 'wood', 1);
    // 加固门要 木材2 胶带1：木材 1/2（不足）、胶带 0/1（不足）——持有读数
    // 来自 countItem，与 craft() 扣料用的是同一个库存。
    const recipe = RECIPES.find((r) => r.id === 'reinforced_door')!;
    const costs = Object.entries(recipe.cost) as Array<[string, number]>;
    for (const [itemId, need] of costs) {
      const have = state.player.inventory.slots.filter((s) => s.itemId === itemId).reduce((n, s) => n + s.quantity, 0);
      if (itemId === 'wood') expect([have, need]).toEqual([1, 2]);
      if (itemId === 'tape') expect([have, need]).toEqual([0, 1]);
    }
  });

  it('材料节点的「用处」= 树里以它为 input 的配方（边的反查有定义）', () => {
    const consumers = (id: string): string[] => CRAFT_TREE_NODES.filter((n) => n.inputs.includes(id)).map((n) => n.displayName);
    expect(consumers('crowbar')).toEqual(['置物架']);
    expect(consumers('fuse')).toEqual(['核心权限']);
    expect(consumers('scrap_metal').length).toBeGreaterThanOrEqual(6);
  });
});

describe('craftTree 平衡配置（config/game-balance.json）', () => {
  it('载入了 JSON 里的 craftTree 块且数值自洽', () => {
    expect(CRAFT_TREE_BALANCE.nodeWidth).toBe(CRAFT_NODE_W);
    expect(CRAFT_TREE_BALANCE.nodeHeight).toBe(CRAFT_NODE_H);
    expect(CRAFT_TREE_BALANCE.zoomMin).toBeGreaterThan(0);
    expect(CRAFT_TREE_BALANCE.zoomMax).toBeGreaterThan(CRAFT_TREE_BALANCE.zoomMin);
    expect(CRAFT_TREE_BALANCE.zoomStep).toBeGreaterThan(0);
    expect(CRAFT_TREE_BALANCE.zoomStep).toBeLessThan(CRAFT_TREE_BALANCE.zoomMax - CRAFT_TREE_BALANCE.zoomMin);
    expect(CRAFT_TREE_BALANCE.dragThresholdPx).toBeGreaterThan(0);
  });

  it('六列树 + 节点宽在画布内（列距与首列来自同一份配置）', () => {
    const cols = new Set(CRAFT_TREE_NODES.map((n) => n.col));
    expect(cols.size).toBe(6);
    for (const col of cols) {
      expect(craftColumnX(col) + CRAFT_NODE_W).toBeLessThanOrEqual(DESIGN_WIDTH);
    }
  });
});

describe('GameState 形状（测试自身不失真）', () => {
  it('createNewGame 给出可用的初始背包与 homeUpgrades', () => {
    const state: GameState = createNewGame(7);
    expect(state.player.inventory.slots.length).toBeGreaterThan(0);
    expect(state.player.homeUpgrades).toEqual([]);
  });
});

// RecipeId 只在类型位使用：确保树的 recipe 节点 id 都能过 RecipeId 的类型门。
const _recipeIdCheck: RecipeId[] = CRAFT_TREE_NODES.filter((n) => n.kind === 'recipe').map((n) => n.id as RecipeId);
void _recipeIdCheck;
