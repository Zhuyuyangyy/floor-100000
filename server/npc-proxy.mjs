// 魔搭创空间后端：静态托管 + NPC 决策代理。
//
// 为什么需要这一层（这不是为了「显得有后端」）：
//   纯前端把魔搭 API Token 打进 dist，等于把 Key 公开给每个访客。所以 Key
//   只存在于本进程的环境变量里，浏览器永远拿不到，也永远不需要玩家自己填。
//
// 安全边界（每条都对应一个具体攻击面，不是装饰）：
//   1. 只接受 NPC 观察对象，且字段白名单校验——本服务不是通用模型网关。
//      URL、model、max_tokens、system prompt 全部由服务端固定，请求体里带了
//      这些字段一律忽略（不是报错，是不读），避免被当成免费 OpenAI 代理。
//   2. 单会话限流 + 每日全局预算 + 连续失败熔断，三层各自独立。
//   3. 上游任何异常都收敛成 503 + reason，前端据此降级到规则脑，
//      绝不让游戏循环因为推理挂了而卡住。
//
// 监听 0.0.0.0:7860 是魔搭 Docker 创空间的硬要求。

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
// 静态产物在仓库/镜像根目录的 dist/，而本文件在 server/ 下——必须往上一级。
// 写死 server/dist 会在容器里 404（实测踩到），所以显式 parent 再 join。
const DIST_ROOT = resolve(HERE, '..', 'dist');

