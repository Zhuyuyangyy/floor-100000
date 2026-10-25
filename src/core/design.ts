// Fixed internal design resolution for the 2D pixel game (16:9).
export const DESIGN_WIDTH = 640;
export const DESIGN_HEIGHT = 360;

export interface IntegerScale {
  scale: number;
  width: number;
  height: number;
}

// Largest integer upscale factor that fits the design resolution inside a
// viewport, clamped to [1, maxScale]. Primitive for the pixel-perfect scaler.
export function computeIntegerScale(
  viewportWidth: number,
  viewportHeight: number,
  maxScale = 8,
): IntegerScale {
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    throw new Error('viewport dimensions must be positive');
  }
  const raw = Math.min(viewportWidth / DESIGN_WIDTH, viewportHeight / DESIGN_HEIGHT);
  const scale = Math.max(1, Math.min(maxScale, Math.floor(raw)));
  return { scale, width: DESIGN_WIDTH * scale, height: DESIGN_HEIGHT * scale };
}
