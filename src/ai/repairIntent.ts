// 维修意图：把「修不修」这件事从自然语言关键词里拿出来，交给结构化意图。
//
// 这个文件属于 A0（总控）——A1 正在同目录重构动作契约，请勿修改本文件，
// 需要改接口请找 A0。
//
// **语义以 `actionContract.ts` 为准，本文件只做维修任务的特化。**
// 具体说：`utterance` 上限、`request_help` 的数量口径、数量上界，这三处必须
// 和全局契约保持一致——同一份模型输出在两条路径上结局不同，是最难排查的一类
// 缺陷（现象是「同一个模型为什么有时候听懂了」）。任何一处要改，先改
// `actionContract.ts`，再回来同步这里。
//
// 为什么不直接并入 actionContract：那边是跨七个动作的统一入口，维修任务若
// 强行走它，必须携带全部七个动作的校验分支，反而更容易在「无关意图」上出
// 漏洞。职责划分是：全局层定**契约形状**，本文件定**这个任务的提示与闭环**。
//
// 为什么必须结构化：
//
// 旧实现在 competitionModelBridge.ts 里用 `/修|门|通道|通道门|repair|gate/i`
// 判断模型是否想维修。模型说「现在材料不足，我不能修门」也会命中这条正则，
// 于是拒绝被翻译成维修提案。validator 能拦住非法操作，却拦不住「模型明确
// 拒绝、系统当成同意」——它看到的只是一个格式合法的 repair_gate 提案。
//
// 这在结构上无法用提示词补丁修好：只要判定维度是「句子里有没有这个字」，
// 否定、条件、假设、转述就都会漏。所以这里只认模型显式给出的 intent。

import type { ItemId, InventoryStack } from '../core/gameTypes';
import { ITEMS } from '../data/items';
import { extractContractJson, validateContractShape } from './actionContract';

/** 模型可以为维修这件事表达的意图。刻意很小。 */
export const REPAIR_INTENTS = ['repair_gate', 'observe', 'request_help', 'refuse'] as const;
export type RepairIntent = (typeof REPAIR_INTENTS)[number];

/**
 * 单次请求的最大数量已上移到 `actionContract.ts` 的共享校验层（上界取
 * `min(MAX_CONTRACT_QUANTITY, maxStack)`）。本文件不再另立一个数字——
 * 同一个约束只能有一个来源，否则两条解析路径迟早漂移。
 *
 * 保留这段说明是因为数字本身容易被人「顺手加回来」：上界存在的理由不是
 * 防模型要太多（validator 会拒），而是不让这种提案进入 trace——Judge Mode
 * 里出现「NPC 索要 99 个净水」会让评审读起来像系统失控。
 */

export interface RepairIntentDecision {
  readonly intent: RepairIntent;
  /** 模型说给玩家听的话。可以为空——不强迫模型每次都说。 */
  readonly utterance?: string;
  /** request_help 时它缺的具体物品。 */
  readonly itemId?: ItemId;
  readonly quantity?: number;
}

function isIntent(value: unknown): value is RepairIntent {
  return typeof value === 'string' && (REPAIR_INTENTS as readonly string[]).includes(value);
}

/**
 * 从模型原始正文里解析维修意图。任何形状不符都返回 null（→ 走降级），
 * 不做猜测、不做关键词兜底。
 *
 * 形状与字段域判定全部交给 `validateContractShape`（唯一真源），本函数只负责
 * 维修场景特有的两件事：意图白名单收窄到 `REPAIR_INTENTS`，以及把通用形状
 * 归一成 `RepairIntentDecision`。这样同一份模型输出在两条路径上的合法性判定
 * 不会漂移——一致性测试 `contractConsistency.test.ts` 锁住了这一点。
 *
 * 接受三种形态，按宽松到严格排列：
 *   1. 纯 JSON：{"intent":"repair_gate","utterance":"..."}
 *   2. 包在 ```json 代码块里
 *   3. 前后有解释性文字，中间一段 JSON（模型很爱这么干）
 *
 * **不接受数组**：`[{"intent":"observe"}]` 返回 null。模型一次给出多条意图是
 * 违约事实，静默从容器里捞第一个对象会掩盖它——全局契约同样是判负，两条路
 * 必须一致。`extractContractJson` 已含这条判断。
 */
