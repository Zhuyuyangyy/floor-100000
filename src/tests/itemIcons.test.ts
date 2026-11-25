import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ITEMS, ITEM_IDS } from '../data/items';
import { itemIconKey } from '../render/itemIcons';
import { ITEM_ICON_FILES } from '../render/artpack';

// The icon is loaded from the art pack under the item's own id, so the mapping is
// the identity. What matters is that every item HAS one — a missing icon would
// otherwise show up as a blank slot in the inventory rather than an error.
describe('item icon keys', () => {
  it('covers every item id exactly once', () => {
    const keys = ITEM_IDS.map(itemIconKey);
    expect(keys).toHaveLength(ITEM_IDS.length);
    expect(new Set(keys).size).toBe(ITEM_IDS.length);
  });

  it('is the item id, so a display-name rename cannot desync the icon', () => {
    for (const id of ITEM_IDS) {
      expect(itemIconKey(id)).toBe(id);
      expect(ITEMS[id].id).toBe(id);
    }
  });

  it('has no key for a non-item', () => {
    // The signature is ItemId, so this is compile-time only; assert the runtime
    // shape stays a plain string so a future key scheme is easy to spot.
    expect(typeof itemIconKey(ITEM_IDS[0])).toBe('string');
    expect(ITEM_IDS.length).toBeGreaterThan(0);
  });
});

// The art pack is an external input, so the mapping is asserted against the
// files on disk rather than trusted. A Record<ItemId, string> makes a missing
// entry a compile error; this catches a file that was never built, was renamed,
// or was left behind when the sheet changed.
describe('art pack icon files', () => {
  const dir = join(process.cwd(), 'public/assets/artpack');

  it('maps every item id to a file', () => {
    for (const id of ITEM_IDS) {
      expect(ITEM_ICON_FILES[id], `icon file for ${id}`).toBeTypeOf('string');
    }
  });

  it('has no entry for anything that is not an item', () => {
    expect(Object.keys(ITEM_ICON_FILES).sort()).toEqual([...ITEM_IDS].sort());
  });

  it('every mapped file exists, is a PNG, and is 16x16', () => {
    for (const [id, file] of Object.entries(ITEM_ICON_FILES)) {
      const path = join(dir, file);
      expect(existsSync(path), `${id} -> ${file}`).toBe(true);
      const buf = readFileSync(path);
      expect(buf.subarray(1, 4).toString('ascii'), `${file} signature`).toBe('PNG');
      // IHDR width/height are the first two big-endian uint32 after the signature.
      expect(buf.readUInt32BE(16), `${file} width`).toBe(16);
      expect(buf.readUInt32BE(20), `${file} height`).toBe(16);
    }
  });

  it('has no orphan icon file in the pack', () => {
    const mapped = new Set(Object.values(ITEM_ICON_FILES));
    const onDisk = readdirSync(dir).filter((f) => f.startsWith('item-'));
    expect(onDisk.filter((f) => !mapped.has(f))).toEqual([]);
  });
});
