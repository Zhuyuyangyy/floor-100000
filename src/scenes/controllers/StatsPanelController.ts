// AG-81：本局统计面板（暂停菜单 → 只读子面板）——RC-03 拆分第 1 步。
// 从 GameScene 迁出（原 GameScene.ts 6750-6838 段 + 模块级 STATS_PANEL_W/H
// 常量 + statsObjects/statsTableObjects/statsOpen 三个字段），行为零变更：
// 同一构造路径、同一刷新语义、同一几何常量，迁移只是换住处。
//
// 形态（设计文档 §2）：plain TS 类，**不 import Phaser 场景类型**——
//   * 构造时拿 host（运行期即 GameScene 本身，结构面见 StatsPanelHost）与
//     共享统计表构建件；Node 下可用记录型假件单测（本文件的 import 链——
//     render/panels、render/uiKit、render/palette、render/hudLayout、
//     render/audio、systems/StatsSystem、core/session——均无 Phaser 值导入）。
//   * buildStatsTable 住在 EndScene（值导入 Phaser），按设计「可单测」要求
//     改为构造注入 + import type 取签名，不把 Phaser 拖进 Node 测试图。
//   * 三个共享渲染件（buildPanel/buildPanelHeader/注入的 buildStatsTable）
//     第一参钉死场景类型且签名不许改（EndScene/EndgameScene 同参），此处用
//     从共享件签名反推的 SharedPanelScene 做唯一一处收窄——运行期 host 就是
//     GameScene 实例（GameScene 字段初始化器 `new StatsPanelController(this,
//     buildStatsTable)`），本类自身的方法面不出现场景类型。
//   * 显示器持有并管理自己的 GameObjects：面板框/页眉/表格行件/脚注的生命
//     周期全在本类，GameScene 只留 openStatsPanel/closeStatsPanel 两行委托、
//     create 的 build/reset 与 StatsPanelHost 的两处协调面。
//
// 布局：480×330 绿板，16 行统计两列网格（8 行 × STATS_PANEL.rowPitch），
// 行件与死亡/通关结算共用 buildStatsTable——「一局的账」三个画面同一张脸。
// 纪录对比不在这里：跨局纪录是结局时刻的炫耀，见 EndScene / EndgameScene。
//
// QA-01（P1）根因：表格文本曾在 build 时由当次 runStatRows(getGame()) 生成
// 一次，游玩中累积的爬梯/开箱/击杀/伤害永远停在开局零值。表格因此改为每次
// 打开整池重建（refresh），而不是 create() 的一次性快照。

import type Phaser from 'phaser';
import { applyPanelDepth, buildPanel, PANEL_DEPTH, type PanelObject } from '../../render/panels';
import { buildPanelHeader, FONT_FAMILY, TYPE, UI } from '../../render/uiKit';
import { TEXT, hex } from '../../render/palette';
import { STATS_PANEL } from '../../render/hudLayout';
import { playSfx } from '../../render/audio';
import { getGame } from '../../core/session';
import { runStatRows } from '../../systems/StatsSystem';
import type { buildStatsTable } from '../EndScene';

/** AG-81 统计面板的画布尺寸。表格每次打开都按当前 state 重建（QA-01），
 * build/refresh/open 三处与 panelBox 必须同源——各写一遍 480/330 正是旧代码
 * 允许漂移的口子（迁自 GameScene 模块级常量，三个使用点全部随迁）。 */
const STATS_PANEL_W = 480;
const STATS_PANEL_H = 330;

/** 「鼠标 ESC：面板外点击关闭」的判据矩形（场景 panelBox 的同款几何）。 */
export interface PanelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 控制器需要场景提供的最小面（GameScene 天然满足；单测用假件实现）。
 * 刻意不 import Phaser.Scene：本类的可测性靠这层结构面，而不是靠能造真场景。
 */
