// Draws the four characters as pixel art and writes them as RGBA PNGs.
//
// These replace the 16x24 procedural silhouettes in render/pixelArt.ts, which
// were one shared `drawHumanoid` shape in four colours — so the player, both
// neighbours and the night threat were the same figure with different paint.
//
// Follows docs' pixel-art rules (05_ART_GUIDE.md §2) and the production-cleanup
// checklist: one fixed canvas for every character, a shared foot baseline, one
// shared palette, hard edges only (no anti-aliasing, no smoothing), and an ASCII
// dump plus contact sheet for review. Run `node tools/build-characters.mjs --dump`
// to print each sprite as text.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from './png.mjs';

const W = 32;
const H = 48;
const FOOT_Y = H - 1; // every character's boots end on this row

// ── palette ───────────────────────────────────────────────────────────────
// The six project colours (05_ART_GUIDE.md §2) plus the derived shades a figure
// needs. Skin is deliberately desaturated to sit in the same post-apocalyptic
// range as the walls; nothing here is a saturated primary.
const C = {
  outline: [0x0e, 0x14, 0x18],
  boot: [0x18, 0x24, 0x2c],
  metal: [0x6a, 0x74, 0x7c],
  metalDark: [0x44, 0x50, 0x5a],
  skin: [0xd9, 0xb4, 0x8f],
  skinDark: [0xb5, 0x8a, 0x67],
  skinLight: [0xf0, 0xd3, 0xb0],
  hair: [0x24, 0x2a, 0x30],
  // clothing: base / shadow / highlight, one triplet per character
  teal: [0x77, 0xc6, 0xa4],
  tealDark: [0x4e, 0x8f, 0x78],
  tealLight: [0xa8, 0xdc, 0xc4],
  blue: [0x5a, 0x8a, 0xb5],
  blueDark: [0x3e, 0x64, 0x89],
  blueLight: [0x8a, 0xb0, 0xd4],
  brown: [0xb5, 0x85, 0x5a],
  brownDark: [0x8a, 0x62, 0x42],
  brownLight: [0xd4, 0xa8, 0x7e],
  husk: [0x3a, 0x1e, 0x24],
  huskDark: [0x24, 0x12, 0x1a],
  huskLight: [0x5a, 0x30, 0x38],
  danger: [0xe5, 0x6d, 0x63],
  lamp: [0xf4, 0xb6, 0x6a],
};

function makeCanvas() {
  const px = Buffer.alloc(W * H * 4); // zeroed = fully transparent everywhere
  const api = {
    px,
    set(x, y, c) {
      if (x < 0 || x >= W || y < 0 || y >= H || !c) return;
      const o = (y * W + x) * 4;
      px[o] = c[0];
      px[o + 1] = c[1];
      px[o + 2] = c[2];
      px[o + 3] = 255;
    },
    rect(x, y, w, h, c) {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) api.set(x + i, y + j, c);
    },
    hline(x, y, w, c) {
      api.rect(x, y, w, 1, c);
    },
    vline(x, y, h, c) {
      api.rect(x, y, 1, h, c);
    },
    /** Outlines the silhouette's left/right/bottom edge by one dark pixel. */
    shade(x, y, w, h) {
      api.vline(x - 1, y, h, C.outline);
      api.vline(x + w, y, h, C.outline);
      api.hline(x - 1, y + h, w + 2, C.outline);
    },
    toImage() {
      return { width: W, height: H, channels: 4, pixels: px };
    },
  };
  return api;
}

