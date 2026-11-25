import type { GameState, InventoryStack, ItemId } from '../core/gameTypes';

/** 竞赛 A2 可建议的动作白名单；它描述契约，不表示这些动作已接入游戏。 */
export const COMPETITION_ACTION_KINDS = [
  'observe',
  'ask',
  'give',
  'trade',
  'inspect',
  'pickup',
  'move',
  'return',
  'retreat',
  'sleep',
  'repair_gate',
] as const;

/** 竞赛 A2 所有动作的封闭标签联合类型。 */
export type CompetitionActionKind = (typeof COMPETITION_ACTION_KINDS)[number];

/** 观测中可识别的参与方；NPC 一律携带稳定 ID，避免赠与方向含混。 */
export type CompetitionActor = 'player' | { readonly kind: 'npc'; readonly npcId: string };

/** 位置快照，不含 Phaser 对象或可写游戏状态句柄。 */
export interface CompetitionPositionSnapshot {
  readonly floor: number;
  readonly x: number;
}

/** 玩家状态的只读观察快照。 */
export interface CompetitionPlayerSnapshot {
  readonly position: CompetitionPositionSnapshot;
  readonly hp: number;
  readonly hunger: number;
  readonly thirst: number;
  readonly energy: number;
  readonly inventory: readonly InventoryStack[];
}

/** NPC 的结构化跨日记忆条目；不是 Observation.recentFacts 的字符串摘要。 */
export type CompetitionNpcMemoryEntry =
  | {
      readonly kind: 'fact';
      readonly memoryId: string;
      readonly day: number;
      readonly subject: string;
      readonly value: string;
    }
  | {
      readonly kind: 'promise';
      readonly memoryId: string;
      readonly day: number;
      readonly promise: string;
      readonly status: 'open' | 'kept' | 'broken';
    }
  | {
      readonly kind: 'favor' | 'debt';
      readonly memoryId: string;
      readonly day: number;
      readonly from: CompetitionActor;
      readonly description: string;
      readonly status: 'open' | 'resolved';
    };

/** 当前 NPC 目标的结构化只读表示。 */
export interface CompetitionGoalSnapshot {
  readonly goalId: string;
  readonly kind: 'survive' | 'reach_floor' | 'collect' | 'return' | 'custom';
  readonly sinceDay: number;
  readonly status: 'active' | 'complete' | 'abandoned';
  readonly target?: string;
}

/** 上次动作的结构化记录，而不是自由文本。 */
export interface CompetitionLastActionSnapshot {
  readonly kind: CompetitionActionKind;
  readonly day: number;
  readonly gameMinute: number;
  readonly result: 'completed' | 'blocked' | 'interrupted';
}

/** NPC 状态的只读观察快照；trust 表示该 NPC 对玩家的关系值。 */
export interface CompetitionNpcStateSnapshot {
  readonly npcId: string;
  readonly position: CompetitionPositionSnapshot;
  readonly hp: number;
  readonly hunger: number;
  readonly trust: number;
  readonly affinity: number;
  readonly tension: number;
  readonly status: 'available' | 'busy' | 'hostile' | 'absent';
  readonly goal: CompetitionGoalSnapshot | null;
  readonly memory: readonly CompetitionNpcMemoryEntry[];
  readonly lastAction: CompetitionLastActionSnapshot | null;
  readonly inventory: readonly InventoryStack[];
}

/** 可见地面物品快照，key 是世界实例 ID 而非物品种类 ID。 */
export interface CompetitionGroundItemSnapshot {
  readonly key: string;
  readonly itemId: ItemId;
  readonly quantity: number;
  readonly position: CompetitionPositionSnapshot;
}

/** 可见威胁的结构化快照；不暴露游戏对象或可写句柄。 */
export interface CompetitionThreatSnapshot {
  readonly threatId: string;
  readonly kind: 'enemy' | 'hazard' | 'environment';
  readonly position: CompetitionPositionSnapshot;
  readonly severity: 'low' | 'moderate' | 'high' | 'critical';
  readonly status: 'active' | 'contained' | 'resolved';
}

/** 世界状态只读快照；不是 GameState，也不得直接用于修改或存档。 */
export interface CompetitionWorldStateSnapshot {
  /** 采自 GameState.runSeed；只是快照别名，不新增存档字段。 */
  readonly seed: GameState['runSeed'];
  readonly day: number;
  readonly gameMinute: number;
  readonly currentFloor: number;
  /** 采自可选的 GameState.flags；缺省存档在快照边界归一化为空对象。 */
  readonly flags: Readonly<NonNullable<GameState['flags']>>;
  readonly threats: readonly CompetitionThreatSnapshot[];
  readonly player: CompetitionPlayerSnapshot;
  readonly npcs: readonly CompetitionNpcStateSnapshot[];
  readonly groundItems: readonly CompetitionGroundItemSnapshot[];
  readonly gates: readonly {
    readonly gateId: string;
    readonly floor: number;
    readonly status: 'open' | 'closed' | 'blocked' | 'broken';
  }[];
}

