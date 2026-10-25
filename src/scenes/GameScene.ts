import Phaser from 'phaser';
import { getGame } from '../core/session';
import {
  DOWN_EXIT_X,
  FLOOR_HEIGHT,
  FLOOR_WIDTH,
  INTERACT_DISTANCE,
  PLAYER_SPEED,
  ROOM_COUNT,
  ROOM_WIDTH,
  UP_EXIT_X,
} from '../core/constants';
import { currentInteractionZone, hasDownExit, hasUpExit, movePlayerX, tryChangeFloor } from '../systems/FloorSystem';
import { getFloorView, lootContainer, lootGround } from '../systems/LootSystem';
import { useConsumable } from '../systems/InventorySystem';
import { saveToStorage } from '../systems/SaveSystem';
import { getItem } from '../data/items';
import type { GeneratedContainer, GeneratedFloor, StatKey } from '../core/gameTypes';

const STAT_LABEL: Record<StatKey, string> = { hp: '生命', hunger: '饱食', thirst: '水分', energy: '精力' };
const INVENTORY_SLOTS = 12;

// Playable floor view (P0-02 + P0-03): scrolling corridor, movable character,
// up/down exits, lootable containers & ground items, a 12-slot inventory, and
// consumable use. GameState (session) is the source of truth; this scene only
// renders and feeds input back through pure logic functions.
export class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key };
  private keyE!: Phaser.Input.Keyboard.Key;
  private keyEsc!: Phaser.Input.Keyboard.Key;
  private keyI!: Phaser.Input.Keyboard.Key;
  private keyEnter!: Phaser.Input.Keyboard.Key;

  private floorView!: GeneratedFloor;
  private containerObjs = new Map<string, { box: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text }>();
  private groundObjs = new Map<string, Phaser.GameObjects.Rectangle>();

  private statsText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private feedbackText!: Phaser.GameObjects.Text;
  private feedbackTimer?: Phaser.Time.TimerEvent;

  private invObjects: Array<Phaser.GameObjects.Text | Phaser.GameObjects.Graphics> = [];
  private invSlotTexts: Phaser.GameObjects.Text[] = [];
  private invSelected = 0;
  private inventoryOpen = false;

  constructor() {
    super({ key: 'Game' });
  }

  create(): void {
    const state = getGame();
    const floor = state.currentFloor;
    this.floorView = getFloorView(state, floor);

    this.cameras.main.setBackgroundColor(0x22303a);
    this.cameras.main.setBounds(0, 0, FLOOR_WIDTH, FLOOR_HEIGHT);

    this.drawCorridor(floor);
    this.drawExits(floor);
    this.buildContainers();
    this.buildGround();

    this.player = this.add.sprite(state.player.x, FLOOR_HEIGHT - 40, 'player').setOrigin(0.5, 1);
    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);

    this.buildHud(floor);
    this.buildInventoryPanel();
    this.bindInput();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // cameras.main can be null during teardown (Phaser 4 shutdown gotcha).
      this.cameras.main?.stopFollow();
      this.feedbackTimer?.remove(false);
      this.unbindInput();
    });
  }

  // ── world ──────────────────────────────────────────────────────────────
  private drawCorridor(floor: number): void {
    const wallColors: Record<number, number> = {
      100000: 0x2a2a33, 99999: 0x243038, 99998: 0x1e2a33, 99997: 0x14181e, 99996: 0x2e2a26,
    };
    const g = this.add.graphics();
    g.fillStyle(wallColors[floor] ?? 0x22303a, 1);
    g.fillRect(0, 0, FLOOR_WIDTH, FLOOR_HEIGHT - 48);
    g.fillStyle(0x354650, 1);
    g.fillRect(0, FLOOR_HEIGHT - 48, FLOOR_WIDTH, 48);
    g.fillStyle(0x465865, 1);
    g.fillRect(0, FLOOR_HEIGHT - 48, FLOOR_WIDTH, 2);
    for (let i = 0; i <= ROOM_COUNT; i++) {
      g.fillStyle(0x3a4c58, 1);
      g.fillRect(i * ROOM_WIDTH - 2, 48, 4, FLOOR_HEIGHT - 96);
    }
    g.fillStyle(0xf4b66a, 0.22);
    for (let r = 0; r < ROOM_COUNT; r++) g.fillRect(r * ROOM_WIDTH + 48, 76, 56, 44);
  }

  private drawExits(floor: number): void {
    if (hasUpExit(floor)) {
      const g = this.add.graphics();
      g.fillStyle(0x77c6a4, 1);
      g.fillRect(UP_EXIT_X - 12, FLOOR_HEIGHT - 96, 24, 48);
      this.add.text(UP_EXIT_X, FLOOR_HEIGHT - 104, '↑ 上楼', { fontFamily: 'monospace', fontSize: '12px', color: '#77c6a4' }).setOrigin(0.5);
    }
    if (hasDownExit(floor)) {
      const g = this.add.graphics();
      g.fillStyle(0xf4b66a, 1);
      g.fillRect(DOWN_EXIT_X - 12, FLOOR_HEIGHT - 96, 24, 48);
      this.add.text(DOWN_EXIT_X, FLOOR_HEIGHT - 104, '↓ 下楼', { fontFamily: 'monospace', fontSize: '12px', color: '#f4b66a' }).setOrigin(0.5);
    }
  }

  private buildContainers(): void {
    for (const c of this.floorView.containers) {
      const y = FLOOR_HEIGHT - 64;
      const box = this.add.graphics();
      box.fillStyle(0x4a3a2a, 1);
      box.fillRect(c.x - 14, y - 16, 28, 32);
      box.lineStyle(2, 0xf4b66a, 1);
      box.strokeRect(c.x - 14, y - 16, 28, 32);
      const label = this.add.text(c.x, y - 26, c.label, { fontFamily: 'monospace', fontSize: '11px', color: '#ece8d8' }).setOrigin(0.5);
      this.containerObjs.set(c.id, { box, label });
      this.setContainerEmptyVisual(c.id, c.items.length === 0);
    }
  }

  private setContainerEmptyVisual(id: string, empty: boolean): void {
    const obj = this.containerObjs.get(id);
    if (!obj) return;
    const label = this.floorView.containers.find((c) => c.id === id)?.label ?? id;
    obj.box.setAlpha(empty ? 0.35 : 1);
    obj.label.setText(empty ? `${label}（空）` : label);
  }

  private buildGround(): void {
    for (const g of this.floorView.groundItems) {
      const rect = this.add.rectangle(g.x, FLOOR_HEIGHT - 52, 10, 10, 0x77c6a4).setStrokeStyle(1, 0xece8d8);
      this.groundObjs.set(g.key, rect);
    }
  }

  // ── HUD & inventory UI ─────────────────────────────────────────────────
  private buildHud(floor: number): void {
    this.add
      .text(12, 12, `第 ${floor} 层`, { fontFamily: 'monospace', fontSize: '16px', color: '#ece8d8', backgroundColor: '#0b0f12cc', padding: { x: 6, y: 4 } })
      .setScrollFactor(0).setDepth(100);

    this.statsText = this.add
      .text(12, 38, '', { fontFamily: 'monospace', fontSize: '12px', color: '#ece8d8', backgroundColor: '#0b0f12cc', padding: { x: 6, y: 3 } })
      .setScrollFactor(0).setDepth(100);
    this.refreshStats();

    this.feedbackText = this.add
      .text(FLOOR_WIDTH / 2, 60, '', { fontFamily: 'monospace', fontSize: '13px', color: '#f4b66a', backgroundColor: '#0b0f12cc', padding: { x: 8, y: 4 } })
      .setOrigin(0.5).setScrollFactor(0).setDepth(120);

    this.hintText = this.add
      .text(12, FLOOR_HEIGHT - 22, 'A/D 或 ←/→ 移动 · E 交互 · I 背包 · ESC 菜单', { fontFamily: 'monospace', fontSize: '12px', color: '#77c6a4', backgroundColor: '#0b0f12cc', padding: { x: 6, y: 3 } })
      .setScrollFactor(0).setDepth(100);
  }

  private refreshStats(): void {
    const p = getGame().player;
    this.statsText.setText(`HP ${p.hp} · 饥 ${p.hunger} · 渴 ${p.thirst} · 精 ${p.energy}`);
  }

  private buildInventoryPanel(): void {
    const { width, height } = this.cameras.main;
    const panelW = 380;
    const panelH = 320;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;

    const bg = this.add.graphics();
    bg.fillStyle(0x0b0f12, 0.96);
    bg.fillRoundedRect(left, top, panelW, panelH, 8);
    bg.lineStyle(2, 0x77c6a4, 1);
    bg.strokeRoundedRect(left, top, panelW, panelH, 8);

    const title = this.add.text(cx, top + 18, '背包', { fontFamily: 'monospace', fontSize: '16px', color: '#f4b66a' }).setOrigin(0.5);
    this.invObjects.push(bg, title);

    const startY = top + 44;
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      const t = this.add.text(left + 20, startY + i * 18, '', { fontFamily: 'monospace', fontSize: '13px', color: '#ece8d8' });
      this.invSlotTexts.push(t);
      this.invObjects.push(t);
    }

    const footer = this.add.text(cx, top + panelH - 16, '↑/↓ 选择 · Enter 使用 · I 关闭', { fontFamily: 'monospace', fontSize: '11px', color: '#77c6a4' }).setOrigin(0.5);
    this.invObjects.push(footer);

    for (const o of this.invObjects) o.setScrollFactor(0).setDepth(200).setVisible(false);
  }

  private refreshInventory(): void {
    const slots = getGame().player.inventory.slots;
    if (this.invSelected >= slots.length) this.invSelected = Math.max(0, slots.length - 1);
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      const t = this.invSlotTexts[i];
      const stack = slots[i];
      if (stack) {
        const cursor = i === this.invSelected ? '▶ ' : '  ';
        t.setText(`${cursor}${getItem(stack.itemId).displayName} ×${stack.quantity}`);
      } else {
        t.setText('  （空）');
      }
    }
  }

  private toggleInventory(): void {
    this.inventoryOpen = !this.inventoryOpen;
    for (const o of this.invObjects) o.setVisible(this.inventoryOpen);
    if (this.inventoryOpen) {
      this.invSelected = 0;
      this.refreshInventory();
    }
  }

  private flash(msg: string): void {
    this.feedbackText.setText(msg);
    this.feedbackTimer?.remove(false);
    this.feedbackTimer = this.time.delayedCall(1600, () => this.feedbackText.setText(''));
  }

  // ── input ──────────────────────────────────────────────────────────────
  private bindInput(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    this.cursors = keyboard.createCursorKeys();
    this.wasd = keyboard.addKeys({ left: 'A', right: 'D' }) as typeof this.wasd;
    this.keyE = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.keyEsc = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.keyI = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.I);
    this.keyEnter = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    keyboard.addCapture([Phaser.Input.Keyboard.KeyCodes.LEFT, Phaser.Input.Keyboard.KeyCodes.RIGHT]);

    this.keyE.on('down', this.onInteract, this);
    this.keyEsc.on('down', this.onEsc, this);
    this.keyI.on('down', this.onToggleInventory, this);
    this.keyEnter.on('down', this.onUse, this);
    this.cursors.up.on('down', this.onNavUp, this);
    this.cursors.down.on('down', this.onNavDown, this);
  }

  private unbindInput(): void {
    this.keyE?.off('down', this.onInteract, this);
    this.keyEsc?.off('down', this.onEsc, this);
    this.keyI?.off('down', this.onToggleInventory, this);
    this.keyEnter?.off('down', this.onUse, this);
    this.cursors?.up.off('down', this.onNavUp, this);
    this.cursors?.down.off('down', this.onNavDown, this);
  }

  private onToggleInventory(): void {
    this.toggleInventory();
  }

  private onEsc(): void {
    if (this.inventoryOpen) this.toggleInventory();
    else this.scene.start('Menu');
  }

  private onNavUp(): void {
    if (!this.inventoryOpen) return;
    this.invSelected = Math.max(0, this.invSelected - 1);
    this.refreshInventory();
  }

  private onNavDown(): void {
    if (!this.inventoryOpen) return;
    const count = getGame().player.inventory.slots.length;
    this.invSelected = Math.min(Math.max(0, count - 1), this.invSelected + 1);
    this.refreshInventory();
  }

  private onUse(): void {
    if (!this.inventoryOpen) return;
    const stack = getGame().player.inventory.slots[this.invSelected];
    if (!stack) return;
    const result = useConsumable(getGame(), stack.itemId);
    if (result.ok) {
      saveToStorage(getGame());
      this.refreshInventory();
      this.refreshStats();
      this.flash(`使用 ${getItem(stack.itemId).displayName} · ${STAT_LABEL[result.stat!]} +${result.amount}`);
    } else {
      this.flash(result.reason ?? '无法使用');
    }
  }

  private onInteract(): void {
    if (this.inventoryOpen) return;
    const state = getGame();
    const container = this.nearestContainer();
    if (container) {
      this.openContainer(container.id);
      return;
    }
    const zone = currentInteractionZone(state);
    if (zone === 'up') this.changeFloor(1);
    else if (zone === 'down') this.changeFloor(-1);
  }

  private nearestContainer(): GeneratedContainer | null {
    const px = getGame().player.x;
    let best: GeneratedContainer | null = null;
    let bestDist = INTERACT_DISTANCE;
    for (const c of this.floorView.containers) {
      if (c.items.length === 0) continue;
      const d = Math.abs(c.x - px);
      if (d <= bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  }

  private openContainer(containerId: string): void {
    const state = getGame();
    const floor = state.currentFloor;
    const label = this.floorView.containers.find((c) => c.id === containerId)?.label ?? containerId;
    const result = lootContainer(state, floor, containerId);
    saveToStorage(state);
    this.floorView = getFloorView(state, floor);
    this.setContainerEmptyVisual(containerId, (this.floorView.containers.find((c) => c.id === containerId)?.items.length ?? 0) === 0);
    this.refreshInventory();

    if (result.took.length === 0 && !result.full) this.flash(`${label} 是空的`);
    else if (result.full) this.flash('背包已满，剩余留在容器');
    else this.flash(`获得 ${result.took.map((s) => `${getItem(s.itemId).displayName}×${s.quantity}`).join('、')}`);
  }

  private autoPickup(): void {
    const state = getGame();
    for (const g of [...this.floorView.groundItems]) {
      if (Math.abs(g.x - state.player.x) > 12) continue;
      const r = lootGround(state, state.currentFloor, g.key);
      if (r.took) {
        this.groundObjs.get(g.key)?.destroy();
        this.groundObjs.delete(g.key);
        this.floorView = getFloorView(state, state.currentFloor);
        this.refreshInventory();
        saveToStorage(state);
        this.flash(`拾取 ${getItem(r.took.itemId).displayName}×${r.took.quantity}`);
      } else if (r.full) {
        this.flash('背包已满');
      }
    }
  }

  private changeFloor(direction: 1 | -1): void {
    const result = tryChangeFloor(getGame(), direction);
    if (result.ok) {
      saveToStorage(getGame());
      this.scene.restart();
    } else {
      this.flash(result.reason === 'top' ? '已到顶层' : '已到尽头');
    }
  }

  // ── frame ──────────────────────────────────────────────────────────────
  override update(_time: number, delta: number): void {
    if (this.inventoryOpen) return;
    const state = getGame();
    const dt = delta / 1000;

    let dir = 0;
    if (this.cursors?.left.isDown || this.wasd?.left.isDown) dir -= 1;
    if (this.cursors?.right.isDown || this.wasd?.right.isDown) dir += 1;
    if (dir !== 0) {
      movePlayerX(state, dir * PLAYER_SPEED * dt);
      this.player.x = state.player.x;
    }

    this.autoPickup();

    const container = this.nearestContainer();
    const zone = currentInteractionZone(state);
    if (container) this.hintText.setText(`按 E 打开 ${container.label}`);
    else if (zone === 'up') this.hintText.setText('按 E 上楼');
    else if (zone === 'down') this.hintText.setText('按 E 下楼');
    else this.hintText.setText('A/D 或 ←/→ 移动 · E 交互 · I 背包 · ESC 菜单');
  }
}
