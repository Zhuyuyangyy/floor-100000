# base.apk 逆向报告（leanrea 工作流）

- 样本：`D:\C盘迁移\下载\base.apk`（589,568,018 字节，390 个 ZIP 条目，未改动原件，全程只读分析）
- 方法：leanrea SKILL.md 路由（魔数 → 清单 → 反编译）+ jadx 1.5.6（Temurin JDK 17）+ 自写 AXML/ELF/VFS 解析器
- 反编译产物：`re\base-jadx\sources\`（4397 个 .java；68 个 bad-code 类按原样保留）
- 证据分级：**seen**（给出处）/ **inferred**（推断）/ unknown

---

## 1. 身份判定

| 项 | 值 | 证据 |
|---|---|---|
| 包名 | `com.elevenbitstudios.twomstoriesmobile` | AndroidManifest.xml（AXML 解码） |
| 版本 | versionName `1.0.7` / versionCode `1010` | 同上 |
| SDK | minSdk 21 / targetSdk 34 / compileSdk 35 | 同上 |
| 真实游戏 | **This War of Mine**（11 bit studios），内部代号 `Kosovo` | manifest 包名 + dex 内 `com.elevenbitstudios.twommobile.R` 候选 + libAndroidGame.so 中 `gKosovoGameDelegate`、`KosovoDwellerControllerComponent`、`KosovoTradingComponent`、`KosovoDiary` 等 2050 个 `Kosovo*` 类（seen） |
| 代码规模 | classes.dex 7.6MB：7595 类 / 48533 方法 / 1,100,732 指令；classes2.dex 0.23MB | jadx 加载日志（seen） |

## 2. 三层结构

**这不是原版 APK，是第三方壳打包版**（seen）：

```
LAUNCHER: com.byfen.archiver.MainActivity        ← byfen 壳（classes2.dex）
   │  静态块: System.loadLibrary("vmcc")          ← MainActivity.java:687 (seen)
 │  下载/解压资源（"正在解压数据请勿退出"）
   ▼
com.android.Game11Bits.GoogleMainActivity         ← meta-data normal_archive_start_game (seen)
   ▼
