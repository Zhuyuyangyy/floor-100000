// 两套契约的一致性测试：同一份模型输出，两个解析器必须对「这是不是一次
// 状态变更」给出相同判断。
//
// 为什么必须有这个测试：`repairIntent.ts`（A0，维修任务特化）和
// `actionContract.ts`（A1，跨七动作的通用契约）是两份独立实现。注释约束不住
// 人——只要有一处口径漂移，同一份模型输出在两条路径上就会得到不同结局，而
// 现象是「同一个模型怎么有时候听懂了」，几乎无法排查。
//
// 所以这里不测「解析得多好」，只测**两个解析器之间的一致性**：把同一串正文
// 同时喂给两边，比较它们对「是否产生状态变更意图」的分类。
//
// 分类口径（Effect）：
//   state_change = 会产生库存/门禁/信任等世界变更（repair_gate / accept_gift /
//                  propose_trade）
//   none         = 不改变世界（observe / wait / refuse / request_help）
//   rejected     = 判为不合法契约（null）
//
// `request_help` 归入 none 是刻意的，但依据要说准：
// 它译成 ask，而 runtime 在 validate 之前就会丢弃它 ——
// `competitionRuntime` 会先查 observation.availableActions 是否含 proposal.kind，
// 四个场景的动作全集里都没有 ask，于是它被当成 proposal_unavailable 直接丢弃，
// **validator 根本不会被调用**（competitionRuntime.test.ts 有一条用例把这个
// 行为钉死了：fallback 返回 {kind:'ask'}，断言 validationCount 与 executionCount
// 都是 0）。
//
// 所以「世界不变」的结论对，但原因不是 validator 拒了它。别照着旧理由去改
// competitionRules.MUTATION_KINDS —— 加不加 ask 都不影响这条路径。
//
// validator 那层（MUTATION_KINDS 不含 ask → action_not_supported_by_demo_executor）
// 只是兜底，不经 runtime 直接调 validateCompetitionProposal 时才碰得到。

import { describe, expect, it } from 'vitest';
import { parseRepairIntent } from './repairIntent';
import { parseContract, type ContractProposal } from './actionContract';

type Effect = 'state_change' | 'none' | 'rejected';

/** 契约意图 → 世界效果。新增意图时必须在这里分类，否则编译报错。 */
function contractEffect(contract: ContractProposal | null): Effect {
  if (!contract) return 'rejected';
  switch (contract.intent) {
    case 'repair_gate':
    case 'accept_gift':
    case 'propose_trade':
      return 'state_change';
    case 'observe':
    case 'wait':
    case 'refuse':
    case 'request_help':
      return 'none';
  }
}

/** 维修意图 → 世界效果。只有 repair_gate 改世界。 */
function repairEffect(decision: ReturnType<typeof parseRepairIntent>): Effect {
  if (!decision) return 'rejected';
  return decision.intent === 'repair_gate' ? 'state_change' : 'none';
}

/** 两个解析器对同一输入的效果分类。 */
function effects(raw: string): { contract: Effect; repair: Effect } {
  return { contract: contractEffect(parseContract(raw)), repair: repairEffect(parseRepairIntent(raw)) };
}

// ── 已对齐：共享意图上两边判断一致 ─────────────────────────────────────────

