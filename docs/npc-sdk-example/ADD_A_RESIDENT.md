# 加一位新居民：最小可运行示例

> 目标读者：想在这栋楼里添一个人的外部开发者。
> 结论先行：**改 4 个文件 + 跑 1 条测试**，不需要任何美术资源。
> 本文每一段代码都来自本仓库真实文件，路径可直接点开对照。

---

## 0. 先理解约束：为什么是 4 个文件

六位居民共享**一套骨骼**。区分两个人只靠两件事：调色板（`CharacterColors`）和体型系数 `bulk`。
这是刻意的设计——项目只有四张手绘角色图（`char-player.png` / `char-alin.png` /
`char-xiaozhou.png` / `char-wanderer.png`），所以六位居民里阿林、小周有 PNG，
而老陈、阿珍、大刘、小满**没有任何 PNG**，他们的 20 帧走图是运行时按调色板烘焙出来的。

所以加一个人不需要画图。但也因此，加人时"忘了改某处"不会报错，只会让新居民
**看起来存在、行为不对**。那 4 个文件正是被历史上踩过的 4 个坑固定下来的位置
（详见 [`../B3-20_RESIDENT_ROSTER.md`](../B3-20_RESIDENT_ROSTER.md) §3）。

| # | 文件 | 改什么 | 不改的后果 |
|---|---|---|---|
| 1 | `src/data/npcs.ts` | `NpcId` 联合类型 + `NPCS` 数组加一行 | 居民不存在 |
| 2 | `src/data/npcPersonalities.ts` | `NPC_PROFILES` 加一个条目 | 静默退回 `neutral` 兜底，说话和别人一样 |
| 3 | `src/render/artpack.ts` | `CHARACTER_KEYS` 加 sprite 键 | 运行时出现绿色 `__MISSING` 方块 |
| 4 | `src/render/walkcycle.ts` | 一个 `CharacterColors` + 进 `WALK_CHARACTERS` + 进 `CHARACTER_PALETTES` | 同上：没有走图可烘焙 |

（第 5 处是 `src/ai/competitionModelBridge.ts` 的 `NPC_DISPLAY_NAMES`，只在模型
prompt 里把 id 翻成中文名；**漏了不会崩**，prompt 里会显示英文 id。建议一并加。）

---

## 1. `src/data/npcs.ts` —— 声明这个人是谁

### 1.1 结构

```ts
// src/data/npcs.ts:16
export type NpcId = 'alin' | 'xiaozhou' | 'laochen' | 'azhen' | 'daliu' | 'xiaoman';

// src/data/npcs.ts:28-45
export interface NpcDef {
  id: NpcId;
  name: string;
  title: string;
  /** Which floor the resident stands on. */
  floor: number;
  x: number;
  sprite: CharacterKey;          // 必须是 artpack.ts CHARACTER_KEYS 里的值
  greetings: [string, string];    // 必须是两条不同的句子
  asks: [string, string];         // 必须是两条不同的句子
  offers: BarterOffer[];          // 至少一条
}
```

### 1.2 三处硬约束（都写在测试里）

**a) 坐标不能和同层任何可交互物靠太近。**
`INTERACT_DISTANCE = 44`（`src/core/constants.ts:157`）。两个东西相距 ≤ 44px 时，
按 **E** 只会打开数组里靠前的那个，永远打不开另一个——历史上的交易测试就是这么坏的。
必须避开的对象：同层其他居民、容器（`getFloorTemplate(floor).containers[].x`）、
地面物品（`.ground[].x`）、上下楼出口（`UP_EXIT_X = 40`、`DOWN_EXIT_X = 1240`）。
还要留出问号点与商人临时占位的空间。

**b) 报价必须无环。**
`offers` 构成有向图：`give.itemId → get.itemId`。若存在环，玩家可以无限刷。
历史 bug：老陈「木材→电池」+ 大刘「电池→木材×2」= 永动机，
被 `survivalBalance.test.ts` 报 `fuse loops back through battery`。
规则是**每条报价都要消费一个世界供给、且没有任何报价把它还回来**。

