// AG-70/AG-90/AG-91 CombatController 单测（RC-03 拆分第 7 步的「测试镜像」）。
// 设计文档 §5：控制器单测从场景测试里抽，记录型假件模式（前六步同款：
// monologueController / perfController / navBarController）。纯逻辑三件套由
// 既有测试直守，不在这里重测——战斗引擎 combat.test.ts 27 例（resolveRound /
// playerCombatant / d20 命中 / 夹残血 / guard 减半）、juice 状态机 juice.test.ts
// 14 例（trauma² 震屏 / 顿帧 / 闪白 / 缩放保体积 / 衰减）、舞台几何
// combatStage.test.ts、敌人名册 monsters.test.ts；这里守的是**控制器编排**：
//   · 回合推进状态机：start 开战（intro 日志/遭遇态/舞台装配/光标归零/受伤
//     计数归零）→ enter 打一张（turn 推进/日志追加/面板重建/点击热区同终点）
//     → finish 升起 outcome（done=true，Enter 从此变关闭）→ close 收尾回世界；
//   · 胜负回写：finish('win') 的战利品（addItem 入包 + addLootThisTrip 账 +
//     markResolved 'combat:win' + monstersKilled/damageDealt 计数）与 boss 的
//     记录回写（deepestFloor / bestScore +200 / emitBossWon 零伤判据）；
//   · juice 三档分级编排：impact(small/medium/large) 在控制器侧的兑现——
//     震屏写相机 shakeEffect、顿帧闸（tick 写 tweens.timeScale）、受击闪白
//     （cameras.main.flash 70ms）、large 的缩放脉冲挂舞台剪影（保体积）、
//     settings 总闸经 resume 重读（strength=0 时 offset 恒 0）；
//   · 撤退轮：flee 选撤退位 + 逃跑成功 → 演出链（跑向边缘淡出 / busy 锁输入 /
//     560ms 后 close + toast），撤退不消耗点位（encounters 不记该 spot）；
//   · 舞台 sync 委托：syncStage 把玩家名签钉在 playerSprite 世界坐标（滑步
//     途中跟着走），无舞台时 no-op。
//
// 为什么能在 Node 下跑：控制器的 import 链无 Phaser 值导入（host 是结构面
// 假件；共享面板渲染件 buildPanel/buildPanelHeader/buildPanelWell/lockToScreen
// 与 hitRect 只碰 add 工厂与链式 setter——假件全数桩掉）。唯一的环境依赖是
// SaveSystem 的 localStorage 默认参（saveToStorage(state) 在 Node 下会抛
// ReferenceError）——本文件在顶部装一个内存 Storage 假件（vitest 每文件独立
// 环境，不污染其他用例）。 AudioSystem/SettingsSystem 自带 Node 退路。

import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';

import { CombatController, type CombatHost } from '../scenes/controllers/CombatController';
import { startNewGame, getGame } from '../core/session';
import { JUICE_BALANCE } from '../render/juice';
import { attackAnimKey, dieAnimKey, runAnimKey, walkAnimKey } from '../render/walkcycle';
import { GUARD_ENERGY_RESTORE } from '../systems/combat';
import { updateSettings } from '../systems/SettingsSystem';
import { statsOf } from '../systems/StatsSystem';
import { GAME_CONFIG } from '../core/config';
import { PLAYER_FEET_Y } from '../core/constants';
import { FRAME_H } from '../render/walkcycle';
import type { GameState, ItemId } from '../core/gameTypes';

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
  scrollFactor: [number, number] = [1, 1];
  active = true;
  visible = true;
  scaleX = 1;
  scaleY = 1;
  flipX = false;
  origin: [number, number] = [0, 0];
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }
  setOrigin(x = 0, y = 0): this {
    this.origin = [x, y];
    return this;
  }
  setName(n: string): this {
    this.name = n;
    return this;
  }
  setPosition(x: number, y: number): this {
    this.x = x;
    this.y = y;
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
  setScrollFactor(x: number, y?: number): this {
    this.scrollFactor = [x, y ?? x];
    return this;
  }
  setActive(a: boolean): this {
    this.active = a;
    return this;
  }
  setVisible(v: boolean): this {
    this.visible = v;
    return this;
  }
  setScale(x: number, y = x): this {
    this.scaleX = x;
    this.scaleY = y;
    return this;
  }
  setFlipX(f: boolean): this {
    this.flipX = f;
    return this;
  }
  setStrokeStyle(): this {
    return this;
  }
  setDisplaySize(): this {
    return this;
  }
  play(key: string): this {
    this.playedKeys.push(key);
    return this;
  }
  readonly playedKeys: string[] = [];
  destroy(): this {
    this.destroyed = true;
    return this;
  }
}

/** Rectangle 假件：另记点击热区 handlers 与颜色。 */
class FakeRect extends FakeObject {
  constructor(
    x: number,
    y: number,
    readonly w: number,
    readonly h: number,
    readonly color: number,
  ) {
    super(x, y);
  }
}

/** Text 假件：记 text/color/style。 */
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