/** 可供模型/规则决策读取的完整观察快照。 */
export interface CompetitionObservationSnapshot {
  readonly observationId: string;
  readonly world: CompetitionWorldStateSnapshot;
  readonly focus: CompetitionActor | null;
  readonly availableActions: readonly CompetitionActionKind[];
  readonly recentFacts: readonly string[];
}

/** 明确记录玩家向 NPC 转交物品，from/to 不能调换。 */
export interface CompetitionPlayerGivesItem {
  readonly from: 'player';
  readonly to: { readonly kind: 'npc'; readonly npcId: string };
  readonly itemId: ItemId;
  readonly quantity: number;
}

/** 明确记录 NPC 向玩家转交物品，from/to 不能调换。 */
export interface CompetitionNpcGivesItem {
  readonly from: { readonly kind: 'npc'; readonly npcId: string };
  readonly to: 'player';
  readonly itemId: ItemId;
  readonly quantity: number;
}

/** 双向赠与动作的精确方向联合类型。 */
export type CompetitionGiftTransfer = CompetitionPlayerGivesItem | CompetitionNpcGivesItem;

/** 竞赛 A2 可用的只读动作提议；均为建议，不会直接执行。 */
export type CompetitionActionProposal =
  | { readonly kind: 'observe'; readonly target?: CompetitionActor }
  | { readonly kind: 'ask'; readonly npcId: string; readonly question: string }
  | { readonly kind: 'give'; readonly transfer: CompetitionGiftTransfer }
  | {
      readonly kind: 'trade';
      readonly npcId: string;
      readonly playerGives: CompetitionPlayerGivesItem;
      readonly playerReceives: CompetitionNpcGivesItem;
    }
  | {
      readonly kind: 'inspect';
      readonly target: { readonly kind: 'npc' | 'ground_item' | 'gate'; readonly id: string };
    }
  | { readonly kind: 'pickup'; readonly groundItemKey: string; readonly itemId: ItemId; readonly quantity: number }
  | { readonly kind: 'move'; readonly destination: CompetitionPositionSnapshot }
  | { readonly kind: 'return'; readonly destination: CompetitionPositionSnapshot }
  | { readonly kind: 'retreat'; readonly destination: CompetitionPositionSnapshot }
  | { readonly kind: 'sleep'; readonly durationMinutes: number }
  | { readonly kind: 'repair_gate'; readonly gateId: string; readonly materials: readonly InventoryStack[] };

/** 固定结果码，不携带执行器原始异常、任意模型文本或内部路径。 */
export type CompetitionValidationReason =
  | 'ok'
  | 'missing_item'
  | 'low_trust'
  | 'too_far'
  | 'too_late'
  | 'too_dangerous'
  | 'invalid_target'
  | 'insufficient_hp';

/** 被观察到的语义状态差量；负数量代表扣除，正数量代表增加。 */
export interface CompetitionStateDelta {
  readonly inventory: readonly {
    readonly owner: CompetitionActor;
    readonly itemId: ItemId;
    readonly quantityDelta: number;
  }[];
  readonly trust: readonly { readonly npcId: string; readonly delta: number }[];
  readonly relationships: readonly {
    readonly npcId: string;
    readonly trustDelta?: number;
    readonly affinityDelta?: number;
    readonly tensionDelta?: number;
  }[];
  readonly memoryAdded: readonly {
    readonly npcId: string;
    readonly entry: CompetitionNpcMemoryEntry;
  }[];
  readonly flags: readonly {
    readonly flag: string;
    /** null 表示变化前/后该 flag 不存在。 */
    readonly from: number | null;
    readonly to: number | null;
  }[];
  readonly hp: readonly { readonly actor: CompetitionActor; readonly delta: number }[];
  readonly positions: readonly {
    readonly actor: CompetitionActor;
    readonly from: CompetitionPositionSnapshot;
    readonly to: CompetitionPositionSnapshot;
  }[];
  readonly gateStatus: readonly {
    readonly gateId: string;
    readonly from: 'open' | 'closed' | 'blocked' | 'broken';
    readonly to: 'open' | 'closed' | 'blocked' | 'broken';
  }[];
  readonly elapsedMinutes: number;
}

/** 校验结论及预期差量；expectedStateDelta 仅是预测，不代表动作已执行。 */
export type CompetitionValidationResult =
  | { readonly accepted: true; readonly reason: 'ok'; readonly expectedStateDelta: CompetitionStateDelta }
  | {
      readonly accepted: false;
      readonly reason: Exclude<CompetitionValidationReason, 'ok'>;
      readonly expectedStateDelta: CompetitionStateDelta;
      readonly detailCode?: string;
    };

declare const competitionModelLabelBrand: unique symbol;

