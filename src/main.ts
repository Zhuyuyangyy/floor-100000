import Phaser from 'phaser';
import { createGameConfig } from './core/gameConfig';
import { getGame, hasGame } from './core/session';
import { unlockAudio } from './render/audio';

const game = new Phaser.Game(createGameConfig('game'));

// Browsers gate audio behind a user gesture; unlock on the first one.
const unlock = (): void => unlockAudio();
window.addEventListener('pointerdown', unlock, { once: true });
window.addEventListener('keydown', unlock, { once: true });

// Dev-only handles so Playwright can assert on real game state (active scene,
// GameState) rather than just the DOM. Stripped from production builds.
if (import.meta.env.DEV) {
  const w = window as unknown as {
    __PHASER_GAME__?: Phaser.Game;
    __PHASER_SESSION__?: { getState: () => unknown };
  };
  w.__PHASER_GAME__ = game;
  w.__PHASER_SESSION__ = { getState: () => (hasGame() ? getGame() : null) };
}
