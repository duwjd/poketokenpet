import { describe, expect, it } from 'vitest';
import { BG_SLUGS, DEFAULT_BG, biomeFor } from '../server/biome.ts';
import { TYPES } from '../server/moves.ts';
import { speciesInfo } from '../server/moves.ts';

describe('biomeFor', () => {
  it('answers with a real backdrop for every single type', () => {
    for (const t of TYPES) {
      expect(BG_SLUGS, t).toContain(biomeFor([t]));
    }
  });

  it('falls back rather than returning nothing when types are missing', () => {
    // speciesInfo returns null for ids it has no row for, and the caller passes
    // `?? []` straight through. A blank slug would be interpolated into a URL.
    expect(biomeFor([])).toBe(DEFAULT_BG);
  });

  it('lets the scene-defining half of a dual type win', () => {
    // The order of BY_TYPE is the whole design, so pin the calls it exists for.
    expect(biomeFor(['grass', 'poison'])).toBe('meadow'); // 이상해씨, not a cave
    expect(biomeFor(['water', 'ice'])).toBe('river'); // 라프라스, not an ice cave
    expect(biomeFor(['rock', 'ground'])).toBe('mountain'); // 롱스톤, not a desert
    expect(biomeFor(['fire', 'flying'])).toBe('volcanocave'); // 리자몽
    expect(biomeFor(['electric'])).toBe('thunderplains'); // 피카츄
  });

  it('does not depend on the order the two types arrive in', () => {
    for (const a of TYPES) {
      for (const b of TYPES) {
        expect(biomeFor([a, b]), `${a}/${b}`).toBe(biomeFor([b, a]));
      }
    }
  });

  it('gives every real species a backdrop', () => {
    // The payload calls this on whatever the hunt turned up, so a gap here is a
    // blank battle screen for one species and nothing else.
    for (let id = 1; id <= 1025; id++) {
      const types = speciesInfo(id)?.types;
      if (!types) continue;
      expect(BG_SLUGS, String(id)).toContain(biomeFor(types));
    }
  });
});
