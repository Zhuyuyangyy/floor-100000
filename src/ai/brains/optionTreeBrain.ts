// 选项树大脑：降级路径的大脑实现（RFC §4 护栏 2）。
//
// 它复现「改造前」的全部行为：只给一句问候，交易菜单仍归场景所有。
// Spark 不可达时 NpcRuntime 切到它，玩家应当感知不到差异
// （除了 AI 那些记忆/人格驱动的变化消失）。

import type { NpcActionProposal, NpcBrain, NpcObservation } from '../types';

export class OptionTreeBrain implements NpcBrain {
  readonly id = 'option-tree';

  constructor(private readonly fallbackLine: string) {}

  async health(): Promise<boolean> {
    return true; // 本地选项树永远可用
  }

  async decide(_obs: NpcObservation): Promise<NpcActionProposal | null> {
    // 置信度 1：这不是猜测，是写死的行为。
    return { action: { type: 'dialogue', text: this.fallbackLine }, confidence: 1 };
  }
}
