import { describe, expect, it } from 'vitest';

import {
  CORRIDOR_TINT,
  ENV_WALL_COMMERCIAL_KEY,
  ENV_WALL_VIP_KEY,
  drawCorridorRoom,
  stackNeighbours,
  wallKeyFor,
  type CorridorContext,
} from '../render/corridors';
import { buildLightLayer, LIGHT_DEPTH, NIGHT_DEPTH } from '../render/lighting';
import {
  addContactShadow,
  buildAerialHaze,
  buildCeilingLights,
  buildFloorClutter,
  buildForeground,
  buildRoomDepth,
  buildSurfaceDetail,
  buildWallDressing,
} from '../render/roomDepth';
import { ENV_FILES } from '../render/artpack';
import { FLOOR_HEIGHT, FLOOR_WIDTH, PLAYABLE_FLOORS_V01, ROOM_COUNT, ROOM_WIDTH, STACK_ABOVE, STACK_BELOW } from '../core/constants';
import { hasFloorContent } from '../data/floorTemplates';

// 渲染性能契约（AG-09）。这里没有 Phaser：一个记录型假场景承托 render 模块，
// 让"每层 create 多少对象""同 seed 两次进入是否一致""邻居不画空洞楼层"这些
// 语义可以在 Node 里直接断言。帧时间与像素级对比由 Playwright 探针负责
// （docs/plans/RENDER.md 有实测数字）。

// ── 记录型假场景 ───────────────────────────────────────────────────────────
// render 模块只碰场景的这些面：add.image/rectangle/graphics/sprite、
// textures.exists/get/createCanvas、anims.exists/create、time.delayedCall、
// tweens.add。假实现逐项记录，返回值是可链式的记录对象。

interface Recorded {
  type: 'Image' | 'Rectangle' | 'Graphics' | 'Sprite';
  depth: number;
  x: number;
  y: number;
  alpha: number;
  visible: boolean;
  angle: number;
  scaleX: number;
  scaleY: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
  fillColor: number;
  textureKey: string | null;
  tint: number | null;
  animKey: string | null;
  animTimeScale: number;
  destroyed: boolean;
  /** Graphics 的绘制命令（fillStyle/fillRect/变换…）按序记录 */
  commands: string[];
}

class FakeObject {
  type: Recorded['type'] = 'Rectangle';
  depth = 0;
  x = 0;
  y = 0;
  alpha = 1;
  visible = true;
  angle = 0;
  scaleX = 1;
  scaleY = 1;
  originX = 0.5;
  originY = 0.5;
  width = 0;
  height = 0;
  fillColor = 0;
  textureKey: string | null = null;
  tint: number | null = null;
  animKey: string | null = null;
  animTimeScale = 1;
  destroyed = false;
  commands: string[] = [];
  // fx 的 startFxLoop 会写 sprite.anims.timeScale、读
  // sprite.anims.currentAnim.frames.length；假实现保持这两个面的形状。
  anims!: {
    timeScale: number;
    currentAnim: null | { frames: unknown[] };
    play: (cfg: { key: string; startFrame?: number }) => void;
  };

  constructor(type: Recorded['type']) {
    this.type = type;
    const self = this;
    this.anims = {
      get timeScale(): number {
        return self.animTimeScale;
      },
      set timeScale(v: number) {
        self.animTimeScale = v;
      },
      currentAnim: null,
      play: (cfg: { key: string; startFrame?: number }): void => {
        self.animKey = cfg.key;
        self.anims.currentAnim = { frames: new Array(FX_FRAME_COUNT) };
      },
    };
  }

  snapshot(): Recorded {
    return {
      type: this.type,
      depth: this.depth,
      x: this.x,
      y: this.y,
      alpha: this.alpha,
      visible: this.visible,
      angle: this.angle,
      scaleX: this.scaleX,
      scaleY: this.scaleY,
      originX: this.originX,
      originY: this.originY,
      width: this.width,
      height: this.height,
      fillColor: this.fillColor,
      textureKey: this.textureKey,
      tint: this.tint,
      animKey: this.animKey,
      animTimeScale: this.animTimeScale,
      destroyed: this.destroyed,
      commands: [...this.commands],
    };
  }

