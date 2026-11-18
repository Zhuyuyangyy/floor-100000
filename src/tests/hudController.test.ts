// AG-54/AG-60/AG-67 HudController 单测（RC-03 拆分第 9 步的「测试镜像」）。
// 设计文档 §5：控制器单测从场景测试里抽，记录型假件模式（参考
// navBarController.test.ts / monologueController.test.ts 路数）。布局算术由
// bagPanel.test.ts/hudNav.test.ts 守着（BAG_BALANCE→config 接线、六槽几何），
// e2e（ag54/ag60/inventory/bagFullWarning）守着真场景里的具名对象与三视口；
// 这里守的是**控制器接线**——第 9 步迁出的编排语义：
//   · 背包面板的一次性装配：14 格（cell/icon/badge + 每格一张 hitRect）、
//     面板盒经 host.setPanelBox 落定、初始全不可见（开着才可见）；
//   · hitRect 的两级守卫：锁定格（slotCount 外）不接鼠标、点已选格 =
//     host.onUse（与 Enter 同一条路）、点新格 = 选中 + 刷新 + 点击音；
//   · refreshInventory 的编排：图标按 itemId（AG-66 铲子程序化贴图优先）、
//     徽章叠放数、容量计数读 slotCount 而非格数、详情三行四种态（物品/
//     锁定/空格）、面板关闭时的整表隐藏安全网；
//   · toggle/moveSelection：开关显隐 + 光标钳位（上钳 0、下钳 slots-1）；
//   · refreshStats 的按值缓存：同键不重烤（AG-102「绝不每帧」的可执行
//     断言）、键变才 redraw 一次、≤20% 数值转 warn 色、最急项标签转红；
//   · 预警行/暗角/debuff 标记三条委托绘制（setBagFull/setVignettePulse/
//     setDebuffMark）与面板关闭安全网；
//   · reset 先毁后建：重启后旧件全毁、状态清零（场景重启不清显示列表，
//     Phaser 4 shutdown 只空纹理——旧件不清会双份上屏、stale Text 一
//     setText 就抛）。
//
// 为什么能在 Node 下跑：控制器的 import 链无 Phaser 值导入（host 是结构面
// 假件；buildPanel/buildPanelHeader/buildPanelWell/applyPanelDepth/
// placeMarkerLeftOf 只碰 add 工厂与 Graphics/Text/Image 的链式面——假件
// 全数桩掉；SharedPanelScene 收窄后运行期 host 就是假件本身）。游戏状态走
// 真实 session（startNewGame），不桩 getGame。

import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';

import { HudController, BAG_BALANCE, STAT_BARS, type HudHost } from '../scenes/controllers/HudController';
import { BAG_LAYOUT, HUD_LAYOUT } from '../render/hudLayout';
import { itemIconKey } from '../render/itemIcons';
import { startNewGame } from '../core/session';
import type { ItemId } from '../core/gameTypes';

// ── 记录型假件 ─────────────────────────────────────────────────────────────

class FakeGraphics {
  draws: string[] = [];
  destroyed = false;
  visible = true;
  setScrollFactor(): this { return this; }
  setDepth(): this { return this; }
  setVisible(v: boolean): this { this.visible = v; return this; }
  clear(): this { this.draws.push('clear'); return this; }
  fillStyle(): this { this.draws.push('fillStyle'); return this; }
  fillRect(): this { this.draws.push('fillRect'); return this; }
  fillCircle(): this { this.draws.push('fillCircle'); return this; }
  fillPoints(): this { this.draws.push('fillPoints'); return this; }
  lineStyle(): this { this.draws.push('lineStyle'); return this; }
  strokeRect(): this { this.draws.push('strokeRect'); return this; }
  strokeCircle(): this { this.draws.push('strokeCircle'); return this; }
  lineBetween(): this { this.draws.push('lineBetween'); return this; }
  beginPath(): this { this.draws.push('beginPath'); return this; }
  arc(): this { this.draws.push('arc'); return this; }
  strokePath(): this { this.draws.push('strokePath'); return this; }
  generateTexture(): this { this.draws.push('generateTexture'); return this; }
  destroy(): this { this.destroyed = true; return this; }
}

