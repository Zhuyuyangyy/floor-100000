// TowerModel — the compact aggregate view of all 100000 floors.
//
// The tower is far too large to hold one object per floor, so nothing here
// stores per-floor state: every answer is a pure function of the floor number,
// with seed-derived variation only where the design calls for it. Floors the
// player has actually visited live in GameState.visitedFloors instead.
//
// Tier boundaries are the v1 design baseline from docs/GAME_DESIGN_LOCK.md §3.
// The exact cut-offs are tunable; the monotonic richness/control gradient is
// not.

export const TOTAL_FLOORS = 100000;
export const SECTOR_SIZE = 1000;
export const SECTOR_COUNT = TOTAL_FLOORS / SECTOR_SIZE;

export type TierId = 1 | 2 | 3 | 4 | 5 | 6;

export interface Tier {
  id: TierId;
  name: string;
  minFloor: number;
  maxFloor: number;
  zoneType: string;
  // 1 (scarcest) .. 5 (abundant). Never decreases as you climb.
  resourceLevel: number;
  // 0 (safe) .. 5 (lethal). Rises with the tiers.
  dangerLevel: number;
  // 0 (open) .. 5 (sealed). Rises with the tiers.
  security: number;
}

export const TIERS: readonly Tier[] = [
  { id: 1, name: '底层贫民区', minFloor: 1, maxFloor: 99, zoneType: 'slum', resourceLevel: 1, dangerLevel: 2, security: 0 },
  { id: 2, name: '工人宿舍区', minFloor: 100, maxFloor: 999, zoneType: 'worker', resourceLevel: 2, dangerLevel: 2, security: 1 },
  { id: 3, name: '工业与交易区', minFloor: 1000, maxFloor: 9999, zoneType: 'industrial', resourceLevel: 3, dangerLevel: 3, security: 2 },
  { id: 4, name: '中产与商业区', minFloor: 10000, maxFloor: 49999, zoneType: 'commercial', resourceLevel: 4, dangerLevel: 3, security: 3 },
  { id: 5, name: '富人特权区', minFloor: 50000, maxFloor: 89999, zoneType: 'elite', resourceLevel: 5, dangerLevel: 4, security: 4 },
  { id: 6, name: '统治核心', minFloor: 90000, maxFloor: 100000, zoneType: 'core', resourceLevel: 5, dangerLevel: 5, security: 5 },
];

function assertFloor(floor: number): void {
  if (!Number.isInteger(floor) || floor < 1 || floor > TOTAL_FLOORS) {
    throw new Error(`floor ${floor} is outside the tower (1..${TOTAL_FLOORS})`);
  }
}

export function tierOf(floor: number): Tier {
  assertFloor(floor);
  const tier = TIERS.find((t) => floor >= t.minFloor && floor <= t.maxFloor);
  if (!tier) throw new Error(`no tier covers floor ${floor}`);
  return tier;
}

// Alias used where the caller already holds a validated floor.
export const floorTier = tierOf;

export function sectorOf(floor: number): number {
  assertFloor(floor);
  return Math.floor((floor - 1) / SECTOR_SIZE);
}

export function sectorRange(sector: number): { from: number; to: number } {
  if (!Number.isInteger(sector) || sector < 0 || sector >= SECTOR_COUNT) {
    throw new Error(`sector ${sector} is outside the tower (0..${SECTOR_COUNT - 1})`);
  }
  const from = sector * SECTOR_SIZE + 1;
  return { from, to: from + SECTOR_SIZE - 1 };
}

export interface FloorRecord {
  floor: number;
  tier: TierId;
  tierName: string;
  zoneType: string;
  resourceLevel: number;
  dangerLevel: number;
  security: number;
  // Reserved for the faction system (B3). 'none' means unclaimed.
  faction: string;
  // Player access level required to enter legitimately.
  access: number;
  explored: boolean;
}

// A floor's aggregate description. Tier and security are structural, so there
// is deliberately no seed-derived variation here — a floor's place in the
// hierarchy must not change between visits.
export function describeFloor(floor: number): FloorRecord {
  const tier = tierOf(floor);
  return {
    floor,
    tier: tier.id,
    tierName: tier.name,
    zoneType: tier.zoneType,
    resourceLevel: tier.resourceLevel,
    dangerLevel: tier.dangerLevel,
    security: tier.security,
    faction: 'none',
    access: tier.security,
    explored: false,
  };
}

export interface SectorSummary {
  sector: number;
  from: number;
  to: number;
  tiers: Array<{ tier: TierId; name: string; count: number }>;
  resourceLevel: number;
  dangerLevel: number;
  security: number;
}

// Aggregates a whole sector. Deliberately does not enumerate its 1000 floors.
export function describeSector(sector: number): SectorSummary {
  const { from, to } = sectorRange(sector);
  const tiers: Array<{ tier: TierId; name: string; count: number }> = [];
  for (const t of TIERS) {
    const lo = Math.max(t.minFloor, from);
    const hi = Math.min(t.maxFloor, to);
    if (lo <= hi) tiers.push({ tier: t.id, name: t.name, count: hi - lo + 1 });
  }
  const span = TIERS.filter((t) => t.maxFloor >= from && t.minFloor <= to);
  return {
    sector,
    from,
    to,
    tiers,
    resourceLevel: Math.max(...span.map((t) => t.resourceLevel)),
    dangerLevel: Math.max(...span.map((t) => t.dangerLevel)),
    security: Math.max(...span.map((t) => t.security)),
  };
}

export interface Access {
  // Highest floor the player may enter by legitimate means.
  highestUnlocked: number;
  currentFloor: number;
}

// The rule that keeps the overview a planning tool rather than a teleporter:
// you may only enter a floor you have actually unlocked access to, or the one
// you are already standing on.
export function canEnter(floor: number, access: Access): boolean {
  if (!Number.isInteger(floor) || floor < 1 || floor > TOTAL_FLOORS) return false;
  return floor <= access.highestUnlocked || floor === access.currentFloor;
}
