// 维修目标的透传：`repair_gate` 不一定在修门。
//
// 这个文件存在的原因很具体——A2 的停电危机借用 `repair_gate` 的语义去修塔楼
// 主线（`tower-main-power`），它不是通行门。如果解析层把 `target` 吃掉，
// 调用方只能回退到「当前场景默认那一个目标」，一旦场景里有两个可修目标就会
// 修错东西，而且不会有任何报错。
//
// 放在单独文件而不是 `repairIntent.test.ts`：后者属于 A0（总控），
// 维修意图的实现归他维护，我不改动他的测试文件。

import { describe, expect, it } from 'vitest';
import { parseRepairIntent } from './repairIntent';
import { parseContract } from './actionContract';

describe('维修目标透传：repair_gate 的 target 必须保留', () => {
  it('塔楼主线（非通行门）能被原样带出', () => {
    const decision = parseRepairIntent(
      JSON.stringify({ intent: 'repair_gate', target: 'tower-main-power', utterance: '我去修主线' }),
    );
    expect(decision?.intent).toBe('repair_gate');
    expect(decision?.target).toBe('tower-main-power');
  });

  it('通行门 id 同样原样带出，不做任何改写', () => {
    const decision = parseRepairIntent(
      JSON.stringify({ intent: 'repair_gate', target: 'alin_repair_gate' }),
    );
    expect(decision?.target).toBe('alin_repair_gate');
  });

  it('未指定 target 时不编造，缺省留给调用方按场景默认处理', () => {
    // 关键：解析层不能自己填一个「看起来合理」的默认值。它不知道场景里有
    // 几个可修目标，猜错就是静默修错东西。
    expect(parseRepairIntent('{"intent":"repair_gate"}')?.target).toBeUndefined();
  });

  it('target 超长被截断，不会把整段模型正文塞进 id', () => {
    const decision = parseRepairIntent(
      JSON.stringify({ intent: 'repair_gate', target: 'x'.repeat(200) }),
    );
    expect(decision?.target?.length).toBe(60);
  });

  it('非 repair_gate 的意图不透出 target，避免调用方拿它当维修目标', () => {
    const decision = parseRepairIntent(JSON.stringify({ intent: 'observe', target: 'tower-main-power' }));
    expect(decision?.intent).toBe('observe');
    expect(decision?.target).toBeUndefined();
  });

  it('全局契约与维修契约对同一 target 的结论一致', () => {
    const raw = JSON.stringify({ intent: 'repair_gate', target: 'tower-main-power' });
    expect(parseContract(raw)).toMatchObject({ intent: 'repair_gate', target: 'tower-main-power' });
    expect(parseRepairIntent(raw)).toMatchObject({ intent: 'repair_gate', target: 'tower-main-power' });
  });
});