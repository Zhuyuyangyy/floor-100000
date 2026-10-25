import Phaser from 'phaser';
import { createGameConfig } from './core/gameConfig';

const game = new Phaser.Game(createGameConfig('game'));

// Dev-only handle so Playwright can assert on real game state (active scene,
// rendered pixels) rather than just the DOM. Stripped from production builds.
if (import.meta.env.DEV) {
  (window as unknown as { __PHASER_GAME__?: Phaser.Game }).__PHASER_GAME__ = game;
}
