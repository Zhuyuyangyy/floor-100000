// AG-91 —— 战斗 juice 层（game-feel）：让「这一下打中了」在屏幕上看得见。
//
// 治的问题（用户 2026-11-17 原话：「把这个战斗做好了」）：命中只剩血条缩一格、
// 飘一个数字，打击感为零。调研提案 P1（2026-11-17 开源调研：gamedev-skills 的
// game-feel 技能 + m2-md 的 hitstop-juice 思路，许可证均已核验；本文件全部自行
// 实现，零新依赖）给出四件 juice：
//   1. 震屏（camera shake）——trauma² 模型；
//   2. 顿帧（hitstop）——命中瞬间冻结模拟 40-150ms；
//   3. 受击闪白 + squash & stretch（保体积 + 回弹）；
//   4. 伤害数字（复用 AG-80 的 FloatTextPool，本文件只产事件，不碰 Phaser）。
//
// 硬约束（与 feedback.ts 同款先例）：零 Phaser 依赖、纯逻辑、Node 单测直跑。
// 渲染层（GameScene）只消费这里的返回值/状态，调手感不改场景代码。
//
// 两条本项目硬规则的落实：
//   - 禁 Math.random：偏移采样走 seeded value noise（deriveSeed/makeRng，
//     docs/02_TECH_SPEC.md §3）。同 seed + 同时间 → 同偏移，回放可复现；
//   - 相机只写 offset、绝不动物体：震屏位移只进相机矩阵平移点（Phaser 的
//     shakeEffect.preRender，位于 follow 与 bounds 钳制之后，见 GameScene
//     updateJuice 的注释），碰撞/瞄准因此永不失步。
//
// trauma² 模型（Squirrel Eiserloh，GDC「Math for Game Programmers: Juicing
// Your Cameras with Shake」）：偏移幅度 = trauma²，trauma 本身线性衰减、
// 1/traumaDecayPerSecond 秒归零——平方项让震动「起手重、收尾轻」，观感就是
// 一次结实的打击而不是匀速抖动。

import { GAME_CONFIG } from '../core/config';
import { deriveSeed, makeRng } from '../core/rng';

// ── 配置读数（改平衡只动 config/game-balance.json 的 juice 块） ────────────
// 与 GameScene 读 movement/bag 块同款：core/config.ts 的校验只查必填键，
// 扩展块按 Record 读，缺字段回退默认值，旧配置文件照样能跑。

/** 打击分级。全游戏共用一个比例：small=普通命中 / medium=玩家受击 / large=击杀。 */
export type ImpactTier = 'small' | 'medium' | 'large';

/** 一个分级的完整配方（数值区间出自调研提案 P1 的分级表，见 balance 注释）。 */
export interface JuiceTierSpec {
  /** trauma 增量（0..1，加到当前值上并按 1 钳住）。偏移幅度 = trauma²。 */
  trauma: number;
  /** 顿帧时长（ms）。0 = 不顿帧。 */
  hitstopMs: number;
  /** 粒子预算（颗）。由既有 pixelfx  Atlas 一次性特效兑现（见文件末说明）。 */
  particles: number;
  /** 是否触发受击闪白（50-80ms 全屏白闪）。 */
  flash: boolean;
  /** 是否触发 squash & stretch（保体积 + 回弹）。 */
  scale: boolean;
  /** 伤害数字是否走 FloatTextPool 强调（large 的击杀数字）。 */
  damageNumber: boolean;
}

export interface JuiceBalance {
  /** 震屏强度旋钮 0..1（无障碍：防光敏/晕眩，默认 0.7）。AG-72 的 screenShake
   *  布尔开关是总闸：关时本作 0 计，hitstop/闪白/缩放不受影响（无位移刺激）。 */
  shakeStrength: number;
  /** trauma 线性衰减率（次/秒）。满 trauma 在 1/此值 秒内归零。 */
  traumaDecayPerSecond: number;
  /** trauma=1 时的最大偏移幅度（世界像素）。 */
  maxShakePx: number;
  /** value noise 的采样频率（Hz）：一格噪声的时长 = 1000/此值 ms。 */
  noiseHz: number;
  /** 受击闪白时长（ms，50-80）。 */
  flashMs: number;
  /** squash & stretch 总时长（ms）。 */
  scaleMs: number;
  /** squash 幅度（0..1，压缩最深时的 sy 缩减量；sx=1/sy 保体积）。 */
  scaleAmount: number;
  /** 确定性种子标签（与 runSeed 组合出本局的震屏噪声表）。 */
  seedTag: string;
  /** 三级配方。 */
  tiers: Record<ImpactTier, JuiceTierSpec>;
}

