// 假上游：冒充魔搭 API-Inference（OpenAI 兼容形状）。
//
// 为什么需要它：真实链路验证要能跑在没有 Key 的机器和 CI 上，且每次都得
// 给出同一个结论。它固定回一条合法提案，于是「浏览器是否真的走通了代理」
// 与「模型回得好不好」这两件事被拆开——本用例只关心前者。
//
// 它同时是一份证据采集器：把上游**实际收到**的请求体与 Authorization 头
// 落到 jsonl。安全边界（Key 只在服务端、客户端不能指定 model）靠这份记录
// 逐字节核对，而不是靠读代码相信。
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 7906);
const LOG = process.env.LOG ?? resolve(HERE, '..', 'test-results', 'upstream-received.jsonl');

mkdirSync(dirname(LOG), { recursive: true });

const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    // 证据落盘失败不能把上游打死。这里原来直接 appendFileSync：目录被清掉
    // （test-results/ 是生成物，随时可能被 rm -rf）时抛 ENOENT，进程整个退出，
    // 表现却是「webServer 启动超时」——排查时会一路怀疑代理和端口，而真正
    // 的原因在几十行之外的日志写入。证据是附加品，服务才是必需品。
    try {
      mkdirSync(dirname(LOG), { recursive: true });
      appendFileSync(
        LOG,
        JSON.stringify({
          at: new Date().toISOString(),
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization ?? null,
          body: raw,
        }) + '\n',
      );
    } catch (err) {
      console.warn(`[fake-upstream] 证据写入失败（不影响服务）：${err.code ?? err.message}`);
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                action: { type: 'dialogue', text: '收到。' },
                confidence: 0.9,
                utterance: '收到。',
              }),
            },
            finish_reason: 'stop',
          },
        ],
      }),
    );
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`[fake-upstream] listening on ${PORT}, log → ${LOG}`));