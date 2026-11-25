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
import type { NpcActionProposal, NpcBrain, NpcObservation } from '../types';

export interface OllamaBrainOptions {
  /** Ollama 服务地址。默认本机；地址与模型名走配置/环境变量，不入库。 */
  baseUrl?: string;
  /** 模型名，如 'qwen3:8b'。 */
  model: string;
  /** 测试注入用；生产传全局 fetch。 */
  fetchImpl?: typeof fetch;
  /** 单次推理超时。 */
  timeoutMs?: number;
  /** 输出 token 上限；undefined 时不限制（老行为）。 */
  maxOutputTokens?: number;
  /** 关掉思维链。带 thinking 的模型必须为 true，否则会空 content。 */
  disableThinking?: boolean;
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

  constructor(options: OllamaBrainOptions) {
    this.baseUrl = (options.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');
    this.model = options.model;
    // 浏览器里裸 fetch 引用脱离 window 调用会抛 Illegal invocation；
    // 包一层箭头函数保证 this 正确。测试注入的 mock 不受影响。
    this.fetchImpl = options.fetchImpl ?? ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutputTokens = options.maxOutputTokens;
    this.disableThinking = options.disableThinking ?? true;
  }

  async health(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async decide(obs: NpcObservation): Promise<NpcActionProposal | null> {
    try {
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
      if (proposal) return proposal;
      // 有正文但截断在半句上（JSON 不完整）也值得放宽重试一次。
      if (wasTruncated(raw) && this.maxOutputTokens !== undefined) {
        return this.retryWithLargerBudget(obs);
      }
      return null;
    } catch {
      return null; // 超时/断网/坏 JSON：一律降级
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
      return content === null || content.trim().length === 0 ? null : parseProposal(content);
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