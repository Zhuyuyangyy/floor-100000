// AG-46：把首章四位发布者的 idle 首帧烘成 64x96 静帧 PNG（未量化）。
//
// 存在理由：tools/bake-walk.ts 的帧清单停在 W5 的 15 帧（没有 W6 的
// die/pickup），一跑就抛 "baked 15 frames but TOTAL_FRAMES is 20"，而
// build-characters.mjs 只画既有的角色。四位发布者要的是 walkcycle.ts
// 里同款 drawPose(idlePose(0)) + 各自 CharacterColors——和 bakeWalkSheets
// 在启动时烘行走表用的是同一副骨架，所以静帧与运行时画面永远同族。
//
// 本工具只烘"原始"帧：配色里的 mixRgb 派生色（lit/shade 列）不在 16 色
// 板内，出货前必须过 tools/quantize-sheet.mjs 的吸附+门禁（推导链见
// docs/assets/AG-46_PUBLISHER_ART.md）。
//
// 用法：node tools/derive-publisher-stills.ts [outDir]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from './png.mjs';
import {
  FRAME_H,
  FRAME_W,
  idlePose,
  drawPose,
  makeCanvas,
  RECRUITER_COLORS,
  BLACKMARKET_COLORS,
  LAB_CLERK_COLORS,
  BANQUET_STAFF_COLORS,
  type CharacterColors,
} from '../src/render/walkcycle.ts';

// 与 artpack.ts 的 CHARACTER_FILES 一一对应：文件名去掉 npc_ 前缀。
const PUBLISHERS: ReadonlyArray<{ id: string; colors: CharacterColors }> = [
  { id: 'recruiter', colors: RECRUITER_COLORS },
  { id: 'blackmarket', colors: BLACKMARKET_COLORS },
  { id: 'lab_clerk', colors: LAB_CLERK_COLORS },
  { id: 'banquet_staff', colors: BANQUET_STAFF_COLORS },
];

const outDir = process.argv[2] ?? 're/ag46-stills-raw';
mkdirSync(outDir, { recursive: true });

for (const { id, colors } of PUBLISHERS) {
  const cv = makeCanvas(FRAME_W, FRAME_H);
  // idle 首帧——AG-19 把 char-*.png 静帧换成"行动表待机帧（--still 6）"时
  // 定下的先例：静帧就是 sheet 的第 6 列，运行时 idle 动画的第一帧。
  drawPose(cv, idlePose(0), colors, 0);
  const file = join(outDir, `char-${id}.png`);
  writeFileSync(file, encodePng({ width: FRAME_W, height: FRAME_H, channels: 4, pixels: Buffer.from(cv.px) }));
  console.log(`wrote ${file} (${FRAME_W}x${FRAME_H} idle frame, unquantized)`);
}
