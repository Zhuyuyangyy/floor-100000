export const WEAPON_IDS = ['crowbar', 'dagger', 'short_sword', 'cleaver', 'fire_axe'] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];
export type WeaponFxId = 'sword-slash' | 'heavy-cleave';

export interface AttackPoseFrame {
  stance: number;
  armSwing: number;
  farSwing: number;
  lean: number;
  headDx: number;
}

export interface WeaponDefinition {
  /** Prepared VFX route. New-weapon routes remain unused until manual equipment exists. */
  fx: WeaponFxId;
  /** Phaser texture key. The crowbar is baked; the other four are loaded PNGs. */
  spriteKey: string;
  /** Relative to public/assets/weapons; omitted for the procedurally baked crowbar. */
  spriteFile?: string;
  /** Grip point in the shared 46x18 sprite canvas. */
  grip: { x: number; y: number };
  /** Three-frame wind-up, strike and recovery body/arm poses. */
  attack: readonly [AttackPoseFrame, AttackPoseFrame, AttackPoseFrame];
}

export const WEAPONS: Record<WeaponId, WeaponDefinition> = {
  crowbar: {
    fx: 'sword-slash',
    spriteKey: 'weapon-crowbar',
    grip: { x: 4, y: 9 },
    attack: [
      { stance: 10, armSwing: -50, farSwing: 25, lean: -1.5, headDx: -3 },
      { stance: 11, armSwing: 78, farSwing: -30, lean: 5, headDx: 4 },
      { stance: 10, armSwing: 25, farSwing: -12, lean: 2.5, headDx: 1 },
    ],
  },
  dagger: {
    fx: 'sword-slash',
    spriteKey: 'weapon-dagger',
    spriteFile: 'dagger.png',
    grip: { x: 9, y: 9 },
    attack: [
      { stance: 10, armSwing: -24, farSwing: 12, lean: -0.5, headDx: -1 },
      { stance: 10, armSwing: 68, farSwing: -8, lean: 2.5, headDx: 2 },
      { stance: 10, armSwing: 18, farSwing: -5, lean: 1, headDx: 0 },
    ],
  },
  short_sword: {
    fx: 'sword-slash',
    spriteKey: 'weapon-short-sword',
    spriteFile: 'short_sword.png',
    grip: { x: 8, y: 9 },
    attack: [
      { stance: 10, armSwing: -68, farSwing: 20, lean: -3, headDx: -3 },
      { stance: 11, armSwing: 96, farSwing: -28, lean: 5, headDx: 4 },
      { stance: 10, armSwing: 32, farSwing: -12, lean: 2.5, headDx: 1 },
    ],
  },
  cleaver: {
    fx: 'heavy-cleave',
    spriteKey: 'weapon-cleaver',
    spriteFile: 'cleaver.png',
    grip: { x: 10, y: 9 },
    attack: [
      { stance: 10, armSwing: -104, farSwing: 24, lean: -4, headDx: -4 },
      { stance: 12, armSwing: 120, farSwing: -38, lean: 7, headDx: 5 },
      { stance: 11, armSwing: 44, farSwing: -18, lean: 3, headDx: 1 },
    ],
  },
  fire_axe: {
    fx: 'heavy-cleave',
    spriteKey: 'weapon-fire-axe',
    spriteFile: 'fire_axe.png',
    grip: { x: 15, y: 9 },
    attack: [
      { stance: 11, armSwing: -132, farSwing: 32, lean: -6, headDx: -5 },
      { stance: 13, armSwing: 108, farSwing: -44, lean: 9, headDx: 6 },
      { stance: 11, armSwing: 36, farSwing: -20, lean: 4, headDx: 1 },
    ],
  },
};
