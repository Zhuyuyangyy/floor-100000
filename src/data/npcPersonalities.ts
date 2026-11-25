// 第一阶段三个人格原型（RFC §6）。人格是静态配置 + 动态关系的组合：
// traits 决定「倾向」，relationship/memory 决定「遭遇」，两者共同进 prompt。
//
// 三个原型是**行为类别**，不是人。阿林=ALLY，小周=NEUTRAL，流浪者=HOSTILE。
// 楼上住户加进来以后，同一种原型要能装下好几个人——老陈和小满都算 neutral，
// 但老陈谨慎、小满贪玩，两个人不该长着同一张预设。所以原型给出**兜底**，
// 个体档（NPC_PROFILES）给出具体的人。查找顺序是：个体档 → 原型 → neutral。

import type { NpcArchetype, NpcPersistedState, PersonalityTraits } from '../ai/types';
import type { NpcId } from './npcs';

export interface ArchetypeDef {
  archetype: NpcArchetype;
  /** 该原型给谁当兜底；仅用于展示与 archetypeForNpcId 的旧路径 */
  npcId: string;
  displayName: string;
  traits: PersonalityTraits;
  /** 初始目标（纯文本，进 prompt） */
  goal: string;
  /** 该原型的记忆条目上限；敌对型记得更久，伺机报复 */
  memoryLimit: number;
}

export const ARCHETYPES: Record<NpcArchetype, ArchetypeDef> = {
  ally: {
    archetype: 'ally',
    npcId: 'alin',
    displayName: '阿林',
    // 高利他 + 记恩：玩家的帮助会被放大回报
    traits: { altruism: 0.8, pragmatism: 0.3, aggression: 0.05, loyalty: 0.7, caution: 0.4 },
    goal: '守住这层楼的线路，换到维修材料',
    memoryLimit: 24,
  },
  neutral: {
    archetype: 'neutral',
    npcId: 'xiaozhou',
    displayName: '小周',
    // 务实计算：关系跟着利益走，不主动结盟也不主动为敌
    traits: { altruism: 0.4, pragmatism: 0.8, aggression: 0.2, loyalty: 0.3, caution: 0.6 },
    goal: '换到口粮和净水，安稳过天',
    memoryLimit: 16,
  },
  hostile: {
    archetype: 'hostile',
    npcId: 'wanderer',
    displayName: '流浪者',
    // 高攻击 + 低利他：夜间窗口的威胁源
    traits: { altruism: 0.0, pragmatism: 0.5, aggression: 0.9, loyalty: 0.2, caution: 0.5 },
    goal: '夜间觅食，驱逐闯入者',
    memoryLimit: 32,
  },
};

/**
 * 个体档：一个居民自己的性格、目标与记忆容量。
 *
 * 存在的理由很具体——`ARCHETYPES` 是 `Record<NpcArchetype, ArchetypeDef>`，
 * 每种原型只能挂一个 npcId。楼里住了六个人以后，这个结构会让老陈、小周、
 * 大刘、阿珍、小满全部落到同一个 neutral 兜底上，五个人说出同一句话。
 *
 * 所以原型只决定「能不能打、能不能换」，个体决定「他是谁」。
 */
export interface NpcProfile {
  archetype: NpcArchetype;
  traits: PersonalityTraits;
  goal: string;
  memoryLimit: number;
}

export const NPC_PROFILES: Record<NpcId, NpcProfile> = {
  alin: {
    archetype: 'ally',
    traits: { altruism: 0.8, pragmatism: 0.3, aggression: 0.05, loyalty: 0.7, caution: 0.4 },
    goal: '守住这层楼的线路，换到维修材料',
    memoryLimit: 24,
  },
  xiaozhou: {
    archetype: 'neutral',
    traits: { altruism: 0.4, pragmatism: 0.8, aggression: 0.2, loyalty: 0.3, caution: 0.6 },
    goal: '换到口粮和净水，安稳过天',
    memoryLimit: 16,
  },
  // 老陈在这栋楼坐了十几年，见过太多人上来又没下来：极度谨慎、不轻信、
  // 但一旦认了人就记得住。他的价值是「信息」，不是货。
  laochen: {
    archetype: 'neutral',
    traits: { altruism: 0.55, pragmatism: 0.5, aggression: 0.0, loyalty: 0.65, caution: 0.85 },
    goal: '守住楼门，把还能住人的楼层记下来',
    memoryLimit: 28,
  },
  // 大刘靠力气换东西，直来直去，不吃亏也不占便宜。
  daliu: {
    archetype: 'neutral',
    traits: { altruism: 0.35, pragmatism: 0.75, aggression: 0.35, loyalty: 0.45, caution: 0.4 },
    goal: '把剩下的货搬完，换够吃的',
    memoryLimit: 16,
  },
  // 阿珍是这楼里唯一还在「做饭」的人：利他最高，攻击为零，靠照顾别人
  // 维持自己还算个人的感觉。
  azhen: {
    archetype: 'ally',
    traits: { altruism: 0.85, pragmatism: 0.45, aggression: 0.0, loyalty: 0.6, caution: 0.5 },
    goal: '让食堂的灶别熄，来的人都有口热的',
    memoryLimit: 26,
  },
  // 小满还是个孩子：好奇压过谨慎，容易被哄，也容易记仇。
  xiaoman: {
    archetype: 'neutral',
    traits: { altruism: 0.5, pragmatism: 0.3, aggression: 0.1, loyalty: 0.5, caution: 0.25 },
    goal: '在三层捡够东西，等家里人回来',
    memoryLimit: 12,
  },
};

/** 新建一个 NPC 的持久状态（首次遇到时调用，之后从存档恢复）。 */
export function createNpcState(archetype: NpcArchetype): NpcPersistedState {
  const def = ARCHETYPES[archetype];
  return {
    archetype,
    traits: { ...def.traits },
    goal: def.goal,
    relationship: {},
    memory: [],
    mood: 0,
  };
}

/**
 * 按具体居民建状态。没有个体档时退回原型兜底，所以新增居民不会崩。
 *
 * 与 createNpcState() 的差别只有「从谁身上取 traits/goal」——原型是三个人，
 * 居民是六个人，楼里不该有两个性格一模一样的人。
 */
export function createNpcStateFor(npcId: NpcId): NpcPersistedState {
  const profile = NPC_PROFILES[npcId];
  if (!profile) return createNpcState('neutral');
  return {
    archetype: profile.archetype,
    traits: { ...profile.traits },
    goal: profile.goal,
    relationship: {},
    memory: [],
    mood: 0,
  };
}

/** 该原型允许 NPC 发起的行动种类（供 observation.availableActions）。 */
export const ARCHETYPE_ACTIONS: Record<NpcArchetype, Array<'dialogue' | 'trade' | 'gift' | 'refuse' | 'attack' | 'flee'>> = {
  ally: ['dialogue', 'trade', 'gift', 'refuse'],
  neutral: ['dialogue', 'trade', 'refuse'],
  hostile: ['dialogue', 'attack', 'flee'],
};