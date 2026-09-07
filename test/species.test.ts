import { describe, expect, it } from 'vitest';
import { LINES, NAMES, speciesName } from '../server/species.ts';
import { rarityOf, rollSpecies, mulberry32 } from '../server/game.ts';

const ALL_IDS = Object.keys(NAMES).map(Number);
const reachable = new Set(LINES.flatMap((l) => l.paths.flat()));

describe('roster coverage', () => {
  it('covers the whole Pokedex — every species must be raisable', () => {
    // Regression for chain 250: Phione and Manaphy are two roots of ONE chain,
    // so keying lines by chain id dropped Phione entirely.
    const missing = ALL_IDS.filter((id) => !reachable.has(id));
    expect(missing).toEqual([]);
    expect(reachable.size).toBe(ALL_IDS.length);
  });

  it('includes Phione and Manaphy as separate lines', () => {
    expect(reachable.has(489)).toBe(true);
    expect(reachable.has(490)).toBe(true);
    expect(speciesName(489)).toBe('피오네');
  });

  it('spans generation 1 through 9', () => {
    expect(reachable.has(1)).toBe(true); // 이상해씨
    expect(reachable.has(649)).toBe(true); // last gen-5
    expect(reachable.has(650)).toBe(true); // first gen-6
    expect(reachable.has(1025)).toBe(true); // last gen-9
  });
});

describe('line shape', () => {
  it('every path is 1..3 stages with no repeats', () => {
    for (const l of LINES) {
      expect(l.paths.length).toBeGreaterThan(0);
      for (const p of l.paths) {
        expect(p.length).toBeGreaterThanOrEqual(1);
        expect(p.length).toBeLessThanOrEqual(3);
        expect(new Set(p).size).toBe(p.length);
      }
    }
  });

  it('every species id in a path has a name', () => {
    for (const id of reachable) expect(NAMES[id]).toBeDefined();
  });

  it('all four rarity buckets are populated', () => {
    const buckets = new Set(LINES.map((l) => rarityOf(l.captureRate)));
    expect([...buckets].sort()).toEqual(['common', 'legendary', 'rare', 'uncommon']);
  });
});

describe('rollSpecies', () => {
  it('only ever returns a line from the table', () => {
    for (let seed = 0; seed < 300; seed++) {
      const line = rollSpecies(mulberry32(seed));
      expect(LINES).toContain(line);
    }
  });

  it('keeps working once the dex is essentially full', () => {
    // The "prefer uncollected" filter must never dead-end.
    const everything = new Set(reachable);
    for (let seed = 0; seed < 50; seed++) {
      const line = rollSpecies(mulberry32(seed), everything);
      expect(line.paths.length).toBeGreaterThan(0);
    }
  });

  it('honours a forced rarity', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(rarityOf(rollSpecies(mulberry32(seed), new Set(), 'legendary').captureRate)).toBe(
        'legendary',
      );
      expect(['rare', 'legendary']).toContain(
        rarityOf(rollSpecies(mulberry32(seed), new Set(), 'rare').captureRate),
      );
    }
  });
});
