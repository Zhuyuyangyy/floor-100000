import balance from '../../config/game-balance.json' with { type: 'json' };

import { canCraft, hasUpgrade } from '../systems/CraftingSystem';
import { countItem } from '../systems/InventorySystem';
import type { GameState } from '../core/gameTypes';

// ── AG-61：二叉树合成树（制作面板的树形化）────────────────────────────────
//
// 用户原话（2026-11-17）：「制作可以用那种二叉树那种合成的方案去做就是打开
// 之后制作那种」——制作面板从 13 条的滚动列表改成一棵合成树：左侧基础材料，
// 向右展开设施/武器，凭证链沿右路梯级下行，边=合成路径。
//
// 本文件是**纯数据 + 纯函数**（不 import Phaser），所以 Node 环境下可测：
// 树的完整性（每个配方恰一个节点、每条边两端都存在、依赖与 RECIPES 的
// requires 一致）由 src/tests/craftTree.test.ts 钉死。
//
// 几何数值不在代码里硬编码——config/game-balance.json 的 craftTree 块是唯一
// 来源，载时校验（坏配置大声失败并点名字段），与 core/constants.ts 对
// survivalBalance 的同款契约。JSON 里纯增键，schemaVersion 不动。

// ── 视图/几何调参数 ───────────────────────────────────────────────────────

export interface CraftTreeBalance {
  /** 节点宽（图标 + 名称一行）。 */
  nodeWidth: number;
  /** 节点高。 */
  nodeHeight: number;
  /** 列间距（左到右）。 */
  columnPitch: number;
  /** 第 0 列（材料列）的左缘 x。 */
  firstColumnX: number;
  /** 滚轮缩放下限。 */
  zoomMin: number;
  /** 滚轮缩放上限。 */
  zoomMax: number;
  /** 每次滚轮滚动的缩放步长（相对量）。 */
  zoomStep: number;
  /** 拖拽判定阈值：超过才算平移，否则当作点击。 */
  dragThresholdPx: number;
}

function finiteNumber(source: Record<string, unknown>, block: string, key: string): number {
  const v = source[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`config/game-balance.json 无效：${block}.${key} 不是有效数字`);
  }
  return v;
}

function readCraftTreeBalance(raw: unknown): CraftTreeBalance {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    nodeWidth: finiteNumber(src, 'craftTree', 'nodeWidth'),
    nodeHeight: finiteNumber(src, 'craftTree', 'nodeHeight'),
    columnPitch: finiteNumber(src, 'craftTree', 'columnPitch'),
    firstColumnX: finiteNumber(src, 'craftTree', 'firstColumnX'),
    zoomMin: finiteNumber(src, 'craftTree', 'zoomMin'),
    zoomMax: finiteNumber(src, 'craftTree', 'zoomMax'),
    zoomStep: finiteNumber(src, 'craftTree', 'zoomStep'),
    dragThresholdPx: finiteNumber(src, 'craftTree', 'dragThresholdPx'),
  };
}

export const CRAFT_TREE_BALANCE = readCraftTreeBalance(
  (balance as unknown as { craftTree?: unknown }).craftTree,
);

/** 节点宽高（场景与测试共用同一份，避免两处数字漂移）。 */
export const CRAFT_NODE_W = CRAFT_TREE_BALANCE.nodeWidth;
export const CRAFT_NODE_H = CRAFT_TREE_BALANCE.nodeHeight;

/** 第 col 列节点的左缘 x。 */
export function craftColumnX(col: number): number {
  return CRAFT_TREE_BALANCE.firstColumnX + col * CRAFT_TREE_BALANCE.columnPitch;
}

// ── 树数据 ────────────────────────────────────────────────────────────────

export type CraftTreeNodeKind = 'material' | 'recipe' | 'action';

export interface CraftTreeNode {
  /** 稳定 id：material=ItemId，recipe=RecipeId，action='purify'。 */
  id: string;
  kind: CraftTreeNodeKind;
  displayName: string;
  /** 图标贴图 key（itemIconKey / weapon spriteKey）；纹章节点为 null。 */
  iconKey: string | null;
  /** 层级列：0=基础材料，1=设施与武器，2+=凭证链。 */
  col: number;
  /** 节点中心的画布 y（zoom 1 / pan 0 的基准坐标）。 */
  y: number;
  /**
   * 完整依赖：材料成本 + 上一级凭证（upgrade 的 requires）。净化节点的父是
   * 净水器。画出来的边只取相邻列（见 CRAFT_TREE_EDGES）——凭证的材料在
   * 第 0 列、凭证自己在第 2 列起，画过去会横穿整棵树，那些成本由详情块的
   * 「材料」行与节点高亮承担。
   */
  inputs: string[];
}

