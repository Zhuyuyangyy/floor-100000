import { generateAllPixelArt } from '../render/pixelArt';

// Records what generateAllPixelArt() bakes, without a Phaser instance.
//
// bake() only needs add.graphics(), a drawing call and generateTexture(); the
// walk sheets need textures.exists() and textures.createCanvas(). A recording
// stub covers both, so this stays the single place that fakes a scene. Shared
// because two test files need it: textureKeys checks that every key resolves,
// sceneScale checks that the sizes relate to each other (a door shorter than the
// player, a prop twice the player's height).

export interface BakedTexture {
  key: string;
  width: number;
  height: number;
}

/** @returns every texture generateAllPixelArt bakes, with its pixel size. */
export function bakedTextures(): BakedTexture[] {
  const out: BakedTexture[] = [];
  const graphics = {
    fillStyle: () => graphics,
    fillRect: () => graphics,
    fillTriangle: () => graphics,
    fillCircle: () => graphics,
    lineStyle: () => graphics,
    lineBetween: () => graphics,
    strokeRect: () => graphics,
    clear: () => graphics,
    generateTexture: (key: string, width: number, height: number) => {
      out.push({ key, width, height });
    },
    destroy: () => graphics,
  };

  // createCanvas hands back something with a 2d context the bake path writes an
  // ImageData into. The stub's putImageData is a no-op because the pixel data has
  // already been verified by walkcycle.test.ts; what matters here is that the key
  // and the size are recorded so textureKeys can resolve them.
  const textures = {
    exists: (key: string) => out.some((t) => t.key === key),
    createCanvas: (key: string, width: number, height: number) => {
      out.push({ key, width, height });
      return {
        context: { createImageData: () => ({ data: new Uint8ClampedArray(width * height * 4) }), putImageData: () => {} },
        refresh: () => {},
        add: () => {},
      };
    },
  };

  const scene = { add: { graphics: () => graphics }, textures };
  // The parameter type is a Phaser.Scene; the stub satisfies every member the
  // function actually touches.
  generateAllPixelArt(scene as unknown as Parameters<typeof generateAllPixelArt>[0]);
  return out;
}
