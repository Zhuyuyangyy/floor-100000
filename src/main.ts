import Phaser from 'phaser';
import { createGameConfig } from './core/gameConfig';
import { getGame, hasGame } from './core/session';
import { unlockAudio } from './render/audio';
import { FONT_FACES } from './render/uiKit';

/**
 * Phaser creates a Text's canvas once and measures it against whatever font is
 * installed at that moment. Start the game before the webfont arrives and every
 * label keeps the fallback's metrics even after the correct glyphs appear —
 * clipped rows, off-centre titles, wrong wrap points. So both faces are loaded
 * and laid out before the first scene is constructed.
 *
 * The timeout is deliberate: a missing or blocked font file must not wedge the
 * game. After three seconds the CSS fallback stack takes over.
 */
async function waitForFonts(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  const sample = '第100000层末日宿舍生命饥饿口渴精力背包0123456789';
  const loads = FONT_FACES.map((face) =>
    document.fonts.load(`24px "${face}"`, sample).catch(() => undefined),
  );
  await Promise.race([
    Promise.all(loads).then(() => document.fonts.ready),
    new Promise<void>((resolve) => window.setTimeout(resolve, 3000)),
  ]);
}

async function boot(): Promise<void> {
  await waitForFonts();

  const game = new Phaser.Game(createGameConfig('game'));

  // Browsers gate audio behind a user gesture; unlock on the first one.
  const unlock = (): void => unlockAudio();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  // Dev handles so Playwright can assert on real game state (active scene,
  // GameState) rather than just the DOM.
  //
  // 生产包里默认**不暴露**：公开试玩的页面上不该出现内部句柄。但「生产形态
  // 的自动化验证」又需要走位和读状态（见 e2e-live/），所以额外认一个显式的
  // `?debug=1`。两者都只是只读句柄，不改变游戏行为，也不参与 AI 决策路径。
  const debugViaQuery =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';
  if (import.meta.env.DEV || debugViaQuery) {
    const w = window as unknown as {
      __PHASER_GAME__?: Phaser.Game;
      __PHASER_SESSION__?: { getState: () => unknown };
    };
    w.__PHASER_GAME__ = game;
    w.__PHASER_SESSION__ = { getState: () => (hasGame() ? getGame() : null) };
  }
}

void boot();