describe('契约一致性：共享的四个意图，两边效果分类相同', () => {
  const shared: ReadonlyArray<readonly [string, string, Effect]> = [
    ['observe 裸 JSON', '{"intent":"observe"}', 'none'],
    ['observe 带台词', '{"intent":"observe","utterance":"我看看。"}', 'none'],
    ['refuse 裸 JSON', '{"intent":"refuse"}', 'none'],
    ['refuse 带理由', '{"intent":"refuse","reason":"材料不够"}', 'none'],
    ['refuse 带台词', '{"intent":"refuse","utterance":"我不动这门。"}', 'none'],
    ['repair_gate 裸 JSON', '{"intent":"repair_gate"}', 'state_change'],
    ['repair_gate 带台词', '{"intent":"repair_gate","utterance":"动手吧。"}', 'state_change'],
    [
      'request_help 完整',
      '{"intent":"request_help","itemId":"tape","quantity":2}',
      'none',
    ],
  ];

  for (const [label, raw, expected] of shared) {
    it(`${label} → ${expected}`, () => {
      const result = effects(raw);
      expect(result.contract).toBe(expected);
      expect(result.repair).toBe(expected);
      expect(result.contract).toBe(result.repair);
    });
  }

  it('两边都接受 markdown 代码块包裹', () => {
    const raw = '```json\n{"intent":"observe","utterance":"我先看看线路。"}\n```';
    expect(effects(raw)).toEqual({ contract: 'none', repair: 'none' });
  });

  it('两边都接受前后有解释文字', () => {
    const raw = '好的，我的决定是：{"intent":"refuse","utterance":"我不动。"} 就这样。';
    expect(effects(raw)).toEqual({ contract: 'none', repair: 'none' });
  });
});

// ── 已对齐：脏输入两边都拒绝 ───────────────────────────────────────────────

describe('契约一致性：脏输入两边都判 rejected', () => {
  const dirty: ReadonlyArray<readonly [string, string]> = [
    ['空正文', ''],
    ['纯空白', '   '],
    ['纯文本', '我不知道该怎么回答。'],
    ['缺 intent 字段', '{"utterance":"没有 intent"}'],
    ['未知 intent', '{"intent":"execute_arbitrary_code"}'],
    ['intent 不是字符串', '{"intent":123}'],
    ['JSON 截断', '{"intent":"repair_gate"'],
    ['字面 null', 'null'],
    ['数组', '[]'],
    ['request_help 物品不在白名单', '{"intent":"request_help","itemId":"钻石","quantity":1}'],
    ['request_help 缺 quantity', '{"intent":"request_help","itemId":"tape"}'],
    ['request_help 数量为 0', '{"intent":"request_help","itemId":"tape","quantity":0}'],
    ['request_help 数量为负', '{"intent":"request_help","itemId":"tape","quantity":-1}'],
    ['request_help 数量非整数', '{"intent":"request_help","itemId":"tape","quantity":1.5}'],
    ['request_help 数量超上界 9', '{"intent":"request_help","itemId":"tape","quantity":10}'],
  ];

  for (const [label, raw] of dirty) {
    it(`${label} → 两边都 null`, () => {
      expect(effects(raw)).toEqual({ contract: 'rejected', repair: 'rejected' });
    });
  }
});

// ── 核心不变量：否定永不变成维修（这是整条缺陷的验收点） ───────────────────

describe('契约一致性：否定句在两条路径上都不产生状态变更', () => {
  const negations = [
    '{"intent":"refuse","utterance":"现在材料不足，我不能修门。"}',
    '{"intent":"refuse","utterance":"我不修门。"}',
    '{"intent":"refuse","utterance":"这扇门我修不了。"}',
    '{"intent":"refuse","reason":"材料不足不能修门","utterance":"修不了"}',
    '{"intent":"observe","utterance":"材料不足不能修门，我只能先看看。"}',
    '{"intent":"observe","utterance":"通道门先放着，我不动。"}',
    '{"intent":"request_help","itemId":"tape","quantity":2,"utterance":"缺胶带，修不了。"}',
  ];

  for (const raw of negations) {
    it(`不产生 state_change：${raw.slice(0, 44)}…`, () => {
      const result = effects(raw);
      expect(result.contract).toBe('none');
      expect(result.repair).toBe('none');
      // 额外钉死：任何一边都不得解析成 repair_gate。
      expect(parseContract(raw)?.intent).not.toBe('repair_gate');
      expect(parseRepairIntent(raw)?.intent).not.toBe('repair_gate');
    });
  }

  it('台词里含「修门」但这个字不构成意图——两边都不改世界', () => {
    const raw = '{"intent":"observe","utterance":"我去修门。"}';
    expect(effects(raw)).toEqual({ contract: 'none', repair: 'none' });
  });
});

// ── 预期的不对称：维修专用契约不收全局独有意图 ─────────────────────────────

