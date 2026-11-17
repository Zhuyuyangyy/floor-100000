#!/usr/bin/env node
// tools/balance-sim.mjs — v0.1 数值健康表（AG-75 上架前 sanity，一次性脚本，可留仓）
//
// 跑法：node tools/balance-sim.mjs
//   Node >= 22.18 原生剥离去类型；更老的 Node 加 --experimental-strip-types。
//
// 它回答三个问题，全部用仓里真实数据算，不抄数值：
//   1. 物资曲线：前 10 层的搜刮产出（保底 + 期望）对得上每日消耗吗？
//   2. 战斗曲线：每只怪的 TTK（玩家几回合打死它）与 ETTK（它几回合打死玩家），
//      以及命中率公式下哪些属性是死余量。
//   3. 制作成本：哪条配方的材料需求超过前 10 层的可获取总量。
//
// 数据来源（都不是本脚本的副本）：
//   - 消耗/上限：config/game-balance.json
//   - 怪物名册：src/systems/monsters.ts（type-only import，Node 可直接 import）
//   - 配方表：src/data/recipes.ts（同上）
//   - 楼层搜刮表：src/data/floorTemplates.ts —— 该模块有 extensionless 的运行时
//     import，Node 剥离去后加载不了，所以这里用正则抽取它的字面量。文件结构是
//     冻结设计（v0.1 固定 1-10 层），抽取后有条数 sanity check，形状一变就大声
//     abort，不会静默算错。
//   - 战斗公式：src/systems/combat.ts 的 rollHit / rawDamage（此处按注释镜像，
//     因为 combat.ts import core/config，Node 下同样加载不了）。
//
// 输出：一张「数值健康表」。WARN/FAIL 只报告，不改数据——改不改是用户的决定。

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── 数据装载 ──────────────────────────────────────────────────────────────

const balance = JSON.parse(readFileSync(join(ROOT, 'config/game-balance.json'), 'utf8'));

let MONSTERS;
let RECIPES;
try {
  // pathToFileURL：Windows 下裸绝对路径不是合法 ESM specifier。
  ({ MONSTERS } = await import(pathToFileURL(join(ROOT, 'src/systems/monsters.ts')).href));
  ({ RECIPES } = await import(pathToFileURL(join(ROOT, 'src/data/recipes.ts')).href));
} catch (err) {
  console.error('无法加载 src 数据模块（需要 Node >= 22.18 或 --experimental-strip-types）：', err.message);
  process.exit(2);
}

const templatesSrc = readFileSync(join(ROOT, 'src/data/floorTemplates.ts'), 'utf8');

