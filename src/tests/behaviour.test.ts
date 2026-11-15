// AG-31：行为树组件测试（src/ai/behaviour.ts，docs/plans/BEHAVIOUR.md）。
//
// 覆盖四类断言：
// 1. 四种节点各自的求值语义（sequence 与门 / selector 或门 / condition 谓词 /
//    action 原子，静态与动态两种 payload）
// 2. 树深度限制（防无限递归：mutation 接成的环 + 超深链都在 MAX_TREE_DEPTH 处截停）
// 3. 纯函数：同输入同输出、求值过程不写 ctx（冻结对象防隐式修改）
// 4. 真实用例：WANDERER_PATROL_TREE 在各情境下产出预期的原子序列
//
// 铁律：不 import Phaser、不读全局、禁 Math.random——随机只能以「调用方算好后
// 放进 ctx」的形式出现。

import { describe, expect, it } from 'vitest';

import {
  MAX_TREE_DEPTH,
  WANDERER_PATROL_TREE,
  WANDERER_TAUNT_LINE,
  behaviourTreeOf,
  evaluateTree,
  type BehaviourContext,
  type BehaviourNode,
  type BehaviourSense,
  type EntityComponent,
} from '../ai/behaviour';
import { FLOOR_WIDTH } from '../core/constants';

function senseOf(overrides: Partial<BehaviourSense> = {}): BehaviourSense {
  return {
    night: true,
    selfX: 500,
    playerX: null,
    playerDistance: null,
    aggroRange: 260,
    patrolX: 700,
    ...overrides,
  };
}

function ctxOf(overrides: { flags?: string[]; sense?: Partial<BehaviourSense> } = {}): BehaviourContext {
  const flags = new Set(overrides.flags ?? []);
  return { hasFlag: (key) => flags.has(key), sense: senseOf(overrides.sense) };
}

/** 构造 depth 层 sequence 嵌套、叶子是一个 speak 原子的链（用来卡深度闸门）。 */
function sequenceChain(depth: number): BehaviourNode {
  let node: BehaviourNode = { kind: 'action', action: { kind: 'speak', text: 'leaf' } };
  for (let i = 0; i < depth; i++) {
    node = { kind: 'sequence', children: [node] };
  }
  return node;
}

describe('behaviour：四种节点各自的求值', () => {
  it('action 静态 payload 原样产出原子', () => {
    const atoms = evaluateTree({ kind: 'action', action: { kind: 'speak', text: '别站门口。' } }, ctxOf());
    expect(atoms).toEqual([{ kind: 'speak', text: '别站门口。' }]);
  });

  it('action 动态 payload 按 ctx 解析，结果仍是 NpcAtom', () => {
    const tree: BehaviourNode = {
      kind: 'action',
      action: (ctx) => ({ kind: 'goTo', x: ctx.sense.selfX + 40, speed: 0.5 }),
    };
    expect(evaluateTree(tree, ctxOf({ sense: { selfX: 500 } }))).toEqual([{ kind: 'goTo', x: 540, speed: 0.5 }]);
  });

  it('condition 成功不产原子、失败让上层按失败处理', () => {
    const pass: BehaviourNode = { kind: 'condition', test: () => true };
    const fail: BehaviourNode = { kind: 'condition', test: () => false };
    expect(evaluateTree(pass, ctxOf())).toEqual([]);
    expect(evaluateTree(fail, ctxOf())).toEqual([]);
  });

  it('sequence 是全成功才成功的与门，按序拼接原子', () => {
    const tree: BehaviourNode = {
      kind: 'sequence',
      children: [
        { kind: 'action', action: { kind: 'goTo', x: 0 } },
        { kind: 'condition', test: (ctx) => ctx.sense.night },
        { kind: 'action', action: { kind: 'playAnimation', clip: 'patrol' } },
      ],
    };
    expect(evaluateTree(tree, ctxOf({ sense: { night: true } }))).toEqual([
      { kind: 'goTo', x: 0 },
      { kind: 'playAnimation', clip: 'patrol' },
    ]);
  });

  it('sequence 中途失败即整体失败，已产出的原子一并丢弃', () => {
    const tree: BehaviourNode = {
      kind: 'sequence',
      children: [
        { kind: 'action', action: { kind: 'goTo', x: 0 } },
        { kind: 'condition', test: () => false },
        { kind: 'action', action: { kind: 'playAnimation', clip: 'patrol' } },
      ],
    };
    expect(evaluateTree(tree, ctxOf())).toEqual([]);
  });

  it('selector 返回第一个成功分支的原子，不继续尝试后续分支', () => {
    let secondTouched = false;
    const tree: BehaviourNode = {
      kind: 'selector',
      children: [
        {
          kind: 'sequence',
          children: [
            { kind: 'condition', test: (ctx) => ctx.sense.night },
            { kind: 'action', action: { kind: 'goTo', x: 1 } },
          ],
        },
        {
          kind: 'sequence',
          children: [
            {
              kind: 'condition',
              test: () => {
                secondTouched = true;
                return true;
              },
            },
            { kind: 'action', action: { kind: 'goTo', x: 2 } },
          ],
        },
      ],
    };
    expect(evaluateTree(tree, ctxOf({ sense: { night: true } }))).toEqual([{ kind: 'goTo', x: 1 }]);
    expect(secondTouched).toBe(false);
  });

  it('selector 全部失败返回空序列；空 children 的 sequence 空成功、selector 空失败', () => {
    const allFail: BehaviourNode = {
      kind: 'selector',
      children: [{ kind: 'condition', test: () => false }, { kind: 'condition', test: () => false }],
    };
    expect(evaluateTree(allFail, ctxOf())).toEqual([]);
    expect(evaluateTree({ kind: 'sequence', children: [] }, ctxOf())).toEqual([]);
    expect(evaluateTree({ kind: 'selector', children: [] }, ctxOf())).toEqual([]);
  });
});