// ── 配置（全部来自环境变量，缺省即降级，不抛错）─────────────────────────────
function envInt(key, fallback) {
  const raw = Number(process.env[key] ?? '');
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

const CONFIG = {
  port: envInt('PORT', 7860),
  host: process.env.HOST ?? '0.0.0.0',
  // 魔搭 API-Inference（OpenAI 兼容）。换成任何兼容端点也能工作。
  upstreamUrl: (process.env.NPC_UPSTREAM_URL ?? 'https://api-inference.modelscope.cn/v1').replace(/\/+$/, ''),
  // Key 只在这里出现。前端产物中不含此变量（vite 只暴露 VITE_ 前缀）。
  apiKey: process.env.NPC_API_KEY ?? '',
  // 模型名固定在这里，请求体无法覆盖。
  model: process.env.NPC_MODEL_ID ?? 'Qwen/Qwen3-8B',
  // 服务端硬上限：即使客户端要求更多也不给。防止被拿来跑长文本任务。
  maxTokens: envInt('NPC_MAX_TOKENS', 320),
  requestTimeoutMs: envInt('NPC_REQUEST_TIMEOUT_MS', 20_000),
  // 单会话窗口：同一 clientId 在 windowMs 内最多 maxCalls 次。
  sessionWindowMs: envInt('NPC_SESSION_WINDOW_MS', 60_000),
  sessionMaxCalls: envInt('NPC_SESSION_MAX_CALLS', 12),
  // 每日全局预算：防止被刷、也防止超出魔搭免费额度。
  dailyBudget: envInt('NPC_DAILY_BUDGET', 1800),
  // 熔断：连续失败达到阈值后打开，冷却期内直接拒绝，不打扰上游。
  breakerThreshold: envInt('NPC_BREAKER_THRESHOLD', 5),
  breakerCooldownMs: envInt('NPC_BREAKER_COOLDOWN_MS', 60_000),
  // 是否在响应里带上游错误摘要（默认关闭，避免泄露内部信息）。
  exposeUpstreamErrors: process.env.NPC_EXPOSE_ERRORS === '1',
};

if (!CONFIG.apiKey) {
  // 不退出：静态资源仍要能访问，只是 AI 决策恒为 503 → 前端降级规则脑。
  // 这保证「Key 没配好」不会让整个创空间白屏。
  console.warn('[npc-proxy] NPC_API_KEY 未设置：AI 决策将恒返回 503，前端自动降级到规则脑。');
}

// ── 状态（进程内，单实例足够；创空间不保证多实例共享）───────────────────────
const sessions = new Map();
const breaker = { failures: 0, openedAt: 0 };
const daily = { day: '', count: 0 };

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/** 跨天重置。放在请求入口，避免依赖定时器。 */
function rollDailyIfNeeded() {
  const key = todayKey();
  if (daily.day !== key) {
    daily.day = key;
    daily.count = 0;
  }
}

function breakerOpen() {
  if (breaker.failures < CONFIG.breakerThreshold) return false;
  // 冷却期过后允许一次试探（半开）；成功即清零，失败则重新计时。
  if (Date.now() - breaker.openedAt >= CONFIG.breakerCooldownMs) return false;
  return true;
}

function recordFailure() {
  breaker.failures += 1;
  if (breaker.failures >= CONFIG.breakerThreshold) breaker.openedAt = Date.now();
}

function recordSuccess() {
  breaker.failures = 0;
  breaker.openedAt = 0;
}

/**
 * 单会话限流。
 *
 * clientId 来自请求体，由前端生成并存在 localStorage：这**不是**身份认证，
 * 只是把「同一个玩家狂点」和「很多玩家各点几次」区分开。真正的安全边界是
 * 每日全局预算与熔断——即使有人伪造 clientId 刷，也撞在预算上。
 */
function sessionAllowed(clientId) {
  const now = Date.now();
  const entry = sessions.get(clientId);
  if (!entry || now - entry.windowStart >= CONFIG.sessionWindowMs) {
    sessions.set(clientId, { windowStart: now, count: 1 });
    return { ok: true };
  }
  if (entry.count >= CONFIG.sessionMaxCalls) {
    return { ok: false, retryAfterMs: CONFIG.sessionWindowMs - (now - entry.windowStart) };
  }
  entry.count += 1;
  return { ok: true };
}

/** 清掉过期的会话桶，防止 Map 无限增长。 */
function sweepSessions() {
  const now = Date.now();
  for (const [key, entry] of sessions) {
    if (now - entry.windowStart >= CONFIG.sessionWindowMs) sessions.delete(key);
  }
}

// ── 观察对象校验：白名单，字段级 ────────────────────────────────────────────
const ACTION_KINDS = new Set(['dialogue', 'trade', 'gift', 'refuse', 'attack', 'flee']);

/**
 * 服务端内置的任务。客户端只能**选择**任务，永远不能提供提示词文本。
 *
 * 这是这个代理的存在理由：一旦允许客户端传 prompt，它就从「受控推理入口」
 * 变成了「任何人都能免费调用的模型代理」——正是用户明确禁止的形态。
 * 加任务时改这里，不要改协议。
 */
const TASKS = new Set(['dialogue', 'repair']);

const LIMITS = {
  npcId: 64,
  archetype: 32,
  goal: 400,
  memory: 24,
  memorySummary: 300,
  actions: 8,
  relationshipKeys: 16,
  items: 24,
  stringField: 120,
  /** 维修配方与玩家库存的条数上限；超出的截断而不是拒绝。 */
  repairMaterials: 8,
};

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function unitNumber(value) {
  return finiteNumber(value) && value >= 0 && value <= 1;
}

/**
 * 校验并**重建**观察对象。
 *
 * 关键：返回的是新对象，只含白名单字段。请求体里多塞的任何东西（比如
 * 试图注入 system prompt 的 `instructions`）都不会被转发出去。
 */
function sanitizeObservation(raw) {
  if (!isPlainObject(raw)) return { error: 'observation_not_object' };
  if (!boundedString(raw.npcId, LIMITS.npcId)) return { error: 'bad_npcId' };
  if (!boundedString(raw.archetype, LIMITS.archetype)) return { error: 'bad_archetype' };
  if (!boundedString(raw.goal, LIMITS.goal)) return { error: 'bad_goal' };

  const traits = raw.traits;
  if (!isPlainObject(traits)) return { error: 'bad_traits' };
  const cleanTraits = {};
  for (const key of ['altruism', 'pragmatism', 'aggression', 'loyalty', 'caution']) {
    if (!unitNumber(traits[key])) return { error: `bad_trait_${key}` };
    cleanTraits[key] = traits[key];
  }

  if (!finiteNumber(raw.mood) || raw.mood < -1 || raw.mood > 1) return { error: 'bad_mood' };

  if (!isPlainObject(raw.world)) return { error: 'bad_world' };
  const world = {
    day: finiteNumber(raw.world.day) ? raw.world.day : 1,
    gameMinute: finiteNumber(raw.world.gameMinute) ? raw.world.gameMinute : 0,
    floor: finiteNumber(raw.world.floor) ? raw.world.floor : 1,
    night: raw.world.night === true,
  };

  const relationship = {};
  if (isPlainObject(raw.relationship)) {
    const keys = Object.keys(raw.relationship).slice(0, LIMITS.relationshipKeys);
    for (const key of keys) {
      if (!boundedString(key, LIMITS.stringField)) continue;
      const value = raw.relationship[key];
      if (finiteNumber(value)) relationship[key] = value;
    }
  }

  const memory = [];
  if (Array.isArray(raw.memory)) {
    for (const entry of raw.memory.slice(0, LIMITS.memory)) {
      if (!isPlainObject(entry)) continue;
      if (!finiteNumber(entry.day) || !boundedString(entry.kind, LIMITS.stringField)) continue;
      if (!boundedString(entry.summary, LIMITS.memorySummary)) continue;
      memory.push({
        day: entry.day,
        kind: entry.kind,
        summary: entry.summary,
        weight: finiteNumber(entry.weight) ? Math.max(-1, Math.min(1, entry.weight)) : 0,
      });
    }
  }

  const actions = [];
  if (Array.isArray(raw.availableActions)) {
    for (const action of raw.availableActions.slice(0, LIMITS.actions)) {
      if (typeof action === 'string' && ACTION_KINDS.has(action)) actions.push(action);
    }
  }

  const inventory = [];
  if (Array.isArray(raw.inventory)) {
    for (const stack of raw.inventory.slice(0, LIMITS.items)) {
      if (!isPlainObject(stack)) continue;
      if (!boundedString(stack.itemId, LIMITS.stringField)) continue;
      if (!finiteNumber(stack.quantity) || stack.quantity < 1) continue;
      inventory.push({ itemId: stack.itemId, quantity: Math.floor(stack.quantity) });
    }
  }

  // NPC 自身事实。缺失或字段坏掉时给安全默认值，不影响其余校验。
  const rawSelf = isPlainObject(raw.self) ? raw.self : {};
  const self = {
    floor: finiteNumber(rawSelf.floor) ? rawSelf.floor : world.floor,
    x: finiteNumber(rawSelf.x) ? rawSelf.x : 0,
    hp: finiteNumber(rawSelf.hp) ? rawSelf.hp : 0,
  };

  return {
    observation: {
      npcId: raw.npcId,
      archetype: raw.archetype,
      goal: raw.goal,
      traits: cleanTraits,
      mood: raw.mood,
      world,
      relationship,
      memory,
      availableActions: actions,
      inventory,
      self,
    },
  };
}

// ── Prompt（服务端生成，客户端无法覆盖）────────────────────────────────────
// 输出契约必须与前端 parseProposal 完全一致：外层是 {action, confidence,
// utterance}，动作在 action 里。写成裸动作对象会让每一条真实回复都解析失败，
// 表面上「模型在跑」，实际永远降级——这正是要避免的假象。
const ACTION_SPEC = [
  '{"action":{"type":"dialogue","text":"..."},"confidence":0.8}',
  '{"action":{"type":"trade","give":{"itemId":"...","quantity":1},"get":{"itemId":"..."}},"confidence":0.7}',
  '{"action":{"type":"gift","itemId":"...","quantity":1},"confidence":0.7}',
  '{"action":{"type":"refuse"},"utterance":"..."}',
  '{"action":{"type":"attack"},"confidence":0.6}',
  '{"action":{"type":"flee"},"confidence":0.5}',
].join('\n  ');

/**
 * 维修任务的输出契约。
 *
 * 刻意与对话任务分开：维修的意图必须是显式的 `intent` 字段，不能再靠
 * 「回复里有没有『门』字」猜。客户端那层的关键词推断已经删掉了，服务端
 * 这边也不能留一条后门。
 */
const REPAIR_SPEC = [
  '{"intent":"repair_gate","utterance":"现在动手。"}',
  '{"intent":"request_help","itemId":"tape","quantity":1,"utterance":"还缺一卷胶带。"}',
  '{"intent":"refuse","utterance":"材料不够，我不动这门。"}',
  '{"intent":"observe","utterance":"我先看看线路。"}',
].join('\n  ');

/** 维修任务专用的提示。事实（够不够、信任多少）由服务端算好摆出来。 */
function buildRepairMessages(repair) {
  const need = repair.materials.map((s) => `${s.itemId}×${s.quantity}`).join('、') || '（无）';
  const have = repair.playerHas.map((s) => `${s.itemId}×${s.quantity}`).join('、') || '什么都没有';
  const enough = repair.materials.every((n) => {
    const owned = repair.playerHas
      .filter((h) => h.itemId === n.itemId)
      .reduce((total, h) => total + h.quantity, 0);
    return owned >= n.quantity;
  });
  const trustOk = repair.trust >= repair.trustThreshold;

  const system = [
    `你是《第100000层：末日宿舍》里的「${repair.npcName}」，这栋楼的维修工。`,
    `人格：利他${Math.round(repair.traits.altruism * 100)}/务实${Math.round(repair.traits.pragmatism * 100)}/谨慎${Math.round(repair.traits.caution * 100)}。`,
    '铁律：不得声称拥有你没有的物品；不得修改任何游戏数值；不得跳出角色讨论你是 AI。',
    '只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释。',
  ].join('\n');

  const user = [
    `要修的是「${repair.gateId}」。`,
    `所需材料：${need}。`,
    `玩家手上现有一共：${have}。`,
    `材料是否齐备：${enough ? '是' : '否'}。`,
    `你对这个玩家的信任：${repair.trust}（愿意一起干活的门槛 ${repair.trustThreshold}）。`,
    repair.previousRejectedReason ? `上一轮提案被拒绝，原因：${repair.previousRejectedReason}。` : '',
    '按上面的实际情况选一个意图：',
    '  repair_gate  = 现在就动手（只在材料齐且信任达标时选）',
    '  request_help = 缺东西，请玩家去找（必须给 itemId 与 quantity）',
    '  refuse       = 你不愿意或判断不该修',
    '  observe      = 先观察，暂不行动',
    '输出契约（任选其一）：',
    `  ${REPAIR_SPEC}`,
  ].filter(Boolean).join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function buildMessages(obs) {
  const traits = obs.traits;
  const pct = (n) => Math.round(n * 100);
  // 记忆必须带分量，不能只带文本。
  //
  // `weight` 由前端算好再传上来（competitionModelBridge.toObservationMemory：
  // 守约 +0.5、毁约 -0.6、未决 0），语义是「这件事对这位居民有多重」。
  // 之前这里只拼 day/kind/summary，weight 被干净地丢掉了——于是「他上次帮过
  // 我」和「他上次放我鸽子」在提示词里长得一样，模型只能靠 summary 的措辞猜。
  // 那正是「记忆能存、但影响不到决策」的断点所在。
  //
  // 写法上不直接印数字（0.5 对模型没有直观含义），而是译成中文强度词，
  // 同时保留原始数值，免得以后有人以为可以在提示词里做算术。
  const weightWord = (w) => {
    if (w >= 0.75) return '极重';
    if (w >= 0.35) return '较重';
    if (w > -0.35) return '一般';
    if (w > -0.75) return '偏负面';
    return '严重负面';
  };
  const memory = obs.memory.length === 0
    ? '（尚无共同经历）'
    : obs.memory
      .map((m) => `第${m.day}天 ${m.kind}［${weightWord(m.weight)}］：${m.summary}`)
      .join('；');
  const relation = Object.entries(obs.relationship).map(([k, v]) => `${k}:${v}`).join('，') || '初识';

  const system = [
    `你是《第100000层：末日宿舍》中的 NPC「${obs.npcId}」，原型 ${obs.archetype}。`,
    `人格：利他${pct(traits.altruism)}/务实${pct(traits.pragmatism)}/攻击${pct(traits.aggression)}/记恩${pct(traits.loyalty)}/谨慎${pct(traits.caution)}。当前目标：${obs.goal}。当前情绪：${obs.mood.toFixed(2)}。与各方关系：${relation}。`,
    '铁律：你只能从「可用行动」中提议一个；不得声称拥有你没有的物品；不得修改或提及任何游戏数值；不得跳出角色讨论你是 AI。',
    '只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释。',
  ].join('\n');

  const user = [
    `情境：第${obs.world.day}天，第${obs.world.floor}层${obs.world.night ? '（夜间）' : ''}。`,
    `你的状态：第${obs.self.floor}层 x=${Math.round(obs.self.x)}，体力 ${obs.self.hp}。`,
    `相关记忆：${memory}`,
    `你的物品：${obs.inventory.map((s) => `${s.itemId}×${s.quantity}`).join('、') || '（空）'}`,
    `可用行动：${obs.availableActions.join(', ') || 'dialogue'}`,
    '输出契约（任选其一）：',
    `  ${ACTION_SPEC}`,
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ── 维修任务校验 ───────────────────────────────────────────────────────────
/**
 * 维修任务的输入比对话窄得多，所以单独校验、单独重建。
 *
 * 白名单重建的意义：客户端塞进来的任何额外字段都不会到模型跟前。特别是
 * `trust` 与 `materials`——如果让客户端自己报「我信任 100、只需要一块木头」，
 * 这个校验就白做了。
 */
function sanitizeRepair(raw) {
  if (!isPlainObject(raw)) return { error: 'repair_not_object' };
  if (!boundedString(raw.gateId, LIMITS.stringField)) return { error: 'bad_gateId' };
  if (!boundedString(raw.npcName, LIMITS.stringField)) return { error: 'bad_npcName' };

  if (!isPlainObject(raw.traits)) return { error: 'bad_traits' };
  const traits = {};
  for (const key of ['altruism', 'pragmatism', 'aggression', 'loyalty', 'caution']) {
    if (!unitNumber(raw.traits[key])) return { error: `bad_trait_${key}` };
    traits[key] = raw.traits[key];
  }

  if (!finiteNumber(raw.trust) || raw.trust < 0 || raw.trust > 100) return { error: 'bad_trust' };
  if (!finiteNumber(raw.trustThreshold) || raw.trustThreshold < 0 || raw.trustThreshold > 100) {
    return { error: 'bad_trustThreshold' };
  }

  const materials = [];
  if (Array.isArray(raw.materials)) {
    for (const stack of raw.materials.slice(0, LIMITS.repairMaterials)) {
      if (!isPlainObject(stack)) continue;
      if (!boundedString(stack.itemId, LIMITS.stringField)) continue;
      if (!finiteNumber(stack.quantity) || stack.quantity < 1) continue;
      materials.push({ itemId: stack.itemId, quantity: Math.floor(stack.quantity) });
    }
  }
  if (materials.length === 0) return { error: 'empty_materials' };

  const playerHas = [];
  if (Array.isArray(raw.playerHas)) {
    for (const stack of raw.playerHas.slice(0, LIMITS.items)) {
      if (!isPlainObject(stack)) continue;
      if (!boundedString(stack.itemId, LIMITS.stringField)) continue;
      if (!finiteNumber(stack.quantity) || stack.quantity < 1) continue;
      playerHas.push({ itemId: stack.itemId, quantity: Math.floor(stack.quantity) });
    }
  }

  const repair = {
    gateId: raw.gateId,
    npcName: raw.npcName,
    traits,
    trust: raw.trust,
    trustThreshold: raw.trustThreshold,
    materials,
    playerHas,
  };
  if (boundedString(raw.previousRejectedReason, LIMITS.memorySummary)) {
    repair.previousRejectedReason = raw.previousRejectedReason;
  }
  return { repair };
}

// ── 上游调用 ───────────────────────────────────────────────────────────────
async function callUpstream(observation, task = 'dialogue', repair = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
  try {
    const response = await fetch(`${CONFIG.upstreamUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CONFIG.apiKey}`,
      },
      body: JSON.stringify({
        model: CONFIG.model,
        messages: task === 'repair' ? buildRepairMessages(repair) : buildMessages(observation),
        max_tokens: CONFIG.maxTokens,
        temperature: 0.8,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = CONFIG.exposeUpstreamErrors ? `HTTP ${response.status}` : undefined;
      return { ok: false, status: response.status, detail };
    }

    const payload = await response.json();
    const text = payload?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || text.trim().length === 0) {
      return { ok: false, status: 502, detail: 'empty_content' };
    }
    return { ok: true, text };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return { ok: false, status: aborted ? 504 : 502, detail: aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

// ── 静态文件 ───────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

/** 目录穿越防护：解析后必须仍在 dist 内。 */
function safePath(urlPath) {
  // 畸形百分号编码（如 GET /%）会让 decodeURIComponent 抛 URIError。
  // 此前这里裸奔，异常穿过 serveStatic 与 createServer 的 async 回调，
  // 全文件又没有 unhandledRejection 兜底 —— 一个 GET 就能让进程退出。
  // 解码失败按「路径不安全」处理，复用调用方既有的 403 分支，不新增响应形态。
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  const candidate = resolve(join(DIST_ROOT, normalize(decoded)));
  if (candidate !== DIST_ROOT && !candidate.startsWith(DIST_ROOT + sep)) return null;
  return candidate;
}

async function serveStatic(req, res) {
  const raw = req.url ?? '/';
  let target = safePath(raw);
  if (!target) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const info = await stat(target);
    if (info.isDirectory()) target = join(target, 'index.html');
  } catch {
    // 不存在的路径回退到 index.html（单页应用常规行为）。
    target = join(DIST_ROOT, 'index.html');
  }
  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
      // 构建产物文件名带 hash，可长缓存；index.html 必须不缓存以便发版生效。
      'Cache-Control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
  }
}

// ── 请求体读取（带上限，防大包打爆内存）──────────────────────────────────
function readJsonBody(req, res, limitBytes = 32 * 1024) {
  return new Promise((resolvePromise) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        res.writeHead(413, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, reason: 'payload_too_large' }));
        req.destroy();
        resolvePromise(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolvePromise(isPlainObject(parsed) ? parsed : null);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, reason: 'bad_json' }));
        resolvePromise(null);
      }
    });
    req.on('error', () => resolvePromise(null));
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

