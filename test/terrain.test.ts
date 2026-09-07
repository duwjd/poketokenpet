import { describe, expect, it } from 'vitest';
import { STOPS } from '../src/journey.ts';
import { TERRAIN_KO, TERRAIN_ORDER } from '../src/terrain.ts';

/**
 * This module used to own `terrainFor(huntCount)`, which cycled the six sheets
 * on their own clock. src/journey.ts answers that now — a stop names its own
 * terrain — so the cycle and its tests are gone and what is left is vocabulary.
 */
describe('terrain vocabulary', () => {
  it('opens on the same grass the app always opened on', () => {
    expect(TERRAIN_ORDER[0]).toBe('field');
  });

  it('names every terrain, so an id can never be printed as a slug', () => {
    for (const id of TERRAIN_ORDER) {
      expect(TERRAIN_KO[id], id).toBeTruthy();
    }
  });

  it('has no id the journey never asks for', () => {
    // A terrain nothing classifies to is a committed sheet with no reader. The
    // converse — a stop naming a terrain that does not exist — is journey.test.
    const used = new Set(STOPS.map((s) => s.terrain));
    for (const id of TERRAIN_ORDER) expect(used, id).toContain(id);
  });

  it('draws caves, mountains, ruins and shores on their own art', () => {
    // The four that used to be stonepath-or-lakeside. Named one by one rather
    // than counted, because the point is which places stopped being lawn.
    for (const id of ['cave', 'mountain', 'ruins', 'seaside'] as const) {
      expect(TERRAIN_ORDER, id).toContain(id);
    }
  });
});