describe('behaviour：树深度限制（防无限递归）', () => {
  it('mutation 接成的环不会拖死求值，超深按失败处理', () => {
    const cyclic: BehaviourNode = { kind: 'sequence', children: [] };
    cyclic.children.push(cyclic); // 类型允许的环：正常静态数据不可能出现，闸门防的是这个
    expect(evaluateTree(cyclic, ctxOf())).toEqual([]);
  });

  it('深度恰好在 MAX_TREE_DEPTH 内的链正常求值，超一层即截停', () => {
    expect(evaluateTree(sequenceChain(MAX_TREE_DEPTH), ctxOf())).toEqual([{ kind: 'speak', text: 'leaf' }]);
    expect(evaluateTree(sequenceChain(MAX_TREE_DEPTH + 1), ctxOf())).toEqual([]);
  });
});

describe('behaviour：纯函数', () => {
  const tree: BehaviourNode = {
    kind: 'selector',
    children: [
      { kind: 'condition', test: (ctx) => ctx.hasFlag('wanderer.withdrawing') },
      {
        kind: 'sequence',
        children: [
          { kind: 'condition', test: (ctx) => ctx.sense.night },
          { kind: 'action', action: (ctx) => ({ kind: 'goTo', x: ctx.sense.patrolX }) },
        ],
      },
    ],
  };

  it('同 (node, ctx) 两次求值结果一致', () => {
    const ctx = ctxOf({ sense: { night: true, patrolX: 640 } });
    expect(evaluateTree(tree, ctx)).toEqual(evaluateTree(tree, ctx));
  });

  it('求值不写 ctx（冻结 sense 与 ctx，任何隐式修改都会抛错）', () => {
    const frozen = Object.freeze({
      hasFlag: () => false,
      sense: Object.freeze(senseOf({ night: true, patrolX: 640 })),
    });
    expect(evaluateTree(tree, frozen)).toEqual([{ kind: 'goTo', x: 640 }]);
    expect(frozen.sense.patrolX).toBe(640); // 冻结对象未被改动
  });

  it('条件真的在读 ctx：不同旗标/感知给出不同原子', () => {
    expect(evaluateTree(tree, ctxOf({ flags: ['wanderer.withdrawing'] }))).toEqual([]);
    expect(evaluateTree(tree, ctxOf({ sense: { night: false } }))).toEqual([]);
    expect(evaluateTree(tree, ctxOf({ sense: { night: true, patrolX: 640 } }))).toEqual([{ kind: 'goTo', x: 640 }]);
  });
});

