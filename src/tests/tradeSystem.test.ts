import { describe, expect, it } from 'vitest';
import { createInventory, createNewGame } from '../core/gameState';
import { addItem, countItem } from '../systems/InventorySystem';
import { canFit, trade } from '../systems/TradeSystem';
import { NPCS } from '../data/npcs';
import type { NpcId } from '../data/npcs';

function npc(id: NpcId) {
  return NPCS.find((n) => n.id === id)!;
}

describe('trade (atomic barter)', () => {
  it('exchanges items when the player can pay and has room', () => {
    const s = createNewGame(1);
    addItem(s.player.inventory, 'scrap_metal', 1);
    const offer = npc('alin').offers[0]; // 电线 <- 废金属
    const wireBefore = countItem(s.player.inventory, 'wire');
    expect(trade(s, offer).ok).toBe(true);
    expect(countItem(s.player.inventory, 'wire')).toBe(wireBefore + 1);
    expect(countItem(s.player.inventory, 'scrap_metal')).toBe(0);
  });

  it('fails with no partial exchange when the player cannot pay', () => {
    const s = createNewGame(1);
    const offer = npc('alin').offers[0]; // needs 废金属, player has none
    const r = trade(s, offer);
    expect(r.ok).toBe(false);
    expect(countItem(s.player.inventory, 'wire')).toBe(0);
    expect(countItem(s.player.inventory, 'scrap_metal')).toBe(0);
  });

  it('fails with no exchange when the received item cannot fit', () => {
    const s = createNewGame(1);
    s.player.inventory.slots = [];
    s.player.inventory.slotCount = 1;
    addItem(s.player.inventory, 'scrap_metal', 1); // bag now full
    const offer = npc('alin').offers[0]; // would give 电线
    const r = trade(s, offer);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('空间');
    expect(countItem(s.player.inventory, 'scrap_metal')).toBe(1); // not deducted
  });
});

describe('canFit', () => {
  it('stacks into a partial stack, else needs a free slot', () => {
    const inv = createInventory(1);
    addItem(inv, 'clean_water', 3);
    expect(canFit(inv, 'clean_water', 5)).toBe(true);
    expect(canFit(inv, 'wood', 1)).toBe(false);
  });
});
