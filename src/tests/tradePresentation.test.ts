import { describe, expect, it } from 'vitest';
import { tradeRowPresentation } from '../render/tradePresentation';

describe('trade row presentation', () => {
  it('allows buying with exact gold and formats the price and action', () => {
    expect(tradeRowPresentation(12, 12, 3)).toEqual({
      canBuy: true,
      priceLabel: '12 金',
      carriedLabel: '持有 3',
      actionLabel: 'Enter 买入',
    });
  });

  it('shows insufficient gold when the balance is below the price', () => {
    expect(tradeRowPresentation(11, 12, 0)).toEqual({
      canBuy: false,
      priceLabel: '12 金',
      carriedLabel: '持有 0',
      actionLabel: '金币不足',
    });
  });

  it('formats supplied carried quantities, including zero and larger quantities', () => {
    expect(tradeRowPresentation(50, 7, 0).carriedLabel).toBe('持有 0');
    expect(tradeRowPresentation(50, 7, 24).carriedLabel).toBe('持有 24');
  });

  it('derives every field from each call rather than retaining copied values', () => {
    expect(tradeRowPresentation(0, 2, 5)).toEqual({
      canBuy: false,
      priceLabel: '2 金',
      carriedLabel: '持有 5',
      actionLabel: '金币不足',
    });
    expect(tradeRowPresentation(9, 4, 1)).toEqual({
      canBuy: true,
      priceLabel: '4 金',
      carriedLabel: '持有 1',
      actionLabel: 'Enter 买入',
    });
  });
});
