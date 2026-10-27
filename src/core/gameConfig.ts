import Phaser from 'phaser';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from './design';
import { BootScene } from '../scenes/BootScene';
import { EndScene } from '../scenes/EndScene';
import { GameScene } from '../scenes/GameScene';
import { MenuScene } from '../scenes/MenuScene';
import { TowerOverviewScene } from '../scenes/TowerOverviewScene';

export function createGameConfig(parent: string): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
    pixelArt: true,
    backgroundColor: '#0b0f12',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [BootScene, MenuScene, GameScene, TowerOverviewScene, EndScene],
  };
}
