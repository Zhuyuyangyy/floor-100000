import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname, basename, resolve } from 'node:path';
import { decodePng } from './png.mjs';

// CHARACTER SHEET GATE — the contract a candidate sheet must satisfy before it
// is allowed anywhere near src/assets/characters.
//
// Why this exists: art packs arrive with their own QA JSON, and that QA checks
// the things the pack's author thought about (size, frame count, alpha). It does
// not check the things THIS game needs, and the two failures that actually cost
// a review round were invisible in both the pack README and its QA report:
//
//   1. colour. The pack's sheets were illustration that had been downscaled, so
//      they carried ~229 distinct colours and 39% of pixels sat outside the
//      16-colour palette in src/render/palette.ts. Dropped in, every screen
//      would read as a different game — which is exactly what palette.ts was
//      written to prevent.
//   2. rhythm. Foot baselines matched inside the pack but not against the
//      existing sheets, and one walk frame was 17px wider than its neighbours.
//      Neither shows up in a still preview; both show up as popping in motion.
//
// So this gate measures against the RUNNING GAME, not against the pack's own
// claims. Reference values come from the sheets currently in
// src/assets/characters (measured 2026-11-14): baseline spread 0, walk width
// spread 5–8px, max frame-to-frame silhouette overlap 0.85–0.93.
//
// Pure Node, zero dependencies — tools/png.mjs is the only codec in the project.
//
// Run:
//   node tools/char-sheet-gate.mjs <dir-or-file> [--legacy src/assets/characters]
//        [--json re/char-gate.json]
// Exit code 1 when any check fails, so CI or a pre-commit hook can use it.

const FRAME_W = 64;
const FRAME_H = 96;
const TOTAL_FRAMES = 20;
const SHEET_W = FRAME_W * TOTAL_FRAMES;
const WALK_FRAMES = 6;
const IDLE_END = 8; // frames 0..7 are walk+idle: feet must not lift off the floor

const REQUIRED = ['player', 'npc_alin', 'npc_xiaozhou', 'wanderer'];

// Thresholds, calibrated against the four sheets currently shipped in
// src/assets/characters: height spread 1px, head width spread 2–5px, silhouette
// centre drift 0.5px, walk bbox width spread 5–8px.
//
// Note what is NOT a gate: bbox width spread. A walk cycle is supposed to change
// width — that is what a stride is — so a 22px spread can be perfectly healthy
// (v5.2's npc_alin: heights 85–86, heads 24–27, widths 36–58). What must not
// happen is the body changing SIZE. Height and head width carry that, so they
// are the gate and the width is reported for information only.
const LIMITS = {
  offPalettePct: 0.5, // % of opaque pixels allowed outside the palette
  heightSpread: 3, // px between tallest and shortest walk frame
  headSpread: 6, // px between widest and narrowest head, generous on purpose
  centreDrift: 4, // px the silhouette centre may travel across the cycle
  duplicateOverlap: 0.98, // two walk frames this alike = a repeated pose
  edgeMargin: 1, // px of empty cell required on each side
};

// ── palette ─────────────────────────────────────────────────────────────────
function loadPalette(repoRoot) {
  const src = readFileSync(join(repoRoot, 'src/render/palette.ts'), 'utf8');
  const block = src.slice(src.indexOf('export const PALETTE'), src.indexOf('} as const'));
  const hexes = [...block.matchAll(/0x([0-9a-fA-F]{6})/g)].map((m) => m[1].toLowerCase());
  return [...new Set(hexes)].map((h) => [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]);
}

const key = (r, g, b) => (r << 16) | (g << 8) | b;
const min = (a) => Math.min(...a);
const max = (a) => Math.max(...a);

