// AG-67：右下角角色卡 + 处境自言自语 ticker——RC-03 拆分第 2 步。
// 从 GameScene 迁出（原 GameScene.ts 5378-5668 段 + 1071-1099 字段组 +
// buildHud 的重置块与定时器注册），行为零变更：同一构造路径、同一 seeded
// 选句（monologueRng 派生，禁 Math.random）、同一门控（9s 全局间隔 + 45s
// 单句冷却，chooseMonologue）、同一气泡寿命与几何。
//
// 形态（设计文档 §2，沿用第 1 步 StatsPanelController 的主机结构面模式）：
// plain TS 类，**不 import Phaser 场景类型**——
//   * 构造拿 host（MonologueHost：add 工厂/tweens/time/metaSelectedCharacter/
//     anyPanelOpen——GameScene 天然满足）与状态卡行规格 STAT_BARS（与 HUD
//     圆环同源的数据，GameScene 保留一份给圆环，这里注入；直接 import 会成
//     环依赖）。
//   * import 链（hudSkin/uiKit/palette/hudLayout/walkcycle/metaProgress/
//     config/session/constants/SurvivalSystem/data/monologue）均无 Phaser
//     值导入——Node 下可用记录型假件单测（src/tests/monologueController.test.ts）。
//   * 共享渲染件（drawHudPlate/drawStatBar/drawLine）不涉场景类型参数，
//     直接 import 即可，无需第 1 步那处 SharedPanelScene 收窄。
//
// 两条不变量（迁移中逐字保留）：
//   · WATCHING 无条件——每个 tick 都更新前值记忆，面板开着时发生的阈值穿越
//     不丢；SPEAING 双重门控——全局间隔 + 单句冷却在 data/monologue.ts，
//     且只在无面板时飘泡，永不在模态背后说话。
//   · 选句随机由 (runSeed, day, floor, trigger, 已飘字数) 派生（硬规则：
//     世界生成与事件判定禁 Math.random）——同 seed 同场景重放选同一句。

import type Phaser from 'phaser';
import { drawHudPlate } from '../../render/hudSkin';
import { drawLine, drawStatBar, FONT_FAMILY, STAT_COLORS, TYPE, UI } from '../../render/uiKit';
import { PALETTE, TEXT, hex } from '../../render/palette';
import { HUD_LAYOUT } from '../../render/hudLayout';
import { FRAME_H, FRAME_W, walkSheetKey } from '../../render/walkcycle';
import { CHARACTER_NAMES } from '../../systems/metaProgress';
import { GAME_CONFIG } from '../../core/config';
import { getGame, hasGame } from '../../core/session';
import { PLAYER_FEET_Y } from '../../core/constants';
import { isNight } from '../../systems/SurvivalSystem';
import {
  MONOLOGUE_TRIGGER_PRIORITY,
  STATUS_PANEL_BALANCE,
  chooseMonologue,
  crossedBelow,
  freshMonologueMemory,
  isGoodLoot,
  monologueRng,
  monologueVoiceFor,
  statusSummaryLine,
  type MonologueMemory,
  type MonologueTrigger,
} from '../../data/monologue';
import type { CharacterKey } from '../../render/artpack';
import type { GameState } from '../../core/gameTypes';

/** 状态卡一行读数的规格（GameScene 的 STAT_BARS 注入；label/key 与圆环同源）。 */
export interface StatusBarSpec {
  key: 'hp' | 'hunger' | 'thirst' | 'energy';
  label: string;
}

/**
 * 控制器需要场景提供的最小面（GameScene 天然满足；单测用假件实现）。
 * 刻意不 import Phaser.Scene——可测性靠这层结构面，不靠能造真场景。
 */
export interface MonologueHost {
  /** Phaser 的 GameObject 工厂——角色卡件与飘字气泡都从它出生。 */
  add: Phaser.GameObjects.GameObjectFactory;
  /** Tween 管理器——气泡的淡入淡出。 */
  tweens: Phaser.Tweens.TweenManager;
  /** 场景时钟——tick 读 now、气泡寿命走 delayedCall。 */
  time: Phaser.Time.Clock;
  /** meta 选中的角色（场景同款实现：陈旧选择回退 player）。 */
  metaSelectedCharacter(): CharacterKey;
  /** 任何面板开着时为真——气泡不在模态背后说话。 */
  anyPanelOpen(): boolean;
}

