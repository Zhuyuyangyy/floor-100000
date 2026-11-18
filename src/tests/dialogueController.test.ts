// DialogueController 单测（RC-03 拆分第 8 步的「测试镜像」）。
// 设计文档 §5：控制器单测从场景测试里抽，记录型假件模式（前七步同款：
// monologueController / perfController / navBarController / combatController）。
// 纯逻辑四件套由既有测试直守，不在这里重测——行商经济（systems/shop.ts：
// shopStock/materialShelf/buy/sell/sellPrice + VENTURES/invest/
// settleInvestments，econBalance/economyLoop/investment 系列）、NPC 交易与
// 赠礼（ai/npcEconomy.ts：availableOffers/executeBarter/giftOffer/claimGift/
// receiveGift，npcEconomy.test.ts）、对话几何（render/dialogueLayout.ts，
// dialogueLayout.test.ts）、AI 运行时（systems/NpcRuntime.ts + src/ai/）——
// 这里守的是**控制器编排**：
//   · 对话树推进：open 开场（静态问候 + 保鲜键发放）→ main 四选项 → 交易层
//     （报价 + 赠礼行 + 返回）→ 赠礼层（背包逐格）→ back 逐层回退 → 退出；
//   · 交易执行回写：executeBarter 成功的换货台词 + 背包刷新 + 扣分钟委托 +
//     失败时 reason 原文显示（无静默）；
//   · 行商面板编排：openShop 的当日双货架装配、shopBuy/shopSell 的金币与
//     背包回写、shopMove 的钳位（Cursor 行为逐字保留）；
//   · 产业面板编排：toggle 开关、打开即补结算（幂等）、activateVenture 的
//     invest 原子性、ventureMove 钳位、diffVentureLedger 的只观察语义；
//   · AI 降级路径呈现：无模型（VITE_NPC_MODEL 空）时 enhanceOpeningLine
//     空转——玩家看到的就是改造前那一句静态问候，玩家操作 revision+1 使
//     在途结果过期（保鲜键半边）；
//   · 契约面：dialogueSnapshot（spark.spec.ts 直读的 scene.dialogue）、
//     isOpen/ventureIsOpen、panelObjectsForRecovery、reset 的重启语义。
//
// 为什么能在 Node 下跑：控制器的 import 链无 Phaser 值导入（host 是结构面
// 假件；共享面板渲染件 buildPanel/buildPanelHeader/buildPanelWell/
// buildListRow/applyPanelDepth/lockToScreen 只碰 add 工厂与链式 setter——
// 假件全数桩掉）。唯一的环境依赖是 SaveSystem 的 localStorage 默认参
// （activate 的交易/赠礼成功路径 saveToStorage）——本文件顶部装内存 Storage
// 假件（vitest 每文件独立环境）。playSfx 的 AudioSystem 自带 Node 退路。

import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';

import { DialogueController, type DialogueHost } from '../scenes/controllers/DialogueController';
import { startNewGame, getGame } from '../core/session';
import { getNpc } from '../data/npcs';
import { getItem } from '../data/items';
import { countItem, addItem } from '../systems/InventorySystem';
import { ACTION_COSTS } from '../systems/SurvivalSystem';
import { ensureGrowth } from '../core/growth';
import type { GameState } from '../core/gameTypes';
import { flagCount } from '../systems/WorldFlags';

// ── 环境：内存 localStorage（SaveSystem 默认参的 Node 退路） ────────────────
class MemoryStorage {
  private readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}
(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();

// ── 记录型假件 ─────────────────────────────────────────────────────────────

/** 链式 GameObject 假件基座：记录器 + Phaser 链式面全数桩掉。 */
class FakeObject {
  destroyed = false;
  name = '';
  x = 0;
  y = 0;
  alpha = 1;
  depth = 0;
  visible = true;
  textureKey = '';
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }
  setOrigin(): this {
    return this;
  }
  setPosition(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }
  setSize(): this {
    return this;
  }
  setDisplaySize(): this {
    return this;
  }
  setAlpha(a: number): this {
    this.alpha = a;
    return this;
  }
  setDepth(d: number): this {
    this.depth = d;
    return this;
  }
  setScrollFactor(): this {
    return this;
  }
  setVisible(v: boolean): this {
    this.visible = v;
    return this;
  }
  setTexture(key: string): this {
    this.textureKey = key;
    return this;
  }
  getBounds(): { x: number; y: number; width: number; height: number } {
    return { x: this.x, y: this.y, width: 16, height: 16 };
  }
  destroy(): this {
    this.destroyed = true;
    return this;
  }
}