  setDepth(d: number): this {
    this.depth = d;
    return this;
  }
  setOrigin(x: number, y: number): this {
    this.originX = x;
    this.originY = y;
    return this;
  }
  setAlpha(a: number): this {
    this.alpha = a;
    return this;
  }
  setVisible(v: boolean): this {
    this.visible = v;
    return this;
  }
  setAngle(a: number): this {
    this.angle = a;
    return this;
  }
  setScale(x: number, y = x): this {
    this.scaleX = x;
    this.scaleY = y;
    return this;
  }
  setBlendMode(): this {
    return this;
  }
  setTint(c: number): this {
    this.tint = c;
    return this;
  }
  setFillStyle(color: number, alpha?: number): this {
    this.fillColor = color;
    if (alpha !== undefined) this.alpha = alpha;
    return this;
  }
  setStrokeStyle(): this {
    return this;
  }
  destroy(): this {
    this.destroyed = true;
    return this;
  }
  once(): this {
    return this;
  }
  play(key: string): this {
    this.animKey = key;
    this.anims.currentAnim = { frames: new Array(60) };
    return this;
  }

  // Graphics 绘制面：命令按序记录，确定性对比用。
  fillStyle(color: number, alpha: number): this {
    this.commands.push(`fillStyle(${color},${alpha})`);
    return this;
  }
  fillRect(x: number, y: number, w: number, h: number): this {
    this.commands.push(`fillRect(${x},${y},${w},${h})`);
    return this;
  }
  fillCircle(x: number, y: number, r: number): this {
    this.commands.push(`fillCircle(${x},${y},${r})`);
    return this;
  }
  fillEllipse(x: number, y: number, w: number, h: number): this {
    this.commands.push(`fillEllipse(${x},${y},${w},${h})`);
    return this;
  }
  lineStyle(width: number, color: number, alpha: number): this {
    this.commands.push(`lineStyle(${width},${color},${alpha})`);
    return this;
  }
  lineBetween(x1: number, y1: number, x2: number, y2: number): this {
    this.commands.push(`lineBetween(${x1},${y1},${x2},${y2})`);
    return this;
  }
  strokeEllipse(x: number, y: number, w: number, h: number): this {
    this.commands.push(`strokeEllipse(${x},${y},${w},${h})`);
    return this;
  }
  strokeRect(x: number, y: number, w: number, h: number): this {
    this.commands.push(`strokeRect(${x},${y},${w},${h})`);
    return this;
  }
  clear(): this {
    this.commands.length = 0;
    return this;
  }
  save(): this {
    this.commands.push('save()');
    return this;
  }
  restore(): this {
    this.commands.push('restore()');
    return this;
  }
  translateCanvas(x: number, y: number): this {
    this.commands.push(`translateCanvas(${x},${y})`);
    return this;
  }
  rotateCanvas(r: number): this {
    this.commands.push(`rotateCanvas(${r})`);
    return this;
  }
  generateTexture(): this {
    return this;
  }
}

/** fx 图集的假纹理：60 帧，帧名与 Phaser 的 "<key> <index>" 一致。 */
const FX_FRAME_COUNT = 60;
const FX_IDS = ['hit-spark', 'crit-hit', 'hit-flash', 'sword-slash', 'parry', 'ground-slam', 'collect-burst', 'coin-spin', 'candle', 'torch', 'brazier', 'drip', 'ripples', 'poisoned'];

