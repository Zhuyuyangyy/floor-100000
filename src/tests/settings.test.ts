import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';

import {
  DEFAULT_SETTINGS,
  LANGUAGE_LABELS,
  LANGUAGES,
  SETTINGS_KEY,
  TEXT_SPEEDS,
  TEXT_SPEED_LABELS,
  VOLUME_MAX,
  VOLUME_MIN,
  getSettings,
  resetSettings,
  shakeIfEnabled,
  updateSettings,
  type Settings,
} from '../systems/SettingsSystem';

// AG-72: the settings store (localStorage `floor100000.settings`). The store
// is Phaser-free on purpose, so the whole contract is provable under Node:
// defaults, bad-payload defense, per-field repair, persistence, and the
// screen-shake guard GameScene's four shake call sites route through.

function fakeStorage(raw: string | null = null): Storage {
  const map = new Map<string, string>();
  if (raw !== null) map.set(SETTINGS_KEY, raw);
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}

// A scene stub that records camera.shake calls — the only thing
// shakeIfEnabled is allowed to touch.
function fakeScene(): { scene: Phaser.Scene; calls: Array<[number, number]> } {
  const calls: Array<[number, number]> = [];
  const scene = {
    cameras: {
      main: {
        shake: (duration: number, strength: number) => {
          calls.push([duration, strength]);
        },
      },
    },
  };
  return { scene: scene as unknown as Phaser.Scene, calls };
}

describe('the settings key', () => {
  it('is the documented localStorage key', () => {
    expect(SETTINGS_KEY).toBe('floor100000.settings');
  });
});

