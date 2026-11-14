import type { ItemId } from '../core/gameTypes';
import type { ReputationTier, ScheduleSlot } from '../ai/types';

// The two v0.1 neighbours on floor 2 (docs/01_GDD.md §9). No LLM — fixed,
// keyboard-navigable option trees with two distinct personality lines each.
export type NpcId = 'alin' | 'xiaozhou';

// Both neighbours live on the neighbour-dorm floor.
export const NPC_FLOOR = 2;

export interface BarterOffer {
  id: string;
  give: { itemId: ItemId; quantity: number }; // player receives
  get: { itemId: ItemId; quantity: number }; // player pays
}

/** NPC 的每日需求：从自家库存里消耗掉，驱动补货压力与「寻找」目标。 */
export interface NpcNeed {
  itemId: ItemId;
  /** 每日消耗量 */
  perDay: number;
}

export interface NpcDef {
  id: NpcId;
  name: string;
  title: string;
  x: number;
  greetings: [string, string];
  asks: [string, string];
  offers: BarterOffer[];
  /** 每日需求消耗（缺省无）。小周每天吃掉自家 1 个面包，库存因此真的有压力。 */
  needs?: NpcNeed[];
  /** 自主日程（按游戏分钟排布，覆盖全天）。缺省用单格全天日程。 */
  schedule?: ScheduleSlot[];
  /** 信誉分层的确定性台词。AI 关闭或降级时由 npcEconomy.attitudeLine 选用。 */
  attitudeLines?: Partial<Record<ReputationTier, string>>;
}

export const NPCS: NpcDef[] = [
  {
    id: 'alin',
    name: '阿林',
    title: '维修工',
    x: 480,
    greetings: ['线路又烧了……你身上有电池吗？', '这层楼的保险丝迟早要出问题。'],
    asks: ['电线和保险丝，去维修层(4)的电箱能稳定找到。', '我拿电线换废金属、保险丝换电池，公平吧？'],
    offers: [
      { id: 'alin_wire', give: { itemId: 'wire', quantity: 1 }, get: { itemId: 'scrap_metal', quantity: 1 } },
      { id: 'alin_fuse', give: { itemId: 'fuse', quantity: 1 }, get: { itemId: 'battery', quantity: 1 } },
    ],
    // 维修件每天被线路消耗掉一根——库存真的有压力，补货才有意义。
    needs: [{ itemId: 'fuse', perDay: 1 }],
    schedule: [
      { from: 360, to: 540, label: '巡查线路', x: 220, goal: '巡查这层楼的线路，别让它再烧' },
      { from: 540, to: 720, label: '清点工具', x: 460, goal: '清点维修件，看看保险丝还够不够' },
      { from: 720, to: 840, label: '吃午饭', x: 760, goal: '去食堂扒两口，下午还得修线路' },
      { from: 840, to: 1080, label: '维修线路', x: 460, goal: '守住这层楼的线路，换到维修材料' },
      { from: 1080, to: 1230, label: '和人闲聊', x: 980, goal: '和人换换情报，打听哪层有维修件' },
      { from: 1230, to: 360, label: '睡觉', x: 300, goal: '回宿舍睡觉，养足精神修线路' },
    ],
    attitudeLines: {
      trusted: '老主顾，维修件我给你留着。',
      disliked: '你上次那事我没忘——得加价。',
      hostile: '别靠近我。线路不伺候你。',
    },
  },
  {
    id: 'xiaozhou',
    name: '小周',
    title: '邻居',
    x: 800,
    greetings: ['囤粮了吗？我这儿还有面包。', '别客气，拿东西换就行。'],
    asks: ['食堂(5)有吃的，储物层(3)有材料。', '我拿面包换口粮、净水换脏水，务实点。'],
    offers: [
      { id: 'zhou_bread', give: { itemId: 'bread', quantity: 1 }, get: { itemId: 'ration_pack', quantity: 1 } },
      { id: 'zhou_water', give: { itemId: 'clean_water', quantity: 1 }, get: { itemId: 'dirty_water', quantity: 1 } },
    ],
    // 每天从自家库存吃掉 1 个面包：他的面包储备真的会见底。
    needs: [{ itemId: 'bread', perDay: 1 }],
    schedule: [
      { from: 360, to: 600, label: '张望天气', x: 560, goal: '看看天色，估算今天去哪层 scavenge' },
      { from: 600, to: 780, label: '整理囤货', x: 800, goal: '整理囤货，口粮和净水还够几天' },
      { from: 780, to: 900, label: '吃饭', x: 1020, goal: '去食堂吃点东西，空出肚子换物资' },
      { from: 900, to: 1080, label: '清点口粮', x: 800, goal: '换到口粮和净水，安稳过天' },
      { from: 1080, to: 1230, label: '串门', x: 640, goal: '去公共区串门，和邻居换情报' },
      { from: 1230, to: 360, label: '睡觉', x: 420, goal: '回宿舍睡觉，明天继续换物资' },
    ],
    attitudeLines: {
      trusted: '冲你，这次算便宜点。',
      disliked: '现在手头紧，得加价。',
      hostile: '没什么好换的，走吧。',
    },
  },
];

export function getNpc(id: NpcId): NpcDef {
  const npc = NPCS.find((n) => n.id === id);
  if (!npc) throw new Error(`unknown npc: ${id}`);
  return npc;
}
