// AG-31（TWOM 对齐 §8）：行为树组件骨架。设计论证见 docs/plans/BEHAVIOUR.md，
// 接口契约见 docs/plans/TWOM_ALIGNMENT.md 第八节——本文件不得单方面改 schema。
//
// 背景（twom-reverse TWOM_MECHANICS.md §4）：TWOM 有 625 个 BTTask* 类，但
// 「命名即设计」读下来只有三样东西——GoTo / Speak / PlayAnimation 三个原子任务
// 撑起全部表现，其余是条件装饰器（Sensor*）与打断装饰器（Forced*）。它的实体
// 模板里有 BEHAVIOUR_TREE / TRIGGER / FLAG 三种组件，说明行为树是可挂在任意
// 实体上的组件，不是 NPC 专属。
//
// 本文件的立场：现在规模不上完整行为树（TWOM 优先级表第 8 项：工作量÷价值 = 低），
// 但把「组件能挂」的地基打好——四种节点 + 一个纯函数求值器，零新依赖、零迁移。
// 为什么只有四种节点：625 个任务类本质是四种控制流节点的数据化实例，我们把
// 实例（数据）留给实体配置，把控制流（代码）收敛到 Sequence/Selector/Condition/
// Action。装饰器（Sensor/Forced）不做——感知走 AG-28 的 sense()，打断走契约
// 第七节的 forcedTarget，都在消费侧生效，不占节点类型。
//
// 铁律：纯函数、禁 Math.random、不 import Phaser、不读全局——Node 测试环境直接跑。

import { FLOOR_WIDTH } from '../core/constants';

// ── NpcAtom：契约第七节的本地镜像 ─────────────────────────────────────────
//
// 形状严格按 docs/plans/TWOM_ALIGNMENT.md §7——**契约是唯一权威**。AG-28 的
// src/ai/npcAtoms.ts 是权威定义；此处的本地别名是为了让 behaviour.ts 在
// AG-28 分支合入前即可编写与测试（结构化类型保证两边兼容，集成时由总控
// 统一验证形状一致）。集成后此处应改为 `import type { NpcAtom } from
// './npcAtoms'` 并删除本别名——在那之前，不得去创建 npcAtoms.ts（双写）。
type NpcAtom =
  | { kind: 'goTo'; x: number; speed?: number }
  | { kind: 'speak'; text: string }
  | { kind: 'playAnimation'; clip: string };

// ── 组件模型：实体模板三型 ────────────────────────────────────────────────
//
// TWOM 实体模板（20 种 ENTITY_* 之一）上的三种可挂组件：
// - behaviourTree：行为树本体
// - trigger：引用 AG-26 登记的触发器 id（条件满足时置旗；组件只存引用，不存逻辑）
// - flag：引用 AG-26 的旗标 key（世界的记忆；组件只存引用，不存状态）
// 挂载方式（独立表 vs NpcDef 加字段）的决策与理由见 BEHAVIOUR.md §5。

/** 实体模板三型之一：可挂在任意实体上的组件（不是 NPC 专属）。 */
export type EntityComponent =
  | { type: 'behaviourTree'; tree: BehaviourNode }
  | { type: 'trigger'; triggerId: string }
  | { type: 'flag'; flagKey: string };

/** 从实体的组件列表里取行为树（第一个 behaviourTree 组件；没有则 null）。 */
export function behaviourTreeOf(components: readonly EntityComponent[] | undefined): BehaviourNode | null {
  for (const component of components ?? []) {
    if (component.type === 'behaviourTree') return component.tree;
  }
  return null;
}

// ── 节点：最小集四种 ─────────────────────────────────────────────────────

/**
 * 最小节点集。TWOM 的 625 个任务类 = 这四种节点 + 数据：
 * - sequence：依次执行，任一失败即整体失败（与门）
 * - selector：依次尝试，第一个成功的整体成功（或门）
 * - condition：纯谓词，不产出原子；成功/失败决定编排走向
 * - action：叶子，产出一个 NpcAtom
 *
 * 求值语义（每次求值 = 一个 tick，产出本 tick 的原子序列）：
 * - evaluateTree 返回空数组 = 本 tick 这棵树什么也不做（某处条件失败）
 * - 空 sequence  vacuously 成功（返回 []）；空 selector 失败（返回 []）
 */
