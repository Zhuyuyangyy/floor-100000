// DGX Spark 推理适配器：只接收调用方注入的推理端口，不配置或猜测服务地址。
// 模型输出是不可信输入；只有严格符合契约的 JSON 才能标记为 spark-live。
// 失败时使用确定性的本地规则人格脑，并明确标记 offline-fallback。

import { isItemId } from '../../data/items';
import { buildSystemPrompt, buildUserPrompt } from '../prompt';
import type { NpcAction, NpcActionProposal, NpcBrain, NpcObservation } from '../types';
import { LocalPersonaBrain } from './localPersonaBrain';

export interface SparkInferenceRequest {
  systemPrompt: string;
  userPrompt: string;
}

/** 网络地址、认证信息和具体传输方式均由应用宿主在此端口之外管理。 */
export interface SparkInferencePort {
  infer(request: SparkInferenceRequest, options: { signal: AbortSignal }): Promise<unknown>;
  /** 可选的宿主侧健康探测；适配器本身不假定任何 Spark endpoint。 */
  health?(): Promise<boolean>;
}

export interface SparkBrainOptions {
  port: SparkInferencePort;
  timeoutMs?: number;
  /** 离线决策器；默认是纯本地、确定性的 LocalPersonaBrain。 */
  fallbackBrain?: NpcBrain;
}

export type SparkDecisionSource = 'spark-live' | 'offline-fallback';

export interface SparkDecision {
  source: SparkDecisionSource;
  proposal: NpcActionProposal | null;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_LENGTH = 8_192;
const MAX_DIALOGUE_LENGTH = 60;
const MAX_QUANTITY = 999;
const ACTION_TYPES = ['dialogue', 'trade', 'gift', 'refuse', 'attack', 'flee'] as const;
type ActionType = (typeof ACTION_TYPES)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function safeText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value);
}

function isQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_QUANTITY;
}

function parseAction(raw: unknown, availableActions: readonly string[]): NpcAction | null {
  if (!isRecord(raw) || typeof raw.type !== 'string' || !ACTION_TYPES.includes(raw.type as ActionType)) return null;
  const type = raw.type as ActionType;
  if (!availableActions.includes(type)) return null;

  switch (type) {
    case 'dialogue': {
      const text = raw.text;
      if (!hasOnlyKeys(raw, ['type', 'text']) || !safeText(text, MAX_DIALOGUE_LENGTH)) return null;
      return { type, text };
    }
    case 'trade': {
      if (!hasOnlyKeys(raw, ['type', 'give', 'get']) || !isRecord(raw.give) || !isRecord(raw.get)) return null;
      if (!hasOnlyKeys(raw.give, ['itemId', 'quantity']) || !hasOnlyKeys(raw.get, ['itemId', 'quantity'])) return null;
      const { itemId: giveId, quantity: giveQuantity } = raw.give;
      const { itemId: getId, quantity: getQuantity } = raw.get;
      if (typeof giveId !== 'string' || !isItemId(giveId) || !isQuantity(giveQuantity)) return null;
      if (typeof getId !== 'string' || !isItemId(getId) || !isQuantity(getQuantity)) return null;
      return {
        type,
        give: { itemId: giveId, quantity: giveQuantity },
        get: { itemId: getId, quantity: getQuantity },
      };
    }
    case 'gift': {
      const itemId = raw.itemId;
      const quantity = raw.quantity;
      if (!hasOnlyKeys(raw, ['type', 'itemId', 'quantity']) || typeof itemId !== 'string' || !isItemId(itemId) || !isQuantity(quantity)) return null;
      return { type, itemId, quantity };
    }
    case 'refuse':
    case 'attack':
    case 'flee':
      return hasOnlyKeys(raw, ['type']) ? { type } : null;
    default:
      return null;
  }
}

/** 严格 JSON → 类型化行动提案。任何歧义、额外字段或脏文本都拒绝。 */
export function parseSparkProposal(raw: unknown, availableActions: readonly string[]): NpcActionProposal | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_RESPONSE_LENGTH) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || !hasOnlyKeys(data, ['action', 'confidence', 'utterance'])) return null;
  const confidence = data.confidence;
  const utterance = data.utterance;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  if (utterance !== undefined && !safeText(utterance, MAX_DIALOGUE_LENGTH)) return null;
  const action = parseAction(data.action, availableActions);
  if (!action) return null;
  return {
    ...(utterance === undefined ? {} : { utterance }),
    confidence,
    action,
  };
}

export class SparkBrain implements NpcBrain {
  readonly id = 'spark';
  private readonly port: SparkInferencePort;
  private readonly timeoutMs: number;
  private readonly fallbackBrain: NpcBrain;

  constructor(options: SparkBrainOptions) {
    this.port = options.port;
    this.timeoutMs = options.timeoutMs !== undefined && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_TIMEOUT_MS;
    this.fallbackBrain = options.fallbackBrain ?? new LocalPersonaBrain();
  }

  async health(): Promise<boolean> {
    if (!this.port.health) return true;
    try {
      return await this.port.health();
    } catch {
      return false;
    }
  }

  /** NpcBrain 兼容入口；细粒度来源请使用 decideWithSource。 */
  async decide(observation: NpcObservation): Promise<NpcActionProposal | null> {
    return (await this.decideWithSource(observation)).proposal;
  }

  /** 仅有效的注入端口回复标为模型结果，fallback 永远明确标作离线规则来源。 */
  async decideWithSource(observation: NpcObservation): Promise<SparkDecision> {
    try {
      const response = await this.invokeWithTimeout({
        systemPrompt: buildSystemPrompt(observation),
        userPrompt: buildUserPrompt(observation),
      });
      const proposal = parseSparkProposal(response, observation.availableActions);
      if (proposal) return { source: 'spark-live', proposal };
    } catch {
      // 网络、超时及宿主错误均安全降级，不把错误传入游戏循环。
    }
    try {
      return { source: 'offline-fallback', proposal: await this.fallbackBrain.decide(observation) };
    } catch {
      return { source: 'offline-fallback', proposal: null };
    }
  }

  private async invokeWithTimeout(request: SparkInferenceRequest): Promise<unknown> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Spark inference timed out'));
      }, this.timeoutMs);
    });
    try {
      // Promise.race 保障不遵守 AbortSignal 的端口也不能拖住调用方。
      return await Promise.race([this.port.infer(request, { signal: controller.signal }), timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
