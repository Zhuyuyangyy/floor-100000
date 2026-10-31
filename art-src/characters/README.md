# 把你的画放这里

一张图一个角色，文件名必须是这四个之一：

```
art-src/characters/player.png          幸存者（默认角色）
art-src/characters/npc_alin.png        阿林（老邻居，壮）
art-src/characters/npc_xiaozhou.png    小周（孩子，瘦小）
art-src/characters/wanderer.png        流浪者（夜里追你的那个）
```

**然后跑一次：**

```bash
python tools/ingest-character.py player
```

它会：缩小到 64×96、把每个像素吸附到项目的 16 色调色板、拼成 960×96 的 15 帧图集，写到
`src/assets/characters/player.png`。**刷新浏览器就生效，不用改代码。**

## 图片可以是多少帧都行

| 你画的 | 结果 |
|---|---|
| **1 个站姿** | 所有帧用这个姿势。看着是手绘的，但走起来是程序化的腿 |
| **6 个姿势**（一排走循环） | 走路用手绘的 6 帧，其他动作仍是程序化 |
| **15 个姿势**（完整） | 全部手绘 |

工具会自己在跑完时打印：

```
poses  15
feet   lowest opaque row 95 of 0..95  (good)
```

`feet` 那行如果提示 `... the sprite will float`，说明你画的角色脚底下有空白行，
要裁掉——这是唯一会让角色悬空的地方。

## 画的时候只有 4 条硬要求

1. **侧面朝右**，全身，站在画面正中
2. **背景透明**（或纯白/纯品红，工具会抠掉 alpha<90 的像素）
3. **脚在画面最底边**，不要留空白
4. **平涂色块 + 1px 描边**，不要渐变、不要抗锯齿——否则缩小后会糊成一坨

尺寸随意（建议高 768–1024），工具会自己缩放。

具体的生成提示词见 `docs/ART_BRIEF.md` 第三节。