// ── pixel helpers ───────────────────────────────────────────────────────────
function frameBox(img, index) {
  const { pixels, channels } = img;
  const x0 = index * FRAME_W;
  let minX = FRAME_W;
  let maxX = -1;
  let minY = FRAME_H;
  let maxY = -1;
  let opaque = 0;
  for (let y = 0; y < FRAME_H; y++) {
    for (let x = 0; x < FRAME_W; x++) {
      const p = (y * img.width + x0 + x) * channels;
      if (pixels[p + 3] === 0) continue;
      opaque++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;

  // Head width over the top 22% of the figure: the most scale-sensitive part of
  // a 64x96 sprite, and the one a bad resize moves first.
  const headEnd = minY + Math.floor((maxY - minY + 1) * 0.22);
  let hMin = FRAME_W;
  let hMax = -1;
  for (let y = minY; y <= headEnd; y++) {
    for (let x = 0; x < FRAME_W; x++) {
      const p = (y * img.width + x0 + x) * channels;
      if (pixels[p + 3] === 0) continue;
      if (x < hMin) hMin = x;
      if (x > hMax) hMax = x;
    }
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    headWidth: hMax >= 0 ? hMax - hMin + 1 : 0,
    centre: (minX + maxX) / 2,
    opaque,
  };
}

function mask(img, index) {
  const { pixels, channels } = img;
  const x0 = index * FRAME_W;
  const out = new Uint8Array(FRAME_W * FRAME_H);
  for (let y = 0; y < FRAME_H; y++) {
    for (let x = 0; x < FRAME_W; x++) {
      out[y * FRAME_W + x] = pixels[(y * img.width + x0 + x) * channels + 3] > 0 ? 1 : 0;
    }
  }
  return out;
}

function overlap(a, b) {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] & b[i]) inter++;
    if (a[i] | b[i]) union++;
  }
  return union === 0 ? 1 : inter / union;
}

