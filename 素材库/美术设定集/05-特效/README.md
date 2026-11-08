# 特效

`预览/` 里是接触表：每张图把一个特效的所有帧横向排开，文件名就是特效 ID。

| 特效 ID | 用在哪 |
| --- | --- |
| `fire-brazier` | 食堂火盆。90 帧循环，目前只是装饰 |
| `fire-candle` | 宿舍蜡烛 |
| `fire-torch` | 走廊火把 |
| `impacts-crit-hit` | 暴击命中 |
| `impacts-hit-spark` | 普通命中 |
| `impacts-hit-flash` | 受击闪白 |
| `impacts-ground-slam` | 地面重击 |
| `pickups-coin-spin` | 金币拾取 |
| `pickups-collect-burst` | 收集时的小爆 |
| `status-poisoned` | 中毒状态 |
| `water-drip` | 天花板滴水（第 4 层） |
| `water-ripples` | 水面涟漪 |

## 注意

这里只有接触表（预览用）。**完整精灵表和 atlas 在 `public/assets/fx/<类>/<名字>/`**，那个目录下每个特效三个文件：`<名字>.png`（帧图集）、`<名字>.json`（帧坐标）、`contact.png`（就是这里的预览）。

改特效要改图集，不是改预览图。
