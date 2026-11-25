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

/** 深拷贝当前 run，用于生产包下的只读调试句柄。 */
function snapshotState(): unknown {
  if (!hasGame()) return null;
  try {
    return structuredClone(getGame());
  } catch {
    // structuredClone 在老 WebView 里可能缺失；GameState 是纯 JSON 数据，
    // 序列化回落得到的是同一种「写不回去」的副本。
    return JSON.parse(JSON.stringify(getGame()));
  }
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
  // 两套构建给的是**不同**的东西，这是刻意的：
  //
  //   dev（vite serve）：本地开发，句柄就是活引用。E2E 需要「瞬移/塞背包」
  //   这类夹具，只有拿到真对象才写得到游戏里。
  //
  //   prod（vite build）：公开试玩页。默认完全不注册；显式 `?debug=1` 时
  //   只给**深拷贝快照**——每次 getState() 都是新的副本，写它不回写游戏。
  //   之前这里返回的是活 GameState，注释还写着「只读」，`getState().player.hp
  //   = 999` 能直接改掉正在跑的一局。单人本地游戏里不构成跨用户风险，但
  //   「注释说只读、实际可写」是错误本身：任何读这段代码的人都会误判边界。
  //
  // 生产包仍然需要一个**写**通道：e2e-live 跑的是构建产物，它靠 teleport
  // 把玩家挪到楼梯口。所以它在 `?debug=1` 下另有一个名字刺眼、语义明确的
  // 变异入口，跟「读状态」彻底分开。DEV 分支的 if 是编译期常量，Vite 在
  // 生产构建时把它折成死代码删掉，变异入口不会出现在 dev 包里；反之亦然。
  const debugViaQuery =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';
  if (import.meta.env.DEV || debugViaQuery) {
    const w = window as unknown as {
      __PHASER_GAME__?: Phaser.Game;
      __PHASER_SESSION__?: { getState: () => unknown };
      __PHASER_TEST_MUTATE__?: (mutator: (state: unknown) => void) => void;
    };
    w.__PHASER_GAME__ = game;
    if (import.meta.env.DEV) {
      w.__PHASER_SESSION__ = { getState: () => (hasGame() ? getGame() : null) };
    } else {
      w.__PHASER_SESSION__ = { getState: () => snapshotState() };
      w.__PHASER_TEST_MUTATE__ = (mutator) => {
        if (hasGame()) mutator(getGame());
      };
    }
  }
}

void boot();
