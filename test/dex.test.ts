import { describe, expect, it } from 'vitest';
import {
  GENERATIONS,
  backfillPreEvolutions,
  departedCount,
  generationOf,
  lineOf,
  preEvolutionsOf,
  rarityOfSpecies,
  retireInto,
} from '../server/dex.ts';
import { type Companion, type DexEntry } from '../server/game.ts';
import { NAMES } from '../server/species.ts';

const DEX_SIZE = Object.keys(NAMES).length;

const mon = (over: Partial<Companion> = {}): Companion => ({
  pathIds: [4, 5, 6],
  stageIndex: 2,
  isShiny: false,
  rarity: 'rare',
  nature: 'hardy',
  bornAt: 0,
  tokensAtStageStart: 0,
  moves: [],
  ...over,
});

describe('generationOf', () => {
  it('covers every species in the dex', () => {
    for (let id = 1; id <= DEX_SIZE; id++) {
      expect(generationOf(id), `#${id}`).toBeGreaterThan(0);
    }
  });

  it('puts the boundaries where the National Dex does', () => {
    // Verified against PokeAPI: every generation is a contiguous id range.
    expect(generationOf(1)).toBe(1);
    expect(generationOf(151)).toBe(1);
    expect(generationOf(152)).toBe(2);
    expect(generationOf(251)).toBe(2);
    expect(generationOf(252)).toBe(3);
    expect(generationOf(905)).toBe(8);
    expect(generationOf(906)).toBe(9);
    expect(generationOf(1025)).toBe(9);
  });

  it('reports nothing for ids outside the dex', () => {
    expect(generationOf(0)).toBe(0);
    expect(generationOf(DEX_SIZE + 1)).toBe(0);
  });

  it('exposes ranges that tile the whole dex without gaps', () => {
    expect(GENERATIONS).toHaveLength(9);
    let expected = 1;
    for (const g of GENERATIONS) {
      expect(g.from, `gen${g.gen}`).toBe(expected);
      expected = g.to + 1;
    }
    expect(expected - 1).toBe(DEX_SIZE);
  });
});

describe('lineOf / rarityOfSpecies', () => {
  it('finds a line for every species', () => {
    for (let id = 1; id <= DEX_SIZE; id++) expect(lineOf(id), `#${id}`).not.toBeNull();
  });

  it('gives every member of a line the same rarity', () => {
    // captureRate is the root's, so a Charmander and a Charizard rank alike —
    // which is what keeps a rarity filter over the dex coherent once
    // pre-evolutions are auto-registered.
    for (const path of [
      [4, 5, 6],
      [1, 2, 3],
      [172, 25, 26],
    ]) {
      const rarities = new Set(path.map(rarityOfSpecies));
      expect(rarities.size, path.join('>')).toBe(1);
    }
  });

  it('reads an unknown id as common rather than legendary', () => {
    // 255 is the most catchable rate there is; guessing the other way would
    // make a data gap look like a jackpot.
    expect(rarityOfSpecies(99999)).toBe('common');
  });
});

describe('preEvolutionsOf', () => {
  it('is empty for a species that starts its line', () => {
    expect(preEvolutionsOf(1)).toEqual([]);
    expect(preEvolutionsOf(172)).toEqual([]);
  });

  it('walks back to the root, oldest first', () => {
    expect(preEvolutionsOf(6)).toEqual([4, 5]);
    expect(preEvolutionsOf(26)).toEqual([172, 25]);
  });

  it('picks the right prefix inside a branching line', () => {
    // Measured across all 541 lines: no species reaches its position by two
    // different prefixes, so this is unambiguous even where lines fork.
    expect(preEvolutionsOf(45)).toEqual([43, 44]); // Vileplume
    expect(preEvolutionsOf(182)).toEqual([43, 44]); // Bellossom, same prefix
    expect(preEvolutionsOf(267)).toEqual([265, 266]); // Beautifly via Silcoon
    expect(preEvolutionsOf(269)).toEqual([265, 268]); // Dustox via Cascoon
    expect(preEvolutionsOf(134)).toEqual([133]); // Vaporeon
  });
});

describe('retireInto', () => {
  const at = 1_700_000_000_000;

  it('records every form the companion passed through', () => {
    // Raising a Charizard means having raised a Charmander.
    const dex = retireInto([], mon(), at);
    expect(dex.map((d) => d.speciesId)).toEqual([4, 5, 6]);
  });

  it('records only as far as it actually got', () => {
    const dex = retireInto([], mon({ stageIndex: 1 }), at);
    expect(dex.map((d) => d.speciesId)).toEqual([4, 5]);
  });

  it('puts the nickname on the form that left, and nowhere else', () => {
    const dex = retireInto([], mon({ nickname: 'REO' }), at);
    expect(dex.map((d) => d.nickname)).toEqual([undefined, undefined, 'REO']);
  });

  it('carries shininess down the whole line', () => {
    // It is one individual, so every stage it passed through was shiny too.
    const dex = retireInto([], mon({ isShiny: true }), at);
    expect(dex.every((d) => d.shiny)).toBe(true);
  });

  it('keeps shiny and ordinary as separate entries', () => {
    const plain = retireInto([], mon(), at);
    const both = retireInto(plain, mon({ isShiny: true }), at);
    expect(both).toHaveLength(6);
  });

  it('does not grow when the same line graduates twice', () => {
    const once = retireInto([], mon(), at);
    expect(retireInto(once, mon(), at + 1)).toHaveLength(3);
  });

  it('leaves the array it was given alone', () => {
    const before: DexEntry[] = [];
    retireInto(before, mon(), at);
    expect(before).toHaveLength(0);
  });
});

