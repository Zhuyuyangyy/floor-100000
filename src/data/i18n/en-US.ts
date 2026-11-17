/**
 * AG-78 i18n 清点——English (US) 词典（字典骨架，与 zh-CN.ts 同 key）。
 *
 * 翻译标准：Steam 商店页级质量；末日生存品类惯用译法见 docs/i18n/GLOSSARY.md。
 * 本文件不被任何运行时模块 import——取值接线留给后续工单。
 *
 * 硬约束（src/tests/i18n.test.ts 逐条钉住）：
 *   1. key 与 zh-CN.ts 完全对齐（tsc 的 Record 类型同样强制）；
 *   2. 每个 key 的 {name} 占位符名称与数量和中文一致；
 *   3. 英文显示宽度（CJK=2 列 / ASCII=1 列）不超过中文的 3 倍。
 */

import type { I18nKey } from './index';

export const enUS: Record<I18nKey, string> = {
  // ── App / title ───────────────────────────────────────────────────────
  'app.name': 'Floor 100000',
  'app.subtitle': 'DOOMSDAY DORM',

  // ── Main menu ─────────────────────────────────────────────────────────
  'menu.newGame': 'New Game',
  'menu.continue': 'Continue',
  'menu.controls': 'Controls',
  'menu.controlsMove': 'A/D or ←/→ to move · E to interact',
  'menu.controlsInteract': 'E: open chests / talk / stairs / sleep',
  'menu.controlsPanels': 'I Bag · C Craft · M Map · ESC Pause',
  'menu.controlsMouse': 'Mouse: click options · click the floor to walk · click items to interact',
  'menu.goal': 'Goal: climb to Floor 100000',
  'menu.closeHint': 'Press Enter / ESC to close',

  // ── HUD status ────────────────────────────────────────────────────────
  'hud.hp': 'Health',
  'hud.hunger': 'Hunger',
  'hud.thirst': 'Thirst',
  'hud.energy': 'Energy',
  'hud.bodyTemp': 'Body Temp',
  'hud.sick': 'Sick',
  'hud.critical': 'Critical',
  'hud.frostbite': 'Frostbite',
  'hud.fever': 'Fever',
  'hud.injured': 'Injured',
  'hud.foodPoisoning': 'Food Poisoning',
  'hud.gold': '{n} Gold',
  'hud.score': 'Score {n}',
  'hud.floor': 'Floor {n}',
  'hud.day': 'Day {n}',
  'hud.survivor': 'Survivor',
  'hud.warmingUp': 'Warming Up',
  'hud.cold': 'Cold',
  'hud.warm': 'Warm',
  'hud.roommate': 'Roommate',
  'hud.bed': 'Bed (Sleep)',

  // ── Bottom nav bar ────────────────────────────────────────────────────
  'nav.bag': 'Bag I',
  'nav.craft': 'Craft C',
  'nav.industry': 'Ventures G',
  'nav.map': 'Map M',
  'nav.menu': 'Menu Esc',

  // ── Pause menu ────────────────────────────────────────────────────────
  'pause.resume': 'Resume',
  'pause.towerMap': 'Tower Map',
  'pause.restart': 'Restart',
  'pause.backToTitle': 'Back to Title',

  // ── Interaction actions ───────────────────────────────────────────────
  'action.take': 'Take',
  'action.attack': 'Attack',
  'action.retreat': 'Retreat',
  'action.trade': 'Trade (2 Dirty Water → 1 Clean Water)',
  'action.leave': 'Leave',
  'action.readNote': 'Read Note',
  'action.rest': 'Rest',
  'action.restEffect': 'Restore energy · Stress -6',
  'action.heal': 'Heal',
  'action.healKit': 'Medkit · treat wounds',
  'action.repair': 'Repair',
  'action.repairCost': 'Wood ×2 + Tape ×1',
  'action.careNeighbor': 'Check on neighbor',
  'action.careNeighborCost': 'Ration ×1 · Stress -12',
  'action.scavenge': 'Scavenge tonight',
  'action.scavengeHint': 'Loot the floors at night · NPCs may drop by your dorm',
  'action.stayHome': 'Stay home tonight',
  'action.stayHomeHint': 'Sleep in the dorm to recover · nothing of yours can be stolen tonight',

  // ── Daily goals ───────────────────────────────────────────────────────
  'goal.label': 'Objective',
  'goal.bringWater': 'Bring back {n} bottles of clean water',
  'goal.lootContainers': 'Loot {n} containers',
  'goal.buildUpgrades': 'Build {n} dorm upgrades',
  'goal.reachFloor': 'Reach floor {n}',

  // ── Encounter types ───────────────────────────────────────────────────
  'encounter.lootCache': 'A cache of supplies',
  'encounter.ambush': 'An ambush in the dark',
  'encounter.trader': 'Trader',
  'encounter.note': 'A scrap of paper',
  'encounter.stash': 'A stash spot',
  'encounter.keeper': 'The Gatekeeper',

  // ── Floor types ───────────────────────────────────────────────────────
  'floorType.dorm': 'Dorm',
  'floorType.neighborDorm': "Neighbor's Dorm",
  'floorType.storage': 'Storage Floor',
  'floorType.maintenance': 'Maintenance Floor',
  'floorType.canteen': 'Canteen',

  // ── Fixed floors 1–6 (name + description) ─────────────────────────────
  'floor.1.name': 'Your Dorm',
  'floor.1.desc': 'A safe room with a bed, storage, crafting and sleep',
  'floor.2.name': "Neighbors' Dorm",
  'floor.2.desc': '2 tradable NPCs',
  'floor.3.name': 'Abandoned Storage',
  'floor.3.desc': 'Gather wood, metal, tape and batteries',
  'floor.4.name': 'Maintenance Floor',
  'floor.4.desc': 'Pitch-dark, but fuses, filters and stored water are reliably here',
  'floor.5.name': 'Abandoned Canteen',
  'floor.5.desc': 'Food supplies; the end of the early game',
  'floor.6.name': 'Sealed Corridor',
  'floor.6.desc': 'Doors above this floor are boarded up; old newspapers stuffed in the gaps',

  // ── Tiers / sectors ───────────────────────────────────────────────────
  'tier.slum': 'The Slums',
  'tier.workerDorm': 'Worker Dorms',
  'tier.industry': 'Industry & Trade',
  'tier.middleClass': 'Middle-Class Commerce',
  'tier.richZone': 'Privileged Heights',
  'tier.rulingCore': 'The Ruling Core',

  // ── Threat grades ─────────────────────────────────────────────────────
  'threat.none': 'None',
  'threat.low': 'Low',
  'threat.mid': 'Mid',
  'threat.high': 'High',
  'threat.extreme': 'Extreme',
  'threat.deadly': 'Deadly',

  // ── Items (24, full) ──────────────────────────────────────────────────
  'item.cleanWater': 'Clean Water',
  'item.dirtyWater': 'Dirty Water',
  'item.rationPack': 'Ration Pack',
  'item.bread': 'Bread',
  'item.medkit': 'Medkit',
  'item.battery': 'Battery',
  'item.scrapMetal': 'Scrap Metal',
  'item.wood': 'Wood',
  'item.cloth': 'Cloth',
  'item.tape': 'Tape',
  'item.filter': 'Filter',
  'item.wire': 'Wire',
  'item.fuse': 'Fuse',
  'item.crowbar': 'Crowbar',
  'item.fireAxe': 'Fire Axe',
  'item.machete': 'Machete',
  'item.shortSword': 'Short Sword',
  'item.dagger': 'Dagger',
  'item.flashlight': 'Low-Battery Flashlight',
  'item.cigarette': 'Cigarette',
  'item.coffee': 'Coffee',
  'item.moonshine': 'Moonshine',
  'item.oldBook': 'Old Book',
  'item.shovel': 'Shovel',

  // ── Container labels (canonical form per type) ────────────────────────
  'container.cabinet': 'Cabinet',
  'container.shelf': 'Shelf',
  'container.crateWood': 'Wood Crate',
  'container.crateMetal': 'Metal Crate',
  'container.fuseBox': 'Fuse Box',
  'container.waterTank': 'Water Tank',
  'container.counter': 'Counter',
  'container.workbench': 'Workbench',
  'container.bed': 'Bed',
  'container.badgeRack': 'Badge Rack',
  'container.bunkBed': 'Bunk Bed',
  'container.mealCounter': 'Meal Counter',
  'container.shiftLocker': 'Shift Locker',
  'container.workerLocker': 'Metal Locker',
  'container.rationDispenser': 'Ration Box',
  'container.washSink': 'Wash Sink',
  'container.uniformRack': 'Towel Rack',
  'container.toolCage': 'Tool Rack',
  'container.thermosRack': 'Soup Pot',
  'container.keyBoard': 'Key Rack',
  'container.securitySafe': 'Safe',

  // ── NPC names + titles (7, full) ──────────────────────────────────────
  'npc.alin': 'Alin',
  'npc.alin.title': 'Repairman',
  'npc.xiaozhou': 'Xiao Zhou',
  'npc.xiaozhou.title': 'Neighbor',
  'npc.recruiter': 'Recruiter',
  'npc.recruiter.title': 'Hiring Desk',
  'npc.blackmarket': 'Black Marketeer',
  'npc.blackmarket.title': 'Street Vendor',
  'npc.labClerk': 'Lab Clerk',
  'npc.labClerk.title': 'Access Control',
  'npc.banquetStaff': 'Banquet Server',
  'npc.banquetStaff.title': 'Banquet Hall',
  'npc.coreTerminal': 'Core Terminal',
  'npc.coreTerminal.title': 'Ruling Core',

  // ── Playable characters ───────────────────────────────────────────────
  'character.survivor': 'Survivor',
  'character.alin': 'Alin',
  'character.xiaozhou': 'Xiao Zhou',
  'character.zhouhe': 'Zhou He',
  'character.wanderer': 'The Wanderer',

  // ── Monsters (15, full; English per in-code glosses) ──────────────────
  'monster.scavenger': 'Scavenger',
  'monster.corridorStray': 'Corridor Stray',
  'monster.dozingWarden': 'Dozing Warden',
  'monster.foodThief': 'Food Thief',
  'monster.mutatedTenant': 'Mutated Tenant',
  'monster.corridorStalker': 'Corridor Stalker',
  'monster.slingshotBrat': 'Slingshot Brat',
  'monster.blackoutGuard': 'Blackout Guard',
  'monster.nestMatriarch': 'Nest Matriarch',
  'monster.ventSpider': 'Vent Spider',
  'monster.bookBurner': 'Book Burner',
  'monster.burdenedCarcass': 'Burdened Carcass',
  'monster.loftHeir': 'Loft Heir',
  'monster.lightShunner': 'Light-Shunner',
  'monster.gatekeeper': 'Gatekeeper',

  // ── Recipes (13, full; desc for the 9 dorm upgrades) ──────────────────
  'recipe.lamp': 'Lamp',
  'recipe.lamp.desc': 'Lights the dorm at night without a flashlight',
  'recipe.reinforcedDoor': 'Reinforced Door',
  'recipe.reinforcedDoor.desc': 'Seals the drafts; the dorm stays lit at night',
  'recipe.waterPurifier': 'Simple Purifier',
  'recipe.waterPurifier.desc': 'Purify a whole bag of dirty water at once',
  'recipe.shelf': 'Storage Shelf',
  'recipe.shelf.desc': 'Plank-and-cloth shelf; +2 bag slots',
  'recipe.workerBadge': 'Worker Badge',
  'recipe.workerBadge.desc': 'Forged worker-dorm ID; passes the first gate',
  'recipe.passSticker': 'Access Sticker',
  'recipe.passSticker.desc': 'Sticker on the card reader; shorts the access line',
  'recipe.permit': 'Permit',
  'recipe.permit.desc': 'Middle-class permit, bought with batteries and filters',
  'recipe.vipCard': 'VIP Card',
  'recipe.vipCard.desc': 'The rich zone only respects appearances — and a gift',
  'recipe.coreAccess': 'Core Access',
  'recipe.coreAccess.desc': 'Temporary tower-system access — costs the last fuse in the substation',
  'recipe.dagger': 'Dagger',
  'recipe.shortSword': 'Short Sword',
  'recipe.machete': 'Machete',
  'recipe.fireAxe': 'Fire Axe',
  'recipe.shovel': 'Shovel',

  // ── Relics (5, full) ──────────────────────────────────────────────────
  'relic.waterHeart': 'Heart of Water',
  'relic.waterHeart.desc': 'Every drink restores 50% more hydration.',
  'relic.ironStomach': 'Iron Stomach',
  'relic.ironStomach.desc': 'Hunger decays 30% slower.',
  'relic.swiftStep': 'Swift Step',
  'relic.swiftStep.desc': '+15% move speed; corridors feel shorter.',
  'relic.luckyCharm': 'Lucky Charm',
  'relic.luckyCharm.desc': 'One extra drop from encounters.',
  'relic.guardianTotem': 'Guardian Totem',
  'relic.guardianTotem.desc': 'Gatekeeper damage -30%.',

  // ── Game modes (3, full) ──────────────────────────────────────────────
  'mode.quick': 'Quick Run',
  'mode.quick.desc': 'Hunger & thirst ×1.5, score ×1.5 — a tighter budget for a higher score.',
  'mode.adventure': 'Adventure',
  'mode.adventure.desc': 'Standard rules. Autosave; death restarts the run.',
  'mode.easy': 'Easy',
  'mode.easy.desc': 'Hunger & thirst ×0.7, Gatekeeper damage ×0.7 — learn the tower first.',

  // ── Ventures (3, full) ────────────────────────────────────────────────
  'venture.waterStand': 'Dorm Water Stand',
  'venture.waterStand.desc':
    'Run a water stall in the dorms: trade dirty water for clean and take a cut. Steady customers, thin margins.',
  'venture.scrapRoute': 'Scrap Route',
  'venture.scrapRoute.desc':
    "Haul scrap from the maintenance floors on schedule and resell it upstairs at a markup — the tower's supply shrinks every day.",
  'venture.rationLine': 'Ration Black Line',
  'venture.rationLine.desc':
    'Divert rations straight from the canteen — the fattest margins, but one bust loses the whole line.',

  // ── Quest status labels ───────────────────────────────────────────────
  'questStatus.locked': 'Locked',
  'questStatus.available': 'Available',
  'questStatus.active': 'In Progress',
  'questStatus.done': 'Completed',

  // ── Diary kinds (10, full) ────────────────────────────────────────────
  'diaryKind.hunger': 'Hunger',
  'diaryKind.groupHunger': 'Group Hunger',
  'diaryKind.mood': 'Mood',
  'diaryKind.injured': 'Injured',
  'diaryKind.sick': 'Sick',
  'diaryKind.sickRecovered': 'Sick · Recovered',
  'diaryKind.lateReturn': 'Late Return',
  'diaryKind.dormRaid': 'Dorm Raid',
  'diaryKind.visitor': 'Visitor',
  'diaryKind.commissionDone': 'Commission Complete',

  // ── Morale ────────────────────────────────────────────────────────────
  'morale.high': 'Morale High',
  'morale.low': 'Morale Low',
  'morale.steady': 'Morale Steady',

  // ── Environment flags ─────────────────────────────────────────────────
  'env.humid': 'Humid',
  'env.heatSource': 'Heat Source',
  'env.nightDanger': 'Night Danger',

  // ── End-of-run screen ─────────────────────────────────────────────────
  'end.survived': 'You Survived',
  'end.died': 'You Did Not Survive',
  'end.run': 'This Run',
  'end.causeOfDeath': 'Killed By',
  'end.days': 'Survived',
  'end.daysValue': '{n} days',
  'end.deepest': 'Deepest',
  'end.deepestFloor': 'Floor {n}',
  'end.score': 'Score',
  'end.newRecord': 'New Record',
  'end.victoryCondition': 'Official victory condition: reach Floor 100000',
  'end.restart': 'Click / Enter to restart',

  // ── Endgame (four endings: titles + hints + key lines) ────────────────
  'endgame.shutItDown': 'Shut It Down',
  'endgame.shutItDownHint': 'C / D · Flip the table; black out the tower',
  'endgame.handItBack': 'Hand It Back',
  'endgame.handItBackHint': 'C · The material basis of a ground-floor uprising',
  'endgame.sitDown': 'Sit Down',
  'endgame.sitDownHint': 'A / D · You were always part of the system',
  'endgame.walkAway': 'Walk Back Down',
  'endgame.walkAwayHint': 'B · An independent does not take this chair',
  'endgame.confirm': 'Confirm',
  'endgame.confirmWarn': 'No way back. Confirm, and the tower will never be the same.',
  'endgame.enterContinue': 'Enter to continue',
  'endgame.escLeave': 'Esc to leave',

  // ── Panel titles & empty states ───────────────────────────────────────
  'panel.bag': 'Bag',
  'panel.craft': 'Craft',
  'panel.map': 'Map',
  'panel.quests': 'Quests',
  'panel.industry': 'Ventures',
  'panel.towerOverview': 'Tower Overview',
  'panel.floorDetails': 'Floor Details',
  'panel.bagFullHint':
    'Bag full · use, craft or trade to free a slot, or loot stays where it lies; stackable items still fit',
  'panel.bagEmptyGift': 'Your bag is empty — nothing to give.',

  // ── Tower overview ────────────────────────────────────────────────────
  'tower.back': '← Back',
  'tower.startFloor': 'Start: Floor {n}',
  'tower.endFloor': 'Final: Floor {n}',
  'tower.base': 'Basement B1–B5 · starter zone',
  'tower.currentFloor': 'Floor {n}',
  'tower.sector': 'Sector {n}',
  'tower.explored': 'Explored',
  'tower.unexplored': 'Unexplored',
  'tower.cleared': 'Cleared',
  'tower.notCleared': 'Not Cleared',
  'tower.current': 'Current',
  'tower.keeper': 'Sector Warden',
  'tower.nightRaid': 'Night Raid',
  'tower.lift': 'Freight Lift',
  'tower.hintNav': '↑↓ select · Enter enter · wheel zoom · drag · F whole tower · ESC back',
  'tower.hintNavAlt': 'Arrows select · Enter view · wheel zoom · drag · ESC back',

  // ── Character select ──────────────────────────────────────────────────
  'metaSelect.beforeDeparture': 'Before You Go',
  'metaSelect.deployable': 'Ready',
  'metaSelect.notMet': 'Not Met Yet',
  'metaSelect.depart': 'Depart',
  'metaSelect.backToTitle': 'Back to Title',
  'metaSelect.unlockAt': 'Unlocks at floor {n}',
  'metaSelect.mode': 'Mode',
  'metaSelect.hintNav': '↑/↓ select · ←/→ mode · Enter depart · ESC back to title',

  // ── E-key hints ───────────────────────────────────────────────────────
  'hint.pressE': 'Press E',
  'hint.craft': 'Press E to craft',
  'hint.talk': 'Press E to talk',
  'hint.open': 'Press E to open {name}',
  'hint.goUp': 'Press E to go up',
  'hint.goDown': 'Press E to go down',
  'hint.lift': 'Press E to ride the freight lift',
  'hint.shortcut': 'Press E to go up · F shortcut ({n} gold)',
  'hint.markedSpot': 'Press E to check the marked spot',
  'hint.wetFloor': 'Water leaks here; ground items are damp',
  'hint.gameGoal':
    'Goal: climb from Floor 1 all the way to Floor 100000. A/D move · E interact · I bag · C craft · M map',

  // ── Combat ────────────────────────────────────────────────────────────
  'combat.enemy': 'Enemy',
  'combat.attack': 'Attack',
  'combat.attackKey': 'Press Enter',
  'combat.attackDesc': 'Deal weapon damage',
  'combat.block': 'Block',
  'combat.blockDesc': 'Halve incoming damage',
  'combat.blockEnergy': 'Regain 3 energy',
  'combat.retreat': 'Retreat',
  'combat.retreatKey': 'Press ESC',
  'combat.retreatDesc': 'Escaping may fail',
  'combat.hintNav': '↑/↓ select · Enter act · ESC retreat',
  'combat.strike': '{name} lunges first for {n} damage!',
  'combat.hit': 'You hit {name} for {n} damage',
  'combat.escaped': 'You got away',
  'combat.escapeFailed': 'Escape failed! {name} pounces',
  'combat.enemyFled': 'The enemy fled',
  'combat.enemyFledHurt': '{name} limps away, badly wounded.',
  'combat.victory': 'Victory',
  'combat.keeperDown': 'The Gatekeeper falls',
  'combat.lootLine': 'Loot: {loot}',
  'combat.continue': 'Enter / ESC to continue',
  'combat.stairsOpen': 'The way up is open. Score +200',

  // ── Trader panel ──────────────────────────────────────────────────────
  'shop.buy': 'Enter to buy',
  'shop.goldShort': 'Not enough gold',
  'shop.priceBoard': 'Material shelves · day {n} prices',
  'shop.bidLine': 'Buy {buy} · Sell {sell} · Held {held}',
  'shop.noStock': 'The merchant does not stock this',
  'shop.needGold': 'Not enough gold (need {n})',
  'shop.bagFull': 'Bag is full',
  'shop.buyOne': 'Buy 1 (-{n} gold)',
  'shop.sellOne': 'Sell 1 (+{n} gold)',
  'shop.hintNav': 'Enter buy · S sell selected · ESC leave',

  // ── Ventures panel ────────────────────────────────────────────────────
  'industry.title': 'Ventures',
  'industry.settlement': 'Venture payout: day {n}, +{gold} gold',
  'industry.collapsed': '{name} collapsed — all invested gold lost',
  'industry.costLine': 'Cost {n} gold · {rate}%/day · {loss}% loss · {collapse}% collapse',
  'industry.enterInvest': 'Enter to invest {n} gold',
  'industry.hintNav': '↑/↓ select · Enter invest · G leave',

  // ── Crafting ──────────────────────────────────────────────────────────
  'craft.tierLocked': 'Tier {tier} · requires Authority {access}',
  'craft.alreadyBuilt': '{name} is already built',
  'craft.requiresFirst': 'Requires {name} first',
  'craft.built': 'Built {name} (-{n} min)',
  'craft.crafted': 'Crafted {name} (-{n} min)',

  // ── Loot inspection ──────────────────────────────────────────────────
  'loot.empty': 'Contents: empty',
  'loot.notGenerated': 'Contents: not generated (B4 procedural floor)',
  'loot.bedRemoved': 'This bed has been dismantled',

  // ── Shelter / survival messages ───────────────────────────────────────
  'message.gameOver': 'Game over',
  'message.returnToDorm': 'Return to the Floor 1 dorm first',
  'message.shelterAlready': 'Shelter action already set for tonight',
  'message.doorClosed': 'You bar the door and let your body recover.',
  'message.noWounds': 'No wounds to treat right now',
  'message.tooEarlyToSleep': 'Too early to sleep (after 20:00)',
  'message.severeDehydration': 'Severely dehydrated',
  'message.hypothermia': 'Hypothermia',
  'message.unknownArea': 'Unknown area',
  'message.noFloorSelected': 'No floor selected',
  'message.floorLocked': 'Floor not cleared yet; reach it through the tower first',
  'message.itemNotUsable': '{name} cannot be used right now',
  'message.bagFull': 'Bag full',
  'message.bagFullLoot': 'Bag full: no room for what you found — free some space first',

  // ── World events ──────────────────────────────────────────────────────
  'event.blackout': 'The corridor has lost power — stay on your flashlight or head back to the dorm.',
  'event.wanderer': 'A wanderer stalks floor {n} — hide in the dorm or change floors.',
  'event.leak': 'Floor {n} is leaking; some supplies are damp.',

  // ── Night theft (leading ' · ' joiner stripped from the source) ───────
  'night.theft': 'Someone came in the night... {container} was rifled — {details} missing',
  'night.theftEmpty': 'Someone came in the night... whatever was here is long gone',

  // ── Dwell pressure (sampled) ──────────────────────────────────────────
  'dwell.creak': 'A floorboard creaks somewhere, then goes quiet.',
  'dwell.footsteps': 'Footsteps in the distance — listen closer and there is nothing.',

  // ── NPC economy fallback lines (player-visible) ───────────────────────
  'economy.friendly': "For old times' sake, sure.",
  'economy.tradeOnly': 'Goods for goods. That is all.',
  'economy.surcharge': 'Seeing you these days makes me want to raise prices.',
  'economy.noTalk': 'Nothing to talk about.',
  'economy.refuseTrade': '{name} refuses to trade: {line}',
  'economy.outOfStock': "{name} doesn't have it right now (out of stock or delisted)",
  'economy.got': 'Traded for {name} ×{n}',
  'economy.giftInvalid': 'Invalid gift quantity',
  'economy.giftNoItems': "You don't have enough {name}; no gift",
  'economy.giftGiven': 'Received {name} ×{n}',
  'economy.giftNone': 'They have nothing to give back',
  'economy.giftBagFull': 'Not enough bag space for {name}',

  // ── NPC schedule slots ────────────────────────────────────────────────
  'schedule.idle': 'Idle',
  'schedule.safeDay': 'A quiet day',

  // ── Wall decorations (8 names + 1 desc sample) ────────────────────────
  'wallDeco.dutyRules': 'Duty Rules (torn)',
  'wallDeco.clock': 'Wall Clock',
  'wallDeco.clock.desc':
    'Stopped at 06:00.\nNo clock in this building still runs, yet every one of them stops at an hour that gets you to the morning shift.',
  'wallDeco.chandelier': 'Chandelier',
  'wallDeco.pressureGauge': 'Pressure Gauge',
  'wallDeco.workwearRack': 'Workwear Rack',
  'wallDeco.pipeValve': 'Pipe Valve',
  'wallDeco.metalPlate': 'Metal Plate',
  'wallDeco.chalkCount': 'Chalk Tally',

  // ── Narrative samples (quests / dialogue / monologue / notes) ─────────
  'quest.blackoutSchedule': 'Wednesdays & Fridays',
  'quest.waterTap': 'The Water Tap',
  'quest.badgeAndFace': 'Badge & Face',
  'dialogue.alin.greeting': "You're here? Don't just stand in the doorway — hold this ladder for me.",
  'dialogue.xiaozhou.greeting': 'Perfect timing — I have just counted the bread a second time.',
  'monologue.hungry': 'My stomach is eating itself...',
  'monologue.thirsty': 'My lips are cracking...',
  'monologue.tired': 'My eyelids are too heavy to lift...',
  'monologue.nightfall': 'After dark, this place gets even creepier...',
  'note.boilWater': '"Boil the water. Don\'t trust the tap downstairs."',
  'note.seventhBatch': '"Half of the seventh batch are gone. Names crossed off the canteen wall."',
  'note.badgeReturn': '"Badges get handed back. Don\'t ask why. — The last one is still hanging on the wall"',
  'encounter.text.glint': 'Something glints behind the shelf',
  'encounter.text.breath': 'Someone is breathing in the dark',
  'encounter.text.creak': 'The floorboards creak — something is closing in',
};
