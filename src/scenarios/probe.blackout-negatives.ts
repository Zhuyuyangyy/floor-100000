import { createNewGame } from '../core/gameState';
import { setFlag, flagCount } from '../systems/WorldFlags';
import { ALIN_REPAIR_GATE_FLAG } from '../data/floorGates';
import { getNpc } from '../data/npcs';
import { countItem } from '../systems/InventorySystem';
import {
  BLACKOUT_FLAG,
  BLACKOUT_PROMISE_DAYS,
  BLACKOUT_TRUST_FOR_STANCE,
  blackoutStageOf,
} from '../data/blackoutCrisis';
import { runAlinGiftScenario } from './alinGiftDemo';
import { runAlinRepairScenario } from './alinRepairDemo';
import {
  alinStanceOf,
  ensureBlackoutHelpRequested,
  observeBlackout,
  requestBlackoutHelp,
  runBlackoutRepair,
  syncBlackoutCrisis,
  verifyBlackoutMaterials,
} from './blackoutCrisis';

const game = createNewGame(2026);
game.currentFloor = getNpc('alin').floor;
game.player.x = getNpc('alin').x;

const show = (label: string): void => {
  const o = observeBlackout(game);
  console.log(
    `${label} | stage=${blackoutStageOf(game)} stance=${o.alinStance} trust=${o.alinTrust.toFixed(1)}` +
    ` 门槛=${BLACKOUT_TRUST_FOR_STANCE[o.alinStance]} 水=${countItem(game.player.inventory, 'clean_water')}` +
    ` 粮=${countItem(game.player.inventory, 'ration_pack')} broken=${flagCount(game, BLACKOUT_FLAG.promiseBroken)}` +
    ` promiseDay=${flagCount(game, BLACKOUT_FLAG.promiseDay)}`,
  );
};

show('开局');

// 只送 1 件够过检查——后面要靠失信路径，不提前攒太多
for (const itemId of ['ration_pack', 'ration_pack', 'clean_water'] as const) {
  await runAlinGiftScenario(game, itemId, 1);
}
game.player.inventory.slots.push({ itemId: 'wood', quantity: 2 });
game.player.inventory.slots.push({ itemId: 'tape', quantity: 1 });
await runAlinRepairScenario(game);
show('送3件+修门');

syncBlackoutCrisis(game);
show('危机启动');

ensureBlackoutHelpRequested(game);
show('接单后');

// 拖着不交货
game.day = 1 + BLACKOUT_PROMISE_DAYS + 1;
syncBlackoutCrisis(game);
show('跨天失信');

// 现在手上有零件，看能否修
game.player.inventory.slots.push({ itemId: 'fuse', quantity: 1 });
game.player.inventory.slots.push({ itemId: 'wire', quantity: 1 });
const r1 = await runBlackoutRepair(game);
console.log(`\n有零件但未核料 -> ${r1.status} / ${r1.detail}`);
console.log(`  message = 「${r1.message}」`);

const v = verifyBlackoutMaterials(game);
console.log(`\n核料 -> ok=${v.ok} detail=${v.detail} msg=「${v.message}」`);
show('核料后');

const r2 = await runBlackoutRepair(game);
console.log(`\n核料后维修 -> ${r2.status} / ${r2.detail}`);
console.log(`  message = 「${r2.message}」`);
if (r2.nextStep) console.log(`  nextStep = ${JSON.stringify(r2.nextStep)}`);

// 再跨一天，看核料是否要重做
game.day += 1;
const r3 = await runBlackoutRepair(game);
console.log(`\n隔天再修 -> ${r3.status} / ${r3.detail}`);
console.log(`  message = 「${r3.message}」`);
show('隔天');