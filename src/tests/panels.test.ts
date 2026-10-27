import { describe, expect, it } from 'vitest';
import { PANEL_DEPTH, PANEL_FILL_OFFSET, PANEL_FRAME_OFFSET } from '../render/panels';

// The panels inside one scene are drawn at different content depths so a modal
// lands above whatever is already open, and each panel's frame and fill sit a
// fixed offset below its own content. Those two facts together are a trap: a small
// offset puts one panel's frame above another panel's content, and because Phaser
// composites a panel's frame after the plain Images inside a *different* panel,
// the icons vanish with no error at all.
//
// That is not hypothetical. At -5 the craft panel's frame sat at 205, above the
// inventory's row icons at 200, and every icon in the bag disappeared while the
// craft panel was closed.
describe('panel depth ordering', () => {
  it('names every panel that exists', () => {
    // inventory / craft / dialogue / pause in GameScene, help in MenuScene, the
    // floor detail in TowerOverviewScene.
    expect(Object.keys(PANEL_DEPTH).sort()).toEqual(['game', 'menu', 'tower']);
    expect(Object.keys(PANEL_DEPTH.game).sort()).toEqual(['craft', 'dialogue', 'inventory', 'pause']);
  });

  it('keeps every panel frame and fill below every panel content, per scene', () => {
    // The actual regression guard. A frame at or above another panel's content
    // depth is composited over that panel's plain Images, so its icons disappear
    // while the owning panel is closed.
    for (const [scene, panels] of Object.entries(PANEL_DEPTH)) {
      const depths = Object.values(panels);
      const shallowestContent = Math.min(...depths);
      expect(Math.max(...depths) + PANEL_FRAME_OFFSET, `${scene} frame`).toBeLessThan(shallowestContent);
      expect(Math.max(...depths) + PANEL_FILL_OFFSET, `${scene} fill`).toBeLessThan(shallowestContent);
    }
  });

  it('still leaves the frame and fill above the HUD', () => {
    // Below 120 the HUD (clock, stat bars, feedback line, control hint) would
    // bleed through the panel's border.
    for (const [scene, panels] of Object.entries(PANEL_DEPTH)) {
      expect(Math.min(...Object.values(panels)) + PANEL_FILL_OFFSET, `${scene} fill`).toBeGreaterThan(120);
    }
  });

  it('spreads the panels of one scene far enough apart to act as modals', () => {
    // If two panels in one scene shared a content depth the invariant above would
    // still hold but the "modal above whatever is open" behaviour would not.
    const gameDepths = Object.values(PANEL_DEPTH.game);
    expect(Math.max(...gameDepths) - Math.min(...gameDepths)).toBeGreaterThanOrEqual(30);
  });
});