// A shared body plan so all four read as the same species and scale. `hunch`
// pushes the head and shoulders forward; every character keeps its boots on
// FOOT_Y, so nothing bobs when the frames are swapped.
function body(cv, o) {
  const cx = 16 + (o.hunch ?? 0);
  const headW = o.headW ?? 9;
  const headTop = o.headTop ?? 3;
  const headH = o.headH ?? 11;
  const torsoW = o.torsoW ?? 11;
  const torsoTop = o.torsoTop ?? 16;
  const torsoH = o.torsoH ?? 18;
  const legW = o.legW ?? 4; // width of ONE leg
  const armW = o.armW ?? 3;
  const armBottom = o.armBottom ?? 36;
  const LEG_GAP = 2;
  // Skin has a default rather than being required per character: an omitted
  // option reaches set()'s `!c` guard, which skips the pixel silently, and the
  // figure comes out headless with only its outline left.
  const skin = o.skin ?? C.skin;
  const skinDark = o.skinDark ?? C.skinDark;
  const skinLight = o.skinLight ?? C.skinLight;

  // head
  cv.shade(cx - (headW >> 1), headTop, headW, headH);
  cv.rect(cx - (headW >> 1), headTop, headW, headH, skin);
  cv.rect(cx - (headW >> 1), headTop, headW, 2, skinLight);
  cv.rect(cx - (headW >> 1), headTop + headH - 2, headW, 2, skinDark);
  // eyes: two pixels, so a face survives the 2x upscale
  cv.set(cx - 2, headTop + 6, o.eye ?? C.outline);
  cv.set(cx + 1, headTop + 6, o.eye ?? C.outline);

  // neck
  cv.rect(cx - 1, headTop + headH, 2, torsoTop - (headTop + headH), skinDark);

  // torso
  const tx = cx - (torsoW >> 1);
  cv.shade(tx, torsoTop, torsoW, torsoH);
  cv.rect(tx, torsoTop, torsoW, torsoH, o.base);
  cv.rect(tx, torsoTop, torsoW, 2, o.light);
  cv.rect(tx, torsoTop + torsoH - 3, torsoW, 3, o.dark);
  // a centre seam keeps the chest from reading as a flat slab
  cv.vline(cx, torsoTop + 3, torsoH - 6, o.dark);

  // arms, hanging beside the torso
  for (const side of [-1, 1]) {
    const ax = side < 0 ? tx - armW : tx + torsoW;
    cv.rect(ax, torsoTop + 2, armW, armBottom - (torsoTop + 2), o.base);
    cv.rect(ax, torsoTop + 2, armW, 2, o.light);
    cv.rect(ax, armBottom - 3, armW, 3, o.dark);
    // hand
    cv.rect(ax, armBottom, armW, 2, skin);
  }

  // legs and boots, both ending on FOOT_Y
  const legTop = torsoTop + torsoH;
  const bootH = 3;
  const legH = FOOT_Y - bootH - legTop + 1;
  const legSpan = legW * 2 + LEG_GAP;
  const legLeft = cx - (legSpan >> 1);
  // The left leg is a shade darker so the stance is not perfectly symmetrical
  // (a mirrored figure reads as a statue).
  for (const [i, shade] of [0, 1].entries()) {
    const lx = legLeft + i * (legW + LEG_GAP);
    cv.rect(lx, legTop, legW, legH, shade ? o.base : o.dark);
    cv.rect(lx, legTop + legH - 2, legW, 2, o.dark);
    cv.rect(lx, FOOT_Y - bootH + 1, legW, bootH - 1, C.boot);
  }
  return { cx, tx, torsoW, torsoTop, torsoH, legY: legTop, legH, headTop, headW, headH, legLeft, legW };
}

// ── the four characters ───────────────────────────────────────────────────

// The player: a survivor. Straight posture, short hair, a pack on the back.
function drawPlayer() {
  const cv = makeCanvas();
  const g = body(cv, { base: C.teal, dark: C.tealDark, light: C.tealLight, skin: C.skin, skinDark: C.skinDark, skinLight: C.skinLight });
  // hair, cropped short around the crown
  cv.rect(g.cx - (g.headW >> 1), g.headTop, g.headW, 3, C.hair);
  cv.rect(g.cx - (g.headW >> 1) - 1, g.headTop + 1, 1, 4, C.hair);
  cv.rect(g.cx + (g.headW >> 1), g.headTop + 1, 1, 4, C.hair);
  // backpack: a block riding past the right shoulder. It starts one column clear
  // of the arm so the arm still reads as an arm rather than being swallowed.
  cv.rect(g.tx + g.torsoW + 3, g.torsoTop + 4, 3, 11, C.brownDark);
  cv.rect(g.tx + g.torsoW + 3, g.torsoTop + 4, 3, 2, C.brown);
  cv.hline(g.cx - 1, g.torsoTop + 4, 5, C.brownDark); // strap across the chest
  // a roll of tape on the belt, because the recipes need it
  cv.hline(g.cx - 3, g.torsoTop + g.torsoH - 4, 7, C.metal);
  return cv;
}

