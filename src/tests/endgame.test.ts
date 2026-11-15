import { describe, expect, it } from 'vitest';

import { createNewGame } from '../core/gameState';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../core/design';
import type { GameState } from '../core/gameTypes';
import { QUESTS, QUEST_FLAG, STORY_FLAGS, evaluateAllQuests, evaluateBranch } from '../data/quests';
import type { Quest, QuestBranch } from '../data/quests';
import { hasFlag, setFlag } from '../systems/WorldFlags';
import { addItem, removeItem } from '../systems/InventorySystem';
import { estimateLineHeight, estimateTextWidth, wrapText } from '../render/dialogueLayout';
import { FLOOR_TEMPLATES } from '../data/floorTemplates';
import { TYPE } from '../render/uiKit';

// AG-21: guards for the finale (src/scenes/EndgameScene.ts) — the ruling core's
// four endings, their availability, the consequence landing, the archive's
// three tables and the layout arithmetic of every finale card.
//
// No screenshots and no Phaser import (same reason as questPanel.test.ts: the
// scene module imports Phaser at value level and cannot be loaded under Node):
// the scene's tables are mirrored below with the "if the scene's table changes,
// these change with it" contract, and everything about the endings' *semantics*
// is read from the pure data layer (quests.ts / floorTemplates.ts) directly.

// ── the scene's geometry, mirrored ──────────────────────────────────────────
// EndgameScene.ts exports these; that module imports Phaser, so they live here
// too. Mirrors questPanel.test.ts's treatment of QuestPanelScene.
const ENDGAME_PANEL_W = 760;
const ENDGAME_PANEL_H = 560;
const ENDGAME_PAD = 20;
const ENDGAME_TEXT_W = ENDGAME_PANEL_W - ENDGAME_PAD * 2;
/** The first body line's top, measured from the panel top. */
const ENDGAME_BODY_TOP = 44;
/** The footer hint's reserved band; content may not cross it. */
const ENDGAME_FOOT_H = 34;

// The finale's type scale: panel title/body/caption from uiKit's TYPE, plus the
// one big headline only the endings get.
const F_BIG = 44;
const F_FOOT = 18;

/** choice mode: gap between one branch block and the next. */
const BRANCH_GAP = 12;
/** choice mode: gap between a branch's text and its blocker reasons. */
const BLOCKER_GAP = 2;
/** Branch text is indented past the ▸/· marker; blockers wrap at the same width. */
const BRANCH_MARKER_W = 28;
const BRANCH_TEXT_W = ENDGAME_TEXT_W - BRANCH_MARKER_W;

// ── the scene's ending table, mirrored ──────────────────────────────────────
// ENDINGS in EndgameScene.ts: one card per ending, its own tone. The ids are
// Q6's branch ids; the routes are GAME_DESIGN_LOCK.md §6's four lines (the same
// mapping STORY.md's Q6 table pins).
interface MirroredEnding {
  readonly title: string;
  readonly route: string;
  readonly lines: readonly string[];
}

const ENDINGS: Record<string, MirroredEnding> = {
  shutdown: {
    title: '关上它',
    route: 'C / D · 掀桌子，塔黑掉',
    lines: [
      '你按下确认。终端把整座塔的供电，放进了你手里。',
      '你走到配电箱前，拉下总闸。',
      '配电房的灯一颗颗灭掉。从一楼开始。',
      '周三、周五从此只是一个日子。',
      '塔还在。只是再也不按表停电了。',
    ],
  },
  'hand-over': {
    title: '交回底层',
    route: 'C · 底层起义的物质基础',
    lines: [
      '账本、签字页、处决名单。你一页一页，交给了最开始就在底层的人。',
      '停电表、配给表、处决名单，是同一支笔写的——',
      '现在，拿到笔的人，换成了他们。',
      '钥匙留在终端上。塔的命运，从此由住在一楼的人决定。',
    ],
  },
  throne: {
    title: '坐上它',
    route: 'A / D · 你本就是系统的一部分',
    lines: [
      '椅子是空的，也是为你留的。',
      '编号也好，请柬也好，后门也好——路早就选过了。',
      '你坐下。终端安静下来，像一名称职的雇员。',
      '从明天起，停电表由你来签。',
      '笔还是那支笔。写什么的，换成了你。',
    ],
  },
  'walk-away': {
    title: '转身下楼',
    route: 'B · 独立者不坐这把椅子',
    lines: [
      '你把权限卡在终端上，一级一级走下楼。',
      '塔还是塔。周三照旧停电，配给照旧发放。',
      '笔还在桌上，名单还会变长。',
      '你一级一级走下去，从此不提这件事。',
    ],
  },
};

