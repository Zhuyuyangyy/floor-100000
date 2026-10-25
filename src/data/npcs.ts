import type { ItemId } from '../core/gameTypes';

// The two v0.1 neighbours on floor 99999 (docs/01_GDD.md §9). No LLM — fixed,
// keyboard-navigable option trees with two distinct personality lines each.
export type NpcId = 'alin' | 'xiaozhou';

// Both neighbours live on the neighbour-dorm floor.
export const NPC_FLOOR = 99999;

export interface BarterOffer {
  id: string;
  give: { itemId: ItemId; quantity: number }; // player receives
  get: { itemId: ItemId; quantity: number }; // player pays
}

export interface NpcDef {
  id: NpcId;
  name: string;
  title: string;
  x: number;
  greetings: [string, string];
  asks: [string, string];
  offers: BarterOffer[];
}

export const NPCS: NpcDef[] = [
  {
    id: 'alin',
    name: '阿林',
    title: '维修工',
    x: 480,
    greetings: ['线路又烧了……你身上有电池吗？', '这层楼的保险丝迟早要出问题。'],
    asks: ['电线和保险丝，去维修层(99997)的电箱能稳定找到。', '我拿电线换废金属、保险丝换电池，公平吧？'],
    offers: [
      { id: 'alin_wire', give: { itemId: 'wire', quantity: 1 }, get: { itemId: 'scrap_metal', quantity: 1 } },
      { id: 'alin_fuse', give: { itemId: 'fuse', quantity: 1 }, get: { itemId: 'battery', quantity: 1 } },
    ],
  },
  {
    id: 'xiaozhou',
    name: '小周',
    title: '邻居',
    x: 800,
    greetings: ['囤粮了吗？我这儿还有面包。', '别客气，拿东西换就行。'],
    asks: ['食堂(99996)有吃的，储物层(99998)有材料。', '我拿面包换口粮、净水换脏水，务实点。'],
    offers: [
      { id: 'zhou_bread', give: { itemId: 'bread', quantity: 1 }, get: { itemId: 'ration_pack', quantity: 1 } },
      { id: 'zhou_water', give: { itemId: 'clean_water', quantity: 1 }, get: { itemId: 'dirty_water', quantity: 1 } },
    ],
  },
];

export function getNpc(id: NpcId): NpcDef {
  const npc = NPCS.find((n) => n.id === id);
  if (!npc) throw new Error(`unknown npc: ${id}`);
  return npc;
}
