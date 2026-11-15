import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FullConfig } from '@playwright/test';

// The dev-server identity guard (globalSetup).
//
// Why this exists: `reuseExistingServer: !CI` means every Playwright run
// reuses whatever already answers on the port. strictPort only guards the
// PORT — it cannot see the CODE behind it. A dev server rooted in another
// worktree (the main workspace, a wiring branch, a leftover from a finished
// session) answers the health check just fine, and the whole suite then runs
// against someone else's source: green runs that tested the wrong code, red
// runs that were never broken. That is the exact failure this guard makes
// loud.
//
// How it fingerprints: fetch one module over HTTP and compare the source the
// server actually compiled — decoded from the inline sourcemap's
// `sourcesContent` — against the same file read from disk HERE. Vite's TS
// transform drops some comment blocks, so comparing the transformed output
// (or its comment lines) against the source is invalid; sourcesContent is the
// verbatim original and compares byte-exact.
//
// Why GameScene.ts: it is the module every feature branch touches, so it is
// the most likely to differ between worktrees. A file nobody edits would
// fingerprint every branch the same and let a foreign server pass.
//
// Timing and the empty-port case: globalSetup runs once before the suite. If
// nothing answers on the port there is nothing to mis-reuse, the guard passes
// trivially, and Playwright then starts its own server with the config
// directory as cwd — which is this worktree by construction. If something
// DOES answer, it is either this worktree's own leftover server (fingerprint
// matches, reuse is safe) or a foreign one (mismatch → fail before any test
// runs).

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const PROBE_PATH = 'src/scenes/GameScene.ts';
const DEFAULT_BASE_URL = 'http://localhost:5199';
const FETCH_TIMEOUT_MS = 15_000;

const md5 = (text: string): string => createHash('md5').update(text, 'utf8').digest('hex');

/** Compare on normalized line endings so a CRLF/LF mismatch is never a false alarm. */
const sameSource = (a: string, b: string): boolean =>
  a === b || a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');

function fail(message: string): never {
  throw new Error(
    `[server-identity] ${message}\n` +
      '5199 上复用的 dev server 服务的不是本 worktree 的代码——整轮 e2e 会静默测错分支。\n' +
      '处置：停掉那个服务（或换一个没有服务占用的端口）后重跑；' +
      '确要复用，请确认它就是本 worktree 的 dev server。',
  );
}

export default async function verifyServerIdentity(config: FullConfig): Promise<void> {
  const baseURL =
    (config.projects[0]?.use as { baseURL?: string } | undefined)?.baseURL ?? DEFAULT_BASE_URL;

  let body: string;
  try {
    const response = await fetch(`${baseURL}/${PROBE_PATH}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      fail(`${baseURL} 回答了 ${response.status}，无法读取 ${PROBE_PATH}（它 serve 的不是本仓库的 dev server）`);
    }
    body = await response.text();
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } })?.code ??
      (error as { cause?: { code?: string } })?.cause?.code;
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH') {
      // Nothing on the port: Playwright starts its own server in this worktree.
      return;
    }
    if (error instanceof Error && error.name === 'TimeoutError') {
      fail(`${baseURL} 在 ${FETCH_TIMEOUT_MS}ms 内没有回答身份探针（外来服务过慢或已僵死）`);
    }
    fail(`探测 ${baseURL} 失败：${error instanceof Error ? error.message : String(error)}`);
  }

  const match = body.match(/sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)/);
  if (!match) {
    fail(
      `${baseURL} 的 ${PROBE_PATH} 没有内联 sourcemap——它不是本仓库的 vite dev server` +
        '（可能是生产构建预览、或根目录在别处的服务）',
    );
  }
  const map = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')) as {
    sourcesContent?: Array<string | null>;
  };
  const served = map.sourcesContent?.[0];
  if (typeof served !== 'string') {
    fail(`${baseURL} 的 sourcemap 缺少 sourcesContent，无法核对服务身份`);
  }

  let local: string;
  try {
    local = readFileSync(join(REPO_ROOT, PROBE_PATH), 'utf8');
  } catch {
    fail(`本 worktree 读不到 ${PROBE_PATH}（工作树不完整？）`);
  }

  if (!sameSource(served, local)) {
    fail(
      `${baseURL} 服务的 ${PROBE_PATH} 与本 worktree 不同` +
        `（server md5 ${md5(served)} vs 本地 md5 ${md5(local)}）`,
    );
  }
}
