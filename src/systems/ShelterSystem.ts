import { STARTING_FLOOR } from '../core/constants';
import { GAME_CONFIG } from '../core/config';
import type { GameState, ShelterAction, ShelterPlan } from '../core/gameTypes';
import { deriveSeed, makeRng } from '../core/rng';
import { craft } from './CraftingSystem';
import { appendDiaryEvent, makeDiaryEvent } from './DiarySystem';
import { AILMENTS, applyCure, cure, hasAilment } from './SicknessSystem';
import { countItem, removeItem } from './InventorySystem';
import { sleep } from './SurvivalSystem';

export interface ShelterResolution {
  ok: boolean;
  action: ShelterAction;
  message: string;
  events: string[];
  itemChanges: Array<{ itemId: ShelterItemId; quantity: number }>;
  stressDelta: number;
  reason?: string;
}

export interface NightResolution {
  ok: boolean;
  nextDay?: number;
  hpLost: number;
  stressDelta: number;
  healedAilments: string[];
  events: string[];
  attacked: boolean;
  attackDamage: number;
  reason?: string;
}

type ShelterItemId = 'medkit' | 'ration_pack' | 'wood' | 'tape';

const ACTIONS: ShelterAction[] = ['rest', 'treat', 'repair', 'care'];
const STRESS_DELTA: Record<ShelterAction, number> = {
  rest: -6,
  treat: -10,
  repair: -4,
  care: -12,
};

const SHELTER_ATTACK_CHANCE = 0.25;
const SHELTER_ATTACK_DAMAGE = 12;

/**
 * A repaired door closes the shelter loop: it turns the night from a pure
 * resource decision into a preparation decision with a visible payoff.
 * The roll is derived from the run seed and the night being settled, so a
 * replay with the same input sequence produces the same result.
 */
export function shouldShelterBeAttacked(runSeed: number, day: number, action: ShelterAction): boolean {
  if (action === 'repair') return false;
  return makeRng(deriveSeed(runSeed, day, 'shelter-attack')).chance(SHELTER_ATTACK_CHANCE);
}

function failure(action: ShelterAction, reason: string): ShelterResolution {
  return { ok: false, action, message: reason, reason, events: [], itemChanges: [], stressDelta: 0 };
}

function readyForShelter(state: GameState, action: ShelterAction): ShelterResolution | null {
  if (state.status !== 'playing') return failure(action, '游戏已结束');
  if (state.currentFloor !== STARTING_FLOOR) return failure(action, '必须回到第 1 层宿舍');
  if (state.shelterPlan?.resolved) return failure(action, '今晚已经安排过 shelter 行动');
  return null;
}

function resolveSuccess(
  state: GameState,
  action: ShelterAction,
  kind: 'shelter_rested' | 'shelter_treated' | 'shelter_repaired' | 'neighbor_cared',
  message: string,
  itemChanges: Array<{ itemId: ShelterItemId; quantity: number }>,
): ShelterResolution {
  const stressDelta = STRESS_DELTA[action];
  state.shelterPlan = { day: state.day, action, resolved: true } satisfies ShelterPlan;
  appendDiaryEvent(state, makeDiaryEvent(state, {
    floor: STARTING_FLOOR,
    kind,
    actorIds: action === 'care' ? ['player', 'xiaozhou'] : ['player'],
    itemChanges,
    stressDelta,
    message,
  }));
  return { ok: true, action, message, events: [kind], itemChanges, stressDelta };
}

export function availableShelterActions(state: GameState): ShelterAction[] {
  if (state.status !== 'playing' || state.currentFloor !== STARTING_FLOOR || state.shelterPlan?.resolved) return [];
  return [...ACTIONS];
}

