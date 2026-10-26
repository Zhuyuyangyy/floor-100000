import Phaser from 'phaser';
import { getGame, startNewGame } from '../core/session';
import {
  BED_X,
  CRAFT_X,
  DOWN_EXIT_X,
  FLOOR_HEIGHT,
  FLOOR_WIDTH,
  INTERACT_DISTANCE,
  PLAYER_SPEED,
  ROOM_COUNT,
  ROOM_WIDTH,
  STARTING_FLOOR,
  UP_EXIT_X,
  WANDERER_DAMAGE,
  WANDERER_HIT_COOLDOWN_MS,
  WANDERER_SPEED,
} from '../core/constants';
import { currentInteractionZone, floorName, hasDownExit, hasUpExit, movePlayerX, tryChangeFloor } from '../systems/FloorSystem';
import { getFloorView, lootContainer, lootGround } from '../systems/LootSystem';
import { countItem, useConsumable } from '../systems/InventorySystem';
import { canCraft, craft, hasUpgrade, nightOverlayAlpha, purifyWater } from '../systems/CraftingSystem';
import { absoluteMinute, advanceTime, AUTOSAVE_EVERY_GAME_MINUTES, formatClock, isNight, sleep } from '../systems/SurvivalSystem';
import { ensureNightEvent } from '../systems/EventSystem';
import { clearSave, saveToStorage } from '../systems/SaveSystem';
import { playSfx } from '../render/audio';
import { buildPanel, type PanelObject } from '../render/panels';
import { getItem } from '../data/items';
import { RECIPES, getRecipe, type UpgradeId } from '../data/recipes';
import { NPCS, NPC_FLOOR, getNpc, type NpcDef, type NpcId } from '../data/npcs';
import { trade } from '../systems/TradeSystem';
import type { ActiveEvent, GameState, GeneratedContainer, GeneratedFloor, ItemId, StatKey } from '../core/gameTypes';

const STAT_LABEL: Record<StatKey, string> = { hp: '生命', hunger: '饱食', thirst: '水分', energy: '精力' };
const INVENTORY_SLOTS = 12;
const STAT_BARS: Array<{ label: string; color: number }> = [
  { label: 'HP', color: 0xe56d63 },
  { label: '饥', color: 0xf4b66a },
  { label: '渴', color: 0x6aa8e5 },
  { label: '精', color: 0x77c6a4 },
];
const PAUSE_OPTIONS = ['继续游戏', '重新开始', '返回标题'];
type DirKeys = {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
};

