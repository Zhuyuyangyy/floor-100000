import type { Item, ItemId } from '../core/gameTypes';

// Every item referenced by a recipe, floor or encounter must exist here.
export const ITEMS: Record<ItemId, Item> = {
  clean_water: { id: 'clean_water', displayName: '净水', category: 'consumable', stackable: true, maxStack: 99, effect: { stat: 'thirst', amount: 30 } },
  dirty_water: { id: 'dirty_water', displayName: '脏水', category: 'consumable', stackable: true, maxStack: 99 },
  ration_pack: { id: 'ration_pack', displayName: '压缩口粮', category: 'consumable', stackable: true, maxStack: 99, effect: { stat: 'hunger', amount: 30 } },
  bread: { id: 'bread', displayName: '面包', category: 'consumable', stackable: true, maxStack: 99, effect: { stat: 'hunger', amount: 20 } },
  medkit: { id: 'medkit', displayName: '医疗包', category: 'consumable', stackable: true, maxStack: 99, effect: { stat: 'hp', amount: 40 } },
  battery: { id: 'battery', displayName: '电池', category: 'material', stackable: true, maxStack: 99 },
  scrap_metal: { id: 'scrap_metal', displayName: '废金属', category: 'material', stackable: true, maxStack: 99 },
  wood: { id: 'wood', displayName: '木材', category: 'material', stackable: true, maxStack: 99 },
  cloth: { id: 'cloth', displayName: '布料', category: 'material', stackable: true, maxStack: 99 },
  tape: { id: 'tape', displayName: '胶带', category: 'material', stackable: true, maxStack: 99 },
  filter: { id: 'filter', displayName: '滤芯', category: 'material', stackable: true, maxStack: 99 },
  wire: { id: 'wire', displayName: '电线', category: 'material', stackable: true, maxStack: 99 },
  fuse: { id: 'fuse', displayName: '保险丝', category: 'material', stackable: true, maxStack: 99 },
  crowbar: { id: 'crowbar', displayName: '撬棍', category: 'tool', stackable: false, maxStack: 1 },
  fire_axe: { id: 'fire_axe', displayName: '消防斧', category: 'tool', stackable: false, maxStack: 1 },
  cleaver: { id: 'cleaver', displayName: '砍刀', category: 'tool', stackable: false, maxStack: 1 },
  short_sword: { id: 'short_sword', displayName: '短剑', category: 'tool', stackable: false, maxStack: 1 },
  dagger: { id: 'dagger', displayName: '匕首', category: 'tool', stackable: false, maxStack: 1 },
  flashlight: { id: 'flashlight', displayName: '低电量手电', category: 'tool', stackable: false, maxStack: 1 },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

export function getItem(id: ItemId): Item {
  return ITEMS[id];
}

export function isItemId(value: string): value is ItemId {
  return Object.prototype.hasOwnProperty.call(ITEMS, value);
}