const JUICE_DEFAULTS: JuiceBalance = {
  shakeStrength: 0.7,
  traumaDecayPerSecond: 2,
  maxShakePx: 12,
  noiseHz: 20,
  flashMs: 70,
  scaleMs: 180,
  scaleAmount: 0.28,
  seedTag: 'juice-shake',
  tiers: {
    small: { trauma: 0.15, hitstopMs: 0, particles: 2, flash: false, scale: false, damageNumber: false },
    medium: { trauma: 0.4, hitstopMs: 50, particles: 8, flash: true, scale: false, damageNumber: false },
    large: { trauma: 1, hitstopMs: 120, particles: 28, flash: true, scale: true, damageNumber: true },
  },
};

/** 读 balance JSON 的 juice 块；缺字段回退默认（movement/bag 同款模式）。 */
export function readJuiceBalance(): JuiceBalance {
  const raw = (GAME_CONFIG as unknown as { juice?: Partial<JuiceBalance> }).juice ?? {};
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
  const tiers = { ...JUICE_DEFAULTS.tiers };
  for (const key of Object.keys(tiers) as ImpactTier[]) {
    const t = raw.tiers?.[key];
    if (!t) continue;
    tiers[key] = {
      trauma: num(t.trauma, JUICE_DEFAULTS.tiers[key].trauma),
      hitstopMs: num(t.hitstopMs, JUICE_DEFAULTS.tiers[key].hitstopMs),
      particles: num(t.particles, JUICE_DEFAULTS.tiers[key].particles),
      flash: bool(t.flash, JUICE_DEFAULTS.tiers[key].flash),
      scale: bool(t.scale, JUICE_DEFAULTS.tiers[key].scale),
      damageNumber: bool(t.damageNumber, JUICE_DEFAULTS.tiers[key].damageNumber),
    };
  }
  return {
    shakeStrength: Math.min(1, Math.max(0, num(raw.shakeStrength, JUICE_DEFAULTS.shakeStrength))),
    traumaDecayPerSecond: num(raw.traumaDecayPerSecond, JUICE_DEFAULTS.traumaDecayPerSecond),
    maxShakePx: num(raw.maxShakePx, JUICE_DEFAULTS.maxShakePx),
    noiseHz: num(raw.noiseHz, JUICE_DEFAULTS.noiseHz),
    flashMs: num(raw.flashMs, JUICE_DEFAULTS.flashMs),
    scaleMs: num(raw.scaleMs, JUICE_DEFAULTS.scaleMs),
    scaleAmount: num(raw.scaleAmount, JUICE_DEFAULTS.scaleAmount),
    seedTag: typeof raw.seedTag === 'string' ? raw.seedTag : JUICE_DEFAULTS.seedTag,
    tiers,
  };
}

/** 模块级单一读数：所有 JuiceState 默认共享（与 MOVEMENT_BALANCE 同款）。 */
export const JUICE_BALANCE: JuiceBalance = readJuiceBalance();

// ── 内部工具 ───────────────────────────────────────────────────────────────

/** smootherstep：value noise 的插值核，一阶/二阶导均为 0，无可见折角。 */
function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// 单帧 delta 钳制：切后台再回来时 Phaser 的 delta 可能是几秒，不钳会把一次
// 性的 spike 当成「 trauma 瞬间归零、hitstop 瞬间结束」——观感是抖动被吞。
// 250ms 以上的间隔按 250ms 计，余量丢帧（帧时间本身已经丢了）。
const MAX_STEP_MS = 250;

// ── JuiceState ─────────────────────────────────────────────────────────────

export interface JuiceStateOptions {
  /** 平衡读数。默认 JUICE_BALANCE（balance JSON）。 */
  balance?: JuiceBalance;
  /** 震屏强度 0..1（无障碍旋钮的当前位置；0 = 偏移恒 0）。 */
  strength?: number;
  /** 噪声表种子（GameScene 传 deriveSeed(runSeed, seedTag)：同局同噪）。 */
  seed?: number;
}

/** impact() 的返回值：渲染层照单下药（位置 + 本档位要演的视觉清单）。 */
export interface ImpactFeedback {
  tier: ImpactTier;
  /** 事件世界坐标（调用方传入，原样带回，供特效/飘字定位）。 */
  x: number;
  y: number;
  /** 本档位实际生效的 trauma（钳后的当前值）。 */
  trauma: number;
  /** 本档位的顿帧时长（ms；0 = 未请求）。 */
  hitstopMs: number;
  /** 是否点燃受击闪白。 */
  flash: boolean;
  /** 是否启动 squash & stretch。 */
  scale: boolean;
  /** 伤害数字是否走 FloatTextPool 强调。 */
  damageNumber: boolean;
  /** 粒子预算（颗）。 */
  particles: number;
}