export class MonologueController {
  // ── 角色卡（build 时建一次；buildHud 的重置块先毁后建） ──────────────────
  private cardParts: Phaser.GameObjects.GameObject[] = [];
  private cardBars?: Phaser.GameObjects.Graphics;
  private cardAvatar?: Phaser.GameObjects.Image;
  private cardAvatarWho: CharacterKey | null = null;
  private cardNameText?: Phaser.GameObjects.Text;
  private cardValueTexts: Phaser.GameObjects.Text[] = [];
  private cardSummaryText?: Phaser.GameObjects.Text;
  private cardKey = '';
  // ── 自言自语 ticker ─────────────────────────────────────────────────────
  // 循环 TimerEvent 而不是每帧调用：门控是时间型的，tick 就是闸门所需的
  // 分辨率（250ms），帧钩子会是四倍无功工作量——且 Phaser 的 Clock 在场景
  // 关闭时自己清掉它。
  private timer?: Phaser.Time.TimerEvent;
  private memory: MonologueMemory = freshMonologueMemory();
  /** 上一 tick 的归一化比值，供阈值穿越判定（null = 首个 tick）。 */
  private ratios: Record<'hp' | 'hunger' | 'thirst' | 'energy', number> | null = null;
  private night: boolean | null = null;
  private floor: number | null = null;
  private inv: Map<string, number> | null = null;
  /** 战斗期间见过的最低怪物 hp；无战斗时为 null。 */
  private combatHp: number | null = null;
  private pending: MonologueTrigger[] = [];
  private bubble?: Phaser.GameObjects.Text;
  /** 本场景已飘几句；e2e 数「说没说话」，不数像素。 */
  private spoken = 0;

  constructor(
    private readonly host: MonologueHost,
    private readonly statBars: readonly StatusBarSpec[],
  ) {}

  /** 已飘句数（ag67-status e2e 的读数面）。 */
  get spokenCount(): number {
    return this.spoken;
  }

  /**
   * buildHud 的「先毁后建」重置：场景重启保 display list 且字段初始化器不重跑，
   * 上一局的卡件/气泡/定时器不清就会双份上屏、stale Text 一 setText 就抛。
   * 定时器再 remove 一次是无害的（Clock.shutdown 已清过）——保持字段诚实。
   */
  reset(): void {
    for (const o of this.cardParts) o.destroy();
    this.cardParts = [];
    this.cardBars = undefined;
    this.cardAvatar = undefined;
    this.cardAvatarWho = null;
    this.cardNameText = undefined;
    this.cardValueTexts = [];
    this.cardSummaryText = undefined;
    this.cardKey = '';
    this.timer?.remove();
    this.timer = undefined;
    this.memory = freshMonologueMemory();
    this.ratios = null;
    this.night = null;
    this.floor = null;
    this.inv = null;
    this.combatHp = null;
    this.pending = [];
    this.bubble?.destroy();
    this.bubble = undefined;
    this.spoken = 0;
  }

  /** create 首建：角色卡 + 循环 ticker。卡放最后建——它的泳道要对着成品 HUD 量。 */
  build(): void {
    this.buildCard();
    this.timer = this.host.time.addEvent({
      delay: STATUS_PANEL_BALANCE.monologue.tickMs,
      loop: true,
      callback: () => this.tick(),
    });
  }

  // ── 角色卡 ───────────────────────────────────────────────────────────────

