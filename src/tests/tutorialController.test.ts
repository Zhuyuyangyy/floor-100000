// AG-73 TutorialController 单测（RC-03 拆分第 3 步的「测试镜像」）。
// 设计文档 §5：控制器单测从场景测试里抽，记录型假场景模式（参考
// monologueController.test.ts / renderPerf.test.ts 路数）。纯函数层（步骤
// 定义/推进判定/出现条件/高亮几何/持久化）由 tutorial.test.ts 守着；这里守的
// 是**控制器接线**：init 首建契约（QA 第 1 轮 R2 的按钮显隐）、六步推进链、
// 床步三选一完成条件（RC-02 XP-3）、夜里收尾的 1700ms 延迟与 sceneActive
// 守卫、skip 终态、navHint 的出现条件与世界链让位、呼吸框几何。
//
// 为什么能在 Node 下跑：控制器的 import 链无 Phaser 值导入（host 是结构面
// 假件，framedButton 由 host 薄封装注入，Graphics 只碰 clear/fillStyle/
// fillRect/lineStyle/strokeRect/setVisible——假件全数桩掉）。

import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';

import { TutorialController, type TutorialHost } from '../scenes/controllers/TutorialController';
import { getGame, startNewGame } from '../core/session';
import { TUTORIAL_PROGRESS_KEY, TUTORIAL_SKIPPED_KEY } from '../systems/TutorialSystem';
import { TUTORIAL_DONE_LINE, TUTORIAL_SKIP_LINE, TUTORIAL_STEPS } from '../data/tutorial';
import { HUD_FEEDBACK_DEPTH } from '../render/panels';

// ── 记录型假件 ─────────────────────────────────────────────────────────────

/** framedButton 的四个零件（底/边/签/热区）共用的小件。 */
class FakePart {
  visible = true;
  name = '';
  destroyed = false;
  setVisible(v: boolean): this {
    this.visible = v;
    return this;
  }
  setName(n: string): this {
    this.name = n;
    return this;
  }
  setScrollFactor(): this {
    return this;
  }
  destroy(): this {
    this.destroyed = true;
    return this;
  }
}

class FakeGraphics {
  visible = true;
  cleared = 0;
  destroyed = false;
  readonly ops: Array<{ op: string; args: number[] }> = [];
  private rec(op: string, args: number[]): void {
    this.ops.push({ op, args });
  }
  clear(): this {
    this.cleared += 1;
    return this;
  }
  setDepth(): this {
    return this;
  }
  setScrollFactor(): this {
    return this;
  }
  setVisible(v: boolean): this {
    this.visible = v;
    return this;
  }
  setName(): this {
    return this;
  }
  fillStyle(): this {
    return this;
  }
  fillRect(...args: number[]): this {
    this.rec('fillRect', args);
    return this;
  }
  lineStyle(): this {
    return this;
  }
  strokeRect(...args: number[]): this {
    this.rec('strokeRect', args);
    return this;
  }
  destroy(): this {
    this.destroyed = true;
    return this;
  }
}

class FakeFactory {
  readonly graphics: FakeGraphics[] = [];
  gfx(): FakeGraphics {
    const g = new FakeGraphics();
    this.graphics.push(g);
    return g;
  }
}

class FakeClock {
  now = 0;
  readonly delayed: Array<{ ms: number; fn: () => void }> = [];
  delayedCall(ms: number, fn: () => void): void {
    this.delayed.push({ ms, fn });
  }
}

interface ButtonCall {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  depth: number;
  onClick: () => void;
}

class FakeHost {
  readonly factory = new FakeFactory();
  readonly clock = new FakeClock();
  readonly buttonCalls: ButtonCall[] = [];
  readonly buttonParts: FakePart[] = [];
  readonly flashes: string[] = [];
  /** 查询面开关（测试按剧本拨）。 */
  panelOpen = false;
  stairClimbing = false;
  craftingOpen = false;
  nearBed = false;
  sceneActiveFlag = true;
  worldHint = '';
  containersList: Array<{ id: string; x: number }> = [];

