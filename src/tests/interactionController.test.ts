// InteractionController 单测（RC-03 拆分第 10 步的「测试镜像」）。
// 设计文档 §5：控制器单测从场景测试里抽，记录型假件模式（前九步同款：
// dialogueController / hudController / combatController / navBarController）。
// 纯逻辑四件套由既有测试直守，不在这里重测——搜刮/床铺/阻碍物
// （systems/LootSystem：searchBunk/dismantleBunk/obstaclesForFloor/
// clearObstacle/lootContainer，obstacles.test.ts/bedAndWorkbench.test.ts）、
// 夜间安排与入夜判定（systems/ShelterSystem/NightSystem，shelter.test.ts/
// nightChoice.test.ts）、付费捷径计价（systems/shortcut.ts，
// stairNavigation.spec.ts）——这里守的是**控制器编排**：
//   · 床铺交互排序：自己的床夜里睡/白天翻、室友床先搜后拆（没工具说明天
//     再来）、bunkHint 五条文案与判定同源；
//   · 2s 动作起落：beginPendingAction 起动作（search clip + 作废走位订单）、
//     cancel/finish 两出口、delayedCall 身份比对（取消过的旧 timer 不落地）、
//     楼层不符就地作废、起新动作静默收掉旧动作；
//   · 阻碍物：buildObstacles 的名册/上屏/深度、nearestObstacle 距离判定、
//     tryClearObstacle 的工具门与挖掘动作、finishObstacleDig 的清障回写；
//   · 三面板编排：特写开关/翻页环游、夜间安排开面板与光标记忆、入夜二选一
//     的确认/暂拒、activateShelterChoice 的睡觉委托（host.sleepNight）；
//   · 付费捷径：zone 门/扣费门/跳层回写（rebuildFloor + 相机闪白）；
//   · 契约面：pendingAction/floorObstacles/activeObstacleList 三个 e2e 读数、
//     panelObjectsForRecovery、reset/clearFloorState 的重启与换层语义。
//
// 为什么能在 Node 下跑：控制器的 import 链无 Phaser 值导入（host 是结构面
// 假件；共享面板渲染件 buildPanel/buildPanelHeader/buildPanelWell/
// buildListRow/applyPanelDepth/lockToScreen 只碰 add 工厂与链式 setter——
// 假件全数桩掉）。SaveSystem 的 saveToStorage 走 localStorage 默认参——
// 本文件顶部装内存 Storage 假件（vitest 每文件独立环境）。playSfx 的
// AudioSystem 自带 Node 退路。

import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';

import { InteractionController, type InteractionHost, type PendingAction } from '../scenes/controllers/InteractionController';
import { startNewGame, getGame } from '../core/session';
import { addItem } from '../systems/InventorySystem';
import { asItemId } from '../data/items';
import { getFloorView, recordFloorVisit } from '../systems/LootSystem';
import { ACTION_COSTS, isNight } from '../systems/SurvivalSystem';
import { BED_X, STARTING_FLOOR } from '../core/constants';
import { OBSTACLE_DIG_COST_MINUTES, OBSTACLE_DIG_MS, SEARCH_MS } from '../systems/LootSystem';
import { WALL_DECO } from '../data/wallDeco';
import type { GeneratedContainer, GroundItem } from '../core/gameTypes';
import type { CharacterKey } from '../render/artpack';
import { shortcutPlan } from '../systems/shortcut';

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
    this.map.set(String(key), String(value));
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
  readonly draws: string[] = [];
  constructor(x = 0, y = 0, key = '') {
    this.x = x;
    this.y = y;
    this.textureKey = key;
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
  destroy(): this {
    this.destroyed = true;
    return this;
  }
  getBounds(): { x: number; y: number; left: number; width: number; height: number } {
    return { x: this.x, y: this.y, left: this.x, width: 16, height: 16 };
  }
}

/** Text 假件：记 text/style（面板行标签与标题都从它读）。 */
class FakeText extends FakeObject {
  constructor(
    x: number,
    y: number,
    readonly text: string,
    readonly style: Record<string, unknown> = {},
  ) {
    super(x, y);
  }
  get type(): string {
    return 'Text';
  }
}

/** Graphics 假件：记画法调用（阻碍物的 fillRect/fillTriangle 计数）。 */
class FakeGraphics extends FakeObject {
  get type(): string {
    return 'Graphics';
  }
  clear(): this {
    this.draws.length = 0;
    return this;
  }
  fillStyle(): this {
    return this;
  }
  fillRect(): this {
    this.draws.push('fillRect');
    return this;
  }
  fillTriangle(): this {
    this.draws.push('fillTriangle');
    return this;
  }
  lineStyle(): this {
    return this;
  }
  strokeRect(): this {
    this.draws.push('strokeRect');
    return this;
  }
  lineBetween(): this {
    this.draws.push('lineBetween');
    return this;
  }
}