export type BehaviourNode =
  | { kind: 'sequence'; children: BehaviourNode[] }
  | { kind: 'selector'; children: BehaviourNode[] }
  | { kind: 'condition'; test: BehaviourCondition }
  | { kind: 'action'; action: BehaviourAction };

/** 条件谓词。读 ctx（旗标 + 感知），不自己存状态——旗标归 AG-26，感知归 AG-28。 */
export type BehaviourCondition = (ctx: BehaviourContext) => boolean;

/**
 * 动作 payload。契约第七节的 NpcAtom 是静态值；goTo 的动态目标（玩家位置、
 * 撤退出口）用函数形式按 ctx 解析——**解析结果仍是 NpcAtom，不改其 schema**。
 * 静态原子放常量，动态参数放闭包，这是本模块唯一的「发明」，已在 BEHAVIOUR.md §4
 * 说明：否则「逼近玩家」这类行为无法用静态原子表达。
 */
export type BehaviourAction = NpcAtom | ((ctx: BehaviourContext) => NpcAtom);

/**
 * 感知快照：由调用方（最终是 AG-28 的 sense()）在求值前算好传入，树不直接问世界。
 * 字段与现有系统一一对应（见 BEHAVIOUR.md §6）：
 * - night ← SurvivalSystem.isNight
 * - playerX / playerDistance ← 场景持有的玩家坐标
 * - aggroRange ← NpcAutonomy.wandererAggroRange
 * - patrolX ← 调用方用 deriveSeed/makeRng 确定性算出的路径点（禁 Math.random）
 * 扩展字段属于契约变更，要走 TWOM_ALIGNMENT.md，不得在本文件私加。
 */
export interface BehaviourSense {
  /** 是否夜间。 */
  night: boolean;
  /** 实体自身 x（楼层内像素）。 */
  selfX: number;
  /** 玩家 x；场上无玩家时为 null。 */
  playerX: number | null;
  /** 与玩家的距离（像素）；无玩家时为 null。 */
  playerDistance: number | null;
  /** 仇恨范围（像素）。 */
  aggroRange: number;
  /** 确定性巡逻路径点 x（调用方算好后传入）。 */
  patrolX: number;
}

/** 求值上下文：树能看到的一切。 */
export interface BehaviourContext {
  /** 旗标查询，直通 AG-26 WorldFlags.hasFlag：树的条件节点读 flag，不自己存状态。 */
  hasFlag: (key: string) => boolean;
  /** 感知快照（AG-28 sense() 的产物）。 */
  sense: BehaviourSense;
}

/**
 * 树深度上限。行为树是代码里构造的静态数据，正常不可能深到这里；这道闸门防的是
 * 「有人用 mutation 把树接成了环」——超深一律按失败处理（返回空序列），游戏循环
 * 里表现为「这一 tick 什么也不做」，不会把调用方拖死。
 */
export const MAX_TREE_DEPTH = 32;

/** 内部求值：null = 失败，NpcAtom[] = 成功（可能为空序列，如 condition 节点）。 */
function evalNode(node: BehaviourNode, ctx: BehaviourContext, depth: number): NpcAtom[] | null {
  if (depth > MAX_TREE_DEPTH) return null;
  switch (node.kind) {
    case 'action': {
      const atom = typeof node.action === 'function' ? node.action(ctx) : node.action;
      return [atom];
    }
    case 'condition':
      // 条件不产出原子；失败返回 null 让上层编排决定走向。
      return node.test(ctx) ? [] : null;
    case 'sequence': {
      const atoms: NpcAtom[] = [];
      for (const child of node.children) {
        const result = evalNode(child, ctx, depth + 1);
        if (result === null) return null; // 任一失败即整体失败，已产出的原子丢弃
        atoms.push(...result);
      }
      return atoms; // 空 children = 空成功（vacuously true）
    }
    case 'selector': {
      for (const child of node.children) {
        const result = evalNode(child, ctx, depth + 1);
        if (result !== null) return result; // 第一个成功的孩子，整体成功
      }
      return null; // 全部失败（含空 children）
    }
  }
}

/**
 * 求值一棵树，返回本 tick 的原子序列。纯函数：同 (node, ctx) → 同输出，
 * 不写任何状态、不读全局、禁随机——随机性只能以「调用方算好后放进 ctx」的
 * 形式出现（patrolX 即此模式）。
 */
export function evaluateTree(node: BehaviourNode, ctx: BehaviourContext): NpcAtom[] {
  return evalNode(node, ctx, 0) ?? [];
}