export function resolveShelterAction(state: GameState, action: ShelterAction): ShelterResolution {
  const blocked = readyForShelter(state, action);
  if (blocked) return blocked;

  if (action === 'rest') {
    return resolveSuccess(state, action, 'shelter_rested', '你把门关好，先让身体恢复一点。', []);
  }

  if (action === 'treat') {
    const hasWound = hasAilment(state, 'wound');
    const canHeal = state.player.hp < GAME_CONFIG.player.hpMax;
    if (!hasWound && !canHeal) return failure(action, '现在没有需要处理的伤势');
    if (countItem(state.player.inventory, 'medkit') < 1) return failure(action, '没有医疗包，今晚只能硬撑');
    removeItem(state.player.inventory, 'medkit', 1);
    const healed = applyCure(state, 'medkit');
    state.player.hp = Math.min(GAME_CONFIG.player.hpMax, state.player.hp + 40);
    return resolveSuccess(state, action, 'shelter_treated', healed.length > 0 ? '你用医疗包处理了伤口。' : '你用医疗包处理了身体状况。', [
      { itemId: 'medkit', quantity: -1 },
    ]);
  }

  if (action === 'repair') {
    const result = craft(state, 'reinforced_door');
    if (!result.ok) return failure(action, result.reason);
    return resolveSuccess(state, action, 'shelter_repaired', '你把宿舍门重新加固，夜里少了一处漏风口。', [
      { itemId: 'wood', quantity: -2 },
      { itemId: 'tape', quantity: -1 },
    ]);
  }

  if (countItem(state.player.inventory, 'ration_pack') < 1) return failure(action, '没有多余口粮可以照顾邻居');
  removeItem(state.player.inventory, 'ration_pack', 1);
  return resolveSuccess(state, action, 'neighbor_cared', '你把一份口粮分给小周，屋里安静了一点。', [
    { itemId: 'ration_pack', quantity: -1 },
  ]);
}

export function finishNight(state: GameState): NightResolution {
  const plan = state.shelterPlan;
  if (!plan?.resolved) {
    return {
      ok: false,
      hpLost: 0,
      stressDelta: 0,
      healedAilments: [],
      events: [],
      attacked: false,
      attackDamage: 0,
      reason: '今晚还没有安排 shelter 行动',
    };
  }
  const settledDay = state.day;
  const hpBefore = state.player.hp;
  const stressBefore = state.player.stress ?? 20;
  const result = sleep(state);
  if (!result.ok) {
    return {
      ok: false,
      hpLost: 0,
      stressDelta: 0,
      healedAilments: [],
      events: [],
      attacked: false,
      attackDamage: 0,
      reason: result.reason,
    };
  }

  if (state.player.hp <= 0) state.status = 'lost';
  const healedAilments = plan.action === 'rest'
    ? (state.player.ailments ?? []).filter((ailment) => AILMENTS[ailment.id].curedBy === 'sleep').map((ailment) => ailment.id)
    : [];
  for (const id of healedAilments) cure(state, id);
  const attacked = state.status === 'playing' && shouldShelterBeAttacked(state.runSeed, settledDay, plan.action);
  const attackDamage = attacked ? Math.min(SHELTER_ATTACK_DAMAGE, state.player.hp) : 0;
  if (attacked) {
    state.player.hp = Math.max(0, state.player.hp - SHELTER_ATTACK_DAMAGE);
    appendDiaryEvent(state, makeDiaryEvent(state, {
      floor: STARTING_FLOOR,
      kind: 'shelter_attacked',
      actorIds: ['player'],
      itemChanges: [],
      stressDelta: 10,
      message: '夜里有人撞门；你庆幸自己还来得及醒来。',
    }));
    if (state.player.hp <= 0) state.status = 'lost';
  }
  state.shelterPlan = undefined;
  return {
    ok: true,
    nextDay: state.day,
    hpLost: Math.max(0, hpBefore - state.player.hp),
    stressDelta: (state.player.stress ?? 20) - stressBefore,
    healedAilments,
    events: [`shelter_${plan.action}`, ...(attacked ? ['shelter_attacked'] : [])],
    attacked,
    attackDamage,
  };
}
