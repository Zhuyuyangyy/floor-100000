// AI NPC 配置（RFC §4 护栏 4：地址与模型名走配置，不入库）。
//
// 优先级：Vite 环境变量（VITE_OLLAMA_URL / VITE_NPC_MODEL / VITE_NPC_TIMEOUT_MS）
// 提供默认值；查询参数 ?ainpc=1 可强制开启（模型名仍需配置）。
//
// 安全默认：模型名为空 → enabled=false。也就是说没有任何配置时，
// 游戏行为与改造前逐字节一致——AI 是显式 opt-in 的增量。

import { ARCHETYPES } from '../data/npcPersonalities';
import type { NpcFact } from './rulesExecutor';
import { syncNpcInventory } from './npcInventory';
import type { NpcArchetype } from './types';
import type { GameState, InventoryStack, ItemId } from '../core/gameTypes';
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
  // Two channels, and whichever runtime we are in decides the only one that
  // counts — never both. In Node (vitest included) `process.env` is the truth:
  // falling through to import.meta.env made the 「no config → AI off」 test
  // unfalsifiable, because deleting the key from process.env left Vitest's copy
  // of .env.local sitting in import.meta.env and the model stayed configured.
  if (typeof process !== 'undefined' && process.env) {
    return typeof process.env[key] === 'string' ? process.env[key] : undefined;
  }
  // Browser build: Vite serialises import.meta.env into the bundle.
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
    // 45s：Spark 实测 npc-qwen(17G) 冷启 ~33s、热推理 21-32s（RFC §8）。
    // 异步设计下超时不阻塞交互——降级句先显示，模型到了再替换；
    // 对话已关则丢弃结果。3s 只适用于 8B 以下小模型。
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 45_000,
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
 * 阶段 C 起真实库存见 npcInventory.ts（有数量、会耗尽、会补充）；
 * 本函数保留为「无存档时的默认持有物」推导。
 */
export function npcInventoryFromDef(npc: NpcDef): InventoryStack[] {
  const totals = new Map<ItemId, number>();
  for (const offer of npc.offers) {
    totals.set(offer.give.itemId, (totals.get(offer.give.itemId) ?? 0) + offer.give.quantity);
  }
  return [...totals.entries()].map(([itemId, quantity]) => ({ itemId, quantity }));
}

/** data/npcs.ts 的居民 → 执行器眼中的 NpcFact。可传入真实库存（阶段 C）。 */
export function npcFactFromDef(npc: NpcDef, hp = 30, inventory?: InventoryStack[]): NpcFact {
  return {
    id: npc.id,
    name: npc.name,
    title: npc.title,
    archetype: archetypeForNpcId(npc.id),
    floor: 2, // NPC_FLOOR；此处不 import 常量，避免配置模块牵连场景层
    x: npc.x,
    hp,
    inventory: inventory ?? npcInventoryFromDef(npc),
  };
}

/**
 * 带真实库存的事实（阶段 C）：从 npcStates 读已结算的库存转成执行器
 * 形状。老存档/首次遇到时退回静态报价表推导。场景在请求推理前调用它，
 * 模型看到的才是「NPC 现在真的有什么」。
 */
export function npcFactFor(state: GameState, npc: NpcDef, hp = 30): NpcFact {
  const { inventory } = syncNpcInventory(state, npc);
  return npcFactFromDef(npc, hp, inventory.entries.map((e) => ({ itemId: e.itemId, quantity: e.quantity })));
}
