// AG-71 NavBarController 单测（RC-03 拆分第 6 步的「测试镜像」）。
// 设计文档 §5：控制器单测从场景测试里抽，记录型假件模式（参考
// monologueController.test.ts / achievementController.test.ts 路数）。纯几何
// 契约（六槽铺满画布/板顶 672/线盒余量）由 hudNav.test.ts 5 例守着；e2e
// （ag71-hud-nav.spec.ts 等）守着真场景里的具名对象与三视口；这里守的是
// **控制器接线**——设计文档「先冻结 contextual 钩子行为」的测试镜像：
//   · contextual 文案优先级链的五种状态（目标未完成/目标完成空窗 XP-2 指路/
//     行商靠近 R6-2 文案/NPC 靠近/战斗中）逐态冻结：同输入同文案、键帽只对
//     世界链「按 E ××」拆、面板链（战斗脚注）压过一切且整串显示；
//   · 六铆钉的显隐（build 六件、reset 全毁、重建不双份）与高亮链
//     （navSlotOwned 同口径，地图永不高亮）；
//   · 点击/键盘委托不断链：hitRect onClick 过两道守卫后直达
//     host.navSlotRun（与键盘路径同一个委托面）；
//   · 按值缓存：没变不碰对象（Text.setText 每帧调会重烤纹理）；
//   · 超宽截断委托：contextual 槽的 fitHudLine 截断面只有场景那一份，
//     缓存键留全串、显示串被截。
//
// 为什么能在 Node 下跑：控制器的 import 链无 Phaser 值导入（host 是结构面
// 假件；drawHudPlate/drawHudIcon/drawHazardStripe 只碰 Graphics 的
// fillStyle/fillRect/lineStyle/strokeRect/clear——假件全数桩掉；hitRect 的
// 第一参经 SharedHitScene 收窄，假件 add.rectangle 链式面桩掉）。

import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';

import { NavBarController, type NavBarHost, type NavSlotKey } from '../scenes/controllers/NavBarController';
import { NAV_BAR, navSlotX } from '../render/hudLayout';
import { estimateTextWidth } from '../render/dialogueLayout';
import { TYPE } from '../render/uiKit';

// ── 记录型假件 ─────────────────────────────────────────────────────────────

/** Graphics 零件：clear/fillStyle/fillRect/lineStyle/strokeRect 全数记录。 */
class FakeGraphics {
  readonly draws: string[] = [];
  destroyed = false;
  setScrollFactor(): this {
    return this;
  }
  setDepth(): this {
    return this;
  }
  clear(): this {
    this.draws.push('clear');
    return this;
  }
  fillStyle(): this {
    this.draws.push('fillStyle');
    return this;
  }
  fillRect(): this {
    this.draws.push('fillRect');
    return this;
  }
  fillCircle(): this {
    this.draws.push('fillCircle');
    return this;
  }
  fillPoints(): this {
    this.draws.push('fillPoints');
    return this;
  }
  lineStyle(): this {
    this.draws.push('lineStyle');
    return this;
  }
  strokeRect(): this {
    this.draws.push('strokeRect');
    return this;
  }
  strokeCircle(): this {
    this.draws.push('strokeCircle');
    return this;
  }
  strokePath(): this {
    this.draws.push('strokePath');
    return this;
  }
  beginPath(): this {
    this.draws.push('beginPath');
    return this;
  }
  arc(): this {
    this.draws.push('arc');
    return this;
  }
  destroy(): this {
    this.destroyed = true;
    return this;
  }
}

/** Text 零件：多记 text/color/visible/x 与一次 setText 的计数。 */
class FakeText {
  text: string;
  name = '';
  color = '';
  visible = true;
  x: number;
  y: number;
  depth = 0;
  destroyed = false;
  setTextCalls = 0;
  /** 假件度量：与 hudNav.test.ts 同款 estimateTextWidth（caption 20px，比
   *  实测略保守——最长面板串估 500 ≤ 槽宽 532，战斗脚注估 660 > 532）。 */
  get width(): number {
    return estimateTextWidth(this.text, TYPE.caption);
  }
  constructor(x: number, y: number, text: string) {
    this.x = x;
    this.y = y;
    this.text = text;
  }
  setOrigin(): this {
    return this;
  }
  setName(n: string): this {
    this.name = n;
    return this;
  }
  setScrollFactor(): this {
    return this;
  }
  setDepth(d: number): this {
    this.depth = d;
    return this;
  }
  setX(x: number): this {
    this.x = x;
    return this;
  }
  setVisible(v: boolean): this {
    this.visible = v;
    return this;
  }
  setText(t: string): this {
    this.text = t;
    this.setTextCalls += 1;
    return this;
  }
  setColor(c: string): this {
    this.color = c;
    return this;
  }
  destroy(): this {
    this.destroyed = true;
    this.visible = false;
    return this;
  }
}

