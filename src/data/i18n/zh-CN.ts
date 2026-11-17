/**
 * AG-78 i18n 清点——简体中文词典（源语言，字典骨架）。
 *
 * 定位：英文版前置的清点产物，**零代码接线**——本文件不被任何运行时模块 import，
 * 取值方式（displayName → t(key)）留给后续接线工单。
 *
 * key 规范：`<域>.<对象>[.<属性>]`，全小写驼峰单词。域 =  UI 面/数据表/系统。
 *   - 域：app / menu / hud / nav / pause / action / goal / hint / panel /
 *         combat / shop / industry / tower / metaSelect / end / endgame /
 *         quest / questStatus / dialogue / monologue / note / message /
 *         event / night / dwell / economy / schedule / craft / loot /
 *         shelter / survival / item / container / recipe / relic / mode /
 *         venture / floor / floorType / tier / threat / npc / character /
 *         monster / diaryKind / morale / env / wallDeco
 * 值规范：
 *   - 值 = 现有中文原文（src/ 扫描结果，见 docs/i18n/AUDIT.md）；
 *   - 原文里焊死的拼接分隔符（如 NightSystem 行首 ' · '）已剥离，接线时还原；
 *   - 动态值统一为 {name} 占位符（{n}/{name}/{gold}/{rate}…），替换实现在接线工单落地。
 *
 * 属主：AG-78。新增 key 必须同步 en-US.ts（tsc 的 Record 类型会强制对齐）。
 */

