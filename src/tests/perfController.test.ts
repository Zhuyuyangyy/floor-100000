// AG-80 PerfController 单测（RC-03 拆分第 4 步的「测试镜像」）。
// 设计文档 §5：控制器单测从场景测试里抽，记录型假件模式（参考
// monologueController.test.ts / tutorialController.test.ts / perf.test.ts
// 路数）。纯逻辑层（FrameBudgetGuard 的双阈值滞回 / FloatTextPool 的回收 /
// setFxDegraded 的入册）由 perf.test.ts 23 例守着；这里守的是**控制器编排**：
// init 首建契约（池先毁再建 + 计数器几何 + F3 稳定处理器 off/on 不叠监听）、
// tick 每帧喂守卫（HUD 不可见也喂）、F3 一帧一次与显隐、计数器 500ms 节流
// 与按值缓存、降级边沿的两开关与计数器即时反映、spawnFloatText 委托。
//
// 为什么能在 Node 下跑：控制器的 import 链无 Phaser 值导入（host 是结构面
// 假件，createFloatTextPool/setFxDegraded 两个场景薄封装由假件注入，Text
// 只碰 setOrigin/setName/setScrollFactor/setDepth/setVisible/setText/
// setColor——假件全数桩掉）。守卫用真的（fx.ts 纯逻辑）——边沿 wiring 正是
// 要测的东西。

import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';

import { PerfController, type PerfHost } from '../scenes/controllers/PerfController';
import { TEXT, hex } from '../render/palette';
import { HUD_FEEDBACK_DEPTH } from '../render/panels';
import { HUD_LAYOUT } from '../render/hudLayout';
import { DUST_DEPTH } from '../render/lighting';

// ── 记录型假件 ─────────────────────────────────────────────────────────────

/** 计数器 Text：只碰控制器会碰的链式面，全部记录。 */
class FakeText {
  x = 0;
  y = 0;
  text = '';
  color = '';
  visible = false;
  name = '';
  scrollFactor: [number, number] = [1, 1];
  depth = 0;
  origin: [number, number] = [0, 0];
  style = { color: '' };
  destroyed = false;
  /** setText 调用次数——按值缓存的断言读它（没变不碰对象）。 */
  setTextCalls = 0;
  setOrigin(x: number, y: number): this {
    this.origin = [x, y];
    return this;
  }
  setName(n: string): this {
    this.name = n;
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
  setVisible(v: boolean): this {
    this.visible = v;
    return this;
  }
  setText(t: string): this {
    this.setTextCalls += 1;
    this.text = t;
    this.style.color = this.color;
    return this;
  }
  setColor(c: string): this {
    this.color = c;
    return this;
  }
  destroy(): this {
    this.destroyed = true;
    return this;
  }
}

/** 飘字池假件：控制器只碰 destroy/spawn/createdCount/activeCount。 */
class FakePool {
  destroyed = false;
  readonly spawns: Array<{ x: number; y: number; text: string; color: string }> = [];
  constructor(readonly depth: number) {}
  get createdCount(): number {
    return 12;
  }
  get activeCount(): number {
    return this.spawns.length;
  }
  spawn(x: number, y: number, text: string, color: string): void {
    this.spawns.push({ x, y, text, color });
  }
  destroy(): void {
    this.destroyed = true;
  }
}

/** 键盘管理器假件：on/off 记有序调用，handle() 手动触发（模拟 F3）。 */
class FakeKeyboard {
  readonly calls: Array<{ op: 'on' | 'off'; key: string }> = [];
  private readonly handlers = new Map<string, Set<() => void>>();
  on(key: string, fn: () => void): this {
    this.calls.push({ op: 'on', key });
    if (!this.handlers.has(key)) this.handlers.set(key, new Set());
    this.handlers.get(key)!.add(fn);
    return this;
  }
  off(key: string, fn: () => void): this {
    this.calls.push({ op: 'off', key });
    this.handlers.get(key)?.delete(fn);
    return this;
  }
  /** 触发 F3（返回是否有处理器响应——叠监听会响应两次）。 */
  press(): number {
    let n = 0;
    for (const fn of this.handlers.get('keydown-F3') ?? []) {
      fn();
      n += 1;
    }
    return n;
  }
  get bound(): number {
    return this.handlers.get('keydown-F3')?.size ?? 0;
  }
}

class FakeGame {
  constructor(public frame = 0) {}
  getFrame(): number {
    return this.frame;
  }
}

class FakeClock {
  now = 0;
}

class FakeHost {
  readonly clock = new FakeClock();
  readonly game = new FakeGame();
  readonly keyboard = new FakeKeyboard();
  readonly texts: FakeText[] = [];
  readonly pools: FakePool[] = [];
  /** 降级边沿两开关的调用记录（有序）。 */
  readonly degradeCalls: Array<{ what: 'fx' | 'breathing'; on: boolean }> = [];
  /** 呼吸停帧面：无战斗时 no-op 也要记（控制器无条件调）。 */
  breathingCalls = 0;

