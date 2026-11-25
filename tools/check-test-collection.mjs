#!/usr/bin/env node
// 测试集合门禁：守的是「被收集的测试没有被静默缩小」，不是「测试都通过了」。
//
// 这两件事必须分开表达。通过与否由 `npm run test:ci` 自己的退出码表达——
// 它红了，本步骤在 CI 里根本不会执行；本脚本只在「跑完了、而且全绿」的
// 前提下追加一个独立维度：到底跑了多少。混在一起写成「有没有 failed > 0」，
// 既有重复之嫌，又会诱使后来的人为了消掉重复告警去加 continue-on-error，
// 那时真红和假红就再也分不开了。
//
// 数字来源：2026-11-26 在本仓库实测，口径是「被收集」而不是「被执行」——
// 84 passed + 2 skipped 个文件，1198 passed + 6 skipped 条用例。那 2 个文件
// 与 6 条用例是 spark 真机联调，靠 describe.skipIf(!LIVE) 在无 LIVE 时才跳过；
// 它们仍属于集合，删掉它们理应让门禁红，所以按 86 / 1204 计入。
//
// 它是下限不是等值：加测试照常绿，删测试必须过不去。真要删，就同步改下面的
// 常量，让「测试变少了」这件事在 diff 里留下痕迹，而不是悄悄发生。
import { readFileSync } from 'node:fs';

const REPORT = process.env.VITEST_REPORT ?? 'test-results/vitest-report.json';
const MIN_FILES = 86;
const MIN_TESTS = 1204;

let report;
try {
  report = JSON.parse(readFileSync(REPORT, 'utf8'));
} catch (err) {
  // 产物缺失不能当成「没什么可校验的」而放行：那等于门禁静默失效，
  // 比没有门禁更糟，因为所有人都会以为它在守。
  console.error(`FAIL 读不到测试报告 ${REPORT}`);
  console.error(`     ${err instanceof Error ? err.message : String(err)}`);
  console.error('     先跑 npm run test:ci；若改了输出路径，同步改 VITEST_REPORT。');
  process.exit(1);
}

// testResults 的长度才是「被收集的文件数」。不要用 numTotalTestSuites：
// 那个数是 describe 块的数量（当前 368），和文件数不是一回事。
const files = Array.isArray(report.testResults) ? report.testResults.length : 0;
// numTotalTests 含 skipped / todo——这里要的是集合大小，不是执行结果。
const tests = Number(report.numTotalTests ?? 0);

const problems = [];
if (files < MIN_FILES) problems.push(`文件数 ${files} < 下限 ${MIN_FILES}`);
if (tests < MIN_TESTS) problems.push(`用例数 ${tests} < 下限 ${MIN_TESTS}`);

console.log(`测试集合：文件 ${files}（下限 ${MIN_FILES}），用例 ${tests}（下限 ${MIN_TESTS}）`);

if (problems.length > 0) {
  console.error('FAIL 测试集合被缩小了：');
  for (const p of problems) console.error(`     ${p}`);
  console.error('     如果是有意删测试，改 tools/check-test-collection.mjs 里的下限并写明理由。');
  console.error('     如果是 include 被收窄或 test 脚本被改，把它改回去。');
  process.exit(1);
}

console.log('OK 测试集合没有缩小');