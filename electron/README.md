# Electron 桌面壳（AG-76）

给《第100000层：末日宿舍》套的 Electron 桌面壳，服务 **Steam 上架技术路径**。本目录自包含：自己的 `package.json`、自己的 `node_modules`（electron + electron-builder 全部装在里面），**不改动主工程任何文件**（`src/`、根 `package.json`、`vite.config.ts` 均只读）。

```
electron/
├── main.cjs             主进程：窗口/菜单/单实例/存档桥主侧
├── preload.cjs          存档桥渲染侧：hydration + localStorage 镜像
├── package.json         本目录专用依赖与脚本
├── electron-builder.yml 三平台打包配置（appId fun.shushubiye.floor100000）
├── .gitignore           node_modules/ 与 dist-electron/ 不进仓库
└── README.md            本文件
```

---

## 一、开发（dev）

```bash
# 终端 1（仓库根目录）：开发服务器固定走 5377，与主进程约定一致
# （vite.config.ts 的 5173 是纯浏览器开发的默认端口，桌面壳不读它）
npx vite --port 5377 --strictPort

# 终端 2：启动桌面壳。未打包时主进程自动加载 http://127.0.0.1:5377
# 并自动打开 devtools
cd electron && npm start          # 或仓库根目录：npm run electron
```

首次使用先装依赖（只需一次）：

```bash
cd electron && npm install && npx install-electron
```

> Electron 42 起 `npm install` 不再自动下载运行时二进制，`npm start` 依赖它，
> 必须显式跑 `npx install-electron`（electron-builder 打包时会另外下载自己那份，
> 不受影响）。网络不通时给 npm/electron 配代理。

环境变量覆盖：

| 变量 | 作用 |
| --- | --- |
| `FLOOR_DEV_SERVER_URL` | 换 dev server 地址（默认 `http://127.0.0.1:5377`） |
| `FLOOR_FORCE_PROD=1` | 未打包也强制走生产分支（加载 `dist/`），用于不打包验证产物 |

窗口行为：默认 1280×720、可 resize（下限 640×360）、位置与尺寸跨启动记忆（`userData/window-state.json`）、`F11` 全屏、单实例锁（第二次启动聚焦已有窗口）。

---

## 二、构建（build）

```bash
# 1. 仓库根目录：先出 web 产物（tsc 类型检查 + vite build → dist/）
npm run build

# 2. electron 目录：首次安装依赖（几百 MB，只需一次；已装可跳过）
#    Electron 42+ 起还要显式拉运行时二进制，否则 npm start 起不来
cd electron && npm install && npx install-electron

# 3. 快速验证：解包目录（最快看到可分发形态，不签名）
cd electron && npx electron-builder --dir
#    → electron/dist-electron/win-unpacked/Floor100000.exe，双击即玩

# 4. 正式三平台安装包（按需；win 同时出 nsis 安装器 + portable 绿色版）
cd electron && npm run dist:win      # npx electron-builder --win --publish never
cd electron && npm run dist:mac      # dmg
cd electron && npm run dist:linux    # AppImage
#    或一次全平台：
cd electron && npm run dist:all      # npx electron-builder -mwl --publish never
```

说明：

- `directories.app` 指向 `..`（仓库根），因此打进 asar 的是 `dist/**` + `electron/*.cjs` + 根 `package.json`；版本号取自根 `package.json` 的 `version`（当前 0.1.0），改版本先改根 `package.json`。
- 产物输出在 `electron/dist-electron/`（已 gitignore）。
- mac/linux 只能在对应系统上构建（或配 CI）；在 Windows 上只验证了 win。

---

## 三、上架前（pre-launch）清单 + Steamworks 接入点

> 本节只写文档，不实现。Steamworks 集成是后续任务，这里固定接入点。

### 3.1 打包侧必须补的

1. **图标**：当前用 Electron 默认图标。把平台图标放进 `electron/build/`（`icon.ico` / `icon.icns` / `icon.png`），取消 `electron-builder.yml` 中对应注释；Steam 商店页另需 512×512 图。
2. **代码签名**：Windows 需 Authenticode 签名（否则 SmartScreen 拦安装器），macOS 需 Apple Developer ID + 公证。electron-builder 支持 `win.certificateFile` / `mac.identity`，均未配置。
3. **版本号对齐**：根 `package.json` 的 `version` 与 Steamworks 后台的 depot 构建描述保持一致。

### 3.2 Steamworks 接入点（选型与调用位置）

- **AppID**：Steamworks 后台建应用后取得。开发期在 app 根目录放 `steam_appid.txt`（内容即 AppID 数字）并重启 Steam 客户端；打包发布走正式 AppID。
- **SDK 选型**：`greenworks`（原生 addon，需按 Electron ABI 重编，跨版本/跨平台发布矩阵痛）或 `steamworks.js`（WASM 预编译，免重编，优先评估）。两条路都装在 `electron/` 里，由 `main.cjs` 引入。
- **初始化点**：`main.cjs` 的 `app.whenReady()` 内调用 `SteamAPI.Init()`。失败（Steam 未启动 / 未登录 / 无 AppID）必须降级为「游戏可玩、Steam 功能关闭」，不能阻断启动。
- **云存档**：本壳已把存档落成 `userData/saves.json`（见下节），两条路：
  - (a) 零代码：Steamworks 后台把该文件加入 Cloud 文件配额，Steam 客户端自行同步；
  - (b) 用 `SteamRemoteStorage` 接管时，渲染侧 `window.floorDesktop.saveBridge`（`read/write/remove/keys`）就是现成文件桥，游戏代码仍零改动。