/** Graphics 假件：记画法调用序列。 */
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
  fillTriangle(): this {
    this.draws.push('fillTriangle');
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
}

/** add 工厂假件：全部出生件按类登记，供断言「面板重建了几次/有哪些件」。 */
class FakeAddFactory {
  readonly rects: FakeRect[] = [];
  readonly texts: FakeText[] = [];
  readonly gfx: FakeGraphics[] = [];
  rectangle(x: number, y: number, w: number, h: number, color: number): FakeRect {
    const r = new FakeRect(x, y, w, h, color);
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
    return o;
  }
  graphics(): FakeGraphics {
    const g = new FakeGraphics();
    this.gfx.push(g);
    return g;
  }
}

/** MonsterView 假件（render/monsterArt 的控制器消费面）。 */
class FakeMonsterView {
  readonly root = new FakeObject();
  destroyed = false;
  constructor(
    readonly chestY: number,
    readonly formH: number,
  ) {}
  setBreathing(on: boolean): void {
    this.breathing = on;
  }
  breathing = true;
  hit(dist: number): void {
    this.hits.push(dist);
  }
  readonly hits: number[] = [];
  tweenHpTo(frac: number, ms: number): void {
    this.hpTweens.push({ frac, ms });
  }
  readonly hpTweens: Array<{ frac: number; ms: number }> = [];
  dodge(): void {
    this.dodged = true;
  }
  dodged = false;
  lunge(): void {
    this.lunged = true;
  }
  lunged = false;
  fleeAway(): void {
    this.fled = true;
  }
  fled = false;
  die(): void {
    this.died = true;
  }
  died = false;
  destroy(): void {
    this.destroyed = true;
  }
}

/** HeadTag 假件（render/monsterArt 的控制器消费面）。 */
class FakeHeadTag {
  readonly root = new FakeObject();
  stopped = false;
  setHp(frac: number): void {
    this.hp = frac;
  }
  hp = 1;
  tweenHpTo(frac: number, ms: number): void {
    this.hpTweens.push({ frac, ms });
  }
  readonly hpTweens: Array<{ frac: number; ms: number }> = [];
  stop(): void {
    this.stopped = true;
  }
}

/** tween 管理器假件：登记 add 的配置（含 onComplete），timeScale 可读写。 */
class FakeTweens {
  timeScale = 1;
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
  fireAll(): void {
    for (const c of [...this.calls]) c.callback();
    this.calls.length = 0;
  }
}

/** 相机假件：shakeEffect 私有偏移面 + flash 记录。 */
class FakeCamera {
  readonly shakeEffect = { isRunning: false, duration: 0, _offsetX: 0, _offsetY: 0 };
  readonly flashes: Array<{ ms: number; r: number; g: number; b: number }> = [];
  flash(ms: number, r: number, g: number, b: number): void {
    this.flashes.push({ ms, r, g, b });
  }
}

/** 假件的记录面（断言读这些）+ 运行期结构（host 本体另经 as unknown as
 *  CombatHost 传给控制器——Phaser 单子的完整面不值得在假件里复刻）。 */
interface FakeHost {
  // ── 记录面（断言读这些） ──
  readonly encounterOpenCalls: boolean[];
  readonly panelBoxes: Array<{ x: number; y: number; w: number; h: number }>;
  rebuildCount: number;
  refreshCount: number;
  readonly flashes: string[];
  readonly actionAnims: Array<{ key: string; ms: number }>;
  readonly swings: Array<boolean | undefined>;
  readonly floatTexts: Array<{ x: number; y: number; text: string; color: string }>;
  readonly syncs: Array<{ x: number; y: number }>;
  readonly fxCalls: Array<{ id: string; x: number; y: number; depth: number; scale?: number }>;
  readonly monsterViewOpts: Array<Record<string, unknown>>;
  readonly headTagOpts: Array<Record<string, unknown>>;
  readonly panelHits: Array<{ x: number; y: number; w: number; h: number; depth: number; handlers: { onClick?: () => void }; rect: FakeRect }>;
  readonly worldHits: Array<{ x: number; y: number; w: number; h: number; depth: number; handlers: { onClick?: () => void }; rect: FakeRect }>;
  readonly lootThisTrip: number[];
  readonly bossWonCalls: number[];
  readonly damageNotes: number[];
  resetCount: number;
  endSceneCount: number;
  sceneActiveFlag: boolean;
  readonly resumeHandlers: Array<() => void>;
  readonly shutdownHandlers: Array<() => void>;
  readonly offed: Array<() => void>;
  damageTaken: number;
  readonly add: FakeAddFactory;
  readonly tweens: FakeTweens;
  readonly time: FakeClock;
  readonly mainCamera: FakeCamera;
  readonly cameras: { main: FakeCamera };
  readonly anims: { exists(key: string): boolean; readonly asked: string[] };
  readonly player: FakeObject;
  readonly monsterView: FakeMonsterView;
  readonly headTag: FakeHeadTag;
  floorW: number;
  readonly animsAsked: string[];
}

