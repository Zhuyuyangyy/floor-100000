// Ollama 大脑：Spark 本地推理的传输层（RFC §5）。
//
// 只管 HTTP 与 JSON 搬运：prompt 构造在 prompt.ts，合法性裁决在
// rulesExecutor.ts。任何网络错误、超时、非契约回复都收敛为 null——
// 调用方（NpcRuntime）据此降级，绝不在半路抛错打断游戏循环。

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
}

const DEFAULT_TIMEOUT_MS = 8000;

export class OllamaBrain implements NpcBrain {
  readonly id = 'ollama';
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OllamaBrainOptions) {
    this.baseUrl = (options.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
      const res = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          model: this.model,
          stream: false,
          temperature: 0.7,
          messages: [
            { role: 'system', content: buildSystemPrompt(obs) },
            { role: 'user', content: buildUserPrompt(obs) },
          ],
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') return null;
      return parseProposal(content);
    } catch {
      return null; // 超时/断网/坏 JSON：一律降级
    }
  }
}
