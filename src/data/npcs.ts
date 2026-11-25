import type { ItemId } from '../core/gameTypes';
import type { CharacterKey } from '../render/artpack';

// The building's residents (docs/01_GDD.md §9).
//
// v0.1 shipped two neighbours on floor 2, which read as a corridor with two
// shopkeepers in it rather than as a tower people still live in. The tower is
// "many people, one building": a caretaker, a cook, a porter's kid, an old
// neighbour. So the roster is now six, spread over the floors the player
// actually walks through, and the player meets a new face each floor instead of
// two at once and nobody afterwards.
//
// No LLM required for the dialogue trees: fixed, keyboard-navigable option
// trees with distinct lines per personality. The AI layer only replaces the
// opening line when a model is configured.
export type NpcId = 'alin' | 'xiaozhou' | 'laochen' | 'azhen' | 'daliu' | 'xiaoman';

// The neighbour-dorm floor. Kept as a named constant because the repair-door
// gate is anchored to it (data/floorGates.ts) and Alin lives there.
export const NPC_FLOOR = 2;

export interface BarterOffer {
  id: string;
  give: { itemId: ItemId; quantity: number }; // player receives
  get: { itemId: ItemId; quantity: number }; // player pays
}

export interface NpcDef {
  id: NpcId;
  name: string;
  title: string;
  /** Which floor the resident stands on. */
  floor: number;
  x: number;
  /**
   * The walk-sheet character this resident is drawn with. Residents added after
   * the art pack have no painted sheet — their cycles are baked from a palette
   * in render/walkcycle.ts — but the key still has to be a real CharacterKey so
   * walkSheetKey()/idleAnimKey() resolve.
   */
  sprite: CharacterKey;
  greetings: [string, string];
  asks: [string, string];
  offers: BarterOffer[];
}

// The roster, ordered by floor so the code reads like the building.
//
// Coordinates are checked by src/tests/npcRoster.test.ts against every other
// interactable on the same floor: two things within INTERACT_DISTANCE of each
// other hijack the E key, and a marker pushed onto an NPC is exactly the bug
// that broke the trade specs before.
export const NPCS: NpcDef[] = [
  {
    id: 'alin',
    name: '阿林',
    title: '维修工',
    floor: NPC_FLOOR,
    x: 480,
    sprite: 'npc_alin',
    greetings: ['线路又烧了……你身上有电池吗？', '这层楼的保险丝迟早要出问题。'],
    asks: ['电线和保险丝，去维修层(4)的电箱能稳定找到。', '我拿电线换废金属、保险丝换电池，公平吧？'],
    offers: [
      { id: 'alin_wire', give: { itemId: 'wire', quantity: 1 }, get: { itemId: 'scrap_metal', quantity: 1 } },
      { id: 'alin_fuse', give: { itemId: 'fuse', quantity: 1 }, get: { itemId: 'battery', quantity: 1 } },
    ],
  },
  {
    id: 'laochen',
    name: '老陈',
    title: '门房',
    floor: NPC_FLOOR,
    x: 320,
    sprite: 'npc_laochen',
    greetings: ['上楼的登记本早烧了，现在谁上来我都记不住。', '这栋楼住的人比你想的多，只是都不太出门。'],
    asks: ['想知道这楼的旧事，问我。我在这门口坐了十几年。', '有布料就给我一块，我补门上的缝。'],
    offers: [
      // 布换胶带：布只在储物层和食堂地上出现，没人给，是个纯汇点。
      { id: 'chen_tape', give: { itemId: 'tape', quantity: 1 }, get: { itemId: 'cloth', quantity: 1 } },
      { id: 'chen_battery', give: { itemId: 'battery', quantity: 1 }, get: { itemId: 'scrap_metal', quantity: 1 } },
    ],
  },
  {
    id: 'xiaozhou',
    name: '小周',
    title: '邻居',
    floor: NPC_FLOOR,
    x: 800,
    sprite: 'npc_xiaozhou',
    greetings: ['囤粮了吗？我这儿还有面包。', '别客气，拿东西换就行。'],
    asks: ['食堂(5)有吃的，储物层(3)有材料。', '我拿面包换口粮、净水换脏水，务实点。'],
    offers: [
      { id: 'zhou_bread', give: { itemId: 'bread', quantity: 1 }, get: { itemId: 'ration_pack', quantity: 1 } },
      { id: 'zhou_water', give: { itemId: 'clean_water', quantity: 1 }, get: { itemId: 'dirty_water', quantity: 1 } },
    ],
  },
  {
    id: 'daliu',
    name: '大刘',
    title: '搬运工',
    floor: NPC_FLOOR,
    x: 960,
    sprite: 'npc_daliu',
    greetings: ['别挡路，这几箱还要搬上五楼。', '你要木头？我这儿有，拿废金属来换。'],
    asks: ['三层那些木箱是我以前码的，现在没人管了。', '力气我出，材料你出，换得成就换。'],
    offers: [
      { id: 'liu_wood', give: { itemId: 'wood', quantity: 2 }, get: { itemId: 'scrap_metal', quantity: 1 } },
      // 滤芯换废金属。滤芯只在维修层电箱稳定出，是条不闭环的汇点。
      { id: 'liu_scrap', give: { itemId: 'scrap_metal', quantity: 2 }, get: { itemId: 'filter', quantity: 1 } },
    ],
  },
  {
    id: 'azhen',
    name: '阿珍',
    title: '食堂厨娘',
    floor: 5,
    x: 800,
    sprite: 'npc_azhen',
    greetings: ['灶还热着，别客气，坐下吃。', '食堂就我一个人撑着，来的人越来越少。'],
    asks: ['我这儿有热食，不过得拿东西换——这楼没白吃的饭。', '脏水给我，我给你热的。'],
    offers: [
      { id: 'zhen_bread', give: { itemId: 'bread', quantity: 2 }, get: { itemId: 'dirty_water', quantity: 2 } },
      { id: 'zhen_ration', give: { itemId: 'ration_pack', quantity: 1 }, get: { itemId: 'clean_water', quantity: 2 } },
    ],
  },
  {
    id: 'xiaoman',
    name: '小满',
    title: '半大孩子',
    floor: 3,
    x: 640,
    sprite: 'npc_xiaoman',
    greetings: ['叔叔，你见过楼下的灯亮过吗？', '我在这儿捡东西，你别抢。'],
    asks: ['三层我熟，木箱后面有东西，我够不着。', '我有手电，不过得换。你要不要？'],
    offers: [
      { id: 'man_flashlight', give: { itemId: 'flashlight', quantity: 1 }, get: { itemId: 'battery', quantity: 1 } },
      { id: 'man_tape', give: { itemId: 'tape', quantity: 1 }, get: { itemId: 'bread', quantity: 1 } },
    ],
  },
];

export function getNpc(id: NpcId): NpcDef {
  const npc = NPCS.find((n) => n.id === id);
  if (!npc) throw new Error(`unknown npc: ${id}`);
  return npc;
}

/** The residents standing on a floor. Empty on floors nobody lives on. */
export function npcsOnFloor(floor: number): NpcDef[] {
  return NPCS.filter((npc) => npc.floor === floor);
}