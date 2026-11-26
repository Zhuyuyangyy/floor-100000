# 公开部署实测记录（deployment smoke）

**对象**：魔搭创空间 `a1578804454/floor-100000`（《第100000层：末日宿舍》）
**实测时间**：2026-11-26 23:52–23:56（+08:00），全部为**匿名**请求，不带任何令牌
**实测机器**：Windows 10.0.22621 x64 / Node v24.14.0
**被验收的代码基线**：`526cdb96c99bf94d671dc616b2681f50545268d6`（分支 `deploy-ms-20261125`）
**线上模型**：`Qwen/Qwen3.8-Flash-Next`（服务端 `NPC_MODEL_ID` 固定，请求体无法覆盖；
出处 `docs/SPARK_DEPLOY.md:206`「线上实例实配」，据部署运行日志实测）

> 本文件只记录**实际发生过的请求与返回**。凡是引用仓库里已有的历史记录，都标了出处与时间，
> 便于区分「本次实测」和「此前记录」。

---

## 1. 三条路径的区别（先说结论）

| 路径 | 本次匿名实测 | 要什么 | 用途 |
|---|---|---|---|
| **门户页** `https://www.modelscope.cn/studios/a1578804454/floor-100000` | **HTTP 200**，33 386 B，`text/html` | 什么都不用 | **给评委的链接**。门户页挂出 iframe，游戏在 iframe 里跑 |
| **应用本体** `https://a1578804454-floor-100000.ms.show/` | **HTTP 200**，1 682 B，游戏 index.html | 什么都不用 | 应用直连地址（裸 HTTP 客户端实测，详见 §3 的说明） |
| **API 专用** `https://studio-a1578804454-floor-100000.api-inference.modelscope.net` | **HTTP 401**，`Authentication failed, please make sure that a valid ModelScope token is supplied.`（158 B） | **必须带 SDK token** | 验收脚本 `tools/verify-online-api.mjs` 打的口 |

**这三条不是一回事，别混。** API 专用地址 401 是**平台设计**（该域名要求 token），
与「空间是否公开」无关——空间是 public，但这个域名依然要 token。
证据：匿名访问 API 主机 `/healthz` 返回 401，而同一个实例的门户页与 `.ms.show` 都返回 200。

**结论：公开试玩不需要登录。** 匿名浏览器打开门户页即可进入游戏；验收脚本那条路才需要 token，
而且脚本的存在**不代表**评委要登录。

---

## 2. 匿名访问实测（逐条原始返回）

### 2.1 门户页

```
GET https://www.modelscope.cn/studios/a1578804454/floor-100000
→ HTTP 200
  content-type : text/html; charset=utf-8
  bytes        : 33386
  sha256       : 7b7be0e6259903774d43fd49b631214e8bf95d560f28ee9c7ca6542383336a93
  md5          : f4a544a0e7b698a316d44b97fc6e3e7e
```

### 2.2 门户页内嵌的创空间元数据（同一份 HTML 里，与「状态」相关的字段原样摘录）

```json
{ "Path": "a1578804454", "Status": "Running", "Visibility": 5, "Type": "programmatic",
  "SdkType": "docker", "Revision": "master", "InstanceNumber": 1,
  "IndependentUrl": "https://a1578804454-floor-100000.ms.show",
  "ResourceRegion": "cn-beijing", "UniqueVisitors": 3, "Visits": 49,
  "LastDeployConfig": { "Cpu": 2, "Memory": 8192 },
  "XGPUConfig": { "Cpu": 2, "Gpu": 0, "Memory": 8192, "Name": "免费CPU，按需分配" } }
```

据此可确认的事实：

- **状态 = `Running`**（门户页内嵌 JSON 原字段，不是转述）。
- **上次部署时间 = `DeployedTime: 1795683048`（epoch 秒）= `2026-11-26T08:50:48Z` = 2026-11-26 16:50:48（+08:00）**。
- **部署的产物与被验收的产物是同一份**：验收脚本 `api-verify-meta.json` 的
  `startedAt = 2026-11-26T08:58:52.267Z`（= 16:58:52 +08:00），在部署完成之后约 8 分钟。
  产物文件名也一致：验收记录的引用是 `assets/index-Dzve_6tz.js`，本次匿名复测拿到的也是它（§4）。