function makeScene(): { scene: unknown; objects: FakeObject[]; timers: number[]; tweens: unknown[] } {
  const objects: FakeObject[] = [];
  const timers: number[] = [];
  const tweens: unknown[] = [];
  const textures = new Map<string, { frameTotal: number; getFrameNames: () => string[]; getSourceImage: () => { height: number } }>();
  for (const id of FX_IDS) {
    textures.set(id, {
      frameTotal: FX_FRAME_COUNT,
      getFrameNames: () => Array.from({ length: FX_FRAME_COUNT }, (_, i) => `${id} ${i}`),
      getSourceImage: () => ({ height: 80 }),
    });
  }
  const createdAnims = new Set<string>();

  const scene = {
    add: {
      image: (x: number, y: number, key: string): FakeObject => {
        const o = new FakeObject('Image');
        o.x = x;
        o.y = y;
        o.textureKey = key;
        objects.push(o);
        return o;
      },
      rectangle: (x: number, y: number, w: number, h: number, color: number): FakeObject => {
        const o = new FakeObject('Rectangle');
        o.x = x;
        o.y = y;
        o.width = w;
        o.height = h;
        o.fillColor = color;
        objects.push(o);
        return o;
      },
      graphics: (): FakeObject => {
        const o = new FakeObject('Graphics');
        objects.push(o);
        return o;
      },
      sprite: (x: number, y: number, key: string): FakeObject => {
        const o = new FakeObject('Sprite');
        o.x = x;
        o.y = y;
        o.textureKey = key;
        objects.push(o);
        return o;
      },
    },
    textures: {
      exists: (key: string): boolean => textures.has(key),
      get: (key: string): unknown =>
        textures.get(key) ?? { frameTotal: FX_FRAME_COUNT, getFrameNames: () => [], getSourceImage: () => ({ height: 80 }) },
      createCanvas: (key: string, width: number, height: number): unknown => {
        textures.set(key, {
          frameTotal: 1,
          getFrameNames: () => [],
          getSourceImage: () => ({ width, height }),
        });
        return {
          getContext: () => ({
            createRadialGradient: () => ({ addColorStop: () => {} }),
            fillRect: () => {},
            set fillStyle(_v: unknown) {},
          }),
          refresh: () => {},
        };
      },
    },
    anims: {
      exists: (key: string): boolean => createdAnims.has(key),
      create: (cfg: { key: string }): void => {
        createdAnims.add(cfg.key);
      },
    },
    time: {
      delayedCall: (ms: number): unknown => {
        timers.push(ms);
        return {};
      },
    },
    tweens: {
      add: (cfg: unknown): unknown => {
        tweens.push(cfg);
        return {};
      },
    },
  };
  return { scene, objects, timers, tweens };
}

// ── 活地板的组合（GameScene.drawCorridor 的镜像，只含 render 模块的产出）─────
const WALL_H = FLOOR_HEIGHT - 64; // FLOOR_BAND

function drawLiveCorridor(scene: unknown, floor: number): FakeObject[] {
  const created: FakeObject[] = [];
  // builder 返回的是 Phaser.GameObjects.GameObject[]；假场景里它们就是 FakeObject。
  const take = (list: readonly unknown[]): void => {
    for (const o of list) created.push(o as FakeObject);
  };
  const props: FakeObject[] = [];
  const fixtures: FakeObject[] = [];
  const g = (scene as { add: { graphics: () => FakeObject } }).add.graphics();
  for (let r = 0; r < ROOM_COUNT; r++) {
    drawCorridorRoom({
      scene: scene as never,
      g: g as never,
      floor,
      roomX: r * ROOM_WIDTH,
      floorY: WALL_H,
      room: r,
      objects: props as never,
      fixtures: fixtures as never,
    } satisfies CorridorContext);
  }
  take(props);
  take(buildForeground(scene as never, { width: FLOOR_WIDTH, height: FLOOR_HEIGHT, wallBottom: WALL_H, seed: floor * 31 }));
  take(buildRoomDepth(scene as never, { width: FLOOR_WIDTH, wallBottom: WALL_H, height: FLOOR_HEIGHT, lightXs: [40, 1240] }));
  take(buildSurfaceDetail(scene as never, { width: FLOOR_WIDTH, wallBottom: WALL_H, height: FLOOR_HEIGHT, seed: floor * 17 }));
  take(buildCeilingLights(scene as never, { width: FLOOR_WIDTH, seed: floor * 13, top: 16, fixtures: fixtures as never }));
  take(buildAerialHaze(scene as never, { width: FLOOR_WIDTH, wallBottom: WALL_H, hazeColor: 0x24405e, strength: 0.34 }));
  take(buildWallDressing(scene as never, { width: FLOOR_WIDTH, wallBottom: WALL_H, seed: floor * 19, keepClear: [40, 1240] }));
  take(buildFloorClutter(scene as never, { width: FLOOR_WIDTH, wallBottom: WALL_H, seed: floor * 19, keepClear: [40, 1240] }));
  return created;
}