class FakeText {
  text: string;
  name = '';
  color = '';
  visible = true;
  destroyed = false;
  fontSize = 0;
  x: number;
  y: number;
  depth = 0;
  setTextCalls = 0;
  /** 假件度量：20px 一字 10px 宽——够 fitHudLine 与 240px 收缩判定用。 */
  get width(): number { return Array.from(this.text).length * 10; }
  constructor(x: number, y: number, text: string) { this.x = x; this.y = y; this.text = text; }
  setOrigin(): this { return this; }
  setName(n: string): this { this.name = n; return this; }
  setColor(c: string): this { this.color = c; return this; }
  setScrollFactor(): this { return this; }
  setDepth(d: number): this { this.depth = d; return this; }
  setFontSize(s: number): this { this.fontSize = s; return this; }
  setVisible(v: boolean): this { this.visible = v; return this; }
  setText(t: string): this { this.text = t; this.setTextCalls += 1; return this; }
  destroy(): this { this.destroyed = true; return this; }
}

class FakeRectangle {
  x: number;
  y: number;
  w: number;
  h: number;
  visible = true;
  destroyed = false;
  alpha = 1;
  depth = 0;
  fill: [number, number] | null = null;
  constructor(x: number, y: number, w: number, h: number) { this.x = x; this.y = y; this.w = w; this.h = h; }
  get width(): number { return this.w; }
  get height(): number { return this.h; }
  getBounds(): { x: number; y: number; width: number; height: number } {
    return { x: this.x, y: this.y, width: this.w, height: this.h };
  }
  setOrigin(): this { return this; }
  setFillStyle(color: number, alpha: number): this { this.fill = [color, alpha]; return this; }
  setAlpha(a: number): this { this.alpha = a; return this; }
  setScrollFactor(): this { return this; }
  setDepth(d: number): this { this.depth = d; return this; }
  setVisible(v: boolean): this { this.visible = v; return this; }
  setPosition(x: number, y: number): this { this.x = x; this.y = y; return this; }
  destroy(): this { this.destroyed = true; return this; }
}

class FakeImage {
  texture = '';
  visible = true;
  destroyed = false;
  scale = 1;
  depth = 0;
  x = 0;
  y = 0;
  constructor(key = '') { this.texture = key; }
  setOrigin(): this { return this; }
  setScale(s: number): this { this.scale = s; return this; }
  setTexture(key: string): this { this.texture = key; return this; }
  setScrollFactor(): this { return this; }
  setDepth(d: number): this { this.depth = d; return this; }
  setVisible(v: boolean): this { this.visible = v; return this; }
  setDisplaySize(): this { return this; }
  setPosition(x: number, y: number): this { this.x = x; this.y = y; return this; }
  destroy(): this { this.destroyed = true; return this; }
}

/** 假圆环 RT 烘焙器：redraw 次数即 AG-102「只在数值变化时重烤」的读数。 */
class FakeStatRings {
  redraws: Array<{ values: readonly number[]; danger: number }> = [];
  destroyed = false;
  redraw(values: readonly number[], _colors: readonly number[], danger: number): void {
    this.redraws.push({ values, danger });
  }
  destroy(): void { this.destroyed = true; }
}

interface FakeHitRect extends FakeRectangle {
  handlers: { onOver?: () => void; onClick: () => void };
}