/** hitRect 用的矩形：记下 pointerdown 处理器供点击模拟。 */
class FakeRect {
  name = '';
  destroyed = false;
  depth = 0;
  scrollFactor: [number, number] = [1, 1];
  private handlers: Record<string, (() => void)[]> = {};
  constructor(
    public x: number,
    public y: number,
    public w: number,
    public h: number,
  ) {}
  setOrigin(): this {
    return this;
  }
  setAlpha(): this {
    return this;
  }
  setScrollFactor(x: number, y?: number): this {
    this.scrollFactor = [x, y ?? x];
    return this;
  }
  setDepth(d: number): this {
    this.depth = d;
    return this;
  }
  setInteractive(): this {
    return this;
  }
  on(event: string, fn: () => void): this {
    (this.handlers[event] ??= []).push(fn);
    return this;
  }
  /** 模拟一次 pointerdown（hitRect 的 onClick 语义入口）。 */
  click(): void {
    for (const fn of this.handlers.pointerdown ?? []) fn();
  }
  destroy(): this {
    this.destroyed = true;
    return this;
  }
}

class FakeHost {
  readonly rects: FakeRect[] = [];
  readonly graphics: FakeGraphics[] = [];
  readonly texts: FakeText[] = [];

  // contextual 三链数据源（假件按剧本摆）。
  panelHint: string | null = null;
  tutorialHint: string | null = null;
  worldHint = 'A/D 或 ←/→ 移动 · E 交互';
  // 固定槽 owned 判据与动作记录（委托链断没断看它）。
  owned = new Set<NavSlotKey>();
  readonly runLog: NavSlotKey[] = [];
  stairClimbingFlag = false;
  anyPanelOpenFlag = false;
  readonly fitCalls: Array<{ text: string; width: number }> = [];

  add = {
    rectangle: (x: number, y: number, _w: number, _h: number): FakeRect => {
      const r = new FakeRect(x, y, _w, _h);
      this.rects.push(r);
      return r;
    },
    graphics: (): FakeGraphics => {
      const g = new FakeGraphics();
      this.graphics.push(g);
      return g;
    },
    text: (x: number, y: number, str: string): FakeText => {
      const t = new FakeText(x, y, str);
      this.texts.push(t);
      return t;
    },
  } as unknown as Phaser.GameObjects.GameObjectFactory;

  // ── NavBarHost 结构面 ──
  openPanelHint(): string | null {
    return this.panelHint;
  }
  tutorialNavHint(): string | null {
    return this.tutorialHint;
  }
  worldHintText(): string {
    return this.worldHint;
  }
  navSlotOwned(key: NavSlotKey): boolean {
    return this.owned.has(key);
  }
  navSlotRun(key: NavSlotKey): void {
    this.runLog.push(key);
  }
  stairClimbing(): boolean {
    return this.stairClimbingFlag;
  }
  anyPanelOpen(): boolean {
    return this.anyPanelOpenFlag;
  }
  /** 场景 fitHudLine 的同款算法（假件度量下复刻：超宽逐字符 pop + '…'）。 */
  fitHudLine(text: Phaser.GameObjects.Text, width: number): void {
    this.fitCalls.push({ text: text.text, width });
    if (text.width <= width) return;
    const characters = Array.from(text.text);
    while (characters.length > 1 && text.width > width) {
      characters.pop();
      text.setText(`${characters.join('')}…`);
    }
  }

  asHost(): NavBarHost {
    return this as unknown as NavBarHost;
  }

  // ── 读数便件 ──
  textByName(n: string): FakeText | undefined {
    return this.texts.find((t) => t.name === n);
  }
  /** 仍活着的 hud-nav-* 对象（退场销毁的不计——场景重启双份检测用）。 */
  liveNavNames(): string[] {
    return this.texts.filter((t) => t.name.startsWith('hud-nav-') && !t.destroyed).map((t) => t.name).sort();
  }
  /** 五张 hitRect（板矩形之外的 interactive 件，按 x 排序即槽序；销毁不计）。 */
  hitRects(): FakeRect[] {
    return this.rects.filter((r) => r.depth === 105 && !r.destroyed).sort((a, b) => a.x - b.x);
  }
}