/** add 工厂假件：按 type 分派，全部进 recorder。 */
class FakeAddFactory {
  readonly made: FakeObject[] = [];
  text(x: number, y: number, t: string, style: Record<string, unknown>): FakeText {
    const o = new FakeText(x, y, t, style);
    this.made.push(o);
    return o;
  }
  image(x: number, y: number, key: string): FakeObject {
    const o = new FakeObject(x, y, key);
    this.made.push(o);
    return o;
  }
  rectangle(x: number, y: number, _w: number, _h: number, _color: number): FakeObject {
    const o = new FakeObject(x, y);
    this.made.push(o);
    return o;
  }
  graphics(): FakeGraphics {
    const o = new FakeGraphics();
    this.made.push(o);
    return o;
  }
}

/** 记录型 host：调用全记录，延迟回调攒着不自动跑（测试手动 fireTimers）。 */
class FakeHost implements InteractionHost {
  private readonly addFactory = new FakeAddFactory();
  readonly add = this.addFactory as unknown as Phaser.GameObjects.GameObjectFactory;
  readonly flashes: string[] = [];
  readonly actionAnims: Array<{ key: string; ms: number }> = [];
  readonly fx: Array<{ id: string; x: number; y: number }> = [];
  readonly chargeTimes: number[] = [];
  readonly lootAdded: number[] = [];
  readonly achievements: unknown[] = [];
  readonly panelBoxes: Array<{ x: number; y: number; w: number; h: number }> = [];
  readonly panelObjects: string[] = [];
  readonly floorPushed: FakeObject[] = [];
  readonly markers: FakeObject[] = [];
  readonly walkOrdersCancelled: number[] = { value: 0 } as unknown as number[] & { value: number };
  rebuildCount = 0;
  cameraFlashes: Array<{ ms: number; r: number; g: number; b: number }> = [];
  sleepNightCalls = 0;
  refreshInventoryCalls = 0;
  refreshFloorViewCalls = 0;
  containerEmptyVisual: Array<{ id: string; empty: boolean }> = [];
  removedBunks: string[] = [];
  onUseCalls = 0;
  now = 10_000;
  private timers: Array<{ ms: number; cb: () => void; fired: boolean }> = [];

  // ── Phaser 单子 ──
  get time(): Phaser.Time.Clock {
    const self = this;
    return {
      get now(): number {
        return self.now;
      },
      delayedCall(ms: number, cb: () => void): { remove: (_fire: boolean) => void } {
        const entry = { ms, cb, fired: false };
        self.timers.push(entry);
        return { remove: (): void => undefined };
      },
    } as unknown as Phaser.Time.Clock;
  }
  get cameras(): Phaser.Cameras.Scene2D.CameraManager {
    const self = this;
    return {
      main: {
        flash: (ms: number, r: number, g: number, b: number): void => {
          self.cameraFlashes.push({ ms, r, g, b });
        },
      },
    } as unknown as Phaser.Cameras.Scene2D.CameraManager;
  }

  // ── 共享件薄封装 ──
  panelHit(_x: number, _y: number, _w: number, _h: number, _depth: number, handlers: { onClick?: () => void }): Phaser.GameObjects.Rectangle {
    const o = new FakeObject();
    if (handlers?.onClick) (o as unknown as { onClick: () => void }).onClick = handlers.onClick;
    this.panelObjects.push('hit');
    return o as unknown as Phaser.GameObjects.Rectangle;
  }
  createMarker(): Phaser.GameObjects.Image {
    const o = new FakeObject();
    this.markers.push(o);
    return o as unknown as Phaser.GameObjects.Image;
  }
  playActionAnim(key: string, ms: number): void {
    this.actionAnims.push({ key, ms });
  }
  playFx(id: string, x: number, y: number, _depth: number): null {
    this.fx.push({ id, x, y });
    return null;
  }
  viewSize(): { width: number; height: number } {
    return { width: 1280, height: 720 };
  }
  setPanelBox(box: { x: number; y: number; w: number; h: number }): void {
    this.panelBoxes.push(box);
  }
  assertPanelContent(): void {
    /* dev 自查，Node 下空转 */
  }
  textureSize(): { width: number; height: number } {
    return { width: 300, height: 300 };
  }
  metaSelectedCharacter(): CharacterKey {
    return 'player';
  }

  // ── 场景查询 ──
  anyPanelOpenValue = false;
  anyPanelOpen(): boolean {
    return this.anyPanelOpenValue;
  }
  onUse(): void {
    this.onUseCalls += 1;
  }