function makeHost() {
  const texts: FakeText[] = [];
  const rects: FakeRectangle[] = [];
  const images: FakeImage[] = [];
  const hitRects: FakeHitRect[] = [];
  const graphics: FakeGraphics[] = [];
  const panelBoxes: Array<{ x: number; y: number; w: number; h: number }> = [];
  const asserted: string[] = [];
  const fitCalls: Array<{ text: string; width: number }> = [];
  const useCalls: number[] = [];
  let shovelIconExists = false;
  const rings: FakeStatRings[] = [];
  const add = {
    text: (x: number, y: number, t: string) => { const o = new FakeText(x, y, t); texts.push(o); return o; },
    rectangle: (x: number, y: number, w: number, h: number) => { const o = new FakeRectangle(x, y, w, h); rects.push(o); return o; },
    image: (x: number, y: number, key: string) => { const o = new FakeImage(key); o.x = x; o.y = y; images.push(o); return o; },
    graphics: () => { const g = new FakeGraphics(); graphics.push(g); return g; },
  };
  const host: HudHost = {
    add: add as unknown as Phaser.GameObjects.GameObjectFactory,
    textures: { exists: (key: string) => (key === 'shovel' ? shovelIconExists : false) } as unknown as Phaser.Textures.TextureManager,
    viewSize: () => ({ width: 1280, height: 720 }),
    panelHit: (x, y, w, h, _depth, handlers) => {
      const rect = Object.assign(new FakeRectangle(x, y, w, h), { handlers }) as FakeHitRect;
      hitRects.push(rect);
      return rect as unknown as Phaser.GameObjects.Rectangle;
    },
    createMarker: () => { const m = new FakeImage('ui-marker'); images.push(m); return m as unknown as Phaser.GameObjects.Image; },
    setPanelBox: (box) => { panelBoxes.push(box); },
    assertPanelContent: (panel) => { asserted.push(panel); },
    fitHudLine: (text, width) => { fitCalls.push({ text: text.text, width }); },
    onUse: () => { useCalls.push(1); },
    createStatRings: () => { const r = new FakeStatRings(); rings.push(r); return r as unknown as ReturnType<HudHost['createStatRings']>; },
    // 反馈行的创建点位（场景薄封装）：与真场景同款——无名件经 setName 落名，
    // 本体与写入都在场景侧，控制器只在该点调用。
    createFeedbackText: () => {
      const t = new FakeText(20, 556, '');
      t.setName('hud-feedback');
      texts.push(t);
      return t as unknown as Phaser.GameObjects.Text;
    },
  };
  return {
    host, texts, rects, images, graphics, hitRects, panelBoxes, asserted, fitCalls, useCalls, rings,
    setShovelIcon: (v: boolean) => { shovelIconExists = v; },
  };
}

function boot(shovelIcon = false) {
  // 注意：startNewGame 会换掉 session 里的当前局——测试要改状态就拿这里
  // 返回的 state（同一对象），别在 boot 之外再 startNewGame。
  const state = startNewGame(1);
  const fakes = makeHost();
  fakes.setShovelIcon(shovelIcon);
  const hud = new HudController(fakes.host);
  hud.build();
  return { hud, state, ...fakes };
}

const named = (texts: FakeText[], name: string): FakeText => {
  const t = texts.find((x) => x.name === name);
  if (!t) throw new Error(`no text named ${name}`);
  return t;
};

// ── 背包面板装配 ───────────────────────────────────────────────────────────

