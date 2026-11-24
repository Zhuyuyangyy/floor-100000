import { describe, expect, it } from 'vitest';
import {
  runCompetitionReplayBenchmark,
  type CompetitionReplayScenario,
} from './competitionReplayBenchmark';

describe('offline competition replay benchmark', () => {
  it('从两个固定 seed 重建三个场景并稳定序列化重放结果', async () => {
    const seeds = [19, 47] as const;
    const first = await runCompetitionReplayBenchmark(seeds);
    const repeated = await runCompetitionReplayBenchmark(seeds);

    expect(first.executionMode).toBe('offline-fallback');
    expect(first.scope).toContain('不衡量模型质量、延迟或任务成功率');
    expect(first.seeds).toEqual(seeds);
    expect(first.sampleCount).toBe(6);
    expect(first.replayMatchCount).toBe(6);
    expect(first.replayMatchRate).toBe(1);
    expect(first.samples.every((sample) => sample.replayIdentical)).toBe(true);
    expect(first.samples.every((sample) => sample.snapshotHashesVerified)).toBe(true);
    expect(first.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.contentSha256).toBe(repeated.contentSha256);
    expect(first.samples).toEqual(repeated.samples);

    expect(first.scenarioResultCounts['alin-gift-success']).toEqual({ executed: 2 });
    expect(first.scenarioResultCounts['alin-gift-missing-item']).toEqual({ blocked: 2 });
    expect(first.scenarioResultCounts['alin-repair-missing-materials']).toEqual({ blocked: 2 });

    const expectedValidationCode: Readonly<Record<CompetitionReplayScenario, string>> = {
      'alin-gift-success': 'ok',
      'alin-gift-missing-item': 'missing_item',
      'alin-repair-missing-materials': 'missing_item',
    };
    const expectedStatus: Readonly<Record<CompetitionReplayScenario, string>> = {
      'alin-gift-success': 'executed',
      'alin-gift-missing-item': 'blocked',
      'alin-repair-missing-materials': 'blocked',
    };
    for (const sample of first.samples) {
      expect(seeds).toContain(sample.seed);
      expect(sample.resultStatus).toBe(expectedStatus[sample.scenario]);
      expect(sample.validationCode).toBe(expectedValidationCode[sample.scenario]);
      if (sample.scenario === 'alin-repair-missing-materials') {
        expect(sample.gateStayedClosed).toBe(true);
      } else {
        expect(sample.gateStayedClosed).toBeNull();
      }
      if (sample.scenario === 'alin-gift-success') {
        expect(sample.repairMaterialsUnchanged).toBe(true);
      } else {
        expect(sample.repairMaterialsUnchanged).toBeNull();
      }
      expect(sample.outputSha256).toMatch(/^[a-f0-9]{64}$/);
    }
    for (const scenario of Object.keys(expectedStatus) as CompetitionReplayScenario[]) {
      const scenarioSamples = first.samples.filter((sample) => sample.scenario === scenario);
      expect(scenarioSamples.map((sample) => sample.seed)).toEqual(seeds);
      expect(scenarioSamples[0]?.outputSha256).not.toBe(scenarioSamples[1]?.outputSha256);
    }
  });

  it('拒绝空、重复或非 uint32 整数的 seed 输入', async () => {
    await expect(runCompetitionReplayBenchmark([])).rejects.toThrow('至少需要一个 seed');
    await expect(runCompetitionReplayBenchmark([5, 5])).rejects.toThrow('不得重复');
    await expect(runCompetitionReplayBenchmark([-1])).rejects.toThrow('uint32');
  });
});