function makeHost(): FakeHost {
  const add = new FakeAddFactory();
  const tweens = new FakeTweens();
  const time = new FakeClock();
  const mainCamera = new FakeCamera();
  const animsAsked: string[] = [];
  const player = new FakeObject(640, PLAYER_FEET_Y);
  const monsterView = new FakeMonsterView(PLAYER_FEET_Y - 60, 96);
  const headTag = new FakeHeadTag();
  const host = {
    encounterOpenCalls: [] as boolean[],
    panelBoxes: [] as Array<{ x: number; y: number; w: number; h: number }>,
    rebuildCount: 0,
    refreshCount: 0,
    flashes: [] as string[],
    actionAnims: [] as Array<{ key: string; ms: number }>,
    swings: [] as Array<boolean | undefined>,
    floatTexts: [] as Array<{ x: number; y: number; text: string; color: string }>,
    syncs: [] as Array<{ x: number; y: number }>,
    fxCalls: [] as Array<{ id: string; x: number; y: number; depth: number; scale?: number }>,
    monsterViewOpts: [] as Array<Record<string, unknown>>,
    headTagOpts: [] as Array<Record<string, unknown>>,
    panelHits: [] as Array<{ x: number; y: number; w: number; h: number; depth: number; handlers: { onClick?: () => void }; rect: FakeRect }>,
    worldHits: [] as Array<{ x: number; y: number; w: number; h: number; depth: number; handlers: { onClick?: () => void }; rect: FakeRect }>,
    lootThisTrip: [] as number[],
    bossWonCalls: [] as number[],
    damageNotes: [] as number[],
    resetCount: 0,
    endSceneCount: 0,
    sceneActiveFlag: true,
    resumeHandlers: [] as Array<() => void>,
    shutdownHandlers: [] as Array<() => void>,
    offed: [] as Array<() => void>,
    damageTaken: 0,
    add,
    tweens,
    time,
    mainCamera,
    cameras: { main: mainCamera },
    anims: {
      exists(key: string): boolean {
        animsAsked.push(key);
        return true;
      },
      asked: animsAsked,
    },
    player,
    monsterView,
    headTag,
    floorW: 1280,
    animsAsked,
    // ── Phaser 单子（结构面） ──
    onSceneResume(handler: () => void): void {
      host.resumeHandlers.push(handler);
    },
    offSceneResume(handler: () => void): void {
      host.offed.push(handler);
    },
    onceSceneShutdown(handler: () => void): void {
      host.shutdownHandlers.push(handler);
    },
    // ── 共享件的场景薄封装 ──
    createMonsterView(opts: Record<string, unknown>) {
      host.monsterViewOpts.push(opts);
      return monsterView as unknown as ReturnType<CombatHost['createMonsterView']>;
    },
    createHeadTag(opts: Record<string, unknown>) {
      host.headTagOpts.push(opts);
      return headTag as unknown as ReturnType<CombatHost['createHeadTag']>;
    },
    playFx(id: string, x: number, y: number, depth: number, opts?: { scale?: number }): null {
      host.fxCalls.push({ id, x, y, depth, scale: opts?.scale });
      return null;
    },
    panelHit(x: number, y: number, w: number, h: number, depth: number, handlers: { onClick?: () => void }) {
      const r = add.rectangle(x, y, w, h, 0);
      host.panelHits.push({ x, y, w, h, depth, handlers, rect: r });
      return r as unknown as Phaser.GameObjects.Rectangle;
    },
    worldHitRect(x: number, y: number, w: number, h: number, depth: number, handlers: { onClick?: () => void }) {
      const r = add.rectangle(x, y, w, h, 0);
      host.worldHits.push({ x, y, w, h, depth, handlers, rect: r });
      return r as unknown as Phaser.GameObjects.Rectangle;
    },
    playActionAnim(key: string, ms: number): void {
      host.actionAnims.push({ key, ms });
    },
    playSwingFx(killed?: boolean): void {
      host.swings.push(killed);
    },
    spawnFloatText(x: number, y: number, text: string, color: string): void {
      host.floatTexts.push({ x, y, text, color });
    },
    // ── 战斗编排要用的场景能力 ──
    playerSprite() {
      return player as unknown as Phaser.GameObjects.Sprite;
    },
    floorWidth(): number {
      return host.floorW;
    },
    metaSelectedCharacter() {
      return 'player' as const;
    },
    syncPlayerWorldObjects(x: number, y: number): void {
      host.syncs.push({ x, y });
    },
    viewSize() {
      return { width: 1280, height: 720 };
    },
    shopSpotX(): undefined {
      return undefined;
    },
    // ── 场景状态与回写 ──
    setEncounterOpen(open: boolean): void {
      host.encounterOpenCalls.push(open);
    },
    setPanelBox(box: { x: number; y: number; w: number; h: number }): void {
      host.panelBoxes.push(box);
    },
    rebuildEncounterSpots(): void {
      host.rebuildCount += 1;
    },
    refreshStats(): void {
      host.refreshCount += 1;
    },
    flash(message: string): void {
      host.flashes.push(message);
    },
    sceneActive(): boolean {
      return host.sceneActiveFlag;
    },
    startEndScene(): void {
      host.endSceneCount += 1;
    },
    resetCombatDamage(): void {
      host.resetCount += 1;
    },
    noteCombatDamage(damage: number): void {
      host.damageNotes.push(damage);
    },
    combatDamageTaken(): number {
      return host.damageTaken;
    },
    emitBossWon(damageTaken: number): void {
      host.bossWonCalls.push(damageTaken);
    },
    addLootThisTrip(quantity: number): void {
      host.lootThisTrip.push(quantity);
    },
    combatPanelObjects(): ReadonlyArray<Phaser.GameObjects.GameObject> {
      return [];
    },
  };
  return host as unknown as FakeHost;
}

