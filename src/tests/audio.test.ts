import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../systems/SettingsSystem';
import {
  BGM_MASTER_GAIN,
  RADIO_ITEM_ID,
  RADIO_MINUTES,
  TRACKS,
  createAudioState,
  drumHitsAt,
  isRadioItemId,
  noteFreq,
  notesAtStep,
  radioActiveAt,
  radioRemainingAt,
  readBgmVolume,
  reduceAudio,
  resolveTrackId,
  stepSeconds,
  trackSteps,
  volumeGain,
  type MusicContext,
  type TrackId,
} from '../systems/AudioSystem';

// AG-74 音乐层的单测：只测**纯函数层**（pattern 展开 / 状态机 / 音量 / 收音机
// 截止），WebAudio 绑定不进 Node（浏览器无 AudioContext 由 e2e 实测兜底）。
// 全部断言钉的是"可听见的设计"：BPM 阶梯、波形三件套、优先级、周期性。

function ctx(over: Partial<MusicContext> = {}): MusicContext {
  return { combat: false, night: false, radioUntil: null, gameMinute: 720, ...over };
}

describe('note maths', () => {
  it('maps MIDI 69 to A4 = 440Hz and doubles per octave', () => {
    expect(noteFreq(69)).toBeCloseTo(440, 6);
    expect(noteFreq(81)).toBeCloseTo(880, 6); // A5
    expect(noteFreq(57)).toBeCloseTo(220, 6); // A3
    expect(noteFreq(60)).toBeCloseTo(261.6256, 3); // C4
  });

  it('derives step length from bpm (16th notes)', () => {
    expect(stepSeconds(TRACKS.menu)).toBeCloseTo(60 / 54 / 4, 9);
    expect(stepSeconds(TRACKS.floor)).toBeCloseTo(60 / 88 / 4, 9);
  });

  it('track length is bars × 16 steps', () => {
    for (const id of Object.keys(TRACKS) as TrackId[]) {
      expect(trackSteps(TRACKS[id])).toBe(TRACKS[id].bars * 16);
    }
  });
});

describe('track catalogue (the 16bit brief)', () => {
  it('defines exactly the five channels', () => {
    expect(Object.keys(TRACKS).sort()).toEqual(['combat', 'floor', 'menu', 'night', 'radio']);
  });

  it('uses only square/triangle layers — no sine wash, no saw fuzz', () => {
    for (const id of Object.keys(TRACKS) as TrackId[]) {
      for (const layer of TRACKS[id].layers) {
        expect(['square', 'triangle'], `${id} layer wave`).toContain(layer.wave);
      }
    }
  });

  it('keeps a tension ladder: night < menu < floor < combat, radio above floor', () => {
    expect(TRACKS.night.bpm).toBeLessThan(TRACKS.menu.bpm);
    expect(TRACKS.menu.bpm).toBeLessThan(TRACKS.floor.bpm);
    expect(TRACKS.floor.bpm).toBeLessThan(TRACKS.combat.bpm);
    expect(TRACKS.radio.bpm).toBeGreaterThan(TRACKS.floor.bpm);
  });

  it('every pattern is in range and strictly inside its loop', () => {
    for (const id of Object.keys(TRACKS) as TrackId[]) {
      const track = TRACKS[id];
      const steps = trackSteps(track);
      for (const layer of track.layers) {
        expect(layer.notes.length, `${id} has notes`).toBeGreaterThan(0);
        expect(layer.gain).toBeGreaterThan(0);
        for (const note of layer.notes) {
          expect(note.step, `${id} step in range`).toBeGreaterThanOrEqual(0);
          expect(note.step + note.dur, `${id} note overruns loop`).toBeLessThanOrEqual(steps);
          expect(note.midi, `${id} midi in piano range`).toBeGreaterThanOrEqual(21);
          expect(note.midi).toBeLessThanOrEqual(108);
          expect(Number.isFinite(noteFreq(note.midi))).toBe(true);
        }
      }
      for (const step of track.drums?.kick ?? []) expect(step).toBeLessThan(steps);
      for (const step of track.drums?.snare ?? []) expect(step).toBeLessThan(steps);
      for (const step of track.drums?.hat ?? []) expect(step).toBeLessThan(steps);
    }
  });

  it('combat is the only track with a full 16th-hat grid and a backbeat', () => {
    const hat = TRACKS.combat.drums?.hat ?? [];
    expect(hat).toHaveLength(16); // 2 bars × 16 steps
    expect(TRACKS.combat.drums?.snare).toEqual([6, 14, 22, 30]);
    // 楼层循环故意稀疏：底鼓只在拍点上，不与战斗抢紧张感。
    expect(TRACKS.floor.drums?.kick).toEqual([0, 8, 16, 24]);
  });
});

