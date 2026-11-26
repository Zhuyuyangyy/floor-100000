# 美术需求清单（给你统一绘图用）

> 写于 2026-11-26 20:32。**21:45 更新：P0/P1/P2 三张图已交付并接入，见文末验收记录。**
> 只列**真正缺的**，不列「有了更好」的。
> 现有资源：artpack 30 张 + ui 18 张 + fx 33 个 atlas + 4 张角色精灵。
> 已够用。下面这些是审查里点名、目前没有的。

## 现状：三个包的处理结果

| 包 | 处理 |
|---|---|
| pixelfx-main | **已用**。原本就在用（27 张），今晚又从同一 MIT 来源加了 6 个效果（spirit-flame / wisp / bat / portal / blizzard-vortex / bullet-impact），已注册进 `src/render/fx.ts`。**注意：只注册、场景未调用**，不算"已上线" |
| awesome-gamedev-agent-skills | 不是美术素材，是给 AI 编码 agent 的 skill（79 个）。跟画面无关，没入库 |
| clawd-stickers | **不能用**。美术是 CC BY-NC-SA 4.0 禁止商用，且主角是 Claude Code 吉祥物（第三方权利未清）。比赛公开传播会违规 |

---

## 需要你画的（有明确缺口，按优先级）

### P0 — 结算卡插画（1 张）

| 项 | 规格 |
|---|---|
| 用途 | 第 1 章达成卡的背景插画（MiniMax 正在做结算卡逻辑，图还没画） |
| 尺寸 | **400×250**（`src/scenes/EndScene.ts:73-74` 的 `panelW/panelH`，1x 显示） |
| 内容 | 末日宿舍楼剖面的一角，灯亮了、窗户透出暖光；不要人物特写 |
| 风格 | 和 `public/assets/artpack/` 现有 30 张一致：**冷色环境 + 只有 LIGHT 一族暖色**。屏幕上任何一像素暖色 = 有东西被点亮，这是美术方向的前提 |
| 调色板 | 用现有 `src/render/palette.ts` 的 16 色，别引入第 17 色 |
| 放置 | 画完告诉我，我放进 `public/assets/ui/` 并接进 EndScene |

### P1 — 阿珍头像（1 张）

| 项 | 规格 |
|---|---|
| 用途 | 阿珍是三个完整 Agent 之一，但角色精灵目录里只有 npc_alin / npc_xiaozhou / player / wanderer，**没有阿珍** |
| 尺寸 | **1280×96 sprite sheet = 20 帧 × 64×96**（`src/render/walkcycle.ts` 的 `FRAME_W=64` / `TOTAL_FRAMES=20`；帧序 walk 0–5 / idle 6–7 / attack 8–10 / hurt 11–12 / search 13–14 / die 15–17 / pickup 18–19）。我先前写「16 帧×80px」是错的，已按仓库权威更正 |
| 风格 | 食堂/炊事人员，围裙、耐心的眼神；像素风，和现有四张同一画法 |
| 放置 | 画完放 `src/assets/characters/npc_azhen.png`，我接进对话面板 |

### P2 — 夜景色温层（1 张可选）

| 项 | 规格 |
|---|---|
| 用途 | 审查 `UI_AUDIT_R3` 记「夜幕只有压暗、没有色温」。现在是纯 alpha 0.6 黑罩 |
| 尺寸 | 全屏叠加纹理，512×512 可平铺 |
| 内容 | 蓝紫色夜色颗粒，低透明度，不要具体物体 |
| 风格 | 冷色，不能压过「暖色 = 被点亮」的核心规则 |
| 放置 | 我接进 `nightOverlay` 的合成 |

---

## 不用画的

- **UI 面板边框/格子**：`public/assets/ui/` 已有 18 张
- **战斗特效**：今晚加了 6 个，共 33 个 atlas，够了
- **物品图标**：artpack 里已有
- **字体**：Ark Pixel Font，OFL 1.1 已署名
- **贴纸/表情包**：和游戏无关，clawd-stickers 也不能商业用

---

## 交付方式

画完把 png 放到任意目录，把路径给我。我做三件事：
1. 核对尺寸和调色板（用 `tools/art-audit.mjs` 跑一遍）
2. 接进对应场景 / 注册资源
3. 跑全量回归 + 更新 `THIRD_PARTY_NOTICES.md`（如果是你原创，标注 owner-supplied）

**不要**自己改 `GameScene.ts`——那是共享文件，我统一接。

---

## 交付验收记录（2026-11-26 21:45）

来源：`floor100000_art_20261126.zip`，owner 提供的原创 AI 辅助美术，无第三方素材。

| 图 | 交付路径 | 实测结果 |
|---|---|---|
| 第 1 章结算卡背景 | `public/assets/ui/chapter1_clear_bg.png` | 400×250 RGB，**9 色全部命中 PALETTE**；暖色是完整 LIGHT 梯度 `#8a4a1e → #ffe4b6`，冷蓝夜间背景，右侧留白可叠文字 |
| 阿珍 sprite sheet | `src/assets/characters/npc_azhen.png` | 1280×96 RGBA = **20×64×96**，8 色全部命中 PALETTE，透明背景 alpha=0；围裙、头巾、走动作符合食堂人员；帧序与 `walkcycle.ts` 一致 |
| 夜幕纹理 | `public/assets/ui/night_overlay.png` | 512×512 RGBA，alpha 5–31；**左右/上下接缝各 0 处不一致**（无缝平铺）；唯一色 `#232b4b` 在 PALETTE 外，属可选合成层，已在交付说明标注 |

### 接线方式

- 阿珍：`import.meta.glob('../assets/characters/*.png')` 自动发现，**放进去即生效**，无需改注册表。
- 结算卡：`CHAPTER1_CLEAR_BG_KEY` → BootScene 加载 → EndScene chapter 分支用它替换程序化面板；缺纹理时退回原面板。
- 夜幕：`NIGHT_OVERLAY_KEY` → BootScene 加载 → GameScene 增加 `nightTint` TileSprite，与原黑罩共用 `nightOverlayAlpha`；缺纹理时不创建，行为不变。

### 验证

`tsc` 0 错 · `vitest` 1223 passed / 6 skipped（1229） · `vite build` 成功，产物 `index-50KPLunn.js`，三张图全部进入 `/assets/`。

**注意**：这些是静态与构建验证；运行时美术审查（`tools/art-audit.mjs`）与游戏内视觉复核尚未做，需要重新部署后在浏览器里看。
