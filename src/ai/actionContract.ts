// NPC 结构化动作契约：模型直接声明「意图」，不再由本层从自然语言里猜。
//
// 为什么需要这一层：旧路径让模型回 dialogue + 一段人话，再由关键词正则判断
// 「他是不是想修门」。于是「现在材料不够，我不能修门」会被 /修|门/ 命中，
// 翻译成 repair_gate——模型明确拒绝，系统却当成同意。Validator 只能拦非法
// 操作，拦不住「语义相反」。所以意图必须由模型显式声明，本层只做形状校验，
// 不做语义推断。
//
// 分层铁律不变：本文件只产出「提议」，不执行、不校验资源、不碰 GameState。
// 任何形状瑕疵一律返回 null（调用方降级到规则脑），绝不猜、不补、不抛异常。

import { getItem, isItemId } from '../data/items';
import type { ItemId } from '../core/gameTypes';
import type {
  CompetitionActionProposal,
  CompetitionObservationSnapshot,
} from './competition-contract';

/**
 * 模型可以直接表达的意图白名单。
 *
 * 故意不给模型 open_gate / take_item / attack 这类能单方面改世界的动作：
 * 修门只能「申请」，玩家物资只能「被请求」，赠与只能「接受玩家递来的」。
 */
export const CONTRACT_INTENTS = [
  'observe',
  'wait',
  'refuse',
  'request_help',
  'accept_gift',
  'propose_trade',
  'repair_gate',
] as const;

export type ContractIntent = (typeof CONTRACT_INTENTS)[number];

/**
 * 单次契约里允许出现的最大数量。
 *
 * 与堆叠上限取小值：数量的上界必须是「模型不可能一次要空玩家」的水平，
 * 否则一句 propose_trade 就能把 99 个净水全部搬走——即便 validator 能拒，
 * 也不该让这种提案进入 trace 污染 Judge Mode 的阅读。
 */
export const MAX_CONTRACT_QUANTITY = 9;

/** utterance 上限。与 rulesExecutor.MAX_UTTERANCE 同值；一致性测试锁死两者相等。 */
const MAX_UTTERANCE = 60;

/** 物品数量描述。契约里所有带物品的意图都复用这一形状。 */
export interface ContractItemRequest {
  readonly itemId: ItemId;
  readonly quantity: number;
}

interface ContractCommon {
  readonly utterance?: string;
  /** 0..1；缺失按 0.5 处理，越界直接判为形状不符。 */
  readonly confidence: number;
}

/**
 * 模型的完整意图集。
 *
 * `refuse` 是一等公民：拒绝必须能表达、能被 trace 记录、且永远不能在下游
 * 被当成同意。`repair_gate` 不携带材料——材料是规则层的事实，模型自造材料
 * 等于伪造资源。
 */
export type ContractProposal =
  | (ContractCommon & { readonly intent: 'observe' })
  | (ContractCommon & { readonly intent: 'wait' })
  | (ContractCommon & { readonly intent: 'refuse'; readonly reason?: string })
  | (ContractCommon & { readonly intent: 'request_help' } & ContractItemRequest)
  | (ContractCommon & { readonly intent: 'accept_gift' } & ContractItemRequest)
  | (ContractCommon & {
      readonly intent: 'propose_trade';
      /** 玩家要付出的（NPC 索取的）。 */
      readonly wants: ContractItemRequest;
      /** 玩家会得到的（NPC 支付的）。 */
      readonly offers: ContractItemRequest;
    })
  | (ContractCommon & { readonly intent: 'repair_gate'; readonly target?: string });

/** 提案的真实来源，供 UI 的 Judge Mode 如实标注，不允许把降级说成 AI。 */
export type ProposalSource = 'model' | 'rules' | 'fallback';

