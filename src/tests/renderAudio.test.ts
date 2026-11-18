import { describe, expect, it } from 'vitest';

import { sfxGainScale } from '../render/audio';
import { readBgmVolume } from '../systems/AudioSystem';
import { DEFAULT_SETTINGS } from '../systems/SettingsSystem';

// AG-72 sfxVolume 接线的纯函数层单测：playSfx 的最终音量系数 =
// sfxVolume（0-100 全局设置）× volume（0..1 调用侧相对音量）。
//
// 与 audio.test.ts（BGM 音乐层）同约：Node 只测纯函数，WebAudio 绑定
// （env 增益峰值、零音量不排节点）由 e2e ag72-settings.spec.ts 实测兜底。

describe('sfxGainScale（sfxVolume × 调用侧相对音量）', () => {
  it('100% 设置不改变调用侧音量（默认路径逐字节兼容）', () => {
    expect(sfxGainScale(100, 1)).toBe(1);
  });

  it('sfxVolume=0 时产出音量为 0（playSfx 直接不排节点）', () => {
    expect(sfxGainScale(0, 1)).toBe(0);
  });

  it('sfxVolume=50 时按乘法缩放一半', () => {
    expect(sfxGainScale(50, 1)).toBeCloseTo(0.5, 12);
  });

  it('volumeScale 与 sfxVolume 叠加正确（乘法关系，不是替换）', () => {
    expect(sfxGainScale(70, 0.5)).toBeCloseTo(0.35, 12); // 默认 70% × 半音量
    expect(sfxGainScale(50, 0.25)).toBeCloseTo(0.125, 12);
    expect(sfxGainScale(100, 0.5)).toBeCloseTo(0.5, 12);
  });

  it('调用侧 volume=0 同样静音（两端任一为 0 即无声）', () => {
    expect(sfxGainScale(70, 0)).toBe(0);
    expect(sfxGainScale(0, 0)).toBe(0);
  });

  it('坏值夹紧：设置越界归 0-100，volume 越界/非有限回退既有语义', () => {
    expect(sfxGainScale(150, 1)).toBeCloseTo(1, 12); // >100 夹紧到 100
    expect(sfxGainScale(-20, 1)).toBe(0); // <0 夹紧到 0
    expect(sfxGainScale(50, 5)).toBeCloseTo(0.5, 12); // volume>1 夹紧到 1
    expect(sfxGainScale(50, -1)).toBe(0); // volume<0 夹紧到 0
    expect(sfxGainScale(50, Number.NaN)).toBeCloseTo(0.5, 12); // 非有限回退 1（旧行为）
  });
});

// AG-117：BGM 默认值的单一事实源守卫。readBgmVolume 无设置 blob 时的兜底
// 曾私写 70，与 SettingsSystem 的 DEFAULT_SETTINGS.bgmVolume（50）漂移
// （首启 BGM 比面板显示响）；修复后 readBgmVolume 直接委托 getSettings()。
// 这条用例钉住"无存储时返回值 == 面板默认值"，再漂移一次就会红。
describe('readBgmVolume 默认值（AG-117 单一事实源）', () => {
  it('无设置 blob 时返回 SettingsSystem 的默认 50，不再是私写的 70', () => {
    expect(readBgmVolume()).toBe(DEFAULT_SETTINGS.bgmVolume);
    expect(readBgmVolume()).toBe(50);
  });
});