  // ── 世界状态（默认喂真楼层视图；测试可覆写） ──
  containers: Array<{ id: string; x: number; label: string; items: unknown[]; needs?: string }> = [];
  groundItemsFeed: Array<{ key: string; x: number; itemId: string; quantity: number }> = [];
  bunkList: Array<{ id: string; x: number; own: boolean }> = [];
  floorContainers(): GeneratedContainer[] {
    return this.containers as unknown as GeneratedContainer[];
  }
  groundItems(): GroundItem[] {
    return this.groundItemsFeed as unknown as GroundItem[];
  }
  refreshFloorView(): void {
    this.refreshFloorViewCalls += 1;
  }
  setContainerEmptyVisual(id: string, empty: boolean): void {
    this.containerEmptyVisual.push({ id, empty });
  }
  groundObject(): undefined {
    return undefined;
  }
  forgetGroundObject(): void {
    /* 簿记留场景，Node 下空转 */
  }
  bunks(): Array<{ id: string; x: number; own: boolean }> {
    return this.bunkList;
  }
  removeBunk(id: string): void {
    this.removedBunks.push(id);
  }
  pushFloorObject(o: Phaser.GameObjects.GameObject): void {
    this.floorPushed.push(o as unknown as FakeObject);
  }
  cancelWalkOrder(): void {
    (this.walkOrdersCancelled as unknown as { value: number }).value += 1;
  }
  rebuildFloor(): void {
    this.rebuildCount += 1;
  }

  // ── HUD/时钟/账目/成就 ──
  flash(message: string): void {
    this.flashes.push(message);
  }
  chargeTime(gameMinutes: number): void {
    this.chargeTimes.push(gameMinutes);
  }
  refreshInventory(): void {
    this.refreshInventoryCalls += 1;
  }
  addLootThisTrip(quantity: number): void {
    this.lootAdded.push(quantity);
  }
  emitAchievementEvent(event: unknown): string[] {
    this.achievements.push(event);
    return [];
  }
  sleepNight(): void {
    this.sleepNightCalls += 1;
  }

  // ── 测试助手 ──
  /** 手动触发所有未跑的 delayedCall（模拟「到点」）。 */
  fireTimers(): void {
    for (const t of this.timers) {
      if (!t.fired) {
        t.fired = true;
        t.cb();
      }
    }
  }
  /** 取最近一次 add.text 的文本集合（面板装配取证）。 */
  panelTexts(): string[] {
    return this.addFactory.made.filter((o): o is FakeText => o instanceof FakeText).map((o) => o.text);
  }
}

// ── 装配助手 ─────────────────────────────────────────────────────────────

/** 新档 + host 假件 + 控制器三件套；state 走产品自己的 startNewGame。 */
function setup(seed = 42): { ctl: InteractionController; host: FakeHost; state: ReturnType<typeof startNewGame> } {
  const state = startNewGame(seed);
  const host = new FakeHost();
  const ctl = new InteractionController(host);
  ctl.reset();
  // 预置楼层访问簿记（正常由 drawFloor 的 recordFloorVisit 写）——床铺/阻碍物
  // 的 lootedItems 键要挂在其上。
  recordFloorVisit(state, STARTING_FLOOR);
  recordFloorVisit(state, 2);
  // 喂真楼层视图（floor 1 的容器/地面物）——lootContainer/searchBunk 等纯函数
  // 与控制器读同一份数据，编排断言才落在真状态上。
  const view = getFloorView(state, state.currentFloor);
  host.containers = view.containers.map((c) => ({ id: c.id, x: c.x, label: c.label, items: c.items, needs: c.needs }));
  host.groundItemsFeed = view.groundItems.map((g) => ({ key: g.key, x: g.x, itemId: g.itemId, quantity: g.quantity }));
  return { ctl, host, state };
}

/** 1 层室友床（drawDormBeds 前排第一张的坐标派生命名，与场景注册同规则）。 */
const ROOMMATE_BUNK = { id: 'dorm_bed_1_236', x: 236, own: false };

// ── 床铺交互（AG-51） ─────────────────────────────────────────────────────