// ── 真实用例：流浪者夜间巡逻 ──────────────────────────────────────────────
//
// BEHAVIOUR.md §8 的用例树，与 NpcAutonomy.stepWandererRoam 三态状态机逐条
// 对应（withdraw / approach / patrol）。**未接线、不迁移现有 NPC**——它在这里
// 是为了把四种节点 + 三原语的编排讲清楚，并被 behaviour.test.ts 直接求值。
//
// 树不存任何状态，三个原本存在状态机里的东西这样表达：
// - withdraw 的粘滞：读 flag 'wanderer.withdrawing'（场景在「天亮/事件结束」时
//   置位、wandererRoamGone 时清除），树只读旗子（AG-26 模式）
// - 路径点/玩家位置等动态值：进 ctx.sense，由调用方确定性算好（禁 Math.random）
// - 放话只说一次：读 flag 'wanderer.taunted'，消费侧执行 speak 原子后置位；
//   置位后本分支条件失败，selector 自然落到普通逼近分支
//
// 求值优先级（selector 自上而下）：
//   P1 撤退（flag 粘滞，出口按 selfX 选近端，与 stepWandererRoam 同规则）
//   P2 结仇放话（flag 'wanderer.grudge' + 玩家在仇恨范围 + 未放过话）
//   P3 逼近（玩家在仇恨范围）
//   P4 巡逻（仅夜间；路径点来自 ctx.sense.patrolX）

/** 结仇放话的示例台词（巡游体的「找到你了」；正式接线时由台词表供给）。 */
export const WANDERER_TAUNT_LINE = '……找到你了。';

export const WANDERER_PATROL_TREE: BehaviourNode = {
  kind: 'selector',
  children: [
    // P1：撤退。flag 由场景置位/清除，树不自己存状态。
    {
      kind: 'sequence',
      children: [
        { kind: 'condition', test: (ctx) => ctx.hasFlag('wanderer.withdrawing') },
        {
          kind: 'action',
          // 出口选近端：与 stepWandererRoam 的 `x < FLOOR_WIDTH / 2 ? 0 : FLOOR_WIDTH` 同规则。
          action: (ctx) => ({ kind: 'goTo', x: ctx.sense.selfX < FLOOR_WIDTH / 2 ? 0 : FLOOR_WIDTH }),
        },
        { kind: 'action', action: { kind: 'playAnimation', clip: 'withdraw' } },
      ],
    },
    // P2：结仇且首次贴脸——先放话再逼近。放过话（flag 置位）后本分支失败，
    // 落到 P3 普通逼近。
    {
      kind: 'sequence',
      children: [
        { kind: 'condition', test: (ctx) => ctx.hasFlag('wanderer.grudge') },
        { kind: 'condition', test: (ctx) => !ctx.hasFlag('wanderer.taunted') },
        { kind: 'condition', test: (ctx) => playerInAggroRange(ctx) },
        { kind: 'action', action: { kind: 'speak', text: WANDERER_TAUNT_LINE } },
        { kind: 'action', action: (ctx) => ({ kind: 'goTo', x: ctx.sense.playerX ?? ctx.sense.selfX }) },
        { kind: 'action', action: { kind: 'playAnimation', clip: 'stalk' } },
      ],
    },
    // P3：逼近。盯住玩家，与状态机 approach 相对应。
    {
      kind: 'sequence',
      children: [
        { kind: 'condition', test: (ctx) => playerInAggroRange(ctx) },
        { kind: 'action', action: (ctx) => ({ kind: 'goTo', x: ctx.sense.playerX ?? ctx.sense.selfX }) },
        { kind: 'action', action: { kind: 'playAnimation', clip: 'stalk' } },
      ],
    },
    // P4：巡逻。仅夜间；路径点由调用方用 deriveSeed 算好后放进 sense。
    {
      kind: 'sequence',
      children: [
        { kind: 'condition', test: (ctx) => ctx.sense.night },
        { kind: 'action', action: (ctx) => ({ kind: 'goTo', x: ctx.sense.patrolX }) },
        { kind: 'action', action: { kind: 'playAnimation', clip: 'patrol' } },
      ],
    },
  ],
};

/** 玩家在仇恨范围内（无玩家视为不在）。用例树内部共用的小谓词。 */
function playerInAggroRange(ctx: BehaviourContext): boolean {
  const { playerDistance, aggroRange } = ctx.sense;
  return playerDistance !== null && playerDistance <= aggroRange;
}