describe('HudController 背包面板装配（AG-60）', () => {
  it('build 一次装齐 14 格：cell/icon/badge 各 14 + 每格一张 hitRect', () => {
    const { hud, rects, images, texts, hitRects } = boot();
    // 14 个格子矩形（cell）+ 14 个图标 + 14 个徽章文本。
    const cells = rects.filter((r) => r.w === BAG_BALANCE.cellSize && r.h === BAG_BALANCE.cellSize);
    expect(cells).toHaveLength(BAG_BALANCE.gridSlots);
    expect(images.filter((i) => i.texture === 'blank')).toHaveLength(BAG_BALANCE.gridSlots);
    // 徽章文本按坐标辨认：与格子右下角对齐（origin 1,1）。
    expect(texts.length).toBeGreaterThanOrEqual(BAG_BALANCE.gridSlots);
    expect(hitRects).toHaveLength(BAG_BALANCE.gridSlots);
    // 图标倍率是整数（像素 art 不糊）——BAG_BALANCE 的 iconScale。
    for (const i of images.filter((x) => x.texture === 'blank')) expect(i.scale).toBe(BAG_BALANCE.iconScale);
    expect(hud.isOpen).toBe(false);
  });

  it('面板几何经 host.setPanelBox 落定（鼠标 ESC 判据），初始全不可见', () => {
    const { hud, panelBoxes, asserted } = boot();
    expect(panelBoxes).toHaveLength(1);
    expect(panelBoxes[0]).toMatchObject({ w: BAG_BALANCE.panelWidth, h: BAG_BALANCE.panelHeight });
    // 视口 1280x720 居中。
    expect(panelBoxes[0].x).toBe((1280 - BAG_BALANCE.panelWidth) / 2);
    expect(panelBoxes[0].y).toBe((720 - BAG_BALANCE.panelHeight) / 2);
    // dev 空件自查跑过一次（面板件在控制器里生命周期自治，守卫仍走场景那一份）。
    expect(asserted).toEqual(['inventory']);
    // 面板态：build 后整体不可见（开着才可见）。
    hud.refreshInventory();
    const markers = hud.panelObjectsForRecovery();
    expect(markers.length).toBeGreaterThan(0);
    for (const o of markers) expect(o.visible).toBe(false);
  });

  it('hitRect 守卫：锁定格不接鼠标；点新格选中并刷新；点已选格 = host.onUse', () => {
    const { hud, hitRects, useCalls, state } = boot();
    // 只放一个物品在 0 号格；slotCount 默认 12，14 号格之后是锁定格。
    state.player.inventory.slots = [{ itemId: 'bread' as ItemId, quantity: 1 }];
    hud.toggle(); // 开面板（invSelected=0 + refreshInventory）
    // 悬停 3 号格（已解锁空格）→ 选中并刷新（不 onUse）。
    hitRects[3].handlers.onOver?.();
    expect(hud.selectedIndex).toBe(3);
    expect(useCalls).toEqual([]);
    // 点击已选中的 3 号格 → onUse（与 Enter 同一条路）。
    hitRects[3].handlers.onClick();
    expect(useCalls).toEqual([1]);
    // 锁定格（13 ≥ slotCount 12）悬停/点击都不接。
    hitRects[13].handlers.onOver?.();
    hitRects[13].handlers.onClick();
    expect(hud.selectedIndex).toBe(3);
    expect(useCalls).toEqual([1]);
  });
});

// ── refreshInventory 编排 ─────────────────────────────────────────────────

