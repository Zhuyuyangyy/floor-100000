// RC-03 拆分第 8 步：DialogueController——NPC 对话 + 行商交易 + 产业投资 +
// AI NPC 编排。从 GameScene 迁出（原四段：行商 2142–2353 / 产业 2355–2582 /
// 对话面板 5362–5566 / AI NPC 5568–5885，共 22 方法 + 25 字段 + 2 常量），
// 行为零变更：同一构造路径（create 里 buildDialoguePanel 的位置）、同一开面板
// 入口（onInteract 的 shop spot / nearestNpc）、同一输入路由（onEsc 三分支 /
// onNavUp·onNavDown 三光标 / onUse 三激活 / keyS / keyG）、同一冻结面。
//
// 形态（设计文档 §2，沿用前七步的主机结构面模式）：plain TS 类，**不 import
// Phaser 场景类型**——
//   * 构造拿 host（DialogueHost：add/tweens/time 三个 Phaser 单子 + 场景查询
//     面与动作面——GameScene 天然满足）；
//   * 纯逻辑三件套留原处：行商经济（systems/shop.ts 的 shopStock/
//     materialShelf/buy/sell/sellPrice + VENTURES/invest/settleInvestments，
//     econBalance/economyLoop/investment 系列测试直守）、NPC 交易与赠礼
//     （ai/npcEconomy.ts 的 availableOffers/executeBarter/giftOffer/
//     claimGift/receiveGift，npcEconomy.test.ts 直守）、对话几何
//     （render/dialogueLayout.ts，dialogueLayout.test.ts 直守）——本类只做
//     编排：面板装配、光标窗口、选项树推进、AI 降级路径呈现；
//   * 共享渲染件第一参钉死 Phaser.Scene 的（buildPanel/buildPanelHeader/
//     buildPanelWell/buildListRow/panelHit）由 host 结构面 + sharedScene 一次
//     性收窄注入（与 CombatController 同款路数）——运行期 host 就是 GameScene
//     实例，Node 下可用记录型假件单测（src/tests/dialogueController.test.ts）；
//   * 显示器持有并管理自己的 GameObjects：对话面板件（dialogueObjects 组）、
//     行商面板件（shopObjects，**不**与遭遇面板共用场景的 encounterObjects
//     —— CombatController 自持 panelObjects 的同款先例）、产业面板件
//     （ventureObjects 组）的生命周期全在本类，GameScene 残留面见文件末
//     「场景残留面」。
//
// GameScene 残留面（设计文档原文「打开/关闭/结果回写」）：
//   * onInteract 的入口检查链留场景（nearestEncounterSpot 的 'shop' →
//     dialogue.openShop()；nearestNpc → dialogue.open(npc)）——世界距离判定
//     与 NPC 实时摆位（drawNpcs/npcView/syncNpcs/nearestNpc）是场景侧世界
//     渲染，不随面板迁出；
//   * onEsc/onNavUp/onNavDown/onUse/keyS/keyG 的对话域分支留场景做路由委托
//     （openShop/closeShop/back/close/move/activate/shopMove/shopBuy/
//     shopSell/ventureMove/toggleVentures/closeVentures/activateVenture）；
//   * 产业账本观察三点留场景（chargeTime 与帧循环 advanceTime、睡觉跨日
//     finishNight 前后的 ventureLedgerSnapshot+diffVentureLedger）——时钟
//     属主在场景，控制器只被观察调用；
//   * anyPanelOpen/openPanelHint/各输入 guard 的开关读数留场景（isOpen/
//     ventureIsOpen 两个 getter）；hint 链「按 E 与行商交易」「按 E 对话」
//     与行商巡逻 timer 留场景；
//   * e2e 契约：spark.spec.ts 直读 scene.dialogue（{message, sessionId}），
//     GameScene 留 public getter 委托本类 dialogueSnapshot()——e2e 零改动；
//   * clearStrayPanels 的对话/产业两组并成 dialogue.panelObjectsForRecovery()
//     （行商组同入口，战斗第 7 步同款路数）。
//
// 三条不变量（迁移中逐字保留）：
//   · 面板外点击 = 鼠标 ESC（panelBox 判据随当前面板几何走，AI 长台词把
//     对话面板撑高时 panelBox 跟着涨——否则头脚算「面板外」一点就关）；
//   · 会话保鲜键（sessionId+revision）：AI 异步返回的结果只覆盖同一场对话，
//     玩家任何操作（返回/切层/选项）都 revision+1 将在途结果判过期；
//   · 降级优先：AI 未配置（aiNpcConfig().enabled=false）时 getAiRuntime 返
//     null，enhanceOpeningLine 直接空转——玩家看到的就是改造前那一句静态
//     问候，无头环境（CI）走的就是这条路径。

import type Phaser from 'phaser';
import { PALETTE, TEXT, hex } from '../../render/palette';
import {
  FONT_FAMILY,
  PANEL_HEADER_H,
  TYPE,
  UI,
  buildListRow,
  buildPanelHeader,
  buildPanelWell,
  drawLine,
} from '../../render/uiKit';
import {
  PANEL_DEPTH,
  PANEL_FILL_BANDS,
  PANEL_FRAME_PIECES,
  PANEL_SLICE,
  applyPanelDepth,
  buildPanel,
  lockToScreen,
  placeMarkerLeftOf,
  type PanelObject,
} from '../../render/panels';
import {
  DIALOG_PADDING,
  DIALOG_PANEL_H,
  DIALOG_PANEL_W,
  DIALOG_PORTRAIT_SIZE,
  DIALOG_PORTRAIT_TOP,
  DIALOG_ROW_COUNT,
  DIALOG_ROW_H,
  DIALOG_ROW_PITCH,
  DIALOG_ROWS_TOP,
  DIALOG_TEXT_LEFT,
  DIALOG_TEXT_W,
  DIALOG_WELL_H,
  DIALOG_WELL_LEFT,
  DIALOG_WELL_TOP,
  DIALOG_WELL_W,
  dialogueGeometry,
} from '../../render/dialogueLayout';
import type { HitHandlers } from '../../render/pointer';
import { LIGHT_DEPTH } from '../../render/lighting';
import { itemIconKey } from '../../render/itemIcons';
import { portraitKey } from '../../render/artpack';
import type { CharacterKey } from '../../render/artpack';
import { playSfx } from '../../render/audio';
import { getGame } from '../../core/session';
import { PLAYER_FEET_Y } from '../../core/constants';
import { ACTION_COSTS } from '../../systems/SurvivalSystem';
import { saveToStorage } from '../../systems/SaveSystem';
import { countItem } from '../../systems/InventorySystem';
import { getItem } from '../../data/items';
import type { ItemId } from '../../core/gameTypes';
import {
  VENTURES,
  buy,
  invest,
  materialShelf,
  sell,
  sellPrice,
  settleInvestments,
  shopStock,
} from '../../systems/shop';
import { noteGoldEarned } from '../../systems/StatsSystem';
import { bumpFlag, flagCount } from '../../systems/WorldFlags';
import { ensureGrowth } from '../../core/growth';
import { getNpc, type BarterOffer, type NpcDef, type NpcId } from '../../data/npcs';
import {
  availableOffers,
  claimGift,
  executeBarter,
  giftOffer,
  receiveGift,
  reputationOf,
} from '../../ai/npcEconomy';
import { syncNpcInventory } from '../../ai/npcInventory';
import { aiNpcConfig, archetypeForNpcId, npcFactFor } from '../../ai/config';
import { OllamaBrain } from '../../ai/brains/ollamaBrain';
import { OptionTreeBrain } from '../../ai/brains/optionTreeBrain';
import { createNpcState } from '../../data/npcPersonalities';
import { loadNpcState } from '../../systems/NpcMemory';
import {
  decideNpcAction,
  isDialogueFresh,
  type DialogueSession,
  type NpcRuntimeConfig,
} from '../../systems/NpcRuntime';
import type { NpcPersistedState } from '../../ai/types';
import type { PanelBox } from './StatsPanelController';

// ── 随迁的两条模块常量（原 GameScene.ts 326/330 行） ────────────────────────
/** 产业累计收益的 flag 键（WorldFlags 账本，buildVenturePanel 的「累计」行读它）。 */
const VENTURE_INCOME_FLAG = 'economy:venture-income-total';
/** 结算 flash 的延后量：跨日那一帧 ensureNightEvent 也在 flash（今夜的遭遇），
 *  两条同时亮只会互相覆盖——玩家先看到今夜有什么，再看到产业进账。1600ms 是
 *  flash 自身的寿命，1700ms 正好接在后面。 */