// ── 战斗态装配助手 ─────────────────────────────────────────────────────────

/** 摆一只人畜无害的沙袋怪接管战局：def/evasion 0（玩家 d20+7 > 10 稳中）、
 *  damage/accuracy 可调（默认每口 1 血、永不还手）。monsterFor 的名册骰子
 * 与 ambusher 抢先扑出不进这条路——start() 的真名册由 e2e 冻结。 */
function sandbagCombat(overrides: Partial<{ kind: 'ambush' | 'boss'; spotId: string; floor: number; hp: number; damage: number; accuracy: number; name: string }> = {}): void {
  const state = getGame();
  state.combat = {
    kind: overrides.kind ?? 'ambush',
    floor: overrides.floor ?? state.currentFloor,
    spotId: overrides.spotId ?? 'spot-x',
    monster: {
      id: 1,
      name: overrides.name ?? '沙袋',
      hp: overrides.hp ?? 1,
      maxHp: 20,
      damage: overrides.damage ?? 1,
      accuracy: overrides.accuracy ?? 0,
      defense: 0,
      evasion: 0,
      behavior: 'brute',
    },
    guarding: false,
    turn: 1,
    log: [],
  };
}

/** 驱动 enter() 直到战斗有了结局（胜/撤/死），返回打了几个回合。 */
function playUntilOver(combat: CombatController, cap = 40): number {
  const state = getGame();
  for (let i = 0; i < cap; i++) {
    if (combat.isDone() || !state.combat) return i;
    combat.enter();
  }
  return cap;
}

/** 镜像 GameScene.create 的顺序：initJuice 先建 juice 状态机，再开战——
 *  否则 ambusher 抢先扑出的 medium 档会踩 this.juice undefined。 */
function openFight(host: FakeHost, spotId: string, kind: 'ambush' | 'boss' = 'ambush'): CombatController {
  const combat = new CombatController(host as unknown as CombatHost);
  combat.initJuice();
  combat.start(spotId, kind);
  return combat;
}

/** 背包里非空格数（战利品入包断言）。 */
function filledSlots(state: GameState): number {
  return state.player.inventory.slots.filter((s) => s !== null).length;
}

// ── 用例 ───────────────────────────────────────────────────────────────────

