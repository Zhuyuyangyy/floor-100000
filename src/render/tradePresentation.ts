export interface TradeRowPresentation {
  canBuy: boolean;
  priceLabel: string;
  carriedLabel: string;
  actionLabel: string;
}

/** Formats a trade row from the current values supplied by the scene. */
export function tradeRowPresentation(
  gold: number,
  price: number,
  carried: number,
): TradeRowPresentation {
  const canBuy = gold >= price;
  return {
    canBuy,
    priceLabel: `${price} 金`,
    carriedLabel: `持有 ${carried}`,
    actionLabel: canBuy ? 'Enter 买入' : '金币不足',
  };
}