/** Text 假件：记 text/color（对话行标签与面板标题都从它读）。 */
class FakeText extends FakeObject {
  color = '';
  constructor(
    x: number,
    y: number,
    readonly text: string,
    readonly style: Record<string, unknown>,
  ) {
    super(x, y);
  }
  setText(t: string): this {
    (this as { text: string }).text = t;
    return this;
  }
  setColor(c: string): this {
    this.color = c;
    return this;
  }
}

/** Graphics 假件：记画法调用序列（对话井描边/发丝线重画）。 */
class FakeGraphics extends FakeObject {
  readonly draws: string[] = [];
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
  lineStyle(): this {
    this.draws.push('lineStyle');
    return this;
  }
  strokeRect(): this {
    this.draws.push('strokeRect');
    return this;
  }
}

/** add 工厂假件：全部出生件按类登记，供断言「面板里有什么」。 */
class FakeAddFactory {
  readonly rects: FakeObject[] = [];
  readonly texts: FakeText[] = [];
  readonly images: FakeObject[] = [];
  readonly gfx: FakeGraphics[] = [];
  rectangle(x: number, y: number, _w: number, _h: number, _color: number): FakeObject {
    const r = new FakeObject(x, y);
    this.rects.push(r);
    return r;
  }
  text(x: number, y: number, text: string, style: Record<string, unknown>): FakeText {
    const t = new FakeText(x, y, text, style);
    this.texts.push(t);
    return t;
  }
  image(x: number, y: number, key: string): FakeObject {
    const o = new FakeObject(x, y);
    o.name = key;
    this.images.push(o);
    return o;
  }
  graphics(): FakeGraphics {
    const g = new FakeGraphics();
    this.gfx.push(g);
    return g;
  }
}

/** tween 管理器假件（本类当前不直接加 tween；随面保留）。 */
class FakeTweens {
  readonly added: Array<Record<string, unknown>> = [];
  add(config: Record<string, unknown>): unknown {
    this.added.push(config);
    return config;
  }
}

/** 时钟假件：delayedCall 登记（delay + callback），测试手动触发。 */
class FakeClock {
  readonly calls: Array<{ delay: number; callback: () => void }> = [];
  delayedCall(delay: number, callback: () => void): unknown {
    this.calls.push({ delay, callback });
    return { delay };
  }
  /** 触发指定 delay 的待定回调（返回触发了几次）。 */
  fire(delay: number): number {
    let fired = 0;
    for (const c of [...this.calls]) {
      if (c.delay === delay) {
        this.calls.splice(this.calls.indexOf(c), 1);
        c.callback();
        fired++;
      }
    }
    return fired;
  }
}

/** 假件记录面（断言读这些）。 */
interface FakeHost {
  readonly encounterOpenCalls: boolean[];
  readonly panelBoxes: Array<{ x: number; y: number; w: number; h: number }>;
  rebuildCount: number;
  statsRefreshCount: number;
  invRefreshCount: number;
  readonly flashes: string[];
  readonly chargeTimes: number[];
  readonly npcTalked: string[];
  readonly useCalls: number[];
  readonly assertPanels: string[];
  readonly fxCalls: Array<{ id: string; x: number; y: number; depth: number }>;
  readonly panelHits: Array<{ x: number; y: number; w: number; h: number; depth: number; handlers: { onClick?: () => void; onOver?: () => void } }>;
  readonly add: FakeAddFactory;
  readonly tweens: FakeTweens;
  readonly time: FakeClock;
  readonly markers: FakeObject[];
}