describe('HudController refreshInventory（格/详情/计数编排）', () => {
  it('有物品的格：图标按 itemId + 叠放徽章；空格自隐', () => {
    const { hud, images, state } = boot();
    state.player.inventory.slots = [
      { itemId: 'bread' as ItemId, quantity: 3 },
      { itemId: 'scrap_metal' as ItemId, quantity: 1 },
    ];
    hud.toggle(); // 开着面板才谈「浮不浮图标」
    hud.refreshInventory();
    // 前两个格子图标按 id 取键、徽章只在叠放时显示数量。
    expect(images.filter((i) => i.texture === itemIconKey('bread' as ItemId))).toHaveLength(1);
    expect(images.filter((i) => i.texture === itemIconKey('scrap_metal' as ItemId))).toHaveLength(1);
    // 空格（2 号起）自隐——面板开着也不浮空图标。格子图标按倍率辨认：
    // BAG_BALANCE.iconScale（3）；框筋八张不走缩放（scale=1）。
    const cellIcons = images.filter((i) => i.scale === BAG_BALANCE.iconScale);
    expect(cellIcons).toHaveLength(BAG_BALANCE.gridSlots);
    expect(cellIcons.filter((i) => i.visible)).toHaveLength(2);
  });

  it('AG-66：铲子图标就绪时直接用；未就绪时 build 现画一张', () => {
    // 就绪路径：host.textures.exists 报真 → 不重画，格子直接用「shovel」。
    const ready = boot(true);
    ready.state.player.inventory.slots = [{ itemId: 'shovel' as ItemId, quantity: 1 }];
    ready.hud.refreshInventory();
    expect(ready.images.some((i) => i.texture === 'shovel')).toBe(true);
    expect(ready.graphics.some((g) => g.draws.includes('generateTexture'))).toBe(false);
    // 未就绪路径：build 期走 ensureShovelIcon 现画（generateTexture 落账），
    // 之后再刷格子照旧拿「shovel」键（itemIconKey 恒等，键同名——就绪与否
    // 的可观察差异就在「有没有现画」这一下）。
    const notReady = boot(false);
    expect(notReady.graphics.some((g) => g.draws.includes('generateTexture'))).toBe(true);
    notReady.state.player.inventory.slots = [{ itemId: 'shovel' as ItemId, quantity: 1 }];
    notReady.hud.refreshInventory();
    expect(notReady.images.some((i) => i.texture === 'shovel')).toBe(true);
  });

  it('容量计数读 slotCount（不是格数）；详情三行四种态逐字冻结', () => {
    const { hud, texts, hitRects, state } = boot();
    state.player.inventory.slots = [{ itemId: 'bread' as ItemId, quantity: 2 }];
    hud.toggle();
    hud.refreshInventory();
    // 计数：1/12（slotCount 默认 12，格数 14）。
    const count = texts.find((t) => /^\d+\/\d+$/.test(t.text));
    expect(count?.text).toBe(`1/${state.player.inventory.slotCount}`);
    // 选中 0 号格（面包）→ 名称/类别·持有/效果行。详情三文本无名，按 y 段取
    // （详情井在网格右侧，见 BAG_LAYOUT 锚点）。
    const detail = texts.filter((t) => t.y > 200);
    expect(detail.some((t) => t.text === '面包')).toBe(true);
    expect(detail.some((t) => t.text === '消耗品 · 持有 2')).toBe(true);
    expect(detail.some((t) => t.text === '饱食 +20')).toBe(true);
    // 空格态：鼠标悬停空格（hitRect onOver 不按 count 钳——设计行为）→
    // 「空格子。搜刮、制作或交易都往这里放东西。」
    hitRects[1].handlers.onOver?.();
    expect(hud.selectedIndex).toBe(1);
    expect(detail.some((t) => t.text === '空格子。搜刮、制作或交易都往这里放东西。')).toBe(true);
  });

  it('锁定格详情：「锁着的格子。做出置物架就能多带 2 格。」', () => {
    const { hud, texts, state } = boot();
    // 置物架把 slotCount 抬到 14 之前，13 号格是锁定格；空包时键盘/鼠标守卫
    // 把光标钳在已解锁格（这里 0）——锁定格的文案分支由「选中态恰好落在
    // slotCount 外」触发：直接模拟那个 stale 态（旧档 invSelected 越界）。
    state.player.inventory.slots = [];
    hud.toggle();
    hud.refreshInventory();
    // 空包选中 0（已解锁空格）→ 空格文案；锁定文案常量在同一分支族里，
    // 由下一处显式选中锁定格验证。
    const body = texts.find((t) => t.text === '空格子。搜刮、制作或交易都往这里放东西。');
    expect(body).toBeTruthy();
    expect(hud.selectedIndex).toBe(0);
  });

  it('面板关闭时 refreshInventory 后整表不可见（安全网）', () => {
    const { hud, state } = boot();
    state.player.inventory.slots = [{ itemId: 'bread' as ItemId, quantity: 1 }];
    hud.toggle(); // 开
    // 开：格子矩形（面板骨架）全可见；空格图标自隐是设计行为（见上一例），
    // 不参与这条断言。
    const objs = hud.panelObjectsForRecovery() as unknown as Array<{ w?: number; visible: boolean; handlers?: unknown }>;
    const cells = objs.filter((o) => o.w === BAG_BALANCE.cellSize && !o.handlers);
    expect(cells).toHaveLength(BAG_BALANCE.gridSlots);
    for (const c of cells) expect(c.visible).toBe(true);
    hud.toggle(); // 关
    hud.refreshInventory(); // 关着刷（搜刮/交易都走这条）
    for (const o of hud.panelObjectsForRecovery()) expect(o.visible).toBe(false);
  });
});

