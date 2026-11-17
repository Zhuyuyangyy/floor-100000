import { describe, expect, it } from 'vitest';

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../core/design';
import { TIERS, TOTAL_FLOORS, sectorOf, sectorRange, tierOf } from '../core/tower';
import {
  TOWER_MAP,
  baseHighY,
  baseLowY,
  buildingFloorY,
  buildingHeight,
  buildingX0,
  buildingX1,
  contentBandHeight,
  floorAtBuildingY,
  floorAtRibbonY,
  sectorRibbonHeight,
  sectorRibbonY,
  tierBlockHighY,
  tierBlockLowY,
  towerFitZoom,
  viewCenterBounds,
} from '../render/hudLayout';

// AG-62 (塔楼地图楼体剖面化) 的几何守卫。地图的整个视觉语言来自这些纯函数：
// 楼体高度、基座、阶层段、楼层 y、区段 ribbon、镜头夹制。scene 只负责画，
// 算术全部住在这里——所以「1-5 层在楼体底部」「每段等高」「默认视图聚焦当前
// 段而不是整栋楼」这些用户点名要的行为，可以在 Node 里钉死，不必等截图。
//
// 不 import Phaser：hudLayout 保持无框架，测试直接读产品代码而不是镜像。
//
// 坐标约定（hudLayout 的两套模型）：公开 API 是 Phaser 原生的 y 向下——1 层
// 在楼体最下（y 最大）、100000 层在最上（y=0）。下面每个期望值都按这个约定写。

/** 楼体内容带的上下沿（固定 HUD 与页脚之间）。 */
const BAND_TOP = TOWER_MAP.topBand;
const BAND_BOTTOM = TOWER_MAP.bottomBand;

/** 世界 y → 屏 y（镜头中心 center 处的映射，与 scene 的 screenY 同式）。
 *  Phaser 的镜头把视图居中在 (scroll + 画布半宽/高) 上，所以
 *  屏 y = (世界 y - 镜头中心) * zoom + 画布半高。 */
const screenY = (worldY: number, center: number, zoom: number): number => (worldY - center) * zoom + DESIGN_HEIGHT / 2;

/** 夹制后的镜头中心。 */
const clampCenter = (contentHeight: number, zoom: number, center: number): number => {
  const { min, max } = viewCenterBounds(contentHeight, zoom);
  return Math.max(min, Math.min(max, center));
};

const fitZoom = (): number => towerFitZoom();

describe('the building cross-section: blocks', () => {
  it('is one equal block per tier, stacked bottom-up over the basement', () => {
    // 基座（1-5 层）在最底下（y 最大），其上每段等高，段间夹着结构层。
    expect(baseHighY()).toBe(buildingHeight() - TOWER_MAP.foundationH);
    expect(baseLowY()).toBe(buildingHeight() - TOWER_MAP.foundationH - TOWER_MAP.baseH);
    // 基座与 T1 之间隔着一条缝：T1 的上沿（屏上更高 = y 更小）在基座上沿之上。
    expect(tierBlockHighY(1)).toBe(baseLowY() - TOWER_MAP.seamH);
    for (let t = 2 as const; t <= 6; t++) {
      // 缝夹在下一段的上沿与上一段的底沿之间（y 向下：上一段底沿 y 更大）。
      expect(tierBlockLowY((t - 1) as 1) - tierBlockHighY(t)).toBe(TOWER_MAP.seamH);
      expect(tierBlockHighY(t) - tierBlockLowY(t)).toBe(TOWER_MAP.tierH);
    }
    // 整栋楼的高度就是 T6 段顶到地基底；塔顶楼层 100000 落在 y=0。
    expect(buildingHeight()).toBe(
      TOWER_MAP.foundationH + TOWER_MAP.baseH + TOWER_MAP.seamH + 6 * TOWER_MAP.tierH + 5 * TOWER_MAP.seamH,
    );
    // 塔顶楼层贴在楼体最高处（y=0，浮点容差）。
    expect(buildingFloorY(TOTAL_FLOORS)).toBeCloseTo(0, 1);
  });

  it('centres the building on the canvas', () => {
    // 楼体水平居中：镜头 scrollX 把楼体中点钉在画布中点，所以任意缩放下楼体
    // 都在屏幕中央，世界 x 的左右缘严格对称。
    expect(buildingX0()).toBe((DESIGN_WIDTH - TOWER_MAP.buildingW) / 2);
    expect(buildingX1()).toBe(buildingX0() + TOWER_MAP.buildingW);
    expect((buildingX0() + buildingX1()) / 2).toBe(DESIGN_WIDTH / 2);
  });

  it('keeps the content band inside the canvas and clear of the footer', () => {
    expect(BAND_TOP).toBeGreaterThan(0);
    expect(BAND_BOTTOM).toBeLessThan(DESIGN_HEIGHT);
    expect(BAND_BOTTOM).toBeGreaterThan(BAND_TOP);
    // 全塔缩放必须刚好把整栋楼装进内容带——这是 F/「看全塔」的分辨率，也是
    // 总览的缩放下限。
    expect(buildingHeight() * towerFitZoom()).toBeLessThanOrEqual(contentBandHeight());
    expect(towerFitZoom()).toBeLessThan(TOWER_MAP.zoomDefault);
  });
});