function makeHost(): FakeHost {
  const add = new FakeAddFactory();
  const tweens = new FakeTweens();
  const time = new FakeClock();
  const markers: FakeObject[] = [];
  const host = {
    encounterOpenCalls: [] as boolean[],
    panelBoxes: [] as Array<{ x: number; y: number; w: number; h: number }>,
    rebuildCount: 0,
    statsRefreshCount: 0,
    invRefreshCount: 0,
    flashes: [] as string[],
    chargeTimes: [] as number[],
    npcTalked: [] as string[],
    useCalls: [] as number[],
    assertPanels: [] as string[],
    fxCalls: [] as Array<{ id: string; x: number; y: number; depth: number }>,
    panelHits: [] as Array<{ x: number; y: number; w: number; h: number; depth: number; handlers: { onClick?: () => void; onOver?: () => void } }>,
    add,
    tweens,
    time,
    markers,
    // ── Phaser 单子（结构面） ──
    // ── 共享件的场景薄封装 ──
    panelHit(x: number, y: number, w: number, h: number, depth: number, handlers: { onClick?: () => void; onOver?: () => void }) {
      host.panelHits.push({ x, y, w, h, depth, handlers });
      return add.rectangle(x, y, w, h, 0) as unknown as Phaser.GameObjects.Rectangle;
    },
    playFx(id: string, x: number, y: number, depth: number) {
      host.fxCalls.push({ id, x, y, depth });
      return null;
    },
    createMarker() {
      const m = new FakeObject();
      markers.push(m);
      return m as unknown as Phaser.GameObjects.Image;
    },
    // ── 场景能力 ──
    viewSize() {
      return { width: 1280, height: 720 };
    },
    setPanelBox(box: { x: number; y: number; w: number; h: number }): void {
      host.panelBoxes.push(box);
    },
    setEncounterOpen(open: boolean): void {
      host.encounterOpenCalls.push(open);
    },
    rebuildEncounterSpots(): void {
      host.rebuildCount += 1;
    },
    refreshStats(): void {
      host.statsRefreshCount += 1;
    },
    refreshInventory(): void {
      host.invRefreshCount += 1;
    },
    flash(message: string): void {
      host.flashes.push(message);
    },
    chargeTime(gameMinutes: number): void {
      host.chargeTimes.push(gameMinutes);
    },
    emitNpcTalked(npcId: string): void {
      host.npcTalked.push(npcId);
    },
    onUse(): void {
      host.useCalls.push(1);
    },
    assertPanelContent(panel: string): void {
      host.assertPanels.push(panel);
    },
  };
  return host as unknown as FakeHost;
}

// ── 装配助手 ───────────────────────────────────────────────────────────────

const ALIN = getNpc('alin');

/** 新局 + 控制器 + create 期装配（reset 先发两支标记——与 GameScene.create
 *  里的顺序逐字一致：重置块在前、build 在后；重启路径同样 reset+build）。 */
function boot(): { ctl: DialogueController; host: FakeHost } {
  const host = makeHost();
  const ctl = new DialogueController(host as unknown as DialogueHost);
  ctl.reset();
  ctl.build();
  return { ctl, host };
}

/** 账本夹具：在册名单 + 沉没资本（growth 由 ensureGrowth 补全形状）。 */
function seedVentures(state: GameState, ventures: string[], investedGold: number): void {
  const g = ensureGrowth(state);
  g.ventures = [...ventures];
  g.investedGold = investedGold;
}

/** 走到交易层（main → 交易）。 */
function enterTrade(ctl: DialogueController): void {
  ctl.activate(); // main selected=0 → 问候
  ctl.move(1);
  ctl.move(1); // selected=2 → 交易
  ctl.activate();
}

