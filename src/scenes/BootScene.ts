import Phaser from 'phaser';
import { generateAllPixelArt } from '../render/pixelArt';
import { createCharacterAnimations, FRAME_H, FRAME_W, WALK_CHARACTERS, walkSheetKey } from '../render/walkcycle';
import { createFxAnims, loadFx } from '../render/fx';
import { WEAPONS, WEAPON_IDS } from '../data/weapons';
import { FONT_FAMILY } from '../render/uiKit';
import { buildPanel } from '../render/panels';
import { framedButton } from '../render/pointer';
import { ROLE, TEXT, hex } from '../render/palette.ts';

// Drop-in painted art, resolved at BUILD time by Vite's glob so a folder that is
// empty costs nothing and a missing file can never 404 in the loader.
//
// This is the hand-off point for real art: a painted character sheet or a
// corridor wall placed in src/assets/ replaces the procedural version with no
// code change, because bakeWalkSheets() already skips a texture key that exists.
// The glob is empty until files are added, which is why the game still boots.
const CUSTOM_CHARACTER_SHEETS = import.meta.glob('../assets/characters/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const CUSTOM_ENV = import.meta.glob('../assets/env/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
import { ART_BANNER_LOSE_KEY, ART_BANNER_WIN_KEY, ART_SLOT_KEY, CHARACTER_FILES, DECO_FILES, ENV_FILES, ENV_FLOOR_KEY, ENV_WALL_KEY, FURNITURE_FILES, ITEM_ICON_FILES, PORTRAIT_FILES, TITLE_BG_KEY, portraitKey } from '../render/artpack';

// ── AG-75: boot robustness ─────────────────────────────────────────────────
// A title screen that never appears is the worst failure a game can ship: the
// player sees a black canvas (or Phaser's green __MISSING placeholder) and has
// no way back. Three guards live here, all in this scene because Boot is the
// one scene that always runs first:
//
//   1. Loading feedback + FILE_LOAD_ERROR capture. A file that 404s used to be
//      a silent console line; now the boot screen says so, and a failed bake
//      gets a visible panel with a retry button instead of a dead canvas.
//   2. A scene.start() guard. If any scene's create() throws, the exception
//      used to unwind into Phaser's step loop with the new scene half-built —
//      a frozen screen with no recovery. The guard catches it, flashes the
//      camera and falls back to the menu.
//   3. A one-reload last resort (sessionStorage-flagged) for the case where
//      the menu itself will not build — better a single reload than an
//      infinite reload loop.
const BOOT_RELOAD_KEY = 'floor100000.boot.reload-guard';

/** True once the SceneManager patch is in place; a Boot restart must not double-wrap. */
let sceneStartGuardInstalled = false;

function reloadOnce(): void {
  try {
    if (sessionStorage.getItem(BOOT_RELOAD_KEY)) {
      // Already reloaded once this session and the menu still will not start:
      // reloading again would only loop. Stay put; the console has the error.
      console.error('[boot] the menu will not start even after one reload; giving up instead of looping');
      return;
    }
    sessionStorage.setItem(BOOT_RELOAD_KEY, '1');
    window.location.reload();
  } catch {
    // sessionStorage unavailable (private mode): a reload is still strictly
    // better than leaving the player on a frozen screen.
    window.location.reload();
  }
}

function installSceneStartGuard(game: Phaser.Game): void {
  if (sceneStartGuardInstalled) return;
  sceneStartGuardInstalled = true;
  const manager = game.scene;
  const start = manager.start.bind(manager) as (key: string, data?: object) => void;
  let fallingBack = false;
  manager.start = ((key: string, data?: object): void => {
    try {
      start(key, data);
    } catch (err) {
      console.error(`[boot] scene.start('${key}') threw; falling back to the menu`, err);
      if (fallingBack) {
        // The fallback itself threw (the menu is what is broken): last resort.
        reloadOnce();
        return;
      }
      fallingBack = true;
      try {
        start('Menu');
        // A red flash says "something went wrong" without a word of text — the
        // menu that appears is self-explanatory. Read the camera off the menu
        // scene (Game carries no cameras of its own); a menu that failed to
        // boot has no camera to flash, which is the reload path's problem.
        const menu = manager.getScene('Menu');
        menu?.cameras.main.flash(500, 0xe5, 0x6d, 0x63);
      } catch {
        reloadOnce();
      } finally {
        fallingBack = false;
      }
    }
  }) as typeof manager.start;
}

// Bakes all procedural pixel-art textures, loads the licensed UI pack
// (GHI-04), then shows the title menu (开始新游戏 / 继续游戏 / 操作说明 / 关于).
//
// The 15 item icons and the panel frames are NOT procedural: they come from the
// art pack in public/assets/artpack (see tools/build-artpack.mjs, which slices
// and downscales them out of the source sheets). Each icon is loaded under its
// own item id, so itemIconKey() stays the identity function and no call site has
// to know where the art came from.
export class BootScene extends Phaser.Scene {
  /** AG-75: files the loader could not fetch. Recorded, never thrown. */
  private loadErrors: string[] = [];
  /** AG-75: the boot-time progress line and bar, alive only during preload. */
  private bootText?: Phaser.GameObjects.Text;
  private bootBar?: Phaser.GameObjects.Graphics;
  private readonly bootBarW = 240;
  /** AG-75: the failure panel's objects (retry / enter-anyway buttons). */
  private failObjects: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('Boot');
  }

  preload(): void {
    // AG-75: a visible boot. Files that fail are collected instead of logged
    // and forgotten, and the progress line replaces the silent black canvas
    // while the (locally fast, cold-cache slow) queue drains.
    this.loadErrors = [];
    // String event names, not the Phaser.Loader.Events constants: the typings
    // union those constants with the config object type, which does not fit
    // EventEmitter.on()'s string parameter.
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      // File.key is string|object in the typings (a multi-file entry keys by
      // object); only the string form names anything a human can act on.
      const key = typeof file.key === 'string' ? file.key : String(file.url);
      this.loadErrors.push(key);
    });
    this.load.on('progress', (value: number) => this.refreshBootProgress(value));
    this.bootText = this.add
      .text(640, 380, '正在加载… 0%', { fontFamily: FONT_FAMILY, fontSize: '24px', color: hex(TEXT.secondary) })
      .setOrigin(0.5)
      .setDepth(10);
    this.bootBar = this.add.graphics().setDepth(10);
    this.drawBootBar(0);

    // CC0 1.0, Kenney (kenney.nl) — see THIRD_PARTY_NOTICES.md.
    this.load.image('ui-marker', 'assets/ui/marker.png');
    this.load.image(ART_SLOT_KEY, 'assets/ui/slot.png');

    // pixelfx effect sheets: combat impacts, pickups and the animated lights.
    loadFx(this);

    // The panel frame is eight pieces rather than a nine-slice texture — see the
    // note in render/panels.ts for why Phaser 4 makes a NineSlice unusable here.
    for (const accent of ['green', 'yellow'] as const) {
      for (const part of ['tl', 'tr', 'bl', 'br', 'top', 'bottom', 'left', 'right'] as const) {
        this.load.image(`ui-frame-${accent}-${part}`, `assets/ui/frame-${accent}-${part}.png`);
      }
    }
    // The 2026-11-15 frames: the pack ships each one as a single 96x96 image, so
    // these live in a subdirectory with the eight slices already cut (see
    // tools notes: 96x96 scaled 3.5x puts its 8px border exactly on PANEL_SLICE).
    for (const theme of ['dialogue', 'item', 'tower'] as const) {
      for (const part of ['tl', 'tr', 'bl', 'br', 'top', 'bottom', 'left', 'right'] as const) {
        this.load.image(`ui-frame-${theme}-${part}`, `assets/ui/frame-${theme}/frame-${theme}-${part}.png`);
      }
    }

    for (const [id, file] of Object.entries(ITEM_ICON_FILES)) {
      this.load.image(id, `assets/artpack/${file}`);
    }

    for (const weaponId of WEAPON_IDS) {
      const weapon = WEAPONS[weaponId];
      if (weapon.spriteFile) this.load.image(weapon.spriteKey, `assets/weapons/${weapon.spriteFile}`);
    }

    for (const [key, file] of Object.entries(FURNITURE_FILES)) {
      this.load.image(key, `assets/artpack/${file}`);
    }

    // The four characters are drawn by tools/build-characters.mjs, not baked here.
    for (const [key, file] of Object.entries(CHARACTER_FILES)) {
      this.load.image(key, `assets/artpack/${file}`);
    }

    // 96x96 dialogue busts. Loaded under `portrait-*`, never under the character
    // id: the walk sheet and the bust are different views of the same person and
    // swapping one for the other by accident would show a profile in a dialogue
    // box. 1:1 at 96px with pixelArt:true, so no resampling.
    for (const [key, file] of Object.entries(PORTRAIT_FILES)) {
      this.load.image(portraitKey(key as keyof typeof PORTRAIT_FILES), `assets/ui/portraits/${file}`);
    }

    // The room's wall and floor: single wide images, not 16x16 tiles.
    for (const [key, file] of Object.entries(ENV_FILES)) {
      this.load.image(key, `assets/env/${file}`);
    }

    // The eight wall fixtures, shown 1:1 in the close-up archive (key L).
    for (const [key, file] of Object.entries(DECO_FILES)) {
      this.load.image(key, `assets/deco/${file}`);
    }

    // The title screen's painted backdrop. MenuScene falls back to the
    // procedural tower when this texture is missing, so a stripped build still
    // boots — the load failure just logs.
    //
    // The -2x file is the same render pre-resized to 1280x720 — exactly the
    // canvas's 640x360 at the page's 2x display scale, so the title screen shows
    // the painting with no resampling at all. Shipping the 1672x941 original and
    // letting the renderer squeeze it into 640x360 costs visible mush.
    this.load.image(TITLE_BG_KEY, 'assets/title/dorm-corridor-2x.png');

    this.load.image(ART_BANNER_WIN_KEY, 'assets/artpack/banner-win.png');
    this.load.image(ART_BANNER_LOSE_KEY, 'assets/artpack/banner-lose.png');

    // Painted overrides, if any have been dropped in.
    for (const [path, url] of Object.entries(CUSTOM_CHARACTER_SHEETS)) {
      const who = path.split('/').pop()?.replace(/\.png$/, '') ?? '';
      if (!(WALK_CHARACTERS as readonly string[]).includes(who)) continue;
      this.load.spritesheet(walkSheetKey(who as (typeof WALK_CHARACTERS)[number]), url, {
        frameWidth: FRAME_W,
        frameHeight: FRAME_H,
      });
    }
    // The wall and floor are single wide images, so an override is a plain
    // texture swap under the same key the scene already asks for.
    for (const [path, url] of Object.entries(CUSTOM_ENV)) {
      const name = path.split('/').pop()?.replace(/\.png$/, '') ?? '';
      if (name === 'wall') this.load.image(ENV_WALL_KEY, url);
      if (name === 'floor') this.load.image(ENV_FLOOR_KEY, url);
    }
  }

  create(): void {
    // The guard first: everything after this point that starts a scene is
    // covered by it.
    installSceneStartGuard(this.game);

    try {
      generateAllPixelArt(this);
      createCharacterAnimations(this);
      createFxAnims(this);
    } catch (err) {
      // A failed bake used to leave the black canvas forever: create() threw,
      // scene.start('Menu') never ran, and nothing on screen said why.
      console.error('[boot] procedural bake failed', err);
      this.showBootFailure('游戏资源生成失败', err instanceof Error ? err.message : String(err), []);
      return;
    }

    this.clearBootProgress();

    if (this.loadErrors.length > 0) {
      // Non-fatal by design — every missing file has a fallback (the title
      // backdrop drops to the procedural tower, and so on) — but a broken
      // install is still a broken install, and the player gets to see it and
      // choose: retry, or continue on fallbacks.
      console.warn('[boot] files failed to load; fallbacks in place:', this.loadErrors);
      this.showBootFailure('部分资源加载失败', '以下文件没有加载成功，游戏会使用备用资源继续。', this.loadErrors, true);
      return;
    }

    // A clean boot clears the one-reload flag, so a genuinely new failure later
    // in the session still gets its single reload.
    try {
      sessionStorage.removeItem(BOOT_RELOAD_KEY);
    } catch {
      // private mode: the flag simply never persists
    }
    this.scene.start('Menu');
  }

  // ── AG-75: boot progress ──────────────────────────────────────────────

  private refreshBootProgress(value: number): void {
    if (this.bootText) this.bootText.setText(`正在加载… ${Math.round(value * 100)}%`);
    this.drawBootBar(value);
  }

  private drawBootBar(value: number): void {
    const bar = this.bootBar;
    if (!bar) return;
    bar.clear();
    bar.fillStyle(ROLE.surfaceRaised, 0.9);
    bar.fillRect(640 - this.bootBarW / 2, 404, this.bootBarW, 8);
    bar.fillStyle(ROLE.accent, 1);
    bar.fillRect(640 - this.bootBarW / 2, 404, Math.max(0, Math.round(this.bootBarW * value)), 8);
  }

  private clearBootProgress(): void {
    this.bootText?.destroy();
    this.bootText = undefined;
    this.bootBar?.destroy();
    this.bootBar = undefined;
  }

  // ── AG-75: the visible failure panel ──────────────────────────────────

  /**
   * The "never a white screen" panel: what failed, why it matters, and a way
   * forward. `allowContinue` adds the 仍要进入 button for the non-fatal case
   * (missing files with fallbacks); a failed bake offers only 重试, because
   * entering the menu on broken procedural art is not a kindness.
   */
  private showBootFailure(title: string, detail: string, failed: string[], allowContinue = false): void {
    this.clearBootProgress();
    const { width, height } = this.cameras.main;
    const cx = width / 2;
    const cy = height / 2;

    this.failObjects.push(...buildPanel(this, cx, cy, 560, 320, 'yellow', 100));
    this.failObjects.push(
      this.add
        .text(cx, cy - 120, title, { fontFamily: FONT_FAMILY, fontSize: '30px', color: hex(ROLE.danger) })
        .setOrigin(0.5)
        .setDepth(102),
    );
    this.failObjects.push(
      this.add
        .text(cx, cy - 76, detail, { fontFamily: FONT_FAMILY, fontSize: '20px', color: hex(TEXT.secondary), wordWrap: { width: 480, useAdvancedWrap: true }, align: 'center' })
        .setOrigin(0.5)
        .setDepth(102),
    );
    if (failed.length > 0) {
      this.failObjects.push(
        this.add
          .text(cx, cy - 24, `缺失文件（${failed.length}）：${failed.slice(0, 4).join('、')}${failed.length > 4 ? ' …' : ''}`, {
            fontFamily: FONT_FAMILY,
            fontSize: '16px',
            color: hex(TEXT.dim),
            wordWrap: { width: 480, useAdvancedWrap: true },
            align: 'center',
          })
          .setOrigin(0.5)
          .setDepth(102),
      );
    }
    this.failObjects.push(
      this.add
        .text(cx, cy + 46, '重试会重新加载全部资源。', { fontFamily: FONT_FAMILY, fontSize: '16px', color: hex(TEXT.dim) })
        .setOrigin(0.5)
        .setDepth(102),
    );
    const buttonColors = { fill: ROLE.surface, line: ROLE.line, text: hex(TEXT.primary), hover: ROLE.surfaceRaised };
    if (allowContinue) {
      this.failObjects.push(
        ...framedButton(this, cx - 160, cy + 84, 140, 36, '仍要进入', 104, () => this.scene.start('Menu'), buttonColors),
        ...framedButton(this, cx + 20, cy + 84, 140, 36, '重试', 104, () => this.scene.restart(), buttonColors),
      );
    } else {
      this.failObjects.push(
        ...framedButton(this, cx - 70, cy + 84, 140, 36, '重试', 104, () => this.scene.restart(), buttonColors),
      );
    }
  }
}