const VENTURE_FLASH_DELAY_MS = 1700;

/** 一场对话的运行时状态（原 GameScene dialogue 字段的行内类型，提升为导出）。 */
export interface DialogueState {
  npc: NpcId;
  level: 'main' | 'trade' | 'gift';
  selected: number;
  message: string;
  lineToggle: number;
  sessionId: number;
  revision: number;
}

/** 行商一行货架（商品架 stock / 材料货架 material 共用这一个光标）。 */
type ShopRow = { kind: 'stock' | 'material'; itemId: ItemId; price: number };

/**
 * 控制器需要场景提供的最小面（GameScene 天然满足；单测用假件实现）。
 * 刻意不 import Phaser.Scene：本类的可测性靠这层结构面，而不是靠能造真场景。
 */
export interface DialogueHost {
  // ── Phaser 单子（结构面）──
  /** GameObject 工厂——面板件/名签/热区从它出生。 */
  add: Phaser.GameObjects.GameObjectFactory;
  /** Tween 管理器（本类当前不直接加 tween；随面保留，与 MonologueHost 同款）。 */
  tweens: Phaser.Tweens.TweenManager;
  /** 场景时钟——行商行点击的延迟一 tick（delayedCall(0)）与结算 flash 排程。 */
  time: Phaser.Time.Clock;

  // ── 共享件的场景薄封装（第一参钉死 Phaser.Scene，运行期即本场景）──
  /** 屏幕空间点击热区（panelHit：scrollFactor 0）——行商行/产业行/对话行。 */
  panelHit(x: number, y: number, w: number, h: number, depth: number, handlers: HitHandlers): Phaser.GameObjects.Rectangle;
  /** 粒子特效（render/fx.ts playFx 的场景薄封装；降级时返回 null）——交易成功的 coin-spin。 */
  playFx(id: string, x: number, y: number, depth: number): Phaser.GameObjects.GameObject | null;
  /** 选项箭头标记（render/panels createMarker）——对话光标与产业光标各一支。 */
  createMarker(): Phaser.GameObjects.Image;

  // ── 场景能力 ──
  /** 视口尺寸（三块面板居中）。 */
  viewSize(): { width: number; height: number };
  /** 鼠标 ESC 逃生门的判定矩形（onPointerDown 读 panelBox；随当前面板几何走）。 */
  setPanelBox(box: PanelBox): void;
  /** 面板槽布尔（行商与遭遇/战斗共用同一个 encounterOpen）。 */
  setEncounterOpen(open: boolean): void;
  /** 世界回写：行商面板关闭后重建问号/行商点（closeShop 的收尾）。 */
  rebuildEncounterSpots(): void;
  /** HUD 刷新（买卖/入股/赠礼后）。 */
  refreshStats(): void;
  /** 背包面板刷新（买卖/赠礼后）。 */
  refreshInventory(): void;
  /** 左下角 toast（买卖/入股/结算读数）。 */
  flash(message: string): void;
  /** 扣游戏分钟（交易/赠礼的 -N 分钟；时钟属主在场景，含产业账本观察）。 */
  chargeTime(gameMinutes: number): void;
  /** AG-77：全 NPC 对话成就发射（每位只认第一次开口）。 */
  emitNpcTalked(npcId: NpcId): void;
  /** 行商行/对话行点击的「选中后确认」——走场景 Enter 同一条路径（onUse）。 */
  onUse(): void;
  /** dev 面板空件自查（assertPanelContent；build 后当场跑）。 */
  assertPanelContent(panel: string, objects: ReadonlyArray<Phaser.GameObjects.GameObject>): void;
}

/** 共享面板渲染件第一参的场景类型（buildPanel/buildPanelHeader/
 *  buildPanelWell/buildListRow）——同 CombatController 的 SharedPanelScene
 *  路数，签名是边界冻结的（EndScene/EndgameScene 同参），它们改签名时这里
 *  跟着报错。 */
type SharedPanelScene = Parameters<typeof buildPanel>[0];

export class DialogueController {
  // ── 行商字段组（原 GameScene 字段，随迁） ────────────────────────────────
  /** 两块货架（商品 + 当日牌价材料）合成一份行列表；shopSelected 跨架共用。 */
  private shopRows: ShopRow[] = [];
  private shopSelected = 0;
  /** 行商面板件（自持列表——不写场景的 encounterObjects：那个列表归遭遇/结局
   *  面板，战斗第 7 步起 CombatController 同样自持 panelObjects）。 */
  private shopObjects: Phaser.GameObjects.GameObject[] = [];

  // ── 产业投资面板字段组（原 GameScene 字段，随迁） ────────────────────────
  private ventureOpen = false;
  private ventureSelected = 0;
  private ventureObjects: PanelObject[] = [];
  private ventureMarker!: Phaser.GameObjects.Image;
  /** 最近一次产业结算的读数（由 diffVentureLedger 在时钟推进后对比账本得出）。 */
  private lastVentureDay = 0;
  private lastVentureIncome = 0;
  private lastVentureCollapsed: string[] = [];

  // ── 对话面板字段组（原 GameScene 字段，随迁） ────────────────────────────
  private dialogOpen = false;
  private dialog: DialogueState | null = null;
  /** 会话流水号（每开一场 +1；AI 保鲜键的 sessionId 半边）。 */
  private sessionSeq = 0;
  /** 赠礼层/长选项表的视图窗口平移：视图第 0 行对应扁平下标 viewOffset。 */
  private viewOffset = 0;
  private dialogueObjects: PanelObject[] = [];
  /** one selection band per dialogue row, toggled in refresh() */
  private dialogueBands: Array<{ band: Phaser.GameObjects.Rectangle; rule: Phaser.GameObjects.Rectangle }> = [];
  private dialogueRowHits: Phaser.GameObjects.Rectangle[] = [];
  private dialogueTitle!: Phaser.GameObjects.Text;
  private dialoguePortrait!: Phaser.GameObjects.Image;
  private dialoguePortraitFrame!: Phaser.GameObjects.Rectangle;
  private dialogueMessage!: Phaser.GameObjects.Text;
  private dialogueOptions: Phaser.GameObjects.Text[] = [];
  private dialogueOptionIcons: Phaser.GameObjects.Image[] = [];
  private dialogueMarker!: Phaser.GameObjects.Image;
  // the dialogue flicker before the geometry was extracted: the skin and the
  // header strip are captured, not just pushed — refresh() re-places these
  // parts when a long AI opening line grows the panel (dialogueGeometry).
  private dialoguePanelParts: PanelObject[] = [];
  private dialogueHeaderParts: PanelObject[] = [];
  private dialogueWellFill!: Phaser.GameObjects.Rectangle;
  private dialogueWellEdge!: Phaser.GameObjects.Graphics;
  private dialogueFooter!: Phaser.GameObjects.Text;

  // ── AI NPC 字段组（原 GameScene 字段，随迁） ─────────────────────────────
  /** 每位 NPC 一份运行时（brain + 降级脑 + 允许动作表），按 id 缓存。 */
  private aiRuntimes = new Map<string, NpcRuntimeConfig>();

  constructor(private readonly host: DialogueHost) {}

  /** 见 SharedPanelScene：仅供共享面板渲染件调用的一次性场景收窄。 */
  private get sharedScene(): SharedPanelScene {
    return this.host as unknown as SharedPanelScene;
  }

  // ── 读数面（场景侧 guard/hint/恢复路径用） ───────────────────────────────
  /** 对话面板开着没有（anyPanelOpen/各输入 guard 的判据）。 */
  get isOpen(): boolean {
    return this.dialogOpen;
  }

  /** 产业面板开着没有（同上）。 */
  get ventureIsOpen(): boolean {
    return this.ventureOpen;
  }

  /**
   * 当前对话的快照（{message, sessionId}）——e2e/spark.spec.ts 的契约面：
   * 它直读 scene.dialogue，GameScene 的 public getter 委托到这里。没有打开
   * 的对话时为 null（spec 的「交互没被卡死」断言读的正是这个）。
   */
  dialogueSnapshot(): { message: string; sessionId: number } | null {
    if (!this.dialogOpen || !this.dialog) return null;
    return { message: this.dialog.message, sessionId: this.dialog.sessionId };
  }

  /** 面板对象列表（clearStrayPanels 恢复路径要看得见对话/行商/产业三组件）。 */
  panelObjectsForRecovery(): ReadonlyArray<Phaser.GameObjects.GameObject | PanelObject> {
    return [...this.dialogueObjects, ...this.shopObjects, ...this.ventureObjects];
  }