// 节点的数组顺序即键盘/滚动的导航顺序（↑/↓ 在树里按这个线性序走）。
// 顺序约束（e2e/crafting.spec.ts 的 navTo 预算是 RECIPES.length+2 次
// ArrowDown）：加固门必须落在下标 10、净化落在 12——两者都在 14 步内。
//
// y 坐标是手工排版的结果，三条硬约束：
//   1. 同一列内相邻节点 ≥ CRAFT_NODE_H + 8（盒子不叠，本表列内距 44）；
//   2. 任意两个节点的 y 相差 ≥ 8px——e2e 的 navTo 用「marker 的 y ±4 之内
//      找文本」定位选中行，两个标签贴在同一行会让探针抓到别人的名字；
//   3. 材料列（0）与配方列（1）交错 22px，第 2 列起取两者行号的中点
//      （+11）：列 0 的行号恰好落在列 1 的行间隙里——材料→配方的边因此
//      永远走在两条列之间的沟槽内，不穿过任何节点盒子。
export const CRAFT_TREE_NODES: readonly CraftTreeNode[] = [
  // ── 导航序 = 旧滚动列表的原序（RECIPES 序）+ 净化 + 材料 ────────────────
  // 为什么不是「按列从左到右」：两个既有 e2e 钉死了旧列表的下标语义——
  // bagFullWarning.spec.ts「Enter 制作第一条」按的是 index 0 = 照明灯，
  // crafting.spec.ts 的 navTo 按 RECIPES.length+2 次 ArrowDown 的预算找
  // 加固门与净化。配方段保持 RECIPES 原序，这些钉子一根不断；净化跟在
  // 配方段之后（与旧列表相同）；材料是树形态新增的参考节点，排在导航序
  // 末尾——↑/↓ 先看「做得出什么」，再回头看「料在哪」。
  { id: 'lamp', kind: 'recipe', displayName: '照明灯', iconKey: null, col: 1, y: 140, inputs: ['battery', 'wire', 'scrap_metal'] },
  { id: 'reinforced_door', kind: 'recipe', displayName: '加固门', iconKey: null, col: 1, y: 184, inputs: ['wood', 'tape'] },
  { id: 'purifier', kind: 'recipe', displayName: '简易净水器', iconKey: null, col: 1, y: 228, inputs: ['scrap_metal', 'filter', 'wire'] },
  { id: 'storage_rack', kind: 'recipe', displayName: '置物架', iconKey: null, col: 1, y: 272, inputs: ['wood', 'cloth', 'crowbar'] },
  { id: 'work_badge', kind: 'recipe', displayName: '工牌', iconKey: null, col: 1, y: 492, inputs: ['scrap_metal', 'cloth', 'tape'] },
  { id: 'pass_sticker', kind: 'recipe', displayName: '通行贴', iconKey: null, col: 2, y: 481, inputs: ['work_badge', 'wire', 'tape', 'battery'] },
  { id: 'permit', kind: 'recipe', displayName: '许可证', iconKey: null, col: 3, y: 437, inputs: ['pass_sticker', 'battery', 'filter', 'cloth'] },
  { id: 'vip_card', kind: 'recipe', displayName: '贵宾卡', iconKey: null, col: 4, y: 393, inputs: ['permit', 'scrap_metal', 'cloth', 'battery'] },
  { id: 'core_key', kind: 'recipe', displayName: '核心权限', iconKey: null, col: 5, y: 349, inputs: ['vip_card', 'fuse', 'wire', 'scrap_metal'] },
  { id: 'craft_dagger', kind: 'recipe', displayName: '匕首', iconKey: 'dagger', col: 1, y: 316, inputs: ['scrap_metal', 'cloth'] },
  { id: 'craft_short_sword', kind: 'recipe', displayName: '短剑', iconKey: 'short_sword', col: 1, y: 360, inputs: ['scrap_metal', 'wood', 'tape'] },
  { id: 'craft_cleaver', kind: 'recipe', displayName: '砍刀', iconKey: 'cleaver', col: 1, y: 404, inputs: ['scrap_metal', 'wood', 'tape'] },
  { id: 'craft_fire_axe', kind: 'recipe', displayName: '消防斧', iconKey: 'fire_axe', col: 1, y: 448, inputs: ['scrap_metal', 'wood', 'cloth'] },
  // 净化：净水器的动作节点，跟在配方段之后（旧列表里它也在所有配方之后）。
  { id: 'purify', kind: 'action', displayName: '净化', iconKey: 'dirty_water', col: 2, y: 217, inputs: ['purifier'] },
  // ── 材料列（第 0 列，合成的根）────────────────────────────────────────
  { id: 'wood', kind: 'material', displayName: '木材', iconKey: 'wood', col: 0, y: 118, inputs: [] },
  { id: 'scrap_metal', kind: 'material', displayName: '废金属', iconKey: 'scrap_metal', col: 0, y: 162, inputs: [] },
  { id: 'cloth', kind: 'material', displayName: '布料', iconKey: 'cloth', col: 0, y: 206, inputs: [] },
  { id: 'tape', kind: 'material', displayName: '胶带', iconKey: 'tape', col: 0, y: 250, inputs: [] },
  { id: 'battery', kind: 'material', displayName: '电池', iconKey: 'battery', col: 0, y: 294, inputs: [] },
  { id: 'wire', kind: 'material', displayName: '电线', iconKey: 'wire', col: 0, y: 338, inputs: [] },
  { id: 'filter', kind: 'material', displayName: '滤芯', iconKey: 'filter', col: 0, y: 382, inputs: [] },
  { id: 'fuse', kind: 'material', displayName: '保险丝', iconKey: 'fuse', col: 0, y: 426, inputs: [] },
  { id: 'crowbar', kind: 'material', displayName: '撬棍', iconKey: 'crowbar', col: 0, y: 470, inputs: [] },
];