describe('床铺交互排序与提示', () => {
  it('nearestInteractiveBunk 取距离最近且没拆的床', () => {
    const { ctl, host, state } = setup();
    host.bunkList = [ROOMMATE_BUNK, { id: 'own_bed_1', x: BED_X, own: true }];
    state.player.x = 260;
    expect(ctl.nearestInteractiveBunk()?.id).toBe('dorm_bed_1_236');
    state.player.x = BED_X;
    expect(ctl.nearestInteractiveBunk()?.id).toBe('own_bed_1');
    // 拆过的床不再算（bunkgone 键）——站在它原位上也没有床可交互。
    state.visitedFloors[STARTING_FLOOR].lootedItems.push('bunkgone:1:dorm_bed_1_236');
    state.player.x = 236;
    expect(ctl.nearestInteractiveBunk()).toBeNull();
    state.player.x = BED_X;
    expect(ctl.nearestInteractiveBunk()?.id).toBe('own_bed_1');
  });

  it('自己的床白天翻床垫（起 2s bunk 动作），夜里走睡觉（开夜间安排）', () => {
    const { ctl, host, state } = setup();
    host.bunkList = [{ id: 'own_bed_1', x: BED_X, own: true }];
    state.player.x = BED_X;
    state.gameMinuteOfDay = 600; // 10:00 白天
    ctl.interactWithBunk(state, { id: 'own_bed_1', x: BED_X, own: true });
    expect(ctl.pendingAction?.kind).toBe('bunk');
    expect(ctl.pendingAction?.busyHint).toBe('翻找床垫中……');
    // 夜里：场景侧第二下 E 先被 pendingAction 分支收掉，再走睡觉。
    state.gameMinuteOfDay = 1200; // 20:00 后
    ctl.cancelPendingAction(true);
    ctl.interactWithBunk(state, { id: 'own_bed_1', x: BED_X, own: true });
    expect(ctl.pendingAction).toBeUndefined();
    expect(ctl.shelterOpen).toBe(true);
    expect(host.panelTexts()).toContain('夜间安排 · 宿舍');
  });

  it('室友床：没翻过 → 搜刮动作；翻过没工具 → 说明天；翻过有撬棍 → 拆解', () => {
    const { ctl, host, state } = setup();
    host.bunkList = [ROOMMATE_BUNK];
    state.player.x = 236;
    // ① 第一次：起搜刮动作。
    ctl.interactWithBunk(state, ROOMMATE_BUNK);
    expect(ctl.pendingAction?.kind).toBe('bunk');
    ctl.cancelPendingAction(true);
    // ② 标记今天翻过（bunksearch 键），没有工具 → 一句话打发。
    state.visitedFloors[STARTING_FLOOR].lootedItems.push(`bunksearch:${STARTING_FLOOR}:dorm_bed_1_236:${state.day}`);
    host.flashes.length = 0;
    ctl.interactWithBunk(state, ROOMMATE_BUNK);
    expect(ctl.pendingAction).toBeUndefined();
    expect(host.flashes).toContain('这张床今天已经翻过了，明天再来');
    // ③ 包里塞撬棍 → 拆解：removeBunk 委托 + 520ms 拆床 clip + 出货 flash。
    addItem(state.player.inventory, 'crowbar', 1);
    host.flashes.length = 0;
    ctl.interactWithBunk(state, ROOMMATE_BUNK);
    expect(host.removedBunks).toEqual(['dorm_bed_1_236']);
    expect(host.actionAnims.at(-1)).toEqual({ key: 'search-player', ms: 520 });
    expect(host.flashes.some((f) => f.startsWith('拆了床，得到'))).toBe(true);
  });

  it('bunkHint 五条文案与判定同源', () => {
    const { ctl, host, state } = setup();
    host.bunkList = [{ id: 'own_bed_1', x: BED_X, own: true }, ROOMMATE_BUNK];
    state.player.x = BED_X;
    state.gameMinuteOfDay = 600;
    expect(ctl.bunkHint(state)).toBe('按 E 翻翻自己的床');
    state.visitedFloors[STARTING_FLOOR].lootedItems.push(`bunksearch:${STARTING_FLOOR}:own_bed_1:${state.day}`);
    expect(ctl.bunkHint(state)).toBe('自己的床今天翻过了');
    state.gameMinuteOfDay = 1200;
    expect(ctl.bunkHint(state)).toBe('按 E 安排夜间行动');
    state.player.x = 236;
    state.gameMinuteOfDay = 600;
    expect(ctl.bunkHint(state)).toBe('按 E 搜刮床铺');
    state.visitedFloors[STARTING_FLOOR].lootedItems.push(`bunksearch:${STARTING_FLOOR}:dorm_bed_1_236:${state.day}`);
    expect(ctl.bunkHint(state)).toBe('这张床今天翻过了');
    addItem(state.player.inventory, 'crowbar', 1);
    expect(ctl.bunkHint(state)).toBe('按 E 拆解床铺');
  });

  it('isNearBed 只认起始层的自己的床', () => {
    const { ctl, state } = setup();
    state.player.x = BED_X;
    expect(ctl.isNearBed()).toBe(true);
    state.player.x = BED_X + 60;
    expect(ctl.isNearBed()).toBe(false);
    state.currentFloor = 2;
    state.player.x = BED_X;
    expect(ctl.isNearBed()).toBe(false);
  });
});

// ── 2s 搜刮/挖掘动作编排（AG-66） ─────────────────────────────────────────