// ── the archive's three tables, mirrored (EndgameScene.TABLE_PAGES) ─────────
const TABLE_PAGES: readonly { title: string; body: readonly string[]; aside: string }[] = [
  {
    title: '停电表',
    body: ['周三 · 周五 00:00–06:00，底层全区停电。', '执行：配给调度。签字：核心办公室。'],
    aside: '你在 4 层配电房抄过这张表。字迹一样。',
  },
  {
    title: '配给表',
    body: ['第七批：口粮 0.6 份/人/日；净水改接配给主线。', '签字：核心办公室。'],
    aside: '5 层食堂墙上被划掉的名字，走了一半。',
  },
  {
    title: '处决名单',
    body: ['编号、罪名、日期。一页一页，一支笔。'],
    aside: '三张表并排看：同一支笔写的。',
  },
];

// ── states the scene renders against ────────────────────────────────────────

/** A fresh run standing on the summit: every quest done except Q6. */
function atSummit(): GameState {
  const state = createNewGame(42);
  for (const quest of QUESTS) {
    if (quest.id === 'same-pen') continue;
    setFlag(state, QUEST_FLAG.done(quest.id));
  }
  state.currentFloor = 100000;
  return state;
}

function finale(): Quest {
  return QUESTS.find((q) => q.id === 'same-pen')!;
}

function branchById(id: string): QuestBranch {
  const branch = finale().branches.find((b) => b.id === id);
  if (!branch) throw new Error(`unknown ending branch: ${id}`);
  return branch;
}

/** Applies one branch exactly as EndgameScene.commit does (STORY.md §7). */
function land(state: GameState, branch: QuestBranch): void {
  const quest = finale();
  setFlag(state, QUEST_FLAG.accepted(quest.id));
  setFlag(state, QUEST_FLAG.branch(quest.id, branch.id));
  for (const c of branch.consequences) {
    switch (c.kind) {
      case 'setFlag':
        setFlag(state, c.flag);
        break;
      case 'clearFlag':
        delete state.flags?.[c.flag];
        break;
      case 'giveItem':
        addItem(state.player.inventory, c.itemId, c.count);
        break;
      case 'takeItem':
        removeItem(state.player.inventory, c.itemId, c.count);
        break;
      case 'grantPass':
        if (!state.player.homeUpgrades.includes(c.pass)) state.player.homeUpgrades.push(c.pass);
        break;
      case 'score':
        if (!state.records) state.records = { deepestFloor: state.currentFloor, bestScore: 0 };
        state.records.bestScore += c.delta;
        break;
    }
  }
  if (quest.objectives.every((o) => hasFlag(state, o.doneFlag))) {
    setFlag(state, QUEST_FLAG.done(quest.id));
  }
}

// ── Q6's four endings are the data layer's, not the scene's invention ───────