/** 追踪决策来源；label 只允许非敏感的模型代号，不是服务地址。 */
export type CompetitionModelLabel = string & { readonly [competitionModelLabelBrand]: true };

/** 决策器内部类别，与运行执行模式及游戏难度分别记录。 */
export type CompetitionDecisionMode = 'model' | 'rules' | 'replay' | 'fallback';

/** 实际执行路径；spark-live 与离线安全降级不可混淆。 */
export type CompetitionExecutionMode = 'spark-live' | 'offline-fallback';

/** 游戏难度/运行选项；不改变或扩展现有存档 schema。 */
export type CompetitionRunMode = 'quick' | 'adventure' | 'easy';

/** 动作执行事实；未执行时实际差量必须为 null。 */
export type CompetitionTraceExecution =
  | { readonly status: 'not-executed'; readonly actualStateDelta: null }
  | { readonly status: 'executed'; readonly actualStateDelta: CompetitionStateDelta }
  | { readonly status: 'failed'; readonly actualStateDelta: CompetitionStateDelta | null };

/** 可重现的逻辑时间，不用 Date.now 或墙上时钟。 */
export interface CompetitionTraceTime {
  readonly sequence: number;
  readonly day: number;
  readonly gameMinute: number;
}

/** 校验和覆盖追踪链所需的 SHA-256 十六进制哈希。 */
export interface CompetitionTraceHashes {
  readonly observation: string;
  readonly proposal: string;
  readonly stateBefore: string;
  readonly stateAfter: string;
}

/** 规划重试过程的确定性摘要。 */
export interface CompetitionReplanRecord {
  readonly attempted: boolean;
  readonly attempt: number;
  readonly reason: 'none' | 'invalid_proposal' | 'rejected' | 'stale_observation' | 'model_error';
}

/** 安全降级记录；不含任意错误文本。 */
export interface CompetitionFallbackRecord {
  readonly used: boolean;
  readonly reason: 'none' | 'model_unavailable' | 'invalid_proposal' | 'rejected' | 'timeout';
}

/** 单次决策追踪记录；不含 URL、endpoint、token、原始异常或墙上时钟。 */
export interface CompetitionTraceRecord {
  readonly runId: string;
  readonly goal: CompetitionGoalSnapshot;
  readonly time: CompetitionTraceTime;
  readonly model: CompetitionModelLabel;
  readonly executionMode: CompetitionExecutionMode;
  readonly gameMode?: CompetitionRunMode;
  readonly decisionMode: CompetitionDecisionMode;
  readonly seed: number;
  readonly observation: CompetitionObservationSnapshot;
  readonly proposal: CompetitionActionProposal | null;
  readonly validation: CompetitionValidationResult;
  readonly execution: CompetitionTraceExecution;
  /** stateBefore/stateAfter 是动作执行边界哈希；未执行时应相同。 */
  readonly hashes: CompetitionTraceHashes;
  readonly replan: CompetitionReplanRecord;
  readonly fallback: CompetitionFallbackRecord;
}

/** 可公开给调用方的有限错误类别；原始异常消息必须留在此边界之外。 */
export type CompetitionErrorCode = 'timeout' | 'unavailable' | 'invalid_response' | 'internal';

/** 可安全传递/记录的错误形状，不泄漏服务端异常文本或凭据。 */
export interface CompetitionSafeError {
  readonly code: CompetitionErrorCode;
  readonly message: string;
}

const SAFE_ERROR_MESSAGES: Readonly<Record<CompetitionErrorCode, string>> = {
  timeout: '决策请求超时',
  unavailable: '决策服务不可用',
  invalid_response: '决策响应无效',
  internal: '决策失败',
};

/** 运行时识别白名单动作标签，适用于 JSON/模型输出等不可信输入。 */
export function isCompetitionActionKind(value: unknown): value is CompetitionActionKind {
  return typeof value === 'string' && (COMPETITION_ACTION_KINDS as readonly string[]).includes(value);
}

/** 将有限模型代号标记为可进入 trace 的标签；拒绝 URL、凭据样式和任意对象。 */
export function toSafeCompetitionModelLabel(value: unknown): CompetitionModelLabel | null {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value) ||
    /^(?:(?:\d{1,3}\.){3}\d{1,3}|(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})$/.test(value) ||
    /^(?:bearer|token|secret|api[-_.]?key|password|sk)[-_.]/i.test(value) ||
    /^[A-Fa-f0-9]{32,}$/.test(value)
  ) return null;
  return value as CompetitionModelLabel;
}

/** 将不可信错误值压缩为固定安全文案，绝不复制 message、stack 或序列化内容。 */
export function toCompetitionSafeError(code: unknown): CompetitionSafeError {
  const safeCode: CompetitionErrorCode =
    typeof code === 'string' && Object.hasOwn(SAFE_ERROR_MESSAGES, code)
      ? (code as CompetitionErrorCode)
      : 'internal';
  return { code: safeCode, message: SAFE_ERROR_MESSAGES[safeCode] };
}
