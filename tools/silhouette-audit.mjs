import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

// SILHOUETTE AUDIT — does the character read as a PERSON at a glance?
//
// The colour and contrast gates can all pass while the figure is an
// unidentifiable blob: a dark shape on a dark wall with good values is still a
// dark shape. The art research calls this the silhouette test — fill the figure
// with one colour, shrink it, and see whether you can tell what it is and what
// it is doing.
//
// This measures the thing that makes a silhouette readable: the WIDTH PROFILE
// down the figure. A person has four sections — a narrow head, wide shoulders,
// a narrower waist, and two legs — so the profile rises, falls, and then splits
// into two runs. A blob has one section and a nearly constant width.
//
//   sections     how many distinct width plateaus the profile has (target >= 3)
//   headRatio    head width / shoulder width  (target <= 0.85)
//   waistRatio   waist width / shoulder width (target <= 0.9)
//   splitRows    rows where the figure has two separate runs, i.e. legs
//                (target >= 10)
//
// Run: node tools/silhouette-audit.mjs [character]

const OUT = process.env.AUDIT_OUT ?? 're/audit';
const SHEET = process.env.SHEET ?? join('re', 'frames', 'player-sheet.png');
const CHAR = process.argv[2] ?? 'player';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
const b64 = readFileSync(SHEET).toString('base64');

const img = await page.evaluate(async (data) => {
  const im = new Image();
  im.src = `data:image/png;base64,${data}`;
  await im.decode();
  const c = document.createElement('canvas');
  c.width = im.width;
  c.height = im.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(im, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  return { w: c.width, h: c.height, data: Array.from(d) };
}, b64);
await browser.close();

// The sheet is 15 frames across at 4x scale. Frame 0 is the walk contact pose,
// which has the widest stride and is the hardest silhouette to fake.
const FRAMES = 15;
const frameW = Math.floor(img.w / FRAMES);
const frameH = img.h;
const alphaAt = (x, y) => img.data[(y * img.w + x) * 4 + 3];

// Per-row runs for frame 0.
const rows = [];
for (let y = 0; y < frameH; y++) {
  let count = 0;
  let runs = 0;
  let prev = false;
  let minX = Infinity;
  let maxX = -1;
  for (let x = 0; x < frameW; x++) {
    const solid = alphaAt(x, y) > 0;
    if (solid) {
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    if (solid && !prev) runs++;
    prev = solid;
  }
  rows.push({ y, count, runs, minX, maxX });
}
const solid = rows.filter((r) => r.count > 0);
if (solid.length === 0) throw new Error('no opaque pixels in frame 0');
// Scale to 1x game pixels: the sheet is baked at 4x.
const S = 4;
const widthAt = (frac) => {
  const idx = Math.min(solid.length - 1, Math.max(0, Math.round(frac * (solid.length - 1))));
  return solid[idx].count / S;
};

const head = widthAt(0.08);
const shoulder = Math.max(...solid.map((r) => r.count)) / S;
const waist = widthAt(0.55);
const splitRows = solid.filter((r) => r.runs >= 2).length / S;

// Count width plateaus: how many times the profile meaningfully changes
// direction, which is how many "sections" the shape has.
let sections = 1;
let dir = 0;
for (let i = 2; i < solid.length; i++) {
  const d = solid[i].count - solid[i - 2].count;
  const nd = d > 1 ? 1 : d < -1 ? -1 : 0;
  if (nd !== 0 && dir !== 0 && nd !== dir) sections++;
  if (nd !== 0) dir = nd;
}

const headRatio = head / shoulder;
const waistRatio = waist / shoulder;
const pass = {
  sections: sections >= 3,
  headRatio: headRatio <= 0.85,
  waistRatio: waistRatio <= 0.9,
  legs: splitRows >= 10,
};

console.log(`\n SILHOUETTE ${CHAR} ` + '='.repeat(48));
console.log(` figure height ${(solid.length / S).toFixed(0)}px at 1x, max width ${shoulder.toFixed(0)}px`);
console.log(` head ${head.toFixed(1)}  shoulders ${shoulder.toFixed(1)}  waist ${waist.toFixed(1)}`);
console.log(` sections ${sections}   head/shoulder ${headRatio.toFixed(2)}   waist/shoulder ${waistRatio.toFixed(2)}   split rows ${splitRows.toFixed(0)}`);
console.log(` PASS: ${Object.entries(pass).map(([k, v]) => `${k}=${v ? 'ok' : 'FAIL'}`).join('  ')}`);
console.log('='.repeat(62) + '\n');
process.exitCode = Object.values(pass).every(Boolean) ? 0 : 1;