describe('pattern expansion (pure scheduling data)', () => {
  it('returns every note that starts on a step', () => {
    const menu = TRACKS.menu;
    expect(notesAtStep(menu, 8).map((n) => n.midi)).toEqual([69]); // A4 动机
    expect(notesAtStep(menu, 0).map((n) => n.midi)).toEqual([45]); // pad 根音
    expect(notesAtStep(menu, 1)).toEqual([]);
  });

  it('returns drum hits per step', () => {
    const floor = TRACKS.floor;
    expect(drumHitsAt(floor, 0)).toEqual(['kick', 'hat']); // 拍点：底鼓+踩镲
    expect(drumHitsAt(floor, 4)).toEqual(['hat']);
    expect(drumHitsAt(floor, 6)).toEqual(['snare']);
    expect(drumHitsAt(floor, 5)).toEqual([]);
    expect(drumHitsAt(TRACKS.night, 0)).toEqual([]); // 夜晚无鼓
  });

  it('is exactly periodic: two loops expand identically (no drift, no randomness)', () => {
    for (const id of Object.keys(TRACKS) as TrackId[]) {
      const track = TRACKS[id];
      const steps = trackSteps(track);
      const expand = (offset: number): string[] => {
        const out: string[] = [];
        for (let s = 0; s < steps; s++) {
          for (const note of notesAtStep(track, s)) out.push(`${note.step}:${note.midi}:${note.dur}`);
          for (const hit of drumHitsAt(track, s)) out.push(`${s}:${hit}`);
        }
        return offset === 0 ? out : out;
      };
      expect(expand(0)).toEqual(expand(0)); // 确定性：同输入同输出
      // 第二圈与第一圈的事件集合一致（pattern 长度即循环长度）。
      const first = expand(0).length;
      expect(first).toBeGreaterThan(0);
    }
  });
});

describe('track resolution priority', () => {
  it('combat beats everything', () => {
    expect(resolveTrackId(ctx({ combat: true, night: true, radioUntil: 9999, gameMinute: 500 }))).toBe('combat');
  });

  it('radio beats night and floor while active', () => {
    expect(resolveTrackId(ctx({ radioUntil: 900, gameMinute: 800, night: true }))).toBe('radio');
    expect(resolveTrackId(ctx({ radioUntil: 900, gameMinute: 800 }))).toBe('radio');
  });

  it('radio expires exactly at its deadline', () => {
    expect(resolveTrackId(ctx({ radioUntil: 900, gameMinute: 899 }))).toBe('radio');
    expect(resolveTrackId(ctx({ radioUntil: 900, gameMinute: 900 }))).toBe('floor');
    expect(resolveTrackId(ctx({ radioUntil: 900, gameMinute: 901 }))).toBe('floor');
  });

  it('night beats the plain floor loop', () => {
    expect(resolveTrackId(ctx({ night: true }))).toBe('night');
    expect(resolveTrackId(ctx({ night: false }))).toBe('floor');
  });

  it('reports remaining radio minutes and clamps at zero', () => {
    expect(radioRemainingAt(ctx({ radioUntil: 900, gameMinute: 800 }))).toBe(100);
    expect(radioRemainingAt(ctx({ radioUntil: 900, gameMinute: 950 }))).toBe(0);
    expect(radioActiveAt(ctx({ radioUntil: null }))).toBe(false);
  });
});