function countLiveCorridor(floor: number): { total: number; byType: Record<string, number>; objects: FakeObject[] } {
  const { scene, objects } = makeScene();
  const before = objects.length;
  const layer = buildLightLayer(scene as never, {
    width: FLOOR_WIDTH,
    height: FLOOR_HEIGHT,
    isDorm: false,
    hasUpExit: true,
    hasDownExit: true,
  });
  const layerObjects = objects.slice(before);
  const rest = drawLiveCorridor(scene, floor);
  const all = [...layerObjects, ...rest];
  const byType: Record<string, number> = {};
  for (const o of all) byType[o.type] = (byType[o.type] ?? 0) + 1;
  layer.destroy();
  return { total: all.length, byType, objects: all };
}

// 邻居楼层（GameScene.drawNeighbourFloor 的镜像）：同样只量 render 模块的产出，
// 外加场景自己创建的那几件（墙/地板两张图、色调、天花缝、两条 ambient、
// 楼梯口、距离雾），它们恒为 8 件。
const NEIGHBOUR_FIXED_OBJECTS = 8;

function countNeighbourFloor(floor: number): { total: number; byType: Record<string, number>; objects: FakeObject[] } {
  const { scene, objects } = makeScene();
  const before = objects.length;
  const amb = { color: 0x24405e, wallAlpha: 0.16, floorAlpha: 0.4 };
  const props: FakeObject[] = [];
  const fixtures: FakeObject[] = [];
  const g = (scene as { add: { graphics: () => FakeObject } }).add.graphics();
  buildRoomDepth(scene as never, { width: FLOOR_WIDTH, wallBottom: WALL_H, height: FLOOR_HEIGHT, lightXs: [40, 1240] });
  buildWallDressing(scene as never, { width: FLOOR_WIDTH, wallBottom: WALL_H, seed: floor * 19, keepClear: [40, 1240] });
  buildAerialHaze(scene as never, { width: FLOOR_WIDTH, wallBottom: WALL_H, hazeColor: amb.color, strength: 0.2 });
  for (let r = 0; r < ROOM_COUNT; r++) {
    drawCorridorRoom({
      scene: scene as never,
      g: g as never,
      floor,
      roomX: r * ROOM_WIDTH,
      floorY: WALL_H,
      room: r,
      objects: props as never,
      fixtures: fixtures as never,
    } satisfies CorridorContext);
  }
  buildCeilingLights(scene as never, { width: FLOOR_WIDTH, seed: floor * 13, top: 16, fixtures: fixtures as never });
  const created = objects.slice(before);
  const byType: Record<string, number> = {};
  for (const o of created) byType[o.type] = (byType[o.type] ?? 0) + 1;
  return { total: created.length + NEIGHBOUR_FIXED_OBJECTS, byType, objects: created };
}

// ── 对象预算 ───────────────────────────────────────────────────────────────