describe('CombatController 回合推进（start/enter/move/finish 状态机）', () => {
  it('start() 开战：intro 日志/遭遇态/舞台装配/光标归零/受伤计数归零', () => {
    startNewGame(42);
    const host = makeHost();
    openFight(host, 'spot-1');

    const state = getGame();
    expect(state.combat).toBeTruthy();
    expect(state.combat?.kind).toBe('ambush');
    expect(state.combat?.turn).toBe(1);
    expect(state.combat?.log[0]).toMatch(/从暗处扑出！$/);
    // 遭遇面板槽 + 输入路由同一个面
    expect(host.encounterOpenCalls).toEqual([true]);
    // AG-77：本场受伤计数从零起算
    expect(host.resetCount).toBe(1);
    // AG-70：敌人在层右 75% 面左落地（floorWidth 1280 × 0.75 = 960），玩家名签青色
    expect(host.monsterViewOpts).toHaveLength(1);
    expect(host.monsterViewOpts[0].x).toBe(960);
    expect(host.monsterViewOpts[0].hpFrac).toBe(1);
    expect(host.headTagOpts[0]).toMatchObject({ name: '你' });
    // 舞台两件套具名（e2e 探针按名读）
    expect(host.monsterView.root.name).toBe('combat-monster-view');
    expect(host.headTag.root.name).toBe('combat-player-tag');
    // 「点击攻击」世界热区盖在剪影上，与动作条按钮同一终点（enter）
    expect(host.worldHits).toHaveLength(1);
    expect(host.worldHits[0].rect.name).toBe('combat-monster-hit'); // e2e 按名探针
    host.worldHits[0].handlers.onClick?.();
    expect(host.actionAnims.map((a) => a.key)).toContain(attackAnimKey('player'));
    // 面板：三钮 + 日志三行 + 回合签（panelHit 每建一次 3 个）
    expect(host.panelHits).toHaveLength(6); // buildPanel 跑了两次（开战 + 热区点击）
    // 滑步：距离 320px → 播走路 clip + tween 代理驱动世界对象同步
    expect(host.player.playedKeys).toContain(walkAnimKey('player'));
    expect(host.tweens.added.length).toBeGreaterThan(0);
    const slide = host.tweens.added.find((t) => typeof (t as { onUpdate?: unknown }).onUpdate === 'function') as { onUpdate: () => void } | undefined;
    expect(slide).toBeTruthy();
    slide?.onUpdate(); // tween 每帧回调：sprite + 影子 + 灯光 + 武器同一世界坐标
    expect(host.syncs.length).toBeGreaterThan(0);
    // 行为标签开场飘一次
    expect(host.floatTexts.length).toBeGreaterThan(0);
    // 回合推进了一格（热区点击打了一回合）
    expect(state.combat?.turn).toBe(2);
  });

  it('enter() 打攻击牌：挥击 clip +  Swing + 回合推进 + 面板重建', () => {
    startNewGame(42);
    const host = makeHost();
    const combat = openFight(host, 'spot-1');

    combat.enter();

    const state = getGame();
    expect(host.actionAnims.map((a) => a.key)).toContain(attackAnimKey('player'));
    expect(host.actionAnims.find((a) => a.key === attackAnimKey('player'))?.ms).toBe(320);
    // 挥击弧无论命中与否都播（miss 也有弧）
    expect(host.swings.length).toBeGreaterThan(0);
    expect(state.combat?.turn).toBe(2);
    // 面板重建：panelHit 3（start 一次）+ 3（本回合一次）
    expect(host.panelHits).toHaveLength(6);
    // 日志追加了裁决消息
    expect((state.combat?.log.length ?? 0)).toBeGreaterThan(1);
    // HUD 刷新委托（掉血/回合推进后）
    expect(host.refreshCount).toBeGreaterThan(0);
  });

  it('↑/↓ 光标：move(1) 后 enter 打格挡牌（精力返还 + 招架火花，无挥击）', () => {
    startNewGame(42);
    const host = makeHost();
    const combat = openFight(host, 'spot-1');
    const energyBefore = getGame().player.energy;

    combat.move(1);
    combat.enter();

    const state = getGame();
    expect(host.actionAnims.map((a) => a.key)).not.toContain(attackAnimKey('player'));
    expect(host.swings).toHaveLength(0);
    expect(state.player.energy).toBe(Math.min(GAME_CONFIG.player.energyMax, energyBefore + GUARD_ENERGY_RESTORE));
    // 招架火花走 host.playFx（降级时返回 null 也照演）
    expect(host.fxCalls.some((f) => f.id === 'parry')).toBe(true);
    expect(state.combat?.guarding).toBe(true);
  });

  it('move 钳位：0 以下不动（仍是攻击牌）、2 以上不动（仍是撤退牌）', () => {
    startNewGame(42);
    const host = makeHost();
    const combat = openFight(host, 'spot-1');

    combat.move(-5);
    combat.enter();
    expect(host.actionAnims.map((a) => a.key)).toContain(attackAnimKey('player'));

    // 新开一场测上钳位（上一回合可能已改变战局）
    startNewGame(42);
    const host2 = makeHost();
    const combat2 = openFight(host2, 'spot-1');
    combat2.move(+5);
    combat2.enter();
    // 撤退牌：无攻击 clip、无挥击，日志是逃跑裁决
    expect(host2.actionAnims.map((a) => a.key)).not.toContain(attackAnimKey('player'));
    expect(host2.swings).toHaveLength(0);
    const log = getGame().combat?.log ?? [];
    expect(log.some((l) => l.includes('逃'))).toBe(true);
  });

  it('finish 升起 outcome 后 isDone()=true，再按 Enter 收尾回世界', () => {
    startNewGame(42);
    const host = makeHost();
    const combat = openFight(host, 'spot-1');
    // 直接摆一只残血沙袋接管战局，保证本回合击杀
    sandbagCombat({ spotId: 'spot-1' });

    playUntilOver(combat);

    const state = getGame();
    expect(combat.isDone()).toBe(true);
    // outcome 面板升起（文本件里有「战斗胜利」）
    expect(host.add.texts.map((t) => t.text)).toContain('战斗胜利');
    expect(host.add.texts.map((t) => t.text)).toContain('Enter / ESC 继续');
    const refreshBefore = host.refreshCount;

    combat.enter(); // done 后的 Enter = 关闭

    expect(state.combat).toBeUndefined();
    expect(combat.isDone()).toBe(false);
    expect(host.encounterOpenCalls[host.encounterOpenCalls.length - 1]).toBe(false);
    expect(host.rebuildCount).toBe(1); // 问号点按结果重建
    // 舞台拆净：剪影毁、名签停、热区毁
    expect(host.monsterView.destroyed).toBe(true);
    expect(host.headTag.stopped).toBe(true);
    expect(host.refreshCount).toBe(refreshBefore); // close 不再刷 HUD（finish 已刷过）
  });
});

