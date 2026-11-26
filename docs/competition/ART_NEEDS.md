# 美术需求清单（给你统一绘图用）

> 写于 2026-11-26 20:32。只列**真正缺的**，不列「有了更好」的。
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
| 尺寸 | **1280×96 sprite sheet**（实测 4 张现有角色精灵全是这个尺寸：16 帧 × 80px 横向排列，2x 显示）。别画单张立绘 |
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