- **可见性**：`Visibility: 5` 是平台的枚举值；「public / private:false」这一说法来自仓库记录与交接
  （`docs/SPARK_DEPLOY.md` §3.5–3.6、`docs/ADR-002-online-model-hosting.md`）。
  **本次没有独立复核枚举 5 与字符串 `public` 的映射**（那需要带 token 调 settings API）。
  但匿名可达性实测与「非 private」一致：private 状态下，平台层会把**连静态首页**都挡成 401（历史实测记录在案），
  而今天门户页与 `.ms.show` 都返回 200。

### 2.3 API 专用地址（匿名，故意不带 token）

```
GET https://studio-a1578804454-floor-100000.api-inference.modelscope.net/healthz
→ HTTP 401
  bytes : 158
  body  : {"error":{"message":"Authentication failed, please make sure that a valid ModelScope
           token is supplied.","request_id":"2eb0db82-1a27-40f6-ab3f-721e94cfa254"}}
```

> 注意这条**不能**被当成「线上服务不可用」。它是网关鉴权层，发生在应用之前。
> 同一实例带 token 的 `/healthz` 返回 200，见 §5。

---

## 3. 门户页 → 应用 iframe 的链路

**静态部分（本次实测）**

1. 门户页 HTML 里，`IndependentUrl` 字段直接给出应用地址
   `https://a1578804454-floor-100000.ms.show`——门户就是靠它挂 iframe 的。
2. 门户页的**初始 HTML 里没有任何字面 `<iframe>` 标签**（本次实测：`contains 'iframe' == false`）。
   iframe 是门户的**前端 JS 在页面加载后动态创建**的，静态 HTML 里看不到。
   因此「门户 200」**不等于**「游戏起来了」——这是仓库里 `e2e-public/public-smoke.spec.ts`
   特意强调的一点。
3. 应用本体 `GET https://a1578804454-floor-100000.ms.show/` → **200**，1 682 B，
   `<title>第100000层：末日宿舍</title>`，引用 `./assets/index-Dzve_6tz.js`。
   该 HTML 里**没有 `<canvas>` 标签**（`hasCanvasTag == false`）——Phaser 的画布是运行时建的，
   所以静态 HTML 里看不到画布是正常的，不是「游戏没加载」。

**浏览器导航与裸 HTTP 的差别（一个必须说清的细节）**

仓库里 `e2e-public/public-smoke.spec.ts` 的注释记录：**顶层浏览器导航**访问 `.ms.show`
会被网关 **302** 到门户页，真正被加载的应用跑在门户挂出的 iframe 里（网关按 `Sec-Fetch-Dest` 分流）。
而本次用**裸 HTTP 客户端**（不带 `Sec-Fetch-*` 头）直接 GET `.ms.show`，拿到的是 **200 + 游戏 index.html**。

两者不矛盾：网关按请求特征走不同分支。**结论不变——公开冒烟必须走门户页**，
因为只有门户页会挂出 iframe；直连 `.ms.show` 拿到的 index.html 不等于门户挂出的那个实例。

**动态部分（自动化验证）**

`e2e-public/public-smoke.spec.ts` 用「轮询 `page.frames()` 里 url 含 `.ms.show` 的 frame」
来判定应用真的被加载（最多等 90 s），再断言 iframe 里：
- Phaser 的 `Menu` 场景已经 active（是「跑起来了」，不是「注册了」）；
- 画布尺寸是 **1280×720**；
- 按真实按键从 Menu → MetaSelect → Game 走进去；
- 第 2 层站着 4 位居民（阿林 / 小周 / 老陈 / 大刘）；
- 在 iframe 内发 `POST /api/npc/decide`，断言 `decisionSource == "model"` 且台词非空。