describe('2s 动作编排（身份比对/楼层门/起落）', () => {
  it('openContainer 起容器动作：search clip + 作废走位订单 + busy 文案', () => {
    const { ctl, host, state } = setup();
    const target = host.containers.find((c) => c.items.length > 0);
    expect(target, '1 层应有非空容器').toBeTruthy();
    state.player.x = target!.x;
    ctl.openContainer(target!.id);
    expect(ctl.pendingAction?.kind).toBe('container');
    expect(ctl.pendingAction?.busyHint).toBe(`翻找${target!.label}中……`);
    expect(ctl.pendingAction?.until).toBe(host.now + SEARCH_MS);
    expect(host.actionAnims.at(-1)).toEqual({ key: 'search-player', ms: SEARCH_MS });
    expect((host.walkOrdersCancelled as unknown as { value: number }).value).toBe(1);
  });

  it('锁着的容器（需要工具）不出动作，直接说缺什么', () => {
    const { ctl, host } = setup();
    host.containers = [{ id: 'safe', x: 300, label: '保险箱', items: [{ itemId: 'bread', quantity: 1 }], needs: 'crowbar' }];
    ctl.openContainer('safe');
    expect(ctl.pendingAction).toBeUndefined();
    expect(host.flashes).toContain('保险箱锁着，需要撬棍');
  });

  it('到点落地：容器出货（获得 flash + 扣 searchContainer 分钟 + 刷新链）', () => {
    const { ctl, host, state } = setup();
    const target = host.containers.find((c) => c.items.length > 0)!;
    state.player.x = target.x;
    ctl.openContainer(target.id);
    host.fireTimers();
    expect(ctl.pendingAction).toBeUndefined();
    expect(host.refreshFloorViewCalls).toBe(1);
    expect(host.containerEmptyVisual.length).toBe(1);
    expect(host.refreshInventoryCalls).toBe(1);
    // 出货与否随 seeded roll——两条分支的回写都断言。
    const landed = host.flashes.find((f) => f.startsWith('获得') || f === `${target.label} 是空的`);
    expect(landed, '落地必有一句结果').toBeTruthy();
    if (landed!.startsWith('获得')) {
      expect(host.chargeTimes).toContain(ACTION_COSTS.searchContainer);
      expect(state.visitedFloors[state.currentFloor].openedContainers).toContain(target.id);
    }
  });

  it('身份比对：取消过的动作，旧 timer 到点不落地', () => {
    const { ctl, host, state } = setup();
    const target = host.containers.find((c) => c.items.length > 0)!;
    state.player.x = target.x;
    ctl.openContainer(target.id);
    host.flashes.length = 0;
    ctl.cancelPendingAction();
    expect(host.flashes).toContain('你直起身来，没翻完');
    expect(ctl.pendingAction).toBeUndefined();
    host.fireTimers(); // 旧 timer 到点——身份比对拦下
    expect(host.refreshFloorViewCalls).toBe(0);
    expect(host.flashes.filter((f) => f.startsWith('获得')).length).toBe(0);
  });

  it('楼层不符就地作废：换层后旧动作不落地', () => {
    const { ctl, host, state } = setup();
    const target = host.containers.find((c) => c.items.length > 0)!;
    state.player.x = target.x;
    ctl.openContainer(target.id);
    state.currentFloor = 2; // 模拟换层（clearFloorState 之外的兜底）
    ctl.finishPendingAction();
    expect(host.refreshFloorViewCalls).toBe(0);
  });

  it('起新动作静默收掉旧动作（无取消 flash）', () => {
    const { ctl, host, state } = setup();
    const target = host.containers.find((c) => c.items.length > 0)!;
    state.player.x = target.x;
    ctl.openContainer(target.id);
    host.flashes.length = 0;
    ctl.openContainer(target.id);
    expect(host.flashes, '静默收手不弹取消语').toEqual([]);
    expect(ctl.pendingAction?.kind).toBe('container');
  });

  it('床铺搜刮到点：searchBunk 落地（翻过键 + 结果 flash + 扣分钟）', () => {
    const { ctl, host, state } = setup();
    host.bunkList = [ROOMMATE_BUNK];
    state.player.x = 236;
    ctl.interactWithBunk(state, ROOMMATE_BUNK);
    host.fireTimers();
    expect(state.visitedFloors[STARTING_FLOOR].lootedItems.some((k) => k.startsWith(`bunksearch:${STARTING_FLOOR}:dorm_bed_1_236:`))).toBe(true);
    expect(host.chargeTimes.length).toBe(1);
  });
});

// ── 阻碍物（AG-66） ───────────────────────────────────────────────────────