/** 翻译结果：提案本身 + 台词 + 来源；台词与来源都不参与裁决。 */
export interface BridgedProposal {
  readonly proposal: CompetitionActionProposal;
  readonly utterance?: string;
  readonly source: ProposalSource;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 运行时守卫：字符串必须命中白名单，别处（UI/日志）也能复用。 */
export function isContractIntent(value: unknown): value is ContractIntent {
  return typeof value === 'string' && (CONTRACT_INTENTS as readonly string[]).includes(value);
}

/**
 * 宽松 JSON 抽取：容忍 ```json 围栏与前后杂音，但只接受单个对象。
 * 抽不到返回 null——调用方降级，不要把半截 JSON 当意图。
 */
export function extractContractJson(raw: string): unknown {
  if (typeof raw !== 'string') return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  // 数组不是契约对象。若正文本身就是 `[{...}]`，静默取出里面的对象会掩盖
  // 「模型一次给了多条意图」这一违约事实，所以外层是数组就直接判负。
  if (candidate.trimStart().startsWith('[')) return null;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function clampUtterance(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length <= MAX_UTTERANCE ? trimmed : trimmed.slice(0, MAX_UTTERANCE);
}

/**
 * 物品请求校验。白名单 + 正整数 + 上界，三者缺一不可。
 *
 * 为什么在这里就拒绝而不是交给 validator：契约层的职责是「模型有没有按契约
 * 说话」。数量是 0 或 999 时，提案本身已经没有语义，让它进 trace 只会污染
 * 判断；而物品是否真的存在，validator 还会再查一遍（模型没有的货照样被拒）。
 */
function readItemRequest(value: unknown): ContractItemRequest | null {
  if (!isRecord(value)) return null;
  const { itemId, quantity } = value;
  if (typeof itemId !== 'string' || !isItemId(itemId)) return null;
  if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 1) return null;
  // 不可堆叠物品（撬棍/手电）的 maxStack 是 1，数量 2 没有意义。
  if (quantity > Math.min(MAX_CONTRACT_QUANTITY, getItem(itemId).maxStack)) return null;
  return { itemId, quantity };
}

/**
 * 契约的公共形状（所有意图共有）。`validateContractShape` 的产物类型。
 *
 * 这里只描述「任何意图都必须成立」的部分——是不是对象、intent 在不在白名单、
 * utterance/confidence 是否在域内。至于「这个 intent 还需要哪些字段」，由各
 * 解析器（parseContract / parseRepairIntent）自己叠加，因为维修场景只认四个
 * 意图，全局契约认七个，两者的合法性判定本来就该分开。
 */
export interface ContractShape {
  readonly intent: ContractIntent;
  readonly utterance?: string;
  readonly confidence: number;
  /** 扁平物品请求（request_help / accept_gift 用）。非法则为 null。 */
  readonly itemRequest: ContractItemRequest | null;
  /** propose_trade 的两侧；任一非法则为 null。 */
  readonly tradeWants: ContractItemRequest | null;
  readonly tradeOffers: ContractItemRequest | null;
  /** refuse 的理由、repair_gate 的目标门；仅原样搬运并截断。 */
  readonly reason?: string;
  readonly target?: string;
}

/**
 * 共享形状校验：唯一真源。
 *
 * 为什么必须只有一个真源：`repairIntent.ts` 与 `actionContract.ts` 是两个解析器，
 * 同一份模型输出分别经过它们。只要「什么算合法」有两套实现，就会出现一份输出
 * 在全局路径降级、在维修路径放行的分歧——现象是「同一个模型怎么有时候听懂了」，
 * 几乎无法排查。所以域判定（形状、白名单、数量上界、maxStack）全部集中在这里，
 * 两个解析器都调它；分歧只剩「本场景收不收这个意图」，那是设计意图。
 *
 * 只做形状与字段域判定，**不做意图分类路由**，也不做 proposal 映射——那些属于
 * 各解析器的场景职责。
 */
export function validateContractShape(obj: unknown): ContractShape | null {
  if (!isRecord(obj)) return null;

  const intent = obj.intent;
  if (!isContractIntent(intent)) return null;

  // confidence 是契约的一部分：显式给出时必须落在 0..1，越界即违约。
  // 缺省 0.5 —— 模型不表态不代表它反对，给中性值。
  if (obj.confidence !== undefined) {
    if (typeof obj.confidence !== 'number' || !Number.isFinite(obj.confidence) || obj.confidence < 0 || obj.confidence > 1) {
      return null;
    }
  }
  const confidence = obj.confidence === undefined ? 0.5 : obj.confidence;

  const utterance = clampUtterance(obj.utterance);

  // 物品字段一律按「给了就必须合法」处理：非法视为整条违约，而不是当成没给。
  // 否则模型写 quantity:0 会被当成「未指定」，绕过上界校验。
  const hasItemField = obj.itemId !== undefined || obj.quantity !== undefined;
  const itemRequest = hasItemField ? readItemRequest(obj) : null;
  if (hasItemField && itemRequest === null) return null;

  const hasTrade = obj.wants !== undefined || obj.offers !== undefined;
  const tradeWants = obj.wants !== undefined ? readItemRequest(obj.wants) : null;
  const tradeOffers = obj.offers !== undefined ? readItemRequest(obj.offers) : null;
  if (hasTrade && (tradeWants === null || tradeOffers === null)) return null;

  const reason =
    typeof obj.reason === 'string' && obj.reason.trim().length > 0 ? obj.reason.trim().slice(0, MAX_UTTERANCE) : undefined;
  const target =
    typeof obj.target === 'string' && obj.target.trim().length > 0 ? obj.target.trim().slice(0, MAX_UTTERANCE) : undefined;

  return {
    intent,
    confidence,
    itemRequest,
    tradeWants,
    tradeOffers,
    ...(utterance ? { utterance } : {}),
    ...(reason ? { reason } : {}),
    ...(target ? { target } : {}),
  };
}

/**
 * 模型正文 → 契约提案。形状不符一律 null。
 *
 * 这里刻意**没有**任何关键词分支：`intent` 是唯一的意图来源。所以「我不能
 * 修门」无论出现在 utterance 还是正文里，都不可能变成 repair_gate——除非模型
 * 自己写了 intent=repair_gate，而那是模型明示的申请，不是本层的推断。
 */
export function parseContract(raw: string): ContractProposal | null {
  const data = extractContractJson(raw);
  const shape = validateContractShape(data);
  if (!shape) return null;

  const { intent, confidence } = shape;
  const common = { confidence, ...(shape.utterance ? { utterance: shape.utterance } : {}) };

  switch (intent) {
    case 'observe':
      return { intent, ...common };
    case 'wait':
      return { intent, ...common };
    case 'refuse':
      // reason 只用于展示；不参与任何裁决。缺失也合法——「不」本身就是完整表达。
      return { intent, ...common, ...(shape.reason ? { reason: shape.reason } : {}) };
    case 'request_help':
      return shape.itemRequest ? { intent, ...common, ...shape.itemRequest } : null;
    case 'accept_gift':
      return shape.itemRequest ? { intent, ...common, ...shape.itemRequest } : null;
    case 'propose_trade': {
      // 双向缺一不可：只有「我要什么」没有「我给什么」等于索要，不是交易。
      if (!shape.tradeWants || !shape.tradeOffers) return null;
      return { intent, ...common, wants: shape.tradeWants, offers: shape.tradeOffers };
    }
    case 'repair_gate':
      return { intent, ...common, ...(shape.target ? { target: shape.target } : {}) };
  }
}

/** 结构守卫：给 UI/日志等外部调用方判断一条已解析值是否仍是完整契约。 */
export function isContractProposal(value: unknown): value is ContractProposal {
  if (!isRecord(value) || !isContractIntent(value.intent)) return false;
  switch (value.intent) {
    case 'observe':
    case 'wait':
      return true;
    case 'refuse':
    case 'repair_gate':
      return value.reason === undefined || typeof value.reason === 'string';
    case 'request_help':
    case 'accept_gift':
      return readItemRequest(value) !== null;
    case 'propose_trade':
      return readItemRequest(value.wants) !== null && readItemRequest(value.offers) !== null;
  }
}

/**
 * 翻译上下文。
 *
 * 与旧 TranslationContext 的差别：补上 NPC 自己的背包。方向修正以后，
 * 「NPC 送给玩家」必须能查 NPC 有没有这件货，否则提案就是凭空造物。
 */
export interface ContractTranslationContext {
  readonly npcId: string;
  readonly playerInventory: readonly { itemId: ItemId; quantity: number }[];
  /** NPC 当前持有物；缺省视为「未知」，任何涉及 NPC 付出的意图都返回 null。 */
  readonly npcInventory?: readonly { itemId: ItemId; quantity: number }[];
  /** 当前门禁 id；模型只能申请修这一扇。 */
  readonly gateId?: string;
  /** 维修配方；由规则层提供，模型不得自造。 */
  readonly repairMaterials?: readonly { itemId: ItemId; quantity: number }[];
}

function holds(
  inventory: readonly { itemId: ItemId; quantity: number }[] | undefined,
  itemId: ItemId,
  quantity: number,
): boolean {
  if (!inventory) return false;
  return inventory.reduce((total, stack) => total + (stack.itemId === itemId ? stack.quantity : 0), 0) >= quantity;
}

/**
 * 契约 → 可执行竞赛提案。
 *
 * 三条不可逾越的边界：
 * 1. 方向由契约语义固定：accept_gift 永远是 player→npc，gift 类提议不可能反向。
 * 2. trade 永远双向：wants→playerGives、offers→playerReceives，绝不压成单向。
 * 3. 维修材料只来自 ctx（规则层），模型说「我能修」不构成修门的充分条件。
 *
 * 返回 null 表示「这条契约在当前世界状态下没有合法落地形态」，调用方应降级，
 * 而不是自己补一个动作。
 */
export function contractToProposal(
  contract: ContractProposal,
  ctx: ContractTranslationContext,
): BridgedProposal | null {
  const utterance = contract.utterance;
  const withUtterance = utterance ? { utterance } : {};
  const source: ProposalSource = 'model';

  switch (contract.intent) {
    case 'observe':
    case 'wait':
    case 'refuse':
      // 三者都不改世界。refuse 显式落在 observe：拒绝的语义留在 utterance 与
      // 契约本身里，绝不映射成任何状态变更动作（尤其不是 repair_gate）。
      return {
        proposal: { kind: 'observe', target: { kind: 'npc', npcId: ctx.npcId } },
        ...withUtterance,
        source,
      };

    case 'request_help':
      // 求援是「说」，不是「拿」。用 ask 保住结构化问题，执行器不支持时会
      // 被 validator 拒绝（不产生任何状态变更），而不是偷偷替代成赠与。
      return {
        proposal: { kind: 'ask', npcId: ctx.npcId, question: utterance ?? `能帮我找 ${contract.itemId} 吗？` },
        ...withUtterance,
        source,
      };

    case 'accept_gift':
      // 玩家递过来，NPC 收下。前提是玩家真的持有——否则就是 NPC 凭空取物。
      // 注意：这只是提议，扣减玩家库存仍由 validator + 执行器裁决，且调用方
      // 必须保留玩家确认边界（本层永远不提交）。
      if (!holds(ctx.playerInventory, contract.itemId, contract.quantity)) return null;
      return {
        proposal: {
          kind: 'give',
          transfer: { from: 'player', to: { kind: 'npc', npcId: ctx.npcId }, itemId: contract.itemId, quantity: contract.quantity },
        },
        ...withUtterance,
        source,
      };

    case 'propose_trade': {
      // 双向交易的执行器能力已存在（CompetitionActionProposal.trade 带
      // playerGives 与 playerReceives 两个方向），所以这里必须两个方向都填。
      // 任何一边不成立就整条拒绝：单向压缩会让 NPC 承诺的东西凭空消失。
      if (!holds(ctx.playerInventory, contract.wants.itemId, contract.wants.quantity)) return null;
      if (ctx.npcInventory === undefined) return null;
      if (!holds(ctx.npcInventory, contract.offers.itemId, contract.offers.quantity)) return null;
      return {
        proposal: {
          kind: 'trade',
          npcId: ctx.npcId,
          playerGives: {
            from: 'player',
            to: { kind: 'npc', npcId: ctx.npcId },
            itemId: contract.wants.itemId,
            quantity: contract.wants.quantity,
          },
          playerReceives: {
            from: { kind: 'npc', npcId: ctx.npcId },
            to: 'player',
            itemId: contract.offers.itemId,
            quantity: contract.offers.quantity,
          },
        },
        ...withUtterance,
        source,
      };
    }

    case 'repair_gate': {
      // 门禁与配方都必须由调用方（规则层）配置。模型即便写了别的 target，
      // 也不能指向第二扇门——修门是「申请当前这扇」，不是「挑一扇」。
      if (ctx.gateId === undefined || ctx.repairMaterials === undefined) return null;
      if (contract.target !== undefined && contract.target !== ctx.gateId) return null;
      return {
        proposal: { kind: 'repair_gate', gateId: ctx.gateId, materials: ctx.repairMaterials.map((m) => ({ ...m })) },
        ...withUtterance,
        source,
      };
    }
  }
}

/** 便捷入口：正文直接翻译成提案（解析失败 → null）。 */
export function translateContractRaw(raw: string, ctx: ContractTranslationContext): BridgedProposal | null {
  const contract = parseContract(raw);
  return contract ? contractToProposal(contract, ctx) : null;
}

// ── 保鲜 / 陈旧检查 ─────────────────────────────────────────────────────────
//
// 与 NpcRuntime.isDialogueFresh 同一思路：异步决策返回时，玩家可能已经换了
// 楼层、翻了选项、读了档。过期提案绝不能落盘，否则会把玩家拉回旧世界。

/** 观察快照的时间戳指纹；只取能唯一标识「这一屏」的四个字段。 */
export interface ObservationStamp {
  readonly observationId: string;
  readonly seed: number;
  readonly day: number;
  readonly gameMinute: number;
}

export function stampObservation(observation: CompetitionObservationSnapshot): ObservationStamp {
  return {
    observationId: observation.observationId,
    seed: observation.world.seed,
    day: observation.world.day,
    gameMinute: observation.world.gameMinute,
  };
}

/**
 * 提案是否仍然新鲜。任一字段变化都算过期——包括只过了 1 分钟：
 * 维修与交易都以逻辑时间为前提，过期提案必须重新观察后再决策。
 */
export function isProposalFresh(captured: ObservationStamp, current: ObservationStamp): boolean {
  return (
    captured.observationId === current.observationId &&
    captured.seed === current.seed &&
    captured.day === current.day &&
    captured.gameMinute === current.gameMinute
  );
}