**c) 每条报价的 `give.itemId` 不能是另一个报价的 `give.itemId`。**
`npcInventoryFromDef()`（`src/ai/config.ts:131`）按 `give` 物品聚合出 NPC 持有物，
AI 层的 Validator 用它判「NPC 没有的货不能给」。重复的 key 会让计数静默叠加。

### 1.3 完整可粘贴示例：在第 3 层加一位「拾荒老太 · 秦婆婆」

```ts
// ── 1) 联合类型加一个 id ──────────────────────────────────────────────────
// src/data/npcs.ts:16
export type NpcId =
  | 'alin' | 'xiaozhou' | 'laochen' | 'azhen' | 'daliu' | 'xiaoman'
  | 'qinpopo';   // ← 新增

// ── 2) 数组末尾加一行（数组按楼层排序，纯粹为了好读）────────────────────
// src/data/npcs.ts，放进 NPCS 里，位置在 xiaoman 之后
  {
    id: 'qinpopo',
    name: '秦婆婆',
    title: '拾荒老太',
    floor: 3,
    x: 880,          // 第 3 层现有：木箱 480、铁箱 800、小满 640、地面物 160/1120
                     // 880 距最近的 800 有 80px > 44，安全
    sprite: 'npc_qinpopo',
    greetings: [
      '这层的箱子我翻过了，别费劲。',
      '你也是来找东西的？坐下歇会儿。',
    ],
    asks: [
      '我年轻时候这楼还没这么高，你信吗。',
      '有布就给我一块，我缝东西。',
    ],
    offers: [
      // 布→胶带：布只在储物层地面与食堂出现，无人回收，是纯汇点
      { id: 'qin_tape', give: { itemId: 'tape', quantity: 1 }, get: { itemId: 'cloth', quantity: 1 } },
      // 电池→面粉级口粮：电池可从铁箱 60% 概率获得（src/data/floorTemplates.ts:126 的 probability: 0.6）
      { id: 'qin_ration', give: { itemId: 'ration_pack', quantity: 1 }, get: { itemId: 'battery', quantity: 1 } },
    ],
  },
```

> **为什么 x = 880 而不是 700？** 700 距小满（640）只有 60px，看似够 44，
> 但还要留出 `placeClearX(seed, floor, 'trader', ...)` 给商人腾位——测试会扫
> seed 1 / 42 / 2026 三种情况。880 是实测安全值。改坐标后一定跑 §5 的测试。

---

## 2. `src/data/npcPersonalities.ts` —— 决定他是谁，而不是他属于哪类

背景：`ARCHETYPES` 是 `Record<NpcArchetype, ArchetypeDef>`，**每种原型只能挂一个 npcId**。
六人里有四个人共享 `neutral`。所以查找顺序必须是「个体档 → 原型表 → neutral」，
反过来写不会报错，只会让五个人说出同一种语气。

```ts
// src/data/npcPersonalities.ts:63-68
export interface NpcProfile {
  archetype: NpcArchetype;   // 'ally' | 'neutral' | 'hostile'
  traits: PersonalityTraits; // 五个维度，各自 0..1
  goal: string;
  memoryLimit: number;       // 记忆条数上限；敌对记得更久
}
```

`traits` 五个维度（`src/ai/types.ts`）：
`altruism`（利他）· `pragmatism`（务实）· `aggression`（攻击）· `loyalty`（忠诚）· `caution`（谨慎）。
**值必须落在 0..1**，否则 `isValidNpcState()`（`src/systems/NpcMemory.ts:173`）会拒绝
整份存档状态，`loadNpcState()` 返回 `null`，每次对话都从零重建。

```ts
// src/data/npcPersonalities.ts:70，在 NPC_PROFILES 里加一条
  // 秦婆婆：拾荒为生，见得多说得少。谨慎高、利他中、不惹事。
  qinpopo: {
    archetype: 'neutral',
    traits: { altruism: 0.5, pragmatism: 0.85, aggression: 0.05, loyalty: 0.4, caution: 0.8 },
    goal: '把这层的废料盘清楚，换点能吃的',
    memoryLimit: 20,
  },
```