本次运行结果见 §7。

---

## 4. 产物文件名与哈希（本次匿名实测）

| 文件 | 路径 | 字节 | sha256 | md5 |
|---|---|---:|---|---|
| 首页 | `https://a1578804454-floor-100000.ms.show/` | 1 682 | `d222be08fc6b27f89ad223c6f771c618471e20f7e3bbef24930caf973e82114f` | `ef141fbd8cfbb430cd6d89394561a6b8` |
| 主 JS | `https://a1578804454-floor-100000.ms.show/assets/index-Dzve_6tz.js` | 1 713 524 | `b1ae4dd0ed76e4100f410edcdddbefb018482cad029772d23d098afce36531d1` | `78cc718d213698f7655811a20257e582` |

**与验收记录的对照（两个字节数不同，不是产物变了）**

| 来源 | 首页字节 | 主 JS 字节 | 主 JS 文件名 |
|---|---:|---:|---|
| 本次匿名实测（`.ms.show` 入口） | 1 682 | 1 713 524 | `assets/index-Dzve_6tz.js` |
| 2026-11-26 16:58 验收（API 主机入口，带 token） | 1 668 | 1 698 368 | `assets/index-Dzve_6tz.js` |

**文件名一致**——这说明今天线上跑的就是 16:58 那次被验收的同一份产物。
字节数不同是因为两个入口经过的网关不同、注入的内容不同（平台在响应里塞了自己的东西）。

> ⚠️ **不要用字节数当产物指纹**，用**文件名**（或上面的哈希）。

---

## 5. `/healthz` 返回

**带 token（验收时，线上实测，出处 `artifacts/online-verify/api-verify.json` 第 8 条判据）：**

```json
{"ok":true,"aiConfigured":true,"breakerOpen":false,"dailyUsed":0,"dailyBudget":1800}
```

- `aiConfigured: true` —— 上游模型 Key 生效；
- `breakerOpen: false` —— 熔断未打开；
- **`dailyUsed: 0` / `dailyBudget: 1800`** —— 当天预算余量；
- 响应体里**不含 Key、不含上游地址**（判据「健康检查不泄 Key」通过）。

**匿名（本次实测）：** 401，见 §2.3。

**限制**：`/healthz` **不暴露提交号**。所以「线上跑的是哪个源码 SHA」**无法从线上直接证明**。
可证明的替代事实是：产物文件名 `assets/index-Dzve_6tz.js` 与 16:58 验收记录一致，
且线上产物已包含 weight 渲染对称修复（`cb51e52`）——记忆段 8/8 全绿的必要条件之一。
**提交材料里应写「产物级对齐」，不要写「SHA 级对齐」。**

---

## 6. 部署与回滚的实际做法

出处：`docs/SPARK_DEPLOY.md` §3.5–3.6（2026-11-26 实测走通过的流程）。

### 部署（改了 `server/` 或前端产物之后）

