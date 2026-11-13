// AI NPC 接口契约（docs/plans/2026-11-11-ai-npc-spark-integration-rfc.md §5）。
//
// 分层铁律：AI（NpcBrain）只产出「行动建议」，规则执行器
// （rulesExecutor.ts）校验合法性，游戏才执行。本文件只定义数据结构，
// 不 import 任何 Phaser / 网络代码，保证可在 Node 测试环境直接运行。

import type { ItemId } from '../core/gameTypes';

/** 三个第一阶段原型。人格与行为倾向的顶层分类。 */
export type NpcArchetype = 'ally' | 'neutral' | 'hostile';

/** 人格向量，全部 0..1。由 npcPersonalities.ts 按原型给出初值。 */
export interface PersonalityTraits {
  /** 利他：倾向给予与公平交易 */
  altruism: number;
  /** 务实：按利益计算而非情感 */
  pragmatism: number;
  /** 攻击性：倾向敌对行动 */
  aggression: number;
  /** 记恩/记仇：关系变化的放大系数 */
  loyalty: number;
  /** 谨慎：劣势时倾向避战 */
  caution: number;
}

/** 一条记忆。weight 是情感权重，-1（仇）..1（恩）。 */
export interface MemoryEntry {
  id: string;
  day: number;
  minute: number;
  kind: string;
  /** 'player' 或另一个 NPC 的 id */
  actor: string;
  summary: string;
  weight: number;
}

/** 存进 GameState.npcStates[npcId]（JSON 字符串）的 NPC 持久状态。 */
export interface NpcPersistedState {
  archetype: NpcArchetype;
  traits: PersonalityTraits;
  /** 当前独立目标，纯文本，由人格与处境推导 */
  goal: string;
  /** actor -> -100..100 */
  relationship: Record<string, number>;
  /** 有界记忆，新条目从尾部追加，超出上限时淘汰权重最低的 */
  memory: MemoryEntry[];
  /** 当前情绪 -1..1 */
  mood: number;
}

/** 出站观察快照：游戏 → AI。只读，不含任何可直接改状态的句柄。 */
export interface NpcObservation {
  npcId: string;
  archetype: NpcArchetype;
  traits: PersonalityTraits;
  /** 检索后的相关记忆（有预算上限，不是全量） */
  memory: MemoryEntry[];
  relationship: Record<string, number>;
  goal: string;
  mood: number;
  world: { day: number; floor: number; gameMinute: number; night: boolean };
  self: { floor: number; x: number; hp: number };
  /** NPC 当前可执行的合法动作菜单（选项树降级路径的并集） */
  availableActions: NpcActionKind[];
  recentEvents: string[];
}

export type NpcActionKind =
  | 'dialogue'
  | 'trade'
  | 'gift'
  | 'refuse'
  | 'attack'
  | 'flee';

/** 入站行动建议：AI → 游戏。永远是 advisory。 */
export type NpcAction =
  | { type: 'dialogue'; text: string }
  | { type: 'trade'; give: { itemId: ItemId; quantity: number }; get: { itemId: ItemId; quantity: number } }
  | { type: 'gift'; itemId: ItemId; quantity: number }
  | { type: 'refuse' }
  | { type: 'attack' }
  | { type: 'flee' };

export interface NpcActionProposal {
  /** AI 生成的话（可选）。渲染前需过长度与字符约束。 */
  utterance?: string;
  action: NpcAction;
  /** 0..1。低置信度建议调用方优先走降级路径。 */
  confidence: number;
}

/**
 * NPC 大脑。 decide() 返回 null 表示「无意见」——调用方必须降级到选项树，
 * 而不是卡住交互。实现可以是本地 Ollama 客户端、mock 或回放脚本。
 */
export interface NpcBrain {
  readonly id: string;
  decide(observation: NpcObservation): Promise<NpcActionProposal | null>;
  /** 推理服务健康探测。不可用时 decide 不应被调用。 */
  health(): Promise<boolean>;
}