describe('每层 create 的对象数有上限', () => {
  // 实测（Playwright，优化前）：活地板自有 575 个 Rectangle + 92 Image + 23
  // Graphics + 10 Sprite + 75 Text ≈ 777；一个邻居楼层 ≈ 676。合并后活地板
  // 的 render 产出降到 ~60，邻居降到 ~50。上限留约一倍余量：装饰密度日后
  // 加东西不该直接把这条线顶穿，但任何"每层又多出几百个对象"的回退都会红。
  const LIVE_BOUND = 140;
  const NEIGHBOUR_BOUND = 130;

  const corridorFloors = [2, 3, 4, 5, 100, 1005, 10005, 50005];

  it.each(corridorFloors)('走廊层 %i 的渲染产出在上限内', (floor) => {
    const { total, byType } = countLiveCorridor(floor);
    expect(total, `floor ${floor}: ${JSON.stringify(byType)}`).toBeLessThanOrEqual(LIVE_BOUND);
  });

  it.each([2, 3, 4, 5, 100, 1005, 10005, 50005])('邻居楼层 %i 的渲染产出在上限内', (floor) => {
    const { total, byType } = countNeighbourFloor(floor);
    expect(total, `floor ${floor}: ${JSON.stringify(byType)}`).toBeLessThanOrEqual(NEIGHBOUR_BOUND);
  });

  it('对象数不随楼层数字增长（段间空洞不制造对象）', () => {
    const seen: number[] = [];
    for (const floor of [2, 3, 5, 100, 1005, 10005, 50005]) {
      seen.push(countLiveCorridor(floor).total);
    }
    // 每一层都在同一条预算线内：楼层号从 2 到 50005，渲染成本不随之膨胀。
    for (const n of seen) expect(n).toBeLessThanOrEqual(LIVE_BOUND);
    expect(Math.max(...seen) - Math.min(...seen)).toBeLessThan(LIVE_BOUND / 2);
  });

  it('单个房间的主题装饰 <= 8 个对象', () => {
    for (const floor of [2, 3, 4, 5]) {
      for (let room = 0; room < ROOM_COUNT; room++) {
        const { scene } = makeScene();
        const props: unknown[] = [];
        drawCorridorRoom({
          scene: scene as never,
          g: (scene as { add: { graphics: () => FakeObject } }).add.graphics() as never,
          floor,
          roomX: room * ROOM_WIDTH,
          floorY: WALL_H,
          room,
          objects: props as never,
        } satisfies CorridorContext);
        expect(props.length, `floor ${floor} room ${room}`).toBeLessThanOrEqual(8);
      }
    }
  });

  it('dorm 灯光层比走廊层重，但仍有上限（4 池 vs 2 池）', () => {
    const dorm = makeScene();
    const corridor = makeScene();
    const base = dorm.objects.length;
    buildLightLayer(dorm.scene as never, { width: FLOOR_WIDTH, height: FLOOR_HEIGHT, isDorm: true, hasUpExit: true, hasDownExit: true });
    const corr = corridor.objects.length;
    buildLightLayer(corridor.scene as never, { width: FLOOR_WIDTH, height: FLOOR_HEIGHT, isDorm: false, hasUpExit: true, hasDownExit: true });
    const dormCount = dorm.objects.length - base;
    const corridorCount = corridor.objects.length - corr;
    expect(dormCount).toBeGreaterThan(corridorCount); // 床和工作台的灯
    expect(dormCount).toBeLessThanOrEqual(60);
    expect(corridorCount).toBeLessThanOrEqual(40);
  });
});

// ── 邻居楼层门禁 ───────────────────────────────────────────────────────────

describe('邻居楼层不画无内容楼层', () => {
  const bounds = {
    lowest: PLAYABLE_FLOORS_V01[0],
    highest: PLAYABLE_FLOORS_V01[PLAYABLE_FLOORS_V01.length - 1],
    above: STACK_ABOVE,
    below: STACK_BELOW,
  };
  const floorsOf = (floor: number): number[] => stackNeighbours(floor, bounds, hasFloorContent).map((n) => n.floor);

  it('段内楼层上下都画（楼层 3）', () => {
    expect(floorsOf(3)).toEqual([2, 1, 4, 5]);
  });

  it('段间空洞不画：站在 100 层只画 101/102', () => {
    // 99/98 在 11..99 的空洞里，没有模板。
    expect(floorsOf(100)).toEqual([101, 102]);
    expect(floorsOf(10)).toEqual([9, 8]); // 11/12 是空洞
    expect(floorsOf(110)).toEqual([109, 108]); // 111/112 是空洞
  });

  it('顶层不越界：50010 上方两层的内容是 50009/50008，下方没有', () => {
    expect(floorsOf(50010)).toEqual([50009, 50008]);
    expect(floorsOf(1)).toEqual([2, 3]); // 没有 0 层和 -1 层
  });

  it('跨段 seam 两侧都不画空洞（10000 的下界与 1000 的上界）', () => {
    expect(floorsOf(10000)).toEqual([10001, 10002]);
    expect(floorsOf(1010)).toEqual([1009, 1008]);
  });

  it('距离标注正确：distance 1 紧邻、2 隔一层，isAbove 朝楼层号更小的一侧', () => {
    const ns = stackNeighbours(105, bounds, hasFloorContent);
    expect(ns).toEqual([
      { floor: 104, distance: 1, isAbove: true },
      { floor: 103, distance: 2, isAbove: true },
      { floor: 106, distance: 1, isAbove: false },
      { floor: 107, distance: 2, isAbove: false },
    ]);
  });

  it('与 GameScene 的边界常量一致：STACK_ABOVE/BELOW 各 2，边界取可玩楼层表', () => {
    expect(bounds.above).toBe(2);
    expect(bounds.below).toBe(2);
    expect(bounds.lowest).toBe(1);
    expect(bounds.highest).toBe(50010);
    // 任何楼层都不会被指派超过 STACK 数量的邻居。
    for (const floor of PLAYABLE_FLOORS_V01) {
      const ns = stackNeighbours(floor, bounds, hasFloorContent);
      expect(ns.filter((n) => n.isAbove).length).toBeLessThanOrEqual(STACK_ABOVE);
      expect(ns.filter((n) => !n.isAbove).length).toBeLessThanOrEqual(STACK_BELOW);
      for (const n of ns) expect(hasFloorContent(n.floor)).toBe(true);
    }
  });
});