GameActivity → GLMainView.nativeSetSurface → libAndroidGame.so
```

- **壳层** `com.byfen.archiver.*`（classes2.dex）：zip4j（AES/DEFLATE 压缩）、Downloader、AuthActivityManager、FileProvider、`com.byfen.market` 查询、`com.byfen.archiver.sdk.BfArchiveActivity`。启动流见 MainActivity.java:219-231（Runnable h：解压完成后 `intent.setClassName(pkg, m.g(ctx,"normal_archive_start_game"))` 再 finish 自身）。
- **框架层** `com.android.Game11Bits.*`：`GameLib`（35 个 native 方法，JNI 桥）、`BaseGameActivity`/`GameActivity`/`GoogleMainActivity`/`LoaderActivity`/`VideoActivity`/`PurchasePassportActivity`、`GameHelper`（Google Play Games）、`GoogleCloud`（云存档冲突解决 `resolveCloudConflict`）、`GoogleMultiplayer`。
- **引擎层** `lib/arm64-v8a/`：`libAndroidGame.so` 13.1MB、`libvmcc.so` 11.9MB、`libandroidoyunclub.so` 0.4MB、`libopenal.so` 0.2MB。全 AArch64 ELF，无 armeabi 32 位。

## 3. 引擎架构（libAndroidGame.so，31,220 个 dynsym 符号，未剥）

| 子系统 | 规模 | 关键类（seen，libAndroidGame.so 符号表） |
|---|---|---|
| RTTI 反射 | — | `RTTIClassHelper<T>`、`RTTI*Property`、`SerializeToXML`/`DeserializeFromXML`、`gRTTIClassRegisterHelper*` |
| 实体模板 | 20 种 | `ENTITY_MESH/COMPOUND/PARTICLE/SFX/SFXBEAM/LIGHT/TRIGGER/ANIMATIONGRAPH/GRAPH/UIRECIPE/SCENEPARAMBOX/INGAMEUI/FLAG/COLOR_ENVELOPE/VECTOR_ENVELOPE/AMBIENTSOUND/BEHAVIOUR_TREE` |
| 行为树 AI | 625 个任务类 | `BTTaskKosovoEntityGoTo/Speak/PlayAnimation/FindRandomRoom`、`BTTaskKosovoEntitySensorConditionDecorator`、`BTTaskKosovoCheckValueDecorator` … |
| Lua 脚本 | 317 类 | `LuaWrapper`、`LuaGameDelegate`、`LuaProfiler`、绑定 `l_ui/l_ks/l_math/l_sound/l_physics/l_multiplayer/l_camera` |
| 渲染 | 60 类 | `LiquidRenderer`（OpenGL ES 2/3，`RenderingDeviceOpenGLESAndroid`）、异步 job 系统（TextureCreationJob/ShaderCreationJob/DDSTextureCreationJob/BufferSerializationJob…） |
| 音频 | 220 类 | `SoundEngine`/`KosovoSoundEngine`、OpenAL 后端，**静态链入** ogg/vorbis/theora 解码器（`th_decode_packetin` 等符号，seen） |
| 联机 | 53 类 | `MultiplayerEngine`、`Network::ReliableChannel`、`MultiplayerTimeSync`、`GCMultiplayer*`（Google Play 房间） |
| 玩法 | 2050 个 Kosovo* 类 | dweller/trading/diary/shelter/AI 常量/archetype/DLC 配置 |

JNI 边界（seen）：`Java_com_android_Game11Bits_GameLib_*`（init/touchDown/keyEvent/setAssetManager/resolveCloudConflict/onMultiplayerRoomCreated…）；`GameLib.java` 35 个 native 声明含 `crcCheck(String,long)`、`initNativeInterface()`、`requestRenderingFeatures`。

## 4. 资产 VFS 格式（assets/*.dat）

- 全部 `.dat` = **gzip 多成员串联容器**：每个成员独立压缩一个文件；成员之间用 `BTYPE=3`（标准 DEFLATE 保留值，zlib 报 invalid block type）做分隔标记——这是引擎自定义解压器的私有格式（inferred，基于 zlib 在成员边界必失败 + 成员内容为完整单文件的实测）。
- `scenes.dat`（54.5MB）：94 个成员，按 **[TOC 索引 → LAYERS → DPL]** 三件套循环，每个场景一个 bundle。TOC 头 `73 2c 02 00 d1 01 00 00`，条目为 41 字节定长（类型字节 + 文件名 + 填充），内容如 `book_book.dds`、`cubemap_blue_day_01.dds`（seen，`re\scenes_toc.bin`）。
- `sounds.dat`（236MB）：成员为 WAV/OGG（首个成员即完整 RIFF/WAVE，seen）；`textures.dat`（97MB）：成员为 DDS 纹理；另有 `animations.dat`（成员含 `ojciec`/`beingm` 等动画名，seen）、`common.dat`、`templates.dat`、`videos.dat`（OGG/Theora 视频）。

## 5. libvmcc.so —— 壳注入的 V8 运行时 + 内存转储套件

- 加载点：`com.byfen.archiver.MainActivity` 静态块 `System.loadLibrary("vmcc")`（MainActivity.java:687，seen）。
- 全剥：无 dynsym 导出；DT_NEEDED 仅 `liblog/libm/libdl/libc`（seen，自写 ELF 解析）。
- 内嵌 **V8 JS 引擎**：字符串含 `V8.MemoryPressureNotification`、`WasmContinuationObject`、`JSMessageObject`、`compaction-selection`、`survived_bytes_after`、`HeapProfiler` 类痕迹（seen）；另有 GLib/json-glib（`json-glib/json-parser.c`、`GZlibCompressor`）。
- 内存/文件转储套件（C++ 符号，seen）：
  - `get_all_memory_maps` / `get_all_rx_seg` / `get_mem_info(int,MemInfo*)` / `get_so_info(MemInfo*)`
  - `dump_so_file` / `dump_metadata_file` / `dump_cs_code` / `dump_memory_region` / `save_memory_to_file` / `hexdump` / `delete_file`
  - `get_self_package_name`、base64 编解码、`fork`/`execve`/`execv`/`sigprocmask`/`chmod`/`chown`
- 判定：vmcc 是 byfen 壳的 JS 驱动运行时，负责解包编排/校验，并具备读取 `/proc/self/maps`、按映射转储 .so 与内存区域落盘的能力（inferred：符号名 + 无 Java native 声明 + 无 Java_ 导出，说明入口在 JNI_OnLoad 内动态注册或纯 init_array）。

## 6. 其他 notable 点

- `libandroidoyunclub.so`：`JNI_OnLoad` + C++11 线程/future，渠道 SDK（"oyunclub" 土耳其游戏平台，inferred）；dex 含 `androidoyunclub` 字符串。
- manifest 权限：INTERNET、BILLING 6.0.1、CHECK_LICENSE、c2dm、WAKE_LOCK、FOREGROUND_SERVICE；`largeHeap=true`、`isGame=true`。
- `com.android.stamp.type=STAMP_TYPE_STANDALONE_APK` + `com.android.dynamic.apk.fused.modules=base,packedData`：声称 fused 单 APK（seen）。
- 遗留字符串：`com.elevenbitstudios.anomaly2Benchmark`（11 bit 旧项目共用代码基，inferred）。

## 7. 结论

base.apk = 《This War of Mine》移动版（1.0.7）被 **byfen archiver 壳**重新打包：壳（MainActivity + zip4j + V8 运行时 libvmcc.so）负责下载/解包并跳转游戏；游戏本体为 11 bit 自研 C++ 引擎（libAndroidGame.so，RTTI + 行为树 + Lua + LiquidRenderer/GLES + OpenAL），资产在 gzip 私有 VFS（BTYPE=3 分隔标记）中。Java 层为标准 Google Play 服务集成（GameHelper/Cloud/Multiplayer/Billing）。

## 附：复现命令（leanrea 风格）

```sh
# 清单
python -c "import zipfile;[print(i.filename,i.file_size) for i in zipfile.ZipFile('base.apk').infolist()]"
# 反编译（注意：jadx 1.5.6 在本机需 JDK17 + 自定义 tmpdir，且绕过 jar 内 GUI 主类）
java -Xmx4g -Djava.io.tmpdir=<writable> -cp jadx-1.5.6-all.jar jadx.cli.JadxCLI \
  -d re/base-jadx --no-res --show-bad-code --threads-count 4 base.apk
# native 符号
python elf_dynsym.py libAndroidGame.so   # 本报告用自写解析器，脚本见 re/ 下生成过程
# VFS 遍历
python vfs_walk.py assets/scenes.dat     # 多成员 gzip + BTYPE=3 重同步
```