export function parseRepairIntent(raw: string): RepairIntentDecision | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  const shape = validateContractShape(extractContractJson(raw));
  if (!shape) return null;
  // 场景白名单：维修回合只认这四个意图。模型在此处冒出 propose_trade 之类
  // 的合法意图，也不算维修决策——它不是契约违约，只是跑题。
  if (!isIntent(shape.intent)) return null;

  const decision: { -readonly [K in keyof RepairIntentDecision]: RepairIntentDecision[K] } = {
    intent: shape.intent,
  };
  if (shape.utterance) decision.utterance = shape.utterance;
  if (shape.intent === 'request_help') {
    // 缺什么说不清就不算有效请求；数量必须显式给出。
    //
    // 这里原来「缺省当 1」——但那等于替模型编了一个它没说的数字。玩家按
    // 1 个去凑，模型下次又改口要 2 个，责任在谁？宁可整条作废（→ 降级到
    // 规则脑），也不替模型补它没表达的量。共享校验层已按 maxStack 与上界
    // 挡掉非法数量，这里只需确认字段存在。
    if (!shape.itemRequest) return null;
    decision.itemId = shape.itemRequest.itemId;
    decision.quantity = shape.itemRequest.quantity;
  }
  return decision;
}

function fmtMaterials(materials: readonly InventoryStack[]): string {
  return materials
    .map((stack) => `${stack.itemId}(${ITEMS[stack.itemId]?.displayName ?? stack.itemId})×${stack.quantity}`)
    .join('、');
}

export interface RepairPromptInput {
  readonly npcName: string;
  readonly trust: number;
  readonly trustThreshold: number;
  readonly materials: readonly InventoryStack[];
  /** 玩家背包里现有的；模型据此判断「材料到底够不够」。 */
  readonly playerHas: readonly InventoryStack[];
  readonly previousRejectedReason?: string;
}

/**
 * 构造维修决策的提示。
 *
 * 有意把「够不够」的事实直接摆给模型，而不是让它从一堆状态里自己推——
 * 我们要评的是它怎么决定，不是它会不会算减法。算错了会被 validator 拦，
 * 但那样一来这一轮就没有教学价值了。
 */
export function buildRepairPrompt(input: RepairPromptInput): string {
  const have = new Map<string, number>();
  for (const stack of input.playerHas) {
    have.set(stack.itemId, (have.get(stack.itemId) ?? 0) + stack.quantity);
  }
  const enough = input.materials.every((need) => (have.get(need.itemId) ?? 0) >= need.quantity);
  const shortage = input.materials
    .filter((need) => (have.get(need.itemId) ?? 0) < need.quantity)
    .map((need) => `${need.itemId}×${need.quantity - (have.get(need.itemId) ?? 0)}`);

  return [
    `你是${input.npcName}，这栋楼里的维修工。你面前是玩家。`,
    `维修这道门需要：${fmtMaterials(input.materials)}。`,
    `玩家手上现有一共：${input.playerHas.map((s) => `${s.itemId}×${s.quantity}`).join('、') || '什么都没有'}。`,
    `材料是否齐备：${enough ? '齐备' : `缺 ${shortage.join('、')}`}。`,
    `你对这个玩家的信任是 ${input.trust}，肯一起干活的门槛是 ${input.trustThreshold}。`,
    input.previousRejectedReason ? `上一轮你的提案被拒绝了，原因是：${input.previousRejectedReason}。` : '',
    '',
    '现在选一个意图，只输出 JSON，不要别的话：',
    '{"intent":"repair_gate|observe|request_help|refuse","utterance":"你说的话，40字以内"}',
    '意图含义：',
    '  repair_gate = 现在就动手修（只有材料和信任都够时才该选）',
    '  request_help = 缺材料，请玩家去找（附 "itemId" 与 "quantity"）',
    '  refuse = 你判断不该修、或不愿意修',
    '  observe = 先看看情况，暂不行动',
  ]
    .filter((line) => line !== '')
    .join('\n');
}