describe('behaviour：真实用例 WANDERER_PATROL_TREE（流浪者夜间巡逻）', () => {
  it('P1 撤退：flag 粘滞时走向近端出口并播撤离动画（与 stepWandererRoam 同规则）', () => {
    const left = evaluateTree(
      WANDERER_PATROL_TREE,
      ctxOf({ flags: ['wanderer.withdrawing'], sense: { selfX: 100 } }),
    );
    expect(left).toEqual([
      { kind: 'goTo', x: 0 },
      { kind: 'playAnimation', clip: 'withdraw' },
    ]);
    const right = evaluateTree(
      WANDERER_PATROL_TREE,
      ctxOf({ flags: ['wanderer.withdrawing'], sense: { selfX: FLOOR_WIDTH - 100 } }),
    );
    expect(right).toEqual([
      { kind: 'goTo', x: FLOOR_WIDTH },
      { kind: 'playAnimation', clip: 'withdraw' },
    ]);
  });

  it('P1 优先级最高：撤退中即使玩家贴脸也继续撤', () => {
    const atoms = evaluateTree(
      WANDERER_PATROL_TREE,
      ctxOf({ flags: ['wanderer.withdrawing'], sense: { selfX: 100, playerX: 200, playerDistance: 100 } }),
    );
    expect(atoms).toEqual([
      { kind: 'goTo', x: 0 },
      { kind: 'playAnimation', clip: 'withdraw' },
    ]);
  });

  it('P2 结仇放话：首次贴脸先说话再逼近（消费侧执行 speak 后置 taunted 旗）', () => {
    const atoms = evaluateTree(
      WANDERER_PATROL_TREE,
      ctxOf({ flags: ['wanderer.grudge'], sense: { playerX: 380, playerDistance: 120 } }),
    );
    expect(atoms).toEqual([
      { kind: 'speak', text: WANDERER_TAUNT_LINE },
      { kind: 'goTo', x: 380 },
      { kind: 'playAnimation', clip: 'stalk' },
    ]);
  });

  it('P2→P3 落空：放过话之后同情境落到普通逼近，话不再重复', () => {
    const atoms = evaluateTree(
      WANDERER_PATROL_TREE,
      ctxOf({ flags: ['wanderer.grudge', 'wanderer.taunted'], sense: { playerX: 380, playerDistance: 120 } }),
    );
    expect(atoms).toEqual([
      { kind: 'goTo', x: 380 },
      { kind: 'playAnimation', clip: 'stalk' },
    ]);
  });

  it('P3 逼近：玩家在仇恨范围内盯人', () => {
    const atoms = evaluateTree(WANDERER_PATROL_TREE, ctxOf({ sense: { playerX: 420, playerDistance: 80 } }));
    expect(atoms).toEqual([
      { kind: 'goTo', x: 420 },
      { kind: 'playAnimation', clip: 'stalk' },
    ]);
  });

  it('P4 巡逻：夜间且玩家远离时走向确定性路径点', () => {
    const atoms = evaluateTree(
      WANDERER_PATROL_TREE,
      ctxOf({ sense: { night: true, playerX: 420, playerDistance: 500, patrolX: 900 } }),
    );
    expect(atoms).toEqual([
      { kind: 'goTo', x: 900 },
      { kind: 'playAnimation', clip: 'patrol' },
    ]);
  });

  it('边界：白天且无任何旗标时什么都不做；无玩家时不会误逼近', () => {
    expect(evaluateTree(WANDERER_PATROL_TREE, ctxOf({ sense: { night: false } }))).toEqual([]);
    const noPlayer = evaluateTree(
      WANDERER_PATROL_TREE,
      ctxOf({ sense: { night: true, playerX: null, playerDistance: null, patrolX: 640 } }),
    );
    expect(noPlayer).toEqual([
      { kind: 'goTo', x: 640 },
      { kind: 'playAnimation', clip: 'patrol' },
    ]);
  });
});

describe('behaviour：组件挂载（实体模板三型）', () => {
  it('behaviourTreeOf 从组件列表取树；缺省返回 null', () => {
    const components: EntityComponent[] = [
      { type: 'flag', flagKey: 'wanderer.grudge' },
      { type: 'trigger', triggerId: 'wanderer.spawn' },
      { type: 'behaviourTree', tree: WANDERER_PATROL_TREE },
    ];
    expect(behaviourTreeOf(components)).toBe(WANDERER_PATROL_TREE);
    expect(behaviourTreeOf([{ type: 'flag', flagKey: 'x' }])).toBeNull();
    expect(behaviourTreeOf(undefined)).toBeNull();
  });

  it('组件取树后可直接求值（挂载 → 求值的完整链路）', () => {
    const components: EntityComponent[] = [{ type: 'behaviourTree', tree: WANDERER_PATROL_TREE }];
    const tree = behaviourTreeOf(components);
    expect(tree).not.toBeNull();
    const atoms = evaluateTree(tree!, ctxOf({ sense: { playerX: 300, playerDistance: 200 } }));
    expect(atoms).toEqual([
      { kind: 'goTo', x: 300 },
      { kind: 'playAnimation', clip: 'stalk' },
    ]);
  });
});