export function findCraftNode(id: string): CraftTreeNode | undefined {
  return CRAFT_TREE_NODES.find((n) => n.id === id);
}

export interface CraftTreeEdge {
  from: string;
  to: string;
}

/**
 * 真正要画出来的边。完整依赖在 node.inputs，但画全部边会让第 0 列到
 * 凭证链的料边横穿整棵树（中间列全是节点盒子）——所以画的是：
 *   - 第 0 列材料 → 第 1 列配方（工牌也在第 1 列，三条料边同槽）；
 *   - 凭证链的级间边（上一级凭证 → 下一级）；
 *   - 净水器 → 净化。
 * 凭证自身的材料成本不在树上画边，由详情块的「材料」行与悬停高亮承担。
 */
export const CRAFT_TREE_EDGES: readonly CraftTreeEdge[] = CRAFT_TREE_NODES.flatMap((node) =>
  node.inputs
    .filter((parentId) => {
      const parent = findCraftNode(parentId);
      if (!parent) return false;
      // 只保留「相邻列」的边：材料→第 1 列、链上同级 ±1 列。
      return Math.abs(parent.col - node.col) <= 1;
    })
    .map((from) => ({ from, to: node.id })),
);

/** 树内容的包围盒（zoom 1 / pan 0 的基准坐标，供平移 clamp 用）。 */
export interface CraftTreeBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function craftTreeBounds(): CraftTreeBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of CRAFT_TREE_NODES) {
    const x = craftColumnX(node.col);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + CRAFT_NODE_W);
    minY = Math.min(minY, node.y - CRAFT_NODE_H / 2);
    maxY = Math.max(maxY, node.y + CRAFT_NODE_H / 2);
  }
  return { minX, minY, maxX, maxY };
}

// ── 节点状态（纯函数：GameState → 三态+已建+动作态）──────────────────────

/**
 * 节点的视觉色调。场景把这五个态映射到 palette：
 *   accent  = 可制作（亮边）
 *   good    = 已建造
 *   warn    = 缺前置（未解锁的进阶档）
 *   dim     = 材料不足 / 缺脏水
 *   neutral = 基础材料（根，无状态）
 */
export type CraftNodeTone = 'accent' | 'good' | 'warn' | 'dim' | 'neutral';

export interface CraftNodeStatus {
  tone: CraftNodeTone;
  /** 一行状态词，详情块渲染成「状态：X」。 */
  label: string;
  /** Enter/点击该节点是否有动作可执行。 */
  actionable: boolean;
}

export function craftNodeStatus(state: GameState, node: CraftTreeNode): CraftNodeStatus {
  if (node.kind === 'material') return { tone: 'neutral', label: '基础材料', actionable: false };
  if (node.kind === 'action') {
    // 净化节点只在净水器已建造时存在（场景侧过滤），这里仍诚实兜底。
    if (!hasUpgrade(state, 'purifier')) return { tone: 'dim', label: '未建造净水器', actionable: false };
    const dirty = countItem(state.player.inventory, 'dirty_water');
    if (dirty >= 1) return { tone: 'accent', label: `可净化 ×${dirty}`, actionable: true };
    return { tone: 'dim', label: '缺脏水', actionable: false };
  }
  // 用 canCraft 的 reason 区分「缺前置」与「材料不足」——前置资格先于材料
  // 检查（CraftingSystem.canCraft 的顺序），reason 非空即资格问题，与 craft()
  // 共用同一道闸门，不会出现「显示可做、Enter 被拒」的分叉。
  const check = canCraft(state, node.id as Parameters<typeof canCraft>[1]);
  if (check.ok) return { tone: 'accent', label: '可制作', actionable: true };
  if (check.reason?.includes('已建造')) return { tone: 'good', label: '已建造', actionable: false };
  if (check.reason?.includes('需要先获得')) return { tone: 'warn', label: '缺前置', actionable: false };
  return { tone: 'dim', label: '材料不足', actionable: false };
}
