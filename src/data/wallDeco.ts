// The eight wall fixtures from 废土风工业壁挂装饰精灵图表.png, sliced 1:1 out of
// the 1536x1024 sheet (magenta keyed, bbox cropped) and shipped as-is.
//
// Why they are a browsable archive instead of wall dressing: the fixtures are
// 255-335px wide, and the in-room wall band only ever has 16-26px for a vent or
// an inspection plate. Scaling one down by 10 turns a riveted notice board into
// four grey pixels, so they were never going to work as dressing — the 2026-11-14
// audit said exactly that. At their native size they are the right size for a
// close-up, which is what this panel is.
//
// The copy is written as found objects, not as item text: each one is a thing
// somebody left behind on a floor nobody is supposed to still be living on.
export interface WallDeco {
  /** texture key, loaded by BootScene from DECO_FILES */
  key: string;
  name: string;
  /** what the player reads when they look at it */
  text: string;
  /** floors this fixture plausibly hangs on */
  floors: string;
}

export const WALL_DECO: readonly WallDeco[] = [
  {
    key: 'deco-1',
    name: '值班须知（残）',
    text: '第七条以下的字被人撕掉了，只剩四个还能认：不得离岗。\n纸角有五个钉孔，说明它被重新挂过五次。',
    floors: '1–110 层',
  },
  {
    key: 'deco-2',
    name: '挂钟',
    text: '停在 06:00。\n这栋楼里没有一只钟还在走，但每一只都停在能让人赶上早班的位置。',
    floors: '100–110 层',
  },
  {
    key: 'deco-3',
    name: '吊灯',
    text: '灯泡还是热的。\n底下那圈铁罩被熏黑了一半，说明它亮过很久——久到有人相信这层还会有下一个班次。',
    floors: '100–110 层',
  },
  {
    key: 'deco-4',
    name: '压力表',
    text: '指针压进了红区，玻璃上有一道旧裂纹。\n外面那根主管道随时会裂，而修它需要一张你还没有的通行贴。',
    floors: '1000–1010 层',
  },
  {
    key: 'deco-5',
    name: '工服挂架',
    text: '一件洗到发白的大衣，袖口补过三次，肘部还有一个没补完的洞。\n牌子上写着编号，名字那一栏是空的。',
    floors: '100–110 层',
  },
  {
    key: 'deco-6',
    name: '管道阀门',
    text: '红轮子上的漆被手磨掉了一圈，露出底下的铁。\n它被拧过很多次，最近一次应该在不久前——轴还是温的。',
    floors: '1000–1010 层',
  },
  {
    key: 'deco-7',
    name: '金属铭牌',
    text: '四角铆死，中间一行编号被人用硬物刮花了，只剩「1000—」。\n刮痕是横向的，从左往右，像是不想让别人读到自己是从哪来的。',
    floors: '1000–1010 层',
  },
  {
    key: 'deco-8',
    name: '粉笔计数',
    text: '四组半。一组五道，最后那组只划了三条。\n旁边有箭头指向楼梯口——写它的人想往上走，而且没走成。',
    floors: '1–10 层',
  },
];

export const DECO_COUNT = WALL_DECO.length;