  /** framedButton 的场景侧薄封装假件：记调用、返四件、onClick 可手动触发。 */
  framedButton(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    depth: number,
    onClick: () => void,
  ): Phaser.GameObjects.GameObject[] {
    this.buttonCalls.push({ x, y, w, h, label, depth, onClick });
    const parts = [new FakePart(), new FakePart(), new FakePart(), new FakePart()];
    this.buttonParts.push(...parts);
    return parts as unknown as Phaser.GameObjects.GameObject[];
  }

  /** 收窄成控制器的结构面（假件不实现 Phaser.Manager 的全体成员）。 */
  asHost(): TutorialHost {
    return {
      add: { graphics: () => this.factory.gfx() } as unknown as Phaser.GameObjects.GameObjectFactory,
      time: this.clock as unknown as Phaser.Time.Clock,
      framedButton: (x, y, w, h, label, depth, onClick) => this.framedButton(x, y, w, h, label, depth, onClick),
      sceneActive: () => this.sceneActiveFlag,
      anyPanelOpen: () => this.panelOpen,
      stairClimbing: () => this.stairClimbing,
      craftingPanelOpen: () => this.craftingOpen,
      containers: () => this.containersList,
      isNearBed: () => this.nearBed,
      worldHintText: () => this.worldHint,
      flash: (message: string) => this.flashes.push(message),
    };
  }
}

/** Map 假件——TutorialSystem 的 TutorialStorage 结构面（场景传 localStorage）。 */
class FakeStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** 建一个控制器并跑首建；state 已由 startNewGame 摆好。 */
function boot(storage = new FakeStorage()): { c: TutorialController; host: FakeHost; storage: FakeStorage } {
  startNewGame(4242);
  const host = new FakeHost();
  const c = new TutorialController(host.asHost(), storage);
  c.init();
  return { c, host, storage };
}

const openContainer = (floor = 1): void => {
  const s = getGame();
  s.visitedFloors[floor] = { openedContainers: ['locker-a'], lootedItems: [], unlockedDoors: [], localEvents: [] };
};

/** 从首建推到床步（step 5）：移动→搜刮→圆环 3s→制作→爬梯到 2 层。 */
function toBedStep(c: TutorialController, host: FakeHost): void {
  const s = getGame();
  s.player.x += 300; // step 0→1（传送也算位移）
  c.tick();
  openContainer();
  c.tick(); // 1→2
  host.clock.now += 3000; // 圆环步持有 3 秒
  c.tick(); // 2→3
  host.craftingOpen = true;
  c.tick(); // 3→4
  s.currentFloor = 2;
  c.tick(); // 4→5
  expect(c.step).toBe(5);
}

