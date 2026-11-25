// AI NPC 配置（RFC §4 护栏 4：地址与模型名走配置，不入库）。
//
// 无模型配置时使用离线规则人格脑；显式配置 VITE_NPC_MODEL 后才请求
// 项目自有的本地 Ollama。VITE_NPC_ENABLED=false 或 ?ainpc=0 可关闭两者。

import { ARCHETYPES } from '../data/npcPersonalities';
import type { NpcFact } from './rulesExecutor';
import type { NpcArchetype } from './types';
import type { InventoryStack, ItemId } from '../core/gameTypes';
import type { NpcDef } from '../data/npcs';

export interface AiNpcConfig {
  enabled: boolean;
  mode: 'off' | 'offline' | 'ollama';
  baseUrl: string;
  model: string;
  timeoutMs: number;
  /** 进 prompt 的记忆条数 */
  recallK: number;
  /** 单次输出 token 上限；undefined 表示不限。 */
  maxOutputTokens: number | undefined;
  /** 是否让模型跳过思维链；带 thinking 的模型必须为 true。 */
  disableThinking: boolean;
}

function envValue(key: string): string | undefined {
  // Node / vitest：process.env（vi.stubEnv 也只改这里）。
  if (typeof process !== 'undefined' && typeof process.env?.[key] === 'string') {
    return process.env[key];
  }
  // 浏览器构建：Vite 把 import.meta.env 序列化进包，动态取值同样有效。
  // 不依赖 vite/client 类型，纯 Node 下 import.meta.env 不存在时走 undefined。
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.[key];
}

function queryValue(key: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(key);
}

export function aiNpcConfig(): AiNpcConfig {
  const model = (envValue('VITE_NPC_MODEL') ?? '').trim();
  const baseUrl = envValue('VITE_OLLAMA_URL') ?? 'http://127.0.0.1:11434';
  const timeoutRaw = Number(envValue('VITE_NPC_TIMEOUT_MS') ?? '');
  const budgetRaw = Number(envValue('VITE_NPC_MAX_TOKENS') ?? '');
  const thinkRaw = (envValue('VITE_NPC_THINK') ?? '').trim().toLowerCase();
  const forced = queryValue('ainpc') === '1';
  const disabled = queryValue('ainpc') === '0';
  const enabled = !disabled && (forced || envValue('VITE_NPC_ENABLED') !== 'false');
  return {
    enabled,
    mode: !enabled ? 'off' : model.length > 0 ? 'ollama' : 'offline',
    baseUrl,
    model,
    // 45s：Spark 实测 npc-qwen(17G) 冷启 ~33s。热推理在关掉思维链后只要
    // 2.5-3.5s（实测 5 次 2.45/2.57/2.85/2.70/2.94s）；保留长超时是为了
    // 冷启动那次加载，不是给思维链留时间。
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 45_000,
    recallK: 6,
    // 关闭思维链时 96-192 足够吐一条提案；截断会自动放宽重试一次。
    maxOutputTokens: Number.isFinite(budgetRaw) && budgetRaw > 0 ? Math.floor(budgetRaw) : 192,
    // 默认关闭思维链：npc-qwen 走 /v1 时 reasoning 会吃掉全部预算并让
    // content 变空串（HTTP 200）。VITE_NPC_THINK=on 可显式打开。
    disableThinking: thinkRaw !== 'on' && thinkRaw !== 'true',
  };
}

// ── NPC 事实构建 ────────────────────────────────────────────────────────────

/** 居民 id → 人格原型。wanderer 是夜间事件，暂无 NpcDef，预留 hostile。 */
export function archetypeForNpcId(npcId: string): NpcArchetype {
  for (const def of Object.values(ARCHETYPES)) {
    if (def.npcId === npcId) return def.archetype;
  }
  return 'neutral';
}

/**
 * 由静态报价表推导 NPC 持有物（第一阶段：每个报价的 give 物品各一份）。
 * 这让「NPC 没有的货」在规则执行器里可判——AI 不能虚空造物。
 */
export function npcInventoryFromDef(npc: NpcDef): InventoryStack[] {
  const totals = new Map<ItemId, number>();
  for (const offer of npc.offers) {
    totals.set(offer.give.itemId, (totals.get(offer.give.itemId) ?? 0) + offer.give.quantity);
  }
  return [...totals.entries()].map(([itemId, quantity]) => ({ itemId, quantity }));
}

/** data/npcs.ts 的居民 → 执行器眼中的 NpcFact。 */
export function npcFactFromDef(npc: NpcDef, hp = 30): NpcFact {
  return {
    id: npc.id,
    archetype: archetypeForNpcId(npc.id),
    floor: 2, // NPC_FLOOR；此处不 import 常量，避免配置模块牵连场景层
    x: npc.x,
    hp,
    inventory: npcInventoryFromDef(npc),
  };
}
