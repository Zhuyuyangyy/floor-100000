// The project's palette. One file, sixteen colours, everything else derives.
//
// WHY A LIMITED PALETTE. Measured before this existed: the procedural art used
// four unrelated colour sets — pixelArt.ts had six colours, walkcycle.ts twelve
// per character, uiKit.ts its own roles, lighting.ts another set. Nothing agreed
// on what "shadow" or "highlight" meant, so every screen had dozens of colours
// sitting a few values apart from each other and the whole image read as mush.
//
// Limited palettes are the standard answer (Lospec's Endesga-32 and Sweetie-16
// are the usual references) and the reason is readability, not style: with few
// colours every slot has to carry one clear job, so the picture gains value
// structure for free. Sixteen is the small end that still allows four materials
// (stone, cloth, skin, metal) plus a warm light ramp.
//
// The ramp runs dark to light in each family, and every family shares the same
// eight-step value curve, so a highlight on cloth and a highlight on stone are
// the same brightness — which is what makes different materials look like they
// belong to one world.

/** A colour family: [deep shadow, shadow, base, light, highlight] */
export interface Ramp {
  readonly deep: number;
  readonly shadow: number;
  readonly base: number;
  readonly light: number;
  readonly high: number;
}

// ── the sixteen ─────────────────────────────────────────────────────────────
// Deliberately cold: this is a building at night. The only warm ramp is LIGHT,
// which is why any warm pixel on screen reads as "something is lit".
export const PALETTE = {
  // Neutrals — walls, floors, UI chrome, outlines
  ink: 0x05080b, // darkest; outlines and the void
  shadow: 0x14202c, // deep shadow
  stone: 0x2c3f4e, // the base wall value
  stoneLight: 0x47657a, // lit stone
  dust: 0x8a95a0, // pale stone / dust / disabled text

  // Cloth — the survivor's jacket
  clothDeep: 0x1e4a44,
  cloth: 0x2f6b5e,
  clothLight: 0x4e9c86,
  clothHigh: 0x77c6a4, // the teal the project already used as its "safe" accent

  // Skin
  skinDeep: 0x6b4630,
  skin: 0xa5714c,
  skinLight: 0xd9b48f,

  // Warm light — lamps, fire, gold
  lightDeep: 0x8a4a1e,
  light: 0xd98b3c,
  lightHigh: 0xf4b66a, // the project's existing lamp orange
  lightHot: 0xffe4b6, // near-white core; the only colour this bright
} as const;

// ── ramps ───────────────────────────────────────────────────────────────────
// Named families so a drawer asks for "the stone ramp" instead of picking five
// hexes that happen to look related.
export const STONE: Ramp = {
  deep: PALETTE.ink,
  shadow: PALETTE.shadow,
  base: PALETTE.stone,
  light: PALETTE.stoneLight,
  high: PALETTE.dust,
};

export const CLOTH: Ramp = {
  deep: PALETTE.ink,
  shadow: PALETTE.clothDeep,
  base: PALETTE.cloth,
  light: PALETTE.clothLight,
  high: PALETTE.clothHigh,
};

export const SKIN: Ramp = {
  deep: PALETTE.shadow,
  shadow: PALETTE.skinDeep,
  base: PALETTE.skin,
  light: PALETTE.skinLight,
  high: 0xeccfae,
};

export const LIGHT: Ramp = {
  deep: PALETTE.lightDeep,
  shadow: PALETTE.light,
  base: PALETTE.lightHigh,
  light: PALETTE.lightHot,
  high: 0xffffff,
};

// ── roles ───────────────────────────────────────────────────────────────────
// What a call site should ask for. These are the only names UI and world code
// should use; reaching for PALETTE directly is for the drawers.
export const ROLE = {
  /** the void behind everything */
  void: PALETTE.ink,
  /** panel and HUD surfaces */
  surface: PALETTE.shadow,
  /** raised surfaces: headers, inset wells */
  surfaceRaised: PALETTE.stone,
  /** the 1px hairline between rows */
  line: PALETTE.stoneLight,
  /** body text */
  text: 0xece8d8,
  /** de-emphasised text */
  textDim: PALETTE.dust,
  /** the warm accent: titles, selection, gold, lamps */
  accent: PALETTE.lightHigh,
  /** the teal accent: safe, positive, allies */
  good: PALETTE.clothHigh,
  /** danger: damage, blockers */
  danger: 0xe56d63,
} as const;

// The four survival stats, each on its own family so a glance reads which one is
// failing. hp is the only non-palette colour on purpose: it has to be the one
// thing that looks like blood.
export const STAT_COLOR = {
  hp: 0xd8665f,
  hunger: PALETTE.light,
  thirst: PALETTE.stoneLight,
  energy: PALETTE.clothLight,
} as const;

/** Mix two palette colours. Pure, no Phaser — safe in Node tests. */
export function mix(a: number, b: number, t: number): number {
  const lerp = (ca: number, cb: number): number => Math.round(ca + (cb - ca) * t);
  const r = lerp((a >> 16) & 0xff, (b >> 16) & 0xff);
  const g = lerp((a >> 8) & 0xff, (b >> 8) & 0xff);
  const bl = lerp(a & 0xff, b & 0xff);
  return (r << 16) | (g << 8) | bl;
}

/** Every palette colour as an array, for tests and palette audits. */
export const PALETTE_LIST: readonly number[] = Object.values(PALETTE);