  // ── 行商（OVERHAUL Wave C1 + AG-20 双货架） ──────────────────────────────
  // One panel, two directions: ↑/↓ moves along the stock, Enter buys one, and
  // S sells one of the highlighted item. Gold is the run's second currency and
  // the shortcut's price (Wave C2).

  openShop(): void {
    const state = getGame();
    // AG-20: 商品架 + 材料货架合成一份行列表。材料牌价是当日价
    // （materialShelf 按 (runSeed, day) 抖），所以每次开面板都重新读——
    // 昨天看过的价今天不作数，这正是「今天囤料还是明天囤料」的决策面。
    this.shopRows = [
      ...shopStock(state.currentFloor).map((e) => ({ kind: 'stock' as const, itemId: e.itemId, price: e.price })),
      ...materialShelf(state.runSeed, state.day).map((e) => ({ kind: 'material' as const, itemId: e.itemId, price: e.price })),
    ];
    this.shopSelected = 0;
    this.host.setEncounterOpen(true);
    playSfx('click');
    this.buildShopPanel();
  }

  closeShop(): void {
    this.host.setEncounterOpen(false);
    for (const o of this.shopObjects) o.destroy();
    this.shopObjects = [];
    this.host.rebuildEncounterSpots();
  }

  private buildShopPanel(): void {
    for (const o of this.shopObjects) o.destroy();
    this.shopObjects = [];
    const state = getGame();
    const { width, height } = this.host.viewSize();
    const cx = width / 2;
    const cy = height / 2;
    const panelW = 440;
    // AG-20: 248 → 424。材料货架是八行当日牌价，每行同时写着「买」和「卖」
    // 两个方向的价格——要价恒高于收购价（shop.ts 的结构性下限），面板上
    // 一眼看得见，套利无从下嘴。
    const panelH = 424;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    // Remembered for the mouse: a click outside this rectangle closes the panel.
    this.host.setPanelBox({ x: left, y: top, w: panelW, h: panelH });
    const depth = PANEL_DEPTH.game.dialogue;

    this.shopObjects.push(...buildPanel(this.sharedScene, cx, cy, panelW, panelH, 'green', depth));
    this.shopObjects.push(...buildPanelHeader(this.sharedScene, left, top, panelW, '行商', UI.good, depth + 5));

    // The purse, right-aligned on the header row: the one number that decides
    // what the rest of this panel means.
    this.shopObjects.push(
      this.host.add
        .text(left + panelW - 10, top + 10, `${state.player.gold} 金`, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: hex(PALETTE.lightHigh) })
        .setOrigin(1, 0.5)
        .setDepth(depth + 6),
    );

    // Stock as rows: icon, name, price, how many the player already carries.
    // The icon is the item's own 16x16 art, so the shop speaks the same visual
    // language as the bag. AG-20: the two shelves share one cursor
    // (this.shopSelected indexes shopRows), so this section scans the combined
    // list and keeps its own rows' y positions contiguous.
    let stockY = top + 30;
    for (const [i, row] of this.shopRows.entries()) {
      if (row.kind !== 'stock') continue;
      const y = stockY;
      stockY += 30;
      const selected = i === this.shopSelected;
      this.shopObjects.push(
        ...buildListRow(this.sharedScene, left + 8, y, panelW - 16, depth + 5, {
          iconKey: itemIconKey(row.itemId),
          label: getItem(row.itemId).displayName,
          value: `${row.price} 金 · 持 ${countItem(state.player.inventory, row.itemId)}`,
          selected,
        }),
      );
      // Click a row to buy it. Deferred by one tick: this panel is rebuilt from
      // scratch on every selection change, and destroying the object that is
      // currently handling the pointer event is how you get a crash inside
      // Phaser's input list.
      this.shopObjects.push(
        this.host.panelHit( left + 8, y, panelW - 16, 28, depth + 8, {
          onClick: () =>
            this.host.time.delayedCall(0, () => {
              this.shopSelected = i;
              this.buildShopPanel();
              this.host.onUse();
            }),
        }),
      );
      if (!selected) continue;
      // The selected row also shows what the trade would do, since the only
      // feedback otherwise arrives after the gold is already spent.
      const canBuy = state.player.gold >= row.price;
      this.shopObjects.push(
        this.host.add
          .text(left + panelW - 20, y + 20, canBuy ? 'Enter 买入' : '金币不足', {
            fontFamily: FONT_FAMILY,
            fontSize: `${TYPE.caption}px`,
            color: canBuy ? hex(PALETTE.clothHigh) : hex(TEXT.warn),
          })
          .setOrigin(1, 0.5)
          .setDepth(depth + 7),
      );
    }