> **选 `archetype` 的实际影响**（`src/data/npcPersonalities.ts:148`）：
> - `ally` → 可用动作 `dialogue / trade / gift / refuse`
> - `neutral` → `dialogue / trade / refuse`（**没有 gift**）
> - `hostile` → `dialogue / attack / flee`
>
> 注意：游戏内菜单上的"赠礼"入口是对所有 NPC 开放的（`src/scenes/GameScene.ts` 的 `dialogueOptionsView()`），
> 与这里的 `ARCHETYPE_ACTIONS` 不是同一层。`ARCHETYPE_ACTIONS` 只用于
> AI 观察对象里 `availableActions` 的默认值。

---

## 3. `src/render/artpack.ts` —— 让"能画出来"成为一个有限集合

```ts
// src/render/artpack.ts:45-54
export const CHARACTER_KEYS = [
  'player',
  'npc_alin',
  'npc_xiaozhou',
  'wanderer',
  'npc_laochen',
  'npc_azhen',
  'npc_daliu',
  'npc_xiaoman',
] as const;

export type CharacterKey = (typeof CHARACTER_KEYS)[number];
```

加一个键：

```ts
export const CHARACTER_KEYS = [
  'player', 'npc_alin', 'npc_xiaozhou', 'wanderer',
  'npc_laochen', 'npc_azhen', 'npc_daliu', 'npc_xiaoman',
  'npc_qinpopo',   // ← 新增
] as const;
```

**`CHARACTER_FILES` 不要动。** 它的类型是 `Partial<Record<CharacterKey, string>>`：

```ts
// src/render/artpack.ts:62-67
export const CHARACTER_FILES: Partial<Record<CharacterKey, string>> = {
  player: 'char-player.png',
  npc_alin: 'char-alin.png',
  npc_xiaozhou: 'char-xiaozhou.png',
  wanderer: 'char-wanderer.png',
};
```

`Partial` 是刻意的：`BootScene` 只加载这里列出的文件，`bakeWalkSheets()` 补上其余的。
**`undefined` 意味着"去烘焙"，不是"缺文件"**。如果不用 `Partial`，新居民就会去加载
`assets/artpack/undefined.png`——一个 404，而 Phaser 只会给你一个绿色方块。

---

## 4. `src/render/walkcycle.ts` —— 两处：配色 + 两个名单

### 4.1 定义配色

```ts
// 参考现成的 LAOCHEN_COLORS（src/render/walkcycle.ts:518）
export const QINPOPO_COLORS: CharacterColors = {
  ...PLAYER_COLORS,
  bulk: 0.75,
  cloth: rgb(PALETTE.stone),
  clothDark: rgb(PALETTE.shadow),
  clothLight: rgb(PALETTE.dust),
  trouser: rgb(PALETTE.ink),
  hair: rgb(PALETTE.dust),          // 白发
  skin: rgb(PALETTE.skin),
  skinDark: rgb(PALETTE.skinDeep),
};
```

`CharacterColors` 的 12 个字段全部来自 `PALETTE`（`src/render/palette.ts`，共 16 色）。
**不要手写十六进制**——调色板是"一种材质最多三个明度档"的约束，手写值会让角色在
石墙前失去边缘（2D 美术规则：角色必须靠明度与背景分离）。

### 4.2 `bulk` 怎么选：这是本文最重要的一节

`bulk` 是这套共享骨架里**唯一**的体型变量，只缩放躯干与手臂宽度。
骨架、腿长、触地位置全部一致——不一致会让同一份走图在第 2 层错位，也会让交互半径算错。

**硬约束：同一层的两个居民，剪影 IoU 必须 < 0.96。**

这条不是主观审美，是 `src/tests/npcRoster.test.ts:81-113` 里的断言：

```ts
// 摘录，实际代码见 src/tests/npcRoster.test.ts
const iou = inter / union;
expect(
  iou,
  `${residents[i].name} and ${residents[j].name} share a floor and their silhouettes overlap ${(iou * 100).toFixed(1)}% — give one of them a different bulk`,
).toBeLessThan(0.96);
```

测量方法：把 `drawPose(cv, idlePose(0), colors, 0)` 的不透明像素做成掩码，两两算交并比。
**只比较同层的人**——不同层永远不会同屏。