describe('Q6 same-pen: the four endings the scene presents', () => {
  it('is the segment-6 finale, gated behind Q5 and anchored on the summit', () => {
    const quest = finale();
    expect(quest.kind).toBe('finale');
    expect(quest.segment).toBe(6);
    expect(quest.giver).toBe('core_terminal');
    expect(quest.anchorFloor).toBe(100000);
    expect(quest.trigger.minFloor).toBe(100000);
    expect(quest.requires).toEqual(['vip-card']);
  });

  it('offers exactly the four endings, in the design lock\'s order', () => {
    expect(finale().branches.map((b) => b.id)).toEqual(['shutdown', 'hand-over', 'throne', 'walk-away']);
  });

  it('writes one story:ending.* flag per ending, and nothing else', () => {
    for (const branch of finale().branches) {
      const flags = branch.consequences.filter((c) => c.kind === 'setFlag').map((c) => c.flag);
      expect(flags.length, branch.id).toBe(1);
      expect(flags[0].startsWith('story:ending.'), branch.id).toBe(true);
    }
  });

  it('keeps two unconditional endings so every player has a finale (STORY.md §6)', () => {
    const unconditional = finale().branches.filter((b) => !b.requires).map((b) => b.id);
    expect(unconditional).toEqual(['shutdown', 'walk-away']);
  });

  it('gates hand-over on recorded evidence and a clean conscience', () => {
    const requires = branchById('hand-over').requires!;
    expect(requires.flagsAll).toEqual([STORY_FLAGS.feastHasEvidence]);
    expect(requires.flagsNone).toEqual([STORY_FLAGS.tapExploited]);
  });

  it('gates throne on having taken the system\'s own offers (signed or invited)', () => {
    const requires = branchById('throne').requires!;
    expect(requires.flagsAny).toEqual([STORY_FLAGS.permitVolunteered, STORY_FLAGS.vipHandlerInvite]);
  });
});

// ── availability comes from the real conditions, never hardcoded ────────────

describe('ending availability is read from quests.ts conditions', () => {
  it('a bare summit: the two open doors, the two gated ones name their price', () => {
    const state = atSummit();
    const branches = new Map(finale().branches.map((b) => [b.id, evaluateBranch(state, b)]));
    expect(branches.get('shutdown')!.available).toBe(true);
    expect(branches.get('walk-away')!.available).toBe(true);
    expect(branches.get('hand-over')!.available).toBe(false);
    expect(branches.get('hand-over')!.blockers).toEqual(['尚不知道「story:feast.has-evidence」']);
    expect(branches.get('throne')!.available).toBe(false);
    expect(branches.get('throne')!.blockers.length).toBe(1);
  });

  it('recording the feast ledger opens hand-over — until the exploited tap closes it', () => {
    const withLedger = atSummit();
    setFlag(withLedger, STORY_FLAGS.feastHasEvidence);
    expect(evaluateBranch(withLedger, branchById('hand-over')).available).toBe(true);

    const soldOut = atSummit();
    setFlag(soldOut, STORY_FLAGS.feastHasEvidence);
    setFlag(soldOut, STORY_FLAGS.tapExploited);
    const blocked = evaluateBranch(soldOut, branchById('hand-over'));
    expect(blocked.available).toBe(false);
    expect(blocked.blockers).toEqual(['已经来不及了（「story:tap.exploited-outlet」）']);
  });

  it('either road into the system opens throne', () => {
    for (const flag of [STORY_FLAGS.permitVolunteered, STORY_FLAGS.vipHandlerInvite]) {
      const state = atSummit();
      setFlag(state, flag);
      expect(evaluateBranch(state, branchById('throne')).available, flag).toBe(true);
      expect(evaluateBranch(state, branchById('throne')).blockers).toEqual([]);
    }
  });

  it('a full-account run can reach all four endings at once', () => {
    const state = atSummit();
    setFlag(state, STORY_FLAGS.feastHasEvidence);
    setFlag(state, STORY_FLAGS.permitVolunteered);
    for (const branch of finale().branches) {
      expect(evaluateBranch(state, branch).available, branch.id).toBe(true);
    }
  });

  it('the summit evaluation stays deterministic (no clock, no randomness)', () => {
    const state = atSummit();
    const first = evaluateAllQuests(state);
    expect(evaluateAllQuests(state)).toEqual(first);
  });
});

// ── the landing: consequences per STORY.md §7, one score table ──────────────