// 阿林, the repairman: bulkier, a cap, a tool belt with a wrench.
function drawAlin() {
  const cv = makeCanvas();
  const g = body(cv, {
    base: C.blue,
    dark: C.blueDark,
    light: C.blueLight,
    torsoW: 13,
    torsoH: 17,
    legW: 5,
    armW: 4,
    armBottom: 37,
    headW: 10,
  });
  // cap: a two-row crown and a one-row brim. Kept to three rows so the face
  // below stays skin — a taller cap swallowed it and left two floating eyes.
  cv.rect(g.cx - (g.headW >> 1), g.headTop, g.headW, 2, C.blueDark);
  cv.rect(g.cx - (g.headW >> 1) - 1, g.headTop + 2, g.headW + 2, 1, C.blueDark);
  cv.set(g.cx + (g.headW >> 1) + 1, g.headTop + 2, C.outline); // brim tip
  // tool belt: a band with two tools hanging off it
  cv.hline(g.tx, g.torsoTop + g.torsoH - 5, 13, C.metalDark);
  cv.rect(g.tx + 2, g.torsoTop + g.torsoH - 4, 2, 5, C.metal);
  cv.rect(g.tx + 9, g.torsoTop + g.torsoH - 4, 2, 4, C.metal);
  cv.set(g.tx + 2, g.torsoTop + g.torsoH - 5, C.lamp); // wrench tip catches the light
  return cv;
}

// 小周, the neighbour: slimmer, longer hair, an apron over a tunic.
function drawXiaozhou() {
  const cv = makeCanvas();
  const g = body(cv, {
    base: C.brown,
    dark: C.brownDark,
    light: C.brownLight,
    torsoW: 10,
    torsoH: 18,
    legW: 4,
    armW: 3,
    headW: 9,
  });
  // longer hair: a crown plus falls to the shoulders on both sides, but the face
  // between them stays skin. A full-width band here left the head a dark block.
  cv.rect(g.cx - (g.headW >> 1), g.headTop, g.headW, 3, C.hair);
  cv.rect(g.cx - (g.headW >> 1) - 1, g.headTop + 1, 1, 9, C.hair);
  cv.rect(g.cx + (g.headW >> 1), g.headTop + 1, 1, 9, C.hair);
  // apron: a lighter panel down the front of the tunic
  cv.rect(g.cx - 3, g.torsoTop + 5, 7, g.torsoH - 7, C.brownLight);
  cv.hline(g.cx - 3, g.torsoTop + 5, 7, C.lamp);
  // a bread roll under one arm — 小周 trades food
  cv.rect(g.tx - 4, g.torsoTop + 12, 4, 4, C.brownLight);
  cv.set(g.tx - 3, g.torsoTop + 12, C.lamp);
  return cv;
}

// The wanderer: hunched, head thrust forward, arms past the knees, no clear
// legs. Deliberately asymmetric so it never reads as a person at a glance.
function drawWanderer() {
  const cv = makeCanvas();
  const g = body(cv, {
    base: C.husk,
    dark: C.huskDark,
    light: C.huskLight,
    hunch: 3,
    headW: 9,
    headTop: 6,
    headH: 10,
    torsoW: 12,
    torsoTop: 17,
    torsoH: 15,
    legW: 4,
    armW: 3,
    armBottom: 43,
    eye: C.danger,
  });
  // tattered hem instead of a clean waist
  for (let i = 0; i < 5; i++) {
    const hx = g.tx + i * 3;
    cv.rect(hx, g.torsoTop + g.torsoH - 1, 2, 3 + (i % 2), C.huskDark);
  }
  // one shoulder higher than the other
  cv.rect(g.tx, g.torsoTop, 3, 2, C.huskLight);
  // arms hang far past where a person's hands would stop
  cv.rect(g.tx - 3, g.torsoTop + 6, 3, 22, C.huskDark);
  cv.rect(g.tx + g.torsoW, g.torsoTop + 6, 3, 22, C.husk);
  // clawed hands
  cv.rect(g.tx - 3, g.torsoTop + 28, 3, 3, C.huskLight);
  cv.rect(g.tx + g.torsoW, g.torsoTop + 28, 3, 3, C.huskLight);
  // no boots: the legs end in rags, and each one narrows to a point so the
  // silhouette tapers instead of ending in a flat foot
  for (const i of [0, 1]) {
    const lx = g.legLeft + i * (g.legW + 2);
    cv.rect(lx, g.legY, g.legW, 6, C.huskDark);
    cv.rect(lx, g.legY + 6, g.legW - 1, 3, C.huskDark);
    cv.rect(lx, g.legY + 9, g.legW - 2, 2, C.huskDark);
  }
  return cv;
}