describe('AG-73 TutorialController（RC-03 拆分第 3 步）', () => {
  it('init 首建：新局 step 0、按钮四件具名、R2 flag 契约（新建即可见）', () => {
    const { c, host } = boot();
    expect(c.step).toBe(0);
    expect(c.isActive).toBe(true);
    expect(host.buttonCalls.length).toBe(1);
    const call = host.buttonCalls[0];
    expect(call).toMatchObject({ x: 1280 - 16 - 108, y: 112, w: 108, h: 30, label: '跳过教程', depth: HUD_FEEDBACK_DEPTH });
    // 具名 hud-*：存量 e2e 的面板文本采集按名字跳过它（它是 HUD，不是面板）。
    expect(host.buttonParts[2].name).toBe('hud-tutorial-skip');
    // R2 契约：flag 记 true（framedButton 新建四件默认可见）→ 相等守卫不转换，
    // clean 局零件保持可见。
    expect(host.buttonParts.every((p) => p.visible)).toBe(true);
    // 移动步没有目标物件：两个框都不可见。
    expect(c.worldGfxVisible).toBe(false);
    expect(c.hudGfxVisible).toBe(false);
  });

  it('按钮 onClick 接的是 skip（按钮与 Esc 同效）', () => {
    const { c, host } = boot();
    host.buttonCalls[0].onClick();
    expect(c.skipped).toBe(true);
    expect(host.flashes).toEqual([TUTORIAL_SKIP_LINE]);
  });

  it('六步推进链：移动→搜刮→圆环 3s→制作→爬梯→床（每推进落盘）', () => {
    const { c, host, storage } = boot();
    const s = getGame();
    s.player.x += 300;
    c.tick();
    expect(c.step).toBe(1);
    expect(storage.map.get(TUTORIAL_PROGRESS_KEY)).toBe('1');
    openContainer();
    c.tick();
    expect(c.step).toBe(2);
    // 圆环步：HUD 圆环框在线（屏幕坐标），世界框不收。
    expect(c.hudGfxVisible).toBe(true);
    expect(c.worldGfxVisible).toBe(false);
    host.clock.now += 3000;
    c.tick();
    expect(c.step).toBe(3);
    expect(c.hudGfxVisible).toBe(false);
    host.craftingOpen = true;
    c.tick();
    expect(c.step).toBe(4);
    s.currentFloor = 2;
    c.tick();
    expect(c.step).toBe(5);
  });

  it('呼吸框几何：搜刮步框住本层最近未开容器（世界坐标，host 查询面供料）', () => {
    const { c, host } = boot();
    const s = getGame();
    s.player.x += 300;
    host.containersList = [{ id: 'locker-a', x: 160 }];
    c.tick();
    expect(c.step).toBe(1);
    expect(c.worldGfxVisible).toBe(true);
    const worldGfx = host.factory.graphics[0]; // init 先建世界框
    // propBox(160, 96) = (112, 64, 96, 84)；strokeRect 收 1px 防双线半透。
    expect(worldGfx.ops).toEqual([
      { op: 'fillRect', args: [112, 64, 96, 84] },
      { op: 'strokeRect', args: [112.5, 64.5, 95, 83] },
    ]);
  });

  describe('床步（step 5）三选一完成条件（RC-02 XP-3）', () => {
    it('睡过：当场收尾，flash 立即放（不延迟）', () => {
      const { c, host } = boot();
      toBedStep(c, host);
      getGame().shelterPlan = { day: 1, action: 'rest', resolved: true };
      c.tick();
      expect(c.step).toBe(6);
      expect(host.flashes).toEqual([TUTORIAL_DONE_LINE]);
      expect(host.clock.delayed).toEqual([]);
    });

    it('入夜（未睡）：收尾 flash 排到夜事件消息后（delayedCall 1700ms，落地才放）', () => {
      const { c, host } = boot();
      toBedStep(c, host);
      getGame().gameMinuteOfDay = 20 * 60;
      c.tick();
      expect(c.step).toBe(6);
      expect(host.flashes, '当帧不放——那帧的世界模拟段还有夜事件消息').toEqual([]);
      expect(host.clock.delayed.map((d) => d.ms)).toEqual([1700]);
      host.clock.delayed[0].fn();
      expect(host.flashes).toEqual([TUTORIAL_DONE_LINE]);
    });

    it('夜里延迟落地时场景已死：不放（sceneActive 守卫）', () => {
      const { c, host } = boot();
      toBedStep(c, host);
      getGame().gameMinuteOfDay = 20 * 60;
      c.tick();
      host.sceneActiveFlag = false;
      host.clock.delayed[0].fn();
      expect(host.flashes).toEqual([]);
    });

    it('白天站到床边（XP-3 第三路径）：当场收尾，不靠入夜', () => {
      const { c, host } = boot();
      toBedStep(c, host);
      const s = getGame();
      s.gameMinuteOfDay = 10 * 60; // 摁在上午——离入夜还有半天
      s.currentFloor = 1; // 爬回 1 层
      host.nearBed = true; // 站到自己床边（host 查询面摄入）
      c.tick();
      expect(c.step).toBe(6);
      expect(host.flashes).toEqual([TUTORIAL_DONE_LINE]);
      expect(host.clock.delayed).toEqual([]);
    });

    it('三选一都不满足（白天/没睡/不在床边）：不收尾', () => {
      const { c, host } = boot();
      toBedStep(c, host);
      getGame().gameMinuteOfDay = 10 * 60;
      c.tick();
      expect(c.step).toBe(5);
      expect(host.flashes).toEqual([]);
    });
  });

  it('skip：终态落盘（skipped 键 + 撤进度键）、flash 跳过语、按钮与呼吸框收起、之后 tick no-op', () => {
    const { c, host, storage } = boot();
    const s = getGame();
    s.player.x += 300;
    host.containersList = [{ id: 'locker-a', x: 160 }];
    c.tick(); // → step 1，世界呼吸框在线
    expect(c.worldGfxVisible).toBe(true);

    c.skip();

    expect(c.skipped).toBe(true);
    expect(c.step).toBe(6);
    expect(c.isActive).toBe(false);
    expect(storage.map.get(TUTORIAL_SKIPPED_KEY)).toBe('1');
    expect(storage.map.has(TUTORIAL_PROGRESS_KEY)).toBe(false);
    expect(host.flashes).toEqual([TUTORIAL_SKIP_LINE]);
    expect(host.buttonParts.every((p) => !p.visible)).toBe(true);
    expect(c.worldGfxVisible).toBe(false);
    // 终态后 tick 不再推进、不再落盘。
    s.player.x += 500;
    c.tick();
    expect(c.step).toBe(6);
    expect(storage.map.get(TUTORIAL_PROGRESS_KEY)).toBeUndefined();
  });

  it('按钮显隐：clean 可见；面板/爬梯隐藏；关面板回归', () => {
    const { c, host } = boot();
    expect(host.buttonParts.every((p) => p.visible)).toBe(true);
    host.panelOpen = true; // 面板里免误触（与 Esc 同款门）
    c.tick();
    expect(host.buttonParts.every((p) => !p.visible)).toBe(true);
    host.panelOpen = false;
    c.tick();
    expect(host.buttonParts.every((p) => p.visible)).toBe(true);
    host.stairClimbing = true; // 爬梯态收起
    c.tick();
    expect(host.buttonParts.every((p) => !p.visible)).toBe(true);
    host.stairClimbing = false;
    c.tick();
    expect(host.buttonParts.every((p) => p.visible)).toBe(true);
  });

  it('R2 终态开局：localStorage 记过跳过 → 新建按钮不残留（flag=true + 相等守卫转换）', () => {
    startNewGame(4242);
    const storage = new FakeStorage();
    storage.map.set(TUTORIAL_SKIPPED_KEY, '1');
    const host = new FakeHost();
    const c = new TutorialController(host.asHost(), storage);
    c.init();
    expect(c.skipped).toBe(true);
    expect(c.isActive).toBe(false);
    expect(host.buttonParts.every((p) => !p.visible)).toBe(true);
  });

  it('navHint：激活且出现条件过 → 本步文案；世界链教同一个 E → 让位；终态 → null', () => {
    const { c, host } = boot();
    const s = getGame();
    expect(c.navHint()).toBe(TUTORIAL_STEPS[0].hint);
    s.player.x += 300; // → step 1（搜刮）
    host.containersList = [{ id: 'locker-a', x: 160 }];
    c.tick();
    // 搜刮步的出现条件：200px 内有没有没开过的容器。
    s.player.x = 940; // 离柜子 780px——教程闭嘴
    expect(c.navHint()).toBeNull();
    s.player.x = 100; // 离柜子 60px——教程说
    expect(c.navHint()).toBe(TUTORIAL_STEPS[1].hint);
    // 世界正在教同一个 E 动作（贴近柜子的「按 E 打开 储物柜」）→ 让世界说。
    host.worldHint = '按 E 打开 储物柜';
    expect(c.navHint()).toBeNull();
    // 世界说别的（出生点压着室友床的「搜刮床铺」）→ 教程盖住它说。
    host.worldHint = '搜刮床铺';
    expect(c.navHint()).toBe(TUTORIAL_STEPS[1].hint);
    c.skip();
    expect(c.navHint()).toBeNull();
  });

  it('init 先毁后建：场景重启不双份（restart-safe 契约的控制器侧）', () => {
    const { c, host } = boot();
    const firstGfx = host.factory.graphics.slice();
    const firstParts = host.buttonParts.slice();
    c.init(); // 场景重启：create() 再跑一次
    expect(firstGfx.every((g) => g.destroyed)).toBe(true);
    expect(firstParts.every((p) => p.destroyed)).toBe(true);
    expect(host.factory.graphics.length).toBe(4); // 两轮各两个框，旧的已毁
    expect(host.buttonParts.length).toBe(8); // 上一轮四件 + 新一轮四件
    expect(host.buttonCalls.length).toBe(2);
    // 新一轮的零件重新走 R2 契约（clean 局 → 可见）。
    expect(host.buttonParts.slice(4).every((p) => p.visible)).toBe(true);
  });
});
