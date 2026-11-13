import { describe, expect, it, vi, afterEach } from 'vitest';
import { aiNpcConfig, archetypeForNpcId, npcFactFromDef, npcInventoryFromDef } from './config';
import { NPCS, getNpc } from '../data/npcs';

// 配置测试的重点是治理行为：没有任何配置时 AI 必须是关闭的——
// 「默认与改造前一致」不是愿望，是可断言的约束。

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('aiNpcConfig：默认关闭', () => {
  it('无模型配置时 enabled=false', () => {
    vi.stubEnv('VITE_NPC_MODEL', '');
    expect(aiNpcConfig().enabled).toBe(false);
  });

  it('未 stub 时同样关闭（生产默认）', () => {
    const cfg = aiNpcConfig();
    expect(cfg.model).toBe('');
    expect(cfg.enabled).toBe(false);
  });

  it('配置了模型名才开启', () => {
    vi.stubEnv('VITE_NPC_MODEL', 'qwen3:8b');
    const cfg = aiNpcConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.model).toBe('qwen3:8b');
    expect(cfg.baseUrl).toBe('http://127.0.0.1:11434'); // 默认本机，不入库
  });

  it('超时可配且非法值回落默认（45s，实测校准值）', () => {
    vi.stubEnv('VITE_NPC_MODEL', 'm');
    vi.stubEnv('VITE_NPC_TIMEOUT_MS', '5000');
    expect(aiNpcConfig().timeoutMs).toBe(5000);
    vi.stubEnv('VITE_NPC_TIMEOUT_MS', 'abc');
    expect(aiNpcConfig().timeoutMs).toBe(45_000);
  });
});

describe('NPC 事实构建', () => {
  it('archetypeForNpcId：阿林=ally，小周=neutral，流浪者=hostile，未知=neutral', () => {
    expect(archetypeForNpcId('alin')).toBe('ally');
    expect(archetypeForNpcId('xiaozhou')).toBe('neutral');
    expect(archetypeForNpcId('wanderer')).toBe('hostile');
    expect(archetypeForNpcId('someone_else')).toBe('neutral');
  });

  it('npcInventoryFromDef：报价表的 give 物品汇总成持有物', () => {
    const inv = npcInventoryFromDef(getNpc('alin'));
    expect(inv).toEqual(
      expect.arrayContaining([
        { itemId: 'wire', quantity: 1 },
        { itemId: 'fuse', quantity: 1 },
      ]),
    );
    // 小周的面包和净水
    const zhou = npcInventoryFromDef(getNpc('xiaozhou'));
    expect(zhou.map((s) => s.itemId).sort()).toEqual(['bread', 'clean_water']);
  });

  it('npcFactFromDef：楼层/坐标/人格来自数据表', () => {
    const fact = npcFactFromDef(getNpc('alin'));
    expect(fact.id).toBe('alin');
    expect(fact.archetype).toBe('ally');
    expect(fact.floor).toBe(2);
    expect(fact.x).toBe(getNpc('alin').x);
    expect(NPCS.every((n) => npcFactFromDef(n).inventory.length > 0)).toBe(true);
  });
});
