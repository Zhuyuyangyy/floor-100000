// Fixed internal design resolution for the 2D pixel game (16:9).
//
// 1280x720, not 640x360. The tower is a cross-section that shows 3.6 floors at
// once, and the only way to fit that in a 16:9 view is for the view to be
// 1280x720 world px — one floor's width by 3.6 floors' height. At 640x360 that
// same view needs a camera zoom of 0.5, and a camera zoom resamples the whole
// world through the renderer's filter, which came out LINEAR no matter what was
// set on the textures: a 15-colour figure rendered as 291 colours with #d9b48f
// arriving as #cdaa88. At zoom 1 there is no resample at all and the pixel art
// is exact.
//
// The cost is that text is now specified in canvas pixels rather than in
// half-canvas pixels, so every fontSize doubled to keep the same size on screen
// — the canvas is displayed 1:1 in a 1280x720 window where it used to be
// displayed 2x.
export const DESIGN_WIDTH = 1280;
export const DESIGN_HEIGHT = 720;

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