describe('DialogueController 对话树推进（open/main/trade/gift + back/退出）', () => {
  it('open 发放保鲜键并显示静态问候（AI 关闭即降级路径）', () => {
    startNewGame(42);
    const { ctl, host } = boot();
    ctl.open(ALIN);
    expect(ctl.isOpen).toBe(true);
    const snap = ctl.dialogueSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.message).toBe(ALIN.greetings[0]);
    expect(snap!.sessionId).toBe(1);
    expect(host.npcTalked).toEqual(['alin']);
    // 面板件显形（close 之前都可见）。
    const objs = ctl.panelObjectsForRecovery();
    expect(objs.length).toBeGreaterThan(0);
  });

  it('main 层四选项：问候/询问轮换台词，交易进交易层，退出关闭', () => {
    startNewGame(42);
    const { ctl } = boot();
    ctl.open(ALIN);
    ctl.activate(); // 0 问候 → greetings[0]（lineToggle 1）
    expect(ctl.dialogueSnapshot()!.message).toBe(ALIN.greetings[0]);
    ctl.activate(); // 仍是 0 → greetings[1]
    expect(ctl.dialogueSnapshot()!.message).toBe(ALIN.greetings[1]);
    ctl.move(1); // 1 询问
    ctl.activate();
    expect(ctl.dialogueSnapshot()!.message).toBe(ALIN.asks[0]);
    ctl.move(1); // 2 交易
    ctl.activate();
    expect(ctl.dialogueSnapshot()!.message).toBe('想换点什么？');
    // 交易层 back → main（消息清空）。
    ctl.back();
    expect(ctl.dialogueSnapshot()!.message).toBe('');
    // main 选退出 → 关闭。
    ctl.move(1);
    ctl.move(1);
    ctl.move(1); // 3 退出
    ctl.activate();
    expect(ctl.isOpen).toBe(false);
    expect(ctl.dialogueSnapshot()).toBeNull();
  });

  it('move 钳位：↑ 钳 0、↓ 钳扁平总数-1（越界不漂）', () => {
    startNewGame(42);
    const { ctl } = boot();
    ctl.open(ALIN);
    for (let i = 0; i < 10; i++) ctl.move(-1); // main 只有 4 行
    ctl.activate(); // 越界后仍是第 0 项 → 问候
    expect(ctl.dialogueSnapshot()!.message).toBe(ALIN.greetings[0]);
    enterTrade(ctl);
    for (let i = 0; i < 10; i++) ctl.move(1); // 交易层：报价×2 + 赠礼 + 返回
    ctl.activate(); // 钳在最后一项 = 返回 → 回 main
    expect(ctl.dialogueSnapshot()!.message).toBe('');
  });

  it('交易层：执行报价 0 换到电线（背包/分钟/存档回写）', () => {
    startNewGame(42);
    const state = getGame();
    addItem(state.player.inventory, 'scrap_metal', 1);
    const { ctl, host } = boot();
    ctl.open(ALIN);
    enterTrade(ctl);
    ctl.activate(); // 报价 0：废金属×1 → 电线×1
    const snap = ctl.dialogueSnapshot()!;
    expect(snap.message).toContain('换到了 电线×1');
    expect(snap.message).toContain(`-${ACTION_COSTS.trade} 分钟`);
    expect(countItem(state.player.inventory, 'wire')).toBe(1);
    expect(countItem(state.player.inventory, 'scrap_metal')).toBe(0);
    expect(host.invRefreshCount).toBe(1);
    expect(host.chargeTimes).toEqual([ACTION_COSTS.trade]);
    // 会话 revision 因玩家操作 +1（在途 AI 结果过期）。
    expect(snap.sessionId).toBe(1);
  });

  it('交易层：报价失败时 reason 原文显示、无半成交', () => {
    startNewGame(42);
    const state = getGame();
    const { ctl, host } = boot();
    ctl.open(ALIN);
    enterTrade(ctl);
    ctl.activate(); // 没有废金属 → 被拒
    const snap = ctl.dialogueSnapshot()!;
    expect(snap.message).toContain('废金属');
    expect(countItem(state.player.inventory, 'wire')).toBe(0);
    expect(host.chargeTimes).toEqual([]); // 失败不扣分钟
  });

  it('赠礼层：整叠送出第一格（扣分钟 + 背包刷新 + reason 不静默）', () => {
    startNewGame(42);
    const state = getGame();
    // 新局起始背包第一格（净水×3）——整叠送出，一次 receiveGift 一笔记忆。
    const first = state.player.inventory.slots[0];
    expect(first).toBeDefined();
    const qty = first.quantity; // 先捕获（激活后槽位会被 mutate 成 0）
    const { ctl, host } = boot();
    ctl.open(ALIN);
    enterTrade(ctl);
    ctl.move(1);
    ctl.move(1); // 2 赠礼
    ctl.activate(); // 进赠礼层
    expect(ctl.dialogueSnapshot()!.message).toBe('想送点什么？');
    ctl.activate(); // 扁平第 0 项 = 第一格
    const snap = ctl.dialogueSnapshot()!;
    expect(snap.message).toContain(`送出 ${getItem(first.itemId).displayName}×${qty}`);
    expect(snap.message).toContain(`-${ACTION_COSTS.trade} 分钟`);
    expect(countItem(state.player.inventory, first.itemId)).toBe(0);
    expect(host.invRefreshCount).toBe(1);
    expect(host.chargeTimes).toEqual([ACTION_COSTS.trade]);
  });

  it('赠礼层：背包真的空了时 Enter 回落交易层并说明白', () => {
    startNewGame(42);
    const state = getGame();
    state.player.inventory.slots.length = 0; // 清空（ giftOffer 无记忆时也无回赠可领）
    const { ctl } = boot();
    ctl.open(ALIN);
    enterTrade(ctl);
    ctl.move(1);
    ctl.move(1);
    ctl.activate(); // 进赠礼层
    ctl.activate(); // 空背包 → 回落
    expect(ctl.dialogueSnapshot()!.message).toBe('背包是空的，没什么可送。');
  });

  it('back 逐层回退：gift → trade → main → 关闭', () => {
    startNewGame(42);
    const { ctl } = boot();
    ctl.open(ALIN);
    enterTrade(ctl);
    ctl.move(1);
    ctl.move(1);
    ctl.activate(); // 赠礼层
    ctl.back(); // → trade
    expect(ctl.dialogueSnapshot()!.message).toBe('想换点什么？');
    ctl.back(); // → main
    expect(ctl.dialogueSnapshot()!.message).toBe('');
    ctl.back(); // main → 关闭
    expect(ctl.isOpen).toBe(false);
  });
});