```bash
# 1) 魔搭访问令牌（设置 → 访问令牌）
export MODELSCOPE_API_KEY=<token>
export MODELSCOPE_ENDPOINT=https://modelscope.cn

# 2) 代码同步走 Git —— 平台没有部署 API，这一步只能推 git
git remote add modelscope https://oauth2:${MODELSCOPE_API_KEY}@modelscope.cn/studios/a1578804454/floor-100000.git
git fetch modelscope master
git merge modelscope/master --allow-unrelated-histories -m "Merge remote"
#   冲突时保留本地：git checkout --ours . && git add . && git commit -m "Resolve conflicts, keep local version"
git push modelscope HEAD:master          # 空间默认分支是 master，别推成 deploy-ms-20261125

# 3) 触发部署（等价 CLI：ms deploy a1578804454/floor-100000 --repo-type studio）
curl -X POST "$MODELSCOPE_ENDPOINT/openapi/v1/studios/a1578804454/floor-100000/deploy" \
  -H "Authorization: Bearer $MODELSCOPE_API_KEY"

# 4) 看日志：docker 类型先看 build，构建完再看 run
curl "$MODELSCOPE_ENDPOINT/openapi/v1/studios/a1578804454/floor-100000/logs/build" -H "Authorization: Bearer $MODELSCOPE_API_KEY"
curl "$MODELSCOPE_ENDPOINT/openapi/v1/studios/a1578804454/floor-100000/logs/run"   -H "Authorization: Bearer $MODELSCOPE_API_KEY"

# 5) 等 status 回到 Running
curl "$MODELSCOPE_ENDPOINT/openapi/v1/studios/a1578804454/floor-100000" -H "Authorization: Bearer $MODELSCOPE_API_KEY"

# 6) 重跑线上验收（拿有效 SDK token）
MS_TOKEN=<魔搭访问令牌> node tools/verify-online-api.mjs
#   六份产物落 output/online-verify/；脚本按自身位置推仓库根，与 cwd 无关。
#   再把结果复制回 artifacts/online-verify/（output/ 在 .gitignore 里，评审 clone 看不到）

# 7) 公开地址冒烟（不需要 token，验评委视角）
PUBLIC_BASE=https://www.modelscope.cn/studios/a1578804454/floor-100000 \
  npx playwright test -c playwright.public.config.ts
```

- **第一次 docker 构建约 3–5 分钟**，构建缓存会让后续快很多。
- 容器是三段式（build → runtime），运行镜像里**没有 `src/`、没有 devDependencies**，
  只有 `dist/` + 一个 `.mjs`，非 root 运行，`HEALTHCHECK` 打 `/healthz`（出处 `Dockerfile:12-64`）。
- **Key 的注入方式**：创空间的密文环境变量 `NPC_API_KEY` 在**构建期从未被引用**，
  所以 `--build-arg` 拿不到它。
- **诊断轮不要当证据**：不设 `MS_TOKEN` 时脚本打不到线上（401）；
  `FORCE_WRITE=1 SHOT_DIR=tmp/probe` 落盘的文件 `api-verify-meta.json` 里 `forceWrite: true`——
  **那不是证据，别引用**。本次权威产物的 `forceWrite` 是 `false`。

### 回滚

| 层面 | 做法 | 出处 |
|---|---|---|
| 代码回滚 | 在魔搭镜像分支 `master` 上 revert/reset 到上一个可用提交 → `git push modelscope HEAD:master` → 重复部署步骤 3–5 | `docs/SPARK_DEPLOY.md` §3.6 |
| 产物回滚 | 每个提交对应一次可重现构建（Dockerfile build → runtime），可用上一提交的同一流程重建 | 同上 |
| 快照约定 | Sprint 期间**每天最后一次构建作为可回滚快照** | `MASTER_SPRINT_PLAN_20261126.md` §8 |
| 回滚后验证 | 必须重跑 `tools/verify-online-api.mjs` 与 `e2e-public/public-smoke.spec.ts`，确认仍是 39/40 且记忆段 8/8 | 本包 §7 的判定口径 |

> **诚实标注**：以上是仓库里记录、且 2026-11-26 实际走通过的部署流程。
> **本次 A10 没有独立执行过一次完整回滚**，所以不把它写成「回滚已演练」。

---

## 7. 自动化公开冒烟的本次运行结果

**2026-11-27 00:20–00:21 实跑，3/3 通过，exit 0。**（完整原始输出见 `test-results.txt` 第 6 段）

```
Running 3 tests using 1 worker

  ok 1 [chrome] › e2e-public\public-smoke.spec.ts:165:1 › 公开链接对匿名访客可见，并把应用挂了出来 (14.0s)
  ok 2 [chrome] › e2e-public\public-smoke.spec.ts:183:1 › 新设备进游戏：第 2 层站着四个居民 (14.8s)
  ok 3 [chrome] › e2e-public\public-smoke.spec.ts:222:1 › 同源代理的真链路：浏览器里拿到的台词来自模型 (17.9s)

  3 passed (47.8s)
```

**这三条各自证明了什么（逐条对应 §3 的链路）**

