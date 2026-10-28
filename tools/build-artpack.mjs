// Builds the runtime asset pack from the sliced art sheets into public/assets.
//
// Three things need real work rather than a copy:
//
//   1. Item icons. The sheet renders each item at ~250px; the game draws them at
//      16x16. A nearest-neighbour drop of that ratio samples one pixel in fifteen
//      and produces noise, so each icon is area-averaged down to 16x16.
//
//   2. Panel frames. buildPanel() wants a nine-slice texture, and a 581x222
//      panel cannot be one (a panel shorter than 222 would squash its corners).
//      So the corners, edges and centre are lifted out and recomposed into a
//      small texture that slices cleanly at any size.
//
//   3. A green and a yellow variant of that frame, so buildPanel's existing
//      accent parameter keeps meaning something.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, encodePng, crop } from './png.mjs';

const SLICED = 'F:/new/sliced';
const OUT = 'public/assets';
const args = process.argv.slice(2);
const preview = args.includes('--preview');

mkdirSync(join(OUT, 'ui'), { recursive: true });
mkdirSync(join(OUT, 'artpack'), { recursive: true });

// ── 1. item icons ──────────────────────────────────────────────────────────
// ITEM_IDS order matches the sheet's reading order exactly (see docs).
const ITEM_IDS = [
  'clean_water', 'dirty_water', 'ration_pack', 'bread', 'medkit',
  'battery', 'scrap_metal', 'wood', 'cloth', 'tape',
  'filter', 'wire', 'fuse', 'crowbar', 'flashlight',
];
const ICON_SIZE = 16;

function boxDownscale(img, outW, outH) {
  const out = Buffer.alloc(outW * outH * 4);
  const bw = img.width / outW;
  const bh = img.height / outH;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      const x1 = Math.max(Math.round((x + 1) * bw), Math.round(x * bw) + 1);
      const y1 = Math.max(Math.round((y + 1) * bh), Math.round(y * bw) + 1);
      for (let sy = Math.round(y * bh); sy < Math.min(y1, img.height); sy++) {
        for (let sx = Math.round(x * bw); sx < Math.min(x1, img.width); sx++) {
          const o = (sy * img.width + sx) * img.channels;
          r += img.pixels[o];
          g += img.pixels[o + 1];
          b += img.pixels[o + 2];
          a += img.channels === 4 ? img.pixels[o + 3] : 255;
          n++;
        }
      }
      const d = (y * outW + x) * 4;
      out[d] = Math.round(r / n);
      out[d + 1] = Math.round(g / n);
      out[d + 2] = Math.round(b / n);
      // Keep the alpha binary: a half-transparent 16px icon reads as dirt against
      // the dark panel, and the source is fully opaque inside its own bounds.
      out[d + 3] = a / n > 128 ? 255 : 0;
    }
  }
  return { width: outW, height: outH, channels: 4, pixels: out };
}

const iconPreviews = [];
ITEM_IDS.forEach((id, i) => {
  const src = decodePng(readFileSync(join(SLICED, 'icons', `icon-${String(i).padStart(2, '0')}.png`)));
  const small = boxDownscale(src, ICON_SIZE, ICON_SIZE);
  writeFileSync(join(OUT, 'artpack', `item-${id}.png`), encodePng(small));
  iconPreviews.push({ id, img: small });
});
console.log(`icons: ${ITEM_IDS.length} -> ${ICON_SIZE}x${ICON_SIZE}`);

// ── 2. panel frames ────────────────────────────────────────────────────────
// buildPanel() cannot use a NineSlice: in Phaser 4 a NineSlice is composited in a
// later pass than plain Images regardless of depth, so a panel's opaque centre
// swallows every icon inside it (verified: frame at depth -100 shows the icons,
// frame at depth 195 with icons at 200 hides them). The frame is therefore cut
// into eight plain Images — four corners at natural size and four stretchable
// edges — which composite in ordinary display-list order.
const SLICE = 28;
const EDGE = 8;
const panelSrc = decodePng(readFileSync(join(SLICED, 'ui', 'ui-00.png')));

function tint(img, mul) {
  const out = Buffer.from(img.pixels);
  for (let p = 0; p < out.length; p += 4) {
    out[p] = Math.min(255, Math.round((out[p] * mul[0]) / 255));
    out[p + 1] = Math.min(255, Math.round((out[p + 1] * mul[1]) / 255));
    out[p + 2] = Math.min(255, Math.round((out[p + 2] * mul[2]) / 255));
  }
  return { ...img, pixels: out };
}

const PW = panelSrc.width;
const PH = panelSrc.height;
const MX = Math.floor(PW / 2 - EDGE / 2);
const MY = Math.floor(PH / 2 - EDGE / 2);

