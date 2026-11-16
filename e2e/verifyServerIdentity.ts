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
// How it fingerprints: fetch modules over HTTP and compare the source the
// server actually compiled — decoded from the inline sourcemap's
// `sourcesContent` — against the same files read from disk HERE. Vite's TS
// transform drops some comment blocks, so comparing the transformed output
// (or its comment lines) against the source is invalid; sourcesContent is
// the verbatim original and compares byte-exact.
//
// Why several modules, not one: the original guard probed GameScene.ts alone
// (the module every feature branch touches). That is a heuristic — two trees
// that diverged anywhere else pass the check and the suite silently tests
// the foreign tree's code, which is the exact failure class this guard
// exists for. The probe list below is the set of modules nearly every work
// order touches; any divergence in any of them fails the run before a
// single test executes. A file nobody edits would fingerprint every branch
// the same and let a foreign server pass, so the list stays short and hot.
//
// Timing and the empty-port case: globalSetup runs once before the suite. If
// nothing answers on the port there is nothing to mis-reuse, the guard passes
// trivially, and Playwright then starts its own server with the config
// directory as cwd — which is this worktree by construction. If something
// DOES answer, it is either this worktree's own leftover server (fingerprint
// matches, reuse is safe) or a foreign one (mismatch → fail before any test
// runs).
//
// Residual risk (documented, not closed here): between this probe and
// Playwright's webServer step a foreign server could bind the port and be
// reused (the "抢驻窄窗"). The structural mitigation is a dedicated port —
// see e2e/playwright.ag32.config.ts, which runs its suite on 5420 for
// exactly this reason.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');

// Hot modules: nearly every work order touches at least one of them. Adding
// a file here only ever makes the guard stricter (fail loud), never looser.
const PROBE_PATHS = [
  'src/scenes/GameScene.ts',
  'src/core/config.ts',
  'src/core/constants.ts',
  'src/core/segments.ts',
  'src/core/tower.ts',
  'src/data/npcs.ts',
];
const DEFAULT_BASE_URL = 'http://localhost:5199';
const FETCH_TIMEOUT_MS = 15_000;

const md5 = (text: string): string => createHash('md5').update(text, 'utf8').digest('hex');

/** Compare on normalized line endings so a CRLF/LF mismatch is never a false alarm. */
const sameSource = (a: string, b: string): boolean =>
  a === b || a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');

function fail(message: string): never {
  throw new Error(
    `[server-identity] ${message}\n` +
      '端口上复用的 dev server 服务的不是本 worktree 的代码——整轮 e2e 会静默测错分支。\n' +
      '处置：停掉那个服务（或换一个没有服务占用的端口）后重跑；' +
      '确要复用，请确认它就是本 worktree 的 dev server。',
  );
}

/**
 * The server Playwright would talk to. Playwright merges the top-level `use`
 * into every project's `use` before this hook runs (verified empirically:
 * a config that sets baseURL only at the top level still reports it on
 * projects[0].use), so reading the project is enough for every config in
 * this repo — main (5199), hud (5175), qa (5183), ag32 (5420).
 */
function resolveBaseURL(config: FullConfig): string {
  return (
    (config.projects[0]?.use as { baseURL?: string } | undefined)?.baseURL ?? DEFAULT_BASE_URL
  );
}

export default async function verifyServerIdentity(config: FullConfig): Promise<void> {
  const baseURL = resolveBaseURL(config);
  const mismatches: string[] = [];

  for (const [probeIndex, probePath] of PROBE_PATHS.entries()) {
    let body: string;
    try {
      const response = await fetch(`${baseURL}/${probePath}`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        fail(`${baseURL} 回答了 ${response.status}，无法读取 ${probePath}（它 serve 的不是本仓库的 dev server）`);
      }
      body = await response.text();
    } catch (error) {
      const code = (error as { code?: string; cause?: { code?: string } })?.code ??
        (error as { cause?: { code?: string } })?.cause?.code;
      const refused = code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH';
      // Only the FIRST probe may conclude "nothing on the port" — that is the
      // empty-port case where Playwright starts its own server here. A refusal
      // on a later probe means the server died mid-fingerprint: loud, not pass.
      if (probeIndex === 0 && refused) {
        return;
      }
      if (error instanceof Error && error.name === 'TimeoutError') {
        fail(`${baseURL} 在 ${FETCH_TIMEOUT_MS}ms 内没有回答身份探针 ${probePath}（外来服务过慢或已僵死）`);
      }
      fail(`探测 ${baseURL}/${probePath} 失败：${error instanceof Error ? error.message : String(error)}`);
    }

    const match = body.match(/sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)/);
    if (!match) {
      fail(
        `${baseURL} 的 ${probePath} 没有内联 sourcemap——它不是本仓库的 vite dev server` +
          '（可能是生产构建预览、或根目录在别处的服务）',
      );
    }
    const map = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')) as {
      sourcesContent?: Array<string | null>;
    };
    const served = map.sourcesContent?.[0];
    if (typeof served !== 'string') {
      fail(`${baseURL} 的 ${probePath} sourcemap 缺少 sourcesContent，无法核对服务身份`);
    }

    let local: string;
    try {
      local = readFileSync(join(REPO_ROOT, probePath), 'utf8');
    } catch {
      fail(`本 worktree 读不到 ${probePath}（工作树不完整？）`);
    }

    if (!sameSource(served, local)) {
      mismatches.push(`${probePath}（server md5 ${md5(served)} vs 本地 md5 ${md5(local)}）`);
    }
  }

  if (mismatches.length > 0) {
    fail(`${baseURL} 服务的代码与本 worktree 不同：${mismatches.join('；')}`);
  }
}
