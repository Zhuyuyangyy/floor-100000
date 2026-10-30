import Phaser from 'phaser';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../core/design';
import { getGame, startNewGame } from '../core/session';
import {
  BED_X,
  CRAFT_X,
  DOWN_EXIT_X,
  ENTRY_X,
  FLOOR_BAND,
  FLOOR_HEIGHT,
  FLOOR_WIDTH,
  INTERACT_DISTANCE,
  PLAYABLE_FLOORS_V01,
  PLAYER_FEET_Y,
  PLAYER_SPEED,
  ROOM_COUNT,
  ROOM_WIDTH,
  STARTING_FLOOR,
  UP_EXIT_X,
  WANDERER_DAMAGE,
  WANDERER_HIT_COOLDOWN_MS,
  WANDERER_SPEED,
} from '../core/constants';
import {
  currentInteractionZone,
  hasDownExit,
  hasUpExit,
  movePlayerX,
  stepHorizontalSpeed,
  tryChangeFloor,
} from '../systems/FloorSystem';
import { getFloorView, lootContainer, lootGround, recordFloorVisit } from '../systems/LootSystem';
import { countItem, isBagFull, STAT_LABEL, useConsumable } from '../systems/InventorySystem';
import { canCraft, craft, hasUpgrade, nightOverlayAlpha, purifyWater } from '../systems/CraftingSystem';
import { absoluteMinute, advanceTime, ACTION_COSTS, AUTOSAVE_EVERY_GAME_MINUTES, formatClock, isNight, sleep, spendTime } from '../systems/SurvivalSystem';
import { ensureNightEvent } from '../systems/EventSystem';
import { armNextRoll, dwellRollDue, ensureDwell, isDwellExempt, rollDwellEvent, tickDwell } from '../systems/dwellPressure';
import { freshWandererAI, stepWandererAI, type WandererAI } from '../systems/wandererAI';
import { ensureDailyGoal, grantDailyGoalReward, isDailyGoalDone } from '../systems/dailyGoals';
import { recordDepth, runScore } from '../systems/progress';
import { CHARACTER_NAMES, applyDepth, loadMeta, saveMeta, unlockFromDepth } from '../systems/metaProgress';
import type { CharacterKey } from '../render/artpack';
import { lowHpPulse, mostUrgentStat, moveSpeedFactor } from '../render/feedback';
import { GAME_CONFIG } from '../core/config';
import {
  markResolved,
  resolveEncounter,
  rollEncounter as rollFloorEncounter,
  shouldSkip,
  isCombatKind,
  combatIntroMessage,
  type Encounter,
  type EncounterChoice,
} from '../systems/encounters';
import { encounterSpots, nudgeSpotX, placeClearX } from '../systems/encounterSpots';
import { resolveRound, playerCombatant, GUARD_ENERGY_RESTORE, type Combatant } from '../systems/combat';
import { MONSTERS, applyBehavior, behaviorModifiers, rollMonster } from '../systems/monsters';
import { guardianDamageMult, lootBonus, moveSpeedMult } from '../systems/relics';
import { modeGuardianDamageMult } from '../systems/modes';
import { buy, sell, shopStock, type ShopEntry } from '../systems/shop';
import { charge, recordShortcut, shortcutAvailable, shortcutPrice, shortcutSkip, timesTaken } from '../systems/shortcut';
import { deriveSeed, makeRng } from '../core/rng';
import { addItem } from '../systems/InventorySystem';
import { clearSave, saveFailureCount, saveToStorage } from '../systems/SaveSystem';
import { playSfx } from '../render/audio';
import { applyPanelDepth, buildPanel, createMarker, HUD_FEEDBACK_DEPTH, PANEL_DEPTH, placeMarker, placeMarkerLeftOf, type PanelObject } from '../render/panels';
import {
  HUD_BAR_H,
  HUD_FOOT_H,
  STAT_COLORS,
  TYPE,
  UI,
  buildListRow,
  buildPanelHeader,
  buildPanelWell,
  drawStatBar,
} from '../render/uiKit';
import { ENV_FLOOR_KEY, ENV_WALL_KEY } from '../render/artpack';
import { WALK_CHARACTERS, attackAnimKey, hurtAnimKey, idleAnimKey, searchAnimKey, walkAnimKey, walkSheetKey } from '../render/walkcycle';
import { itemIconKey } from '../render/itemIcons';
import { containerTextureKey } from '../render/furniture';
import { corridorTint, drawCorridorRoom } from '../render/corridors';
import { addGlow, ambienceFor, buildLightLayer, type LightLayer } from '../render/lighting';
import {
  addContactShadow,
  buildCeilingLights,
  buildFloorClutter,
  buildForeground,
  buildRoomDepth,
  buildSurfaceDetail,
  buildAerialHaze,
  buildWallDressing,
} from '../render/roomDepth';
import { getItem } from '../data/items';
import { RECIPES, getRecipe, type UpgradeId } from '../data/recipes';
import { NPCS, NPC_FLOOR, getNpc, type NpcDef, type NpcId } from '../data/npcs';
import { trade } from '../systems/TradeSystem';
import type { ActiveEvent, GameState, GeneratedContainer, GeneratedFloor, ItemId } from '../core/gameTypes';

const INVENTORY_SLOTS = 12;
// Row pitch for the inventory list: 20px fits a full-size 16x16 icon with a 2px
// gap either side, and keeps every offset an integer (no scaling, no blur).
// Crafting rows: same 16px icon, 24px pitch keeps the cost text readable.
const CRAFT_ROW_PITCH = 24;
// HUD type scale (docs/05_ART_GUIDE.md §2: no size too small to read). Title 16 /
// body 13 / auxiliary 11 — all integer pixels, since any fractional size would be
// resampled and blur the pixel look.
const TYPE_BODY = 13;
const TYPE_AUX = 11;

// Row pitch for the four HUD stat bars. 15px gives an 11px label plus a 7px bar
// with breathing room; 13px was too cramped to read at a glance.

const STAT_BARS: Array<{ key: 'hp' | 'hunger' | 'thirst' | 'energy'; label: string; color: number }> = [
  { key: 'hp', label: 'HP', color: 0xe56d63 },
  { key: 'hunger', label: '饥', color: 0xf4b66a },
  { key: 'thirst', label: '渴', color: 0x6aa8e5 },
  { key: 'energy', label: '精', color: 0x77c6a4 },
];

// ── HUD layout (OVERHAUL UI) ────────────────────────────────────────────────
// Columns on the shared 4px grid: floor badge, clock, four stat bars (label +
// bar each), then the right-aligned score and gold. These are computed once
// here rather than sprinkled through buildHud, so moving a column is one edit.
const HUD_STAT_X = 100;
const HUD_STAT_PITCH = 84;
const HUD_STAT_BAR_W = 52;
const PAUSE_OPTIONS = ['继续游戏', '塔楼地图', '重新开始', '返回标题'];

// OVERHAUL: the daily objective's one-line label, per goal kind.
const GOAL_LABELS: Record<'water' | 'containers' | 'upgrade' | 'floor', (target: number) => string> = {
  water: (n) => `带回 ${n} 瓶净水`,
  containers: (n) => `搜刮 ${n} 个容器`,
  upgrade: (n) => `建成 ${n} 项宿舍升级`,
  floor: (n) => `到达第 ${n} 层`,
};

// OVERHAUL: the encounter panel's vocabulary. Titles are the kind's name as the
// player should read it; labels name the choices in the player's terms.
const ENCOUNTER_TITLES: Record<Encounter['kind'], string> = {
  loot: '一处遗落物资',
  ambush: '黑暗中的伏击',
  trader: '行商',
  note: '一张纸条',
  cache: '藏匿点',
  boss: '守门人',
};
const CHOICE_LABELS: Record<EncounterChoice, string> = {
  take: '拿走',
  fight: '动手',
  flee: '撤退',
  trade: '交易（脏水×2 → 净水×1）',
  leave: '离开',
  read: '读纸条',
};
type GameKey = 'e' | 'esc' | 'i' | 'enter' | 'c' | 'm' | 's' | 'f' | 'up' | 'down';
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
  private containerObjs = new Map<string, { box: Phaser.GameObjects.Graphics | Phaser.GameObjects.Image; label: Phaser.GameObjects.Text }>();
  private groundObjs = new Map<string, Phaser.GameObjects.Rectangle>();
  private floorObjects: Phaser.GameObjects.GameObject[] = [];
  private wanderer?: Phaser.GameObjects.Sprite;
  private wandererHitAt = Number.NEGATIVE_INFINITY;
  // OVERHAUL: the wanderer's stalk/lunge state machine. Lives beside the sprite
  // because the scene owns the movement it drives.
  private wandererAI?: WandererAI;
  // Not field-initialised-only: a scene restart re-runs create() but not the
  // class fields, so clearFloor() zeroes this too. Left over, a restarted floor
  // would resume the run already at top speed.
  private speedX = 0;
  // OVERHAUL: a one-shot action clip (search / attack / hurt) and the time it
  // holds the sprite. Without the hold, the walk/idle selection below would
  // switch back on the very next frame and the clip would never be seen.
  private actionAnimKey = '';
  private actionAnimUntil = 0;

  private clockText!: Phaser.GameObjects.Text;
  private barsGfx!: Phaser.GameObjects.Graphics;
  private statLabels: Phaser.GameObjects.Text[] = [];
  private invCountText?: Phaser.GameObjects.Text;
  private invCells: Phaser.GameObjects.Rectangle[] = [];
  private invDetailName?: Phaser.GameObjects.Text;
  private invDetailMeta?: Phaser.GameObjects.Text;
  private invDetailBody?: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private feedbackText!: Phaser.GameObjects.Text;
  // B3-02 §4.2: a full bag used to be a 1.6s flash, so a player who filled the
  // bag on floor 3 arrived on floor 4 with no reminder and lost the next
  // container's loot to what looked like a bug. This one stays until a slot
  // frees up, so the state is readable whenever the player looks.
  private bagFullText!: Phaser.GameObjects.Text;
  private bagFullShown = false;
  // OVERHAUL: the day's objective and the run's score, top-right; the low-HP
  // vignette is a full-screen rect whose alpha the feedback module drives.
  // Optional because buildHud destroys and clears them on a scene restart
  // before recreating them — a destroyed Text throws on setText.
  private floorBadge?: Phaser.GameObjects.Text;
  private goldText?: Phaser.GameObjects.Text;
  private goalText?: Phaser.GameObjects.Text;
  private scoreText?: Phaser.GameObjects.Text;
  private vignette?: Phaser.GameObjects.Rectangle;
  private lastGoalKey = '';
  // OVERHAUL: the floor's "?" spots and the encounter panel they open.
  private spotMarkers = new Map<string, { x: number; isBoss: boolean; dot: Phaser.GameObjects.Arc; label: Phaser.GameObjects.Text }>();
  private encounterOpen = false;
  private encounter?: { spotId: string; encounter: Encounter; choices: EncounterChoice[]; selected: number; resolved: boolean };
  private encounterObjects: Phaser.GameObjects.GameObject[] = [];
  // OVERHAUL Wave A: the live turn-based combat (state lives in
  // state.combat; this is only the panel's cursor).
  private combatSelected = 0;
  // True while the outcome screen is up (the fight is decided, one Enter left).
  private combatDone = false;
  // OVERHAUL Wave C1: the shop panel's cursor.
  private shopSelected = 0;
  private shopEntries: ShopEntry[] = [];
  private feedbackTimer?: Phaser.Time.TimerEvent;
  private lastClock = '';
  private lastStats = '';

  private invObjects: PanelObject[] = [];
  private invSlotTexts: Phaser.GameObjects.Text[] = [];
  private invSlotIcons: Phaser.GameObjects.Image[] = [];
  private invMarker!: Phaser.GameObjects.Image;
  private invSelected = 0;
  private inventoryOpen = false;

  private craftingOpen = false;
  private craftObjects: PanelObject[] = [];
  private craftRows: Array<{ band: Phaser.GameObjects.Rectangle; name: Phaser.GameObjects.Text; status: Phaser.GameObjects.Text }> = [];
  private craftMarker!: Phaser.GameObjects.Image;
  private craftSelected = 0;
  private nightOverlay!: Phaser.GameObjects.Rectangle;
  // OVERHAUL Art Pass: the floor's lighting layer (warm pools, cool ambient,
  // stepped vignette). Rebuilt per floor; destroyed with the floor.
  private lightLayer?: LightLayer;
  /** the player's contact shadow, moved with them every frame */
  private playerShadow: Phaser.GameObjects.GameObject[] = [];
  private upgradeBoard!: Phaser.GameObjects.Text;
  private keyC!: Phaser.Input.Keyboard.Key;
  private keyM!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyF!: Phaser.Input.Keyboard.Key;

  private dialogueOpen = false;
  private dialogue: { npc: NpcId; level: 'main' | 'trade'; selected: number; message: string; lineToggle: number } | null = null;
  private dialogueObjects: PanelObject[] = [];
  /** one selection band per dialogue row, toggled in refreshDialogue */
  private dialogueBands: Array<{ band: Phaser.GameObjects.Rectangle; rule: Phaser.GameObjects.Rectangle }> = [];
  private dialogueTitle!: Phaser.GameObjects.Text;
  private dialogueMessage!: Phaser.GameObjects.Text;
  private dialogueOptions: Phaser.GameObjects.Text[] = [];
  private dialogueOptionIcons: Phaser.GameObjects.Image[] = [];
  private dialogueMarker!: Phaser.GameObjects.Image;

  private pauseOpen = false;
  private pauseObjects: PanelObject[] = [];
  private pauseOptionTexts: Phaser.GameObjects.Text[] = [];
  private pauseMarker!: Phaser.GameObjects.Image;
  private pauseSelected = 0;
  private lastSavedAbsoluteMinute = Number.NEGATIVE_INFINITY;
  // B3-01 D9: last save-failure count we already warned about. Survives a scene
  // restart on purpose — the page's storage is still broken after 重新开始, so
  // warning again would be right, and the counter has not moved.
  private lastSaveFailures = 0;
  private lastActiveEvent: ActiveEvent | null = null;
  // Per-frame input guard (GHI-03 m9). Phaser can deliver one DOM keydown
  // several times inside a single frame when several keys land in the same queue
  // drain, so every menu action has to be accepted at most once per frame —
  // otherwise one ArrowDown moves the pause selection two entries and the
  // player lands on 重新开始 when they asked for 塔楼地图.
  private lastInputFrame: Record<GameKey, number> = { e: -1, esc: -1, i: -1, enter: -1, c: -1, m: -1, s: -1, f: -1, up: -1, down: -1 };

  constructor() {
    super({ key: 'Game' });
  }

  create(): void {
    // Phaser does not re-run field initialisers on scene restart, so reset the
    // autosave cursor here — otherwise 重新开始 inherits the previous run's
    // value and the fresh run's clock looks like it has not moved yet.
    this.lastSavedAbsoluteMinute = Number.NEGATIVE_INFINITY;
    this.lastActiveEvent = null;
    // The frame counter is monotonic across the session, so a stale slot would
    // never match anyway — reset to keep the per-create state honest.
    this.lastInputFrame = { e: -1, esc: -1, i: -1, enter: -1, c: -1, m: -1, s: -1, f: -1, up: -1, down: -1 };
    // Field initialisers do not re-run, so the HUD's cached visibility has to be
    // re-derived against the fresh bag of a restarted run.
    this.bagFullShown = false;

    // Every builder below only pushes into these, and field initialisers do not
    // re-run on scene restart. Without the reset, 重新开始 left them holding the
    // previous run's destroyed objects, so refreshInventory() / togglePause()
    // wrote to dead objects and both panels came up empty.
    this.floorObjects = [];
    this.containerObjs.clear();
    this.groundObjs.clear();
    this.invObjects = [];
    this.invSlotTexts = [];
    this.invSlotIcons = [];
    this.invMarker = createMarker(this);
    this.craftObjects = [];
    this.craftMarker = createMarker(this);
    this.pauseObjects = [];
    this.pauseOptionTexts = [];
    this.pauseMarker = createMarker(this);
    this.dialogueObjects = [];
    this.dialogueOptions = [];
    this.dialogueOptionIcons = [];
    this.dialogueMarker = createMarker(this);
    // 重新开始 runs while the pause menu is still open, and these flags survive a
    // restart. Left set, update() early-returns forever and every panel handler
    // refuses to run, so the restarted game looks frozen.
    this.inventoryOpen = false;
    this.invSelected = 0;
    this.craftingOpen = false;
    this.craftSelected = 0;
    this.dialogueOpen = false;
    this.dialogue = null;
    this.pauseOpen = false;
    this.pauseSelected = 0;
    this.wanderer = undefined;
    this.wandererHitAt = Number.NEGATIVE_INFINITY;
    this.lastClock = '';
    this.lastStats = '';

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
      this.flash('目标：从第 1 层一路爬到第 100000 层。A/D 移动 · E 交互 · I 背包 · C 制作 · M 地图');
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
    // Standing on a floor is what makes it explored (B3-02 §4.3). drawFloor is
    // the single place the player arrives — new game, continue, dev entry and
    // every stairwell — so recording here covers all of them at once.
    recordFloorVisit(state, floor);
    this.floorView = getFloorView(state, floor);

    if (floor === STARTING_FLOOR) {
      this.drawDormRoom();
    } else {
      this.drawCorridor(floor);
    }
    this.drawExits(floor);
    this.buildContainers();
    this.buildGround();
    if (floor === STARTING_FLOOR) {
      this.drawBed();
      this.drawWorkbench();
    }
    if (floor === NPC_FLOOR) this.drawNpcs();
    // OVERHAUL: the floor's question marks go up last, above the room.
    this.buildEncounterSpots();

    // The side-view walk sheet, not the front-facing portrait: the camera is a
    // side-scroller, and a figure seen face-on while it moves laterally reads as
    // a card sliding across the backdrop. The front-view art is the dialogue
    // portrait, where facing the player is the correct axis.
    // The side-view walk sheet, not the front-view portrait: the camera is a
    // side-scroller, and a figure seen face-on while it moves laterally reads as
    // a card sliding across the backdrop. The front-view art is the dialogue
    // portrait, where facing the player is the correct axis.
    //
    // OVERHAUL Wave B: the survivor is the one picked on the meta-select
    // screen, not always the player — the unlocked neighbours are the replay
    // engine's payload.
    const who = this.metaSelectedCharacter();
    // The contact shadow belongs to the player, so it is tracked and moved with
    // them every frame (see updatePlayerShadow). Without it the figure reads as
    // hovering: nothing in a side view is anchored to the floor without one.
    this.playerShadow = addContactShadow(this, state.player.x, PLAYER_FEET_Y + 2, 26, 2, 0.55);
    this.player = this.add.sprite(state.player.x, PLAYER_FEET_Y, walkSheetKey(who)).setOrigin(0.5, 1);
    this.player.play(idleAnimKey(who));
    this.floorObjects.push(this.player);
    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);
  }

  // OVERHAUL: plays a one-shot action clip and holds it for `ms`. The frame
  // loop's walk/idle pick stands down while the clip runs.
  private playActionAnim(key: string, ms: number): void {
    this.actionAnimKey = key;
    this.actionAnimUntil = this.time.now + ms;
    this.player.play(key, true);
  }

  private clearFloor(): void {
    this.cameras.main.stopFollow();
    for (const o of this.floorObjects) o.destroy();
    this.floorObjects = [];
    this.speedX = 0;
    this.containerObjs.clear();
    this.groundObjs.clear();
    this.wanderer?.destroy();
    this.wanderer = undefined;
    this.wandererAI = undefined;
    this.clearEncounterSpots();
  }

  // The survivor picked on the meta-select screen, as a walk-sheet key. Falls
  // back to the player when the meta is missing or holds a stale selection.
  private metaSelectedCharacter(): CharacterKey {
  try {
    const meta = loadMeta();
    return (WALK_CHARACTERS.includes(meta.selectedCharacter as CharacterKey)
      ? meta.selectedCharacter
      : 'player') as CharacterKey;
  } catch {
    return 'player';
  }
}

