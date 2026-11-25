// Offline, deterministic NPC decision brain for the public playable build.
// This is a bounded rule-driven behavior layer, not generative AI: it may only
// propose one short dialogue action, and the existing rules executor still
// validates every proposal before the scene displays it.

import type { NpcBrain, NpcObservation } from '../types';

const MAX_LINE_LENGTH = 60;

function latestPlayerMemory(observation: NpcObservation) {
  for (let i = observation.memory.length - 1; i >= 0; i--) {
    const entry = observation.memory[i];
    if (entry?.actor === 'player') return entry;
  }
  return undefined;
}

function lineFor(observation: NpcObservation): string {
  const relationship = observation.relationship.player ?? 0;
  const memory = latestPlayerMemory(observation);

  if (memory) {
    if (memory.weight < 0) return '我记着前几次的事。交易条件先说清楚。';
    if (memory.kind === 'gift' || memory.kind === 'help') {
      return observation.archetype === 'ally'
        ? '你之前帮了我，我还记着。能搭把手的地方尽管说。'
        : '你之前帮过我，我记着。今天要换什么？';
    }
    if (memory.kind === 'trade') {
      return observation.archetype === 'ally'
        ? '上次那笔交易我记着。线路材料，咱们按规矩换。'
        : '上次那笔交易我记着。东西说清楚，咱们按价来。';
    }
    if (memory.kind === 'refusal' || memory.kind === 'insult' || memory.kind === 'attack') {
      return '我记着之前的事。交易条件先说清楚。';
    }
  }

  if (relationship >= 20) {
    return observation.archetype === 'ally'
      ? '有你帮衬，守这层线路也没那么难了。'
      : '你一向讲信用。今天我这儿还是有面包和水。';
  }
  if (relationship <= -20) {
    return observation.archetype === 'ally'
      ? '我还记得之前的事。东西要换，先把条件说清楚。'
      : '前几次的事我记着。交易就按明码来，别的免谈。';
  }

  if (observation.world.night) {
    return observation.archetype === 'ally'
      ? '夜里线路声不对。天黑了，别在走廊多待。'
      : '天黑了还没回去？我不想在走廊多待。';
  }

  if (observation.world.day > 1) {
    return observation.archetype === 'ally'
      ? '又是新的一天，线路还得继续巡。今天缺些维修材料。'
      : '又是新的一天。今天要换什么，先把条件讲明。';
  }

  return observation.archetype === 'ally'
    ? '我是阿林，守着这层线路；电池和废金属都用得上。'
    : '我是小周，面包和净水都能换，条件先讲好。';
}

export class LocalPersonaBrain implements NpcBrain {
  readonly id = 'local-persona';

  async health(): Promise<boolean> {
    return true;
  }

  async decide(observation: NpcObservation) {
    const text = lineFor(observation).slice(0, MAX_LINE_LENGTH);
    return { action: { type: 'dialogue' as const, text }, confidence: 1 };
  }
}