describe('DialogueController 行商面板（当日双货架 + 买卖 + 光标）', () => {
  it('openShop 装配两块货架（商品 + 当日牌价材料）并占面板槽', () => {
    startNewGame(42);
    const { ctl, host } = boot();
    ctl.openShop();
    expect(host.encounterOpenCalls).toEqual([true]);
    const texts = host.add.texts.map((t) => t.text);
    expect(texts).toContain('行商');
    expect(texts.some((t) => t.startsWith('材料货架 · 第'))).toBe(true);
    expect(texts).toContain('Enter 买入 · S 卖出选中的一件 · ESC 离开');
    // 每行都带价格与持有数；purse 行读金币。
    expect(texts.some((t) => / 金 · 持 \d+$/.test(t))).toBe(true);
    expect(texts).toContain('0 金');
    // 鼠标 ESC 判据随面板几何走。
    expect(host.panelBoxes[host.panelBoxes.length - 1]).toEqual({ x: 420, y: 148, w: 440, h: 424 });
  });

  it('shopBuy 扣金币入包（coin 特效委托 + HUD 双刷新）', () => {
    startNewGame(42);
    const state = getGame();
    state.player.gold = 100;
    const { ctl, host } = boot();
    ctl.openShop();
    const goldBefore = state.player.gold;
    ctl.shopBuy();
    const state2 = getGame();
    expect(state2.player.gold).toBeLessThan(goldBefore);
    expect(host.invRefreshCount).toBe(1);
    expect(host.statsRefreshCount).toBe(1);
    expect(host.fxCalls.some((f) => f.id === 'coin-spin')).toBe(true);
  });

  it('shopBuy 金币不够时 flash 原因、不动包', () => {
    startNewGame(42);
    const state = getGame();
    state.player.gold = 0;
    const { ctl, host } = boot();
    ctl.openShop();
    ctl.shopBuy();
    expect(host.flashes.some((m) => m.includes('金币不够'))).toBe(true);
    expect(host.fxCalls).toEqual([]);
  });

  it('shopSell 卖出选中的一件：金币进账 + 卖出进账记账', () => {
    startNewGame(42);
    const state = getGame();
    addItem(state.player.inventory, 'bread', 2); // 行 0 = 商品架 band2 的 bread
    const { ctl, host } = boot();
    ctl.openShop();
    const goldBefore = state.player.gold;
    ctl.shopSell();
    expect(getGame().player.gold).toBeGreaterThan(goldBefore);
    expect(host.flashes.length).toBe(1);
    expect(countItem(getGame().player.inventory, 'bread')).toBe(1);
    // coin 特效 + HUD 双刷新与买方向同链路。
    expect(host.fxCalls.some((f) => f.id === 'coin-spin')).toBe(true);
    expect(host.invRefreshCount).toBe(1);
    expect(host.statsRefreshCount).toBe(1);
  });

  it('shopMove 钳位 0..行数-1 且每次重画面板', () => {
    startNewGame(42);
    const { ctl, host } = boot();
    ctl.openShop();
    const before = host.add.texts.length;
    for (let i = 0; i < 30; i++) ctl.shopMove(1);
    // 钳到最后一行：面板重建过（文本变多），且不抛。
    expect(host.add.texts.length).toBeGreaterThan(before);
    ctl.shopMove(-1);
    ctl.shopMove(-1);
    // 一路 ↑ 回第 0 行仍稳。
    for (let i = 0; i < 30; i++) ctl.shopMove(-1);
    expect(host.flashes).toEqual([]);
  });

  it('closeShop 释放面板槽并重建世界行商点', () => {
    startNewGame(42);
    const { ctl, host } = boot();
    ctl.openShop();
    ctl.closeShop();
    expect(host.encounterOpenCalls).toEqual([true, false]);
    expect(host.rebuildCount).toBe(1);
  });
});