describe('the building cross-section: floor positions', () => {
  it('puts the starting five floors in the basement, one room per slab', () => {
    // 用户点名「前面 5 层都能看见，因为相当于是我们基础发育的一个地方」：
    // 1-5 层全部落在基座段内，等距分布，不越界到 T1。
    for (let f = 1; f <= TOWER_MAP.baseFloors; f++) {
      const y = buildingFloorY(f);
      expect(y, `floor ${f}`).toBeGreaterThan(baseLowY());
      expect(y, `floor ${f}`).toBeLessThan(baseHighY());
    }
    // 1 层在最下（y 最大），5 层在最上。
    const pitch = TOWER_MAP.baseH / TOWER_MAP.baseFloors;
    for (let f = 1; f < TOWER_MAP.baseFloors; f++) {
      expect(buildingFloorY(f) - buildingFloorY(f + 1)).toBeCloseTo(pitch, 6);
    }
    // 基座每层 30 单位，是 T1 每层楼距的 10 倍——「厚」是它独立于阶层段的方式。
    expect(pitch).toBeGreaterThan((TOWER_MAP.tierH / TIERS[0].maxFloor) * 9);
  });

  it('maps every tier boundary floor into its own block', () => {
    // 段界楼层必须落在所属段内：99/100、999/1000、9999/10000、49999/50000、
    // 89999/90000 是六个断点，任何一个漏到隔壁段都会让段框画错楼层。
    // T1 的 1-5 层住在基座里，所以探针从第 6 层起。
    for (const tier of TIERS) {
      const low = tierBlockLowY(tier.id);
      const high = tierBlockHighY(tier.id);
      const bottomProbe = tier.id === 1 ? 6 : tier.minFloor;
      expect(buildingFloorY(bottomProbe), `T${tier.id} bottom`).toBeGreaterThan(low);
      expect(buildingFloorY(bottomProbe), `T${tier.id} bottom`).toBeLessThan(high);
      expect(buildingFloorY(tier.maxFloor), `T${tier.id} top`).toBeGreaterThan(low);
      expect(buildingFloorY(tier.maxFloor), `T${tier.id} top`).toBeLessThan(high);
    }
  });

  it('climbs monotonically down the screen across the whole tower', () => {
    // y 向下：楼层越高，y 越小。探针从 1 层走到塔顶，y 必须严格递减。
    let prev = buildingFloorY(1);
    for (const probe of [2, 3, 5, 6, 99, 100, 101, 999, 1000, 1001, 9999, 10000, 49999, 50000, 89999, 90000, 99999, TOTAL_FLOORS]) {
      const y = buildingFloorY(probe);
      expect(y, `floor ${probe}`).toBeLessThan(prev);
      prev = y;
    }
  });

  it('throws outside the tower', () => {
    expect(() => buildingFloorY(0)).toThrow();
    expect(() => buildingFloorY(TOTAL_FLOORS + 1)).toThrow();
  });
});

