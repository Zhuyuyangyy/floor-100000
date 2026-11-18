// AG-77 AchievementController 单测（RC-03 拆分第 5 步的「测试镜像」）。
// 设计文档 §5：控制器单测从场景测试里抽，记录型假件模式（参考
// monologueController.test.ts / perfController.test.ts 路数）。纯判定层
// （十四条成就的谓词/事件并入/读档修复/写盘 best-effort）由 achievements.test.ts
// 28 例守着；这里守的是**控制器编排**：
//   · emit——解锁入队 + 独立键落盘委托 + 幂等（已解锁不重发）；
//   · toast 队列——同屏 3 枚上限、550ms 节流、到期退场销毁、退场后补位；
//   · 跨天对账——day 不变不出事件、noteThirstZero 只影响刚过去那天；
//   · 战斗受伤记账——清零/累加/读数（boss_won 的 damageTaken 判据接线）；
//   · init——独立键读回（重置游戏不清奖杯柜）+ 记账清零。
//
// 为什么能在 Node 下跑：控制器的 import 链无 Phaser 值导入（host 是结构面
// 假件，drawHudIcon 只碰 Graphics 的 fillStyle/fillRect/fillPoints——假件
// 桩掉；playSfx 无 window 时 no-op）。落盘用 Map 假件 Storage（与
// achievements.test.ts 的 memoryStorage 同款），证明委托链真的写到了独立键。

import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';

import { AchievementController, type AchievementHost } from '../scenes/controllers/AchievementController';
import { loadAchievements, saveAchievements } from '../systems/AchievementSystem';

// ── 记录型假件 ─────────────────────────────────────────────────────────────

/** toast 零件三型共用的链式面（控制器只会碰这些）。 */
class FakePart {
  alpha = 1;
  name = '';
  scrollFactor: [number, number] = [1, 1];
  depth = 0;
  origin: [number, number] = [0, 0];
  x: number;
  y: number;
  destroyed = false;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  setOrigin(x: number, y: number): this {
    this.origin = [x, y];
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
  setAlpha(a: number): this {
    this.alpha = a;
    return this;
  }
  setName(n: string): this {
    this.name = n;
    return this;
  }
  destroy(): this {
    this.destroyed = true;
    return this;
  }
}

/** Graphics 零件：fillStyle/fillRect/fillPoints 全数记录（drawHudIcon 走它）。 */
class FakeGraphics extends FakePart {
  readonly draws: string[] = [];
  fillStyle(): this {
    this.draws.push('fillStyle');
    return this;
  }
  fillRect(x: number, y: number, w: number, h: number): this {
    this.draws.push(`fillRect:${x},${y},${w},${h}`);
    return this;
  }
  fillPoints(): this {
    this.draws.push('fillPoints');
    return this;
  }
}

/** Text 零件：多记一个 text 字段（toast 名牌读它）。 */
class FakeText extends FakePart {
  text: string;
  constructor(x: number, y: number, text: string) {
    super(x, y);
    this.text = text;
  }
}

/** tween 配置记录：onComplete 手动触发（模拟动画跑完）。 */
interface FakeTweenConfig {
  targets: unknown;
  alpha?: number;
  x?: number;
  y?: number;
  duration: number;
  onComplete?: () => void;
}

class FakeTweens {
  readonly configs: FakeTweenConfig[] = [];
  add(config: FakeTweenConfig): void {
    this.configs.push(config);
  }
  /** 跑完所有待定 tween 的 onComplete（退场销毁/补位的验证手段）。 */
  flush(): void {
    for (const c of this.configs.splice(0)) c.onComplete?.();
  }
}

class FakeClock {
  now = 0;
}

class FakeHost {
  readonly clock = new FakeClock();
  readonly tweens = new FakeTweens();
  readonly rects: FakePart[] = [];
  readonly graphics: FakeGraphics[] = [];
  readonly texts: FakeText[] = [];

  get time(): Phaser.Time.Clock {
    return this.clock as unknown as Phaser.Time.Clock;
  }

  add = {
    rectangle: (x: number, y: number): FakePart => {
      const r = new FakePart(x, y);
      this.rects.push(r);
      return r;
    },
    graphics: (): FakeGraphics => {
      const g = new FakeGraphics(0, 0);
      this.graphics.push(g);
      return g;
    },
    text: (x: number, y: number, str: string): FakeText => {
      const t = new FakeText(x, y, str);
      this.texts.push(t);
      return t;
    },
  } as unknown as Phaser.GameObjects.GameObjectFactory;

