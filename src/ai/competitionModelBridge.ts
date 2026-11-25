// 竞赛闭环的模型决策端口：把 CompetitionObservationSnapshot 送进真实模型，
// 再把模型的输出翻译成 CompetitionActionProposal。
//
// 分层铁律不变：模型只「提议」，competitionRules 裁决，executor 执行。
// 本模块只做两件事——把结构化观察压成 prompt，把模型输出翻译成契约动作。
// 翻译失败一律返回 null，让运行时走 rules 降级，绝不伪造动作。
//
// 2026-11 修正（A1）：
// 1. 删掉了基于关键词的维修推断。「我不能修门」曾经因为 /修|门/ 命中被翻译成
//    repair_gate——模型拒绝、系统照做。现在维修只能来自结构化 intent。
// 2. 修正 gift/trade 的方向。NpcAction 的权威语义（见 rulesExecutor.validateTrade
//    与 validateGift）是「give = 我付出、get = 我索取」，旧翻译层把它反着用了：
//    gift 被压成玩家单向送出，NPC 承诺回报的东西凭空消失。

import type {
  CompetitionNpcStateSnapshot,
  CompetitionObservationSnapshot,
} from './competition-contract';
import { itemVocabulary, parseProposal } from './prompt';
import type { MemoryEntry, NpcActionKind, NpcActionProposal, NpcBrain, NpcObservation } from './types';
import type { ItemId } from '../core/gameTypes';
import { ARCHETYPE_ACTIONS, ARCHETYPES, NPC_PROFILES, type NpcProfile } from '../data/npcPersonalities';
import { isNight } from '../systems/SurvivalSystem';
import {
  contractToProposal,
  parseContract,
  type BridgedProposal,
  type ContractTranslationContext,
  type ProposalSource,
} from './actionContract';

/** 竞赛快照 → 进入模型的最小事实集。不复用 NpcObservation，避免字段语义打架。 */
export interface ModelDecisionRequest {
  readonly systemPrompt: string;
  readonly userPrompt: string;
}

const MAX_UTTERANCE = 60;