// ── one sheet ───────────────────────────────────────────────────────────────
function auditSheet(file, palette, paletteSet) {
  const img = decodePng(readFileSync(file));
  const checks = [];
  const push = (level, name, detail) => checks.push({ level, name, detail });

  if (img.width !== SHEET_W || img.height !== FRAME_H) {
    push('fail', 'size', `${img.width}x${img.height}, expected ${SHEET_W}x${FRAME_H}`);
  } else {
    push('ok', 'size', `${img.width}x${img.height} = ${TOTAL_FRAMES} frames`);
  }

  // alpha: a pixel is either there or it is not. Anything between means the
  // sprite was resampled without a hard threshold and will halo against walls.
  let semi = 0;
  if (img.channels !== 4) {
    push('fail', 'alpha', `channels=${img.channels}, expected RGBA`);
  } else {
    for (let p = 3; p < img.pixels.length; p += 4) {
      const a = img.pixels[p];
      if (a > 0 && a < 255) semi++;
    }
    push(semi === 0 ? 'ok' : 'fail', 'alpha', semi === 0 ? 'binary 0/255' : `${semi} semi-transparent pixels`);
  }

  // palette conformance
  let opaque = 0;
  let off = 0;
  const offColors = new Map();
  if (img.channels === 4) {
    for (let p = 0; p < img.pixels.length; p += 4) {
      if (img.pixels[p + 3] === 0) continue;
      opaque++;
      const k = key(img.pixels[p], img.pixels[p + 1], img.pixels[p + 2]);
      if (!paletteSet.has(k)) {
        off++;
        offColors.set(k, (offColors.get(k) ?? 0) + 1);
      }
    }
    const pct = opaque ? (off / opaque) * 100 : 0;
    const level = pct === 0 ? 'ok' : pct > LIMITS.offPalettePct ? 'fail' : 'warn';
    const worst = [...offColors.entries()].sort((a, b) => b[1] - a[1])[0];
    const sample = worst
      ? `; top stray #${worst[0].toString(16).padStart(6, '0')} x${worst[1]}`
      : '';
    push(
      level,
      'palette',
      pct === 0
        ? `all opaque pixels inside ${palette.length} colours`
        : `${pct.toFixed(1)}% of pixels outside palette (${offColors.size} stray colours)${sample}`,
    );
  }

  // foot baseline + walk width spread, measured on walk+idle only: hurt/die
  // frames are supposed to leave the ground, so they are excluded by design.
  const boxes = [];
  for (let i = 0; i < TOTAL_FRAMES; i++) boxes.push(frameBox(img, i));

  const empty = boxes.map((b, i) => (b ? -1 : i)).filter((i) => i >= 0);
  push(empty.length === 0 ? 'ok' : 'fail', 'frames', empty.length === 0 ? 'all 20 frames drawn' : `empty frames: ${empty.join(',')}`);

  const base = boxes.slice(0, IDLE_END).map((b) => (b ? b.maxY : -1)).filter((y) => y >= 0);
  if (base.length) {
    const spread = Math.max(...base) - Math.min(...base);
    push(spread === 0 ? 'ok' : 'fail', 'baseline', `walk+idle foot y=${Math.min(...base)} spread ${spread}px`);
  }

  const walk = boxes.slice(0, WALK_FRAMES).filter(Boolean);
  if (walk.length === WALK_FRAMES) {
    const widths = walk.map((b) => b.width);
    const heights = walk.map((b) => b.height);
    const heads = walk.map((b) => b.headWidth);
    const centres = walk.map((b) => b.centre);

    // size stability: the figure may stride, it may not change size
    const hSpread = Math.max(...heights) - Math.min(...heights);
    const headSpread = Math.max(...heads) - Math.min(...heads);
    const scaleLevel = hSpread > LIMITS.heightSpread || headSpread > LIMITS.headSpread ? 'fail' : 'ok';
    push(scaleLevel, 'walk scale', `heights ${min(heights)}-${max(heights)}, heads ${min(heads)}-${max(heads)}`);

    // horizontal travel of the silhouette: a body that slides sideways reads as
    // a hop; a stride keeps the centre roughly put while the legs open
    const drift = Math.max(...centres) - Math.min(...centres);
    const driftLevel = drift > LIMITS.centreDrift ? 'warn' : 'ok';
    push(driftLevel, 'walk drift', `centre ${min(centres).toFixed(1)}-${max(centres).toFixed(1)} (${drift.toFixed(1)}px)`);

    // reported, never gated: width IS the stride
    push('info', 'walk width', `${widths.join('/')} spread ${max(widths) - min(widths)}px`);

    const edges = walk.filter((b) => b.minX < LIMITS.edgeMargin || b.maxX > FRAME_W - 1 - LIMITS.edgeMargin);
    push(
      edges.length ? 'fail' : 'ok',
      'walk edge',
      edges.length
        ? `${edges.length} frame(s) touch the cell border: ${edges.map((b) => `${b.minX}..${b.maxX}`).join(', ')}`
        : `all inside ${LIMITS.edgeMargin}..${FRAME_W - 1 - LIMITS.edgeMargin}`,
    );
  }

  // silhouette rhythm: two near-identical walk frames read as a stutter
  const masks = Array.from({ length: WALK_FRAMES }, (_, i) => mask(img, i));
  let worst = { value: 0, pair: '' };
  for (let i = 0; i < WALK_FRAMES; i++) {
    for (let j = i + 1; j < WALK_FRAMES; j++) {
      const v = overlap(masks[i], masks[j]);
      if (v > worst.value) worst = { value: v, pair: `f${i}/f${j}` };
    }
  }
  const dup = worst.value >= LIMITS.duplicateOverlap;
  push(dup ? 'warn' : 'ok', 'walk rhythm', `max overlap ${worst.value.toFixed(2)} (${worst.pair})`);

  return { file: basename(file), checks, boxes, img };
}

// ── placeholder detection ───────────────────────────────────────────────────
// The v4 pack filled frames 8..19 with re-rendered copies of the old procedural
// poses. Those are legitimately different drawings, so a byte comparison says
// "nothing in common" and hides the problem. Silhouette overlap is the honest
// measure: anything above ~0.85 means the pose is the old one, restyled.
function compareToLegacy(candidate, legacyFile) {
  const old = decodePng(readFileSync(legacyFile));
  const rows = [];
  for (let i = 8; i < TOTAL_FRAMES; i++) {
    const a = mask(candidate, i);
    const b = mask(old, i);
    rows.push({ frame: i, overlap: overlap(a, b) });
  }
  const mean = rows.reduce((s, r) => s + r.overlap, 0) / rows.length;
  const same = rows.filter((r) => r.overlap >= 0.85).length;

  // Foot baseline is measured per sheet, so a sheet that is internally
  // consistent can still sit 2px off the sheet it replaces. That is invisible
  // in a still and shows as a hop the moment walk hands over to attack.
  const baseOf = (img) => {
    for (let i = 0; i < IDLE_END; i++) {
      const box = frameBox(img, i);
      if (box) return box.maxY;
    }
    return -1;
  };
  const baseNew = baseOf(candidate);
  const baseOld = baseOf(old);

  return { rows, mean, same, restyled: rows.length - same, baseNew, baseOld, baseDiff: baseNew - baseOld };
}

