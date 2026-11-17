import { describe, expect, it } from 'vitest';
import { zhCN } from '../data/i18n/zh-CN';
import { enUS } from '../data/i18n/en-US';
import type { I18nKey } from '../data/i18n/index';

// AG-78 词典骨架的对齐测试。三条硬约束（任务书钉死）：
//   1. 两字典 key 完全对齐；
//   2. 每个 key 的 {name} 占位符数量一致（顺带钉名称一致）；
//   3. 英文显示宽度不超过中文的 3 倍。
//
// 长度为什么按「显示列宽」而不是 .length：中文是宽字符（等宽字体下占 2 列），
// 按 code point 数比会让「高 → High」这类合理译法直接判死（3 < 4），而按 UTF-8
// 字节比更失真（一个汉字 3 字节）。列宽是游戏 UI 文本框真正吃掉的量，
// 也是 i18n 长度规则的通行做法（Android string length / ICU 同思路）。
//   - CJK 及全角（U+2E80 起，含「」·。等）计 2 列；
//   - 其余（ASCII、拉丁扩展、箭头 ←/→、乘号 × 等）计 1 列。
const PLACEHOLDER = /\{(\w+)\}/g;

function placeholders(s: string): string[] {
  return [...s.matchAll(PLACEHOLDER)].map((m) => m[1]);
}

function displayWidth(s: string): number {
  let width = 0;
  for (const ch of s) {
    width += (ch.codePointAt(0) ?? 0) > 0x2e80 ? 2 : 1;
  }
  return width;
}

const zhKeys = Object.keys(zhCN) as I18nKey[];
const enKeys = Object.keys(enUS) as I18nKey[];

describe('i18n 词典骨架（AG-78）', () => {
  it('zh-CN 与 en-US 的 key 完全对齐（数量 + 集合）', () => {
    expect(new Set(enKeys)).toEqual(new Set(zhKeys));
    expect(enKeys.length).toBe(zhKeys.length);
    // 骨架不该是空壳：至少覆盖全部标签域 + 叙事抽样
    expect(zhKeys.length).toBeGreaterThanOrEqual(300);
  });

  it('所有 value 非空、无首尾空白', () => {
    for (const key of zhKeys) {
      const zh = zhCN[key];
      const en = enUS[key];
      expect(zh.trim(), `zh ${key}`).toBe(zh);
      expect(en.trim(), `en ${key}`).toBe(en);
      expect(zh.length, `zh ${key}`).toBeGreaterThan(0);
      expect(en.length, `en ${key}`).toBeGreaterThan(0);
    }
  });

  it('每个 key 的 {name} 占位符名称与数量一致', () => {
    const mismatches: string[] = [];
    for (const key of zhKeys) {
      const zh = placeholders(zhCN[key]).sort();
      const en = placeholders(enUS[key]).sort();
      if (zh.join(',') !== en.join(',')) mismatches.push(`${key}: zh[${zh}] vs en[${en}]`);
    }
    expect(mismatches).toEqual([]);
  });

  it('英文显示宽度不超过中文的 3 倍', () => {
    const overflows: string[] = [];
    for (const key of zhKeys) {
      const zhWidth = displayWidth(zhCN[key]);
      const enWidth = displayWidth(enUS[key]);
      if (enWidth > zhWidth * 3) {
        overflows.push(`${key}: en ${enWidth} > zh ${zhWidth} * 3`);
      }
    }
    expect(overflows).toEqual([]);
  });

  it('key 命名符合 <域>.<对象>[.<属性>] 规范', () => {
    const bad = zhKeys.filter((key) => !/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/.test(key));
    expect(bad).toEqual([]);
  });
});