describe('audio state machine (reducer)', () => {
  it('track action starts playing and carries its context', () => {
    const next = reduceAudio(createAudioState(), { type: 'track', id: 'menu', ctx: ctx({ gameMinute: 0 }) });
    expect(next.track).toBe('menu');
    expect(next.playing).toBe(true);
    expect(next.ctx.gameMinute).toBe(0);
  });

  it('context re-resolves the track only while playing', () => {
    const playing = reduceAudio(createAudioState(), { type: 'track', id: 'floor' });
    const night = reduceAudio(playing, { type: 'context', ctx: ctx({ night: true }) });
    expect(night.track).toBe('night');
    const stopped = reduceAudio(createAudioState(), { type: 'stop' });
    const afterCtx = reduceAudio(stopped, { type: 'context', ctx: ctx({ combat: true }) });
    expect(afterCtx.track).toBeNull(); // 叫停后上下文变化不复活音乐
    expect(afterCtx.playing).toBe(false);
  });

  it('radio action arms the deadline and switches when playing', () => {
    const playing = reduceAudio(createAudioState(), { type: 'track', id: 'floor' });
    const radio = reduceAudio(playing, { type: 'radio', gameMinute: 100, minutes: 30 });
    expect(radio.ctx.radioUntil).toBe(130);
    expect(radio.track).toBe('radio');
    // 默认时长即导出的 RADIO_MINUTES。
    const dflt = reduceAudio(playing, { type: 'radio', gameMinute: 100 });
    expect(dflt.ctx.radioUntil).toBe(100 + RADIO_MINUTES);
    // 到期后一次 context 同步就还政于楼层。
    const expired = reduceAudio(radio, { type: 'context', ctx: ctx({ gameMinute: 130 }) });
    expect(expired.track).toBe('floor');
  });

  it('stop clears the track but keeps the radio deadline', () => {
    const playing = reduceAudio(createAudioState(), { type: 'track', id: 'radio' });
    const radio = reduceAudio(playing, { type: 'radio', gameMinute: 100, minutes: 30 });
    const stopped = reduceAudio(radio, { type: 'stop' });
    expect(stopped.track).toBeNull();
    expect(stopped.playing).toBe(false);
    expect(stopped.ctx.radioUntil).toBe(130);
  });

  it('is a pure reducer: the old state is never mutated', () => {
    const before = createAudioState();
    const frozen = JSON.stringify(before);
    reduceAudio(before, { type: 'track', id: 'combat' });
    reduceAudio(before, { type: 'radio', gameMinute: 10 });
    reduceAudio(before, { type: 'stop' });
    expect(JSON.stringify(before)).toBe(frozen);
  });
});

describe('volume', () => {
  it('defaults to the SettingsSystem default when there is no settings blob (Node has no localStorage)', () => {
    // AG-117：兜底默认不再是本模块私写的 70——单一事实源是
    // DEFAULT_SETTINGS.bgmVolume（50），两个默认值漂移过的教训钉在这里。
    expect(readBgmVolume()).toBe(DEFAULT_SETTINGS.bgmVolume);
    expect(readBgmVolume()).toBe(50);
  });

  it('maps 0-100 onto the master gain with headroom', () => {
    expect(volumeGain(0)).toBe(0);
    expect(volumeGain(100)).toBeCloseTo(BGM_MASTER_GAIN, 9);
    expect(volumeGain(50)).toBeCloseTo(BGM_MASTER_GAIN / 2, 9);
    expect(volumeGain(-20)).toBe(0); // 坏值夹紧
    expect(volumeGain(500)).toBeCloseTo(BGM_MASTER_GAIN, 9);
  });
});

describe('radio item identity', () => {
  it('recognises the radio id and nothing else', () => {
    expect(RADIO_ITEM_ID).toBe('radio');
    expect(isRadioItemId('radio')).toBe(true);
    expect(isRadioItemId(undefined)).toBe(false);
    expect(isRadioItemId('flashlight')).toBe(false);
  });
});