    // ── AG-20: 材料货架（当日牌价）────────────────────────────────────────
    // 与商品架同一块面板、同一个光标：八件硬通货，每行「买 X · 卖 Y · 持 N」。
    // 买价是 materialShelf 的当日牌价（每次开面板重读），卖价是商人收购价
    // （sellPrice，全世界固定）——两个方向印在同一行上，结构性无套利因此
    // 是看得见的，不是注释里的承诺。
    const shelfY = stockY + 6;
    this.shopObjects.push(
      this.host.add
        .text(left + 16, shelfY + 8, `材料货架 · 第 ${state.day} 天牌价`, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.secondary) })
        .setOrigin(0, 0.5)
        .setDepth(depth + 7),
    );
    let rowY = shelfY + 22;
    for (const [i, row] of this.shopRows.entries()) {
      if (row.kind !== 'material') continue;
      const y = rowY;
      rowY += 26;
      const selected = i === this.shopSelected;
      const bid = sellPrice(row.itemId, state.currentFloor);
      this.shopObjects.push(
        ...buildListRow(this.sharedScene, left + 8, y, panelW - 16, depth + 5, {
          iconKey: itemIconKey(row.itemId),
          label: getItem(row.itemId).displayName,
          value: `买 ${row.price} · 卖 ${bid} · 持 ${countItem(state.player.inventory, row.itemId)}`,
          selected,
        }),
      );
      this.shopObjects.push(
        this.host.panelHit( left + 8, y, panelW - 16, 26, depth + 8, {
          onClick: () =>
            this.host.time.delayedCall(0, () => {
              this.shopSelected = i;
              this.buildShopPanel();
              this.host.onUse();
            }),
        }),
      );
      if (!selected) continue;
      const canBuy = state.player.gold >= row.price;
      this.shopObjects.push(
        this.host.add
          .text(left + panelW - 20, y + 20, canBuy ? 'Enter 买入' : '金币不足', {
            fontFamily: FONT_FAMILY,
            fontSize: `${TYPE.caption}px`,
            color: canBuy ? hex(PALETTE.clothHigh) : hex(TEXT.warn),
          })
          .setOrigin(1, 0.5)
          .setDepth(depth + 7),
      );
    }

    // The sell hint lives in its own strip at the bottom: the stock list is
    // what the player is browsing, and the sell mechanics apply to the whole bag
    // rather than to the highlighted row.
    const footY = top + panelH - 34;
    this.shopObjects.push(...buildPanelWell(this.sharedScene, left + 8, footY, panelW - 16, 22, depth + 5));
    this.shopObjects.push(
      this.host.add
        .text(left + 16, footY + 11, 'Enter 买入 · S 卖出选中的一件 · ESC 离开', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.secondary) })
        .setOrigin(0, 0.5)
        .setDepth(depth + 7),
    );
    // This panel is rebuilt on every open, so it never runs applyPanelDepth -
    // every object it makes has to be locked here or it slides with the camera.
    lockToScreen(this.shopObjects);
  }

  shopBuy(): void {
    const state = getGame();
    const entry = this.shopRows[this.shopSelected];
    if (!entry) return;
    // buy() 自己认材料：商品架没有的物品回落到 materialPrice（当日牌价 +
    // 熟人折扣，夹在收购价+1 的下限上），所以材料行与商品行走同一入口。
    const r = buy(state, entry.itemId, state.currentFloor);
    playSfx(r.ok ? 'chest' : 'pickup');
    this.host.flash(r.ok ? r.message : r.reason);
    // The trade, seen. Gold changing hands was a number in the HUD and a line of
    // text; the coin spins over the counter while the deal is open.
    if (r.ok) {
      const coin = this.host.playFx('coin-spin', state.player.x + 26, PLAYER_FEET_Y - 62, LIGHT_DEPTH);
      if (coin) this.shopObjects.push(coin);
    }
    this.host.refreshInventory();
    this.host.refreshStats();
    this.buildShopPanel();
  }

  shopSell(): void {
    const state = getGame();
    const entry = this.shopRows[this.shopSelected];
    if (!entry) return;
    // 卖方向：材料行走收购价（MATERIAL_SELL_PRICES，全世界固定），商品架走
    // band 半价——选中的是哪行就卖哪行，S 因此同时是两个货架的出口。
    const goldBefore = state.player.gold; // AG-81：金币收入按卖出前后的差额计
    const r = sell(state, entry.itemId, state.currentFloor);
    playSfx(r.ok ? 'chest' : 'pickup');
    this.host.flash(r.ok ? r.message : r.reason);
    if (r.ok) {
      noteGoldEarned(state, goldBefore); // AG-81：卖出进账
      const coin = this.host.playFx('coin-spin', state.player.x + 26, PLAYER_FEET_Y - 62, LIGHT_DEPTH);
      if (coin) this.shopObjects.push(coin);
    }
    this.host.refreshInventory();
    this.host.refreshStats();
    this.buildShopPanel();
  }

  /** 行商光标（场景 onNavUp/onNavDown 的路由委托）：↑ 钳 0、↓ 钳行数-1。 */
  shopMove(delta: number): void {
    if (delta < 0) this.shopSelected = Math.max(0, this.shopSelected - 1);
    else this.shopSelected = Math.min(this.shopRows.length - 1, this.shopSelected + 1);
    this.buildShopPanel();
  }

  // ── AG-20: 产业投资面板（VENTURES / invest / settleInvestments）──────────
  //
  // 三门产业是长期行为：金币沉下去（investedGold），按游戏日结算收益与风险
  // （亏损/倒塌），收益喂 wealth 成长线。面板因此必须回答「我投的怎么了」：
  // 已投入（沉没资本 + 在册名单）、昨日收益、累计——否则玩家投完只能盯着
  // 金币总数猜。
  //
  // 结算发生在时钟内部（SurvivalSystem 的跨日路径），报告不往上传；场景在
  // 每次推进时间的前后对比账本快照得出当日读数（diffVentureLedger）——只
  // 观察，绝不绕过 economy:settled-day 水位标记自己结算。打开面板时再补一
  // 次 settleInvestments：幂等，时钟已结过就是空转，悬挂的结算日在此入账。
  toggleVentures(): void {
    this.ventureOpen = !this.ventureOpen;
    for (const o of this.ventureObjects) o.setVisible(this.ventureOpen);
    if (this.ventureOpen) {
      this.ventureSelected = 0;
      this.buildVenturePanel();
    }
  }

  closeVentures(): void {
    this.ventureOpen = false;
    for (const o of this.ventureObjects) o.setVisible(false);
  }

  /** 投资账本快照：推进时间前后各取一次，差就是当日产业结算的读数。 */
  ventureLedgerSnapshot(): { gold: number; ventures: string[] } {
    const state = getGame();
    return { gold: state.player.gold, ventures: [...(state.growth?.ventures ?? [])] };
  }

  /**
   * 观察一次时间推进后的产业结算。时钟已经在推进内部结过了（水位标记把关），
   * 这里只对比账本：多出来的金币就是当日收益（该窗口内没有第二个动金币的
   * 系统），从在册名单里消失的产业就是倒塌。读数进面板，收益累进 flags 里
   * 的累计账本，并以 flash 告诉玩家——「投了不知道发生什么」到此为止。
   */
  diffVentureLedger(before: { gold: number; ventures: string[] }): void {
    const state = getGame();
    if (before.ventures.length === 0) return; // 没有在册产业，结算必然是 no-op
    const after = state.growth?.ventures ?? [];
    const income = state.player.gold - before.gold;
    if (income > 0) noteGoldEarned(state, before.gold); // AG-81：产业日结进账
    const collapsed = before.ventures.filter((id) => !after.includes(id));
    if (income <= 0 && collapsed.length === 0) return;
    this.recordVentureSettlement(state.day - 1, income, collapsed);
  }

  /**
   * 记一笔结算读数（面板读数 + 累计账本 + 玩家可见的反馈）。
   *
   * flash 延后到夜间事件播报之后：跨日那一帧 ensureNightEvent 也在 flash
   * （今夜的遭遇），两条同时亮只会互相覆盖——玩家先看到今夜有什么，再看到
   * 产业进账。1600ms 是 flash 自身的寿命，1700ms 正好接在后面。
   */
  private recordVentureSettlement(day: number, income: number, collapsed: string[]): void {
    const state = getGame();
    this.lastVentureDay = day;
    this.lastVentureIncome = Math.max(0, income);
    this.lastVentureCollapsed = collapsed;
    if (income > 0) bumpFlag(state, VENTURE_INCOME_FLAG, income);
    const lines: string[] = [];
    if (income > 0) lines.push(`产业结算：第 ${day} 天进账 +${income} 金`);
    for (const id of collapsed) {
      const def = VENTURES.find((v) => v.id === id);
      lines.push(`${def?.displayName ?? id}倒闭了，投入的本金全损`);
    }
    if (lines.length === 0) return;
    this.host.time.delayedCall(VENTURE_FLASH_DELAY_MS, () => {
      for (const line of lines) this.host.flash(line);
    });
  }

  private buildVenturePanel(): void {
    for (const o of this.ventureObjects) {
      if (o !== this.ventureMarker) o.destroy();
    }
    this.ventureObjects = [];
    const state = getGame();
    // 打开即补一次结算：幂等（时钟已结过就是空转），悬挂的结算日在此入账，
    // 面板读到的因此永远是结完账的数字。
    const pending = settleInvestments(state);
    if (pending.totalIncome > 0 || pending.collapsed.length > 0) {
      this.recordVentureSettlement(pending.day, pending.totalIncome, pending.collapsed);
    }
    const { width, height } = this.host.viewSize();
    const panelW = 520;
    const panelH = 268;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    this.host.setPanelBox({ x: left, y: top, w: panelW, h: panelH });
    const depth = PANEL_DEPTH.game.dialogue;

    this.ventureObjects.push(...buildPanel(this.sharedScene, cx, cy, panelW, panelH, 'green', depth));
    this.ventureObjects.push(...buildPanelHeader(this.sharedScene, left, top, panelW, '产业投资', UI.good, depth + 5));
    this.ventureObjects.push(
      this.host.add
        .text(left + panelW - 10, top + 10, `${state.player.gold} 金`, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: hex(PALETTE.lightHigh) })
        .setOrigin(1, 0.5)
        .setDepth(depth + 6),
    );

    // 账本读数：已投入 / 昨日收益 / 累计。投资是长期行为，这三行就是玩家
    // 「投了之后发生什么」的唯一答案，因此放在面板最上面。
    const growth = ensureGrowth(state);
    const owned = growth.ventures
      .map((id) => VENTURES.find((v) => v.id === id))
      .filter((v): v is (typeof VENTURES)[number] => v !== undefined);
    const totalIncome = flagCount(state, VENTURE_INCOME_FLAG);
    this.ventureObjects.push(...buildPanelWell(this.sharedScene, left + 12, top + 28, panelW - 24, 52, depth + 5));
    this.ventureObjects.push(
      this.host.add
        .text(
          left + 24,
          top + 40,
          `已投入 ${growth.investedGold} 金 · 在册 ${owned.length} 门${owned.length ? `：${owned.map((v) => v.displayName).join('、')}` : ''}`,
          { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.primary), wordWrap: { width: panelW - 48 } },
        )
        .setOrigin(0, 0.5)
        .setDepth(depth + 6),
    );
    const lastIncome = this.lastVentureIncome;
    this.ventureObjects.push(
      this.host.add
        .text(
          left + 24,
          top + 64,
          this.lastVentureDay > 0
            ? `昨日收益（第 ${this.lastVentureDay} 天）+${lastIncome} 金 · 累计 +${totalIncome} 金${this.lastVentureCollapsed.length ? ` · 倒闭 ${this.lastVentureCollapsed.length} 门` : ''}`
            : `昨日收益 — · 累计 +${totalIncome} 金`,
          { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(lastIncome > 0 ? PALETTE.lightHigh : TEXT.secondary) },
        )
        .setOrigin(0, 0.5)
        .setDepth(depth + 6),
    );

    // 三门产业：成本 / 日收益率 / 亏损率 / 倒闭率全印在行上——风险行为不能
    // 做成稳赚，概率 therefore 是面板的一等等级。
    const rowsTop = top + 90;
    VENTURES.forEach((def, i) => {
      const y = rowsTop + i * 28;
      const selected = i === this.ventureSelected;
      const inLedger = owned.some((v) => v.id === def.id);
      this.ventureObjects.push(
        ...buildListRow(this.sharedScene, left + 16, y, panelW - 32, depth + 6, {
          label: `${def.displayName}${inLedger ? ' · 在册' : ''}`,
          value: `成本 ${def.cost} · 日 ${Math.round(def.baseRate * 100)}% · 亏 ${Math.round(def.lossChance * 100)}% · 倒 ${Math.round(def.collapseChance * 100)}%`,
          selected,
          dim: inLedger,
        }),
      );
      this.ventureObjects.push(
        this.host.panelHit( left + 16, y, panelW - 32, 26, depth + 8, {
          onOver: () => {
            if (this.ventureSelected === i) return;
            this.ventureSelected = i;
            this.buildVenturePanel();
          },
          onClick: () => {
            if (this.ventureSelected !== i) {
              this.ventureSelected = i;
              this.buildVenturePanel();
              playSfx('click');
              return;
            }
            this.activateVenture();
          },
        }),
      );
    });

    // 选中行的说明与动作：.description 是这门生意的来龙去脉，Enter 的动作
    // 与代价写在同一行——金币不够时说的是差多少，不是沉默。
    const selected = VENTURES[this.ventureSelected];
    if (selected) {
      const inLedger = owned.some((v) => v.id === selected.id);
      const afford = state.player.gold >= selected.cost;
      const action = inLedger ? '已在册 · 按游戏日结算' : afford ? `Enter 入股 ${selected.cost} 金` : `金币不够（需要 ${selected.cost}）`;
      this.ventureObjects.push(
        this.host.add
          .text(left + 18, rowsTop + 3 * 28 + 16, action, {
            fontFamily: FONT_FAMILY,
            fontSize: `${TYPE.caption}px`,
            color: hex(inLedger ? TEXT.dim : afford ? PALETTE.clothHigh : TEXT.warn),
          })
          .setOrigin(0, 0.5)
          .setDepth(depth + 6),
      );
      this.ventureObjects.push(
        this.host.add
          .text(left + 18, rowsTop + 3 * 28 + 38, selected.description, {
            fontFamily: FONT_FAMILY,
            fontSize: `${TYPE.caption}px`,
            color: hex(TEXT.secondary),
            wordWrap: { width: panelW - 36 },
          })
          .setOrigin(0, 0.5)
          .setDepth(depth + 6),
      );
    }

    this.ventureObjects.push(
      this.host.add.text(cx, top + panelH - 14, '↑/↓ 选择 · Enter 入股 · G 离开', {
        fontFamily: FONT_FAMILY,
        fontSize: `${TYPE.caption}px`,
        color: hex(PALETTE.clothHigh),
      }).setOrigin(0.5).setDepth(depth + 6),
    );
    this.ventureObjects.push(this.ventureMarker);
    applyPanelDepth(this.ventureObjects, PANEL_DEPTH.game.dialogue);
    lockToScreen(this.ventureObjects);
    this.host.assertPanelContent('venture', this.ventureObjects);
  }

  activateVenture(): void {
    const state = getGame();
    const def = VENTURES[this.ventureSelected];
    if (!def) return;
    // invest() 原子：被拒时金币、账本、经验一律不动，reason 原样给玩家看。
    const r = invest(state, def.id);
    playSfx(r.ok ? 'chest' : 'pickup');
    this.host.flash(r.ok ? r.message : r.reason);
    if (r.ok) this.host.refreshStats();
    this.buildVenturePanel();
  }

  /** 产业光标（场景 onNavUp/onNavDown 的路由委托）：↑ 钳 0、↓ 钳 VENTURES-1。 */
  ventureMove(delta: number): void {
    if (delta < 0) this.ventureSelected = Math.max(0, this.ventureSelected - 1);
    else this.ventureSelected = Math.min(VENTURES.length - 1, this.ventureSelected + 1);
    this.buildVenturePanel();
  }

  // ── NPCs & dialogue（面板侧；世界渲染与距离判定留场景） ───────────────────
  // AG-11: 居民按自己的日程移动（npcAutonomyFor：位置是
  // (npcId, day, minuteOfDay, runSeed) 的纯函数）——摆位在场景的
  // drawNpcs/syncNpcs/nearestNpc，这里只管面板：对话树、交易层、赠礼层。

  /** create 的一次性装配（原 buildDialoguePanel；场景重启 reset 后由 create 再建）。 */
  build(): void {
    const { width, height } = this.host.viewSize();
    // A scene restart keeps the display list, so the previous run's row hit
    // rects would otherwise be pushed into again and re-placed by index.
    this.dialogueRowHits = [];
    // Geometry lives in render/dialogueLayout: the portrait column, the gap the
    // text must keep from it, and the wrap width all have to agree, and they did
    // not (the text started 84px inside the 96px face). dialogueLayout.test.ts
    // holds the numbers against the real dialogue strings.
    const panelW = DIALOG_PANEL_W;
    const panelH = DIALOG_PANEL_H;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    // Remembered for the mouse: a click outside this rectangle closes the panel.
    this.host.setPanelBox({ x: left, y: top, w: panelW, h: panelH });

    const depth = PANEL_DEPTH.game.dialogue;
    // The skin is captured, not just pushed: refresh() re-places these
    // parts when a long AI opening line grows the panel (dialogueGeometry).
    this.dialoguePanelParts = buildPanel(this.sharedScene, cx, cy, panelW, panelH, 'dialogue', depth);
    this.dialogueObjects.push(...this.dialoguePanelParts);
    // OVERHAUL UI: the same header strip every other panel uses, with the NPC's
    // name on it, and the message in an inset well so speech reads as speech
    // rather than as more body text.
    // Empty header title on purpose: the NPC's name is the header, and drawing a
    // static '对话' underneath it printed the two on top of each other.
    // The strip is captured like the skin: the panel grows around it, so the
    // strip has to move with the panel's top edge or it detaches from the frame.
    this.dialogueHeaderParts = buildPanelHeader(this.sharedScene, left, top, panelW, '', UI.good, depth + 5);
    this.dialogueObjects.push(...this.dialogueHeaderParts);
    // Create with placeholder content so each text's canvas/frame exists up front
    // (setText on a never-rendered empty text throws in Phaser 4).
    this.dialogueTitle = this.host.add
      .text(left + 10, top + 10, '对话', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.title}px`, color: hex(TEXT.primary) })
      .setOrigin(0, 0.5)
      .setDepth(depth + 6);
    // Left: the speaker's face, on a dark inset so it does not float on the
    // panel's own texture. Drawn at its native 96x96 — scaling a bust down is
    // what makes pixel art look like a photo.
    const portraitLeft = left + DIALOG_PADDING;
    this.dialoguePortraitFrame = this.host.add
      .rectangle(portraitLeft, top + DIALOG_PORTRAIT_TOP, DIALOG_PORTRAIT_SIZE, DIALOG_PORTRAIT_SIZE, PALETTE.ink)
      .setOrigin(0, 0)
      .setAlpha(0.85)
      .setDepth(depth + 5);
    this.dialoguePortrait = this.host.add
      .image(portraitLeft + DIALOG_PORTRAIT_SIZE / 2, top + DIALOG_PORTRAIT_TOP + DIALOG_PORTRAIT_SIZE / 2, portraitKey('npc_alin'))
      .setDepth(depth + 6);
    this.dialogueObjects.push(this.dialoguePortraitFrame, this.dialoguePortrait);
    // The speech well starts a full DIALOG_TEXT_GAP right of the face and ends
    // DIALOG_TEXT_RIGHT_PAD left of the panel edge. Built at the base two-line
    // height; refresh() resizes it per message from dialogueGeometry().
    const wellParts = buildPanelWell(this.sharedScene, left + DIALOG_WELL_LEFT, top + DIALOG_WELL_TOP, DIALOG_WELL_W, DIALOG_WELL_H, depth + 5);
    this.dialogueWellFill = wellParts[0] as Phaser.GameObjects.Rectangle;
    this.dialogueWellEdge = wellParts[1] as Phaser.GameObjects.Graphics;
    this.dialogueObjects.push(...wellParts);
    // dialogueTitle MUST be in the list: close() hides everything in it,
    // and a name left out of the list stays on screen after the panel closes.
    this.dialogueObjects.push(this.dialogueTitle);
    // Left-aligned and vertically centred in the well. Centred text looked tidy
    // on a one-line greeting but threw a wrapped line out to both sides, which
    // is how it ended up on the portrait and past the frame.
    this.dialogueMessage = this.host.add
      .text(left + DIALOG_TEXT_LEFT, top + DIALOG_WELL_TOP + DIALOG_WELL_H / 2, '……', {
        fontFamily: FONT_FAMILY,
        fontSize: `${TYPE.body}px`,
        color: hex(TEXT.primary),
        align: 'left',
        // useAdvancedWrap is load-bearing: the basic wrapper only breaks on
        // spaces, and Chinese has none, so the width was ignored entirely and
        // the line ran straight through the portrait.
        wordWrap: { width: DIALOG_TEXT_W, useAdvancedWrap: true },
      })
      .setOrigin(0, 0.5)
      .setDepth(depth + 7);
    this.dialogueObjects.push(this.dialogueMessage);

    this.dialogueBands = [];
    for (let i = 0; i < DIALOG_ROW_COUNT; i++) {
      const rowY = top + DIALOG_ROWS_TOP + i * DIALOG_ROW_PITCH;
      // A selection band per row, the same language as every other list: a wash
      // plus a 2px accent rule. Toggled in refresh().
      const band = this.host.add.rectangle(left + DIALOG_PADDING, rowY, panelW - DIALOG_PADDING * 2, DIALOG_ROW_H, UI.accent).setOrigin(0, 0).setAlpha(0).setDepth(depth + 5);
      const rule = this.host.add.rectangle(left + DIALOG_PADDING, rowY, 2, DIALOG_ROW_H, UI.accent).setOrigin(0, 0).setAlpha(0).setDepth(depth + 6);
      this.dialogueBands.push({ band, rule });
      this.dialogueObjects.push(band, rule);
      // Mouse: hover moves the cursor, click confirms — guarded on the option
      // count because the row list is shorter than the four bands in trade mode.
      // Kept in dialogueRowHits so refresh() can move it with the band.
      const rowHit = this.host.panelHit(left + DIALOG_PADDING, rowY, panelW - DIALOG_PADDING * 2, DIALOG_ROW_H, depth + 8, {
        onOver: () => {
          if (!this.dialog) return;
          // 先取视图（它顺带算出窗口平移），再把视图行号换算回扁平下标。
          if (i >= this.optionsView().length) return;
          const flat = this.viewOffset + i;
          if (this.dialog.selected === flat) return;
          this.dialog.selected = flat;
          this.refresh();
        },
        onClick: () => {
          if (!this.dialog || i >= this.optionsView().length) return;
          this.dialog.selected = this.viewOffset + i;
          this.refresh();
          this.host.onUse();
        },
      });
      this.dialogueRowHits.push(rowHit);
      this.dialogueObjects.push(rowHit);
      const icon = this.host.add.image(left + 30, rowY + DIALOG_ROW_H / 2, 'blank').setOrigin(0.5).setDepth(depth + 7);
      const t = this.host.add
        .text(left + 46, rowY + DIALOG_ROW_H / 2, '……', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: hex(TEXT.primary) })
        .setOrigin(0, 0.5)
        .setDepth(depth + 7);
      this.dialogueOptionIcons.push(icon);
      this.dialogueOptions.push(t);
      this.dialogueObjects.push(icon, t);
    }
    const footer = this.host.add
      .text(cx, top + panelH - 12, '↑/↓ 选择 · Enter 确定 · ESC 返回', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(PALETTE.clothHigh) })
      .setOrigin(0.5)
      .setDepth(depth + 7);
    this.dialogueFooter = footer;
    this.dialogueObjects.push(footer, this.dialogueMarker);

    applyPanelDepth(this.dialogueObjects, PANEL_DEPTH.game.dialogue);
    this.host.assertPanelContent('dialogue', this.dialogueObjects);
    for (const o of this.dialogueObjects) o.setVisible(false);
  }

  /**
   * 场景重启的「先毁后建」重置（原 GameScene create 重置段）：字段初始化器
   * 不重跑，上一局的对话件/产业件/标记不清就会双份上屏、stale Text 一
   * setText 就抛。对话开关与进行中的对话随重启清空（原 dialogueOpen=false +
   * dialogue=null 两行）；行商面板在重启时不可能开着（重启只从暂停菜单进，
   * 暂停与行商互斥），shopRows/shopObjects 因此不动——与原逐字段语义一致。
   *
   * ventureOpen 补一刀清 false：原场景没清它（AG-20 加入时的遗漏——重启只
   * 从暂停菜单进、而 ESC 会先关产业面板，所以旧代码里它恒为 false，清不清
   * 不可观察）。重置段自己的注释说的是「Left set, update() early-returns
   * forever」——真被留着才是事故，因此这里按同款纪律清掉，可达行为不变。
   */
  reset(): void {
    this.dialogueObjects = [];
    this.dialogueOptions = [];
    this.dialogueOptionIcons = [];
    this.dialogueMarker = this.host.createMarker();
    this.ventureObjects = [];
    this.ventureMarker = this.host.createMarker();
    this.dialogOpen = false;
    this.dialog = null;
    this.ventureOpen = false;
  }

  // Label + icon key per dialogue option. The icon is the item the player
  // RECEIVES (the trade's output), matching how the crafting list shows outputs;
  // 问候/询问/退出/返回 are not items and get no icon.
  //
  // AG-11: the trade list reads availableOffers, not the static npc.offers —
  // 信誉修正（trusted 双倍货 / disliked 双倍价）与真实库存过滤（没货下架、
  // hostile 整体清空）都发生在系统侧，场景展示的就是此刻真正成交得了的报价。
  // 静态表会让玩家看见一件 NPC 库存里没有的货，按了 Enter 才被拒绝。
  private dialogueOffers(npc: NpcDef): BarterOffer[] {
    const state = getGame();
    const { npcState, inventory } = syncNpcInventory(state, npc);
    return availableOffers(inventory, npc, reputationOf(npcState));
  }

  /**
   * AG-20: 交易层「赠礼」行的下标；摆不下（报价超过两行的 NPC）时为 -1。
   * 对话只有四行：报价 ×N + 赠礼 + 返回必须放得下，赠礼行因此是可选的。
   */
  private dialogueGiftRowIndex(npc: NpcDef): number {
    return this.dialogueOffers(npc).length <= 2 ? this.dialogueOffers(npc).length : -1;
  }

  /**
   * AG-20: 赠礼层的扁平选项表——「领取回赠」（npcEconomy.giftOffer 判得有
   * 可送时才摆，与交易层「只展示成交得了的报价」同一条纪律）+ 背包里每一格
   * 一件（整叠送出，一次 receiveGift 一笔记忆，不给「一件一件刷关系」留缝）。
   */
  private dialogueGiftEntries(): Array<{ kind: 'claim'; itemId: ItemId } | { kind: 'item'; itemId: ItemId; quantity: number }> {
    const state = getGame();
    const d = this.dialog;
    if (!d) return [];
    const npc = getNpc(d.npc);
    const { npcState, inventory } = syncNpcInventory(state, npc);
    const gift = giftOffer(npc, inventory, reputationOf(npcState));
    const items = state.player.inventory.slots.map((s) => ({ kind: 'item' as const, itemId: s.itemId, quantity: s.quantity }));
    return [...(gift ? [{ kind: 'claim' as const, itemId: gift.itemId }] : []), ...items];
  }

  private optionsView(): Array<{ label: string; icon?: ItemId }> {
    const d = this.dialog;
    if (!d) return [];
    if (d.level === 'main') {
      this.viewOffset = 0;
      return ['问候', '询问', '交易', '退出'].map((label) => ({ label }));
    }
    const npc = getNpc(d.npc);
    if (d.level === 'gift') {
      // 窗口化：视图第 0 行对应扁平下标 viewOffset，随光标滑动。
      const flat = this.dialogueGiftEntries();
      this.viewOffset = Math.max(0, Math.min(d.selected - 1, flat.length - DIALOG_ROW_COUNT));
      return flat.slice(this.viewOffset, this.viewOffset + DIALOG_ROW_COUNT).map((e) =>
        e.kind === 'claim'
          ? { label: `领取回赠：${getItem(e.itemId).displayName}`, icon: e.itemId }
          : { label: `送出 ${getItem(e.itemId).displayName}×${e.quantity}`, icon: e.itemId },
      );
    }
    const rows: Array<{ label: string; icon?: ItemId }> = this.dialogueOffers(npc).map((o) => ({
      label: `用 ${getItem(o.get.itemId).displayName}×${o.get.quantity} 换 ${getItem(o.give.itemId).displayName}×${o.give.quantity}`,
      icon: o.give.itemId,
    }));
    const giftRow = this.dialogueGiftRowIndex(npc);
    if (giftRow >= 0) rows.push({ label: '赠礼' });
    rows.push({ label: '返回' });
    this.viewOffset = 0;
    return rows;
  }

  /** 选项的扁平总数（导航钳制用）：赠礼层是整张表，不是可见的那四行。 */
  private optionsCount(): number {
    const d = this.dialog;
    if (!d) return 0;
    if (d.level === 'gift') return this.dialogueGiftEntries().length;
    return this.optionsView().length;
  }

  // ── AI NPC（feat/ai-npc-spark-integration，默认关闭）─────────────────────
  // 接线原则：AI 只影响「开场白」这一句话与事后的记忆积累；菜单结构、
  // 交易执行、数值规则全部走原有路径。未配置模型时以下方法全部空转。

  private getAiRuntime(npc: NpcDef): NpcRuntimeConfig | null {
    const cfg = aiNpcConfig();
    if (!cfg.enabled) return null;
    let runtime = this.aiRuntimes.get(npc.id);
    if (!runtime) {
      runtime = {
        brain: new OllamaBrain({ baseUrl: cfg.baseUrl, model: cfg.model, timeoutMs: cfg.timeoutMs }),
        // 降级脑给该 NPC 自己的第一句问候——Spark 不可达时玩家看到的就是
        // 改造前那一句，这是护栏 2 的场景侧落地。
        fallback: new OptionTreeBrain(npc.greetings[0]),
        timeoutMs: cfg.timeoutMs,
        memoryRecallK: cfg.recallK,
        // 第一阶段只接通 dialogue 的执行路径：模型提议交易/赠送等其他行动
        // 一律被运行时拒绝并降级，不会出现「说了但没做」或「没说要了」的错位。
        allowedActions: ['dialogue'],
      };
      this.aiRuntimes.set(npc.id, runtime);
    }
    return runtime;
  }

  private npcStateFor(npc: NpcDef): NpcPersistedState {
    return loadNpcState(getGame(), npc.id) ?? createNpcState(archetypeForNpcId(npc.id));
  }

  /** 当前对话的保鲜键；没有打开的对话时为 null。 */
  private currentDialogueSession(): DialogueSession | null {
    if (!this.dialogOpen || !this.dialog) return null;
    return { sessionId: this.dialog.sessionId, revision: this.dialog.revision };
  }

  /** 异步取一句人格化开场白。取到前画面显示原句，与改造前无差异。 */
  private async enhanceOpeningLine(npc: NpcDef): Promise<void> {
    const runtime = this.getAiRuntime(npc);
    if (!runtime) return;
    // 请求发出前记住这场对话的保鲜键；45s 后返回时用它判断结果是否过期
    const captured = this.currentDialogueSession();
    if (!captured) return;
    try {
      // AG-11: npcFactFor 把 npcStates 里已按天结算的真实库存喂给规则执行器
      // （阶段 C）——模型看到的才是「NPC 现在真的有什么」。静态报价表推导
      // （npcFactFromDef）会让执行器放行一笔 NPC 库存里根本没有的交易。
      const decision = await decideNpcAction(getGame(), npcFactFor(getGame(), npc), this.npcStateFor(npc), runtime);
      if (!decision.validated.ok) return;
      const { action, utterance } = decision.validated;
      // 第一阶段只落地对话文本；其他行动类型在第一阶段就被 availableActions 挡掉
      const line = utterance ?? (action.type === 'dialogue' ? action.text : '');
      // 保鲜检查：玩家可能已关闭对话、重开、或翻过选项——过期结果一律丢弃，
      // 不能覆盖玩家眼前的这场新对话（P1-2）。
      if (line && isDialogueFresh(this.currentDialogueSession(), captured)) {
        this.dialog!.message = line;
        this.dialog!.revision += 1; // AI 换行本身也是一次修订，防止两次返回互相覆盖
        this.refresh();
      }
    } catch {
      // AI 层任何意外都不能把对话搞坏：保持原句即为正确行为
    }
  }

  /** 打开与某位居民的对话（入口留场景：onInteract 的 nearestNpc 判定之后调）。 */
  open(npc: NpcDef): void {
    this.sessionSeq += 1;
    // AG-77：全 NPC 对话（每位只认第一次开口）。
    this.host.emitNpcTalked(npc.id);
    this.dialog = {
      npc: npc.id,
      level: 'main',
      selected: 0,
      message: npc.greetings[0],
      lineToggle: 0,
      sessionId: this.sessionSeq,
      revision: 0,
    };
    this.dialogOpen = true;
    for (const o of this.dialogueObjects) o.setVisible(true);
    this.refresh();
    void this.enhanceOpeningLine(npc);
  }

  close(): void {
    this.dialogOpen = false;
    this.dialog = null;
    for (const o of this.dialogueObjects) o.setVisible(false);
  }

  back(): void {
    if (!this.dialog) return;
    this.dialog.revision += 1; // 玩家操作使在途 AI 结果过期
    if (this.dialog.level === 'gift') {
      this.dialog.level = 'trade';
      this.dialog.selected = 0;
      this.dialog.message = '想换点什么？';
      this.refresh();
    } else if (this.dialog.level === 'trade') {
      this.dialog.level = 'main';
      this.dialog.selected = 0;
      this.dialog.message = '';
      this.refresh();
    } else {
      this.close();
    }
  }

  private refresh(): void {
    const d = this.dialog;
    if (!d) return;
    const npc = getNpc(d.npc);
    this.dialogueTitle.setText(`${npc.name}（${npc.title}）`);
    // NpcId is 'alin'|'xiaozhou'; portrait files are keyed by CharacterKey, so
    // the prefix is the only translation needed.
    this.dialoguePortrait.setTexture(portraitKey(`npc_${d.npc}` as CharacterKey));
    this.dialogueMessage.setText(d.message || '……');

    // ── adaptive layout ────────────────────────────────────────────────────
    // The well's height, the rows under it and the panel around both are
    // computed from the message's wrapped line count (dialogueGeometry), so an
    // AI opening line of up to 60 characters — five lines at this width — grows
    // the panel instead of printing over the option rows. Re-place only: the
    // objects were built once in build() at the base geometry, and
    // destroying them per keystroke is what made the dialogue flicker.
    const geo = dialogueGeometry(d.message || '……', TYPE.body);
    const { width, height } = this.host.viewSize();
    const cx = width / 2;
    const left = cx - DIALOG_PANEL_W / 2;
    const top = height / 2 - geo.panelH / 2;
    // The header strip rides the panel's top edge: strip, accent rule, (empty)
    // title and hairline, in buildPanelHeader's return order. The hairline is a
    // Graphics, so it is cleared and re-drawn rather than moved.
    const [hStrip, hAccent, hTitle, hLine] = this.dialogueHeaderParts as [
      Phaser.GameObjects.Rectangle,
      Phaser.GameObjects.Rectangle,
      Phaser.GameObjects.Text,
      Phaser.GameObjects.Graphics,
    ];
    hStrip.setPosition(left, top).setSize(DIALOG_PANEL_W, PANEL_HEADER_H);
    hAccent.setPosition(left, top);
    hTitle.setPosition(left + 10, top + PANEL_HEADER_H / 2);
    hLine.clear();
    drawLine(hLine, left + 2, top + PANEL_HEADER_H - 1, DIALOG_PANEL_W - 2, UI.good, 0.7);
    // The skin: five stepped fill bands then eight frame pieces (corners first,
    // then top/bottom/left/right edges), in buildPanel's return order.
    const bandH = geo.panelH / PANEL_FILL_BANDS;
    this.dialoguePanelParts.slice(0, PANEL_FILL_BANDS).forEach((part, i) => {
      const band = part as Phaser.GameObjects.Rectangle;
      band.setPosition(cx, top + bandH * (i + 0.5));
      band.setSize(DIALOG_PANEL_W, bandH + 1);
    });
    const frame = this.dialoguePanelParts.slice(PANEL_FILL_BANDS, PANEL_FILL_BANDS + PANEL_FRAME_PIECES) as Phaser.GameObjects.Image[];
    const [fTL, fTR, fBL, fBR, fTop, fBottom, fLeft, fRight] = frame;
    const right = left + DIALOG_PANEL_W;
    const bottom = top + geo.panelH;
    fTL.setPosition(left, top);
    fTR.setPosition(right - PANEL_SLICE, top);
    fBL.setPosition(left, bottom - PANEL_SLICE);
    fBR.setPosition(right - PANEL_SLICE, bottom - PANEL_SLICE);
    fTop.setPosition(left + PANEL_SLICE, top).setDisplaySize(DIALOG_PANEL_W - PANEL_SLICE * 2, PANEL_SLICE);
    fBottom.setPosition(left + PANEL_SLICE, bottom - PANEL_SLICE).setDisplaySize(DIALOG_PANEL_W - PANEL_SLICE * 2, PANEL_SLICE);
    fLeft.setPosition(left, top + PANEL_SLICE).setDisplaySize(PANEL_SLICE, geo.panelH - PANEL_SLICE * 2);
    fRight.setPosition(right - PANEL_SLICE, top + PANEL_SLICE).setDisplaySize(PANEL_SLICE, geo.panelH - PANEL_SLICE * 2);
    // The header title and the bust ride the panel's top edge.
    this.dialogueTitle.setPosition(left + 10, top + 10);
    this.dialoguePortraitFrame.setPosition(left + DIALOG_PADDING, top + DIALOG_PORTRAIT_TOP);
    this.dialoguePortrait.setPosition(left + DIALOG_PADDING + DIALOG_PORTRAIT_SIZE / 2, top + DIALOG_PORTRAIT_TOP + DIALOG_PORTRAIT_SIZE / 2);
    // The well grows; its stroke is redrawn around the new box.
    const wellLeft = left + DIALOG_WELL_LEFT;
    const wellTop = top + DIALOG_WELL_TOP;
    this.dialogueWellFill.setPosition(wellLeft, wellTop).setSize(DIALOG_WELL_W, geo.wellH);
    this.dialogueWellEdge.clear();
    this.dialogueWellEdge.lineStyle(1, UI.line, 0.5);
    this.dialogueWellEdge.strokeRect(Math.round(wellLeft) + 0.5, Math.round(wellTop) + 0.5, DIALOG_WELL_W - 1, geo.wellH - 1);
    // The message stays centred in the (possibly taller) well.
    this.dialogueMessage.setPosition(left + DIALOG_TEXT_LEFT, wellTop + geo.wellH / 2);
    // The four rows and the footer shift with the geometry.
    for (let i = 0; i < this.dialogueBands.length; i++) {
      const rowY = top + geo.rowsTop + i * DIALOG_ROW_PITCH;
      const b = this.dialogueBands[i];
      b.band.setPosition(left + DIALOG_PADDING, rowY);
      b.rule.setPosition(left + DIALOG_PADDING, rowY);
      // The mouse targets move with their row. Left at the base y they accept
      // the click meant for the row above as soon as a five-line AI message
      // pushes rowsTop down (measured: hover landed 3px off, click one row low).
      this.dialogueRowHits[i]?.setPosition(left + DIALOG_PADDING, rowY);
      this.dialogueOptionIcons[i].setPosition(left + 30, rowY + DIALOG_ROW_H / 2);
      this.dialogueOptions[i].setPosition(left + 46, rowY + DIALOG_ROW_H / 2);
    }
    this.dialogueFooter.setPosition(cx, bottom - 12);
    // The click-outside box follows the panel's grown height; otherwise the
    // header and footer of a tall panel count as "outside" and close it.
    this.host.setPanelBox({ x: left, y: top, w: DIALOG_PANEL_W, h: geo.panelH });

    const options = this.optionsView();
    // 钳制对扁平总数，不是对可见行——赠礼层的表比四行长，光标可以停在
    // 窗口外（由 viewOffset 滑进来）。
    const count = this.optionsCount();
    if (d.selected >= count) d.selected = Math.max(0, count - 1);
    // 光标所在的行 = 扁平下标 − 窗口平移（主菜单/交易层平移为 0，语义不变）。
    const cursorRow = d.selected - this.viewOffset;
    for (let i = 0; i < this.dialogueOptions.length; i++) {
      const option = options[i];
      const icon = this.dialogueOptionIcons[i];
      if (option === undefined) {
        this.dialogueOptions[i].setText('');
        icon.setVisible(false);
        continue;
      }
      this.dialogueOptions[i].setText(option.label);
      if (option.icon) icon.setTexture(itemIconKey(option.icon)).setVisible(true);
      else icon.setVisible(false);
      const selected = i === cursorRow;
      this.dialogueOptions[i].setColor(selected ? hex(PALETTE.lightHigh) : hex(TEXT.primary));
      const b = this.dialogueBands[i];
      if (b) {
        b.band.setAlpha(selected ? 0.14 : 0);
        b.rule.setAlpha(selected ? 1 : 0);
      }
    }
    const selectedIcon = this.dialogueOptionIcons[cursorRow];
    this.dialogueMarker.setVisible(options[cursorRow] !== undefined);
    if (options[cursorRow] && selectedIcon) placeMarkerLeftOf(this.dialogueMarker, selectedIcon);
  }

  /** 对话光标（场景 onNavUp/onNavDown 的路由委托）：↑ 钳 0、↓ 钳扁平总数-1。 */
  move(delta: number): void {
    const d = this.dialog;
    if (!d) return;
    if (delta < 0) d.selected = Math.max(0, d.selected - 1);
    else d.selected = Math.min(Math.max(0, this.optionsCount() - 1), d.selected + 1);
    this.refresh();
  }

  activate(): void {
    const d = this.dialog;
    if (!d) return;
    d.revision += 1; // 玩家操作使在途 AI 结果过期
    const npc = getNpc(d.npc);
    if (d.level === 'main') {
      switch (d.selected) {
        case 0:
          d.message = npc.greetings[d.lineToggle % npc.greetings.length];
          d.lineToggle++;
          break;
        case 1:
          d.message = npc.asks[d.lineToggle % npc.asks.length];
          d.lineToggle++;
          break;
        case 2:
          d.level = 'trade';
          d.selected = 0;
          d.message = '想换点什么？';
          break;
        default:
          this.close();
          return;
      }
    } else if (d.level === 'gift') {
      // AG-20: 赠礼层。两条通路都接 npcEconomy 的闭环函数：领取回赠走
      // claimGift（装不下整体失败，回执「背包空间不足」），送出走
      // receiveGift（整叠送出，先校验后扣除）。失败 reason 一律显示，
      // 不静默——玩家按了 Enter 就得知道发生了什么。
      const entries = this.dialogueGiftEntries();
      const entry = entries[d.selected];
      const state = getGame();
      if (!entry) {
        d.level = 'trade';
        d.selected = 0;
        d.message = '背包是空的，没什么可送。';
      } else if (entry.kind === 'claim') {
        const r = claimGift(state, npc);
        if (r.ok) {
          saveToStorage(state);
          this.host.refreshInventory();
          playSfx('chest');
          d.message = `收下 ${getItem(r.itemId).displayName}×${r.quantity}（-${ACTION_COSTS.trade} 分钟）`;
          this.host.chargeTime(ACTION_COSTS.trade);
        } else {
          playSfx('pickup');
          d.message = r.reason;
        }
      } else {
        const r = receiveGift(state, npc, entry.itemId, entry.quantity);
        if (r.ok) {
          saveToStorage(state);
          this.host.refreshInventory();
          playSfx('trade');
          d.message = `送出 ${getItem(entry.itemId).displayName}×${entry.quantity}（-${ACTION_COSTS.trade} 分钟）`;
          this.host.chargeTime(ACTION_COSTS.trade);
        } else {
          playSfx('pickup');
          d.message = r.reason ?? '赠礼没成';
        }
      }
    } else {
      const offers = this.dialogueOffers(npc);
      const giftRow = this.dialogueGiftRowIndex(npc);
      if (d.selected < offers.length) {
        // AG-11: 交易执行走 npcEconomy.executeBarter——它一次做完校验（信誉+
        // 库存过滤后的报价）、原子交易、扣 NPC 库存、记一条 trade 记忆并写回
        // npcStates。场景原来自己调 trade() + recordNpcTrade：记忆会记两条、
        // NPC 库存永不消耗（同样的货能无限次换），信誉分级也从未生效。
        const offer = offers[d.selected];
        const result = executeBarter(getGame(), npc, offer.id);
        d.message = result.ok
          ? `换到了 ${getItem(offer.give.itemId).displayName}×${offer.give.quantity}`
          : (result.reason ?? '交易没成');
        if (result.ok) {
          saveToStorage(getGame());
          this.host.refreshInventory();
          playSfx('trade');
          d.message = `换到了 ${getItem(offer.give.itemId).displayName}×${offer.give.quantity}（-${ACTION_COSTS.trade} 分钟）`;
          this.host.chargeTime(ACTION_COSTS.trade);
        }
      } else if (d.selected === giftRow) {
        // AG-20: 进赠礼层——「伸手不打笑脸人」，礼尚往来也是交道的一部分。
        d.level = 'gift';
        d.selected = 0;
        d.message = '想送点什么？';
      } else {
        d.level = 'main';
        d.selected = 0;
        d.message = '';
      }
    }
    this.refresh();
  }
}