describe('backfillPreEvolutions', () => {
  it('fills in stages that were recorded before the rule existed', () => {
    const old: DexEntry[] = [{ speciesId: 26, shiny: false, firstSeenAt: 5 }];
    const filled = backfillPreEvolutions(old, 0);
    expect(filled.map((d) => d.speciesId).sort((a, b) => a - b)).toEqual([25, 26, 172]);
    // The added entries inherit the date of the one that implied them.
    expect(filled.every((d) => d.firstSeenAt === 5)).toBe(true);
  });

  it('matches shininess', () => {
    const old: DexEntry[] = [{ speciesId: 6, shiny: true, firstSeenAt: 1 }];
    expect(backfillPreEvolutions(old, 0).every((d) => d.shiny)).toBe(true);
  });

  it('is a no-op the second time', () => {
    const once = backfillPreEvolutions([{ speciesId: 6, shiny: false, firstSeenAt: 1 }], 0);
    expect(backfillPreEvolutions(once, 0)).toHaveLength(once.length);
  });

  it('leaves a dex of line-starters untouched', () => {
    const roots: DexEntry[] = [
      { speciesId: 1, shiny: false, firstSeenAt: 1 },
      { speciesId: 172, shiny: false, firstSeenAt: 2 },
    ];
    expect(backfillPreEvolutions(roots, 0)).toHaveLength(2);
  });
});

describe('a fused companion joining a dex that already has its species', () => {
  const KYUREM = 646;
  const BLACK = 10022;

  /**
   * The bug this exists for.
   *
   * `record` used to return early on "(species, shiny) already present", so a
   * Black Kyurem graduating after a plain Kyurem stored NOTHING — its formId
   * and its nickname were lost, not merely hidden. Which one you raised first
   * decided what the save remembered.
   */
  it('fills in the form the first one did not have', () => {
    const first = retireInto([], mon({ pathIds: [KYUREM], stageIndex: 0 }), 0);
    expect(first[0].formId).toBeUndefined();

    const after = retireInto(first, mon({ pathIds: [KYUREM], stageIndex: 0, formId: BLACK }), 1);
    expect(after).toHaveLength(1); // still one row per (species, shiny)
    expect(after[0].formId).toBe(BLACK);
    expect(after[0].firstSeenAt).toBe(0); // the first sighting keeps its date
  });

  it('fills in a nickname the first one did not have', () => {
    const first = retireInto([], mon({ pathIds: [KYUREM], stageIndex: 0 }), 0);
    const after = retireInto(first, mon({ pathIds: [KYUREM], stageIndex: 0, nickname: '검둥이' }), 1);
    expect(after[0].nickname).toBe('검둥이');
  });

  it('never overwrites what is already there', () => {
    // The first individual to leave under a name keeps it.
    const first = retireInto([], mon({ pathIds: [KYUREM], stageIndex: 0, nickname: '하양이' }), 0);
    const after = retireInto(first, mon({ pathIds: [KYUREM], stageIndex: 0, nickname: '검둥이' }), 1);
    expect(after[0].nickname).toBe('하양이');
    expect(after).toEqual(first);
  });

  it('adds a row rather than merging when the shininess differs', () => {
    const first = retireInto([], mon({ pathIds: [KYUREM], stageIndex: 0 }), 0);
    const shiny = retireInto(first, mon({ pathIds: [KYUREM], stageIndex: 0, isShiny: true }), 1);
    expect(shiny).toHaveLength(2);
  });
});

describe('departedCount', () => {
  /**
   * The user-visible symptom this guards: the dex tab shows one number for
   * species and another for individuals, and the second must not read as a
   * counter that stopped. Litleo + Pyroar + Snover + Abomasnow is four
   * entries and two departures.
   */
  it('counts departures, not entries', () => {
    const dex: DexEntry[] = [
      { speciesId: 668, shiny: false, firstSeenAt: 1 },
      { speciesId: 667, shiny: false, firstSeenAt: 1 },
      { speciesId: 459, shiny: false, firstSeenAt: 2 },
      { speciesId: 460, shiny: false, firstSeenAt: 2 },
    ];
    expect(departedCount(dex)).toBe(2);
  });

  it('does not let a normal entry mask a shiny one', () => {
    const dex: DexEntry[] = [
      { speciesId: 4, shiny: true, firstSeenAt: 1 },
      { speciesId: 6, shiny: false, firstSeenAt: 2 },
      { speciesId: 5, shiny: false, firstSeenAt: 2 },
      { speciesId: 4, shiny: false, firstSeenAt: 2 },
    ];
    // The shiny Charmander left as a Charmander; the normal one only passed
    // through on the way to Charizard.
    expect(departedCount(dex)).toBe(2);
  });

  it('under-reads rather than over-reads when a line repeats', () => {
    // Two Pyroars that graduate leave one entry between them, so the floor is
    // 1 — low, never high. Inventing a departure is the failure that matters.
    const dex: DexEntry[] = [
      { speciesId: 667, shiny: false, firstSeenAt: 1 },
      { speciesId: 668, shiny: false, firstSeenAt: 1 },
    ];
    expect(departedCount(dex)).toBe(1);
  });

  it('is zero on an empty dex', () => {
    expect(departedCount([])).toBe(0);
  });
});