export interface StatsPanelHost {
  /** Phaser 的 GameObject 工厂——面板件（框/页眉/脚注）都从它出生。 */
  add: Phaser.GameObjects.GameObjectFactory;
  /** 当前视口尺寸（场景 viewSize() 的同口径：相机 zoom 修正后的画布尺寸）。 */
  viewSize(): { width: number; height: number };
  /** 打开统计面板时藏起暂停菜单、关闭时恢复（pauseObjects 归场景管）。 */
  setPauseMenuVisible(visible: boolean): void;
  /** panelBox 是场景级「面板外点击 = 鼠标 ESC」判据，开关时随面板几何走。 */
  setPanelBox(box: PanelBox): void;
  /** dev 空面板守卫（场景的同款实现）：面板建好当场自查可读文本。 */
  assertPanelContent(panel: string, objects: ReadonlyArray<Phaser.GameObjects.GameObject>): void;
}

/**
 * 三个共享渲染件第一参的场景类型——从共享件签名反推，本文件因此不 import
 * 场景类型。共享件签名是边界冻结的（EndScene/EndgameScene 同参），它们改签名
 * 时这里跟着报错，不会静默漂移。
 */
type SharedPanelScene = Parameters<typeof buildPanel>[0];

export class StatsPanelController {
  /** 面板框/页眉/脚注（build 时建一次，场景重启随 reset 清空）。 */
  private panelObjects: PanelObject[] = [];
  /** QA-01：表格行件单列一池——打开时整池销毁重建（refresh），与面板其余
   * 部分（build 时建一次）分开管。 */
  private tableObjects: PanelObject[] = [];
  private opened = false;

  constructor(
    private readonly host: StatsPanelHost,
    private readonly buildTable: typeof buildStatsTable,
  ) {}

  /** 面板是否开着（场景的 ESC 分支/按键门禁/脚注Hint 读这一位）。 */
  get isOpen(): boolean {
    return this.opened;
  }

  /**
   * 见 SharedPanelScene：仅供共享渲染件调用的一次性场景收窄——本类方法面
   * 不出现场景类型，host 在运行期就是 GameScene 实例。
   */
  private get sharedScene(): SharedPanelScene {
    return this.host as unknown as SharedPanelScene;
  }

  /**
   * create() 首建：面板框 + 页眉 + 表格 + 脚注，全部不可见。
   * 表格委托 refresh()——内联构建就是旧快照 bug 的形态。
   */
  build(): void {
    const { width, height } = this.host.viewSize();
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - STATS_PANEL_W / 2;
    const top = cy - STATS_PANEL_H / 2;
    const scene = this.sharedScene;

    this.panelObjects.push(...buildPanel(scene, cx, cy, STATS_PANEL_W, STATS_PANEL_H, 'green', PANEL_DEPTH.game.pause));
    this.panelObjects.push(...buildPanelHeader(scene, left, top, STATS_PANEL_W, '本局统计', UI.good, PANEL_DEPTH.game.pause + 5));
    this.refresh();
    this.panelObjects.push(
      this.host.add
        .text(cx, top + STATS_PANEL_H - 16, '历史纪录见死亡 / 通关结算画面', {
          fontFamily: FONT_FAMILY,
          fontSize: `${TYPE.caption}px`,
          color: hex(TEXT.dim),
        })
        .setOrigin(0.5),
    );
    applyPanelDepth(this.panelObjects, PANEL_DEPTH.game.pause);
    this.host.assertPanelContent('stats', this.panelObjects);
    for (const o of this.panelObjects) o.setVisible(false);
  }

  /**
   * 场景重启：Phaser 关场景时已销毁上一局的 GameObjects，且字段初始化器不
   * 重跑（GameScene create() 里各对象池的重置惯例）——清池与开关标志，
   * 不 destroy。create() 在 build() 前调它。
   */
  reset(): void {
    this.panelObjects = [];
    this.tableObjects = [];
    this.opened = false;
  }

