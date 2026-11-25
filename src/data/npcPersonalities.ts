// 第一阶段三个人格原型（RFC §6）。人格是静态配置 + 动态关系的组合：
// traits 决定「倾向」，relationship/memory 决定「遭遇」，两者共同进 prompt。
//
// 映射现有角色：阿林=ALLY，小周=NEUTRAL，流浪者=HOSTILE。流浪者目前是
// 夜间事件而非 data/npcs.ts 里的居民，本文件先给它的 AI 侧配置，
// 接入场景时再与现有 wanderer 事件对齐。

import type { NpcArchetype, NpcPersistedState, PersonalityTraits } from '../ai/types';

export interface ArchetypeDef {
  archetype: NpcArchetype;
  /** 对应 data/npcs.ts 的居民 id；wanderer 暂缺，预留 */
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

/** 该原型允许 NPC 发起的行动种类（供 observation.availableActions）。 */
export const ARCHETYPE_ACTIONS: Record<NpcArchetype, Array<'dialogue' | 'trade' | 'gift' | 'refuse' | 'attack' | 'flee'>> = {
  ally: ['dialogue', 'trade', 'gift', 'refuse'],
  neutral: ['dialogue', 'trade', 'refuse'],
  hostile: ['dialogue', 'attack', 'flee'],
};
