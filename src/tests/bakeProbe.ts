import { generateAllPixelArt } from '../render/pixelArt';

// Records what generateAllPixelArt() bakes, without a Phaser instance.
//
// bake() only needs add.graphics(), a drawing call and generateTexture(), so a
// recording stub is enough. Shared because two test files need it: textureKeys
// checks that every key resolves, sceneScale checks that the sizes relate to each
// other (a door shorter than the player, a prop twice the player's height).

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
  const scene = { add: { graphics: () => graphics } };
  // The parameter type is a Phaser.Scene; the stub satisfies every member the
  // function actually touches, which is all bake() needs.
  generateAllPixelArt(scene as unknown as Parameters<typeof generateAllPixelArt>[0]);
  return out;
}