// 楼层搜刮表抽取。FLOOR_TEMPLATES 的形状：
//   N: { floorNumber: N, ..., containers: [ { ..., loot: [ { itemId, min, max, probability, guaranteed? } ] } ],
//        ground: [ { itemId, quantity } ] }
// 顶层键是两空格缩进的 `N: {`；loot 条目是一行字面量。
function extractFloorLoot(src) {
  const floors = new Map();
  const keyRe = /^ {2}(\d+): \{$/gm;
  const marks = [...src.matchAll(keyRe)];
  for (let i = 0; i < marks.length; i++) {
    const floor = Number(marks[i][1]);
    const start = marks[i].index + marks[i][0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : src.length;
    const block = src.slice(start, end);
    const entries = [];
    for (const m of block.matchAll(/\{ itemId: '([a-z_]+)', min: (\d+), max: (\d+), probability: ([\d.]+)(, guaranteed: true)?/g)) {
      entries.push({
        itemId: m[1],
        min: Number(m[2]),
        max: Number(m[3]),
        probability: Number(m[4]),
        guaranteed: m[5] !== undefined, // m[5] 是 ", guaranteed: true" 整组
      });
    }
    for (const m of block.matchAll(/ground: \[\{ itemId: '([a-z_]+)', quantity: (\d+)/g)) {
      entries.push({ itemId: m[1], min: Number(m[2]), max: Number(m[2]), probability: 1, guaranteed: true });
    }
    floors.set(floor, entries);
  }
  return floors;
}

const floorLoot = extractFloorLoot(templatesSrc);
const SIM_FLOORS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
for (const f of SIM_FLOORS) {
  if (!floorLoot.has(f) || floorLoot.get(f).length === 0) {
    console.error(`floorTemplates 抽取失败：第 ${f} 层没有拿到搜刮条目（文件形状变了？）`);
    process.exit(2);
  }
}

// ── 1. 物资曲线 ───────────────────────────────────────────────────────────

const p = balance.player;
const HOURS_PER_DAY = 24;
const thirstPerDay = p.thirstLossPerGameHour * HOURS_PER_DAY; // 3 * 24
const hungerPerDay = p.hungerLossPerGameHour * HOURS_PER_DAY; // 2 * 24
// 消耗品回复量：e2e/ui.spec.ts 对净水/口粮 Tooltip 的断言（水分 +30 / 饱食 +30）。
const WATER_RESTORE = 30;
const FOOD_RESTORE = 30;
const WATER_ITEMS = new Set(['clean_water', 'dirty_water']); // 脏水可炼净水（purifier 1:1）
const FOOD_ITEMS = new Set(['bread', 'ration_pack']);

function expectedYield(entries) {
  // Σ probability × mean(min,max)，保底条目 probability=1 原样计入。
  const out = new Map();
  for (const e of entries) {
    const mean = (e.min + e.max) / 2;
    out.set(e.itemId, (out.get(e.itemId) ?? 0) + e.probability * mean);
  }
  return out;
}

console.log('════════ 数值健康表（AG-75 · tools/balance-sim.mjs） ════════');
console.log('');
console.log('【1】物资曲线：前 10 层搜刮产出 vs 每日消耗');
console.log(`    每日消耗：口渴 ${thirstPerDay}/天 · 饥饿 ${hungerPerDay}/天（game-balance.json player 段）`);
console.log('    层   期望净水  保底净水  期望食物  保底食物  材料条目数');
let totalWater = 0;
let totalFood = 0;
let totalGuaranteedWater = 0;
let totalGuaranteedFood = 0;
const materialTotals = new Map();
for (const f of SIM_FLOORS) {
  const entries = floorLoot.get(f);
  const exp = expectedYield(entries);
  const water = [...WATER_ITEMS].reduce((s, id) => s + (exp.get(id) ?? 0), 0);
  const food = [...FOOD_ITEMS].reduce((s, id) => s + (exp.get(id) ?? 0), 0);
  const gWater = entries.filter((e) => WATER_ITEMS.has(e.itemId)).reduce((s, e) => s + (e.guaranteed ? e.min : 0), 0);
  const gFood = entries.filter((e) => FOOD_ITEMS.has(e.itemId)).reduce((s, e) => s + (e.guaranteed ? e.min : 0), 0);
  for (const [id, n] of exp) {
    if (!WATER_ITEMS.has(id) && !FOOD_ITEMS.has(id)) materialTotals.set(id, (materialTotals.get(id) ?? 0) + n);
  }
  totalWater += water;
  totalFood += food;
  totalGuaranteedWater += gWater;
  totalGuaranteedFood += gFood;
  console.log(
    `    ${String(f).padStart(2)}   ${water.toFixed(1).padStart(6)}   ${String(gWater).padStart(6)}   ${food.toFixed(1).padStart(6)}   ${String(gFood).padStart(6)}   ${String(entries.length).padStart(6)}`,
  );
}
const waterDays = (totalWater * WATER_RESTORE) / thirstPerDay;
const foodDays = (totalFood * FOOD_RESTORE) / hungerPerDay;
const gWaterDays = (totalGuaranteedWater * WATER_RESTORE) / thirstPerDay;
const gFoodDays = (totalGuaranteedFood * FOOD_RESTORE) / hungerPerDay;
console.log(`    合计：期望净水 ${totalWater.toFixed(1)} 瓶 ≈ ${waterDays.toFixed(1)} 天水 · 保底 ${totalGuaranteedWater} 瓶 ≈ ${gWaterDays.toFixed(1)} 天水`);
console.log(`          期望食物 ${totalFood.toFixed(1)} 份 ≈ ${foodDays.toFixed(1)} 天食 · 保底 ${totalGuaranteedFood} 份 ≈ ${gFoodDays.toFixed(1)} 天食`);
const verdicts = [];
if (gWaterDays < 1) verdicts.push(`FAIL：全保底搜刮 10 层撑不过 1 天口渴（${gWaterDays.toFixed(2)} 天）`);
else verdicts.push(`PASS：全保底 10 层 ≈ ${gWaterDays.toFixed(1)} 天水 / ${gFoodDays.toFixed(1)} 天食，两段探索之间有喘气空间`);
if (waterDays > 30) verdicts.push(`WARN：期望产出 ${waterDays.toFixed(0)} 天水——10 层扫完水可能再也用不完，后期搜刮激励衰减`);
console.log(`    → ${verdicts.join('；')}`);
console.log('');

// ── 2. 战斗曲线 ───────────────────────────────────────────────────────────
// 公式镜像 src/systems/combat.ts（该文件 import core/config，Node 加载不了，
// 这里按源码注释逐字复述）：
//   命中：rng.nextInt(0,20) + accuracy > 10 + defender.defense + defender.evasion
//         → P(hit) = #{roll∈0..19 : roll > 10+def+eva-acc} / 20
//   伤害：max(1, damage - floor(defense/2))
//   玩家：裸伤 2、撬棍 +3；accuracy 5 / defense 2 / evasion 3（combat.ts 常量）

const PLAYER = { hp: p.hpMax, bare: 2, crowbar: 2 + 3, accuracy: 5, defense: 2, evasion: 3 };

function pHit(acc, def, eva) {
  const threshold = 10 + def + eva - acc; // roll 必须严格大于它
  const n = 19 - Math.floor(threshold); // roll ∈ {threshold+1 .. 19}
  return Math.max(0, Math.min(1, n / 20));
}

function rawDamage(damage, defense) {
  return Math.max(1, damage - Math.floor(defense / 2));
}

console.log('【2】战斗曲线：怪物 TTK / ETTK（公式镜像 src/systems/combat.ts）');
console.log(`    玩家：HP ${PLAYER.hp} · 裸伤 ${PLAYER.bare} · 撬棍 ${PLAYER.crowbar} · 命中公式 acc5/def2/eva3`);
console.log('    层  怪物         HP  伤  玩家命中%  裸伤TTK  棍TTK   怪命中%  ETTK(回合)');
const combatFlags = [];
let alwaysHitCount = 0;
for (const m of MONSTERS) {
  const hitBare = pHit(PLAYER.accuracy, m.defense, m.evasion);
  const dmgBare = rawDamage(PLAYER.bare, m.defense);
  const ttkBare = Math.ceil(m.hp / (dmgBare * hitBare));
  const dmgCrow = rawDamage(PLAYER.crowbar, m.defense);
  const ttkCrow = Math.ceil(m.hp / (dmgCrow * hitBare));
  const monsterHit = pHit(m.accuracy, PLAYER.defense, PLAYER.evasion);
  const monsterDmg = rawDamage(m.damage, PLAYER.defense);
  const ettk = Math.ceil(PLAYER.hp / (monsterDmg * monsterHit));
  if (monsterHit >= 0.999) alwaysHitCount += 1;
  if (ttkBare > 10) combatFlags.push(`${m.name}（${m.minFloor} 层带）裸拳 TTK ${ttkBare} 回合——没武器啃不动`);
  if (ettk <= 8) combatFlags.push(`${m.name} ETTK 仅 ${ettk} 回合——站桩对拼必死，必须格挡/逃`);
  console.log(
    `    ${String(m.minFloor).padStart(2)}  ${m.name.padEnd(8)} ${String(m.hp).padStart(3)} ${String(m.damage).padStart(3)}   ${(hitBare * 100).toFixed(0).padStart(6)}   ${String(ttkBare).padStart(6)} ${String(ttkCrow).padStart(6)}   ${(monsterHit * 100).toFixed(0).padStart(6)}   ${String(ettk).padStart(6)}`,
  );
}
if (alwaysHitCount === MONSTERS.length) {
  combatFlags.push(
    `全部 ${MONSTERS.length} 只怪的命中率恒为 100%——怪物 accuracy（68-82）与玩家 defense/evasion（2/3）不在命中公式的同一量纲上：怪物 accuracy 是死余量，玩家 evasion 完全无效、defense 只在伤害公式里减 1 点`,
  );
}
console.log(`    → ${combatFlags.length > 0 ? combatFlags.join('；') : 'PASS：无明显破坏'}`);
console.log('');

// ── 3. 制作成本曲线 ───────────────────────────────────────────────────────

console.log('【3】制作成本：配方材料 vs 前 10 层可获取总量（期望值）');
console.log('    配方                材料需求                        判定');
const craftFlags = [];
for (const r of RECIPES) {
  const parts = Object.entries(r.cost).map(([id, n]) => `${id}×${n}`);
  const over = Object.entries(r.cost).filter(([id, n]) => (materialTotals.get(id) ?? 0) < n);
  const verdict = over.length > 0 ? `FAIL：${over.map(([id, n]) => `${id} 需 ${n} > 可获 ${(materialTotals.get(id) ?? 0).toFixed(1)}`).join('，')}` : 'ok';
  if (over.length > 0) craftFlags.push(`${r.displayName}：${over.map(([id]) => id).join('/')} 前 10 层不够`);
  console.log(`    ${r.displayName.padEnd(14)} ${parts.join(' + ').padEnd(28)} ${verdict}`);
}
console.log(`    → ${craftFlags.length > 0 ? `WARN：${craftFlags.join('；')}（高层段/交易补足则不算破坏）` : 'PASS：前 10 层材料可覆盖全部配方'}`);
console.log('');
console.log('════════ 完 ════════');
