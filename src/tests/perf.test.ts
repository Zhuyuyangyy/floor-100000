import { describe, expect, it } from 'vitest';

import {
  FloatTextPool,
  FrameBudgetGuard,
  fxShotCount,
  isFxDegraded,
  playFx,
  setFxDegraded,
} from '../render/fx';

// AG-80 性能三件套的单测：帧预算守卫 + 一次性特效池 + 飘字池。
//
// tools/perf-probe.mjs 第 238 行的注释声称「触发阈值由 src/tests/perf.test.ts
// 的帧预算守卫单测钉住」——本文件就是那句话的落点。纪律与项目惯例一致：纯 TS、
// 不碰 Phaser 运行时。FrameBudgetGuard 本身就是无框架纯逻辑，直接测；两个池的
// 公开面（playFx / fxShotCount / setFxDegraded / FloatTextPool）经一个记录型
// 假场景承托（同 renderPerf.test.ts 的路数），生产代码零改动。
//
// 注释与实现的核对结论（本文件同时把这些数字钉成断言）：
//   * 守卫注释「mean > 25ms 且 ≥75% 窗口帧 > 25ms 降级；mean < 18ms 恢复」
//     与 FrameBudgetGuard 实现一致（slowFrames 默认 ceil(window*0.75)）；
//   * FX_SHOT_CAP = 4（「四发火花已读作爆炸，第五发回收最旧」）一致；
//   * FloatTextPool 默认 size 12 / depth 25 / rise 46 / duration 900 /
//     fadeDelay 420 / fadeDuration 480 与选项注释一致。未发现需修的注释。

// ── fx 一次性特效池的假场景 ────────────────────────────────────────────────
// playFx 的一次性分支只碰这些面：textures.exists/get（frameTotal、
// getFrameNames）、anims.exists/create、add.sprite、time.delayedCall，
// 以及 sprite 的 setPosition/setDepth/setVisible/setAlpha/setFlipX/
// setAngle/setScale/setOrigin/removeAllListeners/once/play 与 anims.timeScale。

interface FakeListener {
  event: string;
  cb: () => void;
}

class FakeSprite {
  textureKey: string;
  x = 0;
  y = 0;
  depth = 0;
  alpha = 1;
  visible = true;
  scaleX = 1;
  flipX = false;
  angle = 0;
  anims = { timeScale: 1 };
  played: string[] = [];
  listeners: FakeListener[] = [];
  removedEvents: string[] = [];

  constructor(key: string) {
    this.textureKey = key;
  }

