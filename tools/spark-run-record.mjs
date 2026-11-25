// Spark 真实推理运行记录采集器。
//
// 目的：给评选/复核留下可核验的「真机跑过」证据，而不是一句“已接通”。
// 采集的是传输层事实：HTTP 状态、耗时、token 数、thinking 长度、正文长度、
// 是否被截断、以及最终解析出的动作。不含地址、Token 或任何凭据。
//
// 用法：
//   SPARK_URL=http://127.0.0.1:11434 SPARK_MODEL=npc-qwen:latest \
//   node tools/spark-run-record.mjs
//
// 输出：artifacts/spark-runs/<model>-<utc>.json

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const URL_BASE = process.env.SPARK_URL ?? 'http://127.0.0.1:11434';
const MODEL = process.env.SPARK_MODEL ?? 'npc-qwen:latest';
const COMMIT = process.env.GIT_COMMIT ?? 'unknown';
const RUNS = Number(process.env.SPARK_RUNS ?? '3');

const CASES = [
  {
    id: 'alin-first-meet',
    system: '你是《第100000层：末日宿舍》中的 NPC「阿林」（维修工）。铁律：只从可用行动里选一个；不得声称拥有背包里没有的物品；不得提及任何数值。只输出一个 JSON 对象。',
    user: '情境：第1天 09:20，第2层。我的状态：信任=35，HP=30，饥饿=20。我的背包：空。玩家背包：wood×2、tape×1。玩家状态：HP=40。相关记忆：（尚无共同经历）。门禁 alin-repair-gate：closed。可用行动：observe, give, repair_gate。输出契约：{"utterance":"说的话，60字以内","action":{"type":"dialogue|trade|gift|refuse","itemId":"","quantity":1,"text":""},"confidence":0到1}',
  },
  {
    id: 'alin-high-trust',
    system: '你是《第100000层：末日宿舍》中的 NPC「阿林」（维修工）。铁律：只从可用行动里选一个；不得声称拥有背包里没有的物品。只输出一个 JSON 对象。',
    user: '情境：第2天 08:00，第2层。我的状态：信任=78，HP=30。我的背包：空。玩家背包：wood×2、tape×1。相关记忆：第1天 玩家赠送木材×2；第1天 玩家在危险时没有抛弃我。门禁 alin-repair-gate：closed。可用行动：observe, give, repair_gate。输出契约：{"utterance":"说的话，60字以内","action":{"type":"dialogue|trade|gift|refuse","itemId":"","quantity":1,"text":""},"confidence":0到1}',
  },
];

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function callOnce(model, system, user) {
  const started = Date.now();
  const res = await fetch(`${URL_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      format: 'json',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      options: { temperature: 0.7, num_predict: 192 },
    }),
  });
  const wallMs = Date.now() - started;
  if (!res.ok) return { http: res.status, wallMs, error: 'non_2xx' };
  const data = await res.json();
  const content = data?.message?.content ?? '';
  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = null;
  }
  return {
    http: res.status,
    wallMs,
    doneReason: data?.done_reason ?? null,
    evalCount: data?.eval_count ?? null,
    thinkingChars: (data?.message?.thinking ?? '').length,
    contentChars: content.length,
    // 空正文 + length 截断 = R1 的失败症状；这里显式记下来供对照。
    emptyContent: content.trim().length === 0,
    parsed,
  };
}

async function main() {
  const records = [];
  for (const testCase of CASES) {
    for (let i = 1; i <= RUNS; i += 1) {
      let result;
      try {
        result = await callOnce(MODEL, testCase.system, testCase.user);
      } catch (error) {
        result = { http: null, wallMs: null, error: String(error).slice(0, 120) };
      }
      records.push({ case: testCase.id, run: i, ...result });
      const flag = result.emptyContent ? 'EMPTY' : result.parsed ? 'OK' : 'UNPARSED';
      console.log(`${testCase.id} #${i}: ${flag} ${result.wallMs}ms eval=${result.evalCount ?? '-'} thinking=${result.thinkingChars ?? '-'}`);
    }
  }

  const ok = records.filter((r) => r.parsed !== null && !r.emptyContent);
  const durations = ok.map((r) => r.wallMs).sort((a, b) => a - b);
  const p95 = durations.length > 0 ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))] : null;
  const summary = {
    total: records.length,
    validProposals: ok.length,
    emptyContent: records.filter((r) => r.emptyContent).length,
    unparsed: records.filter((r) => !r.emptyContent && r.parsed === null).length,
    medianMs: durations.length > 0 ? durations[Math.floor(durations.length / 2)] : null,
    p95Ms: p95,
    medianEvalCount: ok.length > 0 ? ok.map((r) => r.evalCount).sort((a, b) => a - b)[Math.floor(ok.length / 2)] : null,
  };

  const payload = {
    schema: 'spark-run-record/v1',
    commit: COMMIT,
    model: MODEL,
    generatedAt: new Date().toISOString(),
    settings: { think: false, format: 'json', temperature: 0.7, num_predict: 192 },
    summary,
    records,
  };

  const outDir = 'artifacts/spark-runs';
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${MODEL.replace(/[^A-Za-z0-9._-]/g, '_')}-${nowStamp()}.json`);
  writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`\nsummary: ${JSON.stringify(summary)}`);
  console.log(`written: ${outFile}`);
  // 空正文比例高时返回非零，便于 CI 直接拦。
  if (summary.emptyContent > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('record failed:', error);
  process.exitCode = 1;
});