/** 相机 offset（世界像素）。trauma 或强度为 0 时恒 {0,0}。 */
export interface CameraOffset {
  x: number;
  y: number;
}

/** squash & stretch 采样（保体积：sx = 1/sy）。静止时 {1,1}。 */
export interface ScalePulse {
  sx: number;
  sy: number;
}

/**
 * 战斗 juice 状态机：trauma² 震屏 + hitstop + 闪白/缩放计时器。
 *
 * 时间基准全部是**真实时间**：update(deltaMs) 的 delta 由调用方给真实帧间隔，
 * hitstop 期间状态照常衰减（spec：顿帧只冻模拟，UI/震屏衰减走真实时间）。
 * 内部不读任何时钟——确定性测试因此不需要假时钟。
 */
export class JuiceState {
  private readonly balance: JuiceBalance;
  private strength: number;
  /** 真实流逝（ms）：value noise 的采样轴。 */
  private elapsedMs = 0;
  /** 当前 trauma（0..1）。偏移幅度 = trauma²。 */
  private traumaValue = 0;
  /** hitstop 剩余（ms）。>0 即冻结模拟。 */
  private hitstopLeft = 0;
  /** 受击闪白剩余（ms）。 */
  private flashLeft = 0;
  /** squash & stretch 剩余（ms）。 */
  private scaleLeft = 0;
  /** 两个轴向的噪声表（257 项，末项=首项，循环连续）。 */
  private readonly noiseX: Float64Array;
  private readonly noiseY: Float64Array;

  constructor(opts: JuiceStateOptions = {}) {
    this.balance = opts.balance ?? JUICE_BALANCE;
    this.strength = clamp01(opts.strength ?? this.balance.shakeStrength);
    const seed = opts.seed ?? 0;
    this.noiseX = buildNoiseTable(deriveSeed(seed, 'x'));
    this.noiseY = buildNoiseTable(deriveSeed(seed, 'y'));
  }

  // ── 事件入口 ──────────────────────────────────────────────────────────

  /**
   * 分级打击入口：每个战斗事件一个调用，全游戏共用一套比例。
   * 同步更新状态机并返回本帧要演的视觉清单；渲染层（GameScene）照返回值下药。
   */
  impact(tier: ImpactTier, x: number, y: number): ImpactFeedback {
    const spec = this.balance.tiers[tier];
    this.addTrauma(spec.trauma);
    if (spec.hitstopMs > 0) this.requestHitstop(spec.hitstopMs);
    if (spec.flash) this.flashLeft = this.balance.flashMs;
    if (spec.scale) this.scaleLeft = this.balance.scaleMs;
    return {
      tier,
      x,
      y,
      trauma: this.traumaValue,
      hitstopMs: spec.hitstopMs,
      flash: spec.flash,
      scale: spec.scale,
      damageNumber: spec.damageNumber,
      particles: spec.particles,
    };
  }

  /** 累加 trauma（按 1 钳住）：重击叠加只会更猛，不会过冲。 */
  addTrauma(amount: number): void {
    if (!(amount > 0)) return;
    this.traumaValue = Math.min(1, this.traumaValue + amount);
  }

  /**
   * 请求顿帧。**重叠只取最长**：新顿帧不会被旧的提前结束（max），旧的也不会
   * 被新的截短（同样 max）——连击时顿帧是「最长那一下」的时值，取和会让
   * 战斗卡顿，取新会让重击被轻击抹掉。
   */
  requestHitstop(ms: number): void {
    if (!(ms > 0)) return;
    this.hitstopLeft = Math.max(this.hitstopLeft, ms);
  }

  // ── 每帧 tick（真实时间） ─────────────────────────────────────────────

  /** 按真实帧间隔推进。hitstop 期间同样调用（震屏/闪白/缩放在顿帧中不冻）。 */
  update(deltaMs: number): void {
    const dt = Math.min(Math.max(deltaMs, 0), MAX_STEP_MS);
    this.elapsedMs += dt;
    const sec = dt / 1000;
    this.traumaValue = Math.max(0, this.traumaValue - this.balance.traumaDecayPerSecond * sec);
    this.hitstopLeft = Math.max(0, this.hitstopLeft - dt);
    this.flashLeft = Math.max(0, this.flashLeft - dt);
    this.scaleLeft = Math.max(0, this.scaleLeft - dt);
  }

  // ── 读数 ──────────────────────────────────────────────────────────────

  get trauma(): number {
    return this.traumaValue;
  }