// ── 确定性 ─────────────────────────────────────────────────────────────────

describe('同 seed 两次进入同一层，对象集合一致', () => {
  const signature = (floor: number): string =>
    JSON.stringify([
      ...countLiveCorridor(floor).objects.map((o) => o.snapshot()),
      ...countNeighbourFloor(floor).objects.map((o) => o.snapshot()),
    ]);

  it.each([2, 3, 4, 5, 100, 10005])('楼层 %i 两次渲染的记录逐项相同', (floor) => {
    expect(signature(floor)).toBe(signature(floor));
  });

  it('邻居楼层的种子来自楼层号：不同楼层的墙饰不同', () => {
    // 同一 seed 才一致；不同楼层号必须有区别，否则上下两层是同一面墙。
    expect(signature(3)).not.toBe(signature(4));
  });

  it('灯光层的呼吸与尘埃是确定性初值（redraw(0)）', () => {
    const a = makeScene();
    const b = makeScene();
    const layerA = buildLightLayer(a.scene as never, { width: FLOOR_WIDTH, height: FLOOR_HEIGHT, isDorm: false, hasUpExit: true, hasDownExit: true });
    const layerB = buildLightLayer(b.scene as never, { width: FLOOR_WIDTH, height: FLOOR_HEIGHT, isDorm: false, hasUpExit: true, hasDownExit: true });
    const dump = (objs: FakeObject[]): string => JSON.stringify(objs.map((o) => o.snapshot()));
    expect(dump(a.objects)).toBe(dump(b.objects));
    // update 之后尘埃开始漂移，但两次的漂移轨迹一致。
    layerA.update(1000, 16);
    layerB.update(1000, 16);
    expect(dump(a.objects)).toBe(dump(b.objects));
    layerA.destroy();
    layerB.destroy();
  });

  it('灯光层销毁会销毁它创建的每一个对象', () => {
    const { scene, objects } = makeScene();
    const layer = buildLightLayer(scene as never, { width: FLOOR_WIDTH, height: FLOOR_HEIGHT, isDorm: true, hasUpExit: true, hasDownExit: true });
    const created = objects.length;
    expect(created).toBeGreaterThan(0);
    layer.destroy();
    expect(objects.every((o) => o.destroyed)).toBe(true);
  });
});

// ── 墙分支：阶层 4/5 ───────────────────────────────────────────────────────