  setPosition(x: number, y: number): this {
    this.x = x;
    this.y = y;
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
  setAlpha(a: number): this {
    this.alpha = a;
    return this;
  }
  setFlipX(f: boolean): this {
    this.flipX = f;
    return this;
  }
  setAngle(a: number): this {
    this.angle = a;
    return this;
  }
  setScale(s: number): this {
    this.scaleX = s;
    return this;
  }
  setOrigin(): this {
    return this;
  }
  removeAllListeners(event: string): this {
    this.removedEvents.push(event);
    this.listeners = this.listeners.filter((l) => l.event !== event);
    return this;
  }
  once(event: string, cb: () => void): this {
    this.listeners.push({ event, cb });
    return this;
  }
  play(key: string): this {
    this.played.push(key);
    return this;
  }
  /** 触发并消费一次性的完成监听（测试用手动代替动画跑完）。 */
  fireComplete(): void {
    const due = this.listeners.filter((l) => l.event === 'animationcomplete');
    this.listeners = this.listeners.filter((l) => l.event !== 'animationcomplete');
    for (const l of due) l.cb();
  }
}

interface FakeTimer {
  ms: number;
  cb: () => void;
  removed: number;
  remove(): void;
}

/** 每个图集的帧数。hit-spark 60 帧 @30fps = 2000ms，加 80ms 兜底 = 2080ms。 */
const FX_FRAMES: Record<string, number> = {
  'hit-spark': 60,
  parry: 60,
  'sword-slash': 60,
};

function makeFxScene(ids: string[] = Object.keys(FX_FRAMES)): {
  scene: unknown;
  sprites: FakeSprite[];
  anims: Set<string>;
  timers: FakeTimer[];
} {
  const sprites: FakeSprite[] = [];
  const anims = new Set<string>();
  const timers: FakeTimer[] = [];
  const scene = {
    add: {
      sprite: (x: number, y: number, key: string): FakeSprite => {
        const s = new FakeSprite(key);
        s.x = x;
        s.y = y;
        sprites.push(s);
        return s;
      },
    },
    textures: {
      exists: (key: string): boolean => ids.includes(key),
      get: (key: string): { frameTotal: number; getFrameNames: () => string[] } => {
        const n = FX_FRAMES[key] ?? 60;
        return {
          frameTotal: n,
          // Phaser 的 "<key> <index>" 命名；frameNames() 会滤掉 __BASE。
          getFrameNames: (): string[] => ['__BASE', ...Array.from({ length: n }, (_, i) => `${key} ${i}`)],
        };
      },
    },
    anims: {
      exists: (key: string): boolean => anims.has(key),
      create: (cfg: { key: string }): void => {
        anims.add(cfg.key);
      },
    },
    time: {
      delayedCall: (ms: number, cb: () => void): FakeTimer => {
        const t: FakeTimer = { ms, cb, removed: 0, remove: (): void => void t.removed++ };
        timers.push(t);
        return t;
      },
    },
  };
  return { scene, sprites, anims, timers };
}

// ── FrameBudgetGuard ───────────────────────────────────────────────────────

describe('FrameBudgetGuard — 帧预算守卫（AG-80）', () => {
  it('默认阈值与注释一致：60 帧窗口、>25ms 降级、<18ms 恢复、75% 慢帧', () => {
    // 注释声称的数字全部由行为钉住：60 帧 @30ms 时均值 30>25 且慢帧 60≥45，
    // 第 60 帧降级；差一帧不判（窗口未满）。
    const edges: boolean[] = [];
    const g = new FrameBudgetGuard({ onDegrade: (on) => edges.push(on) });
    for (let i = 0; i < 59; i++) expect(g.sample(30)).toBe(false);
    expect(g.degraded).toBe(false);
    expect(g.sample(30)).toBe(true); // 第 60 帧：均值 30、慢帧 60
    expect(g.degraded).toBe(true);
    expect(edges).toEqual([true]);
  });

  it('窗口填满前不判定：59 帧 100ms 也不降级', () => {
    const g = new FrameBudgetGuard();
    for (let i = 0; i < 59; i++) expect(g.sample(100)).toBe(false);
    expect(g.meanMs).toBe(100); // 均值照算，只是不触发
    expect(g.degraded).toBe(false);
  });

  it('双条件都要满足：均值超线但慢帧不够，不降级', () => {
    // 默认 slowFrames = ceil(60*0.75) = 45。44 帧 30ms（慢）+ 16 帧 25ms
    // （判定是严格大于，25 不计慢）：均值 28.7 过线，慢帧 44 差一个达标——
    // 这正是「一次 GC 暂停 / 一次爬梯尖峰撬不动它」的注释口径。
    const g = new FrameBudgetGuard();
    for (let i = 0; i < 44; i++) g.sample(30);
    for (let i = 0; i < 16; i++) g.sample(25);
    expect(g.meanMs).toBeCloseTo((44 * 30 + 16 * 25) / 60, 5);
    expect(g.meanMs).toBeGreaterThan(25);
    expect(g.degraded).toBe(false);
    // 慢帧到 45/60（75% 整）即降级——「持续撑不住 40fps」的另一半。
    const g2 = new FrameBudgetGuard();
    for (let i = 0; i < 45; i++) g2.sample(30);
    for (let i = 0; i < 15; i++) g2.sample(25);
    expect(g2.degraded).toBe(true);
    // 单次 200ms 卡顿夹在 59 帧 5ms 里：均值 8.25 被窗口稀释，同样不降级。
    const g3 = new FrameBudgetGuard();
    for (let i = 0; i < 59; i++) g3.sample(5);
    g3.sample(200);
    expect(g3.meanMs).toBeCloseTo((59 * 5 + 200) / 60, 5);
    expect(g3.degraded).toBe(false);
  });

  it('滞回：降级后均值停在 20ms 不恢复，掉到 18ms 以下才恢复', () => {
    const edges: boolean[] = [];
    const g = new FrameBudgetGuard({ onDegrade: (on) => edges.push(on) });
    for (let i = 0; i < 60; i++) g.sample(30);
    expect(g.degraded).toBe(true);
    // 20ms：高于恢复线 18ms —— 故意留在滞回带里，防止贴线抖动。
    for (let i = 0; i < 60; i++) expect(g.sample(20)).toBe(true);
    expect(edges).toEqual([true]);
    // 17ms < 18ms：恢复，且恢复同样只走一次边沿。
    for (let i = 0; i < 60; i++) g.sample(17);
    expect(g.degraded).toBe(false);
    expect(edges).toEqual([true, false]);
  });

  it('恢复是边沿且可再次降级；贴线 18ms 不恢复', () => {
    const edges: boolean[] = [];
    const g = new FrameBudgetGuard({ window: 4, degradeMs: 25, recoverMs: 18, slowFrames: 2, onDegrade: (on) => edges.push(on) });
    for (let i = 0; i < 4; i++) g.sample(30); // 降级
    expect(edges).toEqual([true]);
    for (let i = 0; i < 4; i++) g.sample(10); // 恢复
    expect(edges).toEqual([true, false]);
    for (let i = 0; i < 4; i++) g.sample(30); // 再次降级
    expect(edges).toEqual([true, false, true]);
    // 恢复窗口里喂 18ms：不满足严格 < 18，保持降级。
    for (let i = 0; i < 4; i++) expect(g.sample(18)).toBe(true);
    for (let i = 0; i < 4; i++) expect(g.sample(17.9)).toBe(false);
  });

  it('慢帧判定是严格大于：恰等于 25ms 不计入慢帧', () => {
    // 窗口 4、慢帧线 4：两帧 25ms（不计慢）+ 两帧 30ms（计慢）→ 慢帧 2 < 4。
    const g = new FrameBudgetGuard({ window: 4, slowFrames: 4 });
    g.sample(25);
    g.sample(25);
    g.sample(30);
    g.sample(30);
    expect(g.degraded).toBe(false);
    // 同均值下把慢帧线降到 2 即降级——证明判官是慢帧数而非均值。
    const g2 = new FrameBudgetGuard({ window: 4, slowFrames: 2 });
    g2.sample(25);
    g2.sample(25);
    g2.sample(30);
    g2.sample(30);
    expect(g2.degraded).toBe(true);
  });

  it('reset 清窗：均值归零、重新填满才判定、不产生假边沿', () => {
    const edges: boolean[] = [];
    const g = new FrameBudgetGuard({ window: 4, slowFrames: 2, onDegrade: (on) => edges.push(on) });
    for (let i = 0; i < 4; i++) g.sample(30);
    expect(g.degraded).toBe(true);
    g.reset();
    expect(g.meanMs).toBe(0);
    // 已降级态保留（reset 只清窗口），但窗口未满不重新判定。
    for (let i = 0; i < 3; i++) expect(g.sample(30)).toBe(true);
    expect(edges).toEqual([true]); // 没有第二次 true 边沿
    g.sample(30); // 第 4 帧填满：仍降级，无新边沿
    expect(edges).toEqual([true]);
  });

  it('负 delta 夹零；自定义阈值参数生效', () => {
    const g = new FrameBudgetGuard({ window: 2, slowFrames: 2 });
    g.sample(-50);
    expect(g.meanMs).toBe(0); // Math.max(0, delta)
    g.sample(10);
    expect(g.meanMs).toBe(5);
  });
});

// ── FxShotPool（经 playFx / fxShotCount / setFxDegraded 公开面） ───────────

/**
 * playFx 的声明返回类型是 Phaser 真类型，假场景里返回的就是 FakeSprite；
 * 包一层转型，测试主体不用到处 as never。
 */
function play(scene: unknown, id: string, x = 0, y = 0, depth = 24, opts?: { timeScale?: number }): FakeSprite | null {
  return playFx(scene as never, id, x, y, depth, opts) as unknown as FakeSprite | null;
}

describe('FxShotPool — 一次性特效池（AG-80）', () => {
  it('每特效键上限 4：第五发回收最旧的那枚', () => {
    // 注释：「四发火花已读作爆炸；第五发回收最旧的」。回收 = 复用同一个
    // sprite 对象，不是新建。
    const { scene, sprites } = makeFxScene();
    const plays: FakeSprite[] = [play(scene, 'hit-spark')!];
    for (let i = 1; i < 5; i++) plays.push(play(scene, 'hit-spark', i * 10)!);
    expect(sprites).toHaveLength(4);
    expect(fxShotCount(scene as never, 'hit-spark')).toBe(4);
    expect(plays[4]).toBe(plays[0]); // 第五发拿到的是最旧那枚
  });

  it('上限按特效键隔离：hit-spark 打满不影响 parry', () => {
    const { scene, sprites } = makeFxScene();
    for (let i = 0; i < 4; i++) play(scene, 'hit-spark', i);
    const p = play(scene, 'parry');
    expect(p).not.toBeNull();
    expect(fxShotCount(scene as never, 'hit-spark')).toBe(4);
    expect(fxShotCount(scene as never, 'parry')).toBe(1);
    expect(fxShotCount(scene as never)).toBe(5); // 总数 = 各键之和
    expect(sprites).toHaveLength(5);
  });

  it('release 复用：动画完成事件回收，下一发拿回同一枚且复位可见', () => {
    const { scene, sprites } = makeFxScene();
    play(scene, 'hit-spark', 3, 4);
    const sprite = sprites[0];
    expect(sprite.visible).toBe(true);
    // animationcomplete → releaseShot：隐藏回池。
    sprite.fireComplete();
    expect(sprite.visible).toBe(false);
    expect(fxShotCount(scene as never, 'hit-spark')).toBe(1); // 池里还在，不销毁
    // 下一发复用同一枚，重新可见、位置复位。
    const again = play(scene, 'hit-spark', 30, 40);
    expect(again).toBe(sprite);
    expect(sprite.visible).toBe(true);
    expect(sprite.x).toBe(30);
    expect(sprite.y).toBe(40);
    expect(sprites).toHaveLength(1);
  });

  it('超限回收会移除旧安全计时器；过期监听因 gen 不匹配不再提前回收', () => {
    const { scene, timers } = makeFxScene();
    const s1 = play(scene, 'hit-spark')!;
    const stale = s1.listeners.find((l) => l.event === 'animationcomplete')!.cb; // gen 1
    const firstTimer = timers[0];
    play(scene, 'hit-spark', 1);
    play(scene, 'hit-spark', 2);
    play(scene, 'hit-spark', 3);
    const s5 = play(scene, 'hit-spark', 4); // 第五发回收 s1
    expect(s5).toBe(s1);
    // 旧计时器被摘掉（超限回收分支摘一次，随后的复用路径再摘一次），
    // 并为这次播放登记一枚新计时器。
    expect(firstTimer.removed).toBeGreaterThanOrEqual(1);
    expect(timers).toHaveLength(5);
    // 旧监听（gen 1）在新播放（gen 2）上触发：不回收。
    stale();
    expect(s1.visible).toBe(true);
    // 新监听触发：回收。
    s1.fireComplete();
    expect(s1.visible).toBe(false);
  });

  it('安全计时器按拉伸后的时长兜底回收（hit-spark 60帧@30fps = 2080ms）', () => {
    const { scene, sprites, timers } = makeFxScene();
    const s = play(scene, 'hit-spark')!;
    const timer = timers[timers.length - 1];
    expect(timer.ms).toBe(2080); // (60/30)*1000 + 80
    timer.cb();
    expect(sprites[0].visible).toBe(false);
    expect(s.visible).toBe(false);
  });

  it('timeScale 拉伸时长：慢放一发计时器按比例拉长', () => {
    const { scene, timers } = makeFxScene();
    play(scene, 'hit-spark', 0, 0, 24, { timeScale: 0.5 });
    expect(timers[timers.length - 1].ms).toBe(4080); // (2000/0.5) + 80
  });

  it('降级开关按场景隔离：降级场景 playFx no-op，恢复后照常', () => {
    const a = makeFxScene();
    const b = makeFxScene();
    setFxDegraded(a.scene as never, true);
    expect(isFxDegraded(a.scene as never)).toBe(true);
    expect(play(a.scene, 'hit-spark')).toBeNull();
    expect(a.sprites).toHaveLength(0);
    // 另一个场景不受影响（WeakSet 按场景键控）。
    expect(isFxDegraded(b.scene as never)).toBe(false);
    expect(play(b.scene, 'hit-spark')).not.toBeNull();
    setFxDegraded(a.scene as never, false);
    expect(isFxDegraded(a.scene as never)).toBe(false);
    expect(play(a.scene, 'hit-spark')).not.toBeNull();
    expect(a.sprites).toHaveLength(1);
  });

  it('图集缺失时安全返回 null（不建对象、不建动画）', () => {
    const { scene, sprites, anims } = makeFxScene(['parry']); // 没有 hit-spark
    expect(play(scene, 'hit-spark')).toBeNull();
    expect(sprites).toHaveLength(0);
    expect(anims.size).toBe(0);
    // 未注册的特效键同样 null。
    const full = makeFxScene();
    expect(play(full.scene, 'no-such-fx')).toBeNull();
  });
});

// ── FloatTextPool ──────────────────────────────────────────────────────────

class FakeText {
  value = '';
  color = '';
  x = 0;
  y = 0;
  alpha = 1;
  visible = true;
  depth = 0;
  fontSize = '';
  destroyed = false;
  setTextCalls = 0;
  setColorCalls = 0;