  /** hitstop 剩余（ms）。 */
  get hitstopRemainingMs(): number {
    return this.hitstopLeft;
  }

  /** 是否处于顿帧（冻结模拟）。 */
  isFrozen(): boolean {
    return this.hitstopLeft > 0;
  }

  /** 模拟时间倍率：顿帧中 0，否则 1。契约：恢复后最终回到 1.0。 */
  get timeScale(): number {
    return this.isFrozen() ? 0 : 1;
  }

  get flashRemainingMs(): number {
    return this.flashLeft;
  }

  get scaleRemainingMs(): number {
    return this.scaleLeft;
  }

  /** 当前震屏强度（0..1）。 */
  get shakeStrength(): number {
    return this.strength;
  }

  set shakeStrength(value: number) {
    this.strength = clamp01(value);
  }

  /** 归零全部状态（场景重启/测试 reset）。不清噪声表与种子。 */
  reset(): void {
    this.elapsedMs = 0;
    this.traumaValue = 0;
    this.hitstopLeft = 0;
    this.flashLeft = 0;
    this.scaleLeft = 0;
  }

  /**
   * 当前相机 offset（世界像素）：幅度 = maxShakePx × strength × trauma²，
   * 方向/大小由 seeded value noise 在 elapsedMs 上采样得出（无随机）。
   * trauma 或 strength 为 0 时恒 {0,0}（衰减终点与无障碍开关都走这条）。
   */
  cameraOffset(): CameraOffset {
    if (this.traumaValue <= 0 || this.strength <= 0) return { x: 0, y: 0 };
    const amp = this.balance.maxShakePx * this.strength * this.traumaValue * this.traumaValue;
    return {
      x: sampleNoise(this.noiseX, this.elapsedMs, this.balance.noiseHz) * amp,
      y: sampleNoise(this.noiseY, this.elapsedMs, this.balance.noiseHz) * amp,
    };
  }

  /**
   * 当前 squash & stretch（保体积）。阻尼正弦实现 easeOutBack 式回弹：
   * 起手压缩（sy<1, sx>1）→ 中点回弹过冲（sy>1, sx<1）→ 精确归 1。
   * scaleLeft<=0 时 {1,1}（不缩放）。
   */
  scalePulse(): ScalePulse {
    if (this.scaleLeft <= 0 || this.balance.scaleMs <= 0) return { sx: 1, sy: 1 };
    const t = clamp01(1 - this.scaleLeft / this.balance.scaleMs);
    // (1-t)² 阻尼：末点恰好 0，回弹只可见一次、不振荡。
    const wave = Math.sin(Math.PI * 2 * t + Math.PI) * (1 - t) * (1 - t);
    const sy = 1 + this.balance.scaleAmount * wave;
    return { sx: 1 / sy, sy };
  }
}

// ── seeded value noise ─────────────────────────────────────────────────────

/**
 * 建一张 257 项的 [-1,1] 噪声表（末项复制首项，循环采样时表首表尾连续，
 * 不会在 wrap 处跳变）。表由 makeRng(seed) 填——xorshift32 走 core/rng，
 * 禁 Math.random，同 seed 同表。
 */
function buildNoiseTable(seed: number): Float64Array {
  const rng = makeRng(seed);
  const table = new Float64Array(257);
  for (let i = 0; i < 256; i++) table[i] = rng.nextFloat() * 2 - 1;
  table[256] = table[0];
  return table;
}

/** 在 elapsedMs 上采样：cell = elapsedMs/1000 × noiseHz，smootherstep 插值。 */
function sampleNoise(table: Float64Array, elapsedMs: number, noiseHz: number): number {
  const pos = (elapsedMs / 1000) * noiseHz;
  const i = Math.floor(pos);
  const f = smootherstep(pos - i);
  return table[i & 255] * (1 - f) + table[(i + 1) & 255] * f;
}

// ── 粒子预算的兑现方式（设计说明，非代码路径） ────────────────────────────
// tiers[].particles 是设计预算：small 2 颗 / medium 8 颗 / large 28 颗。兑现
// 不走「一个粒子一个 sprite」——AG-80 的 FxShotPool 每个特效 id 只放 4 个
// （四颗火花已经读作一次爆炸，第五颗 recycle），逐颗粒 spawn 会让预算变成
// 谎言。实际由既有 pixelfx Atlas 一次性特效按档位兑现：small=hit-spark、
// medium=hit-flash、large=crit-hit（击杀时已有 scale 1.4 的大开花）——
// 每张 sheet 本身就是多火花爆发，档位越高sheet越大，比例关系保持。
// 数值仍进 config：换 sheet 或调预算只改 JSON。
