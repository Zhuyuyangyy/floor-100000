import { describe, expect, it } from 'vitest';

import { combatLogTail } from './combatLog';

describe('combatLogTail', () => {
  it('returns the newest messages in chronological order', () => {
    const source = ['遭遇开始', '你击中拾荒者，造成 2 点伤害', '拾荒者扑空了', '你击败了拾荒者'];

    expect(combatLogTail(source)).toEqual(source.slice(-3));
    expect(source).toEqual(['遭遇开始', '你击中拾荒者，造成 2 点伤害', '拾荒者扑空了', '你击败了拾荒者']);
  });

  it('supports a custom entry limit and empty results', () => {
    expect(combatLogTail(['a', 'b', 'c'], 1)).toEqual(['c']);
    expect(combatLogTail(['a'], 0)).toEqual([]);
    expect(combatLogTail([], 3)).toEqual([]);
  });
});