describe('阻碍物名册与挖掘编排', () => {
  it('buildObstacles：名册入列 + 每枚上屏 + 演员层深度', () => {
    const { ctl, host, state } = setup();
    state.currentFloor = 2; // seed 42：瓦砾@222 那一层
    ctl.buildObstacles();
    expect(ctl.floorObstacles.length, '2 层有阻碍物全集').toBeGreaterThan(0);
    expect(ctl.activeObstacleList.length).toBe(ctl.floorObstacles.length);
    expect(host.floorPushed.length).toBe(ctl.floorObstacles.length);
    for (const o of host.floorPushed) expect(o.depth).toBe(5); // ACTOR_DEPTH
  });

  it('nearestObstacle 只在交互距离内认；挖过的退出 active', () => {
    const { ctl, state } = setup();
    state.currentFloor = 2;
    ctl.buildObstacles();
    const rubble = ctl.floorObstacles[0];
    state.player.x = rubble.x + 10;
    expect(ctl.nearestObstacle()?.x).toBe(rubble.x);
    state.player.x = rubble.x + 100;
    expect(ctl.nearestObstacle()).toBeNull();
  });

  it('tryClearObstacle：没工具说缺什么；有铲子起 2s 挖掘动作', () => {
    const { ctl, host, state } = setup();
    state.currentFloor = 2;
    ctl.buildObstacles();
    const rubble = ctl.floorObstacles[0];
    ctl.tryClearObstacle(rubble);
    expect(ctl.pendingAction).toBeUndefined();
    expect(host.flashes).toContain('需要铲子才能挖开这堆瓦砾（撬棍也行）');
    addItem(state.player.inventory, asItemId('shovel'), 1);
    ctl.tryClearObstacle(rubble);
    expect(ctl.pendingAction?.kind).toBe('dig');
    expect(ctl.pendingAction?.until).toBe(host.now + OBSTACLE_DIG_MS);
    expect(ctl.pendingAction?.busyHint).toBe('挖开瓦砾中……');
  });

  it('finishObstacleDig：清障回写（存档键 + active 退出 + flash + 扣分钟）', () => {
    const { ctl, host, state } = setup();
    state.currentFloor = 2;
    ctl.buildObstacles();
    const rubble = ctl.floorObstacles[0];
    addItem(state.player.inventory, asItemId('shovel'), 1);
    ctl.tryClearObstacle(rubble);
    ctl.finishPendingAction();
    expect(state.visitedFloors[2].lootedItems).toContain(`obstacle:2:${rubble.x}`);
    expect(ctl.activeObstacleList.some((o) => o.x === rubble.x)).toBe(false);
    expect(host.flashes).toContain('挖开了瓦砾堆，过道通了');
    expect(host.chargeTimes).toContain(OBSTACLE_DIG_COST_MINUTES);
  });
});

// ── 墙饰特写（L 键） ─────────────────────────────────────────────────────

describe('墙饰特写面板', () => {
  it('toggleDeco 开/合/翻页环游；有别的面板开着时不让开', () => {
    const { ctl, host } = setup();
    ctl.toggleDeco();
    expect(ctl.decoOpen).toBe(true);
    expect(host.panelTexts()).toContain('墙面档案');
    expect(host.panelTexts()).toContain(`1 / ${WALL_DECO.length}`);
    ctl.pageDeco(-1); // 环游到末件
    expect(host.panelTexts()).toContain(`${WALL_DECO.length} / ${WALL_DECO.length}`);
    ctl.toggleDeco(); // 再按 L 合上
    expect(ctl.decoOpen).toBe(false);
    host.anyPanelOpenValue = true;
    ctl.toggleDeco();
    expect(ctl.decoOpen, '互斥门：别的面板开着不起').toBe(false);
  });
});

// ── 入夜二选一（AG-64） ──────────────────────────────────────────────────

describe('入夜二选一面板', () => {
  it('openNightPrompt 起面板（默认选中第一行）；光标两向钳位', () => {
    const { ctl, host } = setup();
    ctl.openNightPrompt();
    expect(ctl.nightChoiceOpen).toBe(true);
    expect(host.panelTexts()).toContain('入夜 · 宿舍外');
    expect(host.panelTexts()).toContain('出去找物资');
    ctl.moveNightChoice(1);
    expect(ctl.nightChoiceSelected).toBe(1);
    ctl.moveNightChoice(1); // 钳在末行
    expect(ctl.nightChoiceSelected).toBe(1);
    ctl.moveNightChoice(-1);
    ctl.moveNightChoice(-1); // 钳在首行
    expect(ctl.nightChoiceSelected).toBe(0);
    expect(host.panelTexts()).toContain('在家守夜');
  });

  it('activateNightChoice：记录选择 + 关面板 + 分叉 flash', () => {
    const { ctl, host, state } = setup();
    state.currentFloor = 2;
    ctl.openNightPrompt();
    ctl.activateNightChoice(); // 默认 scavenge
    expect(ctl.nightChoiceOpen).toBe(false);
    expect(host.flashes).toContain('你推门走进夜色——楼里不会只有你一个人');
    // 夜事件键落在宿舍层（STARTING_FLOOR）的 localEvents——addNightEvent 的归属。
    expect(
      state.visitedFloors[STARTING_FLOOR].localEvents.some((k) => k.startsWith('night-choice:')),
      'recordNightChoice 落本地事件键',
    ).toBe(true);
  });

  it('dismissNightPrompt：记录暂拒 + 关面板 + 一句话', () => {
    const { ctl, host, state } = setup();
    state.currentFloor = 2;
    ctl.openNightPrompt();
    ctl.dismissNightPrompt();
    expect(ctl.nightChoiceOpen).toBe(false);
    expect(host.flashes).toContain('今夜的事，明天再说');
    expect(state.visitedFloors[STARTING_FLOOR].localEvents.some((k) => k.endsWith(':dismissed'))).toBe(true);
  });

  it('tickNightWatch 的 stolen 分支不剧透（无 flash、只落账）', () => {
    const { ctl, host, state } = setup();
    state.currentFloor = 2;
    state.gameMinuteOfDay = 1200;
    // stepNightWatch 是 seeded 纯函数；这里只断言「控制器不剧透」契约——
    // 无论 roll 出什么，控制器层不会替 NightSystem 抛证据 flash。
    const before = host.flashes.length;
    ctl.tickNightWatch();
    const after = host.flashes.filter((f) => f.includes('有人来过') || f.includes('偷'));
    expect(after, '证据只在回层/睡醒时出示').toEqual([]);
    expect(host.flashes.length).toBeGreaterThanOrEqual(before);
  });
});

