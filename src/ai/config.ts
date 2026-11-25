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
  mode: 'off' | 'offline' | 'ollama' | 'proxy';
  baseUrl: string;
  model: string;
  timeoutMs: number;
  /** 进 prompt 的记忆条数 */
  recallK: number;
  /** 单次输出 token 上限；undefined 表示不限。 */
  maxOutputTokens: number | undefined;
  /** 是否让模型跳过思维链；带 thinking 的模型必须为 true。 */
  disableThinking: boolean;
  /** 公开部署：走同域后端代理，Key 不在前端。 */
  proxyMode: boolean;
  /** 代理模式下的会话标识（仅用于服务端限流）。 */
  sessionId: string;
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

/**
 * 会话标识：只用于服务端限流，不含任何身份信息。
 *
 * 存 localStorage 而不是内存，是为了让「刷新页面」不重置限流桶——否则
 * 按 F5 就能绕过单会话限额，限流形同虚设。
 */
function sessionId(): string {
  const KEY = 'f100k-npc-session';
  try {
    if (typeof localStorage !== 'undefined') {
      const existing = localStorage.getItem(KEY);
      if (existing && existing.length > 0 && existing.length <= 64) return existing;
      const created = `s_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`.slice(0, 64);
      localStorage.setItem(KEY, created);
      return created;
    }
  } catch {
    // 隐私模式/存储被禁用：退回进程内随机值，仍能限流同一会话。
  }
  return `s_${Math.random().toString(36).slice(2, 10)}`;
}

export function aiNpcConfig(): AiNpcConfig {
  const model = (envValue('VITE_NPC_MODEL') ?? '').trim();
  const baseUrl = envValue('VITE_OLLAMA_URL') ?? 'http://127.0.0.1:11434';
  const timeoutRaw = Number(envValue('VITE_NPC_TIMEOUT_MS') ?? '');
  const budgetRaw = Number(envValue('VITE_NPC_MAX_TOKENS') ?? '');
  const thinkRaw = (envValue('VITE_NPC_THINK') ?? '').trim().toLowerCase();
  const forced = queryValue('ainpc') === '1';
  const disabled = queryValue('ainpc') === '0';
  // 代理模式：显式配置，或「生产构建」默认开启。
  //
  // 生产构建（vite build）就是拿去公开部署的那一份，而公开部署唯一的正确
  // 形态是同域代理——Key 在服务端。dev 构建默认直连本机 Ollama，方便开发时
  // 用 Spark 调试。这样既不会忘记配置，也不会让本地开发被迫绕代理。
  const proxyRaw = (envValue('VITE_NPC_PROXY') ?? '').trim().toLowerCase();
  const prodBuild = (import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD === true;
  const proxyMode = proxyRaw === 'on' || proxyRaw === 'true' || proxyRaw === '1'
    || (proxyRaw !== 'off' && proxyRaw !== 'false' && proxyRaw !== '0' && prodBuild);
  const enabled = !disabled && (forced || envValue('VITE_NPC_ENABLED') !== 'false');
  return {
    enabled,
    mode: !enabled ? 'off' : proxyMode ? 'proxy' : model.length > 0 ? 'ollama' : 'offline',
    // 代理模式同域请求，baseUrl 留空即用当前源。
    baseUrl: proxyMode ? '' : baseUrl,
    model,
    // 45s：Spark 实测 npc-qwen(17G) 冷启 ~33s。热推理在关掉思维链后只要
    // 2.5-3.5s（实测 5 次 2.45/2.57/2.85/2.70/2.94s）；保留长超时是为了
    // 冷启动那次加载，不是给思维链留时间。
    // 代理模式上限 20s：公网推理不该让玩家干等，超时就降级。
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : proxyMode ? 20_000 : 45_000,
    recallK: 6,
    // 关闭思维链时 96-192 足够吐一条提案；截断会自动放宽重试一次。
    maxOutputTokens: Number.isFinite(budgetRaw) && budgetRaw > 0 ? Math.floor(budgetRaw) : 192,
    // 默认关闭思维链：npc-qwen 走 /v1 时 reasoning 会吃掉全部预算并让
    // content 变空串（HTTP 200）。VITE_NPC_THINK=on 可显式打开。
    disableThinking: thinkRaw !== 'on' && thinkRaw !== 'true',
    proxyMode,
    sessionId: sessionId(),
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
