import Phaser from 'phaser';
import { createGameConfig } from './core/gameConfig';
import { getGame, hasGame } from './core/session';

const game = new Phaser.Game(createGameConfig('game'));

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