describe('CombatController 胜负回写（finish 的战利品 + 记录）', () => {
  it('击败 ambush：战利品入包 + 本次出行账 + 点位记 combat:win + 击杀/伤害计数', () => {
    startNewGame(42);
    const host = makeHost();
    const combat = new CombatController(host as unknown as CombatHost);
    combat.initJuice();
    const before = filledSlots(getGame());
    sandbagCombat({ spotId: 'spot-x' });

    playUntilOver(combat);

    const state = getGame();
    expect(combat.isDone()).toBe(true);
    // 点位消耗（胜）
    expect(state.encounters?.['spot-x']).toBe('combat:win');
    // 战利品：入包 + 「本次出行」账（数量对得上）
    expect(filledSlots(state)).toBeGreaterThan(before);
    expect(host.lootThisTrip.length).toBeGreaterThan(0);
    expect(host.lootThisTrip.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    // AG-81 统计：击杀与造成伤害都计数（逃走的 coward 不计击杀——见 combat.test.ts）
    const stats = statsOf(state);
    expect(stats.monstersKilled).toBeGreaterThanOrEqual(1);
    expect(stats.damageDealt).toBeGreaterThanOrEqual(1);
    // 日志：击败播报 + 战利品行
    const log = state.combat?.log ?? [];
    expect(log.some((l) => l.includes('你击败了 沙袋'))).toBe(true);
    expect(log.some((l) => l.includes('战利品'))).toBe(true);
    // HUD 刷新（finish 里一次）
    expect(host.refreshCount).toBeGreaterThan(0);
  });

  it('击败 boss：记录回写（deepestFloor/bestScore +200）+ emitBossWon 零伤判据 + 三件战利品', () => {
    startNewGame(42);
    const state = getGame();
    state.currentFloor = 3; // 守门人在 3 层
    const host = makeHost();
    host.damageTaken = 0; // 零伤击败
    const combat = new CombatController(host as unknown as CombatHost);
    combat.initJuice();
    const before = filledSlots(state);
    sandbagCombat({ kind: 'boss', spotId: 'boss-1', floor: 3 });

    playUntilOver(combat);

    expect(combat.isDone()).toBe(true);
    expect(state.encounters?.['boss-1']).toBe('combat:win');
    // 记录：最深楼层取大、分数 +200
    expect(state.records?.deepestFloor).toBe(3);
    expect(state.records?.bestScore).toBe(200);
    // AG-77：零伤击败守门人的成就发射（判据=本场累计受伤）
    expect(host.bossWonCalls).toEqual([0]);
    // boss 战利品 3 件（+ 幸运护符加成，本局无遗物）
    expect(host.lootThisTrip).toHaveLength(3);
    expect(filledSlots(state)).toBeGreaterThan(before);
    const log = state.combat?.log ?? [];
    expect(log.some((l) => l.includes('守门人倒下了'))).toBe(true);
    expect(log.some((l) => l.includes('上楼的路通了'))).toBe(true);
    expect(log.some((l) => l.includes('分数 +200'))).toBe(true);
    // outcome 标题按 boss 口径
    expect(host.add.texts.map((t) => t.text)).toContain('守门人倒下了');
  });

  it('玩家阵亡：status=lost + deaths 计数 + large 档 + die clip + 延迟切场（busy 锁输入）', () => {
    startNewGame(42);
    const state = getGame();
    state.player.hp = 10;
    const host = makeHost();
    const combat = new CombatController(host as unknown as CombatHost);
    combat.initJuice();
    sandbagCombat({ spotId: 'spot-d', hp: 50, damage: 40, accuracy: 20 });

    combat.enter(); // 一拳换一拳——沙袋每口 40，玩家 10 血

    expect(state.player.hp).toBe(0);
    expect(state.status).toBe('lost');
    expect(statsOf(state).deaths).toBeGreaterThanOrEqual(1);
    // AG-91：阵亡 = large 档（满 trauma + 120ms 顿帧 + 闪白 + 缩放）
    expect(host.mainCamera.flashes.length).toBeGreaterThan(0);
    // AG-90：倒地 clip 播完再切场（不是当场 scene.start）
    expect(host.actionAnims.map((a) => a.key)).toContain(dieAnimKey('player'));
    expect(host.endSceneCount).toBe(0);
    // busy 锁死：延迟切场前再按 Enter 不结算新回合
    const turn = state.combat?.turn;
    combat.enter();
    expect(state.combat?.turn).toBe(turn);
    // 延迟到点：die clip 保持时长 + 100ms → 切结局卡
    const dieCall = host.time.calls.find((c) => c.delay > 400);
    expect(dieCall).toBeTruthy();
    host.sceneActiveFlag = true;
    host.time.fire(dieCall?.delay ?? 0);
    expect(host.endSceneCount).toBe(1);
  });
});

describe('CombatController juice 三档分级编排（AG-91 控制器层）', () => {
  it('initJuice：种子确定性 + 总闸读设置 + 相机 offset 清零 + resume/shutdown 订阅', () => {
    startNewGame(42);
    const host = makeHost();
    const combat = new CombatController(host as unknown as CombatHost);
    combat.initJuice();

    expect(combat.juiceState).toBeTruthy();
    // 总闸默认开 → 强度取平衡旋钮
    expect(combat.juiceState.shakeStrength).toBe(JUICE_BALANCE.shakeStrength);
    // 上一局残留 offset 先清零
    expect(host.mainCamera.shakeEffect.isRunning).toBe(false);
    expect(host.mainCamera.shakeEffect._offsetX).toBe(0);
    expect(host.mainCamera.shakeEffect._offsetY).toBe(0);
    // 订阅面：resume 重读总闸、shutdown 一次性清理
    expect(host.resumeHandlers).toHaveLength(1);
    expect(host.shutdownHandlers).toHaveLength(1);
    // 无事件时 tick：timeScale 1、offset 恒 0、isRunning false
    expect(combat.tick(16)).toBe(false);
    expect(host.tweens.timeScale).toBe(1);
    expect(host.mainCamera.shakeEffect.isRunning).toBe(false);
  });

  it('small 档（普通命中）：无闪白无顿帧，震屏写进 shakeEffect 并随时间衰减归零', () => {
    startNewGame(42);
    const host = makeHost();
    const combat = new CombatController(host as unknown as CombatHost);
    combat.initJuice();

    combat.impact('small', 100, 100);

    expect(host.mainCamera.flashes).toHaveLength(0); // small 不闪白
    combat.tick(16);
    expect(combat.tick(16)).toBe(false); // 不顿帧
    expect(host.tweens.timeScale).toBe(1);
    // trauma 0.15 × strength 0.7 → 有位移：写进私有偏移面且 duration 钉死
    expect(host.mainCamera.shakeEffect.isRunning).toBe(true);
    expect(host.mainCamera.shakeEffect.duration).toBe(Number.MAX_SAFE_INTEGER);
    // 线性衰减 2/s：0.15 trauma 约 75ms 归零 → offset 回 0、isRunning 回落
    for (let i = 0; i < 10; i++) combat.tick(16);
    expect(host.mainCamera.shakeEffect.isRunning).toBe(false);
    expect(host.mainCamera.shakeEffect._offsetX).toBe(0);
  });

  it('medium 档（受击）：顿帧闸 + 70ms 受击闪白，hitstop 过后恢复', () => {
    startNewGame(42);
    const host = makeHost();
    const combat = new CombatController(host as unknown as CombatHost);
    combat.initJuice();

    combat.impact('medium', 100, 100);

    expect(host.mainCamera.flashes).toEqual([{ ms: JUICE_BALANCE.flashMs, r: 255, g: 255, b: 255 }]);
    expect(combat.tick(16)).toBe(true); // 顿帧中
    expect(host.tweens.timeScale).toBe(0); // 闸掉世界/舞台 tween
    for (let i = 0; i < 6; i++) combat.tick(16); // 50ms hitstop 流逝
    expect(combat.tick(16)).toBe(false);
    expect(host.tweens.timeScale).toBe(1); // 恢复
  });

  it('large 档（击杀/阵亡）：闪白 + 顿帧 + 缩放脉冲挂舞台剪影（保体积）', () => {
    startNewGame(42);
    const host = makeHost();
    const combat = new CombatController(host as unknown as CombatHost);
    combat.initJuice();
    combat.start('spot-1', 'ambush'); // 装配舞台（剪影在）

    combat.impact('large', host.monsterView.root.x, host.monsterView.chestY);

    expect(host.mainCamera.flashes.length).toBeGreaterThan(0);
    expect(combat.tick(16)).toBe(true); // 120ms 顿帧
    expect(host.tweens.timeScale).toBe(0);
    // squash & stretch 挂受害者剪影：sy<1 压缩、sx=1/sy 保体积
    const squash = host.monsterView.root as unknown as { scaleX: number; scaleY: number };
    expect(squash.scaleY).toBeLessThan(1);
    expect(squash.scaleX * squash.scaleY).toBeCloseTo(1, 9);
  });

  it('总闸关闭：resume 重读设置后 strength=0，相机 offset 恒 0（震屏让位、顿帧不冻）', () => {
    startNewGame(42);
    const host = makeHost();
    const combat = new CombatController(host as unknown as CombatHost);
    combat.initJuice();
    combat.impact('small', 100, 100);
    combat.tick(16);
    expect(host.mainCamera.shakeEffect.isRunning).toBe(true);

    updateSettings({ screenShake: false });
    host.resumeHandlers[0](); // 模拟从设置场景返回

    expect(combat.juiceState.shakeStrength).toBe(0);
    combat.tick(16);
    expect(host.mainCamera.shakeEffect.isRunning).toBe(false);
    expect(host.mainCamera.shakeEffect._offsetX).toBe(0);
    expect(host.mainCamera.shakeEffect._offsetY).toBe(0);
    // 顿帧/闪白不受总闸影响（medium 仍闸 timeScale）
    combat.impact('medium', 100, 100);
    expect(combat.tick(16)).toBe(true);
    updateSettings({ screenShake: true }); // 还原，不污染同文件后续用例
  });
});

describe('CombatController 撤退轮（flee）', () => {
  it('撤退成功：跑向边缘淡出 + busy 锁输入 + 560ms 后 close + toast，点位不消耗', () => {
    startNewGame(42);
    const host = makeHost();
    const combat = openFight(host, 'spot-f');

    // 撤退牌打到成功为止（45%+ 每回合；全部 seeded，确定性收敛）
    let fled = false;
    for (let i = 0; i < 40 && !fled; i++) {
      combat.flee();
      fled = (getGame().combat?.log ?? []).some((l) => l.includes('你成功撤出。'));
    }
    expect(fled).toBe(true);

    // 撤退演出：面左 + 跑 clip（anims 有时走 run，没有退 walk）+ 双淡出 tween
    expect(host.player.flipX).toBe(true);
    expect(host.animsAsked).toContain(runAnimKey('player'));
    const fadeTweens = host.tweens.added.filter((t) => (t as { alpha?: number }).alpha === 0);
    expect(fadeTweens.length).toBe(2); // 角色 + 头顶名签
    // busy：演出期间输入不结算新回合
    const turn = getGame().combat?.turn;
    combat.enter();
    expect(getGame().combat?.turn).toBe(turn);

    // 560ms 演出到点：close 收尾 + toast，问号点保留（撤退不消耗）
    expect(host.time.fire(560)).toBe(1);
    const state = getGame();
    expect(state.combat).toBeUndefined();
    expect(host.flashes).toContain('你撤出了战斗。');
    expect(host.encounterOpenCalls[host.encounterOpenCalls.length - 1]).toBe(false);
    expect(host.rebuildCount).toBe(1); // 点位重建（未解决的保留）
    expect(state.encounters?.['spot-f']).toBeUndefined();
    // 撤退后玩家回到 idle（close 不负责——此处仅验舞台已拆）
    expect(host.monsterView.destroyed).toBe(true);
  });
});

describe('CombatController 舞台 sync 委托（AG-70）', () => {
  it('syncStage 把玩家名签钉在 playerSprite 世界坐标；无舞台时 no-op', () => {
    startNewGame(42);
    const host = makeHost();
    const combat = openFight(host, 'spot-1');

    // 滑步途中：名签跟着玩家世界坐标走
    host.player.setPosition(300, PLAYER_FEET_Y);
    combat.syncStage();
    const last = host.headTag.root as unknown as { x: number; y: number };
    expect(last.x).toBe(300);
    expect(last.y).toBe(PLAYER_FEET_Y - FRAME_H - 8);

    // 拆舞台后再 sync：不抛、不再钉（no-op）
    combat.close();
    const before = { ...last };
    combat.syncStage();
    expect(last.x).toBe(before.x);
    expect(last.y).toBe(before.y);
  });

  it('setBreathing 委托舞台剪影（降级边沿停帧），无舞台 no-op', () => {
    startNewGame(42);
    const host = makeHost();
    const combat = openFight(host, 'spot-1');

    combat.setBreathing(false);
    expect(host.monsterView.breathing).toBe(false);
    combat.setBreathing(true);
    expect(host.monsterView.breathing).toBe(true);

    combat.close();
    expect(() => combat.setBreathing(false)).not.toThrow();
  });

  it('panelObjectsForRecovery：战斗面板件对恢复路径可见', () => {
    startNewGame(42);
    const host = makeHost();
    const combat = openFight(host, 'spot-1');

    const objs = combat.panelObjectsForRecovery();
    expect(objs.length).toBeGreaterThan(0);
    // close 后面板件列表清空
    combat.close();
    expect(combat.panelObjectsForRecovery()).toHaveLength(0);
  });
});

describe('CombatController 输入路由委托面（GameScene 四分支的控制器侧）', () => {
  it('enter/move/flee/isDone 与 update 两行（tick/syncStage）在控制器侧闭合', () => {
    startNewGame(42);
    const host = makeHost();
    const combat = new CombatController(host as unknown as CombatHost);
    // create 的一行：initJuice 先建状态机
    combat.initJuice();
    combat.start('spot-1', 'ambush');

    // update 的两行：tick（顿帧闸，非顿帧回 false）+ syncStage（名签钉点）
    expect(combat.tick(16)).toBe(false);
    combat.syncStage();
    const tag = host.headTag.root as unknown as { x: number; y: number };
    expect(tag.x).toBe(host.player.x);
    expect(tag.y).toBe(PLAYER_FEET_Y - FRAME_H - 8);

    // onNavUp/onNavDown 的委托面：光标钳位后重画面板
    const panelBuildsBefore = host.panelHits.length;
    combat.move(-1);
    combat.move(1);
    combat.move(1);
    expect(host.panelHits.length).toBe(panelBuildsBefore + 9); // 三次 move 三次重建 ×3 钮

    // onEsc 的委托面：flee 选撤退位打一轮（本局 seeded，成败都走同一路由）
    combat.flee();
    expect(host.swings).toHaveLength(0); // 撤退不打挥击
    // outcome 未升起时 isDone=false
    expect(combat.isDone()).toBe(false);
  });
});

// 保持对 ItemId 的引用（类型用途，避免未使用告警）。
export type _LootItemId = ItemId;