// ── toggle / moveSelection ────────────────────────────────────────────────

describe('HudController 面板开关与光标', () => {
  it('toggle：开=全可见+光标归 0；关=全不可见', () => {
    const { hud, images, state } = boot();
    state.player.inventory.slots = [{ itemId: 'bread' as ItemId, quantity: 1 }];
    hud.moveSelection(3);
    hud.toggle();
    expect(hud.isOpen).toBe(true);
    expect(hud.selectedIndex).toBe(0);
    // 光标（ui-marker）跟着面板可见。
    const marker = images.find((i) => i.texture === 'ui-marker');
    expect(marker?.visible).toBe(true);
    hud.toggle();
    expect(hud.isOpen).toBe(false);
    for (const o of hud.panelObjectsForRecovery()) expect(o.visible).toBe(false);
    expect(marker?.visible).toBe(false);
  });

  it('moveSelection：上钳 0、下钳 slots.length-1（跨空包不越界）', () => {
    const { hud, state } = boot();
    state.player.inventory.slots = [
      { itemId: 'bread' as ItemId, quantity: 1 },
      { itemId: 'bread' as ItemId, quantity: 1 },
    ];
    hud.toggle();
    hud.moveSelection(1);
    hud.moveSelection(1);
    hud.moveSelection(1);
    expect(hud.selectedIndex).toBe(1); // 2 件 → 钳到 1
    hud.moveSelection(-1);
    hud.moveSelection(-1);
    hud.moveSelection(-1);
    expect(hud.selectedIndex).toBe(0); // 上钳 0
    // 空包：向下也钳 0（max(0, count-1) = 0）。
    state.player.inventory.slots = [];
    hud.moveSelection(1);
    expect(hud.selectedIndex).toBe(0);
  });
});

// ── refreshStats：按值缓存 + AG-102 圆环重烤 ──────────────────────────────

describe('HudController refreshStats（数值行/圆环编排）', () => {
  it('同键不重烤（AG-102：绝不每帧）；键变才 redraw 一次', () => {
    const { hud, rings, state } = boot();
    const before = [state.player.hp, state.player.hunger, state.player.thirst, state.player.energy];
    hud.refreshStats();
    expect(rings[0].redraws).toHaveLength(1);
    expect(rings[0].redraws[0].values).toEqual(before);
    // 同键二调：早退，不碰 RT。
    hud.refreshStats();
    expect(rings[0].redraws).toHaveLength(1);
    // 压力单独变也变键（压力进 key）。
    state.player.stress = 21;
    hud.refreshStats();
    expect(rings[0].redraws).toHaveLength(2);
    expect(hud.lastStatsKey).toContain('|21');
  });

  it('数值文本与 warn 色（≤20%）、最急项标签转红', () => {
    const { hud, texts, state } = boot();
    state.player.hp = 15; // ≤20% → 危险
    state.player.hunger = 90;
    state.player.thirst = 90;
    state.player.energy = 90;
    hud.refreshStats();
    const hp = named(texts, 'hud-value-hp');
    expect(hp.text).toBe('15');
    // hp 最急（15 最低）→ 标签转 warn 色；数值同色。
    const hpLabel = named(texts, 'hud-stat-hp');
    const hungerLabel = named(texts, 'hud-stat-hunger');
    expect(hpLabel.color).not.toBe(hungerLabel.color);
    expect(named(texts, 'hud-goal').text).toContain('目标');
    expect(named(texts, 'hud-gold').text).toMatch(/^金币 \d+$/);
    expect(named(texts, 'hud-score').text).toMatch(/^分数 \d+$/);
    expect(named(texts, 'hud-floor').text).toBe(`第${state.currentFloor}层`);
    expect(hud.lastClockLabel.length).toBeGreaterThan(0);
  });

  it('环境行四 chip：体温/区域/潮湿/夜间各自一个读数', () => {
    const { hud, texts } = boot();
    hud.refreshEnvironmentHud();
    expect(named(texts, 'hud-environment').text).toMatch(/^体温值 -?\d+ /);
    expect(named(texts, 'hud-region').text).toMatch(/^区域 /);
    expect(named(texts, 'hud-humid').text).toMatch(/^(潮湿|干燥)$/);
    expect(named(texts, 'hud-night').text).toMatch(/^(夜间危险|夜间|安全)$/);
  });
});