- **成就 / 统计**：候选埋点——首次通关、`records.bestDepth` 新纪录、`records.bestScore`、生存天数里程碑。调用点围绕 `src/scenes/GameScene.ts` 的 `saveToStorage(state)` 与 `src/scenes/MetaSelectScene.ts` 的 `saveMeta(meta)` 落点（当前不实现）。
- **Steam Deck**：同时构建 win 与 linux target（Deck 经 Proton 跑 win 版亦可）；验证重点：F11 全屏、窗口缩放、无鼠标依赖的键盘操作（A/D/E/I/C/M）。
- **Overlay / Steam Input**：默认开启；手柄适配属后续任务。

### 3.3 商店与法务

分级问卷、商店页素材、截图；第三方声明已由仓库根 `THIRD_PARTY_NOTICES.md` 覆盖（Phaser MIT、Noto Sans SC OFL 等）。

---

## 存档桥设计（为什么这样接）

**约束**：游戏代码零改动——`SaveSystem` / `metaProgress` / `session` 全部读写 `localStorage`（键：`floor100000.save.v1`、`floor100000.meta.v1`，见 `src/core/constants.ts` 与 `src/systems/metaProgress.ts`）。

**做法**（`preload.cjs`，桌面壳专属，浏览器里不存在这个文件）：

1. **启动 hydration（同步）**：preload 用 `sendSync` 拉取主进程的 `userData/saves.json`，只补 `localStorage` 里缺失的键。preload 先于页面脚本执行，因此游戏第一次读存档时看到的一定是补全后的状态。这也兜住了 `file://` 源下 localStorage 生命周期不确定的问题——无论它是否持久，磁盘镜像都在。
2. **写入镜像（热路径）**：给 `localStorage` 实例的 `setItem/removeItem/clear` 打补丁（遮蔽原型方法，原生语义含配额抛错完全保留），把带 `floor100000.` 前缀的写入转发给主进程；主进程以「临时文件 + rename」原子重写 `saves.json`。会话内 `localStorage` 仍是同步真相源，磁盘只是耐久镜像——即未来 Steam Cloud 的同步目标。

**存档文件位置**（`productName` 为 `Floor100000`）：

- Windows：`%APPDATA%/Floor100000/saves.json`
- macOS：`~/Library/Application Support/Floor100000/saves.json`
- Linux：`~/.config/Floor100000/saves.json`

**损坏处理**：`saves.json` 解析失败时备份为 `saves.json.corrupt-<时间戳>` 后以空存档启动，绝不静默覆盖玩家仅有的副本。

**显式 API**（`contextBridge` 暴露，供未来 Steam 云存档 / 桌面特性使用，浏览器态不存在 `window.floorDesktop`）：

```js
window.floorDesktop.isDesktop   // true
window.floorDesktop.isDev       // 是否 dev 模式
window.floorDesktop.platform    // 'win32' | 'darwin' | 'linux'
window.floorDesktop.versions    // Electron/Chromium/Node 版本
await window.floorDesktop.saveBridge.read(key)    // string | null
await window.floorDesktop.saveBridge.write(key, value)  // value 须为 string
await window.floorDesktop.saveBridge.remove(key)
await window.floorDesktop.saveBridge.keys()       // 磁盘上的 floor100000.* 键
```

---

## 已知限制（诚实清单）

- **本机跑不起来 Electron 45**：Windows 11 22H2（build 22621）上 Electron 45.3.3（Chromium 156）启动即崩（事件日志 0xc0000005，`--no-sandbox`/`--disable-gpu`/`--single-process` 均无效；打包后的 `Floor100000.exe` 同样 0.4 秒内退出 0x80000003）。同一台机器 Electron 37.10.3 正常创建窗口。**如需在本机开发/试玩，把 `electron/package.json` 的 electron 改成 `37.10.3` 再 `npm install`**（存档桥与打包逻辑与版本无关，已用 37 验证）。根因未定（疑似 Chromium 156 提高了 Windows 最低 build 要求），已在报告提交团队决策。
- 无自定义图标、无代码签名——上架前必须补（见 §3.1）。
- 本机（Windows）只验证了 `--dir` 的 win 解包产物；mac/linux 未构建验证。
- Steamworks 未集成（按设计只到接入点文档）。
- `contextIsolation` 被刻意关闭：存档桥的 localStorage 补丁只有与页面同域同世界才能生效（隔离世界里打的补丁看不到游戏自己的 setItem）。`nodeIntegration` 仍关闭、renderer 仍在沙箱内——页面拿不到任何 Node 能力。也因此不能用 `contextBridge`（它要求 contextIsolation 开启），`window.floorDesktop` 是普通 window 全局。
- GUI 冒烟测试以手动双击 `dist-electron/win-unpacked/Floor100000.exe` 为准；自动环境起不来窗口时不阻塞交付。