  /** 收窄成控制器的结构面（假件不实现 Phaser 单子的全体成员）。 */
  asHost(): AchievementHost {
    return this as unknown as AchievementHost;
  }
}

/** Map 假件 Storage（achievements.test.ts 同款路数）。 */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

/** 建控制器 + init（对位 create() 里读独立键那一步）。 */
function boot(day = 1): { c: AchievementController; host: FakeHost; storage: Storage } {
  const storage = memoryStorage();
  const host = new FakeHost();
  const c = new AchievementController(host.asHost(), storage);
  c.init(day);
  return { c, host, storage };
}

/** 仍活着的 toast 名牌（退场的在淡出 tween 的 onComplete 里销毁，flush 后不计）。 */
const toastNames = (host: FakeHost): FakeText[] =>
  host.texts.filter((t) => t.name === 'achievement-toast-name' && !t.destroyed);

// ── 用例 ───────────────────────────────────────────────────────────────────

describe('AG-77 AchievementController（RC-03 拆分第 5 步）', () => {
  it('emit：新解锁返回 id 列表、落独立键、排队等出票', () => {
    const { c, storage } = boot();
    const gained = c.emit({ type: 'floor_reached', floor: 110 });
    expect(gained).toEqual(['depth_10', 'depth_110']);
    // 落盘委托 AchievementSystem：独立键里就是新解锁（e2e getUnlocked 的同源读数）。
    expect(loadAchievements(storage).unlocked).toEqual(['depth_10', 'depth_110']);
    // 同一事件再发：已解锁不重发（幂等），也没有新排队。
    expect(c.emit({ type: 'floor_reached', floor: 110 })).toEqual([]);
  });

  it('emit：无解锁不返回、不落噪音（toast 队列只在真有解锁时长胖）', () => {
    const { c, host } = boot();
    expect(c.emit({ type: 'floor_reached', floor: 9 })).toEqual([]);
    // 时钟推到位也没有任何 toast 零件出生。
    host.clock.now = 5000;
    c.update();
    expect(toastNames(host)).toHaveLength(0);
  });

  it('toast 队列：550ms 节流依次出票，同屏最多 3 枚', () => {
    const { c, host } = boot();
    // 一次深跳 100000：六条深度里程碑全亮（Steam 路过即得）。
    expect(c.emit({ type: 'floor_reached', floor: 100000 })).toEqual([
      'depth_10',
      'depth_110',
      'depth_1010',
      'depth_10010',
      'depth_50010',
      'depth_100000',
    ]);
    host.clock.now = 1000;
    c.update();
    expect(toastNames(host)).toHaveLength(1);
    // 同一时刻再 update：节流未到期，不出第二枚。
    c.update();
    expect(toastNames(host)).toHaveLength(1);
    // 过 550ms：第二枚出。
    host.clock.now = 1550;
    c.update();
    expect(toastNames(host)).toHaveLength(2);
    host.clock.now = 2100;
    c.update();
    expect(toastNames(host)).toHaveLength(3);
    // 同屏已满 3 枚：即便节流到期也不出第四枚（剩下的排队）。取 3000——
    // 第 1 枚 4600 才到期，此刻三枚全在场，撞的是「满」不是「到期补位」。
    host.clock.now = 3000;
    c.update();
    expect(toastNames(host)).toHaveLength(3);
  });

  it('toast 名牌：文本是成就名、名字是 e2e 读的 achievement-toast-name', () => {
    const { c, host } = boot();
    c.emit({ type: 'floor_reached', floor: 10 });
    host.clock.now = 1000;
    c.update();
    const names = toastNames(host);
    expect(names).toHaveLength(1);
    expect(names[0].text).toBe('初露锋芒');
    // 底板同样具名（ag77 spec 的 toastPlates 读它）。
    expect(host.rects.filter((r) => r.name === 'achievement-toast')).toHaveLength(1);
  });

  it('toast 退场：到期整组销毁，队列补上一枚，剩下的补位一枚节距', () => {
    const { c, host } = boot();
    c.emit({ type: 'floor_reached', floor: 100000 });
    host.clock.now = 1000;
    c.update(); // 第 1 枚（until 4600）
    host.clock.now = 1550;
    c.update(); // 第 2 枚（until 5150）
    expect(toastNames(host)).toHaveLength(2);
    const first = toastNames(host)[0];
    // 第 1 枚到期（now ≥ 4600），第 2 枚未到期（5150）。
    host.clock.now = 4700;
    c.update();
    // 补位：剩下的那枚六件各被推一个节距（72px）的 y tween（先取证，
    // 下面的 flush 会把 tween 记录清空）。
    const reflow = host.tweens.configs.filter((t) => t.y !== undefined);
    expect(reflow).toHaveLength(6);
    for (const t of reflow) {
      const o = t.targets as FakePart;
      expect(t.y).toBe(o.y - 72); // 顶 184 → 112，差量落到每一件上
    }
    // 退场是淡出 tween 的 onComplete 里销毁——flush 后第 1 枚组全员死。
    host.tweens.flush();
    expect(first.destroyed).toBe(true);
    // 同一次 update 里队列补上一枚（原位第二枚 + 新补的第三枚都在场）。
    expect(toastNames(host)).toHaveLength(2);
  });

  it('clear：当场销毁在场 toast、清空队列与节流', () => {
    const { c, host } = boot();
    c.emit({ type: 'floor_reached', floor: 100000 });
    host.clock.now = 1000;
    c.update();
    expect(toastNames(host)).toHaveLength(1);
    const plate = host.rects.find((r) => r.name === 'achievement-toast')!;
    c.clear();
    expect(plate.destroyed).toBe(true);
    // 队列清了：剩余五枚不再出票（对位场景重启/SHUTDOWN 后的冷场）。
    host.clock.now = 9000;
    c.update();
    expect(toastNames(host)).toHaveLength(0);
    // 节流也重置了：新解锁在同一个早时刻也能立刻出票（不用等 550ms）。
    c.emit({ type: 'loot_taken', count: 3 });
    host.clock.now = 1000;
    c.update();
    expect(toastNames(host)).toHaveLength(1);
  });

  it('init：独立键读回奖杯柜（重置游戏不清空），记账随新局清零', () => {
    const storage = memoryStorage();
    // 上一轮的奖杯柜：depth_10 已解锁。
    saveAchievements(loadAchievements(storage), storage); // 空档也要可读
    saveAchievements(
      { unlocked: ['depth_10'], stats: { ...loadAchievements(storage).stats } },
      storage,
    );
    const host = new FakeHost();
    const c = new AchievementController(host.asHost(), storage);
    c.init(3); // 新跑局第 3 天
    // depth_10 已在柜里：再到 10 层不重发。
    expect(c.emit({ type: 'floor_reached', floor: 10 })).toEqual([]);
    // 但新深度照常亮。
    expect(c.emit({ type: 'floor_reached', floor: 110 })).toEqual(['depth_110']);
    // day 记账从入参起：同天不出事件，换天才结算。
    c.noteDay(3);
    c.noteDay(4); //  dehydrated=false → thirstStreak=1
    c.noteDay(5); // → 2
    c.noteDay(6); // → 3 → thirst_streak_3 亮
    expect(c.emit({ type: 'loot_taken', count: 3 })).toEqual(['loot_single_3']);
  });

  it('跨天对账：当天见底过就断签（dehydrated 接线）', () => {
    // 断签组：第 1 天口渴见底。
    const { c, storage } = boot(1);
    c.noteThirstZero();
    c.noteDay(2); // 结算第 1 天：dehydrated=true → streak 归零
    c.noteDay(3); // 连签 1
    c.noteDay(4); // 连签 2——不够 3 天
    expect(loadAchievements(storage).unlocked).not.toContain('thirst_streak_3');
    // 连签组：三天不见底。
    const { c: c2, storage: s2 } = boot(1);
    c2.noteDay(2);
    c2.noteDay(3);
    c2.noteDay(4); // 连签 3 → thirst_streak_3 在第三次对账里亮
    expect(loadAchievements(s2).unlocked).toContain('thirst_streak_3');
  });

  it('战斗受伤记账：清零/累加/读数（boss_won 判据接线）', () => {
    const { c } = boot();
    c.resetCombatDamage();
    expect(c.combatDamage).toBe(0);
    c.noteCombatDamage(3);
    c.noteCombatDamage(4);
    expect(c.combatDamage).toBe(7);
    // 掉过血的胜局不点亮。
    expect(c.emit({ type: 'boss_won', damageTaken: c.combatDamage })).toEqual([]);
    // 下一场零伤：reset 后不记账，直达判据。
    c.resetCombatDamage();
    expect(c.emit({ type: 'boss_won', damageTaken: c.combatDamage })).toEqual(['boss_no_damage']);
    // 已点亮后掉过血的胜局不改写（幂等）。
    expect(c.emit({ type: 'boss_won', damageTaken: 9 })).toEqual([]);
  });
});