describe('defaults', () => {
  it('ships the TWOM-benchmark starting values', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      sfxVolume: 70,
      bgmVolume: 50,
      screenShake: true,
      textSpeed: 'normal',
      language: 'zh',
    });
  });

  it('returns defaults when nothing is stored', () => {
    expect(getSettings(fakeStorage())).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults when the stored JSON is corrupt (never throws)', () => {
    expect(getSettings(fakeStorage('{ not json'))).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults when the payload is not an object', () => {
    expect(getSettings(fakeStorage('42'))).toEqual(DEFAULT_SETTINGS);
    expect(getSettings(fakeStorage('null'))).toEqual(DEFAULT_SETTINGS);
    expect(getSettings(fakeStorage('"loud"'))).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to the process-local memory storage when no argument is given', () => {
    // Node has no localStorage: the default storage is a memory fallback that
    // still round-trips within the process (the browser path is localStorage).
    resetSettings();
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
    updateSettings({ sfxVolume: 20 });
    expect(getSettings().sfxVolume).toBe(20);
    resetSettings();
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('per-field defense (one bad field must not reset the rest)', () => {
  it('keeps valid fields and repairs only the broken ones', () => {
    const storage = fakeStorage(
      JSON.stringify({
        sfxVolume: 30,
        bgmVolume: 'loud', // wrong type -> default
        screenShake: 'yes', // wrong type -> default
        textSpeed: 'turbo', // not a档位 -> default
        language: 'en', // 预留但未实装 -> default
      }),
    );
    expect(getSettings(storage)).toEqual({
      ...DEFAULT_SETTINGS,
      sfxVolume: 30,
    });
  });

  it('merges a partial payload over the defaults', () => {
    const storage = fakeStorage(JSON.stringify({ screenShake: false }));
    expect(getSettings(storage)).toEqual({ ...DEFAULT_SETTINGS, screenShake: false });
  });

  it('clamps volumes into 0..100 and rounds to integers', () => {
    expect(getSettings(fakeStorage(JSON.stringify({ sfxVolume: 150 }))).sfxVolume).toBe(VOLUME_MAX);
    expect(getSettings(fakeStorage(JSON.stringify({ sfxVolume: -12 }))).sfxVolume).toBe(VOLUME_MIN);
    expect(getSettings(fakeStorage(JSON.stringify({ bgmVolume: 62.6 }))).bgmVolume).toBe(63);
    expect(getSettings(fakeStorage(JSON.stringify({ bgmVolume: Number.NaN }))).bgmVolume).toBe(DEFAULT_SETTINGS.bgmVolume);
    expect(getSettings(fakeStorage(JSON.stringify({ sfxVolume: '70' }))).sfxVolume).toBe(DEFAULT_SETTINGS.sfxVolume);
  });
});

describe('updateSettings', () => {
  it('writes through immediately and returns the merged settings', () => {
    const storage = fakeStorage();
    const next = updateSettings({ sfxVolume: 0, screenShake: false }, storage);
    expect(next).toEqual({ ...DEFAULT_SETTINGS, sfxVolume: 0, screenShake: false });
    // Persisted: a fresh read of the same storage sees the change.
    expect(getSettings(storage)).toEqual(next);
  });

  it('leaves other fields untouched', () => {
    const storage = fakeStorage(JSON.stringify({ bgmVolume: 12, textSpeed: 'fast' }));
    updateSettings({ sfxVolume: 99 }, storage);
    expect(getSettings(storage)).toEqual({ ...DEFAULT_SETTINGS, bgmVolume: 12, textSpeed: 'fast', sfxVolume: 99 });
  });

  it('treats explicit undefined as "no change"', () => {
    const storage = fakeStorage(JSON.stringify({ sfxVolume: 15 }));
    const patch: Partial<Settings> = { sfxVolume: undefined, bgmVolume: 80 };
    expect(updateSettings(patch, storage).sfxVolume).toBe(15);
    expect(updateSettings(patch, storage).bgmVolume).toBe(80);
  });

  it('repairs a bad patch value against the current value, not the default', () => {
    const storage = fakeStorage(JSON.stringify({ sfxVolume: 33 }));
    expect(updateSettings({ sfxVolume: 999 }, storage).sfxVolume).toBe(VOLUME_MAX);
    expect(updateSettings({ sfxVolume: Number.NaN }, storage).sfxVolume).toBe(VOLUME_MAX);
    expect(updateSettings({ textSpeed: 'nope' as never }, storage).textSpeed).toBe(DEFAULT_SETTINGS.textSpeed);
    expect(updateSettings({ language: 'fr' as never }, storage).language).toBe(DEFAULT_SETTINGS.language);
  });

  it('never throws when the storage rejects the write', () => {
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    } as unknown as Storage;
    expect(() => updateSettings({ sfxVolume: 10 }, throwing)).not.toThrow();
    expect(() => resetSettings(throwing)).not.toThrow();
  });
});

describe('resetSettings', () => {
  it('restores and persists the defaults', () => {
    const storage = fakeStorage(JSON.stringify({ sfxVolume: 0, bgmVolume: 100, screenShake: false, textSpeed: 'instant' }));
    const next = resetSettings(storage);
    expect(next).toEqual(DEFAULT_SETTINGS);
    expect(getSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('shakeIfEnabled (the GameScene guard)', () => {
  // shakeIfEnabled deliberately reads the ambient store (no storage param —
  // it is called from the scene, which has no storage to inject). In Node the
  // ambient store is the memory fallback, so the flag is driven through the
  // argument-less API the browser uses.
  it('shakes with the call site\'s own duration and strength when enabled', () => {
    updateSettings({ screenShake: true });
    const { scene, calls } = fakeScene();
    shakeIfEnabled(scene, 160, 0.008);
    expect(calls).toEqual([[160, 0.008]]);
  });

  it('does not touch the camera at all when disabled', () => {
    updateSettings({ screenShake: false });
    const { scene, calls } = fakeScene();
    shakeIfEnabled(scene, 160, 0.008);
    expect(calls).toEqual([]);
    updateSettings({ screenShake: true }); // restore for any later test
  });
});

describe('the档位 vocabularies the panel cycles', () => {
  it('orders the three text speeds and labels them in Chinese', () => {
    expect(TEXT_SPEEDS).toEqual(['instant', 'fast', 'normal']);
    expect(TEXT_SPEED_LABELS.normal).toBe('正常');
    expect(TEXT_SPEED_LABELS.fast).toBe('快');
    expect(TEXT_SPEED_LABELS.instant).toBe('瞬间');
  });

  it('ships zh as the only language, with en reserved (structure, not translation)', () => {
    expect(LANGUAGES).toEqual(['zh']);
    expect(LANGUAGE_LABELS.zh).toBe('中文');
  });
});