  /**
   * 一张紧凑卡，不是第二簇仪表：顶带的四圆环（AG-54）已经回答「各槽多满」，
   * 这张回答「底下是谁、状态如何」——选中幸存者的头像、同四项的迷你分段条
   * + 实时数字、一句由它们派生的一句式摘要。所有坐标来自 HUD_LAYOUT 的
   * statusCard* 键，泳道契约（贴在反馈泳道底、与按钮行共享右边距）因此可
   * 断言，不必靠截图。
   */
  private buildCard(): void {
    const hud = HUD_LAYOUT;
    const x = hud.statusCardX;
    const y = hud.statusCardY;
    const w = hud.statusCardW;
    // The HUD text tier (103): above the world, below modal panels.
    const depth = 103;
    // The frame: the top plate's own riveted language. drawHudPlate draws at
    // the graphics' origin, so the object is positioned first.
    const frame = this.host.add.graphics().setScrollFactor(0).setDepth(depth);
    frame.setPosition(x, y);
    drawHudPlate(frame, w, hud.statusCardH, 0x0b0f12, UI.line, PALETTE.stoneLight, PALETTE.light);
    this.cardParts.push(frame);
    // The name header: right of the avatar, vertically centred on it.
    this.cardNameText = this.host.add
      .text(x + 58, y + 24, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(PALETTE.lightHigh) })
      .setOrigin(0, 0.5)
      .setName('hud-status-name')
      .setScrollFactor(0)
      .setDepth(depth + 1);
    this.cardParts.push(this.cardNameText);
    // Four stat rows: label, segmented mini bar (drawStatBar — the same Centum
    // strip the panels use, cut to 8 segments on 96px), live number.
    this.cardBars = this.host.add.graphics().setName('hud-status-bars').setScrollFactor(0).setDepth(depth + 1);
    this.cardParts.push(this.cardBars);
    this.cardValueTexts = [];
    this.statBars.forEach((stat, i) => {
      const cy = hud.statusRowFirstCY + i * hud.statusRowPitch;
      const label = this.host.add
        .text(x + hud.statusRowLabelX, cy, stat.label, { fontFamily: FONT_FAMILY, fontSize: '16px', color: hex(TEXT.secondary) })
        .setOrigin(0, 0.5)
        .setName(`hud-status-${stat.key}`)
        .setScrollFactor(0)
        .setDepth(depth + 1);
      const value = this.host.add
        .text(x + w - 12, cy, '', { fontFamily: FONT_FAMILY, fontSize: '16px', color: hex(TEXT.primary) })
        .setOrigin(1, 0.5)
        .setName(`hud-status-value-${stat.key}`)
        .setScrollFactor(0)
        .setDepth(depth + 1);
      this.cardParts.push(label, value);
      this.cardValueTexts.push(value);
    });
    // The summary line: one sentence derived from the numbers above it.
    this.cardSummaryText = this.host.add
      .text(x + hud.statusRowLabelX, hud.statusSummaryCY, '', { fontFamily: FONT_FAMILY, fontSize: '16px', color: hex(TEXT.secondary) })
      .setOrigin(0, 0.5)
      .setName('hud-status-summary')
      .setScrollFactor(0)
      .setDepth(depth + 1);
    this.cardParts.push(this.cardSummaryText);
    // Two hairlines: under the header, above the summary.
    const rules = this.host.add.graphics().setScrollFactor(0).setDepth(depth + 1);
    drawLine(rules, x + 10, 436, w - 20);
    drawLine(rules, x + 10, 530, w - 20);
    this.cardParts.push(rules);
    this.refreshCard();
  }

  /**
   * The avatar: the walk sheet's first idle frame (columns 0-5 are walk, 6-7
   * idle), cropped to head-and-shoulders so it reads as a portrait rather
   * than a tiny full body. The sheet is already in memory for the player
   * sprite, so this adds no preload. Rebuilt only when the pick changes.
   */
  private refreshCardAvatar(who: CharacterKey): void {
    if (this.cardAvatarWho === who && this.cardAvatar) return;
    this.cardAvatar?.destroy();
    this.cardAvatarWho = who;
    const hud = HUD_LAYOUT;
    this.cardAvatar = this.host.add
      .image(hud.statusCardX + 10, hud.statusCardY + 8, walkSheetKey(who))
      .setOrigin(0, 0)
      .setCrop(0, FRAME_H * 6, FRAME_W, 44)
      .setScale(0.68)
      .setScrollFactor(0)
      .setDepth(104);
    this.cardParts.push(this.cardAvatar);
  }

  /**
   * The card's live values. Redraws on change only — the same contract
   * refreshStats keeps: the ticker runs four times a second and the bars are
   * graphics, so an unconditional clear+redraw would be wasted work.
   */
  private refreshCard(): void {
    if (!this.cardNameText || !this.cardBars || !this.cardSummaryText) return;
    // Locals, so the row callback below keeps the guard's narrowing.
    const nameText = this.cardNameText;
    const bars = this.cardBars;
    const summaryText = this.cardSummaryText;
    const state = getGame();
    const who = this.host.metaSelectedCharacter();
    this.refreshCardAvatar(who);
    const name = CHARACTER_NAMES[who] ?? '幸存者';
    if (nameText.text !== name) nameText.setText(name);
    const p = state.player;
    const maxes = [GAME_CONFIG.player.hpMax, GAME_CONFIG.player.hungerMax, GAME_CONFIG.player.thirstMax, GAME_CONFIG.player.energyMax];
    const values = [p.hp, p.hunger, p.thirst, p.energy];
    const summary = statusSummaryLine(p, STATUS_PANEL_BALANCE);
    const key = `${values.map((v) => Math.round(v)).join(',')}|${summary.text}`;
    if (key === this.cardKey) return;
    this.cardKey = key;
    const hud = HUD_LAYOUT;
    bars.clear();
    values.forEach((v, i) => {
      const frac = v / maxes[i];
      const cy = hud.statusRowFirstCY + i * hud.statusRowPitch;
      // 8 segments, and the same "running out goes red at 20%" rule the rings
      // and every panel bar use, so the card never disagrees with them.
      drawStatBar(bars, hud.statusCardX + hud.statusRowBarX, cy - hud.statusRowBarH / 2, hud.statusRowBarW, hud.statusRowBarH, frac, STAT_COLORS[this.statBars[i].key] ?? UI.good, 8);
      this.cardValueTexts[i]?.setText(String(Math.round(v)));
      this.cardValueTexts[i]?.setColor(frac <= 0.2 ? hex(TEXT.warn) : hex(TEXT.primary));
    });
    summaryText.setText(summary.text);
    summaryText.setColor(summary.tone === 'danger' ? hex(TEXT.warn) : summary.tone === 'warn' ? hex(TEXT.highlight) : hex(TEXT.secondary));
  }

  // ── 自言自语 ticker ─────────────────────────────────────────────────────

  /**
   * 角色对自己的处境说话：阈值穿越（hp 低于 30%、饿惨、渴惨、累垮、入夜）
   * 或事件（好货、打赢、换层）。两条规则让它不成噪音：
   *   · WATCHING is unconditional — every tick updates the previous-value
   *     memory, so a crossing that happens under an open panel is not lost;
   *   · SPEAKING is gated twice — the global gap and the per-line cooldown
   *     live in data/monologue.ts (chooseMonologue), and a bubble only spawns
   *     when no panel is open, so it is never spoken behind a modal.
   */
  tick(): void {
    if (!hasGame()) return;
    this.refreshCard();
    const state = getGame();
    const cfg = STATUS_PANEL_BALANCE.monologue;
    const p = state.player;
    const maxes = {
      hp: GAME_CONFIG.player.hpMax,
      hunger: GAME_CONFIG.player.hungerMax,
      thirst: GAME_CONFIG.player.thirstMax,
      energy: GAME_CONFIG.player.energyMax,
    };
    const ratios = {
      hp: maxes.hp > 0 ? p.hp / maxes.hp : 1,
      hunger: maxes.hunger > 0 ? p.hunger / maxes.hunger : 1,
      thirst: maxes.thirst > 0 ? p.thirst / maxes.thirst : 1,
      energy: maxes.energy > 0 ? p.energy / maxes.energy : 1,
    };
    const prev = this.ratios;
    if (prev) {
      if (crossedBelow(prev.hp, ratios.hp, cfg.triggers.hpRatio)) this.queue('hp_low');
      if (crossedBelow(prev.hunger, ratios.hunger, cfg.triggers.hungerRatio)) this.queue('hunger_low');
      if (crossedBelow(prev.thirst, ratios.thirst, cfg.triggers.thirstRatio)) this.queue('thirst_low');
      if (crossedBelow(prev.energy, ratios.energy, cfg.triggers.energyRatio)) this.queue('energy_low');
    } else {
      // The first tick has no previous value, so a crossing cannot be SEEN —
      // but a stat already under its line (a run loaded while hurt, or a
      // change that landed before the first tick) is still a situation worth
      // one remark. The 9s gate keeps it to a single line, never a stream.
      if (ratios.hp < cfg.triggers.hpRatio) this.queue('hp_low');
      if (ratios.hunger < cfg.triggers.hungerRatio) this.queue('hunger_low');
      if (ratios.thirst < cfg.triggers.thirstRatio) this.queue('thirst_low');
      if (ratios.energy < cfg.triggers.energyRatio) this.queue('energy_low');
    }
    this.ratios = ratios;

    const night = isNight(state.gameMinuteOfDay);
    if (cfg.triggers.night && this.night === false && night) this.queue('night_fall');
    this.night = night;

    if (cfg.triggers.newFloor && this.floor !== null && state.currentFloor !== this.floor) {
      this.queue('new_floor');
    }
    this.floor = state.currentFloor;

    if (cfg.triggers.goodLoot) this.watchGoodLoot(p.inventory.slots);
    if (cfg.triggers.combatWin) this.watchCombatWin(state.combat);

    // Behind a modal the bubble would be invisible, so the flush waits; the
    // queue is deduped above and drained on the next panel-free tick.
    if (this.host.anyPanelOpen()) return;
    this.pending.sort((a, b) => MONOLOGUE_TRIGGER_PRIORITY.indexOf(a) - MONOLOGUE_TRIGGER_PRIORITY.indexOf(b));
    while (this.pending.length > 0) {
      const trigger = this.pending.shift() as MonologueTrigger;
      // One bubble at a time: the first trigger that clears the gate speaks,
      // the rest wait for the next tick (where the gap will likely refuse
      // them — stale news is not worth a second bubble).
      if (this.speak(trigger, this.host.time.now)) break;
    }
  }

  /** Good loot: watch the bag's stacks for a valuable item arriving. */
  private watchGoodLoot(slots: readonly { itemId: string; quantity: number }[]): void {
    const current = new Map<string, number>();
    for (const s of slots) current.set(s.itemId, (current.get(s.itemId) ?? 0) + s.quantity);
    const prev = this.inv;
    if (prev) {
      for (const [itemId, qty] of current) {
        if (qty - (prev.get(itemId) ?? 0) > 0 && isGoodLoot(itemId)) {
          this.queue('good_loot');
          break;
        }
      }
    }
    this.inv = current;
  }

  /**
   * A won fight. The killing blow zeroes the monster's hp in state before the
   * outcome panel closes (resolveRound is pure; GameScene applies it), so
   * watching the live combat tells a win from a flee. The line is queued for
   * the tick after the panel is gone — the fight's own log already said it.
   */
  private watchCombatWin(combat: GameState['combat']): void {
    if (combat) {
      const hp = combat.monster.hp;
      this.combatHp = this.combatHp === null ? hp : Math.min(this.combatHp, hp);
      return;
    }
    if (this.combatHp !== null) {
      if (this.combatHp <= 0) this.queue('combat_win');
      this.combatHp = null;
    }
  }

  /**
   * Queue a trigger, deduped; the ticker flushes in priority order.
   * private：当前全部入队点都在本类内（tick/watchGoodLoot/watchCombatWin），
   * 场景侧无调用方——设计文档「queueMonologue 委托」残留面对应旧代码形态，
   * 留一个没人调的委托就是死代码，故不留（需要时再开）。
   */
  private queue(trigger: MonologueTrigger): void {
    if (this.pending.includes(trigger)) return;
    this.pending.push(trigger);
  }

  /** Gate + pick + spawn. Returns true when a bubble actually went up. */
  private speak(trigger: MonologueTrigger, now: number): boolean {
    const voice = monologueVoiceFor(this.host.metaSelectedCharacter());
    // 硬规则（CLAUDE.md：世界生成与事件判定禁 Math.random）：选句随机由
    // (runSeed, day, floor, trigger, 已飘字数) 派生——同 seed 同场景重放选
    // 同一句，换 seed 换句子；不碰 Math.random。
    const state = getGame();
    const rng = monologueRng(state.runSeed, state.day, state.currentFloor, trigger, this.spoken);
    const picked = chooseMonologue(this.memory, now, trigger, voice, STATUS_PANEL_BALANCE, rng);
    if (!picked) return false;
    this.memory = picked.memory;
    this.spawnBubble(picked.line.text);
    return true;
  }

  /**
   * The 头顶飘字: one Text above the survivor's head in world space (the
   * camera keeps the player centred, so it rides along), fading in and out
   * over the configured lifetime. Deliberately NOT the feedback lane — that
   * lane is the game talking to the player; this is the character talking to
   * itself.
   */
  private spawnBubble(text: string): void {
    this.bubble?.destroy();
    const state = getGame();
    const bubble = this.host.add
      .text(state.player.x, PLAYER_FEET_Y - FRAME_H - 14, text, {
        fontFamily: FONT_FAMILY,
        fontSize: '18px',
        color: hex(TEXT.primary),
        backgroundColor: '#0b0f12e6',
        padding: { x: 10, y: 5 },
      })
      .setName('hud-status-bubble')
      .setOrigin(0.5, 1)
      .setDepth(105); // the furniture-label tier: over the world, under panels
    this.bubble = bubble;
    this.spoken += 1;
    const life = STATUS_PANEL_BALANCE.monologue.bubbleMs;
    bubble.setAlpha(0);
    this.host.tweens.add({
      targets: bubble,
      alpha: 1,
      duration: 140,
      onComplete: () => {
        // A restart or a second bubble destroys this one mid-life; `active`
        // is the cheap guard that keeps the tail from touching a dead Text.
        this.host.time.delayedCall(Math.max(120, life - 440), () => {
          if (!bubble.active) return;
          this.host.tweens.add({
            targets: bubble,
            alpha: 0,
            duration: 300,
            onComplete: () => {
              bubble.destroy();
              if (this.bubble === bubble) this.bubble = undefined;
            },
          });
        });
      },
    });
  }
}