// ── encounter spots (OVERHAUL W1) ────────────────────────────────────────
  // One "?" per deterministic spot, amber for a rumour and red for the boss.
  // Resolved spots are not drawn at all — the floor visibly empties as the
  // player works it, which is the "this place is picked over" read.
  private clearEncounterSpots(): void {
    for (const m of this.spotMarkers.values()) {
      m.dot.destroy();
      m.label.destroy();
    }
    this.spotMarkers.clear();
  }

  private buildEncounterSpots(): void {
    this.clearEncounterSpots();
    const state = getGame();
    const y = FLOOR_HEIGHT - 34;
    // Everything E already reaches for on this floor. A marker inside any of
    // their radii would hijack the key (measured: it silently broke the NPC
    // trade and the journey specs), so each spot is nudged clear first.
    const taken: number[] = [UP_EXIT_X, DOWN_EXIT_X, ...this.floorView.containers.map((c) => c.x)];
    if (state.currentFloor === NPC_FLOOR) taken.push(...NPCS.map((n) => n.x));
    // OVERHAUL Wave C1: the trader joins the taken list so nothing lands on
    // top of him, and he is drawn after the spots so he reads above them.
    // The player arrives at ENTRY_X on every floor, so a trader placed there
    // spawns inside them - measured: trader 614, arrival 640, the two figures
    // overlapped on screen and neither was clickable-looking. Clear a full
    // interact radius plus a body width from both the arrival point and any NPC.
    const floor = state.currentFloor;
    const shopTaken = [...taken, ENTRY_X];
    const shopX = floor >= 2 ? placeClearX(state.runSeed, floor, 'trader', shopTaken, INTERACT_DISTANCE * 2) : null;
    if (shopX !== null) taken.push(shopX);
    for (const spot of encounterSpots(state.runSeed, floor)) {
      if (shouldSkip(state, spot.id)) continue;
      const x = nudgeSpotX(spot.x, taken, INTERACT_DISTANCE + 8);
      const color = spot.isBoss ? 0xe56d63 : 0xf4b66a;
      const dot = this.add.circle(x, y, 9, color, 0.9).setDepth(6);
      const label = this.add
        .text(x, y, '?', { fontFamily: 'monospace', fontSize: '13px', color: '#0b0f12' })
        .setOrigin(0.5)
        .setDepth(7);
      this.spotMarkers.set(spot.id, { x, isBoss: spot.isBoss, dot, label });
    }
    if (shopX !== null) {
      // The trader: a pack and a price tag, drawn as the walk sheet's own
      // silhouette so he belongs to the same world.
      this.floorObjects.push(...addContactShadow(this, shopX, PLAYER_FEET_Y + 2, 26, 2, 0.5));
      const trader = this.add.sprite(shopX, PLAYER_FEET_Y, walkSheetKey('npc_alin')).setOrigin(0.5, 1).setDepth(5);
      trader.play(idleAnimKey('npc_alin'));
      const tag = this.add
        .text(shopX, PLAYER_FEET_Y - 108, '行商', { fontFamily: 'monospace', fontSize: '11px', color: '#a8e0c8', backgroundColor: '#0b0f12cc', padding: { x: 4, y: 2 } })
        .setOrigin(0.5)
        .setDepth(6);
      this.spotMarkers.set('shop', { x: shopX, isBoss: false, dot: trader as unknown as Phaser.GameObjects.Arc, label: tag });
    }
  }

  private nearestEncounterSpot(): string | null {
    const px = getGame().player.x;
    let best: string | null = null;
    let bestDist = INTERACT_DISTANCE;
    for (const [id, m] of this.spotMarkers) {
      const d = Math.abs(m.x - px);
      if (d <= bestDist) {
        bestDist = d;
        best = id;
      }
    }
    return best;
  }

  // The legal choices per kind — the panel shows exactly these, so the UI can
  // never offer an action resolveEncounter would reject.
  private encounterChoices(kind: Encounter['kind']): EncounterChoice[] {
    switch (kind) {
      case 'loot':
      case 'cache':
        return ['take'];
      case 'ambush':
      case 'boss':
        return ['fight', 'flee'];
      case 'trader':
        return ['trade', 'leave'];
      case 'note':
        return ['read'];
    }
  }

  // ── the trader (OVERHAUL Wave C1) ────────────────────────────────────────
  // One panel, two directions: ↑/↓ moves along the stock, Enter buys one, and
  // S sells one of the highlighted item. Gold is the run's second currency and
  // the shortcut's price (Wave C2).

  private openShop(): void {
    const state = getGame();
    this.shopEntries = [...shopStock(state.currentFloor)];
    this.shopSelected = 0;
    this.encounterOpen = true;
    playSfx('click');
    this.buildShopPanel();
  }

  private closeShop(): void {
    this.encounterOpen = false;
    for (const o of this.encounterObjects) o.destroy();
    this.encounterObjects = [];
    this.buildEncounterSpots();
  }

  private buildShopPanel(): void {
    for (const o of this.encounterObjects) o.destroy();
    this.encounterObjects = [];
    const state = getGame();
    const { width, height } = this.cameras.main;
    const cx = width / 2;
    const cy = height / 2;
    const panelW = 440;
    const panelH = 248;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    const depth = PANEL_DEPTH.game.dialogue;

    this.encounterObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'green', depth));
    this.encounterObjects.push(...buildPanelHeader(this, left, top, panelW, '行商', UI.good, depth + 5));

    // The purse, right-aligned on the header row: the one number that decides
    // what the rest of this panel means.
    this.encounterObjects.push(
      this.add
        .text(left + panelW - 10, top + 10, `${state.player.gold} 金`, { fontFamily: 'monospace', fontSize: `${TYPE.body}px`, color: '#f4b66a' })
        .setOrigin(1, 0.5)
        .setDepth(depth + 6),
    );

    // Stock as rows: icon, name, price, how many the player already carries.
    // The icon is the item's own 16x16 art, so the shop speaks the same visual
    // language as the bag.
    this.shopEntries.forEach((e, i) => {
      const y = top + 30 + i * 30;
      const selected = i === this.shopSelected;
      this.encounterObjects.push(
        ...buildListRow(this, left + 8, y, panelW - 16, depth + 5, {
          iconKey: itemIconKey(e.itemId),
          label: getItem(e.itemId).displayName,
          value: `${e.price} 金 · 持 ${countItem(state.player.inventory, e.itemId)}`,
          selected,
        }),
      );
      if (!selected) return;
      // The selected row also shows what the trade would do, since the only
      // feedback otherwise arrives after the gold is already spent.
      const canBuy = state.player.gold >= e.price;
      this.encounterObjects.push(
        this.add
          .text(left + panelW - 20, y + 20, canBuy ? 'Enter 买入' : '金币不足', {
            fontFamily: 'monospace',
            fontSize: `${TYPE.caption}px`,
            color: canBuy ? '#77c6a4' : '#e8907c',
          })
          .setOrigin(1, 0.5)
          .setDepth(depth + 7),
      );
    });

    // The sell hint lives in its own strip at the bottom: the stock list is
    // what the player is browsing, and the sell mechanics apply to the whole bag
    // rather than to the highlighted row.
    const footY = top + panelH - 34;
    this.encounterObjects.push(...buildPanelWell(this, left + 8, footY, panelW - 16, 22, depth + 5));
    this.encounterObjects.push(
      this.add
        .text(left + 16, footY + 11, 'S 卖出背包里的一件  ·  ESC 离开', { fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: '#a8a49a' })
        .setOrigin(0, 0.5)
        .setDepth(depth + 7),
    );
  }

  private shopBuy(): void {
    const state = getGame();
    const entry = this.shopEntries[this.shopSelected];
    if (!entry) return;
    const r = buy(state, entry.itemId, state.currentFloor);
    playSfx(r.ok ? 'chest' : 'pickup');
    this.flash(r.ok ? r.message : r.reason);
    this.refreshInventory();
    this.refreshStats();
    this.buildShopPanel();
  }

  private shopSell(): void {
    const state = getGame();
    const entry = this.shopEntries[this.shopSelected];
    if (!entry) return;
    const r = sell(state, entry.itemId, state.currentFloor);
    playSfx(r.ok ? 'chest' : 'pickup');
    this.flash(r.ok ? r.message : r.reason);
    this.refreshInventory();
    this.refreshStats();
    this.buildShopPanel();
  }

  private openEncounter(spotId: string): void {
    const state = getGame();
    if (shouldSkip(state, spotId)) return;
    const marker = this.spotMarkers.get(spotId);
    const enc = rollFloorEncounter(state, state.currentFloor, spotId);
    // OVERHAUL Wave A: anything with teeth opens a real turn-based fight
    // instead of the old single-roll panel.
    if (isCombatKind(enc.kind)) {
      this.startCombat(spotId, enc.kind as 'ambush' | 'boss');
      return;
    }
    this.encounter = { spotId, encounter: enc, choices: this.encounterChoices(enc.kind), selected: 0, resolved: false };
    this.encounterOpen = true;
    this.buildEncounterPanel(marker?.isBoss ?? false);
    // The alert sting is the warning shot.
    playSfx('alert');
  }

  // ── turn-based combat (OVERHAUL Wave A) ─────────────────────────────────
  // The monster is rolled once per spot and frozen into state.combat, so a
  // save/reload mid-fight resumes the same fight. Behaviours from monsters.ts
  // shape the effective stats; the first-strike and guard-pierce rules are
  // applied here because resolveRound stays a generic engine.

  private monsterFor(kind: 'ambush' | 'boss', state: import('../core/gameTypes').GameState, spotId: string): Combatant & { id: number; behavior: string } {
    const floor = state.currentFloor;
    let def;
    if (kind === 'boss') {
      def = MONSTERS.find((m) => m.id === 900);
      if (!def) throw new Error('monster roster lost the 900 guardian');
    } else {
      // Seeded per spot, so the same question mark always hides the same thing
      // within a run — and deriveSeed, never a small integer, because
      // xorshift32's first output for small seeds collapses toward 0.
      const rng = makeRng(deriveSeed(state.runSeed, state.day, floor, spotId, 'combat-monster'));
      def = rollMonster(floor, rng);
    }
    const base: Combatant = {
      hp: def.hp,
      maxHp: def.hp,
      damage: def.damage,
      accuracy: def.accuracy,
      defense: def.defense,
      evasion: def.evasion,
      name: def.name,
    };
    const mods = behaviorModifiers(def.behavior);
    const effective = applyBehavior(mods, base);
    // applyBehavior rebuilds the object from the six combat fields, so the
    // display name does not survive it — re-attach it here.
    return { ...effective, name: def.name, id: def.id, behavior: def.behavior };
  }

  private startCombat(spotId: string, kind: 'ambush' | 'boss'): void {
    const state = getGame();
    const monster = this.monsterFor(kind, state, spotId);
    const log: string[] = [combatIntroMessage(kind, monster.name ?? '敌人')];
    // An ambusher's first strike lands before the player acts: the wind-up is
    // the tell, the hit is the bill.
    if (monster.behavior === 'ambusher') {
      const mods = behaviorModifiers('ambusher');
      const strike = Math.max(1, Math.round(monster.damage * mods.firstStrikeMult));
      state.player.hp = Math.max(0, state.player.hp - strike);
      log.push(`${monster.name} 抢先扑出，造成 ${strike} 点伤害！`);
      this.playActionAnim(hurtAnimKey('player'), 400);
      this.cameras.main.shake(160, 0.008);
    }
    state.combat = {
      kind,
      floor: state.currentFloor,
      spotId,
      monster: { ...monster, name: monster.name ?? '敌人' },
      guarding: false,
      turn: 1,
      log,
    };
    this.encounterOpen = true; // the same panel slot and the same input routing
    this.combatSelected = 0;
    playSfx('alert');
    this.refreshStats();
    if (state.player.hp <= 0) {
      state.status = 'lost';
      saveToStorage(state);
      this.scene.start('End');
      return;
    }
    saveToStorage(state);
    this.buildCombatPanel();
  }

  private closeCombat(): void {
    const state = getGame();
    state.combat = undefined;
    this.combatDone = false;
    this.encounterOpen = false;
    for (const o of this.encounterObjects) o.destroy();
    this.encounterObjects = [];
    // The floor's spots are rebuilt so a resolved one disappears.
    this.buildEncounterSpots();
  }

  private buildCombatPanel(): void {
    for (const o of this.encounterObjects) o.destroy();
    this.encounterObjects = [];
    const state = getGame();
    const combat = state.combat;
    if (!combat) return;
    const { width, height } = this.cameras.main;
    const cx = width / 2;
    const cy = height / 2;
    const panelW = 440;
    const panelH = 232;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    const depth = PANEL_DEPTH.game.dialogue;
    const isBoss = combat.kind === 'boss';

    this.encounterObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'yellow', depth));
    // OVERHAUL UI: the fight uses the same header strip, segmented bar and row
    // bands as every other panel, instead of its own centred title and a flat
    // two-rectangle HP bar. A boss gets the danger accent on the header rule.
    this.encounterObjects.push(
      ...buildPanelHeader(this, left, top, panelW, `${combat.monster.name}${isBoss ? '（守门人）' : ''}`, isBoss ? UI.danger : UI.accent, depth + 5),
    );

    // The monster's HP as the same segmented bar the HUD uses, so "how much is
    // left" reads at a glance instead of as a proportion of a strip.
    const g = this.add.graphics().setDepth(depth + 7);
    drawStatBar(g, left + 12, top + 30, panelW - 24, 7, combat.monster.hp / combat.monster.maxHp, isBoss ? UI.danger : UI.accent, 24);
    this.encounterObjects.push(g);
    this.encounterObjects.push(
      this.add
        .text(left + panelW - 12, top + 44, `${combat.monster.hp}/${combat.monster.maxHp} · 第 ${combat.turn} 回合`, {
          fontFamily: 'monospace',
          fontSize: `${TYPE.caption}px`,
          color: '#8a867c',
        })
        .setOrigin(1, 0)
        .setDepth(depth + 7),
    );

    // The log's tail: the last three lines, on a dark well so they read as a
    // record of what happened rather than as more body text.
    const logTop = top + 56;
    const logH = 62;
    this.encounterObjects.push(...buildPanelWell(this, left + 12, logTop, panelW - 24, logH, depth + 5));
    const tail = combat.log.slice(-3);
    tail.forEach((line, i) => {
      this.encounterObjects.push(
        this.add
          .text(left + 20, logTop + 8 + i * 17, line, { fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: i === tail.length - 1 ? '#ece8d8' : '#8a867c', wordWrap: { width: panelW - 40 } })
          .setDepth(depth + 7),
      );
    });

    // The three actions, as rows with a status column - the key, what it does,
    // and what it costs. A list of three verbs in a row was the old shape.
    const choices: ReadonlyArray<readonly [string, string, string]> = [
      ['攻击', '按 Enter', '造成武器伤害'],
      ['格挡', '受伤减半', '回 3 精力'],
      ['撤退', '按 ESC', '逃跑可能失败'],
    ];
    choices.forEach(([label, key, note], i) => {
      const y = top + 126 + i * 26;
      const selected = i === this.combatSelected;
      if (selected) {
        this.encounterObjects.push(this.add.rectangle(left + 12, y, panelW - 24, 24, UI.accent).setOrigin(0, 0).setAlpha(0.14).setDepth(depth + 5));
        this.encounterObjects.push(this.add.rectangle(left + 12, y, 2, 24, UI.accent).setOrigin(0, 0).setDepth(depth + 6));
      }
      this.encounterObjects.push(
        this.add
          .text(left + 22, y + 12, label, { fontFamily: 'monospace', fontSize: `${TYPE.body}px`, color: selected ? '#f4b66a' : '#ece8d8' })
          .setOrigin(0, 0.5)
          .setDepth(depth + 7),
        this.add
          .text(left + panelW - 22, y + 12, `${key} · ${note}`, { fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: '#8a867c' })
          .setOrigin(1, 0.5)
          .setDepth(depth + 7),
      );
    });

    this.encounterObjects.push(
      this.add
        .text(cx, top + panelH - 12, '↑/↓ 选择 · Enter 出招 · ESC 撤退', { fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: '#77c6a4' })
        .setOrigin(0.5)
        .setDepth(depth + 7),
    );
  }

  // One turn: the engine resolves the round, this method lands the numbers on
  // state and decides whether the fight continues.
  private activateCombatChoice(): void {
    const state = getGame();
    const combat = state.combat;
    if (!combat) return;
    const action = (['attack', 'guard', 'flee'] as const)[this.combatSelected];
    const player = playerCombatant(state);
    const monsterC: Combatant = {
      hp: combat.monster.hp,
      maxHp: combat.monster.maxHp,
      damage: combat.monster.damage,
      accuracy: combat.monster.accuracy,
      defense: combat.monster.defense,
      evasion: combat.monster.evasion,
      name: combat.monster.name,
    };
    const rng = makeRng(deriveSeed(state.runSeed, state.day, combat.floor, combat.spotId, `combat-turn-${combat.turn}`));
    const round = resolveRound(player, monsterC, action, rng);
    combat.log.push(...round.messages);
    combat.guarding = action === 'guard';

    if (round.playerDamage > 0) {
      combat.monster.hp = Math.max(0, combat.monster.hp - round.playerDamage);
      this.playActionAnim(attackAnimKey('player'), 300);
    }
    if (action === 'guard') {
      state.player.energy = Math.min(GAME_CONFIG.player.energyMax, state.player.energy + GUARD_ENERGY_RESTORE);
    }
    if (round.monsterDamage > 0 && !round.monsterDead && !round.fled) {
      // A coward that dropped below its threshold breaks off the fight and
      // runs — the player keeps what they already did to it.
      const cowardFrac = behaviorModifiers('coward').fleeAtHpFrac;
      if (combat.monster.behavior === 'coward' && cowardFrac > 0 && combat.monster.hp / combat.monster.maxHp < cowardFrac) {
        combat.log.push(`${combat.monster.name} 伤痕累累地逃走了。`);
        this.finishCombat('coward');
        return;
      }
      // OVERHAUL Wave B2/B3: the guardian totem and easy mode both soften the
      // hit the player takes; the relic applies to any monster, the mode only
      // to the guardian.
      const soften = (combat.kind === 'boss' ? guardianDamageMult(state.relics ?? []) * modeGuardianDamageMult(state.mode ?? 'adventure') : guardianDamageMult(state.relics ?? []));
      const dmg = Math.max(1, Math.round(round.monsterDamage * soften));
      state.player.hp = Math.max(0, state.player.hp - dmg);
      if (action === 'guard') this.playActionAnim(hurtAnimKey('player'), 400);
      this.cameras.main.shake(160, 0.008);
    }
    combat.turn += 1;
    this.refreshStats();

    if (round.playerDead || state.player.hp <= 0) {
      state.player.hp = 0;
      state.status = 'lost';
      saveToStorage(state);
      this.scene.start('End');
      return;
    }
    if (round.monsterDead) {
      this.finishCombat('win');
      return;
    }
    if (round.fled) {
      // A successful retreat costs nothing and leaves the spot un-resolved —
      // the player can come back with a better plan (or a crowbar).
      combat.log.push('你成功撤出。');
      saveToStorage(state);
      this.closeCombat();
      this.flash('你撤出了战斗。');
      return;
    }
    saveToStorage(state);
    this.buildCombatPanel();
  }

  // Combat over: pay out, consume the spot, close.
  private finishCombat(outcome: 'win' | 'coward'): void {
    const state = getGame();
    const combat = state.combat;
    if (!combat) return;
    const isBoss = combat.kind === 'boss';
    if (outcome === 'win') {
      // Ambush win: the loser's pockets. Boss win: the chapter's payoff.
      // OVERHAUL Wave B3: the lucky charm adds one more roll to the pile.
      const rng = makeRng(deriveSeed(state.runSeed, state.day, combat.floor, combat.spotId, 'combat-loot'));
      const lootCount = (isBoss ? 3 : rng.nextInt(1, 2)) + lootBonus(state.relics ?? []);
      const taken: Array<{ itemId: ItemId; quantity: number }> = [];
      const pool: ItemId[] = isBoss
        ? ['medkit', 'clean_water', 'ration_pack', 'battery', 'filter']
        : ['bread', 'clean_water', 'dirty_water', 'scrap_metal', 'cloth', 'battery'];
      for (let i = 0; i < lootCount; i++) {
        const itemId = pool[rng.nextInt(0, pool.length - 1)];
        const qty = itemId === 'clean_water' || itemId === 'bread' ? rng.nextInt(1, 2) : 1;
        const r = addItem(state.player.inventory, itemId, qty);
        if (r.overflow === 0) taken.push({ itemId, quantity: qty });
      }
      const names = taken.map((s) => `${getItem(s.itemId).displayName}×${s.quantity}`).join('、');
      combat.log.push(isBoss ? `守门人倒下了。你搜出：${names || '（背包已满）'}` : `你击败了 ${combat.monster.name}。战利品：${names || '（背包已满）'}`);
      if (isBoss) {
        state.records = { deepestFloor: Math.max(state.records?.deepestFloor ?? 0, state.currentFloor), bestScore: (state.records?.bestScore ?? 0) + 200 };
        combat.log.push('上楼的路通了。分数 +200');
      }
      markResolved(state, combat.spotId, `combat:win`);
      playSfx('goal');
    } else {
      // Coward break-off: half the glory, and the spot stays spent.
      const rng = makeRng(deriveSeed(state.runSeed, state.day, combat.floor, combat.spotId, 'combat-coward'));
      const itemId: ItemId = rng.chance(0.5) ? 'bread' : 'cloth';
      const r = addItem(state.player.inventory, itemId, 1);
      if (r.overflow === 0) combat.log.push(`它逃走时掉下了 ${getItem(itemId).displayName}。`);
      markResolved(state, combat.spotId, `combat:coward`);
    }
    saveToStorage(state);
    this.refreshStats();
    // Show the outcome for one more Enter, same as the non-combat panel.
    for (const o of this.encounterObjects) o.destroy();
    this.encounterObjects = [];
    const { width, height } = this.cameras.main;
    const cx = width / 2;
    const cy = height / 2;
    // OVERHAUL UI: the outcome uses the same header strip and log well as the
    // fight itself, so the panel does not change shape when the fight ends.
    const outDepth = PANEL_DEPTH.game.dialogue;
    const outW = 440;
    const outH = 170;
    const outLeft = cx - outW / 2;
    const outTop = cy - outH / 2;
    const headline = outcome === 'win' ? (isBoss ? '守门人倒下了' : '战斗胜利') : '敌人逃走了';
    this.encounterObjects.push(...buildPanel(this, cx, cy, outW, outH, 'yellow', outDepth));
    this.encounterObjects.push(...buildPanelHeader(this, outLeft, outTop, outW, headline, UI.good, outDepth + 5));
    this.encounterObjects.push(...buildPanelWell(this, outLeft + 12, outTop + 26, outW - 24, 62, outDepth + 5));
    const tail = combat.log.slice(-3);
    tail.forEach((line, i) => {
      this.encounterObjects.push(
        this.add
          .text(outLeft + 20, outTop + 38 + i * 17, line, {
            fontFamily: 'monospace',
            fontSize: `${TYPE.caption}px`,
            color: i === tail.length - 1 ? '#ece8d8' : '#8a867c',
            wordWrap: { width: outW - 40 },
          })
          .setDepth(outDepth + 7),
      );
    });
    this.encounterObjects.push(
      this.add
        .text(cx, outTop + outH - 12, 'Enter / ESC 继续', { fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: '#8a867c' })
        .setOrigin(0.5)
        .setDepth(outDepth + 7),
    );
    // The fight is over: the outcome screen waits for one Enter, then
    // closeCombat clears state.combat and the floor's spots.
    this.combatDone = true;
    state.combat = { ...combat, log: combat.log };
  }

  private closeEncounter(): void {
    this.encounterOpen = false;
    this.encounter = undefined;
    for (const o of this.encounterObjects) o.destroy();
    this.encounterObjects = [];
    // The floor's spots are rebuilt so a just-resolved one disappears.
    this.buildEncounterSpots();
  }

  private buildEncounterPanel(isBoss: boolean): void {
    for (const o of this.encounterObjects) o.destroy();
    this.encounterObjects = [];
    const enc = this.encounter;
    if (!enc) return;
    const { width, height } = this.cameras.main;
    const cx = width / 2;
    const cy = height / 2;
    const panelW = 420;
    const panelH = 190;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;

    const depth = PANEL_DEPTH.game.dialogue;
    this.encounterObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'yellow', depth));
    // OVERHAUL UI: header strip, the message in an inset well, and choices as
    // banded rows instead of '> label' text runs.
    this.encounterObjects.push(
      ...buildPanelHeader(this, left, top, panelW, ENCOUNTER_TITLES[enc.encounter.kind], isBoss ? UI.danger : UI.accent, depth + 5),
    );
    this.encounterObjects.push(...buildPanelWell(this, left + 12, top + 26, panelW - 24, 48, depth + 5));
    this.encounterObjects.push(
      this.add
        .text(left + 20, top + 50, enc.encounter.message, {
          fontFamily: 'monospace',
          fontSize: `${TYPE.body}px`,
          color: '#ece8d8',
          wordWrap: { width: panelW - 40 },
        })
        .setOrigin(0, 0.5)
        .setDepth(depth + 7),
    );
    if (!enc.resolved) {
      enc.choices.forEach((choice, i) => {
        const y = top + 84 + i * 28;
        const selected = i === enc.selected;
        if (selected) {
          this.encounterObjects.push(
            this.add.rectangle(left + 12, y, panelW - 24, 26, UI.accent).setOrigin(0, 0).setAlpha(0.14).setDepth(depth + 5),
            this.add.rectangle(left + 12, y, 2, 26, UI.accent).setOrigin(0, 0).setDepth(depth + 6),
          );
        }
        this.encounterObjects.push(
          this.add
            .text(left + 24, y + 13, CHOICE_LABELS[choice], {
              fontFamily: 'monospace',
              fontSize: `${TYPE.body}px`,
              color: selected ? '#f4b66a' : '#a8a49a',
            })
            .setOrigin(0, 0.5)
            .setDepth(depth + 7),
        );
      });
      this.encounterObjects.push(
        this.add
          .text(cx, top + panelH - 12, '↑/↓ 选择 · Enter 确认 · ESC 离开', { fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: '#8a867c' })
          .setOrigin(0.5)
          .setDepth(depth + 7),
      );
    }
  }

  // Applies a choice: HP is applied here (the system only reports the delta),
  // items are already in the bag from resolveEncounter, and the panel flips to
  // the outcome text — Enter or Esc then closes it.
  private activateEncounterChoice(): void {
    const enc = this.encounter;
    if (!enc || enc.resolved) return;
    const state = getGame();
    const choice = enc.choices[enc.selected];
    const result = resolveEncounter(state, enc.encounter, choice);
    if (result.consumed) markResolved(state, enc.spotId, `${enc.encounter.kind}:${choice}`);
    if (result.hpChange !== 0) {
      state.player.hp = Math.max(0, Math.min(GAME_CONFIG.player.hpMax, state.player.hp + result.hpChange));
    }
    saveToStorage(state);
    enc.resolved = true;
    if (result.items.length > 0) playSfx('chest');
    // A swing reads as a swing: the attack clip plays whenever the player chose
    // to fight, win or lose.
    if (choice === 'fight') this.playActionAnim(attackAnimKey('player'), 300);
    if (result.hpChange < 0) {
      this.cameras.main.shake(160, 0.008);
      this.refreshStats();
    }
    // Outcome panel: the message, and the item flow the player actually got.
    for (const o of this.encounterObjects) o.destroy();
    this.encounterObjects = [];
    const { width, height } = this.cameras.main;
    const cx = width / 2;
    const cy = height / 2;
    const panelW = 420;
    const panelH = 170;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    const isBoss = enc.encounter.kind === 'boss';
    this.encounterObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'yellow', PANEL_DEPTH.game.dialogue));
    this.encounterObjects.push(
      this.add.text(cx, top + 18, ENCOUNTER_TITLES[enc.encounter.kind], { fontFamily: 'monospace', fontSize: '16px', color: isBoss ? '#e8907c' : '#f4b66a' }).setOrigin(0.5),
    );
    this.encounterObjects.push(
      this.add.text(left + 20, top + 44, result.message, { fontFamily: 'monospace', fontSize: '13px', color: '#ece8d8', wordWrap: { width: panelW - 40 } }).setOrigin(0, 0),
    );
    const loot = result.items.map((s) => `${getItem(s.itemId).displayName}×${s.quantity}`).join('、');
    if (loot) {
      this.encounterObjects.push(
        this.add.text(left + 20, top + 96, `获得：${loot}`, { fontFamily: 'monospace', fontSize: '13px', color: '#a8e0c8', wordWrap: { width: panelW - 40 } }).setOrigin(0, 0),
      );
    }
    this.encounterObjects.push(
      this.add.text(cx, top + panelH - 14, 'Enter / ESC 继续', { fontFamily: 'monospace', fontSize: '11px', color: '#8a867c' }).setOrigin(0.5),
    );
    if (state.status === 'lost') {
      this.scene.start('End');
    }
  }


  // The starting floor — the player's dorm, and the visual template the other
  // floors will follow. The wall and floor are single 1280px-wide art images
  // (assets/env), not 16x16 tiles: the art carries the skirting, service pipes,
  // damp patches and the torn notice, so this method only adds what the art cannot
  // — the ceiling shadow, the light sources, and the doors.
  private drawDormRoom(): void {
    const wallH = FLOOR_HEIGHT - FLOOR_BAND;

    const wall = this.add.image(0, 8, ENV_WALL_KEY).setOrigin(0, 0);
    const floor = this.add.image(0, wallH, ENV_FLOOR_KEY).setOrigin(0, 0);

    const g = this.add.graphics();
    // Ceiling shadow only. The skirting, the two service pipes, the damp patches
    // and the pinned notice all used to be drawn here; the wall image has them, and
    // drawing them again printed them straight over the art.
    g.fillStyle(0x0b0f12, 1);
    g.fillRect(0, 0, FLOOR_WIDTH, 8);

    // One lit window per room. The pool is drawn row by row as an ellipse with
    // banded alpha: three stacked rectangles used to sit here, and over textured
    // wall art their edges read as a glowing box rather than as light.
    for (let r = 0; r < ROOM_COUNT; r++) {
      const cx = r * ROOM_WIDTH + ROOM_WIDTH / 2;
      // Cold daylight through the glass, as an ADD glow: the ellipse halo this
      // replaced read as a beige shape painted on the wall rather than as light.
      this.floorObjects.push(addGlow(this, cx - 8, 116, 62, 0.22, 3));
      // The shaft: the window's light falling down the wall and pooling on the
      // floor. A tall, narrow glow is the cheapest honest way to draw a beam in
      // a side view - it gives the frame its brightest pixels, which is what
      // makes the eye read "a light source in the room" rather than "a lit
      // rectangle on a wall".
      const shaft = addGlow(this, cx - 8, 168, 52, 0.34, 3);
      shaft.setScale(0.42, 1.55);
      this.floorObjects.push(shaft);
      this.floorObjects.push(this.add.image(cx - 8, 116, 'tile_window').setOrigin(0.5));
    }

    // Wall lamps between the windows, each with its own small pool of light —
    // the warm counterpoint to the cold daylight through the glass.
    for (let r = 0; r < ROOM_COUNT; r++) {
      const cx = r * ROOM_WIDTH + ROOM_WIDTH / 2;
      const lampX = cx + (r % 2 === 0 ? 96 : -96);
      // The lamp's glow, shaped like the fixture rather than like a ball.
      //
      // A wall lamp throws light DOWN and out; a circular pool centred on the
      // bulb was the one thing that made these read as floating white dots on a
      // wall rather than as lamps. The glow is anchored below the shade and
      // stretched vertically, which is what a cone looks like from the side.
      const lampGlow = addGlow(this, lampX, 162, 26, 0.5, 4);
      lampGlow.setScale(1.05, 1.5);
      this.floorObjects.push(lampGlow);
      g.fillStyle(0x6a4a2a, 1);
      g.fillRect(lampX - 2, 142, 4, 8);
      g.fillStyle(0xf4b66a, 1);
      g.fillRect(lampX - 5, 150, 10, 4);
    }

    // Doors on the room boundaries, standing on the floor line.
    for (let i = 1; i < ROOM_COUNT; i++) {
      this.floorObjects.push(this.add.image(i * ROOM_WIDTH, wallH, 'tile_door').setOrigin(0.5, 1));
    }

    this.floorObjects.push(wall, floor, g);

    // OVERHAUL Art Pass 2: ceiling shadow, baseboard seam, floor gradient and
    // reflections under the lights — the four cues that make a flat side view
    // read as a room with depth.
    const lampXs: number[] = [];
    for (let r = 0; r < ROOM_COUNT; r++) {
      const cx = r * ROOM_WIDTH + ROOM_WIDTH / 2;
      lampXs.push(cx + (r % 2 === 0 ? 96 : -96));
    }
    this.floorObjects.push(
      ...buildRoomDepth(this, {
        width: FLOOR_WIDTH,
        wallBottom: wallH,
        height: FLOOR_HEIGHT,
        lightXs: lampXs,
      }),
      // Water streaks, panel seams, base stains, tile lines and puddles: the
      // detail that stops the two largest surfaces being flat.
      ...buildSurfaceDetail(this, { width: FLOOR_WIDTH, wallBottom: wallH, height: FLOOR_HEIGHT, seed: 11 }),
      ...buildCeilingLights(this, { width: FLOOR_WIDTH, seed: 5, top: 16 }),
      // The room's density: pipes, vents, junction boxes and signage on the
      // background plane, debris on the floor line. Without this a floor that
      // measures well still looks empty, because an empty frame can pass every
      // colour metric while having nothing in it.
      // Aerial perspective: the wall loses contrast with height, so it recedes.
      ...buildAerialHaze(this, { width: FLOOR_WIDTH, wallBottom: wallH, hazeColor: ambienceFor(STARTING_FLOOR).color, strength: 0.34 }),
      ...buildWallDressing(this, { width: FLOOR_WIDTH, wallBottom: wallH, seed: 3, keepClear: [UP_EXIT_X, DOWN_EXIT_X] }),
      ...buildFloorClutter(this, { width: FLOOR_WIDTH, wallBottom: wallH, seed: 3, keepClear: [UP_EXIT_X, DOWN_EXIT_X] }),
    );

    // The foreground layer last: ceiling beam, floor debris, side margins. This
    // is what puts the camera inside the room instead of in front of a backdrop.
    this.floorObjects.push(
      ...buildForeground(this, { width: FLOOR_WIDTH, height: FLOOR_HEIGHT, wallBottom: wallH, seed: 7 }),
    );

    // OVERHAUL Art Pass: the lighting layer over the dorm too — the bed and the
    // workbench are where the player works, so they get the warm pools.
    this.lightLayer?.destroy();
    this.lightLayer = buildLightLayer(this, {
      width: FLOOR_WIDTH,
      height: FLOOR_HEIGHT,
      isDorm: true,
      hasUpExit: true,
      hasDownExit: false,
      ambience: ambienceFor(STARTING_FLOOR),
    });
  }

  // Floors 2-5 — corridors. They share the dorm's base (art wall, art floor) so
  // the tower reads as one building, then take a per-floor tint and per-floor
  // props: see src/render/corridors.ts.
  private drawCorridor(floor: number): void {
    const wallH = FLOOR_HEIGHT - FLOOR_BAND;
    const tint = corridorTint(floor);

    const wall = this.add.image(0, 8, ENV_WALL_KEY).setOrigin(0, 0);
    const floorBand = this.add.image(0, wallH, ENV_FLOOR_KEY).setOrigin(0, 0);
    this.floorObjects.push(wall, floorBand);

    if (tint) {
      this.floorObjects.push(this.add.rectangle(FLOOR_WIDTH / 2, 8 + (wallH - 8) / 2, FLOOR_WIDTH, wallH - 8, tint.color, tint.alpha));
    }

    const g = this.add.graphics();
    g.fillStyle(0x0b0f12, 1);
    g.fillRect(0, 0, FLOOR_WIDTH, 8);

    // Props, room by room. Each theme decides its own dressing; the loop only
    // supplies the room's position so nothing has to recompute the layout.
    const props: Phaser.GameObjects.GameObject[] = [];
    for (let r = 0; r < ROOM_COUNT; r++) {
      drawCorridorRoom({ scene: this, g, floor, roomX: r * ROOM_WIDTH, floorY: wallH, room: r, objects: props });
    }
    this.floorObjects.push(g, ...props);

    this.floorObjects.push(
      ...buildForeground(this, { width: FLOOR_WIDTH, height: FLOOR_HEIGHT, wallBottom: wallH, seed: floor * 31 }),
    );

    // OVERHAUL Art Pass 2: the same depth cues as the dorm, with the
    // stairwells as this floor's light sources.
    this.floorObjects.push(
      ...buildRoomDepth(this, {
        width: FLOOR_WIDTH,
        wallBottom: wallH,
        height: FLOOR_HEIGHT,
        lightXs: [40, 1240],
      }),
      ...buildSurfaceDetail(this, { width: FLOOR_WIDTH, wallBottom: wallH, height: FLOOR_HEIGHT, seed: floor * 17 }),
      ...buildCeilingLights(this, { width: FLOOR_WIDTH, seed: floor * 13, top: 16 }),
      ...buildAerialHaze(this, { width: FLOOR_WIDTH, wallBottom: wallH, hazeColor: ambienceFor(floor).color, strength: 0.34 }),
      ...buildWallDressing(this, { width: FLOOR_WIDTH, wallBottom: wallH, seed: floor * 19, keepClear: [UP_EXIT_X, DOWN_EXIT_X] }),
      ...buildFloorClutter(this, { width: FLOOR_WIDTH, wallBottom: wallH, seed: floor * 19, keepClear: [UP_EXIT_X, DOWN_EXIT_X] }),
    );

    // OVERHAUL Art Pass: the lighting layer goes on after the props, so the
    // pools and the ambient wash tint everything the room already drew.
    this.lightLayer?.destroy();
    this.lightLayer = buildLightLayer(this, {
      width: FLOOR_WIDTH,
      height: FLOOR_HEIGHT,
      isDorm: false,
      hasUpExit: hasUpExit(floor),
      hasDownExit: hasDownExit(floor),
      // Each floor's own atmosphere: cold housing, green storage, cyan
      // maintenance, warm-and-wrong canteen. Without this the tower is one
      // corridor repeated.
      ambience: ambienceFor(floor),
    });
    this.floorObjects.push(...[]); // the layer owns its own objects
  }

  // The stairwells, drawn with the tile_stairs_* textures instead of a flat
  // block. Three rows of 16px tiles make a readable staircase; the labels sit
  // above and the tiles stay inside the floor band so nothing shifts.
  private drawExits(floor: number): void {
    if (hasUpExit(floor)) {
      const stairs = this.add.tileSprite(UP_EXIT_X - 16, FLOOR_HEIGHT - FLOOR_BAND, 32, FLOOR_BAND, 'tile_stairs_up').setOrigin(0, 0);
      const upLabel = this.add.text(UP_EXIT_X, FLOOR_HEIGHT - 104, '↑ 上楼', { fontFamily: 'monospace', fontSize: `${TYPE_AUX}px`, color: '#77c6a4' }).setOrigin(0.5);
      this.floorObjects.push(stairs, upLabel);
    }
    if (hasDownExit(floor)) {
      const stairs = this.add.tileSprite(DOWN_EXIT_X - 16, FLOOR_HEIGHT - FLOOR_BAND, 32, FLOOR_BAND, 'tile_stairs_down').setOrigin(0, 0);
      const downLabel = this.add.text(DOWN_EXIT_X, FLOOR_HEIGHT - 104, '↓ 下楼', { fontFamily: 'monospace', fontSize: `${TYPE_AUX}px`, color: '#f4b66a' }).setOrigin(0.5);
      this.floorObjects.push(stairs, downLabel);
    }
  }

  private buildContainers(): void {
    for (const c of this.floorView.containers) {
      const y = FLOOR_HEIGHT - 64;
      const key = containerTextureKey(c.id);
      // Every container has art now, so the Graphics fallback is gone: a missing
      // key would be an invisible container, not a plain one. The interaction box
      // is unchanged either way — hit detection still goes through c.x and
      // INTERACT_DISTANCE.
      this.floorObjects.push(...addContactShadow(this, c.x, y, 44, 2, 0.45));
      const box = this.add.image(c.x, y - 4, key ?? '').setOrigin(0.5, 1);
      // The props are ~80px tall now rather than 16-32, so the label has to sit
      // above the prop instead of at a fixed offset from the floor line — at the
      // old spot it would be printed straight across the middle of the crate.
      const label = this.add
        .text(c.x, y - 4 - box.displayHeight - 8, c.label, { fontFamily: 'monospace', fontSize: '11px', color: '#ece8d8' })
        .setOrigin(0.5);
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
    const bed = this.add.image(BED_X, y + 4, 'furn_bed').setOrigin(0.5, 1);
    const bedLabel = this.add.text(BED_X, y + 4 - bed.displayHeight - 8, '床（睡觉）', { fontFamily: 'monospace', fontSize: '11px', color: '#ece8d8' }).setOrigin(0.5);
    this.floorObjects.push(bed, bedLabel);
  }

  // ── HUD & inventory UI ─────────────────────────────────────────────────
  private buildHud(): void {
    // A scene restart keeps the display list — Phaser 4's shutdown only nulls
    // the textures — and field initialisers do not re-run, so the previous
    // run's HUD objects would both double up on screen and throw on the first
    // setText/setColor (a stale Text's glTexture is null). Destroy and reset
    // everything this method owns before rebuilding.
    this.statLabels = [];
    this.goalText?.destroy();
    this.goalText = undefined;
    this.scoreText?.destroy();
    this.scoreText = undefined;
    this.vignette?.destroy();
    this.vignette = undefined;
    this.floorBadge?.destroy();
    this.floorBadge = undefined;
    this.goldText?.destroy();
    this.goldText = undefined;

    // ── the top bar ─────────────────────────────────────────────────────────
    // OVERHAUL UI: the HUD used to be five text chips with their own
    // background colours scattered at the screen corners, which is what made the
    // game read as a prototype. It is now one bar on the shared grid: floor
    // badge, clock, four segmented stat bars, gold, score — each in its own
    // column, all baseline-aligned.
    this.add.rectangle(0, 0, DESIGN_WIDTH, HUD_BAR_H, UI.surface).setOrigin(0, 0).setAlpha(0.9).setScrollFactor(0).setDepth(100);
    const topLine = this.add.graphics().setScrollFactor(0).setDepth(101);
    topLine.fillStyle(UI.line, 0.9);
    topLine.fillRect(0, HUD_BAR_H - 1, DESIGN_WIDTH, 1);

    // Floor badge: the one number that is always the answer to "where am I".
    this.floorBadge = this.add
      .text(8, HUD_BAR_H / 2, '1F', { fontFamily: 'monospace', fontSize: `${TYPE.title}px`, color: '#0b0f12' })
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(103);
    this.add
      .rectangle(6, HUD_BAR_H / 2, 26, 15, UI.accent)
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(102);

    this.clockText = this.add
      .text(38, HUD_BAR_H / 2, '', { fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: '#ece8d8' })
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(103);
    this.refreshClock();

    // The four survival bars, drawn by one Graphics.
    this.barsGfx = this.add.graphics().setScrollFactor(0).setDepth(103);
    STAT_BARS.forEach((s, i) => {
      const col = 0 + i;
      void col;
      this.statLabels.push(
        this.add
          .text(HUD_STAT_X + i * HUD_STAT_PITCH, HUD_BAR_H / 2, s.label, { fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: '#ece8d8' })
          .setOrigin(0, 0.5).setScrollFactor(0).setDepth(103),
      );
    });
    this.refreshStats();

    // Gold and score, right-aligned in their own columns.
    this.goldText = this.add
      .text(DESIGN_WIDTH - 8, HUD_BAR_H / 2, '', { fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: '#f4b66a' })
      .setOrigin(1, 0.5).setScrollFactor(0).setDepth(103);
    this.scoreText = this.add
      .text(DESIGN_WIDTH - 62, HUD_BAR_H / 2, '', { fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: '#a8e0c8' })
      .setOrigin(1, 0.5).setScrollFactor(0).setDepth(103);

    // The daily objective gets its own slim line under the bar: it is the
    // answer to "what am I doing today", so it should not be a corner chip.
    const goalY = HUD_BAR_H + 8;
    this.goalText = this.add
      .text(8, goalY, '', { fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: '#f4b66a' })
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(HUD_FEEDBACK_DEPTH);

    // Centred on the CAMERA viewport, not the floor: FLOOR_WIDTH is the 1280px
    // world, but a scrollFactor-0 object is positioned in screen space, so
    // FLOOR_WIDTH/2 (=640) sat half outside the 640px canvas.
    this.feedbackText = this.add
      .text(DESIGN_WIDTH / 2, HUD_BAR_H + 26, '', { fontFamily: 'monospace', fontSize: `${TYPE.body}px`, color: '#f4b66a', backgroundColor: '#0b0f12cc', padding: { x: 6, y: 3 } })
      .setOrigin(0.5).setScrollFactor(0).setDepth(HUD_FEEDBACK_DEPTH);

    // Red rather than amber: this is a standing blocker, not news. It sits below
    // the flash so both can be on screen at once without overlapping.
    this.bagFullText = this.add
      .text(
        DESIGN_WIDTH / 2,
        HUD_BAR_H + 46,
        `背包已满 · 使用、制作或交易腾出格子，否则搜刮会留在原处；能叠进已有堆的物品仍可拾取`,
        { fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: '#e8907c', backgroundColor: '#0b0f12cc', padding: { x: 6, y: 3 } },
      )
      .setOrigin(0.5).setScrollFactor(0).setDepth(HUD_FEEDBACK_DEPTH).setVisible(false);

    // ── the foot bar ────────────────────────────────────────────────────────
    this.add.rectangle(0, DESIGN_HEIGHT - HUD_FOOT_H, DESIGN_WIDTH, HUD_FOOT_H, UI.surface).setOrigin(0, 0).setAlpha(0.88).setScrollFactor(0).setDepth(100);
    const footLine = this.add.graphics().setScrollFactor(0).setDepth(101);
    footLine.fillStyle(UI.line, 0.9);
    footLine.fillRect(0, DESIGN_HEIGHT - HUD_FOOT_H, DESIGN_WIDTH, 1);
    this.hintText = this.add
      .text(8, DESIGN_HEIGHT - HUD_FOOT_H / 2, 'A/D 移动 · E 交互 · I 背包 · C 制作 · M 地图 · ESC 菜单', { fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: '#a8e0c8' })
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(HUD_FEEDBACK_DEPTH);

    // The low-HP vignette: pure red wash whose alpha is the pulse function's
    // output. Created invisible; update() drives it every frame.
    this.vignette = this.add
      .rectangle(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT, 0xe56d63, 0)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(90);
    this.lastStats = '';
    this.refreshGoalHud();
  }

  // OVERHAUL: the day's objective (rolled lazily on first read of the day) and
  // the run score + depth record. Recomputed on a key so the text objects are
  // only touched when something actually changed.
  //
  // Guarded because refreshStats() — which calls this — runs from buildHud
  // before the goal/score texts exist; the first real call is the one at the
  // end of buildHud, after they are created.
  private refreshGoalHud(): void {
    if (!this.goalText || !this.scoreText) return;
    const state = getGame();
    ensureDailyGoal(state);
    const goal = state.dailyGoal;
    const done = goal ? isDailyGoalDone(state) : false;
    const label = goal ? GOAL_LABELS[goal.kind](goal.target) : '';
    const key = `${goal?.day ?? 0}|${goal?.kind ?? ''}|${goal?.target ?? 0}|${String(done)}`;
    if (key !== this.lastGoalKey) {
      this.lastGoalKey = key;
      this.goalText.setText(`目标 ${label}${done ? ' ✓' : ''}`);
      this.goalText.setColor(done ? '#a8e0c8' : '#f4b66a');
    }
    this.scoreText.setText(`${runScore(state)}分`);
    this.goldText?.setText(`${state.player.gold}金`);
  }

  private refreshClock(): void {
    const s = getGame();
    const label = `D${s.day} ${formatClock(s.gameMinuteOfDay)}`;
    if (label !== this.lastClock) {
      this.lastClock = label;
      this.clockText.setText(label);
    }
    this.floorBadge?.setText(`${s.currentFloor}F`);
  }

  private refreshStats(): void {
    const p = getGame().player;
    const values = [p.hp, p.hunger, p.thirst, p.energy];
    const key = values.map((v) => Math.round(v)).join(',');
    if (key === this.lastStats) return;
    this.lastStats = key;
    this.barsGfx.clear();
    values.forEach((v, i) => {
      const x = HUD_STAT_X + i * HUD_STAT_PITCH + 24;
      const color = STAT_COLORS[STAT_BARS[i].key] ?? UI.good;
      drawStatBar(this.barsGfx, x, HUD_BAR_H / 2 - 2, HUD_STAT_BAR_W, 4, v / 100, color);
    });
    // The most urgent bar's label turns red, so the critical slot is findable
    // without reading four numbers.
    const urgent = mostUrgentStat(getGame().player);
    this.statLabels.forEach((t, i) => t.setColor(STAT_BARS[i].key === urgent ? '#e8907c' : '#a8a49a'));
    this.refreshGoalHud();
  }

  private buildInventoryPanel(): void {
    // OVERHAUL UI: this panel used to be a 380x340 box holding twelve rows of
    // "name ×count" text in 13px monospace — measured, 46% of the whole screen
    // was one flat colour. It is now an icon grid on the left and a detail pane
    // on the right: the icons carry the identity, the pane carries the words,
    // and neither one is a wall of text.
    const { width, height } = this.cameras.main;
    const panelW = 440;
    const panelH = 236;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    const depth = PANEL_DEPTH.game.inventory;

    this.invObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'green', depth));
    this.invObjects.push(...buildPanelHeader(this, left, top, panelW, '背包', UI.good, depth + 5));
    this.invObjects.push(
      this.add
        .text(left + panelW - 10, top + 10, '', { fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: '#a8e0c8' })
        .setOrigin(1, 0.5)
        .setDepth(depth + 6),
    );
    this.invCountText = this.invObjects[this.invObjects.length - 1] as Phaser.GameObjects.Text;

    // ── the grid ────────────────────────────────────────────────────────────
    // 4 columns x 3 rows of 40px cells: twelve slots, no scrolling, and each
    // cell is big enough for a 2x icon (pixel art upscales cleanly at integer
    // factors, unlike the old 16px icons in a 20px row).
    const GRID_X = left + 12;
    const GRID_Y = top + 30;
    const CELL = 40;
    const GAP = 5;
    this.invCells = [];
    this.invSlotIcons = [];
    this.invSlotTexts = [];
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = GRID_X + col * (CELL + GAP);
      const y = GRID_Y + row * (CELL + GAP);
      const cell = this.add.rectangle(x, y, CELL, CELL, 0x080c0f).setOrigin(0, 0).setAlpha(0.6).setDepth(depth + 5);
      const border = this.add.graphics().setDepth(depth + 6);
      border.lineStyle(1, UI.line, 0.85);
      border.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
      const icon = this.add
        .image(x + CELL / 2, y + CELL / 2, 'blank')
        .setOrigin(0.5)
        .setScale(2)
        .setDepth(depth + 6);
      const badge = this.add
        .text(x + CELL - 3, y + CELL - 3, '', { fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: '#ece8d8', stroke: '#0b0f12', strokeThickness: 3 })
        .setOrigin(1, 1)
        .setDepth(depth + 7);
      this.invCells.push(cell);
      this.invSlotIcons.push(icon);
      this.invSlotTexts.push(badge);
      this.invObjects.push(cell, border, icon, badge);
    }

    // ── the detail pane ─────────────────────────────────────────────────────
    const DETAIL_X = GRID_X + 4 * (CELL + GAP) + 8;
    const DETAIL_W = left + panelW - 12 - DETAIL_X;
    this.invObjects.push(...buildPanelWell(this, DETAIL_X, GRID_Y, DETAIL_W, 3 * (CELL + GAP) - GAP, depth + 5));
    this.invDetailName = this.add
      .text(DETAIL_X + 8, GRID_Y + 10, '', { fontFamily: 'monospace', fontSize: `${TYPE.title}px`, color: '#f4b66a' })
      .setDepth(depth + 7);
    this.invDetailMeta = this.add
      .text(DETAIL_X + 8, GRID_Y + 28, '', { fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: '#8a867c' })
      .setDepth(depth + 7);
    this.invDetailBody = this.add
      .text(DETAIL_X + 8, GRID_Y + 46, '', { fontFamily: 'monospace', fontSize: `${TYPE.body}px`, color: '#ece8d8', wordWrap: { width: DETAIL_W - 16 } })
      .setDepth(depth + 7);
    this.invObjects.push(this.invDetailName, this.invDetailMeta, this.invDetailBody);

    const footer = this.add
      .text(cx, top + panelH - 12, '↑/↓ 选择 · Enter 使用 · I 关闭', { fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: '#77c6a4' })
      .setOrigin(0.5, 0.5)
      .setDepth(depth + 6);
    this.invObjects.push(footer, this.invMarker);

    applyPanelDepth(this.invObjects, depth);
    this.assertPanelContent('inventory', this.invObjects);
    for (const o of this.invObjects) o.setVisible(false);
  }

  private refreshInventory(): void {
    const slots = getGame().player.inventory.slots;
    if (this.invSelected >= INVENTORY_SLOTS) this.invSelected = Math.max(0, INVENTORY_SLOTS - 1);
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      const badge = this.invSlotTexts[i];
      const icon = this.invSlotIcons[i];
      const stack = slots[i];
      if (stack) {
        // Keyed by item id, never by display name — see itemIconKey().
        icon.setTexture(itemIconKey(stack.itemId)).setVisible(true);
        badge.setText(stack.quantity > 1 ? `${stack.quantity}` : '');
      } else {
        icon.setVisible(false);
        badge.setText('');
      }
    }
    // Highlight the selected cell.
    this.invCells.forEach((c, i) => {
      c.setFillStyle(i === this.invSelected ? UI.accent : 0x080c0f, i === this.invSelected ? 0.2 : 0.6);
    });
    if (this.invCountText) this.invCountText.setText(`${slots.length}/${INVENTORY_SLOTS}`);

    const selected = slots[this.invSelected];
    const cell = this.invCells[this.invSelected];
    this.invMarker.setVisible(selected !== undefined && cell !== undefined);
    if (selected && cell) placeMarkerLeftOf(this.invMarker, cell);

    if (selected) {
      const item = getItem(selected.itemId);
      const category = item.category === 'consumable' ? '消耗品' : item.category === 'material' ? '材料' : '工具';
      this.invDetailName?.setText(item.displayName);
      this.invDetailMeta?.setText(`${category} · 持有 ${selected.quantity}`);
      const effect = item.effect ? `${STAT_LABEL[item.effect.stat]} +${item.effect.amount}` : '';
      this.invDetailBody?.setText(effect || `${category}，暂时没有直接效果。`);
    } else {
      this.invDetailName?.setText('');
      this.invDetailMeta?.setText('');
      this.invDetailBody?.setText('空格子。搜刮、制作或交易都往这里放东西。');
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
    // OVERHAUL Art Pass: the pools breathe, so the light is alive rather than
    // a painted-on decal.
    this.lightLayer?.update(this.time.now);
  }

  private nearCraftStation(state: GameState): boolean {
    return state.currentFloor === STARTING_FLOOR && Math.abs(state.player.x - CRAFT_X) <= INTERACT_DISTANCE;
  }

  private drawWorkbench(): void {
    const y = FLOOR_HEIGHT - 64;
    const bench = this.add.image(CRAFT_X, y + 4, 'furn_workbench').setOrigin(0.5, 1);
    const benchLabel = this.add.text(CRAFT_X, y + 4 - bench.displayHeight - 8, '工作台', { fontFamily: 'monospace', fontSize: '11px', color: '#ece8d8' }).setOrigin(0.5);
    this.upgradeBoard = this.add.text(CRAFT_X, y + 34, '', { fontFamily: 'monospace', fontSize: '11px', color: '#77c6a4' }).setOrigin(0.5);
    this.floorObjects.push(bench, benchLabel, this.upgradeBoard);
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

    this.craftObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'yellow', PANEL_DEPTH.game.craft));
    // OVERHAUL UI: header strip instead of a centred title floating on a slab.
    this.craftObjects.push(...buildPanelHeader(this, left, top, panelW, '工作台 · 制作', UI.accent, PANEL_DEPTH.game.craft + 5));
    const title = this.add.text(cx, top + 18, '', { fontFamily: 'monospace', fontSize: '16px', color: '#f4b66a' }).setOrigin(0.5);
    this.craftObjects.push(title);

    // OVERHAUL UI: row bands + a status column.
    //
    // The old list was four lines of text inside an opaque slab — no banding, no
    // columns, nothing to anchor the eye. Each row now has its own band (alternate
    // rows tinted), a fixed-cost column and a right-aligned status, so a row reads
    // like a row instead of a sentence.
    this.craftRows = [];
    for (let i = 0; i < 4; i++) {
      const rowY = top + 30 + i * CRAFT_ROW_PITCH;
      const band = this.add.rectangle(left + 8, rowY, panelW - 16, CRAFT_ROW_PITCH - 2, UI.surfaceRaised).setOrigin(0, 0).setAlpha(0.34).setDepth(PANEL_DEPTH.game.craft + 5);
      const name = this.add.text(left + 18, rowY + 9, '', { fontFamily: 'monospace', fontSize: `${TYPE.body}px`, color: '#ece8d8' }).setOrigin(0, 0.5).setDepth(PANEL_DEPTH.game.craft + 6);
      const status = this.add.text(left + panelW - 16, rowY + 9, '', { fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: '#a8e0c8' }).setOrigin(1, 0.5).setDepth(PANEL_DEPTH.game.craft + 6);
      this.craftRows.push({ band, name, status });
      this.craftObjects.push(band, name, status);
    }
    const footer = this.add.text(cx, top + panelH - 12, '↑/↓ 选择 · Enter 制作 · C 关闭', { fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: '#77c6a4' }).setOrigin(0.5).setDepth(PANEL_DEPTH.game.craft + 6);
    this.craftObjects.push(footer, this.craftMarker);

    applyPanelDepth(this.craftObjects, PANEL_DEPTH.game.craft);
    this.assertPanelContent('craft', this.craftObjects);
    for (const o of this.craftObjects) o.setVisible(false);
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
      const row = this.craftRows[i];
      if (!row) continue;
      const entry = entries[i];
      if (!entry) {
        row.name.setText('');
        row.status.setText('');
        row.band.setAlpha(0);
        continue;
      }
      const selected = i === this.craftSelected;
      row.band.setAlpha(selected ? 0.72 : 0.3);
      row.band.setFillStyle(selected ? UI.accent : UI.surfaceRaised, 1);
      if (entry.kind === 'recipe') {
        const recipe = getRecipe(entry.id!);
        const cost = Object.entries(recipe.cost)
          .map(([id, n]) => `${getItem(id as ItemId).displayName}×${n}`)
          .join(' ');
        row.name.setText(`${recipe.displayName}  ${cost}`);
        row.name.setColor(selected ? '#f4b66a' : '#ece8d8');
        const built = hasUpgrade(state, entry.id!);
        const ok = canCraft(state, entry.id!).ok;
        row.status.setText(built ? '已建' : ok ? '可制作' : '材料不足');
        row.status.setColor(built ? '#77c6a4' : ok ? '#f4b66a' : '#8a867c');
      } else {
        const can = countItem(state.player.inventory, 'dirty_water') >= 1;
        row.name.setText('净化  脏水→净水');
        row.name.setColor(selected ? '#f4b66a' : '#ece8d8');
        row.status.setText(can ? '可净化' : '缺脏水');
        row.status.setColor(can ? '#77c6a4' : '#8a867c');
      }
    }
    const selectedRow = this.craftRows[this.craftSelected];
    this.craftMarker.setVisible(entries[this.craftSelected] !== undefined && selectedRow !== undefined);
    if (entries[this.craftSelected] && selectedRow) placeMarkerLeftOf(this.craftMarker, selectedRow.name);
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
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;

    this.pauseObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'yellow', PANEL_DEPTH.game.pause));
    this.pauseObjects.push(...buildPanelHeader(this, left, top, panelW, '已暂停', UI.accent, PANEL_DEPTH.game.pause + 5));
    const title = this.add.text(cx, top + 20, '', { fontFamily: 'monospace', fontSize: '16px', color: '#f4b66a' }).setOrigin(0.5);
    const controls = this.add.text(cx, top + 50, 'A/D 移动 · E 交互 · I 背包 · C 制作', { fontFamily: 'monospace', fontSize: '11px', color: '#77c6a4' }).setOrigin(0.5);
    this.pauseObjects.push(title, controls, this.pauseMarker);

    PAUSE_OPTIONS.forEach((label, i) => {
      const t = this.add.text(cx, top + 92 + i * 28, label, { fontFamily: 'monospace', fontSize: `${TYPE_BODY}px`, color: '#ece8d8' }).setOrigin(0.5);
      this.pauseOptionTexts.push(t);
      this.pauseObjects.push(t);
    });

    applyPanelDepth(this.pauseObjects, PANEL_DEPTH.game.pause);
    this.assertPanelContent('pause', this.pauseObjects);
    for (const o of this.pauseObjects) o.setVisible(false);
  }

  private refreshPause(): void {
    this.pauseOptionTexts.forEach((t, i) => t.setText(PAUSE_OPTIONS[i]));
    const selectedText = this.pauseOptionTexts[this.pauseSelected];
    if (selectedText) placeMarker(this.pauseMarker, selectedText);
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
      this.openTowerOverview(); // 塔楼地图
    } else if (this.pauseSelected === 2) {
      clearSave();
      startNewGame(Date.now() >>> 0); // 重新开始
      // A restart is a new run, so it goes through the character pick like any
      // other new run — otherwise the pick screen would be skippable and the
      // survivor choice would silently stop mattering.
      this.scene.start('MetaSelect');
    } else {
      this.scene.start('Menu'); // 返回标题
    }
  }

  // Opening the map hands the scene off entirely: GameScene is stopped, so the
  // survival clock stops with it, and coming back re-runs create() against the
  // same module-level GameState. Nothing about the run is reset on the way out.
  private openTowerOverview(): void {
    this.scene.start('TowerOverview');
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
        this.flash(`建造了 ${getRecipe(entry.id!).displayName}（-${ACTION_COSTS.craft} 分钟）`);
        this.chargeTime(ACTION_COSTS.craft);
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
        // B3-05.2: this used to read 「净化了 1 瓶净水」 whatever the real count was,
        // while purifyWater() converts the whole carry and reports it in
        // `converted`. A player who purified six bottles was told they got one and
        // would plan the day's water around the wrong number.
        this.flash(`净化了 ${result.converted} 瓶净水（-${ACTION_COSTS.craft} 分钟）`);
        this.chargeTime(ACTION_COSTS.craft);
      } else {
        this.flash(result.reason);
      }
    }
  }

  // B3-03: charges an action its game-time cost, then applies the same
  // consequences the frame loop would — HUD refresh, autosave, and the end-of-run
  // transition. Keeping this in one place means a cost can never be charged
  // without the clock, the save and the death check following it.
  private chargeTime(gameMinutes: number): void {
    const state = getGame();
    const tick = spendTime(state, gameMinutes);
    this.refreshClock();
    this.refreshStats();
    this.applyNightLighting();
    saveToStorage(state);
    if (tick.died || tick.won || state.status !== 'playing') {
      saveToStorage(state);
      this.scene.start('End');
    }
  }

  // ── NPCs & dialogue ─────────────────────────────────────────────────────
  private drawNpcs(): void {
    for (const npc of NPCS) {
      const who = npc.id === 'alin' ? 'npc_alin' : 'npc_xiaozhou';
      const sprite = this.add.sprite(npc.x, PLAYER_FEET_Y, walkSheetKey(who)).setOrigin(0.5, 1);
      // NPCs stand still, so they breathe on the idle clip. Without an explicit
      // play() a sprite sits on frame 0 forever, which reads as a frozen mannequin
      // rather than someone waiting to talk to you.
      sprite.play(idleAnimKey(who));
      // Same contact shadow as the player, so an NPC stands on the floor rather
      // than hovering a few pixels above it.
      const shadow = addContactShadow(this, npc.x, PLAYER_FEET_Y + 2, 26, 2, 0.5);
      const nameLabel = this.add.text(npc.x, FLOOR_HEIGHT - 68, npc.name, { fontFamily: 'monospace', fontSize: '11px', color: '#ece8d8' }).setOrigin(0.5);
      this.floorObjects.push(...shadow, sprite, nameLabel);
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

    const depth = PANEL_DEPTH.game.dialogue;
    this.dialogueObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'green', depth));
    // OVERHAUL UI: the same header strip every other panel uses, with the NPC's
    // name on it, and the message in an inset well so speech reads as speech
    // rather than as more body text.
    // Empty header title on purpose: the NPC's name is the header, and drawing a
    // static '对话' underneath it printed the two on top of each other.
    this.dialogueObjects.push(...buildPanelHeader(this, left, top, panelW, '', UI.good, depth + 5));
    // Create with placeholder content so each text's canvas/frame exists up front
    // (setText on a never-rendered empty text throws in Phaser 4).
    this.dialogueTitle = this.add
      .text(left + 10, top + 10, '对话', { fontFamily: 'monospace', fontSize: `${TYPE.title}px`, color: '#ece8d8' })
      .setOrigin(0, 0.5)
      .setDepth(depth + 6);
    this.dialogueObjects.push(...buildPanelWell(this, left + 12, top + 28, panelW - 24, 34, depth + 5));
    // dialogueTitle MUST be in the list: closeDialogue() hides everything in it,
    // and a name left out of the list stays on screen after the panel closes.
    this.dialogueObjects.push(this.dialogueTitle);
    this.dialogueMessage = this.add
      .text(cx, top + 45, '……', { fontFamily: 'monospace', fontSize: `${TYPE.body}px`, color: '#ece8d8', align: 'center', wordWrap: { width: panelW - 44 } })
      .setOrigin(0.5)
      .setDepth(depth + 7);
    this.dialogueObjects.push(this.dialogueMessage);

    this.dialogueBands = [];
    for (let i = 0; i < 4; i++) {
      const rowY = top + 74 + i * 30;
      // A selection band per row, the same language as every other list: a wash
      // plus a 2px accent rule. Toggled in refreshDialogue.
      const band = this.add.rectangle(left + 12, rowY, panelW - 24, 26, UI.accent).setOrigin(0, 0).setAlpha(0).setDepth(depth + 5);
      const rule = this.add.rectangle(left + 12, rowY, 2, 26, UI.accent).setOrigin(0, 0).setAlpha(0).setDepth(depth + 6);
      this.dialogueBands.push({ band, rule });
      this.dialogueObjects.push(band, rule);
      const icon = this.add.image(left + 30, rowY + 12, 'blank').setOrigin(0.5).setDepth(depth + 7);
      const t = this.add
        .text(left + 46, rowY + 12, '……', { fontFamily: 'monospace', fontSize: `${TYPE.body}px`, color: '#ece8d8' })
        .setOrigin(0, 0.5)
        .setDepth(depth + 7);
      this.dialogueOptionIcons.push(icon);
      this.dialogueOptions.push(t);
      this.dialogueObjects.push(icon, t);
    }
    const footer = this.add
      .text(cx, top + panelH - 12, '↑/↓ 选择 · Enter 确定 · ESC 返回', { fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: '#77c6a4' })
      .setOrigin(0.5)
      .setDepth(depth + 7);
    this.dialogueObjects.push(footer, this.dialogueMarker);

    applyPanelDepth(this.dialogueObjects, PANEL_DEPTH.game.dialogue);
    this.assertPanelContent('dialogue', this.dialogueObjects);
    for (const o of this.dialogueObjects) o.setVisible(false);
  }

  // Label + icon key per dialogue option. The icon is the item the player
  // RECEIVES (the trade's output), matching how the crafting list shows outputs;
  // 问候/询问/退出/返回 are not items and get no icon.
  private dialogueOptionsView(): Array<{ label: string; icon?: ItemId }> {
    const d = this.dialogue;
    if (!d) return [];
    if (d.level === 'main') {
      return ['问候', '询问', '交易', '退出'].map((label) => ({ label }));
    }
    const npc = getNpc(d.npc);
    return [
      ...npc.offers.map((o) => ({
        label: `用 ${getItem(o.get.itemId).displayName}×${o.get.quantity} 换 ${getItem(o.give.itemId).displayName}×${o.give.quantity}`,
        icon: o.give.itemId,
      })),
      { label: '返回' },
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
    const options = this.dialogueOptionsView();
    if (d.selected >= options.length) d.selected = options.length - 1;
    for (let i = 0; i < this.dialogueOptions.length; i++) {
      const option = options[i];
      const icon = this.dialogueOptionIcons[i];
      if (option === undefined) {
        this.dialogueOptions[i].setText('');
        icon.setVisible(false);
        continue;
      }
      this.dialogueOptions[i].setText(option.label);
      if (option.icon) icon.setTexture(itemIconKey(option.icon)).setVisible(true);
      else icon.setVisible(false);
      const selected = i === d.selected;
      this.dialogueOptions[i].setColor(selected ? '#f4b66a' : '#ece8d8');
      const b = this.dialogueBands[i];
      if (b) {
        b.band.setAlpha(selected ? 0.14 : 0);
        b.rule.setAlpha(selected ? 1 : 0);
      }
    }
    const selectedIcon = this.dialogueOptionIcons[d.selected];
    this.dialogueMarker.setVisible(options[d.selected] !== undefined);
    if (options[d.selected] && selectedIcon) placeMarkerLeftOf(this.dialogueMarker, selectedIcon);
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
        d.message = `换到了 ${getItem(offer.give.itemId).displayName}×${offer.give.quantity}（-${ACTION_COSTS.trade} 分钟）`;
        this.chargeTime(ACTION_COSTS.trade);
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
    this.keyM = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.M);
    this.keyS = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyF = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F);

    this.keyE.on('down', () => this.guard('e', this.onInteract), this);
    this.keyEsc.on('down', () => this.guard('esc', this.onEsc), this);
    this.keyI.on('down', () => this.guard('i', this.onToggleInventory), this);
    this.keyEnter.on('down', () => this.guard('enter', this.onUse), this);
    this.keyC.on('down', () => this.guard('c', this.onToggleCrafting), this);
    this.keyM.on('down', () => this.guard('m', this.onToggleMap), this);
    // OVERHAUL Wave C1: S sells inside the shop; nowhere else does anything.
    this.keyS.on('down', () => {
      if (this.encounterOpen && !getGame().combat && !this.encounter) this.shopSell();
    }, this);
    // OVERHAUL Wave C2: F buys the paid shortcut at the up stairwell.
    this.keyF.on('down', () => this.guard('f', this.tryShortcut), this);
    this.cursors.up.on('down', () => this.guard('up', this.onNavUp), this);
    this.cursors.down.on('down', () => this.guard('down', this.onNavDown), this);
  }

  // Accept a key at most once per frame (GHI-03 m9). The action has to be
  // invoked with the scene as `this` — passing a bare method reference would
  // lose it. Movement is NOT routed through here: it reads
  // cursors.left/right.isDown in update(), so holding a direction key works.
  private guard(slot: GameKey, action: () => void): void {
    const frame = this.game.getFrame();
    if (this.lastInputFrame[slot] === frame) return;
    this.lastInputFrame[slot] = frame;
    action.call(this);
  }

  private unbindInput(): void {
    // removeAllListeners per key rather than off(): the bound handlers above are
    // closures, and Phaser does not re-run field initialisers on a scene restart
    // — addKey() hands back the same Key object, so a restart would otherwise
    // stack a second set of listeners on it.
    this.keyE?.removeAllListeners();
    this.keyEsc?.removeAllListeners();
    this.keyI?.removeAllListeners();
    this.keyEnter?.removeAllListeners();
    this.keyC?.removeAllListeners();
    this.keyM?.removeAllListeners();
    this.keyS?.removeAllListeners();
    this.keyF?.removeAllListeners();
    this.cursors?.up.removeAllListeners();
    this.cursors?.down.removeAllListeners();
  }

  private onToggleMap(): void {
    if (this.inventoryOpen || this.craftingOpen || this.dialogueOpen || this.pauseOpen || this.encounterOpen) return;
    this.openTowerOverview();
  }

  private onToggleInventory(): void {
    if (this.craftingOpen || this.dialogueOpen || this.pauseOpen || this.encounterOpen) return;
    this.toggleInventory();
  }

  private onEsc(): void {
    // OVERHAUL Wave A: ESC mid-fight is the retreat — it runs the flee round
    // rather than walking away for free, so the choice has a cost.
    if (this.encounterOpen && getGame().combat && !this.combatDone) {
      this.combatSelected = 2; // flee
      this.activateCombatChoice();
      return;
    }
    // OVERHAUL Wave C1: the shop is open (no combat, no encounter object).
    if (this.encounterOpen && !getGame().combat && !this.encounter) {
      this.closeShop();
      return;
    }
    if (this.encounterOpen) {
      // Leaving an unresolved encounter is the walk-away: no cost, no
      // consumption. A resolved one just closes the outcome panel.
      this.closeEncounter();
      return;
    }
    if (this.inventoryOpen) this.toggleInventory();
    else if (this.craftingOpen) this.toggleCrafting();
    else if (this.dialogueOpen) this.dialogueBack();
    else this.togglePause();
  }

  private onNavUp(): void {
    // OVERHAUL Wave C1: the shop's cursor.
    if (this.encounterOpen && !getGame().combat && !this.encounter) {
      this.shopSelected = Math.max(0, this.shopSelected - 1);
      this.buildShopPanel();
      return;
    }
    if (this.encounterOpen && getGame().combat && !this.combatDone) {
      this.combatSelected = Math.max(0, this.combatSelected - 1);
      this.buildCombatPanel();
    } else if (this.encounterOpen && this.encounter && !this.encounter.resolved) {
      this.encounter.selected = Math.max(0, this.encounter.selected - 1);
      this.buildEncounterPanel(this.spotMarkers.get(this.encounter.spotId)?.isBoss ?? false);
    } else if (this.inventoryOpen) {
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
    // OVERHAUL Wave C1: the shop's cursor.
    if (this.encounterOpen && !getGame().combat && !this.encounter) {
      this.shopSelected = Math.min(this.shopEntries.length - 1, this.shopSelected + 1);
      this.buildShopPanel();
      return;
    }
    if (this.encounterOpen && getGame().combat && !this.combatDone) {
      this.combatSelected = Math.min(2, this.combatSelected + 1);
      this.buildCombatPanel();
    } else if (this.encounterOpen && this.encounter && !this.encounter.resolved) {
      this.encounter.selected = Math.min(this.encounter.choices.length - 1, this.encounter.selected + 1);
      this.buildEncounterPanel(this.spotMarkers.get(this.encounter.spotId)?.isBoss ?? false);
    } else if (this.inventoryOpen) {
      const count = getGame().player.inventory.slots.length;
      this.invSelected = Math.min(Math.max(0, count - 1), this.invSelected + 1);
      this.refreshInventory();
    } else if (this.craftingOpen) {
      const count = this.craftEntries().length;
      this.craftSelected = Math.min(Math.max(0, count - 1), this.craftSelected + 1);
      this.refreshCraft();
    } else if (this.dialogueOpen && this.dialogue) {
      const count = this.dialogueOptionsView().length;
      this.dialogue.selected = Math.min(Math.max(0, count - 1), this.dialogue.selected + 1);
      this.refreshDialogue();
    } else if (this.pauseOpen) {
      this.pauseSelected = Math.min(PAUSE_OPTIONS.length - 1, this.pauseSelected + 1);
      this.refreshPause();
    }
  }

  private onUse(): void {
    // OVERHAUL Wave A: the fight's turn key. Once the outcome screen is up,
    // Enter closes it; until then it plays the selected action.
    if (this.encounterOpen && getGame().combat) {
      if (this.combatDone) this.closeCombat();
      else this.activateCombatChoice();
      return;
    }
    // OVERHAUL Wave C1: Enter in the shop buys one of the highlighted item.
    if (this.encounterOpen && !this.encounter) {
      this.shopBuy();
      return;
    }
    if (this.encounterOpen) {
      if (this.encounter?.resolved) this.closeEncounter();
      else this.activateEncounterChoice();
      return;
    }
    if (this.inventoryOpen) {
      const stack = getGame().player.inventory.slots[this.invSelected];
      if (!stack) return;
      const result = useConsumable(getGame(), stack.itemId);
      if (result.ok) {
        saveToStorage(getGame());
        this.refreshInventory();
        this.refreshStats();
        this.flash(`使用 ${getItem(stack.itemId).displayName} · ${STAT_LABEL[result.stat!]} +${Math.round(result.amount!)}`);
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
    // OVERHAUL: a "?" in reach is the first thing E reaches for — the floor's
    // rumour beats its containers for attention, the way ALTACIMA's question
    // marks pull the player across a room. The trader's spot id is 'shop'.
    const spot = this.nearestEncounterSpot();
    if (spot === 'shop') {
      this.openShop();
      return;
    }
    if (spot) {
      this.openEncounter(spot);
      return;
    }
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

  // ── the paid shortcut (OVERHAUL Wave C2) ─────────────────────────────────
  // F at the up stairwell buys a 2-4 floor skip. Centum's formula: the price
  // climbs with every use, so skipping is a budget decision, not free
  // fast-travel. The charge happens before the jump, so a broke player never
  // moves.
  private tryShortcut(): void {
    const state = getGame();
    if (state.status !== 'playing') return;
    const top = Math.max(...PLAYABLE_FLOORS_V01);
    if (!shortcutAvailable(state.currentFloor, top)) {
      this.flash('这里没有可抄的近路');
      return;
    }
    const zone = currentInteractionZone(state);
    if (zone !== 'up') {
      this.flash('要走上楼口才能抄近路');
      return;
    }
    const salt = (state.runSeed ^ (state.day * 7919) ^ (state.currentFloor * 104729)) >>> 0;
    const skip = Math.min(shortcutSkip(salt), top - state.currentFloor);
    const price = shortcutPrice(state.currentFloor, skip, timesTaken(state), salt);
    if (!charge(state, price)) {
      this.flash(`抄近路要 ${price} 金，你只有 ${state.player.gold}`);
      return;
    }
    recordShortcut(state);
    // Apply the jump through the same path a stair uses, then walk the rest.
    const target = Math.min(top, state.currentFloor + skip);
    while (state.currentFloor < target) {
      const r = tryChangeFloor(state, 1);
      if (!r.ok) break;
    }
    recordDepth(state);
    this.clearFloor();
    this.drawFloor();
    saveToStorage(state);
    this.cameras.main.flash(180, 0, 0, 0);
    this.flash(`你抄近路跳到了第 ${state.currentFloor} 层（-${price} 金）`);
    playSfx('goal');
  }

  // A panel with a frame but no readable content is the worst failure mode the
  // UI can produce: it looks like the game broke. This runs in dev only and
  // names the panel in the console the moment it opens empty, so a report of
  // "a big empty box appeared" becomes a one-line diagnosis instead of a hunt.
  private assertPanelContent(panel: string, objects: PanelObject[]): void {
    if (!import.meta.env.DEV) return;
    const readable = objects.some(
      (o) => o instanceof Phaser.GameObjects.Text && o.visible && (o.text ?? '').trim().length > 0,
    );
    if (!readable) console.warn(`[ui] panel "${panel}" opened with no visible text — it will look like an empty box`);
  }

  // What the foot bar should say while a panel is open: the panel's own keys.
  // Returns null when no panel is open, so the world hint can take over.
  private openPanelHint(): string | null {
    const combat = getGame().combat;
    if (this.encounterOpen && combat) return '↑/↓ 选择 · Enter 出招 · ESC 撤退';
    if (this.encounterOpen && this.encounter) return '↑/↓ 选择 · Enter 确认 · ESC 离开';
    if (this.encounterOpen) return '↑/↓ 选择 · Enter 买入 · S 卖出 · ESC 离开';
    if (this.inventoryOpen) return '↑/↓ 选择 · Enter 使用 · I 关闭';
    if (this.craftingOpen) return '↑/↓ 选择 · Enter 制作 · C 关闭';
    if (this.dialogueOpen) return '↑/↓ 选择 · Enter 确定 · ESC 返回';
    if (this.pauseOpen) return '↑/↓ 选择 · Enter 确认 · ESC 继续';
    return null;
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
    else if (result.full) {
      // B3-16: the bag takes mergeable stacks and refuses new ones, and nothing
      // on screen said so — the playtest found players discovering the rule by
      // being refused three times. Name which half happened.
      this.flash(
        result.took.length > 0
          ? '叠放进的已入包；新物品放不下（背包已满），剩余留在容器'
          : '背包已满：新物品放不下，能叠进已有堆的才能进包',
      );
    } else {
      // OVERHAUL: a chest thunk for opening a container, distinct from the
      // ground pickup's lighter blip — the container is the bigger event.
      playSfx('chest');
      // 420ms against the clip's 333ms: a frame overrun (scene switch, save,
      // hitch) must not cut the bend in half.
      this.playActionAnim(searchAnimKey('player'), 420);
      this.flash(`获得 ${result.took.map((s) => `${getItem(s.itemId).displayName}×${s.quantity}`).join('、')}（-${ACTION_COSTS.searchContainer} 分钟）`);
      this.chargeTime(ACTION_COSTS.searchContainer);
    }
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
        this.flash(`拾取 ${getItem(r.took.itemId).displayName}×${r.took.quantity}（-${ACTION_COSTS.pickupGround} 分钟）`);
        this.chargeTime(ACTION_COSTS.pickupGround);
      } else if (r.full) {
        this.flash('背包已满：新物品放不下，能叠进的堆才能拾取');
      }
    }
  }

  private changeFloor(direction: 1 | -1): void {
    const result = tryChangeFloor(getGame(), direction);
    if (result.ok) {
      this.clearFloor();
      this.drawFloor(); // records the visit for the floor just entered...
      // OVERHAUL: a new deepest floor is the run's headline number, so the
      // record is taken the moment the floor changes rather than at scoring.
      recordDepth(getGame());
      // OVERHAUL Wave B: depth is also the meta-progression currency — the
      // moment a new survivor is earned, the run says so, because "who can I
      // play next" is the reason to start another run.
      const meta = loadMeta();
      const gained = applyDepth(meta, getGame().currentFloor);
      if (gained.length > 0) {
        saveMeta(unlockFromDepth(meta, getGame().currentFloor));
        playSfx('goal');
        this.flash(`新幸存者解锁：${gained.map((c) => CHARACTER_NAMES[c] ?? c).join('、')}！回标题可更换`);
      }
      // B3-15: a dwell-rolled wanderer belongs to the floor it was rolled on.
      // Leaving is the escape, so the event must not follow the player up the
      // stairs and squat in the day's single event slot.
      const we = getGame().worldEvents;
      if (we.activeEvent?.source === 'dwell') we.activeEvent = null;
      saveToStorage(getGame()); // ...so the save that follows includes it
      this.cameras.main.flash(180, 0, 0, 0); // transition through black
    } else {
      this.flash(result.reason === 'top' ? '已到顶层' : '已到尽头');
    }
  }

  // B3-15: rolls dwell pressure and applies the outcome. Pure logic lives in
  // systems/dwellPressure.ts; this is the side-effect half (flash + the
  // wanderer event). The roll happens before the next one is armed so the
  // first roll on a floor uses the gentlest table row.
  private updateDwellPressure(state: GameState, minutes: number): void {
    if (state.status !== 'playing') return;
    const dwell = ensureDwell(state);
    tickDwell(dwell, state.currentFloor, minutes);
    if (isDwellExempt(state.currentFloor)) return;
    if (state.worldEvents.activeEvent) return; // one event at a time
    if (!dwellRollDue(dwell)) return;
    const outcome = rollDwellEvent(state, dwell, state.currentFloor);
    armNextRoll(dwell);
    if (outcome.kind === 'prowler') {
      state.worldEvents.activeEvent = {
        type: 'wanderer',
        floor: state.currentFloor,
        source: 'dwell',
        message: outcome.message,
      };
      state.worldEvents.history.push(`day${state.day}:dwell`);
      playSfx('danger');
      this.flash(outcome.message);
    } else if (outcome.kind === 'atmosphere') {
      this.flash(outcome.message);
    } else if (outcome.kind === 'scout') {
      // No monster — a sighting. The next roll on this floor is more likely to
      // be teeth, so this is the warning shot the player should read as "move".
      this.flash(outcome.message);
    }
  }

  // Keeps the standing bag-full warning in step with the bag. Runs before the
  // panel early-return below on purpose: a full bag matters most while the
  // inventory panel is open, which is exactly when the player is looking for
  // something to spend.
  private refreshBagFullWarning(): void {
    const full = isBagFull(getGame().player.inventory);
    if (full === this.bagFullShown) return;
    this.bagFullShown = full;
    this.bagFullText.setVisible(full);
  }

  // ── frame ──────────────────────────────────────────────────────────────
  override update(_time: number, delta: number): void {
    this.refreshBagFullWarning();
    if (this.inventoryOpen || this.craftingOpen || this.dialogueOpen || this.pauseOpen || this.encounterOpen) return;
    const state = getGame();

    // B3-01 D9: a rejected write used to be silent, so a full disk or a private
    // window lost the run without a word. The count only grows, so comparing it
    // against what we last saw turns any failed save — autosave, craft, trade,
    // sleep, floor change — into exactly one warning.
    const failures = saveFailureCount();
    if (failures > this.lastSaveFailures) {
      this.lastSaveFailures = failures;
      this.flash('存档失败：进度不会被保留（浏览器存储不可用）');
    }

    let dir = 0;
    if (this.cursors?.left.isDown || this.wasd?.left.isDown) dir -= 1;
    if (this.cursors?.right.isDown || this.wasd?.right.isDown) dir += 1;
    // The speed is ramped rather than switched, so a tap of the key moves a
    // shorter distance than it used to and the run feels like it has weight.
    // OVERHAUL: an empty energy tank slows the walk (0.75x), so "how far can I
    // get" is budgeted by food and rest. Wave B3's swift-feet relic then makes
    // the corridors 15% shorter. The factors apply to the ramped speed, not to
    // dx, so the anim's speedFraction follows the real walk.
    this.speedX = stepHorizontalSpeed(this.speedX, dir, delta) * moveSpeedFactor(state.player) * moveSpeedMult(state.relics ?? []);
    const dx = this.speedX * (delta / 1000);
    if (dx !== 0) movePlayerX(state, dx);
    this.player.x = state.player.x;
    // The shadow is its own objects (three stacked ellipses), so it has to be
    // carried along instead of being a child of the sprite.
    for (const o of this.playerShadow) (o as Phaser.GameObjects.Rectangle).x = state.player.x;

    // The walk cycle carries all the vertical motion now — the poses' own hip
    // bob, not a sine wave bolted on top. What is left to do here is pick the
    // clip, face it, and lock the playback rate to the actual speed so the feet
    // do not skate while the player is still on the acceleration ramp.
    if (dir !== 0) this.player.setFlipX(dir < 0);
    // OVERHAUL: a one-shot action clip holds the sprite until its timer runs
    // out; the walk/idle pick below only runs once the clip is over.
    if (this.time.now < this.actionAnimUntil && this.player.anims.currentAnim?.key === this.actionAnimKey) {
      // clip still playing
    } else {
      const speedFraction = Math.abs(this.speedX) / PLAYER_SPEED;
      const want = speedFraction > 0.03 ? walkAnimKey('player') : idleAnimKey('player');
      if (this.player.anims.currentAnim?.key !== want) this.player.play(want, true);
      this.player.anims.timeScale = Math.max(0.2, Math.min(1, speedFraction));
    }

    const tick = advanceTime(state, delta);
    const rolled = ensureNightEvent(state);
    if (rolled.rolled && rolled.event) {
      if (rolled.event.type === 'wanderer') playSfx('danger');
      this.flash(rolled.event.message);
    }
    // B3-15: dwell pressure — the longer the player lingers on one floor, the
    // more likely the next roll is teeth. Runs after the night roll so a night
    // event already occupying the day's slot suppresses the prowler (an
    // atmosphere roll can still fire).
    this.updateDwellPressure(state, tick.gameMinutes);
    // OVERHAUL: settle the day's objective the moment its condition holds —
    // reward fires once, with the fanfare, so finishing it feels like an event
    // rather than a silent counter.
    ensureDailyGoal(state);
    if (isDailyGoalDone(state) && !state.dailyGoal?.done) {
      grantDailyGoalReward(state);
      playSfx('goal');
      this.flash('今日目标完成！分数 +' + GAME_CONFIG.overhaul.dailyGoalRewardScore + '，获得口粮×1');
    }
    // The low-HP vignette rides the pulse function every frame.
    this.vignette?.setAlpha(lowHpPulse(state.player.hp, GAME_CONFIG.player.hpMax, this.time.now));
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

    // OVERHAUL interaction: the hint used to describe the WORLD even while a
    // panel covered it, so the bar read "按 E 查看问号点" underneath an open
    // inventory - it promised an interaction the player could not perform and
    // said nothing about the one they were in. A panel owns the bar now.
    const panelHint = this.openPanelHint();
    if (panelHint !== null) {
      this.hintText.setText(panelHint);
      return;
    }

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
    if (this.nearestEncounterSpot()) this.hintText.setText('按 E 查看问号点');
    else if (container) this.hintText.setText(`按 E 打开 ${container.label}`);
    // OVERHAUL Wave C2: the up stairwell advertises the paid shortcut, priced
    // live so the player can decide before spending.
    else if (zone === 'up' && shortcutAvailable(state.currentFloor, Math.max(...PLAYABLE_FLOORS_V01))) {
      const salt = (state.runSeed ^ (state.day * 7919) ^ (state.currentFloor * 104729)) >>> 0;
      const price = shortcutPrice(state.currentFloor, shortcutSkip(salt), timesTaken(state), salt);
      this.hintText.setText(`按 E 上楼 · F 抄近路（${price} 金）`);
    }
    else if (zone === 'up') this.hintText.setText('按 E 上楼');
    else if (zone === 'down') this.hintText.setText('按 E 下楼');
    else this.hintText.setText('A/D 或 ←/→ 移动 · E 交互 · I 背包 · ESC 菜单');
  }

  // The wanderer only haunts its own floor; it is slower than the player and
  // chips HP on a cooldown, so outrunning it or leaving the floor always works.
  // B3-15: a dwell-rolled wanderer acts day or night — the pressure comes from
  // lingering, not from the clock, so gating it on night would let a player
  // idle safely until dark.
  private updateWanderer(delta: number): void {
    const state = getGame();
    const event = state.worldEvents.activeEvent;
    const active =
      event?.type === 'wanderer' &&
      state.currentFloor === event.floor &&
      (isNight(state.gameMinuteOfDay) || event.source === 'dwell');
    if (!active) {
      if (this.wanderer) {
        this.wanderer.destroy();
        this.wanderer = undefined;
        this.wandererAI = undefined;
      }
      return;
    }
    if (!this.wanderer) {
      const spawnX = state.player.x < FLOOR_WIDTH / 2 ? FLOOR_WIDTH - 48 : 48;
      this.wanderer = this.add.sprite(spawnX, PLAYER_FEET_Y, walkSheetKey('wanderer')).setOrigin(0.5, 1);
      this.wanderer.play(walkAnimKey('wanderer'));
      this.wandererAI = freshWandererAI(spawnX);
    }
    const ai = this.wandererAI;
    // OVERHAUL: the state machine drives the speed. Standing within its range
    // for a second and a half earns a 2.2x lunge — the walk-away escape still
    // works, but standing still is now genuinely fatal, which is the whole
    // point of the rework (B3-06 measured the old "only kills the stationary"
    // as a design bug, not a feature).
    ai!.selfX = this.wanderer.x;
    const step = stepWandererAI(ai!, state.player.x, delta);
    const dir = Math.sign(state.player.x - this.wanderer.x);
    if (dir !== 0) this.wanderer.x += dir * WANDERER_SPEED * step.speedMultiplier * (delta / 1000);
    // A lunge hit lands double: the wind-up is the tell, the lunge is the bill.
    const damage = ai!.state === 'lunge' ? WANDERER_DAMAGE * 2 : WANDERER_DAMAGE;
    if (Math.abs(this.wanderer.x - state.player.x) <= 12 && this.time.now - this.wandererHitAt >= WANDERER_HIT_COOLDOWN_MS) {
      this.wandererHitAt = this.time.now;
      state.player.hp = Math.max(0, state.player.hp - damage);
      this.refreshStats();
      this.playActionAnim(hurtAnimKey('player'), 400);
      playSfx('hurt');
      this.cameras.main.shake(160, 0.008);
      this.cameras.main.flash(140, 230, 109, 99); // red damage flash
      this.flash(`被巡游体击中！HP -${damage}，快回宿舍或换层！`);
      if (state.player.hp <= 0) state.status = 'lost';
    }
  }
}
