// Ollama 大脑：Spark 本地推理的传输层（RFC §5）。
//
// 只管 HTTP 与 JSON 搬运：prompt 构造在 prompt.ts，合法性裁决在
// rulesExecutor.ts。任何网络错误、超时、非契约回复都收敛为 null——
// 调用方（NpcRuntime）据此降级，绝不在半路抛错打断游戏循环。
//
// 为什么走原生 /api/chat 而不是 /v1/chat/completions：
// npc-qwen 是带思维链的模型（Modelfile 的 RENDERER qwen3.8）。走 /v1 时
// `think:false` 被忽略，reasoning 会先吃掉整段 token 预算；只要调用方设置
// max_tokens（或模型自己把预算用尽），返回就会是 HTTP 200 + finish_reason
// "length" + content 空串——即“成功但内容为空”，提案、校验、执行全部落空。
// 原生 /api/chat 支持 `think:false`，实测 thinking 归零、耗时从 10s+ 降到 ~3s。

import { buildSystemPrompt, buildUserPrompt, parseProposal } from '../prompt';
import type {
  NpcActionProposal,
  NpcBrain,
  NpcBrainTaskRequest,
  NpcBrainTaskResult,
  NpcObservation,
} from '../types';

export interface OllamaBrainOptions {
  /** Ollama 服务地址。默认本机；地址与模型名走配置/环境变量，不入库。 */
  baseUrl?: string;
  /** 模型名，如 'qwen3:8b'。代理模式下忽略（模型由服务端固定）。 */
  model: string;
  /** 测试注入用；生产传全局 fetch。 */
  fetchImpl?: typeof fetch;
  /** 单次推理超时。 */
  timeoutMs?: number;
  /** 输出 token 上限；undefined 时不限制（老行为）。 */
  maxOutputTokens?: number;
  /** 关掉思维链。带 thinking 的模型必须为 true，否则会空 content。 */
  disableThinking?: boolean;
  /**
   * 走同域后端代理（公开部署形态）而非直连推理服务。
   *
   * 三件事一并改变：不发送 model/max_tokens（服务端固定，防止被当开放代理）、
   * 不发送任何凭据（Key 只在服务端）、请求体是结构化观察对象而不是 prompt
   * 文本（服务端自己拼 prompt，客户端无法注入指令）。
   */
  proxyMode?: boolean;
  /** 代理模式下的会话标识；仅用于服务端限流，不含身份信息。 */
  sessionId?: string;
}

const DEFAULT_TIMEOUT_MS = 8000;

/** 原生 /api/chat 的响应形状：content 与 thinking 分开返回。 */
interface OllamaChatResponse {
  message?: { content?: string; thinking?: string };
  done_reason?: string;
  eval_count?: number;
}

/** 兼容 OpenAI 形状的 /v1/chat/completions（旧服务或代理）。 */
interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string; reasoning?: string; reasoning_content?: string } }>;
}

/**
 * 从两种响应形状里取出「正文」。
 *
 * 必须只认正文，不能把 reasoning/thinking 当正文：思维链里常常包含
 * 半截 JSON 或对输出的讨论，喂给 parseProposal 会解析出错误动作。
 */
function readAssistantText(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const native = raw as OllamaChatResponse;
  if (typeof native.message?.content === 'string') return native.message.content;
  const openai = raw as OpenAiChatResponse;
  const content = openai.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : null;
}

/**
 * 空正文的诊断：区分「模型没话说」与「预算耗尽被截断」。
 * 只用于内部判断是否值得重试一次，不外泄任何服务端文本。
 */
function wasTruncated(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const native = raw as OllamaChatResponse;
  return native.done_reason === 'length';
}

export class OllamaBrain implements NpcBrain {
  readonly id = 'ollama';
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxOutputTokens: number | undefined;
  private readonly disableThinking: boolean;
  private readonly proxyMode: boolean;
  private readonly sessionId: string;
  /** 最近一次决策的真实来源，供 UI 如实展示（不改 NpcBrain 接口）。 */
  private lastSource: 'model' | 'rules-fallback' = 'rules-fallback';