function fmtMinute(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = Math.floor(minute % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function focusNpc(observation: CompetitionObservationSnapshot): CompetitionNpcStateSnapshot | null {
  const focus = observation.focus;
  if (!focus || typeof focus === 'string') return null;
  return observation.world.npcs.find((npc) => npc.npcId === focus.npcId) ?? null;
}

function inventoryText(items: readonly { itemId: string; quantity: number }[]): string {
  if (items.length === 0) return '空';
  return items.map((stack) => `${stack.itemId}×${stack.quantity}`).join('、');
}

function memoryText(npc: CompetitionNpcStateSnapshot | null): string {
  if (!npc || npc.memory.length === 0) return '（尚无共同经历）';
  return npc.memory
    .map((entry) => {
      if (entry.kind === 'fact') return `第${entry.day}天 ${entry.subject}=${entry.value}`;
      if (entry.kind === 'promise') return `第${entry.day}天 承诺(${entry.status})：${entry.promise}`;
      return `第${entry.day}天 ${entry.kind}(${entry.status})：${entry.description}`;
    })
    .join('；');
}

/** NPC id → 中文显示名；未知 id 原样返回，不编造人名。 */
const NPC_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  alin: '阿林',
  xiaozhou: '小周',
  laochen: '老陈',
  daliu: '大刘',
  azhen: '阿珍',
  xiaoman: '小满',
  wanderer: '流浪者',
};

function displayName(npcId: string): string {
  return NPC_DISPLAY_NAMES[npcId] ?? npcId;
}

/**
 * 构造竞赛决策 prompt。
 *
 * 与旧 NpcObservation prompt 的关键差异：这里必须把「结构化状态」摊开给模型看
 * （库存、信任、门禁、可用意图），否则模型只能猜，行为无法与状态关联。
 *
 * 输出契约写的是 actionContract 的意图集，不是旧的 action.type 包一层。模型
 * 直接声明意图，翻译层才不需要猜——这正是「我不能修门」不再变成修门的根因。
 */
export function buildCompetitionPrompts(observation: CompetitionObservationSnapshot): ModelDecisionRequest {
  const world = observation.world;
  const npc = focusNpc(observation);
  const gate = world.gates[0];
  const npcId = npc?.npcId ?? 'alin';
  const systemPrompt = [
    `你是《第100000层：末日宿舍》中的 NPC「${displayName(npcId)}」（${npcId}）。`,
    '铁律：只能从「可用意图」里选一个；不得声称拥有背包里没有的物品；不得提及任何数值；不得跳出角色。',
    '不确定或不愿意做任何事时用 refuse——不要用 repair_gate 或 propose_trade 表达否定。',
    '只输出一个 JSON 对象，不要 markdown 代码块，不要解释。',
  ].join('\n');

  const allowedIntents = ['observe', 'wait', 'refuse', 'request_help', 'accept_gift', 'propose_trade'];
  if (observation.availableActions.includes('repair_gate')) allowedIntents.push('repair_gate');

  const userPrompt = [
    `情境：第${world.day}天 ${fmtMinute(world.gameMinute)}，第${world.currentFloor}层，种子 ${world.seed}。`,
    npc
      ? `我的状态：信任=${npc.trust}，好感=${npc.affinity}，压力=${npc.tension}，HP=${npc.hp}，饥饿=${npc.hunger}。`
      : '我的状态：未知。',
    `我的背包：${inventoryText(npc?.inventory ?? [])}`,
    `玩家背包：${inventoryText(world.player.inventory)}`,
    `玩家状态：HP=${world.player.hp}，饥饿=${world.player.hunger}，口渴=${world.player.thirst}，体力=${world.player.energy}。`,
    `相关记忆：${memoryText(npc)}`,
    gate ? `门禁 ${gate.gateId}：${gate.status}。` : '',
    `可用意图：${allowedIntents.join(', ')}`,
    `合法物品ID（必须用这些ID，禁止中文名）：${itemVocabulary()}`,
    // 契约行按当场可用集生成：把 repair_gate 写进「本场景不可用」的 prompt
    // 等于主动诱导模型越权，之后只能靠 validator 拒，等于浪费一次决策。
    `输出契约：{"intent":"${allowedIntents.join('|')}","utterance":"说的话，60字以内","confidence":0到1,"itemId":"","quantity":1,"wants":{"itemId":"","quantity":1},"offers":{"itemId":"","quantity":1},"target":"","reason":""}`,
    'intent 含义：request_help=请玩家帮忙找某物；accept_gift=收下玩家递来的物品；propose_trade 的 wants=玩家要付出的、offers=我要付出的' +
      (allowedIntents.includes('repair_gate') ? '；repair_gate=申请维修当前门禁。' : '。'),
    '只填当前 intent 需要的字段。数量必须是 1-9 的整数。',
  ]
    .filter((line) => line.length > 0)
    .join('\n');

  return { systemPrompt, userPrompt };
}

function clampUtterance(text: string | undefined): string | undefined {
  if (typeof text !== 'string') return undefined;
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length <= MAX_UTTERANCE ? trimmed : trimmed.slice(0, MAX_UTTERANCE);
}

/**
 * 翻译上下文。
 *
 * 与旧版的差别：补上 npcInventory。方向修正之后，「NPC 把东西给玩家」必须能
 * 确认 NPC 真的持有，否则提案就是凭空造物。
 */
export interface TranslationContext {
  readonly npcId: string;
  /** 玩家当前背包。 */
  readonly playerInventory: readonly { itemId: ItemId; quantity: number }[];
  /**
   * NPC 当前背包。缺省视为「未知」：任何需要 NPC 付出物品的翻译都返回 null，
   * 而不是假设他有一件再让 validator 去撞墙。
   */
  readonly npcInventory?: readonly { itemId: ItemId; quantity: number }[];
  /** 当前门禁 id；模型只能申请修它，不能凭空指定。 */
  readonly gateId?: string;
  /** 维修配方；由规则层提供，模型不得自造材料。 */
  readonly repairMaterials?: readonly { itemId: ItemId; quantity: number }[];
}

/** 翻译结果带上来源标记，供 Judge Mode 如实展示「这次是谁决定的」。 */
export type TranslatedProposal = BridgedProposal;

/**
 * 模型提案 → 可执行竞赛动作（旧 action.type 路径）。
 *
 * 只负责「形状映射 + 方向纠正」，不再承担任何意图推断：
 * - dialogue / refuse → observe。台词里出现「修」「门」也不会变成维修申请。
 * - gift → NPC 把物品交给玩家（NpcAction.gift 的权威语义，见 validateGift：
 *   npc 必须持有该物品）。旧实现把它反向压成 player→npc，等于玩家白送。
 * - trade → 双向 trade：get 是玩家付出，give 是玩家得到。
 * - attack / flee → null：竞赛层没有执行这些动作的能力，不静默降级。
 *
 * 安全边界：模型永远不能自己拼出「玩家→NPC」的赠礼方向，也不能自定材料清单。
 */
export function translateModelAction(
  proposal: NpcActionProposal | null,
  ctx: TranslationContext,
): TranslatedProposal | null {
  if (!proposal) return null;
  const utterance = clampUtterance(proposal.utterance);
  const withUtterance = utterance ? { utterance } : {};
  const source: ProposalSource = 'model';
  const action = proposal.action;

  if (action.type === 'dialogue' || action.type === 'refuse') {
    // 这里刻意不做关键词匹配：维修是状态变更动作，只能由结构化 intent 申请。
    return {
      proposal: { kind: 'observe', target: { kind: 'npc', npcId: ctx.npcId } },
      ...withUtterance,
      source,
    };
  }

  if (action.type === 'gift') {
    // NPC 送玩家：执行器与 validator 都支持这个方向（CompetitionNpcGivesItem +
    // give 分支的 !playerToNpc 路径），所以没必要退化成 null；但必须确认 NPC
    // 确实持有——不知道 NPC 背包时宁可不提案，也不假设。
    if (ctx.npcInventory === undefined) return null;
    if (!inventoryHas(ctx.npcInventory, action.itemId, action.quantity)) return null;
    return {
      proposal: {
        kind: 'give',
        transfer: { from: { kind: 'npc', npcId: ctx.npcId }, to: 'player', itemId: action.itemId, quantity: action.quantity },
      },
      ...withUtterance,
      source,
    };
  }

  if (action.type === 'trade') {
    // 双向保留：give 是 NPC 付出（玩家得到），get 是 NPC 索取（玩家付出）。
    // 缺任何一边就整条拒绝——单向压缩会让 NPC 承诺的东西凭空消失。
    if (ctx.npcInventory === undefined) return null;
    if (!inventoryHas(ctx.npcInventory, action.give.itemId, action.give.quantity)) return null;
    if (!inventoryHas(ctx.playerInventory, action.get.itemId, action.get.quantity)) return null;
    return {
      proposal: {
        kind: 'trade',
        npcId: ctx.npcId,
        playerGives: {
          from: 'player',
          to: { kind: 'npc', npcId: ctx.npcId },
          itemId: action.get.itemId,
          quantity: action.get.quantity,
        },
        playerReceives: {
          from: { kind: 'npc', npcId: ctx.npcId },
          to: 'player',
          itemId: action.give.itemId,
          quantity: action.give.quantity,
        },
      },
      ...withUtterance,
      source,
    };
  }

  return null;
}

/**
 * 从模型原始正文翻译（旧的 action.type 契约，保留为降级形态）。
 * 任何形状不符都返回 null；不会产出 repair_gate。
 */
export function translateRawModelOutput(
  raw: string,
  ctx: TranslationContext,
): TranslatedProposal | null {
  return translateModelAction(parseProposal(raw), ctx);
}

/** 翻译上下文 → 契约上下文（后者是超集，只做字段搬运）。 */
function toContractContext(ctx: TranslationContext): ContractTranslationContext {
  return {
    npcId: ctx.npcId,
    playerInventory: ctx.playerInventory,
    ...(ctx.npcInventory === undefined ? {} : { npcInventory: ctx.npcInventory }),
    ...(ctx.gateId === undefined ? {} : { gateId: ctx.gateId }),
    ...(ctx.repairMaterials === undefined ? {} : { repairMaterials: ctx.repairMaterials }),
  };
}

/**
 * 从模型正文翻译结构化契约（首选路径）。
 *
 * 与 translateRawModelOutput 的差别：意图由模型显式声明，本层不做任何语义
 * 推断。因此「我不能修门」只会被解析成 refuse / observe，永远不可能是
 * repair_gate——这是 AI-01/AI-02 的硬验收点。
 */
export function translateRawContractOutput(
  raw: string,
  ctx: TranslationContext,
): TranslatedProposal | null {
  const contract = parseContract(raw);
  return contract ? contractToProposal(contract, toContractContext(ctx)) : null;
}

/** 在物品栏里按种类合计判断持有；堆叠可能被拆成多格。 */
export function inventoryHas(
  inventory: readonly { itemId: ItemId; quantity: number }[],
  itemId: ItemId,
  quantity = 1,
): boolean {
  return inventory.reduce((total, stack) => total + (stack.itemId === itemId ? stack.quantity : 0), 0) >= quantity;
}

// ── 快照 → NpcObservation（记忆 / 人格 / 可用行动） ───────────────────────
//
// 旧实现用六个写死的常量把六个人粘成同一个人：archetype 全是 ally、traits
// 都是 0.6/0.7、memory 恒为空、可用行动只有 dialogue。这不只是「模型看不到
// 记忆」的问题——它让阿珍的高利他、小周的高务实、老陈的高谨慎全部失效，
// prompt 里的人格描述与实际行为脱节，Judge Mode 也无法解释任何一次决策。
//
// 现在的取数顺序（与 npcPersonalities.ts 顶部注释一致）：个体档 → 原型兜底。

function profileFor(npcId: string): NpcProfile | null {
  // NPC_PROFILES 的键是 NpcId 联合类型，运行时可能收到 'wanderer' 或外部 id。
  // 只做一次收窄，避免把整个模块的类型都放宽成 string。
  return Object.hasOwn(NPC_PROFILES, npcId) ? NPC_PROFILES[npcId as keyof typeof NPC_PROFILES] : null;
}

/**
 * 结构化竞赛记忆 → NpcObservation 的记忆条目。
 *
 * 两个体系字段不同（id/kind/weight vs memoryId/status/from），这里做显式映射
 * 而不是丢弃：promise/favor/debt 的情感权重必须保留，否则「他答应过我」
 * 在下一轮决策里就消失了。
 */
export function toObservationMemory(entry: CompetitionNpcStateSnapshot['memory'][number]): MemoryEntry {
  const base = { id: entry.memoryId, day: entry.day, minute: 0 };
  switch (entry.kind) {
    case 'fact':
      return { ...base, kind: 'fact', actor: 'world', summary: `${entry.subject}=${entry.value}`, weight: 0 };
    case 'promise':
      return {
        ...base,
        kind: 'promise',
        actor: 'player',
        summary: `${entry.promise}（${entry.status}）`,
        // 守约是加分项，毁约是负分；未决的中性，避免未发生的事先影响判断。
        weight: entry.status === 'kept' ? 0.5 : entry.status === 'broken' ? -0.6 : 0,
      };
    case 'favor':
      return {
        ...base,
        kind: 'favor',
        actor: entry.from === 'player' ? 'player' : entry.from.npcId,
        summary: entry.description,
        weight: entry.status === 'resolved' ? 0.4 : 0.6,
      };
    case 'debt':
      return {
        ...base,
        kind: 'debt',
        actor: entry.from === 'player' ? 'player' : entry.from.npcId,
        summary: entry.description,
        weight: entry.status === 'resolved' ? -0.2 : -0.6,
      };
  }
}

export interface NpcObservationOptions {
  /**
   * 本阶段真正接通的行动白名单。缺省按人格原型推导（ARCHETYPE_ACTIONS），
   * 而不是写死 ['dialogue']——写死会让模型永远看不见 gift/trade，人格形同虚设。
   */
  readonly availableActions?: readonly NpcActionKind[];
  /** 调用方已按预算检索好的记忆；给了就优先用它。 */
  readonly memory?: readonly MemoryEntry[];
}

/** 把竞赛快照压成 NpcBrain 能吃的 NpcObservation，供复用现有 brain 实现。 */
export function toNpcObservation(
  observation: CompetitionObservationSnapshot,
  options: NpcObservationOptions = {},
): NpcObservation {
  const world = observation.world;
  const npc = focusNpc(observation);
  const npcId = npc?.npcId ?? 'alin';

  const profile = profileFor(npcId);
  const archetype = profile?.archetype ?? ARCHETYPES.neutral.archetype;
  // 取不到个体档时退回原型兜底：宁可给一个通用中性人格，也不要复制阿林。
  const traits = { ...(profile?.traits ?? ARCHETYPES.neutral.traits) };
  const goal = profile?.goal ?? ARCHETYPES.neutral.goal;

  const memory = options.memory
    ? options.memory.slice()
    : (npc?.memory ?? []).map(toObservationMemory);

  const availableActions = options.availableActions
    ? options.availableActions.slice()
    : (ARCHETYPE_ACTIONS[archetype] as NpcActionKind[]).slice();

  return {
    npcId,
    archetype,
    traits,
    memory,
    relationship: npc ? { player: npc.trust } : {},
    goal,
    mood: npc ? Math.max(-1, Math.min(1, (npc.trust - 50) / 50)) : 0,
    world: {
      day: world.day,
      floor: world.currentFloor,
      gameMinute: world.gameMinute,
      // 与 NpcRuntime.buildObservation 用同一判定，避免两处夜间定义漂移。
      night: isNight(world.gameMinute),
    },
    self: { floor: npc?.position.floor ?? world.currentFloor, x: npc?.position.x ?? 0, hp: npc?.hp ?? 0 },
    availableActions,
    recentEvents: observation.recentFacts.slice(),
  };
}

/** 从快照组出翻译上下文，调用方不必自己复制库存。 */
export function translationContextFrom(
  observation: CompetitionObservationSnapshot,
  extras: { gateId?: string; repairMaterials?: readonly { itemId: ItemId; quantity: number }[] } = {},
): TranslationContext {
  const npc = focusNpc(observation);
  return {
    npcId: npc?.npcId ?? 'alin',
    playerInventory: observation.world.player.inventory,
    ...(npc ? { npcInventory: npc.inventory } : {}),
    ...((extras.gateId ?? observation.world.gates[0]?.gateId) === undefined
      ? {}
      : { gateId: extras.gateId ?? observation.world.gates[0]?.gateId }),
    ...(extras.repairMaterials === undefined ? {} : { repairMaterials: extras.repairMaterials }),
  };
}

/**
 * 旧路径（NpcActionProposal）能真正兑现的行动集。
 *
 * 为什么不直接把 ARCHETYPE_ACTIONS 丢给模型：那份清单描述的是「这人格想做什么」，
 * 而翻译层还受两个事实约束——竞赛层没有 attack/flee 的执行器（译不出就只能是
 * null，白白浪费一次决策），以及 gift/trade 需要 NPC 真的有货。把不能兑现的
 * 选项摆给模型，等于诱导它越权后被 validator 拒绝。
 *
 * 注意 NpcActionKind 与 CompetitionActionKind 不是同一套名字：gift↔give、
 * dialogue/refuse↔observe，所以不能直接做集合求交，要按语义逐项判定。
 */
function honorableLegacyActions(
  observation: CompetitionObservationSnapshot,
  ctx: TranslationContext,
): NpcActionKind[] {
  const npc = focusNpc(observation);
  const profile = npc ? profileFor(npc.npcId) : null;
  const archetype = profile?.archetype ?? ARCHETYPES.neutral.archetype;
  const offered = observation.availableActions;
  const npcHasItems = (ctx.npcInventory?.length ?? 0) > 0;
  return (ARCHETYPE_ACTIONS[archetype] as NpcActionKind[]).filter((kind) => {
    if (kind === 'attack' || kind === 'flee') return false;
    if (kind === 'gift') return npcHasItems && offered.includes('give');
    if (kind === 'trade') return npcHasItems && offered.includes('trade');
    // dialogue / refuse 都落在 observe 上，只要观察允许 observe 就成立。
    return offered.includes('observe');
  });
}

/**
 * 用真实 NpcBrain 生成一次竞赛提案（旧的 action.type 路径）。
 *
 * 失败路径全部返回 null：模型不可达、正文为空、翻译不了——都交给
 * competitionRuntime 的 fallback 端口走规则人格脑，不伪造动作。
 *
 * 注意：NpcBrain.decide 只返回 NpcActionProposal，不返回原始正文，所以这条路
 * 天然用不了结构化契约。需要契约时用 proposeWithContract。
 */
export async function proposeWithBrain(
  brain: NpcBrain,
  observation: CompetitionObservationSnapshot,
  extras: { gateId?: string; repairMaterials?: readonly { itemId: ItemId; quantity: number }[]; availableActions?: readonly NpcActionKind[] } = {},
): Promise<TranslatedProposal | null> {
  const ctx = translationContextFrom(observation, extras);
  // 调用方给了就照办（场景最清楚这一阶段接通了什么），否则按「能兑现」推导。
  const availableActions = extras.availableActions ?? honorableLegacyActions(observation, ctx);
  try {
    const raw = await brain.decide(toNpcObservation(observation, { availableActions }));
    return translateModelAction(raw, ctx);
  } catch {
    // 模型侧任何异常都在这里收口：调用方只看到 null，进而走规则降级。
    return null;
  }
}

/**
 * 用「能吐原始正文」的模型调用生成竞赛提案（结构化契约路径）。
 *
 * 为什么单开一个函数而不是改 NpcBrain：NpcBrain 的返回值已经被旧契约占住，
 * 改它会同时影响场景、规则执行器和既有测试。调用方传一个
 * `(observation) => Promise<string>`（例如把 OllamaBrain.decideTask 的 text
 * 转出来）即可拿到结构化契约能力，接线成本只有一行。
 *
 * 注意：不要在这里替调用方编造任务参数（gateId/材料/信任门槛都在调用方手里），
 * 参数错了会得到一份格式合法但语义错误的提案。
 */
export async function proposeWithContract(
  produceRaw: (observation: NpcObservation) => Promise<string | null>,
  observation: CompetitionObservationSnapshot,
  extras: { gateId?: string; repairMaterials?: readonly { itemId: ItemId; quantity: number }[]; availableActions?: readonly NpcActionKind[] } = {},
): Promise<TranslatedProposal | null> {
  const ctx = translationContextFrom(observation, extras);
  try {
    const raw = await produceRaw(
      toNpcObservation(observation, extras.availableActions ? { availableActions: extras.availableActions } : {}),
    );
    if (typeof raw !== 'string' || raw.trim().length === 0) return null;
    return translateRawContractOutput(raw, ctx);
  } catch {
    return null;
  }
}