// Playable floor view (P0-02 + P0-03): scrolling corridor, movable character,
// up/down exits, lootable containers & ground items, a 12-slot inventory, and
// consumable use. GameState (session) is the source of truth; this scene only
// renders and feeds input back through pure logic functions.
export class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private cursors!: DirKeys;
  private wasd!: { left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key };
  private keyE!: Phaser.Input.Keyboard.Key;
  private keyEsc!: Phaser.Input.Keyboard.Key;
  private keyI!: Phaser.Input.Keyboard.Key;
  private keyEnter!: Phaser.Input.Keyboard.Key;

  private floorView!: GeneratedFloor;
  private containerObjs = new Map<string, { box: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text }>();
  private groundObjs = new Map<string, Phaser.GameObjects.Rectangle>();
  private floorObjects: Phaser.GameObjects.GameObject[] = [];
  private wanderer?: Phaser.GameObjects.Sprite;
  private wandererHitAt = Number.NEGATIVE_INFINITY;

  private clockText!: Phaser.GameObjects.Text;
  private barsGfx!: Phaser.GameObjects.Graphics;
  private statLabels: Phaser.GameObjects.Text[] = [];
  private tooltipText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private feedbackText!: Phaser.GameObjects.Text;
  private feedbackTimer?: Phaser.Time.TimerEvent;
  private lastClock = '';
  private lastStats = '';

  private invObjects: PanelObject[] = [];
  private invSlotTexts: Phaser.GameObjects.Text[] = [];
  private invSelected = 0;
  private inventoryOpen = false;

  private craftingOpen = false;
  private craftObjects: PanelObject[] = [];
  private craftEntryTexts: Phaser.GameObjects.Text[] = [];
  private craftSelected = 0;
  private nightOverlay!: Phaser.GameObjects.Rectangle;
  private upgradeBoard!: Phaser.GameObjects.Text;
  private keyC!: Phaser.Input.Keyboard.Key;

  private dialogueOpen = false;
  private dialogue: { npc: NpcId; level: 'main' | 'trade'; selected: number; message: string; lineToggle: number } | null = null;
  private dialogueObjects: PanelObject[] = [];
  private dialogueTitle!: Phaser.GameObjects.Text;
  private dialogueMessage!: Phaser.GameObjects.Text;
  private dialogueOptions: Phaser.GameObjects.Text[] = [];

  private pauseOpen = false;
  private pauseObjects: PanelObject[] = [];
  private pauseOptionTexts: Phaser.GameObjects.Text[] = [];
  private pauseSelected = 0;
  private lastSavedAbsoluteMinute = Number.NEGATIVE_INFINITY;
  private lastActiveEvent: ActiveEvent | null = null;

  constructor() {
    super({ key: 'Game' });
  }

  create(): void {
    // Phaser does not re-run field initialisers on scene restart, so reset the
    // autosave cursor here — otherwise 重新开始 inherits the previous run's
    // value and the fresh run's clock looks like it has not moved yet.
    this.lastSavedAbsoluteMinute = Number.NEGATIVE_INFINITY;
    this.lastActiveEvent = null;

    this.cameras.main.setBackgroundColor(0x22303a);
    this.cameras.main.setBounds(0, 0, FLOOR_WIDTH, FLOOR_HEIGHT);
    this.nightOverlay = this.add
      .rectangle(FLOOR_WIDTH / 2, FLOOR_HEIGHT / 2, FLOOR_WIDTH, FLOOR_HEIGHT, 0x05070a, 0)
      .setName('night-overlay');

    this.drawFloor();

    this.buildHud();
    this.buildInventoryPanel();
    this.buildCraftPanel();
    this.buildDialoguePanel();
    this.buildPausePanel();
    this.bindInput();

    if (getGame().day === 1) {
      this.flash('目标：活到第 8 天 06:00。A/D 移动 · E 交互 · I 背包 · C 制作');
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // cameras.main can be null during teardown (Phaser 4 shutdown gotcha).
      this.cameras.main?.stopFollow();
      this.feedbackTimer?.remove(false);
      this.unbindInput();
    });
  }

  // Floor content is rebuilt in place on floor changes. We avoid scene.restart():
  // its teardown leaves the hidden UI panel text objects with null texture frames
  // in Phaser 4, so setText on them throws once the scene is recreated.
  private drawFloor(): void {
    const state = getGame();
    const floor = state.currentFloor;
    this.floorView = getFloorView(state, floor);

    this.drawCorridor(floor);
    this.drawExits(floor);
    this.buildContainers();
    this.buildGround();
    if (floor === STARTING_FLOOR) {
      this.drawBed();
      this.drawWorkbench();
    }
    if (floor === NPC_FLOOR) this.drawNpcs();

    this.player = this.add.sprite(state.player.x, FLOOR_HEIGHT - 40, 'player').setOrigin(0.5, 1);
    this.floorObjects.push(this.player);
    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);
  }

  private clearFloor(): void {
    this.cameras.main.stopFollow();
    for (const o of this.floorObjects) o.destroy();
    this.floorObjects = [];
    this.containerObjs.clear();
    this.groundObjs.clear();
    this.wanderer?.destroy();
    this.wanderer = undefined;
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
    this.floorObjects.push(g);
  }

  private drawExits(floor: number): void {
    if (hasUpExit(floor)) {
      const g = this.add.graphics();
      g.fillStyle(0x77c6a4, 1);
      g.fillRect(UP_EXIT_X - 12, FLOOR_HEIGHT - 96, 24, 48);
      const upLabel = this.add.text(UP_EXIT_X, FLOOR_HEIGHT - 104, '↑ 上楼', { fontFamily: 'monospace', fontSize: '12px', color: '#77c6a4' }).setOrigin(0.5);
      this.floorObjects.push(g, upLabel);
    }
    if (hasDownExit(floor)) {
      const g = this.add.graphics();
      g.fillStyle(0xf4b66a, 1);
      g.fillRect(DOWN_EXIT_X - 12, FLOOR_HEIGHT - 96, 24, 48);
      const downLabel = this.add.text(DOWN_EXIT_X, FLOOR_HEIGHT - 104, '↓ 下楼', { fontFamily: 'monospace', fontSize: '12px', color: '#f4b66a' }).setOrigin(0.5);
      this.floorObjects.push(g, downLabel);
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
      this.floorObjects.push(box, label);
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
      this.floorObjects.push(rect);
    }
  }

  // Ground rectangles are built once per floor visit, so a view change has to
  // rebuild them: otherwise a leak leaves unpickable graphics on the floor, and
  // the supplies stay missing after it clears until the player re-enters.
  private rebuildGround(): void {
    const stale: Phaser.GameObjects.GameObject[] = [...this.groundObjs.values()];
    for (const rect of this.groundObjs.values()) rect.destroy();
    if (stale.length > 0) this.floorObjects = this.floorObjects.filter((o) => !stale.includes(o));
    this.groundObjs.clear();
    this.buildGround();
  }

  private drawBed(): void {
    const y = FLOOR_HEIGHT - 64;
    const g = this.add.graphics();
    g.fillStyle(0x6a4a3a, 1);
    g.fillRect(BED_X - 20, y - 12, 40, 28);
    g.fillStyle(0xece8d8, 1);
    g.fillRect(BED_X - 16, y - 10, 14, 10);
    const bedLabel = this.add.text(BED_X, y - 24, '床（睡觉）', { fontFamily: 'monospace', fontSize: '11px', color: '#ece8d8' }).setOrigin(0.5);
    this.floorObjects.push(g, bedLabel);
  }

  // ── HUD & inventory UI ─────────────────────────────────────────────────
  private buildHud(): void {
    this.clockText = this.add
      .text(12, 12, '', { fontFamily: 'monospace', fontSize: '16px', color: '#ece8d8', backgroundColor: '#0b0f12cc', padding: { x: 6, y: 4 } })
      .setScrollFactor(0).setDepth(100);
    this.refreshClock();

    this.barsGfx = this.add.graphics().setScrollFactor(0).setDepth(100);
    STAT_BARS.forEach((s, i) => {
      this.statLabels.push(
        this.add.text(12, 40 + i * 13, s.label, { fontFamily: 'monospace', fontSize: '10px', color: '#ece8d8' }).setScrollFactor(0).setDepth(101),
      );
    });
    this.refreshStats();

    this.feedbackText = this.add
      .text(FLOOR_WIDTH / 2, 60, '', { fontFamily: 'monospace', fontSize: '13px', color: '#f4b66a', backgroundColor: '#0b0f12cc', padding: { x: 8, y: 4 } })
      .setOrigin(0.5).setScrollFactor(0).setDepth(120);

    this.hintText = this.add
      .text(12, FLOOR_HEIGHT - 22, 'A/D 或 ←/→ 移动 · E 交互 · I 背包 · ESC 菜单', { fontFamily: 'monospace', fontSize: '12px', color: '#77c6a4', backgroundColor: '#0b0f12cc', padding: { x: 6, y: 3 } })
      .setScrollFactor(0).setDepth(100);
  }

  private refreshClock(): void {
    const s = getGame();
    const label = `第 ${s.day} 天 ${formatClock(s.gameMinuteOfDay)} · ${s.currentFloor} 层 ${floorName(s.currentFloor)}`;
    if (label !== this.lastClock) {
      this.lastClock = label;
      this.clockText.setText(label);
    }
  }

  private refreshStats(): void {
    const p = getGame().player;
    const values = [p.hp, p.hunger, p.thirst, p.energy];
    const key = values.map((v) => Math.round(v)).join(',');
    if (key === this.lastStats) return;
    this.lastStats = key;
    this.barsGfx.clear();
    values.forEach((v, i) => {
      const y = 40 + i * 13;
      this.barsGfx.fillStyle(0x0b0f12, 0.7);
      this.barsGfx.fillRect(34, y + 2, 84, 7);
      this.barsGfx.fillStyle(STAT_BARS[i].color, 1);
      this.barsGfx.fillRect(34, y + 2, 84 * Math.max(0, Math.min(1, v / 100)), 7);
    });
  }

  private buildInventoryPanel(): void {
    const { width, height } = this.cameras.main;
    const panelW = 380;
    const panelH = 320;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;

    this.invObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'green'));

    const title = this.add.text(cx, top + 18, '背包', { fontFamily: 'monospace', fontSize: '16px', color: '#f4b66a' }).setOrigin(0.5);
    this.invObjects.push(title);

    const startY = top + 44;
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      const t = this.add.text(left + 20, startY + i * 18, '', { fontFamily: 'monospace', fontSize: '13px', color: '#ece8d8' });
      this.invSlotTexts.push(t);
      this.invObjects.push(t);
    }

    this.tooltipText = this.add.text(left + 20, top + 266, '', { fontFamily: 'monospace', fontSize: '12px', color: '#f4b66a' });
    this.invObjects.push(this.tooltipText);

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
    const selected = slots[this.invSelected];
    if (selected) {
      const item = getItem(selected.itemId);
      const category = item.category === 'consumable' ? '消耗品' : item.category === 'material' ? '材料' : '工具';
      const effect = item.effect ? ` · ${STAT_LABEL[item.effect.stat]} +${item.effect.amount}` : '';
      this.tooltipText.setText(`${item.displayName} · ${category}${effect}`);
    } else {
      this.tooltipText.setText('');
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

  private applyNightLighting(): void {
    this.nightOverlay.setAlpha(nightOverlayAlpha(getGame()));
  }

  private nearCraftStation(state: GameState): boolean {
    return state.currentFloor === STARTING_FLOOR && Math.abs(state.player.x - CRAFT_X) <= INTERACT_DISTANCE;
  }

  private drawWorkbench(): void {
    const y = FLOOR_HEIGHT - 64;
    const g = this.add.graphics();
    g.fillStyle(0x3a4c58, 1);
    g.fillRect(CRAFT_X - 18, y - 14, 36, 30);
    g.fillStyle(0x465865, 1);
    g.fillRect(CRAFT_X - 18, y - 14, 36, 4);
    const benchLabel = this.add.text(CRAFT_X, y - 26, '工作台', { fontFamily: 'monospace', fontSize: '11px', color: '#ece8d8' }).setOrigin(0.5);
    this.upgradeBoard = this.add.text(CRAFT_X, y + 34, '', { fontFamily: 'monospace', fontSize: '11px', color: '#77c6a4' }).setOrigin(0.5);
    this.floorObjects.push(g, benchLabel, this.upgradeBoard);
    this.refreshUpgradeBoard();
  }

  private refreshUpgradeBoard(): void {
    if (!this.upgradeBoard) return;
    const built = getGame().player.homeUpgrades.map((id) => getRecipe(id as UpgradeId).displayName);
    this.upgradeBoard.setText(built.length > 0 ? `已建：${built.join('、')}` : '');
  }

  private buildCraftPanel(): void {
    const { width, height } = this.cameras.main;
    const panelW = 460;
    const panelH = 300;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;

    this.craftObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'yellow'));
    const title = this.add.text(cx, top + 18, '工作台 · 制作', { fontFamily: 'monospace', fontSize: '16px', color: '#f4b66a' }).setOrigin(0.5);
    this.craftObjects.push(title);

    for (let i = 0; i < 4; i++) {
      const t = this.add.text(left + 18, top + 48 + i * 24, '', { fontFamily: 'monospace', fontSize: '13px', color: '#ece8d8' });
      this.craftEntryTexts.push(t);
      this.craftObjects.push(t);
    }
    const footer = this.add.text(cx, top + panelH - 16, '↑/↓ 选择 · Enter 制作 · C 关闭', { fontFamily: 'monospace', fontSize: '11px', color: '#77c6a4' }).setOrigin(0.5);
    this.craftObjects.push(footer);

    for (const o of this.craftObjects) o.setScrollFactor(0).setDepth(210).setVisible(false);
  }

  private craftEntries(): Array<{ kind: 'recipe' | 'purify'; id?: UpgradeId }> {
    const entries: Array<{ kind: 'recipe' | 'purify'; id?: UpgradeId }> = RECIPES.map((r) => ({ kind: 'recipe', id: r.id }));
    if (hasUpgrade(getGame(), 'purifier')) entries.push({ kind: 'purify' });
    return entries;
  }

  private refreshCraft(): void {
    const state = getGame();
    const entries = this.craftEntries();
    if (this.craftSelected >= entries.length) this.craftSelected = Math.max(0, entries.length - 1);
    for (let i = 0; i < 4; i++) {
      const t = this.craftEntryTexts[i];
      const entry = entries[i];
      if (!entry) {
        t.setText('');
        continue;
      }
      const cursor = i === this.craftSelected ? '▶ ' : '  ';
      if (entry.kind === 'recipe') {
        const recipe = getRecipe(entry.id!);
        const cost = Object.entries(recipe.cost).map(([id, n]) => `${getItem(id as ItemId).displayName}×${n}`).join(' ');
        const status = hasUpgrade(state, entry.id!) ? '[已建]' : canCraft(state, entry.id!).ok ? '[可制作]' : '[材料不足]';
        t.setText(`${cursor}${recipe.displayName}（${cost}）${status}`);
      } else {
        const can = countItem(state.player.inventory, 'dirty_water') >= 1;
        t.setText(`${cursor}净化 脏水→净水 ${can ? '[可净化]' : '[无脏水]'}`);
      }
    }
  }

  private toggleCrafting(): void {
    this.craftingOpen = !this.craftingOpen;
    for (const o of this.craftObjects) o.setVisible(this.craftingOpen);
    if (this.craftingOpen) {
      this.craftSelected = 0;
      this.refreshCraft();
    }
  }

  private buildPausePanel(): void {
    const { width, height } = this.cameras.main;
    const panelW = 380;
    const panelH = 220;
    const cx = width / 2;
    const cy = height / 2;
    const top = cy - panelH / 2;

    this.pauseObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'yellow'));
    const title = this.add.text(cx, top + 20, '已暂停', { fontFamily: 'monospace', fontSize: '16px', color: '#f4b66a' }).setOrigin(0.5);
    const controls = this.add.text(cx, top + 50, 'A/D 移动 · E 交互 · I 背包 · C 制作', { fontFamily: 'monospace', fontSize: '11px', color: '#77c6a4' }).setOrigin(0.5);
    this.pauseObjects.push(title, controls);

    PAUSE_OPTIONS.forEach((label, i) => {
      const t = this.add.text(cx, top + 92 + i * 28, label, { fontFamily: 'monospace', fontSize: '15px', color: '#ece8d8' }).setOrigin(0.5);
      this.pauseOptionTexts.push(t);
      this.pauseObjects.push(t);
    });

    for (const o of this.pauseObjects) o.setScrollFactor(0).setDepth(230).setVisible(false);
  }

  private refreshPause(): void {
    this.pauseOptionTexts.forEach((t, i) => t.setText(`${i === this.pauseSelected ? '▶ ' : '  '}${PAUSE_OPTIONS[i]}`));
  }

  private togglePause(): void {
    this.pauseOpen = !this.pauseOpen;
    for (const o of this.pauseObjects) o.setVisible(this.pauseOpen);
    if (this.pauseOpen) {
      this.pauseSelected = 0;
      this.refreshPause();
    }
  }

  private activatePause(): void {
    if (this.pauseSelected === 0) {
      this.togglePause(); // 继续游戏
    } else if (this.pauseSelected === 1) {
      clearSave();
      startNewGame(Date.now() >>> 0); // 重新开始
      this.scene.start('Game');
    } else {
      this.scene.start('Menu'); // 返回标题
    }
  }

  private onToggleCrafting(): void {
    if (this.inventoryOpen || this.dialogueOpen || this.pauseOpen) return;
    if (!this.craftingOpen && getGame().currentFloor !== STARTING_FLOOR) {
      this.flash('只能在宿舍工作台制作');
      return;
    }
    this.toggleCrafting();
  }

  private activateCraftEntry(): void {
    const state = getGame();
    const entry = this.craftEntries()[this.craftSelected];
    if (!entry) return;
    if (entry.kind === 'recipe') {
      const result = craft(state, entry.id!);
      if (result.ok) {
        saveToStorage(state);
        this.refreshCraft();
        this.refreshInventory();
        this.refreshUpgradeBoard();
        playSfx('craft');
        this.flash(`建造了 ${getRecipe(entry.id!).displayName}`);
      } else {
        this.flash(result.reason);
      }
    } else {
      const result = purifyWater(state);
      if (result.ok) {
        saveToStorage(state);
        this.refreshCraft();
        this.refreshInventory();
        playSfx('craft');
        this.flash('净化了 1 瓶净水');
      } else {
        this.flash(result.reason);
      }
    }
  }

  // ── NPCs & dialogue ─────────────────────────────────────────────────────
  private drawNpcs(): void {
    for (const npc of NPCS) {
      const key = npc.id === 'alin' ? 'npc_alin' : 'npc_xiaozhou';
      const sprite = this.add.sprite(npc.x, FLOOR_HEIGHT - 40, key).setOrigin(0.5, 1);
      const nameLabel = this.add.text(npc.x, FLOOR_HEIGHT - 68, npc.name, { fontFamily: 'monospace', fontSize: '11px', color: '#ece8d8' }).setOrigin(0.5);
      this.floorObjects.push(sprite, nameLabel);
    }
  }

  private nearestNpc(state: GameState): NpcDef | null {
    if (state.currentFloor !== NPC_FLOOR) return null;
    for (const npc of NPCS) {
      if (Math.abs(npc.x - state.player.x) <= INTERACT_DISTANCE) return npc;
    }
    return null;
  }

  private buildDialoguePanel(): void {
    const { width, height } = this.cameras.main;
    const panelW = 460;
    const panelH = 260;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;

    this.dialogueObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'green'));
    // Create with placeholder content so each text's canvas/frame exists up front
    // (setText on a never-rendered empty text throws in Phaser 4).
    this.dialogueTitle = this.add.text(cx, top + 20, '对话', { fontFamily: 'monospace', fontSize: '16px', color: '#f4b66a' }).setOrigin(0.5);
    this.dialogueMessage = this.add.text(cx, top + 58, '……', { fontFamily: 'monospace', fontSize: '13px', color: '#ece8d8', align: 'center' }).setOrigin(0.5);
    this.dialogueObjects.push(this.dialogueTitle, this.dialogueMessage);

    for (let i = 0; i < 4; i++) {
      const t = this.add.text(left + 20, top + 112 + i * 26, '……', { fontFamily: 'monospace', fontSize: '13px', color: '#ece8d8' });
      this.dialogueOptions.push(t);
      this.dialogueObjects.push(t);
    }
    const footer = this.add.text(cx, top + panelH - 14, '↑/↓ 选择 · Enter 确定 · ESC 返回', { fontFamily: 'monospace', fontSize: '11px', color: '#77c6a4' }).setOrigin(0.5);
    this.dialogueObjects.push(footer);

    for (const o of this.dialogueObjects) o.setScrollFactor(0).setDepth(220).setVisible(false);
  }

  private dialogueOptionLabels(): string[] {
    const d = this.dialogue;
    if (!d) return [];
    if (d.level === 'main') return ['问候', '询问', '交易', '退出'];
    const npc = getNpc(d.npc);
    return [
      ...npc.offers.map(
        (o) => `用 ${getItem(o.get.itemId).displayName}×${o.get.quantity} 换 ${getItem(o.give.itemId).displayName}×${o.give.quantity}`,
      ),
      '返回',
    ];
  }

  private openDialogue(npc: NpcDef): void {
    this.dialogue = { npc: npc.id, level: 'main', selected: 0, message: npc.greetings[0], lineToggle: 0 };
    this.dialogueOpen = true;
    for (const o of this.dialogueObjects) o.setVisible(true);
    this.refreshDialogue();
  }

  private closeDialogue(): void {
    this.dialogueOpen = false;
    this.dialogue = null;
    for (const o of this.dialogueObjects) o.setVisible(false);
  }

  private dialogueBack(): void {
    if (!this.dialogue) return;
    if (this.dialogue.level === 'trade') {
      this.dialogue.level = 'main';
      this.dialogue.selected = 0;
      this.dialogue.message = '';
      this.refreshDialogue();
    } else {
      this.closeDialogue();
    }
  }

  private refreshDialogue(): void {
    const d = this.dialogue;
    if (!d) return;
    const npc = getNpc(d.npc);
    this.dialogueTitle.setText(`${npc.name}（${npc.title}）`);
    this.dialogueMessage.setText(d.message || '……');
    const labels = this.dialogueOptionLabels();
    if (d.selected >= labels.length) d.selected = labels.length - 1;
    for (let i = 0; i < this.dialogueOptions.length; i++) {
      const label = labels[i];
      if (label === undefined) {
        this.dialogueOptions[i].setText('');
        continue;
      }
      this.dialogueOptions[i].setText(`${i === d.selected ? '▶ ' : '  '}${label}`);
    }
  }

  private activateDialogueOption(): void {
    const d = this.dialogue;
    if (!d) return;
    const npc = getNpc(d.npc);
    if (d.level === 'main') {
      switch (d.selected) {
        case 0:
          d.message = npc.greetings[d.lineToggle % npc.greetings.length];
          d.lineToggle++;
          break;
        case 1:
          d.message = npc.asks[d.lineToggle % npc.asks.length];
          d.lineToggle++;
          break;
        case 2:
          d.level = 'trade';
          d.selected = 0;
          d.message = '想换点什么？';
          break;
        default:
          this.closeDialogue();
          return;
      }
    } else if (d.selected < npc.offers.length) {
      const offer = npc.offers[d.selected];
      const result = trade(getGame(), offer);
      d.message = result.ok
        ? `换到了 ${getItem(offer.give.itemId).displayName}×${offer.give.quantity}`
        : result.reason;
      if (result.ok) {
        saveToStorage(getGame());
        this.refreshInventory();
        playSfx('trade');
      }
    } else {
      d.level = 'main';
      d.selected = 0;
      d.message = '';
    }
    this.refreshDialogue();
  }

  // ── input ──────────────────────────────────────────────────────────────
  private bindInput(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    this.cursors = keyboard.addKeys({ up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT' }) as DirKeys;
    this.wasd = keyboard.addKeys({ left: 'A', right: 'D' }) as typeof this.wasd;
    this.keyE = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.keyEsc = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.keyI = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.I);
    this.keyEnter = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    this.keyC = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C);

    this.keyE.on('down', this.onInteract, this);
    this.keyEsc.on('down', this.onEsc, this);
    this.keyI.on('down', this.onToggleInventory, this);
    this.keyEnter.on('down', this.onUse, this);
    this.keyC.on('down', this.onToggleCrafting, this);
    this.cursors.up.on('down', this.onNavUp, this);
    this.cursors.down.on('down', this.onNavDown, this);
  }

  private unbindInput(): void {
    this.keyE?.off('down', this.onInteract, this);
    this.keyEsc?.off('down', this.onEsc, this);
    this.keyI?.off('down', this.onToggleInventory, this);
    this.keyEnter?.off('down', this.onUse, this);
    this.keyC?.off('down', this.onToggleCrafting, this);
    this.cursors?.up.off('down', this.onNavUp, this);
    this.cursors?.down.off('down', this.onNavDown, this);
  }

  private onToggleInventory(): void {
    if (this.craftingOpen || this.dialogueOpen || this.pauseOpen) return;
    this.toggleInventory();
  }

  private onEsc(): void {
    if (this.inventoryOpen) this.toggleInventory();
    else if (this.craftingOpen) this.toggleCrafting();
    else if (this.dialogueOpen) this.dialogueBack();
    else this.togglePause();
  }

  private onNavUp(): void {
    if (this.inventoryOpen) {
      this.invSelected = Math.max(0, this.invSelected - 1);
      this.refreshInventory();
    } else if (this.craftingOpen) {
      this.craftSelected = Math.max(0, this.craftSelected - 1);
      this.refreshCraft();
    } else if (this.dialogueOpen && this.dialogue) {
      this.dialogue.selected = Math.max(0, this.dialogue.selected - 1);
      this.refreshDialogue();
    } else if (this.pauseOpen) {
      this.pauseSelected = Math.max(0, this.pauseSelected - 1);
      this.refreshPause();
    }
  }

  private onNavDown(): void {
    if (this.inventoryOpen) {
      const count = getGame().player.inventory.slots.length;
      this.invSelected = Math.min(Math.max(0, count - 1), this.invSelected + 1);
      this.refreshInventory();
    } else if (this.craftingOpen) {
      const count = this.craftEntries().length;
      this.craftSelected = Math.min(Math.max(0, count - 1), this.craftSelected + 1);
      this.refreshCraft();
    } else if (this.dialogueOpen && this.dialogue) {
      const count = this.dialogueOptionLabels().length;
      this.dialogue.selected = Math.min(Math.max(0, count - 1), this.dialogue.selected + 1);
      this.refreshDialogue();
    } else if (this.pauseOpen) {
      this.pauseSelected = Math.min(PAUSE_OPTIONS.length - 1, this.pauseSelected + 1);
      this.refreshPause();
    }
  }

  private onUse(): void {
    if (this.inventoryOpen) {
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
      return;
    }
    if (this.craftingOpen) {
      this.activateCraftEntry();
      return;
    }
    if (this.dialogueOpen) {
      this.activateDialogueOption();
      return;
    }
    if (this.pauseOpen) this.activatePause();
  }

  private onInteract(): void {
    if (this.inventoryOpen || this.craftingOpen || this.pauseOpen) return;
    if (this.dialogueOpen) {
      this.closeDialogue();
      return;
    }
    const state = getGame();
    const npc = this.nearestNpc(state);
    if (npc) {
      this.openDialogue(npc);
      return;
    }
    if (this.nearBed(state)) {
      this.attemptSleep();
      return;
    }
    const container = this.nearestContainer();
    if (container) {
      this.openContainer(container.id);
      return;
    }
    const zone = currentInteractionZone(state);
    if (zone === 'up') this.changeFloor(1);
    else if (zone === 'down') this.changeFloor(-1);
  }

  private nearBed(state: GameState): boolean {
    return state.currentFloor === STARTING_FLOOR && Math.abs(state.player.x - BED_X) <= INTERACT_DISTANCE;
  }

  private attemptSleep(): void {
    const state = getGame();
    const result = sleep(state);
    if (!result.ok) {
      this.flash(result.reason);
      return;
    }
    saveToStorage(state);
    playSfx('sleep');
    if (result.won) this.scene.start('End');
    else this.flash(`睡到第 ${result.newDay} 天 06:00`);
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
    else { playSfx('pickup'); this.flash(`获得 ${result.took.map((s) => `${getItem(s.itemId).displayName}×${s.quantity}`).join('、')}`); }
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
        playSfx('pickup');
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
      this.clearFloor();
      this.drawFloor();
      this.cameras.main.flash(180, 0, 0, 0); // transition through black
    } else {
      this.flash(result.reason === 'top' ? '已到顶层' : '已到尽头');
    }
  }

  // ── frame ──────────────────────────────────────────────────────────────
  override update(_time: number, delta: number): void {
    if (this.inventoryOpen || this.craftingOpen || this.dialogueOpen || this.pauseOpen) return;
    const state = getGame();

    let dir = 0;
    if (this.cursors?.left.isDown || this.wasd?.left.isDown) dir -= 1;
    if (this.cursors?.right.isDown || this.wasd?.right.isDown) dir += 1;
    if (dir !== 0) {
      movePlayerX(state, dir * PLAYER_SPEED * (delta / 1000));
      this.player.x = state.player.x;
    }

    const tick = advanceTime(state, delta);
    const rolled = ensureNightEvent(state);
    if (rolled.rolled && rolled.event) {
      if (rolled.event.type === 'wanderer') playSfx('danger');
      this.flash(rolled.event.message);
    }
    // Read after ensureNightEvent so an event rolled this very frame counts.
    const event = state.worldEvents.activeEvent;
    this.refreshClock();
    this.refreshStats();
    this.applyNightLighting();

    // GHI-03 M3: the clock and the survival decay only ever advance here, and
    // nothing else in this loop persisted them — standing still and closing the
    // tab rolled the run back to the last discrete action, and that could be
    // farmed to erase decay. Persist on a coarse game-minute cadence.
    const absolute = absoluteMinute(state);
    if (absolute - this.lastSavedAbsoluteMinute >= AUTOSAVE_EVERY_GAME_MINUTES) {
      this.lastSavedAbsoluteMinute = absolute;
      saveToStorage(state);
    }

    // GHI-03 M5: the night event can start or clear while the player stands on
    // the floor, but floorView was only rebuilt on entering a floor / opening a
    // container / a successful pickup — so a leak left stale ground rectangles
    // and stale pickability behind until the player left and came back.
    if (event !== this.lastActiveEvent) {
      this.lastActiveEvent = event;
      this.floorView = getFloorView(state, state.currentFloor);
      this.rebuildGround();
    }

    if (tick.died || tick.won) {
      saveToStorage(state);
      this.scene.start('End');
      return;
    }

    this.updateWanderer(delta);
    if (state.status !== 'playing') {
      saveToStorage(state);
      this.scene.start('End');
      return;
    }

    this.autoPickup();

    if (this.nearBed(state)) {
      this.hintText.setText('按 E 睡觉');
      return;
    }
    if (this.nearCraftStation(state)) {
      this.hintText.setText('按 C 制作');
      return;
    }
    if (this.nearestNpc(state)) {
      this.hintText.setText('按 E 对话');
      return;
    }
    if (event?.type === 'leak' && state.currentFloor === event.floor) {
      this.hintText.setText('此地漏水，地面物资受潮');
      return;
    }
    const container = this.nearestContainer();
    const zone = currentInteractionZone(state);
    if (container) this.hintText.setText(`按 E 打开 ${container.label}`);
    else if (zone === 'up') this.hintText.setText('按 E 上楼');
    else if (zone === 'down') this.hintText.setText('按 E 下楼');
    else this.hintText.setText('A/D 或 ←/→ 移动 · E 交互 · I 背包 · ESC 菜单');
  }

  // The wanderer only haunts its own floor at night; it is slower than the player
  // and chips HP on a cooldown, so outrunning it or leaving the floor always works.
  private updateWanderer(delta: number): void {
    const state = getGame();
    const event = state.worldEvents.activeEvent;
    const active = event?.type === 'wanderer' && isNight(state.gameMinuteOfDay) && state.currentFloor === event.floor;
    if (!active) {
      if (this.wanderer) {
        this.wanderer.destroy();
        this.wanderer = undefined;
      }
      return;
    }
    if (!this.wanderer) {
      const spawnX = state.player.x < FLOOR_WIDTH / 2 ? FLOOR_WIDTH - 48 : 48;
      this.wanderer = this.add.sprite(spawnX, FLOOR_HEIGHT - 40, 'wanderer').setOrigin(0.5, 1);
    }
    const dir = Math.sign(state.player.x - this.wanderer.x);
    if (dir !== 0) this.wanderer.x += dir * WANDERER_SPEED * (delta / 1000);
    if (Math.abs(this.wanderer.x - state.player.x) <= 12 && this.time.now - this.wandererHitAt >= WANDERER_HIT_COOLDOWN_MS) {
      this.wandererHitAt = this.time.now;
      state.player.hp = Math.max(0, state.player.hp - WANDERER_DAMAGE);
      this.refreshStats();
      playSfx('hurt');
      this.cameras.main.shake(160, 0.008);
      this.cameras.main.flash(140, 230, 109, 99); // red damage flash
      this.flash(`被巡游体击中！HP -${WANDERER_DAMAGE}，快回宿舍或换层！`);
      if (state.player.hp <= 0) state.status = 'lost';
    }
  }
}