  /**
   * QA-01：按当前 state 重建统计表格——暂停面板每次打开都走这里。
   *
   * 为什么是「打开时整池销毁重建」而不是「存行件 setText」：
   * ① runStatRows(getGame()) 是唯一数据源，重建走的正是 build() 首建同一
   *    条构造路径，面板内容永远不可能与数据函数漂移；setText 按索引刷要求
   *    行序/行数被两处分别记住，上游哪天改行数（STAT_KEYS 或末尾三项）就
   *    静默错位——QA 这类「数字对不上」的 bug 正是那么养出来的。
   * ② 代码库同款先例在手：EndgameScene.buildMode 切模式即销毁重建整池，
   *    GameScene create() 重启 likewise 重置对象池重建。
   * ③ 成本可忽略：16 行 × 2 个 Text，且只在人类打开暂停子面板时发生——
   *    面板不可见时刷新才是浪费（QA 建议的「打开时刷新」语义）。
   * ④ 不动共享件 buildStatsTable 的签名（EndScene/EndgameScene 零改动）。
   *
   * 几何用当前 viewSize 与 STATS_PANEL_W/H 常量：面板框在 build() 时按
   * 当时画布定位，表格跟随打开时刻的画布——两者同源常量化，不存在漂移。
   */
  private refresh(): void {
    if (this.tableObjects.length > 0) {
      const stale = new Set<PanelObject>(this.tableObjects);
      for (const o of this.tableObjects) o.destroy();
      this.tableObjects = [];
      this.panelObjects = this.panelObjects.filter((o) => !stale.has(o));
    }
    const { width, height } = this.host.viewSize();
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - STATS_PANEL_W / 2;
    const top = cy - STATS_PANEL_H / 2;
    const colW = (STATS_PANEL_W - 32 - STATS_PANEL.colGap) / 2;
    const grid = this.buildTable(this.sharedScene, left + 16, top + 46, colW, runStatRows(getGame()), PANEL_DEPTH.game.pause + 5, 2);
    this.tableObjects.push(...grid.objects);
    this.panelObjects.push(...grid.objects);
    // 与 build() 首建同款收尾：锁屏 + 深度归位（网格件非 PANEL_OWNED，
    // 压到 pause 深度），可见性跟随 opened——刷新不是显示开关
    // （refreshInventory 的同款约定：不可见时刷新不得把内容浮上屏）。
    applyPanelDepth(grid.objects, PANEL_DEPTH.game.pause);
    for (const o of grid.objects) o.setVisible(this.opened);
  }

  /** 打开统计面板：暂停菜单让位（pauseOpen 不变——游戏仍然暂停着）。 */
  open(): void {
    this.opened = true;
    // QA-01：先按当前 state 重建表格再显形——旧代码只切可见性，面板永远
    // 显示 build() 时刻的快照（QA 第 0 轮 20a 截图：游玩后全 0）。
    this.refresh();
    for (const o of this.panelObjects) o.setVisible(true);
    this.host.setPauseMenuVisible(false);
    // 面板矩形现取统计面板自己的（STATS_PANEL_W/H，与 build/refresh 同源）：
    // 点它外面 = ESC 返回暂停菜单（onEsc 的 isOpen 分支），与暂停菜单既有的
    // 「点外面关面板」同构。
    const { width, height } = this.host.viewSize();
    this.host.setPanelBox({ x: width / 2 - STATS_PANEL_W / 2, y: height / 2 - STATS_PANEL_H / 2, w: STATS_PANEL_W, h: STATS_PANEL_H });
    playSfx('panel');
  }

  /** 关闭统计面板，回到暂停菜单。 */
  close(): void {
    this.opened = false;
    for (const o of this.panelObjects) o.setVisible(false);
    this.host.setPauseMenuVisible(true);
    const { width, height } = this.host.viewSize();
    // 暂停菜单面板 460×304 的居中盒（buildPausePanel 的 panelBox 同源）。
    this.host.setPanelBox({ x: width / 2 - 230, y: height / 2 - 152, w: 460, h: 304 });
    playSfx('panel');
  }

  /**
   * 只收面板可见性，不动暂停菜单——togglePause 连关「暂停+统计」走这条：
   * 暂停菜单的显隐紧接着由调用方自己的 pauseObjects 一趟做完，走 close() 会
   * 多出还菜单 + panelBox 复位 + 一记音效（那是 ESC/鼠标单收统计面板的路）。
   */
  hide(): void {
    this.opened = false;
    for (const o of this.panelObjects) o.setVisible(false);
  }
}
