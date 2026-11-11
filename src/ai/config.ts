// AI NPC 配置（RFC §4 护栏 4：地址与模型名走配置，不入库）。
//
// 优先级：Vite 环境变量（VITE_OLLAMA_URL / VITE_NPC_MODEL / VITE_NPC_TIMEOUT_MS）
// 提供默认值；查询参数 ?ainpc=1 可强制开启（模型名仍需配置）。
//
// 安全默认：模型名为空 → enabled=false。也就是说没有任何配置时，
// 游戏行为与改造前逐字节一致——AI 是显式 opt-in 的增量。

import { ARCHETYPES } from '../data/npcPersonalities';
import type { NpcFact } from './rulesExecutor';
import type { NpcArchetype } from './types';
import type { InventoryStack, ItemId } from '../core/gameTypes';
import type { NpcDef } from '../data/npcs';

export interface AiNpcConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  /** 进 prompt 的记忆条数 */
  recallK: number;
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
  const model = envValue('VITE_NPC_MODEL') ?? '';
  const baseUrl = envValue('VITE_OLLAMA_URL') ?? 'http://127.0.0.1:11434';
  const timeoutRaw = Number(envValue('VITE_NPC_TIMEOUT_MS') ?? '');
  const forced = queryValue('ainpc') === '1';
  return {
    // 显式 opt-in：配了模型，或带了 ?ainpc=1 且配了模型
    enabled: model.length > 0 && (forced || envValue('VITE_NPC_MODEL') !== undefined),
    baseUrl,
    model,
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 3000,
    recallK: 6,
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
