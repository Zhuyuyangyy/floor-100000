import Phaser from 'phaser';
import { DESIGN_HEIGHT, DESIGN_WIDTH, isPortraitViewport } from './design';
import { BootScene } from '../scenes/BootScene';
import { EndScene } from '../scenes/EndScene';
import { GameScene } from '../scenes/GameScene';
import { MenuScene } from '../scenes/MenuScene';
import { MetaSelectScene } from '../scenes/MetaSelectScene';
import { TowerOverviewScene } from '../scenes/TowerOverviewScene';

export function createGameConfig(parent: string): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
    pixelArt: true,
    antialias: false,
    roundPixels: true,
    backgroundColor: '#0b0f12',
    scale: {
      // A portrait viewport gets a narrow, full-height view; the Game scene
      // sizes its camera to the same slice. Landscape keeps the original FIT.
      mode: typeof window !== 'undefined' && isPortraitViewport(window.innerWidth, window.innerHeight)
        ? Phaser.Scale.ENVELOP
        : Phaser.Scale.FIT,
      // The #game parent already centers the canvas with flexbox. Phaser's
      // CENTER_BOTH applies a second CSS offset to an ENVELOP-sized portrait
      // canvas, shifting the visible center by half the overflow amount.
      autoCenter: Phaser.Scale.NO_CENTER,
    },
    // MetaSelect sits between the title and the run: the player picks the
    // survivor they have earned before every run.
    scene: [BootScene, MenuScene, MetaSelectScene, GameScene, TowerOverviewScene, EndScene],
  };
}
