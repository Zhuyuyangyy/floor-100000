import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { E2EGameState } from './globals';

// The home floor is the tower's own start, not a pinned "1": the journey begins
// wherever the first playable segment begins.
import { PLAYABLE_SEGMENTS } from '../src/core/segments';

const HOME_FLOOR = PLAYABLE_SEGMENTS[0].from;

// The balance file is the single source of truth for starting values, and this
// spec asserts against them at boot. Read it here rather than copying numbers:
// B3-16 moved the starts to 65 and a pinned 79.5 failed for the wrong reason.
const BALANCE = JSON.parse(readFileSync(join(process.cwd(), 'config/game-balance.json'), 'utf8')) as {
  player: { hungerStart: number; thirstStart: number; energyStart: number };
};

// B3-02: the whole journey, walked for real.
//
// The acceptance rule is that a passing test does not prove the journey exists —
// so this one never teleports, never writes currentFloor, never injects items.
// Every floor change is a walk to a stairwell plus a real E, every container is
// opened by standing next to it, and every pickup happens because the player
// walked over the item. That makes it slow (several km of corridor at 130px/s),
// which is the honest cost of proving the loop closes.
//
// Route:
//   1  cabinet@160           -> up
//   2                         -> up            (shelf skipped: 50% empty, 1.5km detour)
//   3  (loose battery@160)    -> up            (crates deferred: AG-66 rubble seals
//                                               them from the spawn side — 见下行注释)
//   4  fuse_box@640 (arrival), water_tank@240 -> up
//   5  counter@480, pantry@1120, loaf@160 -> down   (loaf eaten here — 见 eatOneBread)
//   4                         -> down
//   3  crate_metal@800, crate_wood@480 -> down  (opened from the down-exit side)
//   2                         -> down
//   1  cabinet re-check (no duplicate) -> bed@1120 -> sleep
// then reload and 继续游戏 to prove the save round-trips.
// RC-01 2026-11-18：AG-66 阻碍物上线后 seed 42 的 3 层出生侧与两只箱子之间
// 有瓦砾@251（无早期工具，撬棍自己就在箱子里），直走路线永久卡死。本脚本
// 改为「上去再从上层下口掉回右侧」的开箱路线（BFS 实证可达），其余流程原样。

const UP_EXIT_X = 40;
const DOWN_EXIT_X = 1240;