现有分配（第 2 层四人，两两最大重叠实测 0.925）：

| 居民 | 层 | bulk | 备注 |
|---|---|---|---|
| 老陈 | 2 | **0.60** | 全场最窄 |
| 小周 | 2 | **0.82** | 偏瘦 |
| 大刘 | 2 | **1.05** | 居中，唯一浅色衣服 |
| 阿林 | 2 | **1.30** | 最壮 |
| 小满 | 3 | **0.70** | 第 3 层只有他，无同层比较对象 |
| 阿珍 | 5 | **1.12** | 第 5 层只有她 |

**新居民放第 3 层 → 要和小满（0.70）拉开。** 秦婆婆 0.75 与 0.70 的实测 IoU 是
**0.977**，超过阈值，**会失败**。改法有三个：

1. **拉开 bulk**：0.75 → **0.95**（实测 IoU 0.916，通过）
2. **换一层**：放到第 5 层（那里只有阿珍 1.12），可用 0.7 左右
3. **放第 4 层**——但那层是漆黑区域，`docs/B3-20_RESIDENT_ROSTER.md` §1 明确说
   加人前要先处理光照，否则只是"在黑暗里多几个看不见的名字"

推荐方案 1，把 `bulk` 改成 **0.95**：

```ts
export const QINPOPO_COLORS: CharacterColors = {
  ...PLAYER_COLORS,
  bulk: 0.95,   // 第 3 层已有小满 0.70；实测 IoU 0.916，通过 < 0.96 门槛
  // ...
};
```

**实测对照表**（用 `drawPose` + `idlePose(0)` 掩码，与测试同算法，2026-11-25 在本仓库跑出）：

| 候选 bulk | vs 小满(0.70) 的 IoU | 是否通过 < 0.96 |
|---:|---:|:--:|
| 0.70 | 1.000 | ✗ |
| 0.75 | 0.977 | ✗ |
| 0.80 | 0.967 | ✗ |
| 0.85 | 0.945 | ✓（余量仅 1.5 个百分点，不建议） |
| 0.90 | 0.926 | ✓ |
| **0.95** | **0.916** | **✓ 推荐** |
| 1.00 | 0.897 | ✓ |
| 1.05 | 0.875 | ✓ |

这个表本身就是"为什么不能凭感觉调"的证据：0.75 和 0.85 只差 0.10，一个失败一个勉强过。

> **怎么验证你的值？** 直接跑 `npm run test -- src/tests/npcRoster.test.ts`。
> 失败信息会打印实际的 IoU 百分比和两个人的名字。不要凭感觉调。

### 4.3 进两个名单

```ts
// src/render/walkcycle.ts:1042
export const WALK_CHARACTERS: readonly CharacterKey[] = [
  'player', 'npc_alin', 'npc_xiaozhou', 'wanderer',
  'npc_laochen', 'npc_azhen', 'npc_daliu', 'npc_xiaoman',
  'npc_qinpopo',   // ← 新增：没有 PNG 的居民靠这个被烘焙出走图
];

// src/render/walkcycle.ts:1118
export const CHARACTER_PALETTES: Record<CharacterKey, CharacterColors> = {
  player: PLAYER_COLORS,
  npc_alin: ALIN_COLORS,
  npc_xiaozhou: XIAOZHOU_COLORS,
  wanderer: WANDERER_COLORS,
  npc_laochen: LAOCHEN_COLORS,
  npc_azhen: AZHEN_COLORS,
  npc_daliu: DALIU_COLORS,
  npc_xiaoman: XIAOMAN_COLORS,
  npc_qinpopo: QINPOPO_COLORS,   // ← 新增
};
```

`CHARACTER_PALETTES` 是 `Record<CharacterKey, ...>`（**不是** `Partial`），
所以少一个键是**编译错误**——这是刻意的：它保证"每个能画出来的角色都有配色"。

---

## 5. `src/ai/competitionModelBridge.ts` —— 可选，但建议加