const COLOR_DIM = '#a8a49a'; // TEXT.secondary
const COLOR_HIGHLIGHT = '#a8e0c8'; // TEXT.highlight

const SLOT_LABELS: Array<[NavSlotKey, string]> = [
  ['bag', '背包 I'],
  ['craft', '制作 C'],
  ['venture', '产业 G'],
  ['map', '地图 M'],
  ['menu', '菜单 Esc'],
];

/** 建控制器并跑首建（对位 create() → buildHud 尾部那一次）。 */
function boot(host: FakeHost): NavBarController {
  const c = new NavBarController(host.asHost());
  c.build();
  return c;
}

// 五种 contextual 状态的世界链/面板链输入（逐字冻结口径）：
const WORLD_DEFAULT = 'A/D 或 ←/→ 移动 · E 交互';
const IDLE_WINDOW = '目标已完成 · 与邻居交易或翻找物资，20:00 后可入睡';
const TRADER_HINT = '按 E 与行商交易';
const NPC_HINT = '按 E 对话';
const COMBAT_HINT = '当前武器：空手（伤害 4）· Enter 出招 · ↑/↓ 选择 · ESC 撤退';

describe('AG-71 NavBarController（RC-03 拆分第 6 步）', () => {
  it('build：六槽常驻——五个固定槽标签精确、contextual/键帽具名、五张 hitRect', () => {
    const host = new FakeHost();
    boot(host);

    // 五个固定槽：e2e 按 hud-nav-${key} 断言的标签对象，逐个精确。
    for (const [key, label] of SLOT_LABELS) {
      const t = host.textByName(`hud-nav-${key}`);
      expect(t, `slot ${key} missing`).toBeTruthy();
      expect(t!.text).toBe(label);
      expect(t!.visible).toBe(true);
      expect(t!.color).toBe(COLOR_DIM); // 无面板开着：全部 dim
      // 图标+标签作为一组在槽内居中：整组落在自己槽里。
      expect(t!.x).toBeGreaterThanOrEqual(navSlotX(SLOT_LABELS.findIndex(([k]) => k === key)));
      expect(t!.x + t!.width).toBeLessThanOrEqual(
        navSlotX(SLOT_LABELS.findIndex(([k]) => k === key)) + NAV_BAR.slotW,
      );
    }
    // contextual 文本与键帽：具名（e2e 契约），键帽默认不亮。
    const context = host.textByName('hud-nav-context');
    expect(context).toBeTruthy();
    expect(context!.text).toBe(WORLD_DEFAULT); // build 尾部一次 refresh 已落定
    const keycap = host.textByName('hud-nav-key');
    expect(keycap).toBeTruthy();
    expect(keycap!.visible).toBe(false);
    // 五张 hitRect：深度 105（压在板/文本之上），x 即槽序。
    const hits = host.hitRects();
    expect(hits).toHaveLength(5);
    for (let i = 0; i < 5; i++) expect(hits[i].x).toBe(navSlotX(i));
    // 静态板 + 状态层两张 Graphics。
    expect(host.graphics).toHaveLength(2);
  });

  it('contextual 状态 1：目标未完成——世界默认脚注整串显示，不画键帽', () => {
    const host = new FakeHost();
    const c = boot(host);
    host.worldHint = WORLD_DEFAULT;
    c.refresh();

    expect(host.textByName('hud-nav-context')!.text).toBe(WORLD_DEFAULT);
    expect(host.textByName('hud-nav-key')!.visible).toBe(false);
    expect(c.lastStateKey).toBe('|'); // 无激活槽、无键帽
    expect(c.lastContextShown).toBe(WORLD_DEFAULT);
    // 截断面委托照常发生（控制器不改写就调），但默认脚注不超宽——假件同款
    // 算法下显示串逐字不动。
    expect(host.fitCalls.at(-1)).toEqual({ text: WORLD_DEFAULT, width: NAV_BAR.contextTextW });
  });

  it('contextual 状态 2：目标完成空窗——XP-2 指路文案整串显示，不画键帽', () => {
    const host = new FakeHost();
    const c = boot(host);
    host.worldHint = IDLE_WINDOW;
    c.refresh();

    expect(host.textByName('hud-nav-context')!.text).toBe(IDLE_WINDOW);
    expect(host.textByName('hud-nav-key')!.visible).toBe(false);
    expect(c.lastContextShown).toBe(IDLE_WINDOW);
  });

  it('contextual 状态 3：行商靠近——R6-2「按 E 与行商交易」拆成键帽 E + 动作名', () => {
    const host = new FakeHost();
    const c = boot(host);
    host.worldHint = TRADER_HINT;
    c.refresh();

    const keycap = host.textByName('hud-nav-key')!;
    expect(keycap.visible).toBe(true);
    expect(keycap.text).toBe('E');
    // 世界链「按 E ××」只拆显示：动作名进 contextual，全串仍在 hud-hint
    // （场景侧状态对象，e2e 契约——那里归 worldHintText，不归本类）。
    expect(host.textByName('hud-nav-context')!.text).toBe('与行商交易');
    expect(c.lastStateKey).toBe('|E');
    expect(c.lastContextShown).toBe('与行商交易');
  });

  it('contextual 状态 4：NPC 靠近——「按 E 对话」拆成键帽 E + 对话', () => {
    const host = new FakeHost();
    const c = boot(host);
    host.worldHint = NPC_HINT;
    c.refresh();

    expect(host.textByName('hud-nav-key')!.visible).toBe(true);
    expect(host.textByName('hud-nav-context')!.text).toBe('对话');
    expect(c.lastStateKey).toBe('|E');
  });

  it('contextual 状态 5：战斗中——面板链战斗脚注压过一切，整串显示不进键帽', () => {
    const host = new FakeHost();
    const c = boot(host);
    // 三链同时有话：面板链（战斗）必须赢；世界链此时也有「按 E」也不拆键帽。
    host.panelHint = COMBAT_HINT;
    host.tutorialHint = '教程提示';
    host.worldHint = TRADER_HINT;
    c.refresh();

    const keycap = host.textByName('hud-nav-key')!;
    expect(keycap.visible, '面板链没有单一按键，不画键帽').toBe(false);
    // 超宽截断委托场景 fitHudLine（槽宽 532）：缓存键留全串、显示串被截。
    // （fitCalls[0] 是 build 尾部那次默认脚注，[1] 才是这次战斗脚注。）
    expect(host.fitCalls).toHaveLength(2);
    expect(host.fitCalls[1]).toEqual({ text: COMBAT_HINT, width: NAV_BAR.contextTextW });
    const shown = host.textByName('hud-nav-context')!.text;
    expect(shown).not.toBe(COMBAT_HINT);
    expect(shown.endsWith('…')).toBe(true);
    expect(Array.from(shown).length).toBeLessThan(Array.from(COMBAT_HINT).length);
    expect(c.lastContextShown, '缓存键留全串（没变不碰对象的那把尺）').toBe(COMBAT_HINT);
  });

  it('优先级链：面板链 > 教程链 > 世界链（教程激活且过了出现条件才出声）', () => {
    const host = new FakeHost();
    const c = boot(host);

    // 无面板：教程盖住世界（出生点床铺脚注被教程第 1 步盖住的那步语义）。
    host.tutorialHint = '先学会移动';
    host.worldHint = '按 E 搜刮床铺';
    c.refresh();
    expect(host.textByName('hud-nav-context')!.text).toBe('先学会移动');

    // 面板开着：面板链压过教程（教程第 4 步的完成条件就是制作面板打开）。
    // （最长的那条制作面板串估宽 556 > 532，被截断的口径由状态 5 与 e2e
    // ag71-hud-nav.spec.ts 的真 measureText 守着；这里用背包短串钉优先级。）
    host.panelHint = '↑/↓ 选择 · Enter 使用 · I 关闭';
    c.refresh();
    expect(host.textByName('hud-nav-context')!.text).toBe('↑/↓ 选择 · Enter 使用 · I 关闭');
  });

  it('六铆钉高亮链：navSlotOwned 同口径驱动，地图永不高亮、双开取先', () => {
    const host = new FakeHost();
    const c = boot(host);

    host.owned.add('bag');
    c.refresh();
    expect(host.textByName('hud-nav-bag')!.color).toBe(COLOR_HIGHLIGHT);
    expect(host.textByName('hud-nav-craft')!.color).toBe(COLOR_DIM);
    expect(c.lastStateKey).toBe('bag|');

    // 地图面板是另一个场景（TowerOverview）：owned 即使为真也不开高亮。
    host.owned.clear();
    host.owned.add('map');
    c.refresh();
    expect(host.textByName('hud-nav-map')!.color).toBe(COLOR_DIM);
    expect(c.lastStateKey).toBe('|');

    // 两个同时开着：按 bag > craft > venture > menu 的固定序取先。
    host.owned.add('venture');
    host.owned.add('craft');
    c.refresh();
    expect(c.lastStateKey).toBe('craft|');
    expect(host.textByName('hud-nav-craft')!.color).toBe(COLOR_HIGHLIGHT);
    expect(host.textByName('hud-nav-venture')!.color).toBe(COLOR_DIM);

    // 高亮与 contextual 组合成同一个缓存键（craft 开着 + 行商键帽）。
    host.worldHint = TRADER_HINT;
    c.refresh();
    expect(c.lastStateKey).toBe('craft|E');
  });

  it('点击委托不断链：hitRect onClick 过两道守卫直达 host.navSlotRun', () => {
    const host = new FakeHost();
    boot(host);
    const [bagHit, , , , menuHit] = host.hitRects();

    // 无守卫：点击 = 委托（与键盘 I/C/G/M/Esc 同一个 navSlotRun 面）。
    bagHit.click();
    menuHit.click();
    expect(host.runLog).toEqual(['bag', 'menu']);

    // 守卫一：爬梯动画进行中不接。
    host.stairClimbingFlag = true;
    bagHit.click();
    expect(host.runLog).toEqual(['bag', 'menu']);

    // 守卫二：别的面板开着时只接自己那个槽（owned 判据同高亮口径）。
    host.stairClimbingFlag = false;
    host.anyPanelOpenFlag = true;
    bagHit.click(); // 背包没开着 → 不接
    expect(host.runLog).toEqual(['bag', 'menu']);
    host.owned.add('bag');
    bagHit.click(); // 自己的槽 → 接（toggle 关闭）
    expect(host.runLog).toEqual(['bag', 'menu', 'bag']);
  });

  it('按值缓存：同输入不碰对象（setText 一次、状态层 clear 一次），变输入才重画', () => {
    const host = new FakeHost();
    const c = boot(host);
    const context = host.textByName('hud-nav-context')!;
    const stateGfx = host.graphics[1];
    const setTextAfterBuild = context.setTextCalls;
    const clears = (): number => stateGfx.draws.filter((d) => d === 'clear').length;

    c.refresh();
    c.refresh();
    c.refresh();
    expect(context.setTextCalls, '同输入不重烤纹理').toBe(setTextAfterBuild);
    expect(clears(), 'build 尾部一次，之后同输入不重画').toBe(1);

    // contextual 变（无键帽的整串）：只重写文本，状态层缓存键未变不重画。
    host.worldHint = IDLE_WINDOW;
    c.refresh();
    expect(context.setTextCalls).toBe(setTextAfterBuild + 1);
    expect(clears()).toBe(1);

    // 高亮变：状态层才重画（clear + 六槽 glyph + 键帽隐）。
    host.owned.add('venture');
    c.refresh();
    expect(clears()).toBe(2);

    // 键帽从无到有：同属状态层（contextual 与 hud-hint 同帧落定的那一层）。
    host.worldHint = TRADER_HINT;
    c.refresh();
    expect(clears()).toBe(3);
    expect(host.textByName('hud-nav-key')!.visible).toBe(true);
  });

  it('reset：先毁后建——场景重启不留双份，重建后还是七件', () => {
    const host = new FakeHost();
    const c = boot(host);
    expect(host.liveNavNames()).toHaveLength(7); // 五槽 + contextual + 键帽
    c.refresh();
    c.refresh();

    c.reset();
    expect(host.liveNavNames(), 'reset 后场上不剩导航件').toHaveLength(0);
    expect(host.graphics.every((g) => g.destroyed)).toBe(true);
    expect(host.hitRects().every((r) => r.destroyed)).toBe(true);

    // 场景重启：buildHud 顶部 reset → 尾部 build 整段重跑（字段初始化器不重跑，
    // 靠 reset 先毁）。重建后缓存键归零、七件如初、没有双份。
    c.build();
    expect(host.liveNavNames()).toHaveLength(7);
    expect(host.textByName('hud-nav-context')!.text).toBe(WORLD_DEFAULT);
    expect(host.hitRects()).toHaveLength(5);
  });

  it('refresh 先于 build 是安全空操作（世界模拟段早退时不抛）', () => {
    const host = new FakeHost();
    const c = new NavBarController(host.asHost());
    expect(() => c.refresh()).not.toThrow();
    expect(host.texts, '没建过就不建任何对象').toHaveLength(0);
  });
});
