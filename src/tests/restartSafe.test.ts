import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Restart-safe 契约测试（2026-11-17，对标 Setback 架构文档标准：
// "test by restarting 3x in a row — the third run must behave identically to
// the first. No stale references, lingering timers, leaked event listeners"）。
//
// 为什么不跑真场景：Phaser 场景生命周期（children/tween/timer 的真实行为）
// 在 node 里要一套完整桩，而 e2e（Playwright）已经覆盖了「真重启三连」的
// 运行时行为（见 docs/qa/LIFECYCLE_AUDIT.md 的实测记录）。本文件守的是
// **回归契约**——上面这些模式必须继续存在于源码里，任何一轮重构把清理
// 逻辑删了，这里先红。AG-82 的 e2e 实测（3 连重启对象/tween/timer 对比）
// 数字记录在 docs/qa/LIFECYCLE_AUDIT.md。

const sceneSrc = readFileSync('src/scenes/GameScene.ts', 'utf-8');
const menuSrc = readFileSync('src/scenes/MenuScene.ts', 'utf-8');
const audioSrc = readFileSync('src/systems/AudioSystem.ts', 'utf-8');
// RC-03 拆分第 3 步：教程四件随 TutorialController 迁走，先毁再建的首段现在
// 住在控制器里（init() 首段）——契约测试跟着搬家，不断言来源。
const tutorialControllerSrc = readFileSync('src/scenes/controllers/TutorialController.ts', 'utf-8');

describe('restart-safe contracts (Setback 标准，源码级)', () => {
  it('GameScene 的 SHUTDOWN 摘掉音乐与楼层级订阅', () => {
    // AG-74 起楼层 BGM，AG-82 e2e 实测确认：不摘就是跨局泄漏（第三局的
    // context 听着第二局的曲子）。SHUTDOWN 里必须有 stopBgm。
    expect(sceneSrc).toContain('stopBgm()');
    // 行商巡逻 timer（dae028b 修过泄漏）随 shutdown 收。
    expect(sceneSrc).toMatch(/shutdown[\s\S]*?traderPatrolTimer\?\.remove|traderPatrolTimer\?\.remove[\s\S]*?shutdown/);
  });

  it('三个覆盖层面板（帮助/关于/设置）在 create 里重置', () => {
    // 覆盖层的对象列表是 create 里 push 的；field initialiser 不重跑，
    // 不重置就会累积已销毁对象（重启第三次双份）。
    for (const list of ['helpObjects', 'aboutObjects']) {
      expect(menuSrc, `${list} 重置`).toContain(`this.${list} = [];`);
    }
    // 设置覆盖层：settingsOpen=false + panel 重建。
    expect(menuSrc).toContain('this.settingsOpen = false;');
  });

  it('教程对象（呼吸框/高亮框/跳过按钮）先毁再建', () => {
    // AG-73：场景重启不清显示列表（Phaser 4 shutdown 只空纹理），
    // TutorialController.init() 首段先销毁上一轮的（原 GameScene.initTutorial）。
    expect(tutorialControllerSrc).toContain('this.worldGfx?.destroy();');
    expect(tutorialControllerSrc).toContain('this.hudGfx?.destroy();');
    expect(tutorialControllerSrc).toContain('for (const o of this.skipParts) o.destroy();');
  });

  it('战斗舞台随 closeCombat 完整拆除', () => {
    // AG-70：combatStage/combatMonsterHit 活过整个战斗，closeCombat 必须拆。
    expect(sceneSrc).toContain('this.destroyCombatStage();');
  });

  it('音频手势监听用 once（一次触发自动摘，不跨局累积）', () => {
    expect(audioSrc).toContain("window.addEventListener('pointerdown', unlock, { once: true });");
    expect(audioSrc).toContain("window.addEventListener('keydown', unlock, { once: true });");
  });

  it('对象池模式：pendingAction 的 delayedCall 带身份比对', () => {
    // AG-66：换层/场景切换时旧的 delayedCall 不能落地（身份比对防旧 timer）。
    expect(sceneSrc).toMatch(/delayedCall[\s\S]*?身份|身份[\s\S]*?delayedCall/);
  });
});
