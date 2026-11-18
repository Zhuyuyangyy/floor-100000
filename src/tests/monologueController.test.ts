// AG-67 MonologueController 单测（RC-03 拆分第 2 步的「测试镜像」）。
// 设计文档 §5：控制器单测从场景测试里抽，记录型假场景模式（参考
// renderPerf.test.ts / perf.test.ts 路数）。纯函数层（台词表/门控/摘要/
// seeded 选句）由 monologue.test.ts 25 例守着；这里守的是**控制器接线**：
// tick 的门控语义、模态后不speak、重启 reset、以及 seeded 选句在控制器层
// 的确定性（同 seed 同脚本 → 同一串句子）。
//
// 为什么能在 Node 下跑：控制器的 import 链无 Phaser 值导入（host 是结构面
// 假件，drawHudPlate/drawStatBar/drawLine 只碰 Graphics 的 fillStyle/
// fillRect/clear——假件全数桩掉）。

import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';

import { MonologueController, type MonologueHost } from '../scenes/controllers/MonologueController';
import { getGame, startNewGame } from '../core/session';
import type { CharacterKey } from '../render/artpack';

// ── 记录型假件 ─────────────────────────────────────────────────────────────

class FakeGraphics {
  cleared = 0;
  name = '';
  clear(): this {
    this.cleared += 1;
    return this;
  }
  setName(n: string): this {
    this.name = n;
    return this;
  }
  fillStyle(): this {
    return this;
  }
  fillRect(): this {
    return this;
  }
  lineStyle(): this {
    return this;
  }
  strokeRect(): this {
    return this;
  }
  setScrollFactor(): this {
    return this;
  }
  setDepth(): this {
    return this;
  }
  setPosition(): this {
    return this;
  }
  destroy(): this {
    return this;
  }
}

class FakeText {
  text: string;
  name = '';
  alpha = 1;
  active = true;
  destroyed = false;
  constructor(text: string) {
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
  setDepth(): this {
    return this;
  }
  setText(t: string): this {
    this.text = t;
    return this;
  }
  setColor(): this {
    return this;
  }
  setAlpha(a: number): this {
    this.alpha = a;
    return this;
  }
  destroy(): this {
    this.destroyed = true;
    this.active = false;
    return this;
  }
}

class FakeImage {
  active = true;
  destroyed = false;
  setOrigin(): this {
    return this;
  }
  setCrop(): this {
    return this;
  }
  setScale(): this {
    return this;
  }
  setScrollFactor(): this {
    return this;
  }
  setDepth(): this {
    return this;
  }
  destroy(): this {
    this.destroyed = true;
    this.active = false;
    return this;
  }
}

class FakeFactory {
  readonly texts: FakeText[] = [];
  readonly images: FakeImage[] = [];
  graphics(): FakeGraphics {
    return new FakeGraphics();
  }
  text(_x: number, _y: number, text: string): FakeText {
    const t = new FakeText(text);
    this.texts.push(t);
    return t;
  }
  image(): FakeImage {
    const i = new FakeImage();
    this.images.push(i);
    return i;
  }
}

class FakeClock {
  now = 0;
  readonly events: Array<{ delay: number; loop: boolean }> = [];
  readonly delayed: Array<{ ms: number; fn: () => void }> = [];
  addEvent(cfg: { delay: number; loop: boolean }): { remove: () => void } {
    this.events.push({ delay: cfg.delay, loop: cfg.loop });
    return { remove: () => undefined };
  }
  delayedCall(ms: number, fn: () => void): void {
    this.delayed.push({ ms, fn });
  }
}

class FakeTweens {
  readonly added: Array<{ alpha: number; duration: number; hasComplete: boolean }> = [];
  add(cfg: { alpha: number; duration: number; onComplete?: () => void }): void {
    this.added.push({ alpha: cfg.alpha, duration: cfg.duration, hasComplete: !!cfg.onComplete });
    // 淡入的 onComplete 同步跑——它把气泡寿命接进 clock.delayedCall，
    // 链条后半段（delayedCall 的回调）不执行，气泡留在场上供断言。
    cfg.onComplete?.();
  }
}

class FakeHost {
  readonly factory = new FakeFactory();
  readonly clock = new FakeClock();
  readonly tweens = new FakeTweens();
  panelOpen = false;