  /** Phaser.Time.Clock 结构面（节流读 now）。 */
  get time(): Phaser.Time.Clock {
    return this.clock as unknown as Phaser.Time.Clock;
  }

  add = {
    text: (x: number, y: number): FakeText => {
      const t = new FakeText();
      t.x = x;
      t.y = y;
      this.texts.push(t);
      return t;
    },
  } as unknown as Phaser.GameObjects.GameObjectFactory;

  input = { keyboard: this.keyboard } as unknown as Phaser.Input.InputPlugin;

  createFloatTextPool(depth: number): FakePool {
    const p = new FakePool(depth);
    this.pools.push(p);
    return p;
  }
  setFxDegraded(on: boolean): void {
    this.degradeCalls.push({ what: 'fx', on });
  }
  setMonsterBreathing(on: boolean): void {
    this.breathingCalls += 1;
    this.degradeCalls.push({ what: 'breathing', on });
  }

  /** 收窄成控制器的结构面（假件不实现 Phaser 单子的全体成员）。 */
  asHost(): PerfHost {
    return this as unknown as PerfHost;
  }
}

/** 建一个控制器并跑首建（对位 create() 里 drawFloor 之前的 perf.init()）。 */
function boot(): { c: PerfController; host: FakeHost } {
  const host = new FakeHost();
  const c = new PerfController(host.asHost());
  c.init();
  return { c, host };
}

/** 按一次 F3（帧号 +1 过「一帧一次」去重），返回响应次数。 */
const pressF3 = (host: FakeHost): number => {
  host.game.frame += 1;
  return host.keyboard.press();
};

// ── 用例 ───────────────────────────────────────────────────────────────────

describe('AG-80 PerfController（RC-03 拆分第 4 步）', () => {
  it('init 首建：计数器几何/深度/底板与 hud-fps 具名，默认不可见', () => {
    const { host } = boot();
    const t = host.texts[0];
    expect(host.texts.length).toBe(1);
    // 几何契约：右上角逐个（hudLayout.fpsX/fpsY），右对齐
    expect(t.x).toBe(HUD_LAYOUT.fpsX);
    expect(t.y).toBe(HUD_LAYOUT.fpsY);
    expect(t.origin).toEqual([1, 0]);
    expect(t.name).toBe('hud-fps');
    expect(t.scrollFactor).toEqual([0, 0]);
    expect(t.depth).toBe(HUD_FEEDBACK_DEPTH);
    expect(t.visible).toBe(false); // 默认不可见，e2e 的 HUD 取证不受影响
    expect(t.text).toBe('');
  });

  it('init 首建：飘字池按 DUST_DEPTH + 4 建造（池化前未池化 Text 的同一深度）', () => {
    const { host } = boot();
    expect(host.pools.length).toBe(1);
    expect(host.pools[0].depth).toBe(DUST_DEPTH + 4);
  });

  it('init 重启：旧池先毁再建（场景重启不清显示列表，旧 Text 不拆留幽灵字）', () => {
    const host = new FakeHost();
    const c = new PerfController(host.asHost());
    c.init();
    c.init(); // 场景重启：create() 再跑一遍
    expect(host.pools.length).toBe(2);
    expect(host.pools[0].destroyed).toBe(true);
    expect(host.pools[1].destroyed).toBe(false);
  });

  it('F3 绑定：重启 off 再 on，不叠第二份监听', () => {
    const host = new FakeHost();
    const c = new PerfController(host.asHost());
    c.init();
    expect(host.keyboard.calls).toEqual([
      { op: 'off', key: 'keydown-F3' },
      { op: 'on', key: 'keydown-F3' },
    ]);
    c.init(); // 重启：先撤旧的再挂，bound 恒为 1
    expect(host.keyboard.calls.slice(2)).toEqual([
      { op: 'off', key: 'keydown-F3' },
      { op: 'on', key: 'keydown-F3' },
    ]);
    expect(host.keyboard.bound).toBe(1);
  });

  it('tick 每帧喂守卫：HUD 不可见也喂（守卫覆盖爬梯/面板/战斗全程）', () => {
    const { c, host } = boot();
    for (let i = 0; i < 5; i++) c.tick(16.7);
    // 计数器不可见：不该有任何 setText（节流早退在喂样之后）
    expect(host.texts[0].setTextCalls).toBe(0);
    // 喂样生效的间接证据：60 帧满窗 + 全慢帧 → 降级边沿真的来了（见下一例）
    expect(host.degradeCalls.length).toBe(0);
  });

  it('降级边沿 wiring：60 帧持续 >25ms → setFxDegraded(true) + 呼吸停 + 计数器转 warn 缀「· 降级」', () => {
    const { c, host } = boot();
    // F3 打开计数器（打开时立刻刷一次，不等 500ms 节流点）
    expect(pressF3(host)).toBe(1);
    expect(host.texts[0].visible).toBe(true);
    expect(host.texts[0].setTextCalls).toBe(1);
    // 窗口 60 帧全 30ms（mean 30 > 25 且 60/60 > 75%）→ 第 60 帧边沿
    for (let i = 0; i < 60; i++) c.tick(30);
    expect(host.degradeCalls).toEqual([
      { what: 'fx', on: true },
      { what: 'breathing', on: false },
    ]);
    expect(c.isDegraded).toBe(true);
    // 计数器立刻反映状态（applyDegrade 的 force 刷新）：文案 + 颜色
    const t = host.texts[0];
    expect(t.text).toBe('33 FPS · 降级'); // 1000/30 四舍五入
    expect(t.color).toBe(hex(TEXT.warn));
    // 恢复：窗口均值 < 18ms → 边沿回翻，两开关与颜色都归位
    for (let i = 0; i < 60; i++) c.tick(10);
    expect(host.degradeCalls.slice(2)).toEqual([
      { what: 'fx', on: false },
      { what: 'breathing', on: true },
    ]);
    expect(c.isDegraded).toBe(false);
    expect(t.color).toBe(hex(TEXT.secondary));
    // 边沿瞬间的文案 = 边沿时刻的窗口均值：第 37 帧 10ms 时均值跌到 17.67ms
    // （30 - 37/3）→ 57 FPS。计数器是 force 刷的，反映的就是这一刻。
    expect(t.text).toBe('57 FPS');
    // 窗口全部换成 10ms 后跨节流点再刷：100 FPS
    host.clock.now = 600;
    c.tick(10);
    expect(t.text).toBe('100 FPS');
  });

  it('F3 一帧只认一次：同帧重复触发不翻两次（看显隐，不看调用）', () => {
    const { host } = boot();
    const t = host.texts[0];
    host.keyboard.press(); // frame 0 ≠ -1：开
    expect(t.visible).toBe(true);
    host.keyboard.press(); // 同帧再按：去重吞掉，不翻回
    expect(t.visible).toBe(true);
    host.game.frame += 1;
    host.keyboard.press(); // 下一帧：翻回收起
    expect(t.visible).toBe(false);
  });

  it('F3 显隐：打开强制刷新一次，关闭清空文案', () => {
    const { c, host } = boot();
    const t = host.texts[0];
    c.tick(16.7);
    expect(t.visible).toBe(false);
    pressF3(host); // 开
    expect(t.visible).toBe(true);
    expect(t.setTextCalls).toBe(1); // 打开即刷，不等 500ms
    pressF3(host); // 关
    expect(t.visible).toBe(false);
    expect(t.text).toBe('');
  });

  it('计数器 500ms 节流：窗内不刷、过期才刷、按值缓存（没变不碰对象）', () => {
    const { c, host } = boot();
    pressF3(host); // 开（强制刷一次：窗口未满 mean=0 → 「0 FPS」）
    const t = host.texts[0];
    expect(t.text).toBe('0 FPS');
    expect(t.setTextCalls).toBe(1);
    // 窗内（<500ms）：喂了也不刷
    host.clock.now = 100;
    c.tick(16.7);
    expect(t.setTextCalls).toBe(1);
    // 跨过 500ms 节流点且值变化（1 帧 16.7ms → 60 FPS）→ 刷新并记新节流点
    host.clock.now = 700;
    c.tick(16.7);
    expect(t.text).toBe('60 FPS');
    expect(t.setTextCalls).toBe(2);
    // 新节流点后 400ms 内：不刷
    host.clock.now = 1100;
    c.tick(16.7);
    expect(t.setTextCalls).toBe(2);
    // 再跨节流点但值没变（仍 60 FPS）→ 按值缓存命中，不碰对象
    host.clock.now = 1300;
    c.tick(16.7);
    expect(t.setTextCalls).toBe(2);
    // 窗口填满且值变化（60 帧全 20ms → 均值恰 20ms → 50 FPS）。中途按节流
    // 点刷过几次不重要——收尾一次跨节流点的刷新必须恰好落在 50 FPS。
    for (let i = 0; i < 60; i++) {
      host.clock.now = 1400 + i * 10;
      c.tick(20);
    }
    const before = t.setTextCalls;
    host.clock.now += 600;
    c.tick(20);
    expect(t.text).toBe('50 FPS');
    expect(t.setTextCalls).toBe(before + 1);
  });

  it('spawnFloatText 委托池：坐标/文案/颜色原样透传', () => {
    const { c, host } = boot();
    c.spawnFloatText(120, 260, '-3', '#ff0000');
    expect(host.pools[0].spawns).toEqual([{ x: 120, y: 260, text: '-3', color: '#ff0000' }]);
    expect(c.floatTextCounts).toEqual({ created: 12, active: 1 });
  });

  it('读数面：counterText/counterColor 在 init 前有空值兜底', () => {
    const host = new FakeHost();
    const c = new PerfController(host.asHost());
    expect(c.counterText).toBe('');
    expect(c.counterColor).toBe('');
    expect(c.floatTextCounts).toEqual({ created: 0, active: 0 });
    expect(c.isDegraded).toBe(false);
  });
});