// ── 夜间安排面板（AG-51/shelter） ─────────────────────────────────────────

describe('夜间安排面板', () => {
  it('不在宿舍层 → 没有可安排的行动（一句话打发，不起面板）', () => {
    const { ctl, host, state } = setup();
    state.currentFloor = 2;
    state.gameMinuteOfDay = 1200;
    ctl.attemptSleep();
    expect(ctl.shelterOpen).toBe(false);
    expect(host.flashes).toContain('今晚没有可安排的 shelter 行动');
  });

  it('20:00 前对自己的床按 E → 门禁话术', () => {
    const { ctl, host, state } = setup();
    state.gameMinuteOfDay = 600; // 10:00
    ctl.attemptSleep();
    expect(ctl.shelterOpen).toBe(false);
    expect(host.flashes).toContain('还太早，20:00 后才能安排夜间行动');
  });

  it('入夜在宿舍按 E → 开面板；既有计划 → 光标记忆', () => {
    const { ctl, host, state } = setup();
    state.gameMinuteOfDay = 1200;
    ctl.attemptSleep();
    expect(ctl.shelterOpen).toBe(true);
    expect(host.panelTexts()).toContain('夜间安排 · 宿舍');
    ctl.closeShelter();
    expect(ctl.shelterOpen).toBe(false);
    // 计划落在 repair（第 3 行）→ 重开光标记忆在那一行（公开字段直读）。
    state.shelterPlan = { day: state.day, action: 'repair', resolved: false };
    ctl.attemptSleep();
    expect(ctl.shelterSelected, '既有计划 → 光标记忆').toBe(2);
    expect(ctl.shelterOpen).toBe(true);
  });

  it('activateShelterChoice 未决 → resolveShelterAction 落行 + 重建面板', () => {
    const { ctl, host, state } = setup();
    state.gameMinuteOfDay = 1200;
    ctl.attemptSleep();
    host.flashes.length = 0;
    ctl.activateShelterChoice(); // 默认第 0 行 rest——readyForShelter 放行
    expect(host.flashes.some((f) => f.includes('按 Enter 睡觉'))).toBe(true);
  });

  it('activateShelterChoice 已决 → 委托场景 sleepNight（不越权跨日）', () => {
    const { ctl, host, state } = setup();
    state.gameMinuteOfDay = 1200;
    state.shelterPlan = { day: state.day, action: 'rest', resolved: true };
    ctl.attemptSleep();
    ctl.activateShelterChoice();
    expect(host.sleepNightCalls).toBe(1);
    expect(host.chargeTimes, '跨日扣分钟在场景侧，控制器不碰').toEqual([]);
  });
});

// ── 付费捷径（Wave C2） ───────────────────────────────────────────────────

describe('付费捷径', () => {
  it('不在上楼口 → 近路话术；走到 2 层上楼口且有钱 → 跳层 + 重建楼层 + 闪白', () => {
    const { ctl, host, state } = setup();
    state.currentFloor = 2; // 捷径只在 2 层起（宿舍层不可抄）
    state.player.x = 640; // 楼层中段，无 zone
    ctl.tryShortcut();
    expect(host.rebuildCount).toBe(0);
    state.player.x = 40; // UP_EXIT_X 上楼口
    state.player.gold = 500;
    const plan = shortcutPlan(state, state.currentFloor, (state.runSeed ^ (state.day * 7919) ^ (state.currentFloor * 104729)) >>> 0);
    expect(plan.target, '计划目标层应大于当前层').toBeGreaterThan(2);
    ctl.tryShortcut();
    expect(state.currentFloor, '跳到计划目标层').toBe(plan.target);
    expect(host.rebuildCount).toBe(1);
    expect(host.cameraFlashes.length).toBe(1);
    expect(host.flashes.some((f) => f.includes('抄近路跳到了'))).toBe(true);
  });

  it('钱不够 → 一动不动（先扣费后跳）', () => {
    const { ctl, host, state } = setup();
    state.currentFloor = 2;
    state.player.x = 40;
    state.player.gold = 0;
    ctl.tryShortcut();
    expect(host.rebuildCount).toBe(0);
    expect(host.flashes.some((f) => f.includes('抄近路要'))).toBe(true);
  });
});

// ── 生命周期契约（重启/换层/恢复路径） ───────────────────────────────────