  setOrigin(): this {
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
    this.value = t;
    this.setTextCalls++;
    return this;
  }
  setColor(c: string): this {
    this.color = c;
    this.setColorCalls++;
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
  setFontSize(s: string): this {
    this.fontSize = s;
    return this;
  }
  destroy(): this {
    this.destroyed = true;
    return this;
  }
}

interface FakeTween {
  targets: FakeText;
  /** 上升补间的目标 y（FloatTextPool 发的是 { targets, y, duration, ease }）。 */
  y?: number;
  /** 淡出补间的目标 alpha（发的是 { targets, alpha: 0, duration, delay, onComplete }）。 */
  alpha?: number;
  duration: number;
  delay?: number;
  onComplete?: () => void;
  /** killTweensOf 之后不再触发 onComplete——与 Phaser 语义一致。 */
  killed: boolean;
}

function makeTextScene(): { scene: unknown; texts: FakeText[]; tweens: FakeTween[]; killed: FakeText[] } {
  const texts: FakeText[] = [];
  const tweens: FakeTween[] = [];
  const killed: FakeText[] = [];
  const scene = {
    add: {
      text: (x: number, y: number, str: string, style: { fontSize: string }): FakeText => {
        const t = new FakeText();
        t.x = x;
        t.y = y;
        t.value = str;
        t.fontSize = style.fontSize;
        texts.push(t);
        return t;
      },
    },
    tweens: {
      add: (cfg: FakeTween): unknown => {
        tweens.push({ ...cfg, killed: false });
        return {};
      },
      killTweensOf: (t: FakeText): void => {
        killed.push(t);
        for (const tw of tweens) if (tw.targets === t) tw.killed = true;
      },
    },
  };
  return { scene, texts, tweens, killed };
}

/** spawn 的声明返回类型是 Phaser 真类型，假场景里返回的就是 FakeText。 */
function spawnText(pool: FloatTextPool, x: number, y: number, text: string, color: string): FakeText {
  return pool.spawn(x, y, text, color) as unknown as FakeText;
}

describe('FloatTextPool — 战斗飘字池（AG-80）', () => {
  it('预建 12 条且全部 idle：默认选项与注释一致', () => {
    const { scene, texts } = makeTextScene();
    const pool = new FloatTextPool(scene as never);
    expect(pool.createdCount).toBe(12);
    expect(pool.activeCount).toBe(0);
    expect(texts).toHaveLength(12);
    for (const t of texts) {
      expect(t.visible).toBe(false); // 预建即隐藏
      expect(t.depth).toBe(25); // 默认 DUST_DEPTH
      expect(t.fontSize).toBe('20px');
    }
  });

  it('spawn 20 次只创建 12 条（注释原话）——超发回收最旧', () => {
    const { scene, texts, killed } = makeTextScene();
    const pool = new FloatTextPool(scene as never);
    const first = spawnText(pool, 0, 0, '1', '#ffffff');
    for (let i = 2; i <= 12; i++) spawnText(pool, i, 0, `${i}`, '#ffffff');
    expect(pool.createdCount).toBe(12);
    expect(pool.activeCount).toBe(12);
    // 第 13 发：idle 见底，回收最旧在场飘字（第 1 发那条），不是新建。
    const thirteenth = spawnText(pool, 13, 0, '13', '#ffffff');
    expect(thirteenth).toBe(first);
    expect(killed).toContain(first); // 旧飘字的补间被掐掉
    expect(pool.createdCount).toBe(12);
    // 继续超发到 20：仍然 12 条，一条不多。
    for (let i = 14; i <= 20; i++) spawnText(pool, i, 0, `${i}`, '#ffffff');
    expect(pool.createdCount).toBe(12);
    expect(pool.activeCount).toBe(12);
    expect(texts).toHaveLength(12);
  });

  it('复用不串内容：回收条只改自己，其余各守其值', () => {
    const { scene, texts } = makeTextScene();
    const pool = new FloatTextPool(scene as never);
    const spawned: FakeText[] = [];
    for (let i = 1; i <= 12; i++) spawned.push(spawnText(pool, i, 0, `${i}`, '#ffffff'));
    const thirteenth = spawnText(pool, 13, 0, '13', '#ffffff');
    expect(thirteenth).toBe(spawned[0]); // 回收的是第 1 发那条
    expect(thirteenth.value).toBe('13');
    // 其余 11 条各守其值，一条不串。
    for (let i = 1; i < 12; i++) expect(spawned[i].value).toBe(`${i + 1}`);
    expect(new Set(texts.map((t) => t.value)).size).toBe(12);
  });

  it('值/颜色不变不重烤纹理：lastValue/lastColor 缓存生效', () => {
    const { scene, tweens } = makeTextScene();
    const pool = new FloatTextPool(scene as never);
    const fireFadeOf = (target: FakeText): void => {
      tweens.filter((tw) => tw.targets === target && tw.alpha === 0 && !tw.killed).forEach((tw) => tw.onComplete?.());
    };
    const t = spawnText(pool, 0, 0, '-3', '#ff0000');
    expect(t.setTextCalls).toBe(1);
    expect(t.setColorCalls).toBe(1);
    // 回收后再发同值同色：不重烤（缓存命中）。
    fireFadeOf(t);
    spawnText(pool, 0, 0, '-3', '#ff0000');
    expect(t.setTextCalls).toBe(1);
    expect(t.setColorCalls).toBe(1);
    // 换值才重烤。
    fireFadeOf(t);
    spawnText(pool, 0, 0, '-7', '#ff0000');
    expect(t.setTextCalls).toBe(2);
    expect(t.setColorCalls).toBe(1);
    // 换色才重烤。
    fireFadeOf(t);
    spawnText(pool, 0, 0, '-7', '#00ff00');
    expect(t.setColorCalls).toBe(2);
    // 位置每次 spawn 都复位（复用条带着上一次的位置）。
    expect(t.x).toBe(0);
    expect(t.y).toBe(0);
  });

  it('淡出完成即回收：隐藏回 idle，下一轮优先复用', () => {
    const { scene, tweens } = makeTextScene();
    const pool = new FloatTextPool(scene as never);
    const t = spawnText(pool, 5, 6, '-1', '#ffffff');
    expect(t.visible).toBe(true);
    expect(t.x).toBe(5);
    expect(t.y).toBe(6);
    // 两条补间：上升（全程 900ms、抬 46px）+ 淡出（延迟 420ms、时长 480ms）。
    const rise = tweens.find((tw) => tw.targets === t && tw.y !== undefined)!;
    const fade = tweens.find((tw) => tw.targets === t && tw.alpha === 0)!;
    expect(rise.duration).toBe(900);
    expect(rise.y).toBe(6 - 46); // rise 46
    expect(fade.duration).toBe(480);
    expect(fade.delay).toBe(420);
    expect(pool.activeCount).toBe(1);
    fade.onComplete!(); // 淡出到头 → recycle
    expect(t.visible).toBe(false);
    expect(pool.activeCount).toBe(0);
    // 回收后再 spawn：同一条复用。
    expect(spawnText(pool, 1, 2, '-2', '#ffffff')).toBe(t);
    expect(pool.activeCount).toBe(1);
  });

  it('size 选项可调（含下限 1），上限同样回收最旧', () => {
    const { scene, texts } = makeTextScene();
    const pool = new FloatTextPool(scene as never, { size: 3 });
    expect(pool.createdCount).toBe(3);
    const a = spawnText(pool, 0, 0, 'a', '#ffffff');
    spawnText(pool, 1, 0, 'b', '#ffffff');
    spawnText(pool, 2, 0, 'c', '#ffffff');
    expect(pool.activeCount).toBe(3);
    expect(spawnText(pool, 3, 0, 'd', '#ffffff')).toBe(a); // 第 4 发回收最旧
    expect(pool.createdCount).toBe(3);
    expect(texts).toHaveLength(3);
    const tiny = new FloatTextPool(scene as never, { size: 0 });
    expect(tiny.createdCount).toBe(1); // Math.max(1, …)
  });

  it('destroy 拆光：文本全毁、再 spawn 返回 null', () => {
    const { scene, texts } = makeTextScene();
    const pool = new FloatTextPool(scene as never, { size: 2 });
    spawnText(pool, 0, 0, 'x', '#ffffff');
    pool.destroy();
    for (const t of texts) expect(t.destroyed).toBe(true);
    expect(pool.createdCount).toBe(0);
    expect(pool.spawn(0, 0, 'y', '#ffffff')).toBeNull();
  });
});