// ── 路由 ───────────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];

  // 健康检查：部署平台和我们都用它确认容器活着。
  if (path === '/healthz') {
    sendJson(res, 200, {
      ok: true,
      aiConfigured: CONFIG.apiKey.length > 0,
      breakerOpen: breakerOpen(),
      dailyUsed: daily.count,
      dailyBudget: CONFIG.dailyBudget,
    });
    return;
  }

  if (path === '/api/npc/decide') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, reason: 'method_not_allowed' });
      return;
    }

    rollDailyIfNeeded();
    sweepSessions();

    if (!CONFIG.apiKey) {
      sendJson(res, 503, { ok: false, reason: 'ai_unconfigured', decisionSource: 'rules-fallback' });
      return;
    }
    if (breakerOpen()) {
      sendJson(res, 503, { ok: false, reason: 'breaker_open', decisionSource: 'rules-fallback' });
      return;
    }
    if (daily.count >= CONFIG.dailyBudget) {
      sendJson(res, 429, { ok: false, reason: 'daily_budget_exhausted', decisionSource: 'rules-fallback' });
      return;
    }

    const body = await readJsonBody(req, res);
    if (body === null) return;

    const clientId = boundedString(body.clientId, 64) ? body.clientId : 'anonymous';
    const limited = sessionAllowed(clientId);
    if (!limited.ok) {
      sendJson(res, 429, {
        ok: false,
        reason: 'session_rate_limited',
        retryAfterMs: limited.retryAfterMs ?? CONFIG.sessionWindowMs,
        decisionSource: 'rules-fallback',
      });
      return;
    }

    const sanitized = sanitizeObservation(body.observation);
    if (sanitized.error) {
      sendJson(res, 400, { ok: false, reason: sanitized.error });
      return;
    }

    // 任务选择：客户端只能从枚举里挑，不能给文本。
    // 未声明任务一律按 dialogue 处理，保持对旧客户端的兼容。
    const task = typeof body.task === 'string' && TASKS.has(body.task) ? body.task : 'dialogue';
    let repair = null;
    if (task === 'repair') {
      const checked = sanitizeRepair(body.repair);
      if (checked.error) {
        sendJson(res, 400, { ok: false, reason: checked.error });
        return;
      }
      repair = checked.repair;
    }

    daily.count += 1;
    const result = await callUpstream(sanitized.observation, task, repair);
    if (!result.ok) {
      recordFailure();
      sendJson(res, 503, {
        ok: false,
        reason: 'upstream_unavailable',
        ...(result.detail ? { detail: result.detail } : {}),
        decisionSource: 'rules-fallback',
      });
      return;
    }

    recordSuccess();
    // 只回传文本与来源标签；解析与规则裁决仍在前端（模型只提议，规则才裁决）。
    sendJson(res, 200, { ok: true, text: result.text, decisionSource: 'model' });
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    await serveStatic(req, res);
    return;
  }

  sendJson(res, 405, { ok: false, reason: 'method_not_allowed' });
});

server.listen(CONFIG.port, CONFIG.host, () => {
  console.log(`[npc-proxy] listening on http://${CONFIG.host}:${CONFIG.port}`);
  console.log(`[npc-proxy] upstream=${CONFIG.upstreamUrl} model=${CONFIG.model} keyConfigured=${CONFIG.apiKey.length > 0}`);
});