  /** 收窄成控制器的结构面（假件不实现 Phaser.Manager 的全体成员）。 */
  asHost(): MonologueHost {
    return {
      add: this.factory as unknown as Phaser.GameObjects.GameObjectFactory,
      tweens: this.tweens as unknown as Phaser.Tweens.TweenManager,
      time: this.clock as unknown as Phaser.Time.Clock,
      metaSelectedCharacter: (): CharacterKey => 'player',
      anyPanelOpen: () => this.panelOpen,
    };
  }
}

const BARS = [
  { key: 'hp', label: '生命' },
  { key: 'hunger', label: '饥饿' },
  { key: 'thirst', label: '口渴' },
  { key: 'energy', label: '精力' },
] as const;

/** 建一个控制器并跑首建；state 已由调用方按剧本摆好。 */
function boot(host: FakeHost): MonologueController {
  const c = new MonologueController(host.asHost(), BARS);
  c.build();
  return c;
}

const bubbleOf = (host: FakeHost): FakeText | undefined =>
  host.factory.texts.filter((t) => t.name === 'hud-status-bubble').at(-1);

describe('AG-67 MonologueController（RC-03 拆分第 2 步）', () => {
  it('成功路径：残血首 tick 入队并出句（气泡 + spokenCount + 淡入 tween）', () => {
    startNewGame(4242);
    getGame().player.hp = 20; // 20/100 < 0.3 阈值
    const host = new FakeHost();
    const c = boot(host);
    expect(c.spokenCount).toBe(0);

    c.tick();

    expect(c.spokenCount).toBe(1);
    const bubble = bubbleOf(host);
    expect(bubble, '残血首 tick 应飘出一句').toBeTruthy();
    expect(bubble!.text.length).toBeGreaterThan(0);
    expect(bubble!.alpha).toBe(0); // 淡入由 tween 接管，出生即透明
    expect(host.tweens.added[0]).toMatchObject({ alpha: 1, duration: 140, hasComplete: true });
    // 气泡寿命的 delayedCall 也接好了（2600-440=2160ms 后开始淡出）
    expect(host.clock.delayed[0]?.ms).toBe(2160);
  });

  it('状态卡读数与真实 state 一致（名称/四值/摘要）', () => {
    startNewGame(4242);
    const s = getGame();
    s.player.hp = 37;
    s.player.hunger = 44;
    s.player.thirst = 88;
    s.player.energy = 61;
    const host = new FakeHost();
    const c = boot(host);
    c.tick();
    const byName = (n: string): FakeText | undefined => host.factory.texts.find((t) => t.name === n);
    expect(byName('hud-status-name')?.text).toBe('幸存者');
    expect(byName('hud-status-value-hp')?.text).toBe('37');
    expect(byName('hud-status-value-hunger')?.text).toBe('44');
    expect(byName('hud-status-value-thirst')?.text).toBe('88');
    expect(byName('hud-status-value-energy')?.text).toBe('61');
    expect(byName('hud-status-summary')?.text).toBe('状态尚可');
  });

  it('9s 总闸：间隔内的第二个处境只入队不出句', () => {
    startNewGame(4242);
    const s = getGame();
    s.player.hp = 20;
    const host = new FakeHost();
    const c = boot(host);
    c.tick(); // hp_low 出句（spoken=1）
    expect(c.spokenCount).toBe(1);

    s.player.hunger = 10; // 新处境
    host.clock.now = 1000; // 距上一句 1s < minGap 9s
    c.tick();

    expect(c.spokenCount, '总闸内不飘第二句').toBe(1);
    expect(bubbleOf(host)?.name).toBe('hud-status-bubble'); // 还是第一句那个泡
  });

  it('一次 tick 只飘一句：剩余处境排队，等下一个过闸的 tick 补排', () => {
    startNewGame(4242);
    const s = getGame();
    s.player.hp = 20;
    s.player.hunger = 10; // 首 tick 两个处境同时入队
    const host = new FakeHost();
    const c = boot(host);
    c.tick();
    expect(c.spokenCount, '一次 tick 只飘一句（一泡一泡来）').toBe(1);

    host.clock.now = 10_000; // 过 9s 总闸
    c.tick();
    expect(c.spokenCount, '排队中的处境补排').toBe(2);
    expect(bubbleOf(host)?.text.length).toBeGreaterThan(0);
  });

  it('被闸门拒绝的处境即弃（stale news）：过闸后也不会补飘', () => {
    // 45s 行冷却/9s 总闸的逐格语义由 monologue.test.ts 守着；这里钉控制器
    // 接线：flush 循环 shift 出来的 trigger 一旦被 speak 拒绝就出队——旧闻
    // 不值得第二泡（原 GameScene 同款语义，逐字保留）。
    startNewGame(4242);
    const s = getGame();
    s.player.hp = 20;
    const host = new FakeHost();
    const c = boot(host);
    c.tick(); // hp_low 出句
    expect(c.spokenCount).toBe(1);

    s.player.hunger = 10;
    host.clock.now = 1000; // 总闸内 → hunger_low 入队但被拒（出队丢弃）
    c.tick();
    expect(c.spokenCount).toBe(1);

    host.clock.now = 10_000; // 过闸也没用——那条处境已经不在队列里
    c.tick();
    expect(c.spokenCount, '被拒的处境即弃，过闸不补飘').toBe(1);
  });

  it('模态开着只 WATCHING 不 SPEAKING：面板合上后的下一个 tick 补排', () => {
    startNewGame(4242);
    getGame().player.hp = 20;
    const host = new FakeHost();
    const c = boot(host);
    host.panelOpen = true; // 面板开着（首 tick 的入队照常，出句被拦）
    c.tick();
    expect(c.spokenCount).toBe(0);

    host.panelOpen = false;
    c.tick(); // 队列里还有 hp_low——无面板的 tick 补排
    expect(c.spokenCount).toBe(1);
    expect(bubbleOf(host)?.text.length).toBeGreaterThan(0);
  });

  it('reset：卡件销毁、句数归零（场景重启惯例）', () => {
    startNewGame(4242);
    getGame().player.hp = 20;
    const host = new FakeHost();
    const c = boot(host);
    c.tick();
    expect(c.spokenCount).toBe(1);
    const cardTexts = host.factory.texts.filter((t) => t.name.startsWith('hud-status'));
    expect(cardTexts.length).toBeGreaterThan(0);

    c.reset();

    expect(c.spokenCount).toBe(0);
    expect(cardTexts.every((t) => t.destroyed)).toBe(true);
    expect(host.clock.events.length, '定时器建过一次（reset 走 remove，字段诚实）').toBe(1);
  });

  it('seeded 选句确定性：同 seed 同脚本 → 同一串句子；控制器不碰 Math.random', () => {
    const script = (c: MonologueController, host: FakeHost): string[] => {
      const s = getGame();
      const lines: string[] = [];
      const tickAndCollect = (): void => {
        const before = c.spokenCount;
        c.tick();
        if (c.spokenCount > before) lines.push(bubbleOf(host)!.text);
      };
      s.player.hp = 20;
      tickAndCollect(); // hp_low
      s.player.hunger = 10;
      host.clock.now = 10_000;
      tickAndCollect(); // hunger_low
      s.player.thirst = 10;
      host.clock.now = 20_000;
      tickAndCollect(); // thirst_low
      return lines;
    };

    startNewGame(777);
    const hostA = new FakeHost();
    const linesA = script(boot(hostA), hostA);
    expect(linesA.length).toBe(3);

    startNewGame(777);
    const hostB = new FakeHost();
    const linesB = script(boot(hostB), hostB);
    expect(linesB).toEqual(linesA);

    // 行为探针：整条脚本期间任何一次 Math.random 都直接炸。
    const original = Math.random;
    Math.random = (): number => {
      throw new Error('控制器选句禁 Math.random：必须走 monologueRng 派生');
    };
    try {
      startNewGame(777);
      const hostC = new FakeHost();
      expect(() => script(boot(hostC), hostC)).not.toThrow();
    } finally {
      Math.random = original;
    }
  });
});