| 用例 | 证明了 |
|---|---|
| 公开链接对匿名访客可见，并把应用挂了出来 | 门户页对匿名访客可读；门户**确实挂出了 `.ms.show` 的 iframe**；iframe 里有 **1280×720** 的画布且 `Menu` 场景已 active |
| 新设备进游戏：第 2 层站着四个居民 | 按**真实按键**（Enter）从 Menu → MetaSelect → Game 走进去；爬到第 2 层后可见居民标签恰好是 **大刘,小周,老陈,阿林**；全程**零 page error** |
| 同源代理的真链路：浏览器里拿到的台词来自模型 | 在 iframe 内发 `POST /api/npc/decide` 拿到 **HTTP 200**，且 `decisionSource == "model"`、提案 `type == "dialogue"`、台词非空 —— **不是 fallback、不是 scripted** |

**含义**：整条「**匿名访客 → 门户 → iframe → 游戏真的跑起来 → 居民在场 → 台词来自真实模型**」
的链路，本次是被自动化验证过的，不是靠人肉点一遍。

> **这条链打的是线上已部署的产物**（`assets/index-Dzve_6tz.js`，2026-11-26 16:50:48 部署）。
> 它**不**包含此后落在工作区里的改动（A3 的自主 tick 在途实现）。
> 要让线上包含新代码，**必须重新部署后再重跑这条 E2E**。


---

## 8. 本次实测暴露的部署相关问题

| # | 问题 | 级别 | 处置建议 |
|---|---|---|---|
| D4 | **线上部署规格与仓库 `ms_deploy.json` 不一致**：门户页记录上次部署为 `platform/2v-cpu-8g-mem`、`Memory: 8192`；仓库 `ms_deploy.json` 写的是 `platform/2v-cpu-16g-mem` | 低（配置漂移） | 由 A11/A2 统一成一份再部署一次。内存偏小可能影响大并发 |
| D6 | `/healthz` 不暴露提交号，无法证明线上跑的是哪个源码 SHA | 低（可观测性） | 建议在响应里加一个 `buildSha`（非敏感），下次部署即可自证 |
| D8 | **本地最新构建产物 ≠ 线上产物**：本地 `npm run build` 产出 `dist/assets/index-50KPLunn.js`（1 715.96 kB），线上是 `assets/index-Dzve_6tz.js`（1 713 524 B） | 中（发布一致性） | 工作区此后已变化（A3 的自主 tick 在途实现）。**要让线上一致必须重新部署并重跑本文件 §7 的 E2E**；在此之前，线上跑的仍是 2026-11-26 16:50:48 那份 |
| — | 部署 API 与 Git 推送是两步、且**部署 API 没有回滚接口** | — | 回滚 = 把 `master` 推回旧提交再触发一次部署，因此**旧提交必须始终可构建** |

---

## 9. 复现本文件的实测

```bash
# 匿名访问三条路径（不需要任何 token）
node -e "
const https=require('https');
const get=(u)=>new Promise(r=>{https.get(u,{headers:{'User-Agent':'a10-smoke'}},res=>{const c=[];res.on('data',d=>c.push(d));res.on('end',()=>r({u,status:res.statusCode,bytes:Buffer.concat(c).length,ct:res.headers['content-type']}))}).on('error',e=>r({u,error:e.message}))});
(async()=>{
 for(const u of ['https://www.modelscope.cn/studios/a1578804454/floor-100000',
                 'https://a1578804454-floor-100000.ms.show/',
                 'https://studio-a1578804454-floor-100000.api-inference.modelscope.net/healthz'])
   console.log(await get(u));
})();"
```

**不需要 token 的部分**：门户页、应用本体、产物哈希、部署状态与部署时间。
**需要 token 的部分**：`/healthz` 的 200 返回、40 条线上判据、记忆段证据——
这些走 `MS_TOKEN=<魔搭访问令牌> node tools/verify-online-api.mjs`。

> **公开包里不写令牌、机器访问凭据或账号信息。** 本文件通篇不含任何凭据。