// ── cli ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const target = argv.find((a) => !a.startsWith('--'));
if (!target) {
  console.error('usage: node tools/char-sheet-gate.mjs <dir-or-file> [--legacy dir] [--json out.json]');
  process.exit(2);
}
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const legacyDir = flag('--legacy', 'src/assets/characters');
// A candidate pack usually ships only the characters it redrew, so scanning one
// must not be reported as "missing wanderer". Only the shipped directory is
// expected to be complete.
const allowMissing = argv.includes('--allow-missing');
const jsonOut = flag('--json', null);

const stat = resolve(target);
const isDir = existsSync(stat) && !extname(stat);
const files = isDir
  ? readdirSync(stat)
      .filter((f) => f.toLowerCase().endsWith('.png'))
      .map((f) => join(stat, f))
  : [stat];

const palette = loadPalette(process.cwd());
const paletteSet = new Set(palette.map(([r, g, b]) => key(r, g, b)));

console.log(`palette: ${palette.length} colours from src/render/palette.ts`);
console.log(`gate:    ${files.length} sheet(s) in ${stat}\n`);

let failures = 0;
const report = [];

const present = new Set(files.map((f) => basename(f, '.png')));
for (const who of allowMissing ? [] : REQUIRED) {
  if (!present.has(who)) {
    console.log(`MISSING  ${who}.png — required by WALK_CHARACTERS in src/render/walkcycle.ts`);
    failures++;
  }
}

for (const file of files) {
  const result = auditSheet(file, palette, paletteSet);
  const bad = result.checks.filter((c) => c.level === 'fail').length;
  const warn = result.checks.filter((c) => c.level === 'warn').length;
  const verdict = bad ? 'FAIL' : warn ? 'WARN' : 'PASS';
  console.log(`${verdict.padEnd(5)} ${result.file}`);
  for (const c of result.checks) {
    const tag = c.level === 'fail' ? '  x' : c.level === 'warn' ? '  !' : c.level === 'info' ? '  -' : '  .';
    console.log(`${tag} ${c.name.padEnd(11)} ${c.detail}`);
  }

  const legacyFile = join(legacyDir, result.file);
  let legacy = null;
  if (existsSync(legacyFile) && resolve(legacyFile) !== resolve(file)) {
    legacy = compareToLegacy(result.img, legacyFile);
    const baseLevel = legacy.baseDiff === 0 ? 'ok' : 'fail';
    console.log(
      `  ${baseLevel === 'ok' ? '.' : 'x'} baseline vs legacy  candidate y=${legacy.baseNew}, legacy y=${legacy.baseOld}, diff ${legacy.baseDiff}px`,
    );
    if (baseLevel === 'fail') failures++;
    console.log(
      `  ~ frames 8-19 vs legacy  mean silhouette overlap ${legacy.mean.toFixed(2)}, ${legacy.same}/12 at the old pose`,
    );
  }
  console.log('');

  failures += bad;
  report.push({ file: result.file, verdict, checks: result.checks, legacy });
}

if (jsonOut) {
  mkdirSync(join(jsonOut, '..'), { recursive: true });
  writeFileSync(jsonOut, `${JSON.stringify({ palette: palette.length, failures, sheets: report }, null, 2)}\n`);
  console.log(`json: ${jsonOut}`);
}

console.log(failures === 0 ? 'RESULT: pass' : `RESULT: ${failures} failing check(s)`);
process.exit(failures === 0 ? 0 : 1);