describe('生命周期与契约面', () => {
  it('reset：面板态/名册/动作全清（场景重启语义）', () => {
    const { ctl, host, state } = setup();
    state.gameMinuteOfDay = 1200;
    ctl.attemptSleep();
    ctl.openNightPrompt();
    state.currentFloor = 2;
    ctl.buildObstacles();
    addItem(state.player.inventory, asItemId('shovel'), 1);
    ctl.tryClearObstacle(ctl.floorObstacles[0]);
    ctl.reset();
    expect(ctl.shelterOpen).toBe(false);
    expect(ctl.nightChoiceOpen).toBe(false);
    expect(ctl.pendingAction).toBeUndefined();
    expect(ctl.floorObstacles).toEqual([]);
    expect(ctl.activeObstacleList).toEqual([]);
    const markersBefore = host.markers.length;
    ctl.reset();
    expect(host.markers.length - markersBefore, '两枚光标箭头重建').toBe(2);
  });

  it('clearFloorState：换层摘 timer + 清名册（双保险）', () => {
    const { ctl, state } = setup();
    state.currentFloor = 2;
    ctl.buildObstacles();
    addItem(state.player.inventory, asItemId('shovel'), 1);
    ctl.tryClearObstacle(ctl.floorObstacles[0]);
    ctl.clearFloorState();
    expect(ctl.pendingAction).toBeUndefined();
    expect(ctl.activeObstacleList).toEqual([]);
  });

  it('panelObjectsForRecovery：夜间安排 + 入夜两组（特写不在内）', () => {
    const { ctl, state } = setup();
    state.gameMinuteOfDay = 1200;
    ctl.attemptSleep();
    const before = ctl.panelObjectsForRecovery().length;
    expect(before, '夜间安排面板件在恢复清单里').toBeGreaterThan(0);
    ctl.closeShelter();
    ctl.toggleDeco();
    expect(ctl.panelObjectsForRecovery().length, '特写面板件不进恢复清单（与原清单一致）').toBe(0);
  });
});

// ── 容器邻近判定（AG-20 终局二段式判官） ─────────────────────────────────

describe('容器邻近判定', () => {
  it('nearestContainer 滤空；finaleEntryFor 三重门', () => {
    const { ctl, host, state } = setup();
    const full = host.containers.find((c) => c.items.length > 0)!;
    state.player.x = full.x;
    expect(ctl.nearestContainer()?.id).toBe(full.id);
    // 终局层才认 finale 入口；非终局层恒 null。
    expect(ctl.finaleEntryFor('counter')).toBeNull();
    state.currentFloor = 100000;
    expect(ctl.finaleEntryFor('counter')).toBeNull(); // 没开过
    state.visitedFloors[100000] = { openedContainers: ['counter', 'security_safe', 'fuse_box'], lootedItems: [], localEvents: [], unlockedDoors: [] };
    expect(ctl.finaleEntryFor('counter')).toBe('terminal');
    expect(ctl.finaleEntryFor('security_safe')).toBe('archive');
    expect(ctl.finaleEntryFor('fuse_box')).toBe('fuse');
    expect(ctl.finaleEntryFor('nope')).toBeNull();
    state.currentFloor = 1;
  });
});

// ── 自动拾取编排 ─────────────────────────────────────────────────────────

describe('自动拾取编排', () => {
  it('贴身地面物走 lootGround：销毁 + 重读视图 + 刷新背包 + 扣分钟', () => {
    const { ctl, host, state } = setup();
    // 找一层真有地面物的楼层（seed 42 的 1 层没有——扫 2..8）。
    let groundFloor = 0;
    for (let f = 2; f <= 8; f++) {
      if (getFloorView(state, f).groundItems.length > 0) {
        groundFloor = f;
        break;
      }
    }
    expect(groundFloor, '2..8 层应有地面物').toBeGreaterThan(0);
    state.currentFloor = groundFloor;
    host.groundItemsFeed = getFloorView(state, groundFloor).groundItems.map((g) => ({ key: g.key, x: g.x, itemId: g.itemId, quantity: g.quantity }));
    const ground = host.groundItemsFeed[0];
    state.player.x = ground.x;
    ctl.autoPickup();
    // 拾取成败随 seeded roll；两条分支的编排都断言。
    if (host.chargeTimes.length > 0) {
      expect(host.flashes.some((f) => f.startsWith('拾取'))).toBe(true);
      expect(host.refreshFloorViewCalls).toBe(1);
      expect(host.refreshInventoryCalls).toBe(1);
    } else {
      expect(host.flashes.some((f) => f.includes('背包已满'))).toBe(true);
    }
  });
});

// ── 夜晚工具（供断言可读性） ─────────────────────────────────────────────

describe('辅助', () => {
  it('isNight 与 setup 默认态自检', () => {
    const { state } = setup();
    expect(state.currentFloor).toBe(STARTING_FLOOR);
    expect(isNight(state.gameMinuteOfDay)).toBe(false);
    expect(getGame()).toBe(state);
  });
});

// PendingAction 形状的编译期自检（类型导出给 GameScene 的 e2e getter 用）。
const _pendingShape: PendingAction | undefined = undefined;
void _pendingShape;