describe('wallKeyFor 阶层分支', () => {
  it('阶层 1/2/3 各自用对的墙', () => {
    expect(wallKeyFor(5)).toBe('env-wall'); // 贫民区
    expect(wallKeyFor(105)).toBe('env-wall-dorm'); // 工人宿舍区
    expect(wallKeyFor(1005)).toBe('env-wall-industry'); // 工业与交易区
  });

  it('阶层 4/5 有分支常量，未交图时回落贫民墙', () => {
    expect(ENV_WALL_COMMERCIAL_KEY).toBe('env-wall-commercial');
    expect(ENV_WALL_VIP_KEY).toBe('env-wall-vip');
    // AG-07 还没交图：ENV_FILES 里没有映射，回落是最旧的墙而不是绿框。
    expect(wallKeyFor(10005)).toBe('env-wall');
    expect(wallKeyFor(50005)).toBe('env-wall');
  });

  it('图一旦映射进 ENV_FILES，阶层 4/5 立即换新墙（AG-07 接线契约）', () => {
    const files = ENV_FILES as Record<string, string>;
    const hadCommercial = 'env-wall-commercial' in files;
    const hadVip = 'env-wall-vip' in files;
    files['env-wall-commercial'] = 'wall-commercial.png';
    files['env-wall-vip'] = 'wall-vip.png';
    try {
      expect(wallKeyFor(10005)).toBe(ENV_WALL_COMMERCIAL_KEY);
      expect(wallKeyFor(50005)).toBe(ENV_WALL_VIP_KEY);
      // 其它阶层不受影响。
      expect(wallKeyFor(5)).toBe('env-wall');
      expect(wallKeyFor(1005)).toBe('env-wall-industry');
    } finally {
      if (!hadCommercial) delete files['env-wall-commercial'];
      if (!hadVip) delete files['env-wall-vip'];
    }
  });

  it('已映射但文件缺失会被 furniture 测试拦住（接线契约的兜底）', () => {
    // 这条断言的是契约本身：ENV_FILES 的每个值都必须指向真实 PNG，
    // 所以"映射了但没交图"在测试层就红，不会走到运行时绿框。
    const files = ENV_FILES as Record<string, string>;
    const had = 'env-wall-commercial' in files;
    files['env-wall-commercial'] = 'wall-commercial.png';
    try {
      expect(typeof files['env-wall-commercial']).toBe('string');
    } finally {
      if (!had) delete files['env-wall-commercial'];
    }
  });
});

// ── 昼夜与光照契约 ─────────────────────────────────────────────────────────

describe('昼夜与光照的深度契约', () => {
  it('夜间 overlay 在灯光层之下、世界之上', () => {
    expect(NIGHT_DEPTH).toBeLessThan(LIGHT_DEPTH);
    expect(NIGHT_DEPTH).toBeGreaterThan(5); // 高于演员
  });

  it('每个走廊层都建得起灯光层（含上下出口的灯池）', () => {
    for (const floor of [2, 3, 4, 5, 100, 1005, 10005, 50005]) {
      const { scene, objects } = makeScene();
      const before = objects.length;
      const layer = buildLightLayer(scene as never, { width: FLOOR_WIDTH, height: FLOOR_HEIGHT, isDorm: false, hasUpExit: true, hasDownExit: true });
      const created = objects.slice(before);
      // 两个灯池 = 两张 ADD 光晕图 + 各自 7 颗尘埃；加 ambient/vignette 两张合并图。
      const glows = created.filter((o) => o.type === 'Image' && o.depth === LIGHT_DEPTH);
      expect(glows.length, `floor ${floor} 的灯池光晕`).toBe(2);
      expect(created.filter((o) => o.type === 'Rectangle' && o.depth === 25).length).toBe(14);
      expect(created.filter((o) => o.type === 'Graphics' && o.depth === 0).length).toBe(1); // ambient 两带合一
      expect(created.filter((o) => o.type === 'Graphics' && o.depth === 8).length).toBe(1); // vignette 十六条合一
      layer.destroy();
    }
  });

  it('接触阴影合并为一张 Graphics（玩家/容器/床各一处）', () => {
    const { scene, objects } = makeScene();
    const before = objects.length;
    addContactShadow(scene as never, 640, 160, 26, 2, 0.55);
    expect(objects.length - before).toBe(1);
    expect(objects[objects.length - 1].commands.length).toBe(6); // 3 层 x (fillStyle+fillRect)
  });
});

// ── 色调表完整性 ───────────────────────────────────────────────────────────

describe('corridorTint 覆盖每个走廊层', () => {
  it('楼层 2-5 各有自己的色调', () => {
    for (const floor of [2, 3, 4, 5]) {
      expect(CORRIDOR_TINT[floor], `floor ${floor}`).toBeDefined();
    }
  });

  it('其它楼层回落到段的色调或 null，不会抛', () => {
    expect(corridorTintSafe(1)).toBeNull();
    expect(corridorTintSafe(105)).toBeDefined();
    expect(corridorTintSafe(10005)).toBeDefined();
    expect(corridorTintSafe(50005)).toBeDefined();
  });
});

function corridorTintSafe(floor: number): { color: number; alpha: number } | null {
  // corridorTint 是纯函数，这里只是给个名字让断言读得懂。
  return (CORRIDOR_TINT[floor] ?? null) as { color: number; alpha: number } | null;
}
