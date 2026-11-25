// 锁的生命周期：两把重入锁必须在每条可能的退出路径上都被放掉。
//
// 为什么这组断言必须存在（都是实际踩到的，不是理论推演）：
//
// 1. `repairInFlight` / `blackoutInFlight` 是「进入即置 true、finally 置 false」
//    的重入锁。一旦某条路径没放锁，后续所有维修调用都会在 `if (x) return;`
//    那一行静默返回——玩家点下去没反应、控制台没有报错，看起来像「按钮坏了」。
//
// 2. Phaser 的字段初始化器**不随场景重启重跑**。所以「维修在途时退出到标题
//    或重开一局」会让新场景继承上一局遗留的 true，于是新一局开局就永久不能
//    维修。这必须在 create() 里显式归位，和那里其他十几个字段一个道理。
//
// 3. 占位文案与 refreshDialogue 看似「不可能抛」，但那是「靠上游不抛」而不是
//    「结构上不可能漏锁」。它们必须在 try 里面，否则抛异常时 finally 覆盖不到。
//
// 断言读源码文本而不是调用函数：锁的语义是「装配是否正确」，纯函数测试证明
// 不了某条路径有没有被 try 包住。

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync(new URL('./GameScene.ts', import.meta.url), 'utf8');

/** 从 name 处开始截一段，够覆盖一个方法体即可。 */
function sliceFrom(marker: string, length = 2000): string {
  const at = SRC.indexOf(marker);
  expect(at, `找不到 ${marker}，说明方法被改名或删除，本断言已失效`).toBeGreaterThan(-1);
  return SRC.slice(at, at + length);
}

describe('重入锁生命周期：每条退出路径都要放锁', () => {
  it('create() 会把两把锁归位，重开一局不会继承上一局的 true', () => {
    // 只截 create() 开头一段：后面的 builder 会持续追加字段，截太长没有意义。
    const create = sliceFrom('create(): void {', 3000);
    // 关键前提再确认一次：create() 里确实有「字段初始化器不重跑」的说明，
    // 这解释了为什么必须手写重置。注释被删说明有人没理解这段，值得警惕。
    expect(create).toMatch(/handler|初始化器|initialiser/);
    expect(create).toContain('this.repairInFlight = false;');
    expect(create).toContain('this.blackoutInFlight = false;');
  });

  it('runAlinRepairPlan 的占位文案与 refreshDialogue 在 try 之内', () => {
    const fn = sliceFrom('private async runAlinRepairPlan(', 1400);
    const lockAt = fn.indexOf('this.repairInFlight = true;');
    const tryAt = fn.indexOf('try {');
    const placeholderAt = fn.indexOf('current.message = ');
    const refreshAt = fn.indexOf('this.refreshDialogue();');

    expect(lockAt).toBeGreaterThan(-1);
    expect(tryAt).toBeGreaterThan(-1);
    // 置锁之后、try 之前不允许有任何可能抛出的语句。
    expect(tryAt).toBeGreaterThan(lockAt);
    // 占位文案与 refreshDialogue 都必须落在 try 内部（索引更大即在后面）。
    expect(placeholderAt).toBeGreaterThan(tryAt);
    expect(refreshAt).toBeGreaterThan(tryAt);
  });

  it('runAlinRepairPlan 与 runBlackoutRepairPlan 都有 finally 放锁', () => {
    // 这两个窗口是按方法体实测长度定的，不是随手拍的数：
    // 截到 `finally` 分别是 504 / 1104 字符，截到放锁语句是 2959 / 1121。
    // 余量最小的是 alin 那条（还剩 41 字符）。所以方法体里加长注释时，宁可压缩
    // 注释，也不要加窗口——加窗口只是把红推后，下一次照样会撞上。
    const alin = sliceFrom('private async runAlinRepairPlan(', 3000);
    expect(alin).toMatch(/finally\s*\{[\s\S]{0,200}?this\.repairInFlight = false;/);

    const blackout = sliceFrom('private async runBlackoutRepairPlan(', 1500);
    expect(blackout).toMatch(/finally\s*\{[\s\S]{0,200}?this\.blackoutInFlight = false;/);
  });

  it('两把锁的置位都在 try 之前、放锁都在 finally 里（置位早于 try 才拦得住并发）', () => {
    for (const [marker, field] of [
      ['private async runAlinRepairPlan(', 'repairInFlight'],
      ['private async runBlackoutRepairPlan(', 'blackoutInFlight'],
    ] as const) {
      // 窗口要盖住整个方法体直到 finally 之后的放锁语句：这两个方法都夹着
      // 一大段注释，1500 字符不够，会误判成「没有放锁」。
      const fn = sliceFrom(marker, 4000);
      const setAt = fn.indexOf(`this.${field} = true;`);
      const tryAt = fn.indexOf('try {');
      const clearAt = fn.indexOf(`this.${field} = false;`);
      expect(setAt, `${field} 没有被置位`).toBeGreaterThan(-1);
      expect(setAt, `${field} 置位必须在 try 之前`).toBeLessThan(tryAt);
      expect(clearAt, `${field} 没有放锁`).toBeGreaterThan(tryAt);
    }
  });
});