describe('DialogueController 产业投资面板（开关/入股/账本观察）', () => {
  it('toggleVentures 开关 + 打开即补一次幂等结算', () => {
    startNewGame(42);
    const { ctl, host } = boot();
    expect(ctl.ventureIsOpen).toBe(false);
    ctl.toggleVentures();
    expect(ctl.ventureIsOpen).toBe(true);
    const texts = host.add.texts.map((t) => t.text);
    expect(texts).toContain('产业投资');
    expect(texts.some((t) => t.startsWith('已投入'))).toBe(true);
    expect(texts.some((t) => t.startsWith('昨日收益'))).toBe(true);
    expect(texts).toContain('↑/↓ 选择 · Enter 入股 · G 离开');
    expect(host.assertPanels).toContain('venture');
    ctl.toggleVentures(); // 再按 = 关
    expect(ctl.ventureIsOpen).toBe(false);
  });

  it('activateVenture 入股成功：在册 + 金币扣减 + HUD 刷新', () => {
    startNewGame(42);
    const state = getGame();
    state.player.gold = 100; // 宿舍水站 40 金，够
    const { ctl, host } = boot();
    ctl.toggleVentures();
    ctl.activateVenture(); // 默认选 VENTURES[0] = 宿舍水站（40 金）
    const after = getGame();
    expect(after.player.gold).toBe(60);
    expect(after.growth?.ventures).toContain('water_stall');
    expect(host.statsRefreshCount).toBe(1);
    expect(host.flashes[0]).toContain('入股'); // invest 的 reason 原文
  });

  it('activateVenture 重复入股被拒：invest 原子、账本不动', () => {
    startNewGame(42);
    const state = getGame();
    state.player.gold = 100;
    const { ctl, host } = boot();
    ctl.toggleVentures();
    ctl.activateVenture();
    const goldAfterFirst = getGame().player.gold;
    ctl.activateVenture(); // 已在册 → 拒绝
    expect(getGame().player.gold).toBe(goldAfterFirst);
    expect(host.flashes[1]).toBe('已经入过这门股了');
    expect(getGame().growth?.ventures).toEqual(['water_stall']);
  });

  it('activateVenture 金币不够：reason 原文、账本不动', () => {
    startNewGame(42);
    const state = getGame();
    state.player.gold = 0;
    const { ctl, host } = boot();
    ctl.toggleVentures();
    ctl.activateVenture();
    expect(host.flashes[0]).toContain('金币不够');
    expect(getGame().growth?.ventures ?? []).toEqual([]);
  });

  it('diffVentureLedger 观察收益：进账累计进 flags + flash 延后排程', () => {
    startNewGame(42);
    const state = getGame();
    seedVentures(state, ['water_stall'], 40);
    const { ctl, host } = boot();
    // 时钟推进过后账本变了：+12 金、产业仍在册。
    state.player.gold = 12;
    ctl.diffVentureLedger({ gold: 0, ventures: ['water_stall'] });
    expect(flagCount(getGame(), 'economy:venture-income-total')).toBe(12);
    // flash 不在当场刷——延后到夜间事件播报之后（VENTURE_FLASH_DELAY_MS）。
    expect(host.flashes).toEqual([]);
    expect(host.time.calls.map((c) => c.delay)).toEqual([1700]);
    host.time.fire(1700);
    expect(host.flashes).toEqual(['产业结算：第 0 天进账 +12 金']);
  });

  it('diffVentureLedger 观察倒塌：本金全损的台词进延后 flash', () => {
    startNewGame(42);
    const state = getGame();
    seedVentures(state, [], 40);
    const { ctl, host } = boot();
    ctl.diffVentureLedger({ gold: 0, ventures: ['water_stall'] }); // 在册 → 没了
    host.time.fire(1700);
    expect(host.flashes).toEqual(['宿舍水站倒闭了，投入的本金全损']);
  });

  it('ventureLedgerSnapshot 读账本（gold + 在册名单）', () => {
    startNewGame(42);
    const state = getGame();
    state.player.gold = 77;
    seedVentures(state, ['stall'], 30);
    const { ctl } = boot();
    expect(ctl.ventureLedgerSnapshot()).toEqual({ gold: 77, ventures: ['stall'] });
  });
});

