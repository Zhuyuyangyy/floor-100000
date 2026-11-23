// AG-67：处境自言自语 ticker——RC-03 拆分第 2 步。
// 从 GameScene 迁出（原 GameScene.ts 5378-5668 段 + 1071-1099 字段组 +
// buildHud 的重置块与定时器注册），行为零变更：同一构造路径、同一 seeded
// 选句（monologueRng 派生，禁 Math.random）、同一门控（9s 全局间隔 + 45s
// 单句冷却，chooseMonologue）、同一气泡寿命与几何。
//
// 2026-11-19 用户裁决：右下角「幸存者」常驻状态卡整块拆除——顶带四圆环
// （AG-54）已经回答「各槽多满」，卡是同源数据的第二份读数，冗余。本控制器
// 只留独白 ticker 一个职责；卡字段组/buildCard/refreshCard/头像刷新与
// STAT_BARS 注入一并删除（hudLayout 的 statusCard* 键同步退役）。
//
// 形态（设计文档 §2，沿用第 1 步 StatsPanelController 的主机结构面模式）：
// plain TS 类，**不 import Phaser 场景类型**——
//   * 构造拿 host（MonologueHost：add 工厂/tweens/time/metaSelectedCharacter/
//     anyPanelOpen——GameScene 天然满足）。
//   * import 链（uiKit/palette/walkcycle/config/session/constants/
//     SurvivalSystem/data/monologue）均无 Phaser 值导入——Node 下可用记录型
//     假件单测（src/tests/monologueController.test.ts）。
//
// 两条不变量（迁移中逐字保留）：
//   · WATCHING 无条件——每个 tick 都更新前值记忆，面板开着时发生的阈值穿越
//     不丢；SPEAING 双重门控——全局间隔 + 单句冷却在 data/monologue.ts，
//     且只在无面板时飘泡，永不在模态背后说话。
//   · 选句随机由 (runSeed, day, floor, trigger, 已飘字数) 派生（硬规则：
//     世界生成与事件判定禁 Math.random）——同 seed 同场景重放选同一句。

import type Phaser from 'phaser';
import { FONT_FAMILY } from '../../render/uiKit';
import { TEXT, hex } from '../../render/palette';
import { FRAME_H } from '../../render/walkcycle';
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
  type MonologueMemory,
  type MonologueTrigger,
} from '../../data/monologue';
import type { CharacterKey } from '../../render/artpack';
import type { GameState } from '../../core/gameTypes';

/**
 * 控制器需要场景提供的最小面（GameScene 天然满足；单测用假件实现）。
 * 刻意不 import Phaser.Scene——可测性靠这层结构面，不靠能造真场景。
 */
export interface MonologueHost {
  /** Phaser 的 GameObject 工厂——飘字气泡从它出生。 */
  add: Phaser.GameObjects.GameObjectFactory;
  /** Tween 管理器——气泡的淡入淡出。 */
  tweens: Phaser.Tweens.TweenManager;
  /** 场景时钟——tick 读 now、气泡寿命走 delayedCall。 */
  time: Phaser.Time.Clock;
  /** meta 选中的角色（场景同款实现：陈旧选择回退 player）。 */
  metaSelectedCharacter(): CharacterKey;
  /** 任何面板开着时为真——气泡不在模态背后说话。 */
  anyPanelOpen(): boolean;
  /**
   * 当前层宽（floorWidthFor 的结果，每层重建时更新）。气泡靠它把 x 钳进层内
   * ——与 CombatController.host.floorWidth() 同一个面。
   */
  floorWidth(): number;
}

/**
 * 气泡与楼层左右沿的最小间距（世界像素）。角色自己是被钳在 [8, floorW-8] 的，
 * 气泡比角色宽得多，所以另给一份边距 —— 8 会让底板紧贴墙沿，读起来像裁切。
 */
const BUBBLE_MARGIN = 12;

export class MonologueController {
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

  constructor(private readonly host: MonologueHost) {}

  /** 已飘句数（ag67-status e2e 的读数面）。 */
  get spokenCount(): number {
    return this.spoken;
  }

  /**
   * buildHud 的「先毁后建」重置：场景重启保 display list 且字段初始化器不重跑，
   * 上一局的气泡/定时器不清就会双份上屏、stale Text 一 setText 就抛。
   * 定时器再 remove 一次是无害的（Clock.shutdown 已清过）——保持字段诚实。
   */
  reset(): void {
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

  /** create 首建：循环 ticker（buildHud 最后调用，与成品 HUD 同帧起跑）。 */
  build(): void {
    this.timer = this.host.time.addEvent({
      delay: STATUS_PANEL_BALANCE.monologue.tickMs,
      loop: true,
      callback: () => this.tick(),
    });
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
    // 气泡以角色为中心（origin 0.5），但角色能走到 x=8 —— 半宽 100+ 的泡此时
    // 左半整个落在世界负坐标里，被楼层左沿裁掉（2026-11-23 巡检实证：站在
    // 楼梯口 x≈40 飘字，气泡左边缺一截）。按**实际渲染宽度**把中心钳进层内，
    // 左右各留 BUBBLE_MARGIN。宽度读 width（已含 padding），不估字号。
    //
    // 只钳 x、不动 y：纵向由 PLAYER_FEET_Y - FRAME_H - 14 定，本来就贴着
    // 头顶，且 ag67-status e2e 钉着 y ≥ 0。层宽比气泡还窄的极端情况下取层
    // 中点（Math.max 的下界可能超过上界，此时居中比贴边好）。
    const half = bubble.width / 2;
    const floorW = this.host.floorWidth();
    const lo = BUBBLE_MARGIN + half;
    const hi = floorW - BUBBLE_MARGIN - half;
    bubble.setX(lo > hi ? floorW / 2 : Math.min(Math.max(state.player.x, lo), hi));
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