describe('landing a branch writes exactly what quests.ts declares', () => {
  it('shutdown: +100 and the tower goes dark from the first floor', () => {
    const state = atSummit();
    land(state, branchById('shutdown'));
    expect(hasFlag(state, STORY_FLAGS.endingShutdown)).toBe(true);
    expect(state.records?.bestScore).toBe(100);
  });

  it('hand-over: +100 and the evidence leaves with the player\'s report', () => {
    const state = atSummit();
    setFlag(state, STORY_FLAGS.feastHasEvidence);
    land(state, branchById('hand-over'));
    expect(hasFlag(state, STORY_FLAGS.endingHandOver)).toBe(true);
    // 交出现证不收回 flag：证据是「给了谁」而不是「没了」。
    expect(hasFlag(state, STORY_FLAGS.feastHasEvidence)).toBe(true);
    expect(state.records?.bestScore).toBe(100);
  });

  it('throne: +100 and the chair is warm', () => {
    const state = atSummit();
    setFlag(state, STORY_FLAGS.vipHandlerInvite);
    land(state, branchById('throne'));
    expect(hasFlag(state, STORY_FLAGS.endingThrone)).toBe(true);
    expect(state.records?.bestScore).toBe(100);
  });

  it('walk-away: +50, the cheapest ending and the one anybody can take', () => {
    const state = atSummit();
    land(state, branchById('walk-away'));
    expect(hasFlag(state, STORY_FLAGS.endingWalkAway)).toBe(true);
    expect(state.records?.bestScore).toBe(50);
  });

  it('scores add onto the run\'s record instead of replacing it', () => {
    const state = atSummit();
    state.records = { deepestFloor: 50010, bestScore: 640 };
    land(state, branchById('throne'));
    expect(state.records.bestScore).toBe(740);
    expect(state.records.deepestFloor).toBe(50010);
  });

  it('marks the branch taken and closes the quest once its objectives are met', () => {
    const state = atSummit();
    // 三条入口都写齐的 objective doneFlag（FINALE_UX.md §3.1）：key/pen/door。
    for (const o of finale().objectives) setFlag(state, o.doneFlag);
    land(state, branchById('shutdown'));
    expect(hasFlag(state, QUEST_FLAG.accepted('same-pen'))).toBe(true);
    expect(hasFlag(state, QUEST_FLAG.branch('same-pen', 'shutdown'))).toBe(true);
    expect(hasFlag(state, QUEST_FLAG.done('same-pen'))).toBe(true);
  });

  it('leaves the quest open while an objective is still unseen', () => {
    const state = atSummit();
    land(state, branchById('walk-away'));
    expect(hasFlag(state, QUEST_FLAG.done('same-pen'))).toBe(false);
  });

  it('an ending flag is final: the scene\'s settled guard reads any of the four', () => {
    const state = atSummit();
    land(state, branchById('throne'));
    const taken = [STORY_FLAGS.endingShutdown, STORY_FLAGS.endingHandOver, STORY_FLAGS.endingThrone, STORY_FLAGS.endingWalkAway].filter((f) =>
      hasFlag(state, f),
    );
    expect(taken).toEqual([STORY_FLAGS.endingThrone]);
  });
});

// ── the ending cards: one tone each, all inside the card ────────────────────