describe('DialogueController AI 降级路径与保鲜（无模型环境）', () => {
  it('enhanceOpeningLine 空转：静态问候不被替换、交互不卡', async () => {
    startNewGame(42);
    const { ctl } = boot();
    ctl.open(ALIN);
    // open 内部 fire-and-forget 了 enhanceOpeningLine；AI 未配置时它第一行
    // 就 return——给 microtask 一个落点后消息必须仍是原句。
    await Promise.resolve();
    await Promise.resolve();
    expect(ctl.dialogueSnapshot()!.message).toBe(ALIN.greetings[0]);
    // 关掉再开：sessionId 递增（保鲜键换新），消息回到静态句。
    ctl.close();
    ctl.open(ALIN);
    const snap = ctl.dialogueSnapshot()!;
    expect(snap.sessionId).toBe(2);
    expect(snap.message).toBe(ALIN.greetings[0]);
  });

  it('玩家操作 revision+1：activate 后快照的会话仍稳定（sessionId 不变）', () => {
    startNewGame(42);
    const { ctl } = boot();
    ctl.open(ALIN);
    const s0 = ctl.dialogueSnapshot()!;
    ctl.activate(); // 问候
    const s1 = ctl.dialogueSnapshot()!;
    expect(s1.sessionId).toBe(s0.sessionId); // 同一场对话
    ctl.close();
    ctl.open(ALIN);
    expect(ctl.dialogueSnapshot()!.sessionId).toBe(s0.sessionId + 1);
  });
});

describe('DialogueController 重启 reset 与恢复路径面', () => {
  it('reset 清对话态与面板件、发新标记（对话/产业各一支）', () => {
    startNewGame(42);
    const { ctl, host } = boot();
    const markersBefore = host.markers.length; // boot 的 reset 已发两支
    ctl.open(ALIN);
    ctl.toggleVentures();
    expect(ctl.isOpen).toBe(true);
    expect(ctl.ventureIsOpen).toBe(true);
    ctl.reset();
    expect(ctl.isOpen).toBe(false);
    expect(ctl.dialogueSnapshot()).toBeNull();
    expect(ctl.ventureIsOpen).toBe(false);
    // 两支新标记（host.createMarker 又被调了两次）。
    expect(host.markers.length).toBe(markersBefore + 2);
  });

  it('panelObjectsForRecovery 覆盖对话/行商/产业三组', () => {
    startNewGame(42);
    const { ctl } = boot();
    ctl.open(ALIN);
    ctl.openShop();
    ctl.toggleVentures();
    const objs = ctl.panelObjectsForRecovery();
    // 对话面板件 + 行商面板件 + 产业面板件都在（数量级 sanity，非精确计数）。
    expect(objs.length).toBeGreaterThan(30);
  });

  it('reset 后 build 再走一遍：场景重启路径不双份上屏', () => {
    startNewGame(42);
    const { ctl, host } = boot();
    ctl.open(ALIN);
    ctl.reset();
    ctl.build();
    const textsBefore = host.add.texts.length;
    ctl.open(ALIN); // 不抛（stale Text setText 的防御由 reset+build 保证）
    expect(ctl.dialogueSnapshot()!.message).toBe(ALIN.greetings[0]);
    expect(host.add.texts.length).toBeGreaterThan(textsBefore - 1);
  });
});