describe('the building cross-section: picking', () => {
  it('round-trips every floor boundary through floorAtBuildingY', () => {
    // 段界 + 基座界 + 塔顶：每个探针楼层取出 y、再映射回楼层必须等于自己。
    const probes: number[] = [1, 2, 3, 4, 5];
    for (const tier of TIERS) probes.push(tier.id === 1 ? 6 : tier.minFloor, tier.maxFloor);
    probes.push(TOTAL_FLOORS);
    for (const floor of probes) {
      const y = buildingFloorY(floor);
      expect(floorAtBuildingY(y), `floor ${floor}`).toBe(floor);
    }
  });

  it('picks nothing in a seam or the foundation', () => {
    // 缝里没有楼层：悬停/点击落在结构层上时什么都不选中，比吸附到最近楼层诚实。
    const seamMids: number[] = [(tierBlockHighY(1) + baseLowY()) / 2];
    for (let t = 2 as const; t <= 6; t++) seamMids.push((tierBlockHighY(t) + tierBlockLowY((t - 1) as 1)) / 2);
    for (const mid of seamMids) {
      expect(floorAtBuildingY(mid), `seam ${mid}`).toBeNull();
    }
    expect(floorAtBuildingY(baseHighY() + TOWER_MAP.foundationH / 2)).toBeNull(); // 地基
    expect(floorAtBuildingY(-1)).toBeNull(); // 塔顶之上
    expect(floorAtBuildingY(buildingHeight() + 1)).toBeNull(); // 地基之下
  });

  it('keeps a picked floor inside the tier the pointer is over', () => {
    // 每段的中点必须映射回该段中部的楼层（不会串段）。
    for (const tier of TIERS) {
      const middle = (tierBlockLowY(tier.id) + tierBlockHighY(tier.id)) / 2;
      const floor = floorAtBuildingY(middle);
      expect(floor).not.toBeNull();
      expect(tierOf(floor as number).id).toBe(tier.id);
    }
  });
});

describe('the sector ribbon: the magnifier', () => {
  it('lays the sector out at a fixed pitch, the sector top at y=0', () => {
    const { from, to } = sectorRange(0);
    // y 向下：段顶（to）在 Ribbon 顶端，段底（from）在底端。
    expect(sectorRibbonY(from, to)).toBe(0);
    expect(sectorRibbonY(from, from)).toBe(sectorRibbonHeight() - TOWER_MAP.sectorPitch);
    expect(sectorRibbonY(from, from + 1) - sectorRibbonY(from, from)).toBe(-TOWER_MAP.sectorPitch);
    for (let floor = from; floor <= to; floor++) {
      expect(floorAtRibbonY(from, to, sectorRibbonY(from, floor))).toBe(floor);
    }
  });

  it('clamps to the sector and refuses the outside', () => {
    const { from, to } = sectorRange(3);
    expect(floorAtRibbonY(from, to, -1)).toBeNull();
    expect(floorAtRibbonY(from, to, sectorRibbonHeight())).toBeNull();
    // 段底 slot 的最后一格仍算段底楼层（夹住，不越界）。
    expect(floorAtRibbonY(from, to, sectorRibbonHeight() - 1)).toBe(from);
  });

  it('is readable at its default zoom and zoomable to detail', () => {
    // 默认缩放下每层楼在屏上 8px：区段是放大镜，不是第二套视觉语言。
    expect(TOWER_MAP.sectorPitch * TOWER_MAP.sectorZoomDefault).toBeGreaterThanOrEqual(8);
    expect(TOWER_MAP.sectorZoomMax).toBeGreaterThan(TOWER_MAP.sectorZoomDefault);
  });
});