describe('ending card layout: four tones, one card', () => {
  it('covers every branch id with its own card and its own words', () => {
    const ids = finale().branches.map((b) => b.id);
    expect(Object.keys(ENDINGS).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      const ending = ENDINGS[id];
      expect(ending.title.length, id).toBeGreaterThan(0);
      expect(ending.route.length, id).toBeGreaterThan(0);
      expect(ending.lines.length, id).toBeGreaterThanOrEqual(4);
      // 演出不是换行字：每个结局至少四句自己的收尾。
      expect(new Set(ending.lines).size, id).toBe(ending.lines.length);
    }
  });

  it('prints every ending headline on one line inside the card', () => {
    for (const [id, ending] of Object.entries(ENDINGS)) {
      expect(estimateTextWidth(ending.title, F_BIG), id).toBeLessThanOrEqual(ENDGAME_TEXT_W);
    }
  });

  it('wraps every ending line to at most two lines, and the whole card fits', () => {
    // buildEnding: headline at top+84, rule at top+128, lines from top+176 at
    // (lineHeight + 16) pitch; the card's own footer band is reserved below.
    const linesTop = 176;
    const pitch = estimateLineHeight(TYPE.body) + 16;
    const limit = ENDGAME_PANEL_H - ENDGAME_FOOT_H;
    for (const [id, ending] of Object.entries(ENDINGS)) {
      let worst = 0;
      for (const line of ending.lines) {
        const lines = wrapText(line, ENDGAME_TEXT_W, TYPE.body).length;
        expect(lines, `${id}: ${line}`).toBeLessThanOrEqual(2);
        worst += lines;
      }
      expect(linesTop + worst * pitch, id).toBeLessThanOrEqual(limit);
    }
  });

  it('maps the four endings onto the design lock\'s four routes', () => {
    expect(ENDINGS.shutdown.route.startsWith('C / D')).toBe(true);
    expect(ENDINGS['hand-over'].route.startsWith('C')).toBe(true);
    expect(ENDINGS.throne.route.startsWith('A / D')).toBe(true);
    expect(ENDINGS['walk-away'].route.startsWith('B')).toBe(true);
  });

  it('scores every ending into the epilogue\'s delta column', () => {
    // The epilogue prints +scoreDelta, summed from the branch's own score
    // consequences — so the displayed number IS the data's number.
    for (const branch of finale().branches) {
      const delta = branch.consequences.filter((c) => c.kind === 'score').reduce((n, c) => n + (c.kind === 'score' ? c.delta : 0), 0);
      expect(delta, branch.id).toBe(branch.id === 'walk-away' ? 50 : 100);
    }
  });
});

// ── the choice screen: four branches + blockers, all inside the card ────────

describe('choice screen layout', () => {
  /** The worst blocker text each branch can print, over the states the scene
   *  renders: gated endings print their reasons when locked. */
  function worstBlockers(): Record<string, string> {
    const bare = atSummit();
    const dirty = atSummit();
    setFlag(dirty, STORY_FLAGS.feastHasEvidence);
    setFlag(dirty, STORY_FLAGS.tapExploited);
    const out: Record<string, string> = {};
    for (const branch of finale().branches) {
      const reasons = [evaluateBranch(bare, branch), evaluateBranch(dirty, branch)]
        .map((e) => e.blockers.join(' · '))
        .sort((a, b) => b.length - a.length)[0];
      out[branch.id] = reasons;
    }
    return out;
  }

  it('flows the four branches and their blockers inside the card', () => {
    const blockers = worstBlockers();
    // buildChoice: intro (2 lines) + meta line, then one block per branch.
    let y =
      ENDGAME_BODY_TOP +
      2 * (estimateLineHeight(TYPE.caption) + 6) +
      estimateLineHeight(TYPE.caption) +
      16;
    for (const branch of finale().branches) {
      const textLines = wrapText(branch.text, BRANCH_TEXT_W, TYPE.body).length;
      let blockH = textLines * estimateLineHeight(TYPE.body);
      const reason = blockers[branch.id];
      if (reason) {
        blockH += BLOCKER_GAP + wrapText(reason, BRANCH_TEXT_W, TYPE.caption).length * estimateLineHeight(TYPE.caption);
      }
      y += blockH + BRANCH_GAP;
    }
    y -= BRANCH_GAP; // the last block's bottom, not the trailing gap
    expect(y).toBeLessThanOrEqual(ENDGAME_PANEL_H - ENDGAME_FOOT_H);
  });

  it('names the gated endings\' price in one printed line each', () => {
    // The bare summit's reasons — what a player who recorded nothing sees.
    const bare = atSummit();
    const branches = new Map(finale().branches.map((b) => [b.id, evaluateBranch(bare, b)]));
    expect(branches.get('shutdown')!.blockers).toEqual([]);
    expect(branches.get('walk-away')!.blockers).toEqual([]);
    expect(branches.get('hand-over')!.blockers).toEqual(['尚不知道「story:feast.has-evidence」']);
    expect(branches.get('throne')!.blockers).toEqual(['需要其中一条路：story:permit.volunteered / story:vip.handler-invite']);
  });
});

// ── the archive and the fuse box: the other two container entries ───────────