```ts
// src/ai/competitionModelBridge.ts:59（该表未 export，直接改文件即可）
const NPC_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  alin: '阿林', xiaozhou: '小周', laochen: '老陈',
  daliu: '大刘', azhen: '阿珍', xiaoman: '小满',
  wanderer: '流浪者',
  qinpopo: '秦婆婆',   // ← 新增；漏了不会崩，prompt 里会显示 "qinpopo"
};
```

---

## 6. 验证：一条命令，五个检查点

```bash
npm run test -- src/tests/npcRoster.test.ts
```

这个文件对你的新居民有 **18 项断言**，分五组：

| 组 | 检查什么 |
|---|---|
| 楼里住着人 | 总数 > 2、分布在多层、每人 id/name 唯一、`npcsOnFloor` 不串层 |
| **能画出来** | sprite 在 `CHARACTER_KEYS` 且 `WALK_CHARACTERS` 里；同层不共用 sprite；**同层剪影 IoU < 0.96** |
| **有自己的性格** | `NPC_PROFILES` 有条目（不退兜底）；traits 全在 0..1；原型表与个体档一致；`npcFactFromDef` 带自己的楼层 |
| **不抢 E 键** | 与同层每个可交互物 > 44px；居民之间 > 44px；seed 1/42/2026 下问号点与商人仍有位置 |
| 报价是汇点 | `give→get` 图无环；每人至少一条报价；greetings/asks 各两条且互不相同 |

再跑全量：

```bash
npm run typecheck   # CHARACTER_PALETTES 少键会在这里报错
npm run test        # 全量单测
```

最后跑**视觉检查**——把烘焙出的帧导成图，肉眼看一眼新角色是否"像个人"：

```bash
node tools/bake-walk.ts npc_qinpopo re/frames
```

`tools/bake-walk.ts` 直接 import `walkcycle.ts` 的 pose 函数与配色表，
所以它渲染的就是游戏里会看到的东西：单帧 `64×96`（`src/render/walkcycle.ts:25-26`），
外加一张 4 倍放大的对照表 `5120×384`
（`tools/bake-walk.ts:85-89`：`SCALE = 4`、`cols = TOTAL_FRAMES = 20`，即 `64×20×4`）。

---

## 7. 常见错误

| 症状 | 原因 | 位置 |
|---|---|---|
| 绿色方块站在楼层里 | `CHARACTER_KEYS` 加了但 `WALK_CHARACTERS` 没加，或反之 | artpack.ts / walkcycle.ts |
| 新居民长着小周的样子 | 直接复用了 `'npc_xiaozhou'` 作为 sprite | npcs.ts |
| 说话语气和其他人一样 | `NPC_PROFILES` 缺条目，静默退回 `neutral` | npcPersonalities.ts |
| 按 E 打不开新居民 | 与同层某物距离 ≤ 44px | npcs.ts 的 `x` |
| 赠礼静默失败 | 新 id 未进 `SOCIAL_NPC_IDS`——但该表已从 `NPCS` 派生（`socialNpcDemo.ts:51`），如果你手动改过它就会重现 | scenarios/socialNpcDemo.ts |
| 同层两人"换了件衣服" | `bulk` 太接近，IoU ≥ 0.96 | walkcycle.ts |
| AI 说"我手里没有这样东西" | 报价的 `give.itemId` 被两条报价重复声明 | npcs.ts 的 offers |

---

## 8. 这份示例的边界（诚实说明）

- 秦婆婆的 `bulk: 0.95` 与第 3 层小满的 IoU **已实测为 0.916**（见 §4.2 对照表），
  通过 0.96 门槛。该数值由本仓库的 `drawPose` / `idlePose` 直接算出，与测试同算法。
- **示例代码本身未编译过**——它是文档，不是提交的代码。粘贴后请以
  `npm run typecheck` 与 `npm run test -- src/tests/npcRoster.test.ts` 的实际结果为准。
- 新增居民**不会**自动接入 AI 模型闭环。当前游戏内的 `allowedActions` 是
  `['dialogue']`（`src/scenes/GameScene.ts` 的 `getAiRuntime()`），赠礼/维修走的是离线场景函数。
  加人只让他在世界里**存在、可对话、可交易**，不等于有了生成式决策。