describe('the camera clamp: no dead zones, no HUD collisions', () => {
  /**
   * 镜头中心被夹在 [min, max] 后，内容带必须被内容完整盖住：内容顶边在带上沿
   * 或其上，内容底边在带下沿或其下——带内任何一屏像素都有楼体/ribbon，没有
   * 死区。反过来（顶在带内、底也在带内）只在内容装得下整个带时成立。
   *
   * 0.5px 容差是浮点的：夹制边界上屏坐标会抖出 88.00000000000001 这种值，
   * 保证的是「带内无死区」到半像素，不是逐位相等。
   */
  const coversBand = (contentHeight: number, zoom: number, center: number): boolean => {
    const clamped = clampCenter(contentHeight, zoom, center);
    const topScreen = screenY(0, clamped, zoom);
    const bottomScreen = screenY(contentHeight, clamped, zoom);
    return topScreen <= BAND_TOP + 0.5 && bottomScreen >= BAND_BOTTOM - 0.5;
  };

  it('covers the content band at every overview zoom, scrolled to both ends', () => {
    for (const zoom of [towerFitZoom(), 0.4, TOWER_MAP.zoomDefault, 2, TOWER_MAP.zoomMax]) {
      for (const center of [-5000, 0, 500, 1033, 2000, 99999]) {
        expect(coversBand(buildingHeight(), zoom, center), `zoom ${zoom} centre ${center}`).toBe(true);
      }
    }
  });

  it('covers the content band on the ribbon at every sector zoom', () => {
    for (const zoom of [TOWER_MAP.sectorZoomMin, 1, TOWER_MAP.sectorZoomDefault, 3, TOWER_MAP.sectorZoomMax]) {
      for (const center of [-100, 0, 4000, 8000, 99999]) {
        expect(coversBand(sectorRibbonHeight(), zoom, center), `zoom ${zoom} centre ${center}`).toBe(true);
      }
    }
  });

  it('fits the whole tower into the band at the fit zoom — the 全塔 view', () => {
    const z = fitZoom();
    const { min, max } = viewCenterBounds(buildingHeight(), z);
    // 装得下时只有一个合法中心：内容居中于带。
    expect(min).toBe(max);
    // 楼体顶（y=0）落在带上沿，楼体底（地基）落在带下沿（浮点容差 0.5px）。
    expect(screenY(0, min, z)).toBeCloseTo(BAND_TOP, 0);
    expect(screenY(buildingHeight(), min, z)).toBeCloseTo(BAND_BOTTOM, 0);
  });

  it('opens focused on the player’s own segment, not the whole spire', () => {
    // 用户原话「不要一下子看到 1 万层很奇怪」：默认视图必须比整栋楼小得多，
    // 且完整盖住玩家所在段（基座或阶层段）。
    const zoom = TOWER_MAP.zoomDefault;
    expect(zoom).toBeGreaterThan(fitZoom());
    const viewHeight = DESIGN_HEIGHT / zoom;
    expect(viewHeight).toBeLessThan(buildingHeight() * 0.4);

    for (const floor of [1, 3, 5, 50, 500, 5000, 50000, 95000]) {
      const inBase = floor <= TOWER_MAP.baseFloors;
      const low = inBase ? baseLowY() : tierBlockLowY(tierOf(floor).id);
      const high = inBase ? baseHighY() : tierBlockHighY(tierOf(floor).id);
      const center = clampCenter(buildingHeight(), zoom, (low + high) / 2);
      expect(screenY(low, center, zoom), `floor ${floor}: segment top`).toBeGreaterThanOrEqual(BAND_TOP);
      expect(screenY(high, center, zoom), `floor ${floor}: segment bottom`).toBeLessThanOrEqual(BAND_BOTTOM);
      // 当前段全段在屏内，且视口高于一段（上下各能看见一段预览）。
      expect(viewHeight).toBeGreaterThan(high - low);
    }
  });

  it('shows the basement from the first tier at the default zoom', () => {
    // 「前面 5 层都能看见」的第二种读法：站在 T1 里往下看，基座顶与第 5 层
    // 也落在默认视口里（默认视图比一段高，向下 preview 得到基座）。
    const zoom = TOWER_MAP.zoomDefault;
    const center = clampCenter(buildingHeight(), zoom, (tierBlockLowY(1) + tierBlockHighY(1)) / 2);
    expect(screenY(baseLowY(), center, zoom)).toBeGreaterThanOrEqual(BAND_TOP);
    expect(screenY(buildingFloorY(5), center, zoom)).toBeLessThanOrEqual(BAND_BOTTOM);
  });
});

describe('the tower the geometry describes', () => {
  it('has a sector for every 1000 floors and a tier for every probe', () => {
    // 几何函数消费的塔模型本身的自检：sector 边界与楼层总数对齐。
    expect(sectorOf(1)).toBe(0);
    expect(sectorOf(TOTAL_FLOORS)).toBe(TOTAL_FLOORS / 1000 - 1);
    const { from, to } = sectorRange(0);
    expect(from).toBe(1);
    expect(to).toBe(1000);
  });
});