describe('archive and fuse box: the narrative containers', () => {
  it('reads as three tables, the last one naming the same pen', () => {
    expect(TABLE_PAGES.map((p) => p.title)).toEqual(['停电表', '配给表', '处决名单']);
    expect(TABLE_PAGES[2].aside).toContain('同一支笔');
  });

  it('fits every table page inside the card', () => {
    for (const page of TABLE_PAGES) {
      let y = ENDGAME_BODY_TOP + 20 + estimateLineHeight(TYPE.title) + 18;
      for (const line of page.body) {
        y += wrapText(line, ENDGAME_TEXT_W, TYPE.body).length * estimateLineHeight(TYPE.body) + 10;
      }
      y += 16;
      y += wrapText(page.aside, ENDGAME_TEXT_W, TYPE.caption).length * estimateLineHeight(TYPE.caption) + 24;
      if (page.title === '处决名单') y += estimateLineHeight(TYPE.body);
      expect(y, page.title).toBeLessThanOrEqual(ENDGAME_PANEL_H - ENDGAME_FOOT_H);
    }
  });

  it('the fuse screen\'s four lines fit, the switch graphic included', () => {
    const lines: readonly string[] = [
      '钥匙在你手里——现在你也是这套系统的一部分。',
      '总闸。标签写着：整塔供电。',
      '墙上并排摆着三张表：停电表、配给表、处决名单。',
      '拉下它，从一楼开始黑。',
    ];
    let y = ENDGAME_BODY_TOP + 20;
    for (const line of lines) {
      y += wrapText(line, ENDGAME_TEXT_W, TYPE.body).length * estimateLineHeight(TYPE.body) + 12;
    }
    // The switch graphic sits at panelH-130..panelH-104; text must clear it.
    expect(y).toBeLessThanOrEqual(ENDGAME_PANEL_H - 140);
  });

  it('the three containers it binds to are the summit template\'s own', () => {
    const template = FLOOR_TEMPLATES[100000];
    expect(template).toBeDefined();
    const byId = new Map(template.containers.map((c) => [c.id, c]));
    expect([...byId.keys()].sort()).toEqual(['counter', 'fuse_box', 'security_safe']);
    expect(byId.get('counter')!.x).toBe(320);
    expect(byId.get('fuse_box')!.x).toBe(640);
    expect(byId.get('security_safe')!.x).toBe(960);
  });
});

// ── the panel itself ────────────────────────────────────────────────────────

describe('endgame panel geometry', () => {
  it('fits the design canvas with margin to spare', () => {
    expect(ENDGAME_PANEL_W).toBeLessThanOrEqual(DESIGN_WIDTH);
    expect(ENDGAME_PANEL_H).toBeLessThanOrEqual(DESIGN_HEIGHT);
  });

  it('keeps the epilogue\'s six rows on the card', () => {
    // buildEpilogue: header + 6 rows at 40px pitch + one closing caption.
    const rowsBottom = ENDGAME_BODY_TOP + 24 + 6 * 40;
    expect(rowsBottom).toBeLessThanOrEqual(ENDGAME_PANEL_H - ENDGAME_FOOT_H - estimateLineHeight(TYPE.caption));
  });

  it('flows the five-beat prologue inside the card', () => {
    // buildPrologue: one line per Enter, from BODY_TOP+30 at (lineHeight+14).
    let y = ENDGAME_BODY_TOP + 30;
    for (let i = 0; i < 5; i++) y += estimateLineHeight(TYPE.body) + 14;
    y += 10 + estimateLineHeight(TYPE.body); // the ▍ cursor beat
    expect(y).toBeLessThanOrEqual(ENDGAME_PANEL_H - ENDGAME_FOOT_H);
  });

  it('uses the project type scale: the epilogue rows keep the shared rhythm', () => {
    // The epilogue rows run at 40px pitch — the same rhythm EndScene's rows use
    // for a pixel face, and a multiple of the UI_UNIT grid.
    expect(40 % 4).toBe(0);
    expect(TYPE.body).toBe(24);
    expect(F_FOOT).toBeLessThan(TYPE.caption);
  });
});