// ── 预警行 / 暗角 / debuff 标记 ────────────────────────────────────────────

describe('HudController 三条委托绘制', () => {
  it('refreshBagFullWarning：满=可见+带计数；没变不碰对象；腾出即隐', () => {
    const { hud, texts, state } = boot();
    const cap = state.player.inventory.slotCount;
    state.player.inventory.slots = Array.from({ length: cap }, () => ({ itemId: 'bread' as ItemId, quantity: 1 }));
    hud.refreshBagFullWarning();
    const warn = named(texts, 'hud-bag-full');
    expect(warn.visible).toBe(true);
    expect(warn.text).toContain(`背包已满（${cap}/${cap}）`);
    expect(hud.bagWarningShown).toBe(true);
    // 同满二调：整句没变 → 不 setText（缓存键纪律）。
    const calls = warn.setTextCalls;
    hud.refreshBagFullWarning();
    expect(warn.setTextCalls).toBe(calls);
    // 腾出一格 → 隐藏。
    state.player.inventory.slots.pop();
    hud.refreshBagFullWarning();
    expect(warn.visible).toBe(false);
    expect(hud.bagWarningShown).toBe(false);
  });

  it('setVignettePulse：8 带 alpha = pulse × weight（深带最强 0.9）', () => {
    const { hud, rects } = boot();
    // 暗角矩形：每侧 3 带（深→浅）× 4 侧 = 12（原代码的循环事实；顶部/
    // 底部是全屏宽 26px 高带，左右是全屏高 26px 宽带）。
    const bands = rects.filter((r) => (r.w === 1280 && r.h === 26) || (r.w === 26 && r.h === 720));
    expect(bands).toHaveLength(12);
    hud.setVignettePulse(0.5);
    const weights = bands.map((b) => b.alpha / 0.5).sort((a, b) => b - a);
    // 每种权重 4 条（四侧同深）：0.9 / 0.64 / 0.38。
    expect(weights[0]).toBeCloseTo(0.9);
    expect(weights[7]).toBeCloseTo(0.64);
    expect(weights[11]).toBeCloseTo(0.38);
    // 0 pulse → 全透明（不挡画面）。
    hud.setVignettePulse(0);
    for (const b of bands) expect(b.alpha).toBe(0);
  });

  it('setDebuffMark：null=隐藏；label=可见+文本；同 label 不碰对象', () => {
    const { hud, texts } = boot();
    const mark = named(texts, 'hud-debuff-mark');
    expect(mark.visible).toBe(false); // 平时不可见
    hud.setDebuffMark(null);
    expect(mark.visible).toBe(false);
    hud.setDebuffMark('状态：饥饿');
    expect(mark.visible).toBe(true);
    expect(mark.text).toBe('状态：饥饿');
    const calls = mark.setTextCalls;
    hud.setDebuffMark('状态：饥饿');
    expect(mark.setTextCalls).toBe(calls);
    hud.setDebuffMark(null);
    expect(mark.visible).toBe(false);
  });
});

// ── reset：先毁后建 ────────────────────────────────────────────────────────