const CHARACTERS = {
  'char-player': drawPlayer,
  'char-alin': drawAlin,
  'char-xiaozhou': drawXiaozhou,
  'char-wanderer': drawWanderer,
};

// ── review aids ───────────────────────────────────────────────────────────

const DUMP_CHARS = [
  [C.outline, '#'],
  [C.boot, 'b'],
  [C.metal, 'm'],
  [C.metalDark, 'M'],
  [C.skin, 's'],
  [C.skinDark, 'S'],
  [C.skinLight, 'L'],
  [C.hair, 'h'],
  [C.teal, 'T'],
  [C.tealDark, 't'],
  [C.tealLight, '1'],
  [C.blue, 'B'],
  [C.blueDark, 'd'],
  [C.blueLight, '2'],
  [C.brown, 'R'],
  [C.brownDark, 'r'],
  [C.brownLight, '3'],
  [C.husk, 'W'],
  [C.huskDark, 'w'],
  [C.huskLight, '4'],
  [C.danger, '!'],
  [C.lamp, '*'],
];

function dump(img) {
  const lines = [];
  for (let y = 0; y < img.height; y++) {
    let line = '';
    for (let x = 0; x < img.width; x++) {
      const o = (y * img.width + x) * 4;
      if (img.pixels[o + 3] === 0) {
        line += '.';
        continue;
      }
      const hit = DUMP_CHARS.find(([c]) => c[0] === img.pixels[o] && c[1] === img.pixels[o + 1] && c[2] === img.pixels[o + 2]);
      line += hit ? hit[1] : '?';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/** A contact sheet of every character at 4x, so one image shows all four. */
function contactSheet(images) {
  const scale = 4;
  const pad = 4;
  const cellW = W * scale + pad * 2;
  const cellH = H * scale + pad * 2;
  const cols = 4;
  const rows = 1;
  const out = Buffer.alloc(cellW * cols * cellH * rows * 4);
  // flat dark backdrop so the transparent sprites read against something
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 0x18;
    out[i + 1] = 0x24;
    out[i + 2] = 0x2c;
    out[i + 3] = 255;
  }
  images.forEach((img, n) => {
    const ox = n * cellW + pad;
    const oy = pad;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const s = (y * img.width + x) * 4;
        if (img.pixels[s + 3] === 0) continue;
        for (let j = 0; j < scale; j++) {
          for (let i = 0; i < scale; i++) {
            const d = ((oy + y * scale + j) * cellW * cols + ox + x * scale + i) * 4;
            out[d] = img.pixels[s];
            out[d + 1] = img.pixels[s + 1];
            out[d + 2] = img.pixels[s + 2];
            out[d + 3] = 255;
          }
        }
      }
    }
  });
  return { width: cellW * cols, height: cellH * rows, channels: 4, pixels: out };
}

// ── run ───────────────────────────────────────────────────────────────────

const OUT = 'public/assets/artpack';
mkdirSync(OUT, { recursive: true });

const images = [];
for (const [key, draw] of Object.entries(CHARACTERS)) {
  const cv = draw();
  const img = cv.toImage();
  writeFileSync(join(OUT, `${key}.png`), encodePng(img));
  images.push(img);
  const opaque = img.pixels.filter((_, i) => i % 4 === 3 && img.pixels[i] > 0).length;
  if (process.argv.includes('--dump')) {
    console.log(`\n=== ${key} (${W}x${H}, boots on row ${FOOT_Y}, ${opaque} opaque px) ===\n${dump(img)}`);
  } else {
    console.log(`  ${key.padEnd(16)} ${W}x${H}  ${String(opaque).padStart(4)} opaque px  boots on row ${FOOT_Y}`);
  }
}

const sheet = contactSheet(images);
writeFileSync('e2e/screenshots/char-contact.png', encodePng(sheet));
console.log(`characters: ${images.length} -> ${W}x${H} RGBA, contact sheet -> e2e/screenshots/char-contact.png`);