export const zhCN = {
  // ── 应用/标题 ──────────────────────────────────────────────────────────
  'app.name': '第100000层',
  'app.subtitle': '末 日 宿 舍',

  // ── 主菜单（scenes/MenuScene.ts）──────────────────────────────────────
  'menu.newGame': '开始新游戏',
  'menu.continue': '继续游戏',
  'menu.controls': '操作说明',
  'menu.controlsMove': 'A/D 或 ←/→ 移动 · E 交互',
  'menu.controlsInteract': 'E 交互：开箱 / 对话 / 楼梯 / 睡觉',
  'menu.controlsPanels': 'I 背包 · C 制作 · M 地图 · ESC 暂停',
  'menu.controlsMouse': '鼠标：点选项 · 点地面走动 · 点物品交互',
  'menu.goal': '目标：爬到第 100000 层',
  'menu.closeHint': '按 Enter / ESC 关闭',

  // ── HUD 状态（scenes/GameScene.ts）─────────────────────────────────────
  'hud.hp': '生命',
  'hud.hunger': '饥饿',
  'hud.thirst': '口渴',
  'hud.energy': '精力',
  'hud.bodyTemp': '体温值',
  'hud.sick': '患病',
  'hud.critical': '病危',
  'hud.frostbite': '冻伤',
  'hud.fever': '发烧',
  'hud.injured': '受伤',
  'hud.foodPoisoning': '食物中毒',
  'hud.gold': '{n} 金',
  'hud.score': '分数 {n}',
  'hud.floor': '第{n}层',
  'hud.day': '第{n}天',
  'hud.survivor': '幸存者',
  'hud.warmingUp': '回暖中',
  'hud.cold': '寒冷',
  'hud.warm': '暖和',
  'hud.roommate': '室友',
  'hud.bed': '床（睡觉）',

  // ── 底部导航（GameScene 六槽铆钉板）────────────────────────────────────
  'nav.bag': '背包 I',
  'nav.craft': '制作 C',
  'nav.industry': '产业 G',
  'nav.map': '地图 M',
  'nav.menu': '菜单 Esc',

  // ── 暂停菜单 ──────────────────────────────────────────────────────────
  'pause.resume': '继续游戏',
  'pause.towerMap': '塔楼地图',
  'pause.restart': '重新开始',
  'pause.backToTitle': '返回标题',

  // ── 交互动作选项（GameScene）───────────────────────────────────────────
  'action.take': '拿走',
  'action.attack': '动手',
  'action.retreat': '撤退',
  'action.trade': '交易（脏水×2 → 净水×1）',
  'action.leave': '离开',
  'action.readNote': '读纸条',
  'action.rest': '休息',
  'action.restEffect': '恢复精力 · 压力 -6',
  'action.heal': '治疗',
  'action.healKit': '医疗包 · 处理伤势',
  'action.repair': '修理',
  'action.repairCost': '木材×2 + 胶带×1',
  'action.careNeighbor': '照顾邻居',
  'action.careNeighborCost': '口粮×1 · 压力 -12',
  'action.scavenge': '出去找物资',
  'action.scavengeHint': '夜里搜刮各层 · 宿舍可能遭 NPC 光顾',
  'action.stayHome': '在家守夜',
  'action.stayHomeHint': '回宿舍睡觉回血 · 今夜没人偷得走你的东西',

  // ── 每日目标 ──────────────────────────────────────────────────────────
  'goal.label': '目标',
  'goal.bringWater': '带回 {n} 瓶净水',
  'goal.lootContainers': '搜刮 {n} 个容器',
  'goal.buildUpgrades': '建成 {n} 项宿舍升级',
  'goal.reachFloor': '到达第 {n} 层',

  // ── 遭遇类型 ──────────────────────────────────────────────────────────
  'encounter.lootCache': '一处遗落物资',
  'encounter.ambush': '黑暗中的伏击',
  'encounter.trader': '行商',
  'encounter.note': '一张纸条',
  'encounter.stash': '藏匿点',
  'encounter.keeper': '守门人',

  // ── 楼层类型（core/constants.ts FLOOR_ENVIRONMENT）─────────────────────
  'floorType.dorm': '宿舍',
  'floorType.neighborDorm': '邻居宿舍',
  'floorType.storage': '储物层',
  'floorType.maintenance': '维修层',
  'floorType.canteen': '食堂',

  // ── 固定楼层 1–6 名+描述（data/floorTemplates.ts，7–55 层未收）─────────
  'floor.1.name': '玩家宿舍',
  'floor.1.desc': '初始床铺、储物、制作、睡眠的安全屋',
  'floor.2.name': '邻居宿舍',
  'floor.2.desc': '2 名可交易 NPC',
  'floor.3.name': '废弃储物层',
  'floor.3.desc': '搜集木材、金属、胶带、电池',
  'floor.4.name': '维修层',
  'floor.4.desc': '漆黑区域，稳定可找到的保险丝、滤芯与储水',
  'floor.5.name': '废弃食堂',
  'floor.5.desc': '食物补给，首版探索终点',
  'floor.6.name': '封门走廊',
  'floor.6.desc': '六层往上的门被木板封死，门缝里塞着旧报纸',

  // ── 区段/阶层（core/constants.ts SEGMENT_ENVIRONMENT）──────────────────
  'tier.slum': '底层贫民区',
  'tier.workerDorm': '工人宿舍区',
  'tier.industry': '工业与交易区',
  'tier.middleClass': '中产与商业区',
  'tier.richZone': '富人特权区',
  'tier.rulingCore': '统治核心',

  // ── 威胁等级（core/worldgen.ts THREAT_LABELS）──────────────────────────
  'threat.none': '无威胁',
  'threat.low': '低',
  'threat.mid': '中',
  'threat.high': '高',
  'threat.extreme': '极高',
  'threat.deadly': '致命',

  // ── 物品（data/items.ts，24 件全量）────────────────────────────────────
  'item.cleanWater': '净水',
  'item.dirtyWater': '脏水',
  'item.rationPack': '压缩口粮',
  'item.bread': '面包',
  'item.medkit': '医疗包',
  'item.battery': '电池',
  'item.scrapMetal': '废金属',
  'item.wood': '木材',
  'item.cloth': '布料',
  'item.tape': '胶带',
  'item.filter': '滤芯',
  'item.wire': '电线',
  'item.fuse': '保险丝',
  'item.crowbar': '撬棍',
  'item.fireAxe': '消防斧',
  'item.machete': '砍刀',
  'item.shortSword': '短剑',
  'item.dagger': '匕首',
  'item.flashlight': '低电量手电',
  'item.cigarette': '香烟',
  'item.coffee': '咖啡',
  'item.moonshine': '私酒',
  'item.oldBook': '旧书',
  'item.shovel': '铲子',

  // ── 容器标签（core/worldgen.ts CONTAINER_LABELS，21 类代表形）───────────
  'container.cabinet': '柜子',
  'container.shelf': '货架',
  'container.crateWood': '木箱',
  'container.crateMetal': '铁箱',
  'container.fuseBox': '电箱',
  'container.waterTank': '水罐',
  'container.counter': '柜台',
  'container.workbench': '工作台',
  'container.bed': '床铺',
  'container.badgeRack': '牌架',
  'container.bunkBed': '双层床',
  'container.mealCounter': '餐台',
  'container.shiftLocker': '班次柜',
  'container.workerLocker': '铁皮柜',
  'container.rationDispenser': '配给箱',
  'container.washSink': '洗漱台',
  'container.uniformRack': '毛巾架',
  'container.toolCage': '工具架',
  'container.thermosRack': '汤桶',
  'container.keyBoard': '钥匙架',
  'container.securitySafe': '保险柜',

  // ── NPC 名+职衔（data/npcs.ts，7 名全量）───────────────────────────────
  'npc.alin': '阿林',
  'npc.alin.title': '维修工',
  'npc.xiaozhou': '小周',
  'npc.xiaozhou.title': '邻居',
  'npc.recruiter': '招工员',
  'npc.recruiter.title': '招工处',
  'npc.blackmarket': '黑市贩子',
  'npc.blackmarket.title': '流动摊主',
  'npc.labClerk': '实验室文员',
  'npc.labClerk.title': '门禁室',
  'npc.banquetStaff': '宴席侍者',
  'npc.banquetStaff.title': '宴会厅',
  'npc.coreTerminal': '核心终端',
  'npc.coreTerminal.title': '统治核心',

  // ── 可选角色（systems/metaProgress.ts CHARACTER_NAMES）─────────────────
  'character.survivor': '幸存者',
  'character.alin': '阿林',
  'character.xiaozhou': '小周',
  'character.zhouhe': '周禾',
  'character.wanderer': '流浪者',

  // ── 怪物（systems/monsters.ts，15 种全量；英文名取代码注释既有译法）─────
  'monster.scavenger': '拾荒者',
  'monster.corridorStray': '楼道野猫',
  'monster.dozingWarden': '瞌睡宿管',
  'monster.foodThief': '偷食贼',
  'monster.mutatedTenant': '变异住客',
  'monster.corridorStalker': '楼道潜行者',
  'monster.slingshotBrat': '弹弓顽童',
  'monster.blackoutGuard': '断电守卫',
  'monster.nestMatriarch': '巢穴母体',
  'monster.ventSpider': '通风管蛛',
  'monster.bookBurner': '焚书者',
  'monster.burdenedCarcass': '负重尸',
  'monster.loftHeir': '顶楼疯裔',
  'monster.lightShunner': '畏光者',
  'monster.gatekeeper': '守门人',

  // ── 配方（data/recipes.ts，13 个全量；desc 仅 9 个宿舍升级有）───────────
  'recipe.lamp': '照明灯',
  'recipe.lamp.desc': '宿舍夜间照亮，免用手电维持基础光',
  'recipe.reinforcedDoor': '加固门',
  'recipe.reinforcedDoor.desc': '封住宿舍漏风口，夜间不再全黑',
  'recipe.waterPurifier': '简易净水器',
  'recipe.waterPurifier.desc': '把脏水一次全炼成净水',
  'recipe.shelf': '置物架',
  'recipe.shelf.desc': '木板绷布搭的置物架，背包多带 2 格',
  'recipe.workerBadge': '工牌',
  'recipe.workerBadge.desc': '仿一块工人宿舍区的胸卡，能过第一道岗',
  'recipe.passSticker': '通行贴',
  'recipe.passSticker.desc': '贴在门禁读头上的通行贴，靠短接门禁线路生效',
  'recipe.permit': '许可证',
  'recipe.permit.desc': '中产区的通行许可，靠电池和滤芯打点换来',
  'recipe.vipCard': '贵宾卡',
  'recipe.vipCard.desc': '富人区只认体面。一身像样的衣服和一份礼物',
  'recipe.coreAccess': '核心权限',
  'recipe.coreAccess.desc': '接进塔务系统的临时权限，代价是配电房最后一只保险丝',
  'recipe.dagger': '匕首',
  'recipe.shortSword': '短剑',
  'recipe.machete': '砍刀',
  'recipe.fireAxe': '消防斧',
  'recipe.shovel': '铲子',

  // ── 遗物（systems/relics.ts，5 个全量）─────────────────────────────────
  'relic.waterHeart': '水之心',
  'relic.waterHeart.desc': '喝下的每一口水多补 50% 水分。',
  'relic.ironStomach': '铁胃',
  'relic.ironStomach.desc': '饥饿衰减降低 30%。',
  'relic.swiftStep': '疾行',
  'relic.swiftStep.desc': '移动速度 +15%，走廊变得更短。',
  'relic.luckyCharm': '幸运符',
  'relic.luckyCharm.desc': '遭遇战利品多一件。',
  'relic.guardianTotem': '守护图腾',
  'relic.guardianTotem.desc': '守门人造成的伤害降低 30%。',

  // ── 游戏模式（systems/modes.ts，3 个全量）──────────────────────────────
  'mode.quick': '快速跑',
  'mode.quick.desc': '饥渴衰减 ×1.5，得分 ×1.5——用更紧的预算换更高的分。',
  'mode.adventure': '冒险',
  'mode.adventure.desc': '标准规则。自动存档，死了就重来。',
  'mode.easy': '简单',
  'mode.easy.desc': '饥渴衰减 ×0.7，守门人伤害 ×0.7——先看清这座楼。',

  // ── 产业（systems/shop.ts，3 门全量）───────────────────────────────────
  'venture.waterStand': '宿舍水站',
  'venture.waterStand.desc': '在宿舍区支个水摊，路人拿脏水来换净水，你抽成。客源稳定，本小利薄。',
  'venture.scrapRoute': '废铁商路',
  'venture.scrapRoute.desc': '按期去维修层收废铁，转手给上头吃差价。塔里的废铁捡一天少一天。',
  'venture.rationLine': '口粮暗线',
  'venture.rationLine.desc': '从食堂倒出口粮的暗线，利润最厚；被查扣一次，整条线全没。',

  // ── 任务状态（scenes/QuestPanelScene.ts STATUS_LABEL）──────────────────
  'questStatus.locked': '未解锁',
  'questStatus.available': '可接取',
  'questStatus.active': '进行中',
  'questStatus.done': '已完成',

  // ── 日记种类（systems/DiarySystem.ts，10 种全量）───────────────────────
  'diaryKind.hunger': '饥饿',
  'diaryKind.groupHunger': '群体饥饿',
  'diaryKind.mood': '心情',
  'diaryKind.injured': '受伤',
  'diaryKind.sick': '生病',
  'diaryKind.sickRecovered': '生病·无恙',
  'diaryKind.lateReturn': '迟归',
  'diaryKind.dormRaid': '宿舍袭击',
  'diaryKind.visitor': '访客',
  'diaryKind.commissionDone': '委托完成',

  // ── 士气（systems/MoraleSystem.ts）─────────────────────────────────────
  'morale.high': '士气高涨',
  'morale.low': '情绪低落',
  'morale.steady': '情绪平稳',

  // ── 环境标记（systems/EnvironmentSystem.ts）────────────────────────────
  'env.humid': '潮湿',
  'env.heatSource': '有热源',
  'env.nightDanger': '夜间危险',

  // ── 结算屏（scenes/EndScene.ts）────────────────────────────────────────
  'end.survived': '你活了下来',
  'end.died': '你没能活下来',
  'end.run': '这一趟',
  'end.causeOfDeath': '死因',
  'end.days': '存活',
  'end.daysValue': '{n} 天',
  'end.deepest': '最深',
  'end.deepestFloor': '第 {n} 层',
  'end.score': '得分',
  'end.newRecord': '新纪录',
  'end.victoryCondition': '正式胜利条件为抵达第 100000 层',
  'end.restart': '点击 / 回车 重新开始',

  // ── 终局（scenes/EndgameScene.ts，四结局选项+关键行）───────────────────
  'endgame.shutItDown': '关上它',
  'endgame.shutItDownHint': 'C / D · 掀桌子，塔黑掉',
  'endgame.handItBack': '交回底层',
  'endgame.handItBackHint': 'C · 底层起义的物质基础',
  'endgame.sitDown': '坐上它',
  'endgame.sitDownHint': 'A / D · 你本就是系统的一部分',
  'endgame.walkAway': '转身下楼',
  'endgame.walkAwayHint': 'B · 独立者不坐这把椅子',
  'endgame.confirm': '确认',
  'endgame.confirmWarn': '终局不可回头。确认之后，塔就不是这座塔了。',
  'endgame.enterContinue': 'Enter 继续',
  'endgame.escLeave': 'Esc 离开',

  // ── 面板标题与空态 ────────────────────────────────────────────────────
  'panel.bag': '背包',
  'panel.craft': '制作',
  'panel.map': '地图',
  'panel.quests': '任务',
  'panel.industry': '产业',
  'panel.towerOverview': '塔楼总览',
  'panel.floorDetails': '楼层详情',
  'panel.bagFullHint': '背包已满 · 使用、制作或交易腾出格子，否则搜刮会留在原处；能叠进已有堆的物品仍可拾取',
  'panel.bagEmptyGift': '背包是空的，没什么可送。',

  // ── 塔楼总览（scenes/TowerOverviewScene.ts）────────────────────────────
  'tower.back': '← 返回',
  'tower.startFloor': '起点 第{n}层',
  'tower.endFloor': '终点 第{n}层',
  'tower.base': '地下基座 B1–B5 · 基础发育区',
  'tower.currentFloor': '第 {n} 层',
  'tower.sector': '区段 {n}',
  'tower.explored': '已探索',
  'tower.unexplored': '未探索',
  'tower.cleared': '已打通',
  'tower.notCleared': '未打通',
  'tower.current': '当前',
  'tower.keeper': '守段者',
  'tower.nightRaid': '夜袭',
  'tower.lift': '货梯',
  'tower.hintNav': '↑↓ 选择 · Enter 进入 · 滚轮缩放 · 拖动 · F 全塔 · ESC 返回',
  'tower.hintNavAlt': '方向键选择 · Enter 查看 · 滚轮缩放 · 拖动 · ESC 返回',

  // ── 角色选择（scenes/MetaSelectScene.ts）───────────────────────────────
  'metaSelect.beforeDeparture': '出发之前',
  'metaSelect.deployable': '可出战',
  'metaSelect.notMet': '尚未相遇',
  'metaSelect.depart': '出发',
  'metaSelect.backToTitle': '返回标题',
  'metaSelect.unlockAt': '最深第 {n} 层解锁',
  'metaSelect.mode': '模式',
  'metaSelect.hintNav': '↑/↓ 选择 · ←/→ 模式 · Enter 出发 · ESC 返回标题',

  // ── E 键提示（GameScene hintText）──────────────────────────────────────
  'hint.pressE': '按 E',
  'hint.craft': '按 E 制作',
  'hint.talk': '按 E 对话',
  'hint.open': '按 E 打开 {name}',
  'hint.goUp': '按 E 上楼',
  'hint.goDown': '按 E 下楼',
  'hint.lift': '按 E 乘货运电梯',
  'hint.shortcut': '按 E 上楼 · F 抄近路（{n} 金）',
  'hint.markedSpot': '按 E 查看问号点',
  'hint.wetFloor': '此地漏水，地面物资受潮',
  'hint.gameGoal': '目标：从第 1 层一路爬到第 100000 层。A/D 移动 · E 交互 · I 背包 · C 制作 · M 地图',

  // ── 战斗（GameScene + systems/combat.ts）───────────────────────────────
  'combat.enemy': '敌人',
  'combat.attack': '攻击',
  'combat.attackKey': '按 Enter',
  'combat.attackDesc': '造成武器伤害',
  'combat.block': '格挡',
  'combat.blockDesc': '受伤减半',
  'combat.blockEnergy': '回 3 精力',
  'combat.retreat': '撤退',
  'combat.retreatKey': '按 ESC',
  'combat.retreatDesc': '逃跑可能失败',
  'combat.hintNav': '↑/↓ 选择 · Enter 出招 · ESC 撤退',
  'combat.strike': '{name} 抢先扑出，造成 {n} 点伤害！',
  'combat.hit': '你击中{name}，造成 {n} 点伤害',
  'combat.escaped': '你成功逃走了',
  'combat.escapeFailed': '逃跑失败！{name} 趁机扑上',
  'combat.enemyFled': '敌人逃走了',
  'combat.enemyFledHurt': '{name} 伤痕累累地逃走了。',
  'combat.victory': '战斗胜利',
  'combat.keeperDown': '守门人倒下了',
  'combat.lootLine': '获得：{loot}',
  'combat.continue': 'Enter / ESC 继续',
  'combat.stairsOpen': '上楼的路通了。分数 +200',

  // ── 行商面板（GameScene shop UI）───────────────────────────────────────
  'shop.buy': 'Enter 买入',
  'shop.goldShort': '金币不足',
  'shop.priceBoard': '材料货架 · 第 {n} 天牌价',
  'shop.bidLine': '买 {buy} · 卖 {sell} · 持 {held}',
  'shop.noStock': '商人没有这件货',
  'shop.needGold': '金币不够（需要 {n}）',
  'shop.bagFull': '背包已满，放不下',
  'shop.buyOne': '买下 1 件（-{n} 金）',
  'shop.sellOne': '卖出 1 件（+{n} 金）',
  'shop.hintNav': 'Enter 买入 · S 卖出选中的一件 · ESC 离开',

  // ── 产业面板（GameScene industry UI）───────────────────────────────────
  'industry.title': '产业投资',
  'industry.settlement': '产业结算：第 {n} 天进账 +{gold} 金',
  'industry.collapsed': '{name}倒闭了，投入的本金全损',
  'industry.costLine': '成本 {n} 金 · 日 {rate}% · 亏 {loss}% · 倒 {collapse}%',
  'industry.enterInvest': 'Enter 入股 {n} 金',
  'industry.hintNav': '↑/↓ 选择 · Enter 入股 · G 离开',

  // ── 制作（systems/CraftingSystem.ts）───────────────────────────────────
  'craft.tierLocked': '档位 {tier}｜权力线 {access} 级未达',
  'craft.alreadyBuilt': '{name} 已建造',
  'craft.requiresFirst': '需要先获得{name}',
  'craft.built': '建造了 {name}（-{n} 分钟）',
  'craft.crafted': '制作了 {name}（-{n} 分钟）',

  // ── 搜刮检视（systems/LootSystem.ts）───────────────────────────────────
  'loot.empty': '内容：空',
  'loot.notGenerated': '内容：未生成（B4 程序化楼层）',
  'loot.bedRemoved': '这床已经拆掉了',

  // ── 宿舍/生存（ShelterSystem/SurvivalSystem/FloorSystem/TowerNav）──────
  'message.gameOver': '游戏已结束',
  'message.returnToDorm': '必须回到第 1 层宿舍',
  'message.shelterAlready': '今晚已经安排过 shelter 行动',
  'message.doorClosed': '你把门关好，先让身体恢复一点。',
  'message.noWounds': '现在没有需要处理的伤势',
  'message.tooEarlyToSleep': '还太早，无法入睡（20:00 后）',
  'message.severeDehydration': '严重脱水',
  'message.hypothermia': '失温',
  'message.unknownArea': '未知区域',
  'message.noFloorSelected': '未选择楼层',
  'message.floorLocked': '该楼层尚未打通，需先通过实际通路抵达',
  'message.itemNotUsable': '{name} 不可使用',
  'message.bagFull': '背包已满',
  'message.bagFullLoot': '背包已满：翻出来的东西放不下，先腾包',

  // ── 世界事件（systems/EventSystem.ts）──────────────────────────────────
  'event.blackout': '走廊停电了，摸黑很危险，靠手电或回宿舍。',
  'event.wanderer': '巡游体在 {n} 层出没，回宿舍或换层躲避。',
  'event.leak': '{n} 层漏水，部分物资受潮。',

  // ── 夜间失窃（systems/NightSystem.ts，原文行首 ' · ' 已剥离）────────────
  'night.theft': '夜里好像有人来过……{container}被翻过，少了{details}',
  'night.theftEmpty': '夜里好像有人来过……翻过的地方早就空了',

  // ── 停留压力（systems/dwellPressure.ts，抽样）──────────────────────────
  'dwell.creak': '楼板某处轻轻响了一声，又安静下来。',
  'dwell.footsteps': '远处像有人在走动，仔细听又什么都没有。',

  // ── NPC 经济回退台词（ai/npcEconomy.ts，玩家可见）──────────────────────
  'economy.friendly': '冲咱们的交情，好说。',
  'economy.tradeOnly': '拿东西换就行。',
  'economy.surcharge': '现在看见你就想加价。',
  'economy.noTalk': '没什么好谈的。',
  'economy.refuseTrade': '{name}拒不交易：{line}',
  'economy.outOfStock': '{name}现在没有这件货（库存不足或已下架）',
  'economy.got': '换到{name}×{n}',
  'economy.giftInvalid': '赠品数量无效',
  'economy.giftNoItems': '你没有足够的{name}，赠礼作罢',
  'economy.giftGiven': '获赠{name}×{n}',
  'economy.giftNone': 'NPC 没有可以回赠的东西',
  'economy.giftBagFull': '背包空间不足，装不下{name}',

  // ── NPC 日程（ai/npcSchedule.ts）───────────────────────────────────────
  'schedule.idle': '待机',
  'schedule.safeDay': '安稳过天',

  // ── 墙饰（data/wallDeco.ts，8 件名 + 1 条描述抽样）─────────────────────
  'wallDeco.dutyRules': '值班须知（残）',
  'wallDeco.clock': '挂钟',
  'wallDeco.clock.desc': '停在 06:00。\n这栋楼里没有一只钟还在走，但每一只都停在能让人赶上早班的位置。',
  'wallDeco.chandelier': '吊灯',
  'wallDeco.pressureGauge': '压力表',
  'wallDeco.workwearRack': '工服挂架',
  'wallDeco.pipeValve': '管道阀门',
  'wallDeco.metalPlate': '金属铭牌',
  'wallDeco.chalkCount': '粉笔计数',

  // ── 叙事抽样（任务/台词/独白/纸条，证明长文同管道的抽样）───────────────
  'quest.blackoutSchedule': '周三与周五',
  'quest.waterTap': '净水口',
  'quest.badgeAndFace': '工牌与脸',
  'dialogue.alin.greeting': '来了？先别站门口，帮我扶一下梯子。',
  'dialogue.xiaozhou.greeting': '你来得巧，我刚把面包数完第二遍。',
  'monologue.hungry': '肚子叫得厉害……',
  'monologue.thirsty': '嘴唇干得发裂……',
  'monologue.tired': '眼皮沉得抬不起来……',
  'monologue.nightfall': '天一黑，这地方更瘆人了……',
  'note.boilWater': '「水要烧开。别信楼下的净水口。」',
  'note.seventhBatch': '「第七批人走了一半。名字划在食堂墙上。」',
  'note.badgeReturn': '「工牌要交回。别问为什么。——上一块还挂在墙上」',
  'encounter.text.glint': '货架后面闪着光',
  'encounter.text.breath': '黑暗里有人喘气',
  'encounter.text.creak': '楼板吱呀一响，有东西在靠近',
} as const;
