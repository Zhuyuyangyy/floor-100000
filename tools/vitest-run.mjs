#!/usr/bin/env node
// `npm test` 的入口（package.json: "test": "node tools/vitest-run.mjs"）。
//
// 为什么需要这个 wrapper：Vitest 的 fsModuleCache（node_modules/.vitest-cache）
// 把每个模块的 SSR 变换结果落盘，缓存键是
//   sha1(模块绝对路径 id + 文件内容 + environmentHash)
// 而 environmentHash 只覆盖配置（root/base/mode/plugins/配置文件内容……），
// **不覆盖环境变量与 .env 文件**。Vite 的 SSR 变换会把 import.meta.env
// （含所有 VITE_* 变量）序列化成字面量烙进变换结果
// （`__vite_ssr_import_meta__.env = {...}`），于是：
//
//   1. 在带 .env.local（如 VITE_NPC_MODEL=npc-qwen:latest）的 worktree 里跑过
//      测试后，缓存条目里烙着那个模型名；
//   2. 删掉 .env.local 再跑，文件内容没变、配置没变 → 缓存命中 → 变换结果
//      依旧是烙着旧值的版本 → 依赖「无配置时默认关闭」的用例假失败
//      （AG-41 实测：删了 .env.local 也不失效）。
//   3. node_modules 是各 worktree 共享的 junction，缓存目录因此也是共享的，
//      污染条目会跨 worktree 堆积。
//
// 修法（治本，不是每次清缓存）：让缓存目录随「会影响变换结果的环境」变化。
//   缓存目录 = <共享缓存>/projects/<worktree 哈希>/env-<环境指纹>
//   - 环境指纹 = 进程里的 VITE_* 变量 + 项目根下全部 .env* 文件内容哈希
//     （这正是 Vite loadEnv 会烙进 import.meta.env 的两类输入）；
//   - 环境不变 → 目录不变 → 缓存照常命中（快）；
//   - 环境变了（建/删 .env.local、改 VITE_* 值）→ 目录变了 → 缓存未命中 →
//     按当前环境重新变换，旧环境烙进去的值不可能再被读到。
//
// 直接 `npx vitest run` 不走这个 wrapper，仍用默认共享目录；因此**在带
// .env.local 的 worktree 里必须用 `npm test`**（详见 docs/qa/TEST_ENV.md）。
// 约定的 `VITE_NPC_MODEL= npx vitest run` 前缀写法不受影响：进程 env 优先于
// 缓存里的 import.meta.env 回退值。

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SHARED_CACHE = join(ROOT, 'node_modules', '.vitest-cache');

const sha1 = (text) => createHash('sha1').update(text).digest('hex');

/**
 * 会烙进 import.meta.env 的全部输入：进程里的 VITE_* 变量 + 根目录下的
 * .env* 文件（Vite loadEnv 两类来源）。多算无害（只会多换一次目录），
 * 少算才会漏毒。
 */
function viteEnvFingerprint() {
  const parts = [];
  const keys = Object.keys(process.env)
    .filter((k) => k.toUpperCase().startsWith('VITE_'))
    .sort();
  for (const k of keys) parts.push(`${k}=${process.env[k] ?? ''}`);
  let envFiles;
  try {
    envFiles = readdirSync(ROOT).filter((f) => f.startsWith('.env')).sort();
  } catch {
    envFiles = [];
  }
  for (const f of envFiles) {
    const p = join(ROOT, f);
    try {
      if (!statSync(p).isFile()) continue;
      parts.push(`${f}=${sha1(readFileSync(p))}`);
    } catch {
      // 读不到的文件不可能被 Vite 读到，跳过
    }
  }
  return sha1(parts.join('\n'));
}

const vitestEntry = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const cacheDir = join(
  SHARED_CACHE,
  'projects',
  sha1(ROOT).slice(0, 12),
  `env-${viteEnvFingerprint().slice(0, 16)}`,
);

// 用户参数放在后面：cac 对重复选项后者生效，显式传了 --fsModuleCachePath
// 的人可以覆盖 wrapper 的选择。
const args = ['run', '--fsModuleCachePath', cacheDir, ...process.argv.slice(2)];

process.stderr.write(
  `[vitest-run] fsModuleCache: ${relative(ROOT, cacheDir)}\n`,
);

const result = spawnSync(process.execPath, [vitestEntry, ...args], {
  cwd: ROOT,
  stdio: 'inherit',
});
if (result.error) {
  process.stderr.write(`[vitest-run] 启动 vitest 失败：${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