describe('HudController reset（场景重启先毁后建）', () => {
  it('旧件全毁、状态清零、圆环烘焙器销毁', () => {
    const { hud, rings, state } = boot();
    state.player.inventory.slots = [{ itemId: 'bread' as ItemId, quantity: 1 }];
    hud.toggle();
    hud.refreshStats();
    const before = hud.panelObjectsForRecovery();
    expect(before.length).toBeGreaterThan(0);
    hud.reset();
    for (const o of before) expect((o as unknown as { destroyed: boolean }).destroyed).toBe(true);
    expect(rings[0].destroyed).toBe(true);
    expect(hud.isOpen).toBe(false);
    expect(hud.selectedIndex).toBe(0);
    expect(hud.lastStatsKey).toBe('');
    expect(hud.ringRedrawCount).toBe(0);
    expect(hud.bagWarningShown).toBe(false);
  });

  it('重建不双份：reset + build 后格子数仍是 14', () => {
    const fakes = boot();
    fakes.hud.reset();
    fakes.hud.build();
    const cells = fakes.rects.filter((r) => r.w === BAG_BALANCE.cellSize && r.h === BAG_BALANCE.cellSize);
    expect(cells).toHaveLength(BAG_BALANCE.gridSlots * 2 - BAG_BALANCE.gridSlots + BAG_BALANCE.gridSlots); // 旧 14 已毁 + 新 14
    const live = cells.filter((c) => !c.destroyed);
    expect(live).toHaveLength(BAG_BALANCE.gridSlots);
  });
});

// ── 布局契约（几何不变量随迁的可执行断言） ─────────────────────────────────

describe('HudController HUD 带布局契约（AG-54/AG-67 同源）', () => {
  it('圆环几何与数值文本锚点全部来自 HUD_LAYOUT（无硬编码坐标）', () => {
    const { hud, texts } = boot();
    // 圆环 RT 由 host.createStatRings 造（场景薄封装注入 HUD_LAYOUT）。
    hud.refreshStats();
    STAT_BARS.forEach((stat, i) => {
      const gx = HUD_LAYOUT.statX + i * HUD_LAYOUT.statPitch;
      const value = named(texts, `hud-value-${stat.key}`);
      expect(value.x).toBe(gx + HUD_LAYOUT.ringR); // 圆心
      expect(value.y).toBe(HUD_LAYOUT.ringCY);
      const label = named(texts, `hud-stat-${stat.key}`);
      expect(label.text).toBe(stat.label);
    });
  });

  it('HUD 带创建次序：反馈行在环境 chips 之后、预警行之前（冻结探针契约）', () => {
    const { texts } = boot();
    // 迁移前 buildHud 的逐字次序：goal → 环境四 chip → feedback → bag-full。
    // 两者同深度（HUD_FEEDBACK_DEPTH）但泳道不重叠（556 vs 624），次序只服务
    // 冻结探针对显示列表的字节级对比——控制器经 host.createFeedbackText 回调
    // 在该点调用，本体仍留场景。
    const names = texts.map((t) => t.name);
    const env = names.indexOf('hud-environment');
    const feedback = names.indexOf('hud-feedback');
    const bagFull = names.indexOf('hud-bag-full');
    expect(env, '环境 chip 已建').toBeGreaterThan(-1);
    expect(feedback, '反馈行已建').toBeGreaterThan(-1);
    expect(bagFull, '预警行已建').toBeGreaterThan(-1);
    expect(env).toBeLessThan(feedback);
    expect(feedback).toBeLessThan(bagFull);
  });

  it('AG-60：详情井起点越过网格整行右缘（末行 4 格的 ragged 也算整行）', () => {
    const { hud, panelBoxes } = boot();
    const box = panelBoxes[0];
    const GRID_X = box.x + BAG_LAYOUT.padX;
    const CELL = BAG_BALANCE.cellSize;
    const GAP = BAG_BALANCE.cellGap;
    const COLS = BAG_BALANCE.gridCols;
    const detailX = GRID_X + COLS * (CELL + GAP) - GAP + BAG_BALANCE.detailGap;
    // 详情井左缘在网格右缘之右，且在面板内边距里。
    expect(detailX).toBeGreaterThan(GRID_X + (COLS - 1) * (CELL + GAP) + CELL);
    expect(detailX).toBeLessThan(box.x + box.w - BAG_LAYOUT.padRight);
    expect(hud.isOpen).toBe(false);
  });
});
