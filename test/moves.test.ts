import { describe, expect, it } from 'vitest';
import { MOVES, SPECIES, TYPES, TYPE_KO, canLearn, learnableMoves, moveById, speciesInfo } from '../server/moves.ts';
import { NAMES } from '../server/species.ts';

/** Species that legitimately learn nothing by machine. Faithful to the games. */
const NO_MACHINE_MOVES = [13, 14, 132, 235, 265, 266, 268, 789, 824];

describe('generated move table', () => {
  it('covers every machine-learnable move exactly once', () => {
    expect(MOVES.length).toBeGreaterThan(300);
    expect(new Set(MOVES.map((m) => m.id)).size).toBe(MOVES.length);
  });

  it('names every move in Korean and puts it in a known type', () => {
    for (const m of MOVES) {
      expect(m.ko, `#${m.id}`).toBeTruthy();
      expect(TYPES, `#${m.id}`).toContain(m.type);
      expect(TYPE_KO[m.type]).toBeTruthy();
      expect(['physical', 'special', 'status']).toContain(m.damageClass);
    }
  });

  it('teaches something to every species except the nine that learn nothing', () => {
    const empty: number[] = [];
    for (let id = 1; id <= 1025; id++) if (learnableMoves(id).length === 0) empty.push(id);
    expect(empty).toEqual(NO_MACHINE_MOVES);
  });

  it('agrees with itself about what a species can learn', () => {
    for (const id of [1, 25, 668, 906, 1025]) {
      for (const moveId of learnableMoves(id)) expect(canLearn(id, moveId), `${id}/${moveId}`).toBe(true);
    }
  });
});

describe('generated species table', () => {
  it('describes every species in the Pokedex', () => {
    expect(Object.keys(SPECIES)).toHaveLength(Object.keys(NAMES).length);
  });

  it('gives each one or two known types', () => {
    for (let id = 1; id <= 1025; id++) {
      const s = speciesInfo(id)!;
      expect(s, `#${id}`).not.toBeNull();
      expect(s.types.length, `#${id}`).toBeGreaterThanOrEqual(1);
      expect(s.types.length, `#${id}`).toBeLessThanOrEqual(2);
      for (const t of s.types) expect(TYPES, `#${id}`).toContain(t);
    }
  });

  it('gives each a Korean genus and a positive size', () => {
    for (let id = 1; id <= 1025; id++) {
      const s = speciesInfo(id)!;
      expect(s.genus, `#${id}`).toBeTruthy();
      expect(s.heightM, `#${id}`).toBeGreaterThan(0);
      expect(s.weightKg, `#${id}`).toBeGreaterThan(0);
    }
  });

  it('reports metres and kilograms, not the decimetres PokeAPI serves', () => {
    // Pyroar is 1.5m / 81.5kg; upstream says 15 and 815.
    expect(speciesInfo(668)).toMatchObject({ heightM: 1.5, weightKg: 81.5, genus: '임금포켓몬' });
    expect(speciesInfo(1)!.types).toEqual(['grass', 'poison']);
  });

  it('returns null outside the Pokedex rather than throwing', () => {
    expect(speciesInfo(0)).toBeNull();
    expect(speciesInfo(9999)).toBeNull();
  });
});

describe('what a move does beyond its power', () => {
  it('carries stage changes and says who they land on', () => {
    expect(moveById(14)).toMatchObject({ target: 'user', statChanges: [{ stat: 'attack', change: 2 }] });
    expect(moveById(103)).toMatchObject({ target: 'selected-pokemon', statChanges: [{ stat: 'defense', change: -2 }] });
    expect(moveById(347)!.statChanges).toEqual([
      { stat: 'special-attack', change: 1 },
      { stat: 'special-defense', change: 1 },
    ]);
    // A damaging move's change is a chance, and 오버히트's is its own cost.
    expect(moveById(94)).toMatchObject({ statChance: 10, statChanges: [{ stat: 'special-defense', change: -1 }] });
    expect(moveById(315)).toMatchObject({ category: 'damage-raise', statChanges: [{ stat: 'special-attack', change: -2 }] });
  });

  it('carries priority, drain, recoil, flinch and hit counts', () => {
    expect(moveById(182)!.priority).toBe(4);
    expect(moveById(264)!.priority).toBe(-3);
    expect(moveById(433)!.priority).toBe(-7);
    expect(moveById(202)!.drain).toBe(50);
    expect(moveById(38)!.drain).toBe(-33);
    expect(moveById(157)!.flinchChance).toBe(30);
    expect(moveById(331)!.hits).toEqual([2, 5]);
    expect(moveById(89)!.hits).toBeNull();
  });

  it('only ever names a stat the battle knows', () => {
    const known = new Set(['attack', 'defense', 'special-attack', 'special-defense', 'speed', 'accuracy', 'evasion']);
    for (const m of MOVES) for (const c of m.statChanges) expect(known.has(c.stat), `${m.en}`).toBe(true);
  });
});