// Same file names buildPanel() already asks for, so no call site changes. The
// yellow variant is a warm multiply over the same metal.
for (const [accent, mul] of [['green', [214, 255, 232]], ['yellow', [255, 238, 198]]]) {
  const src = tint(panelSrc, mul);
  const parts = {
    'tl': crop(src, 0, 0, SLICE, SLICE),
    'tr': crop(src, PW - SLICE, 0, SLICE, SLICE),
    'bl': crop(src, 0, PH - SLICE, SLICE, SLICE),
    'br': crop(src, PW - SLICE, PH - SLICE, SLICE, SLICE),
    'top': crop(src, MX, 0, EDGE, SLICE),
    'bottom': crop(src, MX, PH - SLICE, EDGE, SLICE),
    'left': crop(src, 0, MY, SLICE, EDGE),
    'right': crop(src, PW - SLICE, MY, SLICE, EDGE),
  };
  for (const [part, img] of Object.entries(parts)) {
    writeFileSync(join(OUT, 'ui', `frame-${accent}-${part}.png`), encodePng(img));
  }
}
console.log(`panel frame: ${PW}x${PH} -> 8 pieces, slice ${SLICE}, edge ${EDGE}`);

// ── 3. inventory slot ──────────────────────────────────────────────────────
const slotSrc = decodePng(readFileSync(join(SLICED, 'hud', 'hud-27.png')));
const slot = boxDownscale(slotSrc, 22, 22);
writeFileSync(join(OUT, 'ui', 'slot.png'), encodePng(slot));
console.log(`slot: ${slot.width}x${slot.height}`);

// ── 4. end-screen banners ──────────────────────────────────────────────────
// ui-54 is the green success banner, ui-55 the red death banner.
for (const [id, file] of [['win', 'ui-54'], ['lose', 'ui-55']]) {
  const src = decodePng(readFileSync(join(SLICED, 'ui', `${file}.png`)));
  writeFileSync(join(OUT, 'artpack', `banner-${id}.png`), encodePng(crop(src, 0, 0, src.width, src.height)));
  console.log(`banner-${id}: ${src.width}x${src.height}`);
}

// ── 5. furniture ───────────────────────────────────────────────────────────
// The seven procedural furniture textures are replaced by the art pack's props.
// Each is scaled to a common standing height rather than left at its native
// 100-220px: a 228px wardrobe against a wall whose usable band is ~150px would
// run off the top, and a scene where one prop is twice the height of the next
// reads as pasted stickers. 80px keeps every prop inside the band the corridor
// code already uses for its own props (a wall lamp stands at floorY-150) while
// leaving the detail legible.
// 56 rather than the original 80. 80 was chosen so a prop stayed inside the wall's
// usable band and no prop was twice the height of the next, which was sound while
// the player was a 16x24 silhouette — a prop was five times a person. Once the
// characters became 32x48 (tools/build-characters.mjs) a crate was 66% taller than
// the player and a door a third of the player's height, so the band that made 80
// look deliberate now made it look wrong. 56 puts the tallest prop at 1.17x the
// player: a large crate, not a wall. src/tests/sceneScale.test.ts holds the ratio.
const FURNITURE_HEIGHT = 56;
const FURNITURE = {
  bed: 0,
  cabinet: 3,
  crate_wood: 25,
  crate_metal: 26,
  workbench: 9,
  watertank: 12,
  fusebox: 14,
  shelf: 21,
  counter: 19,
};
mkdirSync(join(OUT, 'artpack'), { recursive: true });
for (const [key, id] of Object.entries(FURNITURE)) {
  const src = decodePng(readFileSync(join(SLICED, 'furn', `furn-${String(id).padStart(2, '0')}.png`)));
  const h = FURNITURE_HEIGHT;
  const w = Math.max(1, Math.round((src.width * h) / src.height));
  const scaled = boxDownscale(src, w, h);
  writeFileSync(join(OUT, 'artpack', `furn-${key}.png`), encodePng(scaled));
  console.log(`furn-${key}: ${src.width}x${src.height} -> ${w}x${h}`);
}

// ── preview sheet ──────────────────────────────────────────────────────────
if (preview) {
  const cell = 40;
  const cols = 8;
  const rows = Math.ceil((iconPreviews.length + 3) / cols);
  const sheet = { width: cols * cell, height: rows * cell, channels: 4, pixels: Buffer.alloc(cols * cell * rows * cell * 4) };
  for (let i = 0; i < sheet.pixels.length; i += 4) {
    sheet.pixels[i] = 18;
    sheet.pixels[i + 1] = 22;
    sheet.pixels[i + 2] = 28;
    sheet.pixels[i + 3] = 255;
  }
  const blit = (img, i, scale) => {
    const cx = (i % cols) * cell;
    const cy = Math.floor(i / cols) * cell;
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const ox = cx + ((cell - w) >> 1);
    const oy = cy + ((cell - h) >> 1);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = Math.min(img.width - 1, Math.floor(x / scale));
        const sy = Math.min(img.height - 1, Math.floor(y / scale));
        const s = (sy * img.width + sx) * img.channels;
        if (img.channels === 4 && img.pixels[s + 3] === 0) continue;
        const d = ((oy + y) * sheet.width + ox + x) * 4;
        sheet.pixels[d] = img.pixels[s];
        sheet.pixels[d + 1] = img.pixels[s + 1];
        sheet.pixels[d + 2] = img.pixels[s + 2];
        sheet.pixels[d + 3] = 255;
      }
    }
  };
  iconPreviews.forEach((p, i) => blit(p.img, i, 2));
  blit(crop(panelSrc, 0, 0, 200, 120), iconPreviews.length, 0.3);
  blit(slot, iconPreviews.length + 1, 1);
  writeFileSync('F:/new/sliced/artpack-preview.png', encodePng(sheet));
  console.log('preview -> F:/new/sliced/artpack-preview.png');
}