  constructor(options: OllamaBrainOptions) {
    this.baseUrl = (options.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');
    this.model = options.model;
    // 浏览器里裸 fetch 引用脱离 window 调用会抛 Illegal invocation；
    // 包一层箭头函数保证 this 正确。测试注入的 mock 不受影响。
    this.fetchImpl = options.fetchImpl ?? ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutputTokens = options.maxOutputTokens;
    this.disableThinking = options.disableThinking ?? true;
    this.proxyMode = options.proxyMode ?? false;
    this.sessionId = options.sessionId ?? 'local';
  }

  /**
   * 最近一次决策的来源。`model` 表示真的由模型给出，`rules-fallback`
   * 表示这一轮已降级——UI 必须据此如实显示，不能永远标「AI」。
   */
  get decisionSource(): 'model' | 'rules-fallback' {
    return this.lastSource;
  }

  /**
   * 就绪探测。运行时在真正决策前会先问一次，探测失败就等于「没有主脑」，
   * decide() 根本不会被调用——所以这个方法的 URL 必须和实际调用形态一致。
   *
   * 代理模式下运行时 health 打的是代理自己的 `/healthz`：`/api/tags` 是
   * Ollama 原生端点，同源代理上不存在，请求会返回 404，于是「模型可用」
   * 被永久误判成「不可用」，UI 永远显示降级文案、请求一次都发不出去。
   */
  async health(): Promise<boolean> {
    try {
      const probe = this.proxyMode ? `${this.baseUrl}/healthz` : `${this.baseUrl}/api/tags`;
      const res = await this.fetchImpl(probe, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async decide(obs: NpcObservation): Promise<NpcActionProposal | null> {
    // 代理模式：发结构化观察，由服务端拼 prompt 并决定模型。客户端不传
    // 模型名、不传预算、不传凭据——这样即使前端被反编译也拿不到 Key。
    if (this.proxyMode) return this.decideViaProxy(obs);

    try {
      this.lastSource = 'rules-fallback';
      const body: Record<string, unknown> = {
        model: this.model,
        stream: false,
        // 关掉思维链：带 thinking 的模型在 /v1 下会因此返回空正文。
        think: !this.disableThinking,
        // 强制 JSON：模型不能再裹 markdown 代码块或加解释。
        format: 'json',
        messages: [
          { role: 'system', content: buildSystemPrompt(obs) },
          { role: 'user', content: buildUserPrompt(obs) },
        ],
        options: {
          temperature: 0.7,
          ...(this.maxOutputTokens === undefined ? {} : { num_predict: this.maxOutputTokens }),
        },
      };

      const raw = await this.post('/api/chat', body);
      if (raw === null) return null;
      const content = readAssistantText(raw);
      // 正文为空时不解析：这是“成功但内容为空”的原始症状，必须显式降级。
      if (content === null || content.trim().length === 0) {
        // 被截断的空正文说明预算不够，放宽上限重试一次；非截断的直接降级。
        if (wasTruncated(raw) && this.maxOutputTokens !== undefined) {
          return this.retryWithLargerBudget(obs);
        }
        return null;
      }
      const proposal = parseProposal(content);
      if (proposal) {
        this.lastSource = 'model';
        return proposal;
      }
      // 有正文但截断在半句上（JSON 不完整）也值得放宽重试一次。
      if (wasTruncated(raw) && this.maxOutputTokens !== undefined) {
        return this.retryWithLargerBudget(obs);
      }
      return null;
    } catch {
      return null; // 超时/断网/坏 JSON：一律降级
    }
  }

  /**
   * 任务型推理：维修。
   *
   * 与 `decide()` 的关键差别是**输出契约不同**。对话任务要
   * `{"action":{"type":...}}`，维修任务要 `{"intent":"repair_gate"|...}`。
   * 让同一个提示词同时满足两套契约，模型会挑它熟的写——实测就是无论怎么
   * 强调，它还是回 `action.type`。分开请求是唯一稳的做法。
   *
   * 代理模式下客户端只说「我要 repair 任务」，事实（配方、信任、差多少）
   * 由服务端算并拼提示词。客户端**无法**提供提示词文本。
   *
   * 直连 Ollama 模式（Spark）下没有服务端，只能在这里拼——但那条路径不面
   * 向公开玩家，且提示词仍由代码生成，不由请求方提供。
   */
  async decideTask(request: NpcBrainTaskRequest): Promise<NpcBrainTaskResult | null> {
    if (request.task !== 'repair' || !request.repair) return null;

    if (this.proxyMode) {
      try {
        const res = await this.fetchImpl(`${this.baseUrl}/api/npc/decide`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: AbortSignal.timeout(this.timeoutMs),
          body: JSON.stringify({
            clientId: this.sessionId,
            task: 'repair',
            // 服务端要求 observation 存在（沿用既有的限流/预算走账路径），
            // 但维修提示并不读它——真正的事实都在 repair 里。
            observation: {
              npcId: request.repair.npcName,
              archetype: 'ally',
              goal: 'repair',
              traits: request.repair.traits,
              mood: 0,
              world: { day: 1, gameMinute: 0, floor: 1, night: false },
              relationship: {},
              memory: [],
              availableActions: ['dialogue'],
            },
            repair: request.repair,
          }),
        });
        if (!res.ok) return null;
        const payload = (await res.json()) as { ok?: boolean; text?: string; decisionSource?: string };
        if (payload.ok !== true || payload.decisionSource !== 'model') return null;
        if (typeof payload.text !== 'string' || payload.text.trim().length === 0) return null;
        return { text: payload.text, source: 'model' };
      } catch {
        return null;
      }
    }

    // 直连模式：提示词在这里生成（代码固定，请求方无法注入）。
    try {
      const repair = request.repair;
      const need = repair.materials.map((s) => `${s.itemId}×${s.quantity}`).join('、') || '（无）';
      const have = repair.playerHas.map((s) => `${s.itemId}×${s.quantity}`).join('、') || '什么都没有';
      const enough = repair.materials.every((n) => {
        const owned = repair.playerHas
          .filter((h) => h.itemId === n.itemId)
          .reduce((total, h) => total + h.quantity, 0);
        return owned >= n.quantity;
      });
      const messages = [
        {
          role: 'system',
          content: [
            `你是《第100000层：末日宿舍》里的「${repair.npcName}」，这栋楼的维修工。`,
            '铁律：不得声称拥有你没有的物品；不得修改任何游戏数值；不得跳出角色讨论你是 AI。',
            '只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `要修的是「${repair.gateId}」。所需材料：${need}。玩家手上：${have}。`,
            `材料是否齐备：${enough ? '是' : '否'}。信任 ${repair.trust}（门槛 ${repair.trustThreshold}）。`,
            '选一个意图：repair_gate（动手）/ request_help（要材料，附 itemId 与 quantity）/ refuse / observe',
            '输出：{"intent":"...","utterance":"40字以内"}',
          ].join('\n'),
        },
      ];
      const raw = await this.post('/api/chat', {
        model: this.model,
        stream: false,
        think: !this.disableThinking,
        format: 'json',
        messages,
        options: {
          temperature: 0.3,
          ...(this.maxOutputTokens === undefined ? {} : { num_predict: this.maxOutputTokens }),
        },
      });
      if (raw === null) return null;
      const content = readAssistantText(raw);
      if (content === null || content.trim().length === 0) return null;
      return { text: content, source: 'model' };
    } catch {
      return null;
    }
  }

  /**
   * 代理模式实现。
   *
   * 请求体只有两样东西：会话标识（服务端限流用）和观察对象（服务端逐字段
   * 白名单校验）。服务端回 `decisionSource`，我们只认 `model`；任何其它来源
   * 或非 2xx 都降级，绝不把「服务端说降级了」当成模型输出。
   */
  private async decideViaProxy(obs: NpcObservation): Promise<NpcActionProposal | null> {
    this.lastSource = 'rules-fallback';
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/npc/decide`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          clientId: this.sessionId,
          observation: {
            npcId: obs.npcId,
            archetype: obs.archetype,
            goal: obs.goal,
            traits: obs.traits,
            mood: obs.mood,
            world: obs.world,
            relationship: obs.relationship,
            memory: obs.memory,
            availableActions: obs.availableActions,
            // NPC 视角的自身事实（位置/血量）——服务端会逐字段校验。
            self: obs.self,
          },
        }),
      });
      if (!res.ok) return null;
      const payload = (await res.json()) as { ok?: boolean; text?: string; decisionSource?: string };
      if (payload.ok !== true || payload.decisionSource !== 'model') return null;
      if (typeof payload.text !== 'string' || payload.text.trim().length === 0) return null;
      const proposal = parseProposal(payload.text);
      if (proposal) this.lastSource = 'model';
      return proposal;
    } catch {
      return null;
    }
  }

  /** 截断后的一次放宽重试；仍然失败就返回 null 交给规则人格脑兜底。 */
  private async retryWithLargerBudget(obs: NpcObservation): Promise<NpcActionProposal | null> {
    try {
      const raw = await this.post('/api/chat', {
        model: this.model,
        stream: false,
        think: !this.disableThinking,
        format: 'json',
        messages: [
          { role: 'system', content: buildSystemPrompt(obs) },
          { role: 'user', content: buildUserPrompt(obs) },
        ],
        options: { temperature: 0.7, num_predict: Math.max((this.maxOutputTokens ?? 0) * 3, 512) },
      });
      if (raw === null) return null;
      const content = readAssistantText(raw);
      if (content === null || content.trim().length === 0) return null;
      const proposal = parseProposal(content);
      if (proposal) this.lastSource = 'model';
      return proposal;
    } catch {
      return null;
    }
  }

  /** 单次 POST；非 2xx、坏 JSON、网络异常统一返回 null。 */
  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return res.json();
  }
}