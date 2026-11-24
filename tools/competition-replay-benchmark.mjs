import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const outputFlag = args.indexOf('--output');
const outputPath = outputFlag >= 0 ? args[outputFlag + 1] : undefined;
if (outputFlag >= 0 && (!outputPath || outputPath.startsWith('--'))) {
  throw new Error('用法：npm run competition:benchmark -- [--output <报告路径>]');
}
const seedsFlag = args.indexOf('--seeds');
const seedArg = seedsFlag >= 0 ? args[seedsFlag + 1] : undefined;
if (seedsFlag >= 0 && (!seedArg || seedArg.startsWith('--'))) {
  throw new Error('用法：npm run competition:benchmark -- [--seeds 17,73,2048] [--output <报告路径>]');
}
const allowedArgs = new Set(['--output', '--seeds']);
for (let index = 0; index < args.length; index += 1) {
  if (!allowedArgs.has(args[index])) throw new Error(`未知参数：${args[index]}`);
  index += 1;
}
const seeds = seedArg === undefined ? undefined : seedArg.split(',').map((value) => Number(value));

const root = process.cwd();
const server = await createServer({
  configFile: resolve(root, 'vite.config.ts'),
  root,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});

try {
  const { runCompetitionReplayBenchmark } = await server.ssrLoadModule('/src/tools/competitionReplayBenchmark.ts');
  const report = await runCompetitionReplayBenchmark(seeds);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    const destination = resolve(root, outputPath);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, json, 'utf8');
    console.log(`离线 benchmark 报告已写入 ${destination}`);
    console.log(`重放一致率：${report.replayMatchCount}/${report.sampleCount} (${(report.replayMatchRate * 100).toFixed(1)}%)`);
    console.log(`内容 SHA-256：${report.contentSha256}`);
  } else {
    process.stdout.write(json);
  }
} finally {
  await server.close();
}