describe('契约一致性：故意保留的不对称（不是缺陷）', () => {
  // 这三个意图只在全局契约里。维修任务收不到它们是设计目标，不是漂移：
  // 维修回合里模型不该冒出「我们做笔交易吧」。
  const onlyGlobal = [
    '{"intent":"wait"}',
    '{"intent":"accept_gift","itemId":"tape","quantity":1}',
    '{"intent":"propose_trade","wants":{"itemId":"wood","quantity":1},"offers":{"itemId":"wire","quantity":1}}',
  ];

  for (const raw of onlyGlobal) {
    it(`全局契约能收、维修契约拒绝：${raw.slice(0, 34)}…`, () => {
      const result = effects(raw);
      expect(result.repair).toBe('rejected');
      expect(result.contract).not.toBe('rejected');
      // 不对称是单向的：维修契约永远不能比全局契约更宽松。
      // 若哪天维修契约收下了全局独有意图，说明它绕过了自己的白名单。
    });
  }

  it('维修契约的意图集是全局契约的真子集', () => {
    // request_help 需要携带物品，所以这里按各意图的合法最小形状构造，
    // 而不是统一裸 `{"intent":...}`——后者对 request_help 本来就是非法输入。
    const samples = [
      ['repair_gate', '{"intent":"repair_gate"}'],
      ['observe', '{"intent":"observe"}'],
      ['request_help', '{"intent":"request_help","itemId":"tape","quantity":1}'],
      ['refuse', '{"intent":"refuse"}'],
    ] as const;
    for (const [intent, raw] of samples) {
      expect(parseContract(raw)?.intent).toBe(intent);
      expect(parseRepairIntent(raw)?.intent).toBe(intent);
    }
  });
});

// ── 曾漂移、现已对齐（回归锁） ───────────────────────────────────────────────
//
// 这两条曾经是真红：维修契约只校验它关心的字段，对契约外的字段不做判定，
// 于是同一份输出在全局路径降级、维修路径放行。修法是把「什么算合法」上移到
// actionContract.validateContractShape 这个唯一真源，两个解析器都调它。
//
// 留在这里是为了防回退：谁再往 repairIntent 里塞一套独立校验，这两条立刻红。

describe('契约一致性：曾漂移项，现已由共享校验对齐', () => {
  it('不可堆叠物品的数量上界：两边都按 maxStack 拒绝', () => {
    // 撬棍 maxStack=1，要 2 个在语义上不可能。上界判定在共享层，两边一致。
    const raw = '{"intent":"request_help","itemId":"crowbar","quantity":2}';
    expect(effects(raw)).toEqual({ contract: 'rejected', repair: 'rejected' });
  });

  it('confidence 越界：两边都整条拒绝', () => {
    // confidence 是契约的一部分，越界即违约。曾经维修契约根本不读这个字段，
    // 导致同一份输出一条通过、一条降级。
    const raw = '{"intent":"observe","confidence":1.5}';
    expect(effects(raw)).toEqual({ contract: 'rejected', repair: 'rejected' });
  });

  it('数组包裹对象：两边都拒绝（不猜「取第一个」）', () => {
    const raw = '[{"intent":"observe"}]';
    expect(effects(raw)).toEqual({ contract: 'rejected', repair: 'rejected' });
  });
});

// ── utterance 截断口径 ────────────────────────────────────────────────────

describe('契约一致性：utterance 截断到同一个长度', () => {
  const long = '啊'.repeat(200);

  it('两边都截到 60 字（对齐 rulesExecutor.MAX_UTTERANCE）', () => {
    const raw = `{"intent":"observe","utterance":"${long}"}`;
    const contract = parseContract(raw);
    const repair = parseRepairIntent(raw);
    expect(contract?.utterance?.length).toBe(60);
    expect(repair?.utterance?.length).toBe(60);
    expect(contract?.utterance).toBe(repair?.utterance);
  });

  it('空白台词两边都视为没说（undefined）', () => {
    const raw = '{"intent":"observe","utterance":"   "}';
    expect(parseContract(raw)?.utterance).toBeUndefined();
    expect(parseRepairIntent(raw)?.utterance).toBeUndefined();
  });
});