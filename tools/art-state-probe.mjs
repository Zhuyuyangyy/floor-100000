import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

// ART STATE PROBE — screenshot each animation state from inside the running game.
//
// The sheet gate (tools/char-sheet-gate.mjs) proves a candidate sheet obeys the
// contract. It cannot prove the sheet looks right ONCE IT IS IN THE GAME, and the
// two failures found in the v5.2 trial were both of that kind: the slung crowbar
// floated in front of a hand that had moved, and nothing in the PNG said so.
//
// This drives the real game with the dev-only __PHASER_GAME__ handle (same one
// the e2e suite uses), pins each frame, and shoots the character at 5x so the
// grip, the footline and the silhouette can be judged by eye.
//
// Run: npm run dev, then
//   node tools/art-state-probe.mjs [--out output/art-states] [--channel chrome]
// and compare the folder against the same run on the previous sheet.
//
// The point is NOT to test gameplay. It is to answer three questions the still
// sheets cannot:
//   1. does the 20-frame sheet load and index correctly in Phaser 4
//   2. does walk -> idle -> attack hand over without a size/height jump
//   3. does the crowbar still land on the fist during attack

const OUT = process.env.OUT ?? 'output/art-states';
mkdirSync(OUT, { recursive: true });

const waitScene = (page, key) =>
  page.waitForFunction(
    (k) => {
      const g = window.__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === k);
    },
    key,
    { timeout: 20000 },
  );

const browser = await chromium.launch({ channel: process.env.CHANNEL ?? 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
});

await page.goto('http://localhost:5173/?seed=42');
await waitScene(page, 'Menu');
await page.keyboard.press('Enter');
await waitScene(page, 'MetaSelect');
for (let i = 0; i < 6; i++) {
  await page.keyboard.press('Enter');
  const ok = await page
    .waitForFunction(() => {
      const g = window.__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
    }, undefined, { timeout: 1500 })
    .then(() => true)
    .catch(() => false);
  if (ok) break;
}
await waitScene(page, 'Game');
await page.waitForFunction(
  () => {
    const g = window.__PHASER_GAME__;
    const list = g?.scene.getScene('Game')?.children.list ?? [];
    return list.some((o) => o.type === 'Sprite' && (o.texture?.key ?? '').startsWith('char-'));
  },
  undefined,
  { timeout: 10000 },
);

// Freeze gameplay so the probe decides which frame is on screen.
const info = await page.evaluate(() => {
  const s = window.__PHASER_GAME__.scene.getScene('Game');
  const p = s.player;
  p.anims.stop();
  s.actionAnimUntil = 0;
  const cam = s.cameras.main;
  cam.setZoom(5);
  cam.stopFollow();
  cam.centerOn(p.x, p.y - 46);
  return {
    textures: Object.keys(window.__PHASER_GAME__.textures.list).filter((k) => k.startsWith('char-')),
    anims: Object.keys(window.__PHASER_GAME__.anims.anims.entries).filter((k) => /^(walk|idle|attack|hurt|search|die|pickup)-/.test(k)),
    playerTexture: p.texture.key,
    frames: p.texture.frameTotal - 1,
    x: p.x,
    y: p.y,
  };
});
console.log(JSON.stringify(info, null, 2));

// Frame map from src/render/walkcycle.ts
const SHOTS = [
  ['walk-0', 0, false],
  ['walk-1', 1, false],
  ['walk-2', 2, false],
  ['walk-3', 3, false],
  ['idle-0', 6, false],
  ['attack-0', 8, true],
  ['attack-1', 9, true],
  ['attack-2', 10, true],
  ['hurt-1', 12, false],
  ['search-0', 13, false],
  ['die-2', 17, false],
  ['pickup-1', 19, false],
];

for (const [name, frame, swinging] of SHOTS) {
  await page.evaluate(
    ({ frame, swinging }) => {
      const s = window.__PHASER_GAME__.scene.getScene('Game');
      const p = s.player;
      p.anims.stop();
      p.setFrame(frame);
      s.actionAnimKey = swinging ? 'attack-player' : '__none__';
      s.actionAnimUntil = swinging ? s.time.now + 60000 : 0;
      s.syncWeapon();
      const cam = s.cameras.main;
      cam.centerOn(p.x, p.y - 46);
    },
    { frame, swinging },
  );
  await page.waitForTimeout(120);
  await page.locator('canvas').screenshot({ path: `${OUT}/${name}.png` });
}

console.log(JSON.stringify({ errors: errors.slice(0, 8), count: errors.length }, null, 2));
await browser.close();
