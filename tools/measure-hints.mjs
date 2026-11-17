// AG-71 一次性测量脚本：量 contextual 槽候选文案与固定槽标签在 20px GameSans
// 下的像素宽度——NAV_BAR 的 contextW/slotW 就是按这里的数字定的（单位测试
// src/tests/hudNav.test.ts 钉着同样的数）。跑前起 5471 dev server：
//   node tools/measure-hints.mjs
import { chromium } from '@playwright/test';

// contextual 槽的全部候选串：世界链（按 E ×× / 忙碌 / 环境）+ 面板链
// （openPanelHint 的既有分支，含战斗）。最长的一条决定槽宽。
const HINTS = [
  'A/D 或 ←/→ 移动 · E 交互', // AG-71 缩短后的默认脚注（I/C/G/M/Esc 已常驻导航条）
  '按 E 打开 储物柜',
  '按 E 打开 邻居货架',
  '按 E 打开 木箱',
  '按 E 挖开这堆瓦砾',
  '按 E 乘货运电梯',
  '按 E 查看问号点',
  '按 E 翻翻自己的床',
  '按 E 安排夜间行动',
  '按 E 制作',
  '按 E 对话',
  '按 E 上楼 · F 抄近路（120 金）',
  '按 E 上楼',
  '按 E 下楼',
  '需要铲子才能挖开这堆瓦砾（撬棍也行）',
  '翻找床垫中……',
  '挖开瓦砾中……',
  '此地漏水，地面物资受潮',
  '↑/↓ 选择 · Enter 出招 · ESC 撤退',
  '↑/↓ 选择 · Enter 制作 · 拖拽平移 · 滚轮缩放 · C 关闭',
  '↑/↓ 选择 · Enter 使用 · I 关闭',
  '↑/↓ 选择 · Enter 入股 · G 关闭',
  '↑/↓ 选择 · Enter 确认 · ESC 今晚再想想',
  '↑/↓ 选择 · Enter 买入 · S 卖出 · ESC 离开',
  'Enter 睡觉 · ESC 返回',
  '↑/↓ 选择 · Enter 确认 · ESC 继续',
];

// 五个固定槽的标签（最宽的「菜单 Esc」+ 图标 16 + 间隔 6 决定槽内组宽）。
const SLOTS = ['背包 I', '制作 C', '产业 G', '地图 M', '菜单 Esc'];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto('http://localhost:5471/?seed=42');
await page.waitForFunction(() => document.fonts.check("20px 'GameSans'"), null, { timeout: 20000 });
const widths = await page.evaluate(({ hints, slots }) => {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = "20px 'GameSans'";
  const out: Array<{ h: string; w: number }> = [];
  for (const h of hints) out.push({ h, w: Math.ceil(ctx.measureText(h).width) });
  for (const s of slots) out.push({ h: `[槽] ${s}`, w: Math.ceil(ctx.measureText(s).width) });
  return out;
}, { hints: HINTS, slots: SLOTS });
for (const { h, w } of widths) console.log(String(w).padStart(5), h);
await browser.close();
