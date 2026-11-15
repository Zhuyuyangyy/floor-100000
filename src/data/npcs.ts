import type { ItemId } from '../core/gameTypes';
import type { NpcArchetype, ReputationTier, ScheduleSlot } from '../ai/types';

// The two v0.1 neighbours on floor 2 (docs/01_GDD.md §9). No LLM — fixed,
// keyboard-navigable option trees with two distinct personality lines each.
export type NpcId = 'alin' | 'xiaozhou' | 'recruiter' | 'blackmarket' | 'lab_clerk' | 'banquet_staff' | 'core_terminal';

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
  /**
   * 所在楼层（AG-13）。缺省 NPC_FLOOR（2）：两位老邻居的兜底，
   * 首章五位新发布者显式写在 10 / 110 / 1010 / 10010 / 100000 层。
   * 场景按 npcsOnFloor(floor) 取当层实体，不要假设全表都在 2 层。
   */
  floor?: number;
  /**
   * 人格原型（AG-13）。缺省走 npcInventory.archetypeOf 的既有映射
   * （alin=ally、xiaozhou=neutral、其余 neutral）。lab_clerk 是
   * STORY.md §5 的「ALLY→视分支」，显式标出来，免得被兜底成 neutral。
   */
  archetype?: NpcArchetype;
  /**
   * 是否已激活（AG-13）。false = 数据就绪但游戏里还不该出现：
   * core_terminal 守在 100000 层，该段未做（DEV_TEST_FLOORS 之外），
   * 场景接线时跳过 active !== true 的实体。
   */
  active?: boolean;
  /** 该 NPC 发布的首章任务 id（quests.ts 的 Quest.id；纯数据，不 import）。 */
  quests?: string[];
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

/** 该 NPC 所在楼层（缺省 2 层，老邻居的兜底）。 */
export function npcFloor(npc: NpcDef): number {
  return npc.floor ?? NPC_FLOOR;
}

/** 该 NPC 是否已激活（缺省激活；core_terminal 显式关闭）。 */
export function isNpcActive(npc: NpcDef): boolean {
  return npc.active !== false;
}

/** 某楼层上已激活的 NPC 实体（场景/遭遇系统按层取用，别再假设全表在 2 层）。 */
export function npcsOnFloor(floor: number): NpcDef[] {
  return NPCS.filter((n) => isNpcActive(n) && npcFloor(n) === floor);
}

