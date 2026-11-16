import Phaser from 'phaser';
import { createGameConfig } from './core/gameConfig';
import { getGame, hasGame } from './core/session';
import { unlockAudio } from './render/audio';
import { FONT_FACES } from './render/uiKit';
import { QuestPanelScene } from './scenes/QuestPanelScene';
import { EndgameScene } from './scenes/EndgameScene';
import { diaryOf, diaryKindCount, type DiaryKind } from './systems/DiarySystem';
import { npcAtomsFor, sense } from './ai/npcAtoms';
import { NPCS } from './data/npcs';
import { evaluateAllQuests } from './data/quests';

/**
 * Phaser creates a Text's canvas once and measures it against whatever font is
 * installed at that moment. Start the game before the webfont arrives and every
 * label keeps the fallback's metrics even after the correct glyphs appear —
 * clipped rows, off-centre titles, wrong wrap points. So both faces are loaded
 * and laid out before the first scene is constructed.
 *
 * The timeout is deliberate: a missing or blocked font file must not wedge the
 * game. After three seconds the CSS fallback stack takes over.
 */
async function waitForFonts(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  const sample = '第100000层末日宿舍生命饥饿口渴精力背包0123456789';
  const loads = FONT_FACES.map((face) =>
    document.fonts.load(`24px "${face}"`, sample).catch(() => undefined),
  );
  await Promise.race([
    Promise.all(loads).then(() => document.fonts.ready),
    new Promise<void>((resolve) => window.setTimeout(resolve, 3000)),
  ]);
}

async function boot(): Promise<void> {
  await waitForFonts();

  const game = new Phaser.Game(createGameConfig('game'));

  // The quest panel is registered here rather than in core/gameConfig's scene
  // list: that config is the shared boot contract, and the panel is a run-time
  // overlay (GameScene starts it over the live game the same way it starts
  // TowerOverview). add() with autoStart false parks it in the SceneManager
  // dormant, so scene.start('QuestPanel') / scene.get('QuestPanel') resolve
  // from anywhere without touching the core config. Key and event contract:
  // docs/plans/UI.md「任务面板与 quests:changed」.
  game.scene.add('QuestPanel', QuestPanelScene);

  // The finale: floor 100000's ruling core (Q6 `same-pen`). Registered here for
  // the same reason as the quest panel — core/gameConfig's scene list is the
  // shared boot contract, and this scene is a handoff GameScene starts from the
  // 100000 container interactions (entry contract: docs/plans/FINALE_UX.md).
  // add() with autoStart false parks it dormant, so scene.start('Endgame')
  // resolves from anywhere.
  game.scene.add('Endgame', EndgameScene);

  // Browsers gate audio behind a user gesture; unlock on the first one.
  const unlock = (): void => unlockAudio();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  // Dev-only handles so Playwright can assert on real game state (active scene,
  // GameState) rather than just the DOM. Stripped from production builds.
  //
  // AG-44：补上 AG-32 报告的三只缺口句柄。三者共同的性质是**只读**：
  // 句柄本身不写任何状态（npcAtoms 的 sense() 与游戏自己的 npcView 走同一条
  // 惰性结算通路，不是句柄新增的副作用），返回值全部来自已在跑的产品函数——
  // diaryOf / diaryKindCount / npcAtomsFor / sense / evaluateAllQuests。
  // 修前 e2e/diary.spec.ts 与 e2e/npc-atoms.spec.ts 各有一段「派工单提到的
  // 句柄并不存在」的方法说明（它们在页面里 import 产品模块绕行）；句柄挂上
  // 后那两条路径依然有效（同模块图、同实例），此处只是把绕行变成直读。
  if (import.meta.env.DEV) {
    const w = window as unknown as {
      __PHASER_GAME__?: Phaser.Game;
      __PHASER_SESSION__?: { getState: () => unknown };
      __PHASER_DIARY__?: {
        getEntries: (limit?: number) => ReturnType<typeof diaryOf>;
        getKindCount: (kind: DiaryKind) => number;
      };
      __PHASER_NPC_ATOMS__?: {
        getAtoms: (npcId: string) => ReturnType<typeof npcAtomsFor> | null;
        getSense: (npcId: string) => ReturnType<typeof sense> | null;
      };
      __PHASER_QUESTS__?: {
        getEvaluations: () => ReturnType<typeof evaluateAllQuests>;
        getSelection: () => { mode: 'list' | 'branch'; quest: number; branch: number };
        getMessage: () => string;
      };
    };
    w.__PHASER_GAME__ = game;
    w.__PHASER_SESSION__ = { getState: () => (hasGame() ? getGame() : null) };

    // 日记：条目（day 倒序，可限条数）与按 kind 的计数（走旗，不被 64 条裁剪影响）。
    w.__PHASER_DIARY__ = {
      getEntries: (limit?: number) => (hasGame() ? diaryOf(getGame(), limit) : []),
      getKindCount: (kind: DiaryKind) => (hasGame() ? diaryKindCount(getGame(), kind) : 0),
    };

    // NPC 三原子与感知快照。未知 npcId 返回 null 而不是抛——探针的常规问法
    // 就是「这个人不存在时会怎样」，抛错只会让页面多一条 pageerror。
    const npcById = (npcId: string): (typeof NPCS)[number] | null => NPCS.find((n) => n.id === npcId) ?? null;
    w.__PHASER_NPC_ATOMS__ = {
      getAtoms: (npcId: string) => {
        const npc = npcById(npcId);
        return npc && hasGame() ? npcAtomsFor(npc, getGame()) : null;
      },
      getSense: (npcId: string) => {
        const npc = npcById(npcId);
        return npc && hasGame() ? sense(npc, getGame()) : null;
      },
    };

    // 任务：求值永远对活 state 现算（面板开没开都一样）；selection / message
    // 委托给 QuestPanelScene 实例——面板没在显示时诚实地回答「没有选择」，
    // 而不是把上一次的光标位置说成当前状态。
    // 实例必须**懒解析**：boot() 里 game 刚构造、SceneManager 还没 boot，
    // scene.add() 走 _pending 队列且返回 null——启动时捕获会永远拿到 null，
    // 句柄于是永远答缺省值（AG-44 实测：场景里 sel 已是 1，句柄仍报 0）。
    const questPanelScene = (): QuestPanelScene | null =>
      (game.scene.getScene('QuestPanel') as QuestPanelScene | null) ?? null;
    w.__PHASER_QUESTS__ = {
      getEvaluations: () => (hasGame() ? evaluateAllQuests(getGame()) : []),
      getSelection: () => questPanelScene()?.devSelection() ?? { mode: 'list', quest: 0, branch: 0 },
      getMessage: () => questPanelScene()?.devMessage() ?? '',
    };
  }
}

void boot();
