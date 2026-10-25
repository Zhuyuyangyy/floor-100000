import Phaser from 'phaser';
import { getGame } from '../core/session';
import {
  DOWN_EXIT_X,
  FLOOR_HEIGHT,
  FLOOR_WIDTH,
  PLAYER_SPEED,
  ROOM_COUNT,
  ROOM_WIDTH,
  UP_EXIT_X,
} from '../core/constants';
import { currentInteractionZone, hasDownExit, hasUpExit, movePlayerX, tryChangeFloor } from '../systems/FloorSystem';

// Playable floor view (P0-02): a scrolling corridor of room modules, a movable
// character, and up/down exits. GameState (session) is the source of truth; this
// scene only renders and feeds input back through pure logic functions.
export class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key };
  private keyE!: Phaser.Input.Keyboard.Key;
  private keyEsc!: Phaser.Input.Keyboard.Key;
  private hintText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'Game' });
  }

  create(): void {
    const state = getGame();
    const floor = state.currentFloor;

    this.cameras.main.setBackgroundColor(0x22303a);
    this.cameras.main.setBounds(0, 0, FLOOR_WIDTH, FLOOR_HEIGHT);

    this.drawCorridor(floor);
    this.drawExits(floor);

    this.player = this.add.sprite(state.player.x, FLOOR_HEIGHT - 40, 'player').setOrigin(0.5, 1);
    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);

    // HUD (fixed to the camera)
    this.add
      .text(12, 12, `第 ${floor} 层`, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ece8d8',
        backgroundColor: '#0b0f12cc',
        padding: { x: 6, y: 4 },
      })
      .setScrollFactor(0);

    this.hintText = this.add
      .text(12, FLOOR_HEIGHT - 22, 'A/D 或 ←/→ 移动 · E 交互 · ESC 菜单', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#77c6a4',
        backgroundColor: '#0b0f12cc',
        padding: { x: 6, y: 3 },
      })
      .setScrollFactor(0);

    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.cursors = keyboard.createCursorKeys();
      this.wasd = keyboard.addKeys({ left: 'A', right: 'D' }) as typeof this.wasd;
      this.keyE = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
      this.keyEsc = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
      this.keyE.on('down', this.onInteract, this);
      this.keyEsc.on('down', this.onMenu, this);
      keyboard.addCapture([Phaser.Input.Keyboard.KeyCodes.LEFT, Phaser.Input.Keyboard.KeyCodes.RIGHT]);
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // cameras.main can be null during teardown (Phaser 4 shutdown gotcha).
      this.cameras.main?.stopFollow();
      this.keyE.off('down', this.onInteract, this);
      this.keyEsc.off('down', this.onMenu, this);
    });
  }

  private drawCorridor(floor: number): void {
    const wallColors: Record<number, number> = {
      100000: 0x2a2a33,
      99999: 0x243038,
      99998: 0x1e2a33,
      99997: 0x14181e,
      99996: 0x2e2a26,
    };
    const g = this.add.graphics();
    g.fillStyle(wallColors[floor] ?? 0x22303a, 1);
    g.fillRect(0, 0, FLOOR_WIDTH, FLOOR_HEIGHT - 48);
    g.fillStyle(0x354650, 1);
    g.fillRect(0, FLOOR_HEIGHT - 48, FLOOR_WIDTH, 48);
    g.fillStyle(0x465865, 1);
    g.fillRect(0, FLOOR_HEIGHT - 48, FLOOR_WIDTH, 2);
    // room dividers
    for (let i = 0; i <= ROOM_COUNT; i++) {
      g.fillStyle(0x3a4c58, 1);
      g.fillRect(i * ROOM_WIDTH - 2, 48, 4, FLOOR_HEIGHT - 96);
    }
    // warm light accents per room
    g.fillStyle(0xf4b66a, 0.22);
    for (let r = 0; r < ROOM_COUNT; r++) {
      g.fillRect(r * ROOM_WIDTH + 48, 76, 56, 44);
    }
  }

  private drawExits(floor: number): void {
    if (hasUpExit(floor)) {
      const g = this.add.graphics();
      g.fillStyle(0x77c6a4, 1);
      g.fillRect(UP_EXIT_X - 12, FLOOR_HEIGHT - 96, 24, 48);
      this.add
        .text(UP_EXIT_X, FLOOR_HEIGHT - 104, '↑ 上楼', {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#77c6a4',
        })
        .setOrigin(0.5);
    }
    if (hasDownExit(floor)) {
      const g = this.add.graphics();
      g.fillStyle(0xf4b66a, 1);
      g.fillRect(DOWN_EXIT_X - 12, FLOOR_HEIGHT - 96, 24, 48);
      this.add
        .text(DOWN_EXIT_X, FLOOR_HEIGHT - 104, '↓ 下楼', {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#f4b66a',
        })
        .setOrigin(0.5);
    }
  }

  override update(_time: number, delta: number): void {
    const state = getGame();
    const dt = delta / 1000;

    let dir = 0;
    if (this.cursors?.left.isDown || this.wasd?.left.isDown) dir -= 1;
    if (this.cursors?.right.isDown || this.wasd?.right.isDown) dir += 1;
    if (dir !== 0) {
      movePlayerX(state, dir * PLAYER_SPEED * dt);
      this.player.x = state.player.x;
    }

    const zone = currentInteractionZone(state);
    if (zone === 'up') this.hintText.setText('按 E 上楼');
    else if (zone === 'down') this.hintText.setText('按 E 下楼');
    else this.hintText.setText('A/D 或 ←/→ 移动 · E 交互 · ESC 菜单');
  }

  private onInteract(): void {
    const zone = currentInteractionZone(getGame());
    if (zone === 'up') this.changeFloor(1);
    else if (zone === 'down') this.changeFloor(-1);
  }

  private onMenu(): void {
    this.scene.start('Menu');
  }

  private changeFloor(direction: 1 | -1): void {
    const result = tryChangeFloor(getGame(), direction);
    if (result.ok) {
      this.scene.restart();
    } else {
      this.hintText.setText(result.reason === 'top' ? '已到顶层' : '已到尽头');
    }
  }
}