export const NPCS: NpcDef[] = [
  {
    id: 'alin',
    name: '阿林',
    title: '维修工',
    floor: NPC_FLOOR,
    x: 480,
    greetings: ['来了？先别站门口，帮我扶一下梯子。', '你手上这茧——干过活的。哪层的？'],
    asks: ['电线和保险丝，四层配电房的电箱里还有剩。', '废金属换电线，电池换保险丝。我这儿不赊。'],
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
    // 不写 neutral：中性时的兜底句归 npcEconomy.attitudeLine（测试钉住了这条兜底）。
    attitudeLines: {
      trusted: '老主顾。维修件我给你压在工具箱底下。',
      disliked: '上回那笔我没忘。价钱得加。',
      hostile: '别碰我的工具箱。',
    },
  },
  {
    id: 'xiaozhou',
    name: '小周',
    title: '邻居',
    floor: NPC_FLOOR,
    x: 800,
    greetings: ['你来得巧，我刚把面包数完第二遍。', '别站着。……你手上那袋是什么？'],
    asks: ['五层食堂有热食，三层储物间的箱子还没锁。', '一个面包换一份口粮，净水换脏水，我不占你便宜。'],
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
      trusted: '你的那份我另搁着。别吭声。',
      neutral: '换就换。不换我收摊。',
      disliked: '你手头紧？我这更紧。',
      hostile: '门在那边。面包不卖你。',
    },
  },
  // ── 首章五位发布者（AG-13，docs/plans/STORY.md §5 对话稿）──────────────
  //
  // 都是「纯数据」实体：人格原型、楼层、日程锚点、库存（报价表推导）、
  // 台词。不 import Phaser，不进场景层；场景按 npcsOnFloor(floor) 取用。
  // 对话稿里的任务选项树（forge/slipped-shift…）归任务接线层，这里只放
  // 交易与问候用的短句（受对话面板两行 308px 的版面约束，见
  // dialogueLayout.test.ts 对全部 NPCS 台词的最长行断言）。
  //
  // 坐标说明：x 是楼层内像素坐标。五位新发布者的静态 x 都刻意避开
  // [130, 1150] 区间——encounterSpots 的占位测试把所有 NPCS 的 x 都算进
  // 2 层的 taken 列表（GameScene.ts:948 同款逻辑），靠边的 x 不会挤占
  // 2 层遭遇点的采样窗口 [260, 1020]。
  {
    // 阶层 2（100–110）的守门人：Q2「工牌与脸」的发布者，守在 10 层货梯口。
    id: 'recruiter',
    name: '招工员',
    title: '招工处',
    floor: 10,
    archetype: 'neutral',
    quests: ['work-badge'],
    x: 120,
    greetings: ['姓名、楼层、去处。三个空，填。', '你站在这儿，就是来填表的。说吧。'],
    asks: ['工牌交回，才算走完流程。墙上那块没交。', '废金属换布料，木头换胶带。数量看牌子。'],
    offers: [
      { id: 'recruiter_cloth', give: { itemId: 'cloth', quantity: 1 }, get: { itemId: 'scrap_metal', quantity: 2 } },
      { id: 'recruiter_tape', give: { itemId: 'tape', quantity: 1 }, get: { itemId: 'wood', quantity: 2 } },
    ],
    schedule: [
      { from: 360, to: 600, label: '筛简历', x: 300, goal: '筛第七批简历，把名字报上去' },
      { from: 600, to: 780, label: '点名', x: 700, goal: '在货梯口点名，认脸不认牌子' },
      { from: 780, to: 900, label: '吃饭', x: 1000, goal: '去食堂扒两口，下午还得看门' },
      { from: 900, to: 1080, label: '守货梯', x: 500, goal: '守住十层货梯，问清每个人要去哪层' },
      { from: 1080, to: 1230, label: '对工牌', x: 850, goal: '核对今天收上来的工牌，缺谁的心里有数' },
      { from: 1230, to: 360, label: '睡觉', x: 250, goal: '回宿舍睡觉，明天继续认脸' },
    ],
    attitudeLines: {
      trusted: '你的表我压在最上面。',
      neutral: '按章程办。下一位。',
      disliked: '你的名字我划掉过一次。',
      hostile: '保安。带他下楼。',
    },
  },
  {
    // 阶层 3（1000–1010）：Q3「通行贴」的发布者，110 层的黑市摊主。
    id: 'blackmarket',
    name: '黑市贩子',
    title: '流动摊主',
    floor: 110,
    archetype: 'neutral',
    quests: ['pass-sticker'],
    x: 1180,
    greetings: ['看看？看不收钱，摸要收。', '军队守门，我守门缝。你走哪边？'],
    asks: ['三号货梯别开。里面的东西不认人。', '废金属两块换电池两块。脏水三桶换滤芯。'],
    offers: [
      { id: 'blackmarket_battery', give: { itemId: 'battery', quantity: 2 }, get: { itemId: 'scrap_metal', quantity: 2 } },
      { id: 'blackmarket_filter', give: { itemId: 'filter', quantity: 1 }, get: { itemId: 'dirty_water', quantity: 3 } },
    ],
    // 每天自己烧掉 1 块电池（验货要通电）：他的电池储备真的会见底。
    needs: [{ itemId: 'battery', perDay: 1 }],
    schedule: [
      { from: 360, to: 600, label: '理货', x: 400, goal: '理货，把货色分门别类摆好' },
      { from: 600, to: 780, label: '盯岗亭', x: 900, goal: '盯岗亭的换班，算今天的进场时机' },
      { from: 780, to: 900, label: '吃饭', x: 1050, goal: '去食堂吃点，顺便打听楼上的价' },
      { from: 900, to: 1080, label: '开摊', x: 600, goal: '开摊做生意，电池换滤芯，脏水也收' },
      { from: 1080, to: 1230, label: '走货', x: 1100, goal: '趁天黑前走最后一趟货' },
      { from: 1230, to: 360, label: '睡觉', x: 250, goal: '收摊睡觉，防着半夜查账' },
    ],
    attitudeLines: {
      trusted: '给你实价。别跟人说。',
      neutral: '看货，给价。不赊账。',
      disliked: '你的钱我不接。',
      hostile: '走。别让我喊人。',
    },
  },
  {
    // 阶层 4（10000–10010）：Q4「许可证」的发布者，1010 层门禁室的文员。
    // STORY.md §5 标注「ALLY→视分支」：开局站玩家这边， archetype 显式 ally。
    id: 'lab_clerk',
    name: '实验室文员',
    title: '门禁室',
    floor: 1010,
    archetype: 'ally',
    quests: ['permit'],
    x: 110,
    greetings: ['证件。——哦，是你。等一下。', '箱子又送走六个。……你要办什么？'],
    asks: ['许可证三种：买的、签的、攥着别人短处的。', '电池两块换一个医疗包。实验室只认这个。'],
    offers: [
      { id: 'lab_medkit', give: { itemId: 'medkit', quantity: 1 }, get: { itemId: 'battery', quantity: 2 } },
      { id: 'lab_filter', give: { itemId: 'filter', quantity: 1 }, get: { itemId: 'ration_pack', quantity: 2 } },
    ],
    schedule: [
      { from: 360, to: 600, label: '登记', x: 350, goal: '登记进出实验室的人，一个都不漏' },
      { from: 600, to: 780, label: '整理名单', x: 800, goal: '整理志愿者名单，笔迹越签越乱' },
      { from: 780, to: 900, label: '吃饭', x: 1000, goal: '去食堂吃点，名单的事不敢多想' },
      { from: 900, to: 1080, label: '守门禁', x: 500, goal: '守在门禁室，许可证三种拿法' },
      { from: 1080, to: 1230, label: '校对记录', x: 700, goal: '校对今天的进出记录，该忘的记，该记的忘' },
      { from: 1230, to: 360, label: '睡觉', x: 250, goal: '回宿舍睡觉，名单在脑子里转' },
    ],
    attitudeLines: {
      trusted: '你的名字我不往上抄。',
      neutral: '表格填完，放这儿。',
      disliked: '你的记录我调出来看过。',
      hostile: '门禁不会为你开第二次。',
    },
  },
  {
    // 阶层 5（50000–50010）：Q5「贵宾卡」+ SQ2「盛宴之夜」的发布者。
    // Q5 锚在 10010 层货梯闸，SQ2 当晚在 50000 层；home 取 Q5 锚点。
    id: 'banquet_staff',
    name: '宴席侍者',
    title: '宴会厅',
    floor: 10010,
    archetype: 'neutral',
    quests: ['vip-card', 'feast-ledger'],
    x: 1155,
    greetings: ['欢迎。贵宾卡只认体面，您是哪一种？', '您的手，先给我看一下。今晚有位置。'],
    asks: ['口粮两份换电池两块。面包两份换一块。', '账本锁在清点室。想让它开口，得先有电。'],
    offers: [
      { id: 'banquet_ration', give: { itemId: 'ration_pack', quantity: 2 }, get: { itemId: 'battery', quantity: 2 } },
      { id: 'banquet_bread', give: { itemId: 'bread', quantity: 2 }, get: { itemId: 'battery', quantity: 1 } },
    ],
    // 每天从后厨吃掉 1 份口粮：盛宴的备货真的有压力。
    needs: [{ itemId: 'ration_pack', perDay: 1 }],
    schedule: [
      { from: 360, to: 600, label: '布场', x: 400, goal: '布宴会厅，银器要擦得见人影' },
      { from: 600, to: 780, label: '迎客', x: 900, goal: '在货梯闸迎客，认卡也认人' },
      { from: 780, to: 900, label: '用餐', x: 1050, goal: '吃员工餐，尝尝今晚的菜单' },
      { from: 900, to: 1080, label: '侍餐', x: 600, goal: '侍餐，看好每一桌的酒杯' },
      { from: 1080, to: 1230, label: '清点', x: 1100, goal: '清点餐具和账本，准备盛宴之夜' },
      { from: 1230, to: 360, label: '睡觉', x: 250, goal: '回宿舍睡觉，明晚还有一场盛宴' },
    ],
    attitudeLines: {
      trusted: '您的位置一直留着。',
      neutral: '请慢用。银器不必碰。',
      disliked: '侍者记得每一张脸。',
      hostile: '请回。这里不欢迎您。',
    },
  },
  {
    // 阶层 6（100000）：Q6「同一支笔」的发布者。该段还没做
    // （playableFloorsV01 只到 50010，100000 是 DEV_TEST_FLOORS），
    // 所以 active: false——数据就绪，场景接线时跳过，等终局段落地。
    id: 'core_terminal',
    name: '核心终端',
    title: '统治核心',
    floor: 100000,
    archetype: 'neutral',
    active: false,
    quests: ['same-pen'],
    x: 1165,
    greetings: ['校验失败：你不在名单上。是否继续？', '权限已移交。现在，你是操作员。'],
    asks: ['电池两块换保险丝两根。库存：充足。', '停电表、配给表、处决名单，同一支笔。'],
    offers: [
      { id: 'core_terminal_fuse', give: { itemId: 'fuse', quantity: 2 }, get: { itemId: 'battery', quantity: 2 } },
      { id: 'core_terminal_flashlight', give: { itemId: 'flashlight', quantity: 1 }, get: { itemId: 'battery', quantity: 1 } },
    ],
    // 终端不睡觉：两格日程覆盖全天（末格跨午夜回绕，与既有居民的
    // schedule 首尾相接约定一致——npcBehavior 数据完整性测试钉死了它）。
    schedule: [
      { from: 360, to: 1230, label: '运行', x: 1165, goal: '系统运行中，等候指令' },
      { from: 1230, to: 360, label: '自检', x: 1165, goal: '夜间自检，权限列表滚动' },
    ],
    attitudeLines: {
      trusted: '权限确认。指令待输入。',
      neutral: '等待指令。',
      disliked: '访问记录已标记。',
      hostile: '访问拒绝。原因：不适用。',
    },
  },
];

export function getNpc(id: NpcId): NpcDef {
  const npc = NPCS.find((n) => n.id === id);
  if (!npc) throw new Error(`unknown npc: ${id}`);
  return npc;
}