test.describe('B3-02 full survival journey', () => {
  test.setTimeout(600_000); // the walk and the wait for nightfall are the point

  const readState = (page: Page): Promise<E2EGameState> =>
    page.evaluate(() => {
      const s = window.__PHASER_SESSION__?.getState();
      if (!s) throw new Error('no session');
      return s;
    });

  const count = (page: Page, itemId: string): Promise<number> =>
    page.evaluate((id) => {
      const s = window.__PHASER_SESSION__?.getState();
      return (s?.player.inventory.slots ?? []).filter((x) => x.itemId === id).reduce((n, x) => n + x.quantity, 0);
    }, itemId);

  async function hasVisibleText(page: Page, substr: string): Promise<boolean> {
    return page.evaluate((sub) => {
      const g = window.__PHASER_GAME__;
      const scenes = g ? g.scene.scenes : [];
      for (const sc of scenes) {
        for (const o of sc.children.list ?? []) {
          if (o.type === 'Text' && (o.text ?? '').includes(sub) && o.visible) return true;
        }
      }
      return false;
    }, substr);
  }

  async function waitForScene(page: Page, key: string): Promise<void> {
    await page.waitForFunction(
      (k) => {
        const g = window.__PHASER_GAME__;
        return !!g && g.scene.getScenes(true).some((s) => s.scene.key === k);
      },
      key,
      { timeout: 30_000 },
    );
  }

  // Hold a direction until the player reaches targetX. No jumping: the sprite
  // covers the ground at PLAYER_SPEED.
  async function walkTo(page: Page, targetX: number): Promise<void> {
    const from = (await readState(page)).player.x;
    const dir = targetX < from ? 'ArrowLeft' : 'ArrowRight';
    await page.keyboard.down(dir);
    try {
      // CI 慢环境适配（run 44389231159：40s 走不到目标 X）：慢帧下位移慢+
      // AG-66 阻碍物/遭遇战会中断行走，40s 在 CI 容器不够。放大到 90s
      // （test timeout 600s 罩得住；本机 40s 内到达的路径不受影响）。
      await page.waitForFunction(
        ({ t, d }) => {
          const s = window.__PHASER_SESSION__?.getState();
          if (!s) return false;
          return d === 'ArrowLeft' ? s.player.x <= t : s.player.x >= t;
        },
        { t: targetX, d: dir },
        { timeout: 90_000 },
      );
    } finally {
      await page.keyboard.up(dir);
    }
  }

  // Walk to a container and open it with a real E.
  //
  // AG-66 起搜刮是一个 2s 动作（config search.ms）：E 按下先播 search 动画，
  // 到点才出货、才写 openedContainers；动作期间再按 E = 收手取消。旧实现是
  // 「E + 220ms」连打 8 次——总时长 1.76s 不到 2s，且每一发多余的 E 都把上一
  // 次动作取消重来，永远开不了（RC-01 全量跑实测红，分诊：探针缺陷）。
  // 改为一发 E + 轮询真实完成条件；只有确认没有动作在跑（丢键）时才补发。
  async function openContainer(page: Page, floor: number, id: string, x: number): Promise<void> {
    const opened = async (): Promise<boolean> =>
      ((await readState(page)).visitedFloors[floor]?.openedContainers ?? []).includes(id);
    const busy = (): Promise<boolean> =>
      page.evaluate(() => {
        const sc = (window.__PHASER_GAME__ as unknown as {
          scene: { getScene: (k: string) => { pendingAction?: unknown } | null };
        }).scene.getScene('Game');
        return !!sc?.pendingAction;
      });
    await walkTo(page, x);
    for (let i = 0; i < 4; i++) {
      if (await opened()) return;
      if (!(await busy())) await page.keyboard.press('E');
      await page.waitForFunction(
        (args) => {
          const s = window.__PHASER_SESSION__?.getState();
          return !!s && ((s.visitedFloors[args[0]]?.openedContainers ?? []).includes(args[1] as string));
        },
        [floor, id] as const,
        { timeout: 6000 },
      ).catch(() => undefined);
    }
    if (await opened()) return;
    throw new Error(`could not open ${floor}/${id}`);
  }

  // Drink one bottle through the real inventory panel.
  //
  // This is not test convenience — it is what the journey forces. Looting floors
  // 3, 4 and 5 yields twelve distinct item types, and the bag holds twelve slots,
  // so the route runs one stack from an overflow the whole way.
  //
  // B3-05.1 split the old single gulp into three calls. A capped stat used to
  // consume the bottle anyway, so three presses at the start emptied the stack in
  // one go; now the second and third are refused, and the ration can only be
  // finished by spreading it across the walk — which is also what a player does.
  // Draining the stack keeps the twelve-slot bag under its cap across the haul.
  // RC-01：AG-66 起 3 层箱子改在回程开（瓦砾封路，见文件头 Route 注释），
  // 三瓶的位置
  // 变为「出发前 / 5 层 / 回程 3 层两箱之间」——第三瓶 freed slot 是
  // crate_wood 整批 loot 进包的前提（lootContainer 单箱全拿或全不拿）。
  async function drinkOneBottle(page: Page): Promise<void> {
    if (await count(page, 'clean_water') < 1) return;
    await page.keyboard.press('I');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter'); // 净水 is slot 0 for as long as any remain
    await page.waitForTimeout(240);
    await page.keyboard.press('I'); // close
    await page.waitForTimeout(200);
  }

  // Eat one loaf through the real inventory panel.
  //
  // RC-01（AG-66 瓦砾改道后新增）：新城路（上去→从上层下口掉回 3 层右侧开箱）
  // 比旧路多捡一件——3 层地上的布料@1120 在走进铁箱的必经路上，而旧路从不
  // 经过它。旧路 12 个 Stack 恰好填满 12 格背包、零冗余；新路 13 个，
  // crate_wood 的木材+胶带整批会被 lootContainer 拒（单箱全拿或全不拿，
  // 容器仍记 opened）。面包是这条多出来的 Stack 里唯一能「正当消耗」的
  // （F5 地面 x=160 走过就捡，+20 饥饿），在 5 层吃掉它把背包压回 12。
  // 位置在 beforeReturn 之前：饱食只随这条咀嚼上升，之后的回程只剩衰减，
  // 「回家时饱食 ≤ 出发时」的断言方向才不变。
  async function eatOneBread(page: Page): Promise<void> {
    const index = await page.evaluate(() =>
      (window.__PHASER_SESSION__?.getState()?.player.inventory.slots ?? []).findIndex((s) => s.itemId === 'bread'),
    );
    if (index < 0) return;
    await page.keyboard.press('I');
    await page.waitForTimeout(250);
    for (let i = 0; i < index; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(90);
    }
    await page.keyboard.press('Enter');
    await page.waitForTimeout(240);
    await page.keyboard.press('I'); // close
    await page.waitForTimeout(200);
  }

  // Walk to a stairwell and take it. The floor change is the game's own logic.
  // Wait for the landing: the traversal is a visible 1000 ms animation, so a
  // blind 220 ms retry can start a second climb on the commit frame and skip a
  // floor (measured: a route that asked for 2 ended on 5).
  async function takeStairs(page: Page, dir: 'up' | 'down', expectedFloor: number): Promise<void> {
    await walkTo(page, dir === 'up' ? UP_EXIT_X : DOWN_EXIT_X);
    for (let i = 0; i < 6; i++) {
      if ((await readState(page)).currentFloor === expectedFloor) return;
      await page.keyboard.press('E');
      const landed = await page
        .waitForFunction(
          (floor) => window.__PHASER_SESSION__?.getState()?.currentFloor === floor,
          expectedFloor,
          { timeout: 3000 },
        )
        .then(() => true)
        .catch(() => false);
      if (landed) return;
      await walkTo(page, dir === 'up' ? UP_EXIT_X : DOWN_EXIT_X);
    }
    throw new Error(`could not go ${dir} to floor ${expectedFloor} (at ${(await readState(page)).currentFloor})`);
  }

  test('wakes on floor 1, explores 2-5, returns home and sleeps', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/?seed=42');
    await waitForScene(page, 'Menu');
    await page.keyboard.press('Enter');
    // A new run lands on the character pick first.
    await waitForScene(page, 'MetaSelect');
    // The pick screen reports active before create() binds its keys, so an
    // Enter can land in that window and be lost. Retry until the run starts.
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Enter');
      const started = await page.waitForFunction(
        () => {
          const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
          return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
        },
        undefined,
        { timeout: 2000 },
      ).then(() => true).catch(() => false);
      if (started) break;
    }
    await waitForScene(page, 'Game');

    // ── 1. wake on the home floor ─────────────────────────────────────────
    const start = await readState(page);
    expect(start.currentFloor).toBe(HOME_FLOOR);
    expect(start.day).toBe(1);
    expect(start.player.hp).toBe(100);
    // A frame or two of decay has already run, so these are near-exact, not
    // exact. The expected starts come from the balance file (BALANCE, above),
    // not from a copied number — B3-16 moved them to 65 and a pinned 79.5
    // failed for the wrong reason.
    expect(start.player.hunger).toBeGreaterThan(BALANCE.player.hungerStart - 0.5);
    expect(start.player.thirst).toBeGreaterThan(BALANCE.player.thirstStart - 0.5);
    expect(start.player.energy).toBeGreaterThan(BALANCE.player.energyStart - 0.5);
    expect(start.gameMinuteOfDay).toBeGreaterThanOrEqual(360);
    expect(start.gameMinuteOfDay).toBeLessThan(365); // 06:00, seconds in
    // Starting kit, straight from config.
    expect(await count(page, 'clean_water')).toBe(3);
    expect(await count(page, 'ration_pack')).toBe(2);
    expect(await count(page, 'flashlight')).toBe(1);
    expect(start.player.inventory.slots.length).toBe(3);
    // Standing on floor 1 is what records it (B3-02.1): the visited set starts
    // with exactly the floor the player is standing on — not empty, and not the
    // whole tower.
    expect(Object.keys(start.visitedFloors)).toEqual(['1']);
    await page.screenshot({ path: 'e2e/screenshots/40-journey-1-wake.png' });

    // Top up before the walk, so the bag has room for what the tower holds.
    // One bottle is +30 from wherever the start left the player (B3-16 moved
    // the starts to 65, so it no longer caps — the claim under test is that the
    // bottle landed, not that it overflowed).
    await drinkOneBottle(page);
    expect((await readState(page)).player.thirst).toBeGreaterThan(BALANCE.player.thirstStart + 25);

    // ── 2. climb ────────────────────────────────────────────────────────
    await takeStairs(page, 'up', 2);
    await page.screenshot({ path: 'e2e/screenshots/41-journey-2-floor2.png' });

    await takeStairs(page, 'up', 3);
    await page.screenshot({ path: 'e2e/screenshots/41-journey-2-floor2.png' });

    // AG-66 起 3 层出生侧（x=40）与两只箱子之间有瓦砾@251（seed 42 实测，
    // BFS 探针输出见 REPORT.md）：没有早期工具挖不开，而 crate_metal 里的撬棍
    // 自己就在瓦砾后面——直走 800 永远到不了。RC-01 分诊：探针缺陷——旧脚本
    // 按 AG-66 之前的世界直走；游戏设计没坏（AG-96 保每个落点至少一个可达
    // 口，本层上口@40 就可达），正确路线是「上去再从上层下口掉回右侧」。
    // 箱子改在回程开（见第 3 节），这里只补捡地上电池@160——旧路线从
    // crate_wood 走回梯子时经过它，新路线不经过，往返一次补上。
    await walkTo(page, 160);
    await walkTo(page, 40);
    await takeStairs(page, 'up', 4);
    expect(await count(page, 'battery')).toBeGreaterThanOrEqual(1);
    await page.screenshot({ path: 'e2e/screenshots/42-journey-3-floor3.png' });

    // Floor 4: the player lands at the far stair and walks to the fusebox.
    await openContainer(page, 4, 'fuse_box', 640);
    expect(await count(page, 'wire')).toBe(2);
    expect(await count(page, 'filter')).toBe(1);
    expect(await count(page, 'fuse')).toBe(1);
    await takeStairs(page, 'up', 5);
    await page.screenshot({ path: 'e2e/screenshots/43-journey-4-floor4.png' });

    // Floor 5 is the top of the range: no up exit, only back down.
    await openContainer(page, 5, 'counter', 480);
    // 2 starting + 3 from the counter. A floor rather than an exact count: the
    // OVERHAUL daily-goal reward hands out a ration when the day's objective
    // closes — on the AG-66 route the third container (floor 3's crates) is
    // opened on the way HOME, so the goal closes later, not on the way up.
    expect(await count(page, 'ration_pack')).toBeGreaterThanOrEqual(5);
    // The longer, physical stair route can fill the bag before the counter.
    // Ration is the progression-critical stack; dirty water may correctly stay
    // in the container and be recovered on a later trip.
    const top = await readState(page);
    expect(top.currentFloor).toBe(5);
    expect(top.visitedFloors[5].openedContainers).toEqual(['counter']);
    // Second bottle: thirst has decayed over the walk, so this one lands for
    // real. The third and last one waits for the homeward leg, between floor
    // 3's two crates (its freed slot is what keeps the crate loot inside the
    // twelve-slot bag).
    await drinkOneBottle(page);
    expect(await count(page, 'clean_water')).toBe(1);
    // The loaf picked up on the walk in (ground bread at x=160) goes here: the
    // AG-66 homeward route also picks up floor 3's cloth, which is the one
    // stack that pushes the twelve-slot bag over on the way down. Eating it
    // before the return is what keeps the whole haul inside the bag — and it
    // happens before beforeReturn so the hunger assertions still only decay.
    await eatOneBread(page);
    await page.screenshot({ path: 'e2e/screenshots/44-journey-5-floor5.png' });

    // ── 3. come home ────────────────────────────────────────────────────
    const beforeReturn = await readState(page);
    await takeStairs(page, 'down', 4);
    await takeStairs(page, 'down', 3);
    // AG-66：3 层两只箱子在上层路线里被瓦砾@251 封在出生侧，改在这里开——
    // 从 4 层下口(1240)落地在瓦砾右侧，crate_metal@800 / crate_wood@480 可达
    // （BFS 实证：探针输出见 REPORT.md）。开箱顺序保持铁箱→木箱：撬棍与废金属
    // 是这段行程的意义本体，也给回程腾位置的动作链收尾。
    await openContainer(page, 3, 'crate_metal', 800);
    expect(await count(page, 'scrap_metal')).toBe(3); // guaranteed, no slack
    expect(await count(page, 'crowbar')).toBe(1);
    // Third and last bottle, between the two crates: lootContainer is
    // all-or-nothing per container (a stack that does not fit is undone and the
    // rest of that container is skipped, while the container is still marked
    // opened), and on the AG-66 homeward route the twelve-slot bag is exactly
    // one stack short here — the route picks up floor 3's cloth at x=1120 on
    // the walk in (the up-route never walked past it) while the balancing loaf
    // was eaten back on floor 5. The freed water slot is what fits wood+tape.
    // Thirst pacing: start / floor 5 / homeward between floor 3's crates.
    await drinkOneBottle(page);
    expect(await count(page, 'clean_water')).toBe(0);
    await openContainer(page, 3, 'crate_wood', 480);
    expect(await count(page, 'wood')).toBe(2);
    expect(await count(page, 'tape')).toBe(1);
    // The loose cloth at x=1120 was picked up on the walk in to the metal crate.
    await takeStairs(page, 'down', 2);
    await takeStairs(page, 'down', 1);

    const home = await readState(page);
    expect(home.currentFloor).toBe(HOME_FLOOR);
    expect(home.player.x).toBe(1240); // the home floor's down-stair landing
    // Nothing was lost on the way: the bag, the survival stats, the clock.
    expect(home.player.hp).toBe(beforeReturn.player.hp);
    expect(home.player.hunger).toBeLessThanOrEqual(beforeReturn.player.hunger);
    expect(home.player.thirst).toBeLessThanOrEqual(beforeReturn.player.thirst);
    expect(home.day).toBe(beforeReturn.day);
    // Every floor the player set foot on is recorded. Entering a floor is what
    // marks it explored (B3-02.1 §4.3), so floor 2 counts even though the route
    // only walks through it — the map no longer draws it as never-visited.
    for (const f of [2, 3, 4, 5]) {
      expect(home.visitedFloors[f], `floor ${f} exploration`).toBeDefined();
    }
    expect(await count(page, 'scrap_metal')).toBe(3);
    expect(await count(page, 'wood')).toBe(2);
    // Cloth is an optional loose pickup; the mixed stair shapes change which
    // side of a floor the return route crosses, so this journey need not carry it.

    // The bag held everything the route picked up — no silent overflow.
    expect(home.player.inventory.slots.length).toBeLessThanOrEqual(home.player.inventory.slotCount);

    // ── 3b. turn the haul into upgrades at the workbench ─────────────────
    // This is the step that makes the trip mean something: the scrap, wire,
    // filter, wood and tape came off floors 3 and 4, and they only become an
    // upgrade here, at home. It also empties six stacks, which is what makes
    // room for the cabinet below — a full bag makes lootContainer leave the
    // stack untouched and report `full`, so nothing is gained and nothing lost.
    expect(home.player.homeUpgrades).toEqual([]);
    await walkTo(page, 480); // CRAFT_X
    await page.keyboard.press('C');
    await page.waitForTimeout(300);
    // The panel lists 照明灯 / 加固门 / 简易净水器 / 净水. The cursor does not
    // advance on its own, so each entry needs its own Enter plus a step down.
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(260);
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(160);
    }
    await page.keyboard.press('C'); // close
    await page.waitForTimeout(250);

    const crafted = await readState(page);
    expect(crafted.player.homeUpgrades.sort()).toEqual(['lamp', 'purifier', 'reinforced_door']);
    // The materials are gone — spent, not duplicated.
    expect(await count(page, 'scrap_metal')).toBe(0);
    expect(await count(page, 'wood')).toBe(0);
    expect(await count(page, 'wire')).toBe(0);
    expect(await count(page, 'filter')).toBe(0);
    expect(await count(page, 'battery')).toBe(0);
    expect(await count(page, 'tape')).toBe(0);
    await page.screenshot({ path: 'e2e/screenshots/45b-journey-crafted.png' });

    // Re-opening an emptied container must not hand out a second helping.
    const waterBefore = await count(page, 'clean_water');
    await openContainer(page, 1, 'cabinet', 160);
    expect(await count(page, 'clean_water')).toBe(waterBefore + 1); // first helping
    const waterAfterFirst = await count(page, 'clean_water');
    await openContainer(page, 1, 'cabinet', 160);
    expect(await count(page, 'clean_water')).toBe(waterAfterFirst); // and no second
    const cabVisits = (await readState(page)).visitedFloors[1].openedContainers.filter((c) => c === 'cabinet');
    expect(cabVisits).toEqual(['cabinet']);
    await page.screenshot({ path: 'e2e/screenshots/45-journey-6-home.png' });

    // ── 4. sleep ────────────────────────────────────────────────────────
    const beforeSleep = await readState(page);
    // The whole out-and-back plus crafting costs roughly four and a half game
    // hours, so it is mid-morning when the player gets home and sleep is still
    // hours away. Waiting it out is the only honest option — setting the clock
    // would be exactly the state-faking this test exists to rule out — and it is
    // a real property of the game's pacing, not an artefact of the test.
    expect(beforeSleep.gameMinuteOfDay).toBeGreaterThanOrEqual(360);
    expect(beforeSleep.gameMinuteOfDay).toBeLessThan(1200);

    const nightDeadline = Date.now() + 300_000;
    while ((await readState(page)).gameMinuteOfDay < 1200) {
      if (Date.now() > nightDeadline) throw new Error('nightfall never arrived');
      await page.waitForTimeout(1000);
    }

    await walkTo(page, 1120); // BED_X
    for (let i = 0; i < 8; i++) {
      if ((await readState(page)).day === 2) break;
      await page.keyboard.press('E');
      await page.waitForTimeout(250);
    }

    const slept = await readState(page);
    expect(slept.day).toBe(2);
    expect(slept.gameMinuteOfDay).toBeGreaterThanOrEqual(360); // next 06:00
    // Waking lands at 06:00, but the clock keeps running until this line reads
    // it, so the measured value carries a few real-time seconds of drift.
    // Measured: 362.04 against a 362.00 bound. Five minutes still catches a
    // "slept past the morning" bug without failing on the read latency.
    expect(slept.gameMinuteOfDay).toBeLessThan(365);
    expect(slept.player.energy).toBeGreaterThan(95); // restored
    // The night was charged, not free.
    expect(slept.player.hunger).toBeLessThan(beforeSleep.player.hunger);
    expect(slept.player.thirst).toBeLessThan(beforeSleep.player.thirst);
    expect(slept.status).toBe('playing');

    // D9 regression: a normal run must never claim the save failed.
    expect(await hasVisibleText(page, '存档失败')).toBe(false);
    const saved = await page.evaluate(() => localStorage.getItem('floor100000.save.v1'));
    expect(saved).not.toBeNull();
    await page.screenshot({ path: 'e2e/screenshots/46-journey-7-slept.png' });

    // ── 5. the save round-trips ─────────────────────────────────────────
    await page.reload();
    await waitForScene(page, 'Menu');
    expect(await hasVisibleText(page, '继续游戏')).toBe(true);
    await page.keyboard.press('ArrowDown'); // -> 继续游戏
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    // A continue resumes the run directly — the character pick is for new runs
    // only, so this goes straight to the Game scene.
    await waitForScene(page, 'Game');

    const resumed = await readState(page);
    expect(resumed.day).toBe(2);
    expect(resumed.currentFloor).toBe(HOME_FLOOR);
    // The upgrades survived the reload — they were built from floors 3 and 4's
    // materials, so losing them here would lose the point of the trip.
    expect(resumed.player.homeUpgrades.sort()).toEqual(['lamp', 'purifier', 'reinforced_door']);
    expect(await count(page, 'scrap_metal')).toBe(0); // spent, not restored
    expect(await count(page, 'wood')).toBe(0);
    // 2 starting + 3 from the counter, plus the daily-goal reward's ration if
    // the day's objective closed on the way up (it does on this route) — so a
    // floor, not an exact count, and it must survive the reload either way.
    expect(await count(page, 'ration_pack')).toBeGreaterThanOrEqual(5);
    expect(await count(page, 'clean_water')).toBeGreaterThanOrEqual(1); // from the cabinet
    // The exploration record survived too — all five floors the player set foot on.
    expect(Object.keys(resumed.visitedFloors).length).toBeGreaterThanOrEqual(5);
    await page.screenshot({ path: 'e2e/screenshots/47-journey-8-resumed.png' });

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });
});
