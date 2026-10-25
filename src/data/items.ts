import type { Item, ItemId } from '../core/gameTypes';

// The 15 v0.1 items (docs/01_GDD.md §8). Every material referenced by a recipe
// or floor must exist here, and every item must have a concrete source.
export const ITEMS: Record<ItemId, Item> = {
  clean_water: { id: 'clean_water', displayName: '净水', category: 'consumable', stackable: true, maxStack: 99 },
  dirty_water: { id: 'dirty_water', displayName: '脏水', category: 'consumable', stackable: true, maxStack: 99 },
  ration_pack: { id: 'ration_pack', displayName: '压缩口粮', category: 'consumable', stackable: true, maxStack: 99 },
  bread: { id: 'bread', displayName: '面包', category: 'consumable', stackable: true, maxStack: 99 },
  medkit: { id: 'medkit', displayName: '医疗包', category: 'consumable', stackable: true, maxStack: 99 },
  battery: { id: 'battery', displayName: '电池', category: 'material', stackable: true, maxStack: 99 },
  scrap_metal: { id: 'scrap_metal', displayName: '废金属', category: 'material', stackable: true, maxStack: 99 },
  wood: { id: 'wood', displayName: '木材', category: 'material', stackable: true, maxStack: 99 },
  cloth: { id: 'cloth', displayName: '布料', category: 'material', stackable: true, maxStack: 99 },
  tape: { id: 'tape', displayName: '胶带', category: 'material', stackable: true, maxStack: 99 },
  filter: { id: 'filter', displayName: '滤芯', category: 'material', stackable: true, maxStack: 99 },
  wire: { id: 'wire', displayName: '电线', category: 'material', stackable: true, maxStack: 99 },
  fuse: { id: 'fuse', displayName: '保险丝', category: 'material', stackable: true, maxStack: 99 },
  crowbar: { id: 'crowbar', displayName: '撬棍', category: 'tool', stackable: false, maxStack: 1 },
  flashlight: { id: 'flashlight', displayName: '低电量手电', category: 'tool', stackable: false, maxStack: 1 },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

export function getItem(id: ItemId): Item {
  return ITEMS[id];
}

export function isItemId(value: string): value is ItemId {
  return Object.prototype.hasOwnProperty.call(ITEMS, value);
}
