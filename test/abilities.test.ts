import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fightAt, foeOf, mineOf, type BattleTurn, type Fight } from '../server/fight.ts';
import { ALL_ABILITIES, HIDDEN_ODDS, NO_EFFECT, abilityKo, abilityOf, abilitySlotFor } from '../server/abilities.ts';
import { SPECIES_ABILITIES } from '../server/abilitydata.ts';

const foe = (speciesId: number, moves: number[], ability: string | null = null) => foeOf(speciesId, 'rare', 1, moves, ability);
const me = (moves: number[], speciesId: number, ability: string | null) => mineOf(moves, { mySpeciesId: speciesId, myAbility: ability });
const turnsOf = (f: Fight) => f.rounds.flatMap((r) => r.turns);
const mine = (t: BattleTurn, id: number) => t.meActed && !t.mySkip && t.moveId === id;
const said = (t: BattleTurn, ability: string, side: 'me' | 'foe' = 'me') =>
  (side === 'me' ? t.myEvents : t.foeEvents).some((e) => e.k === 'ability' && e.ability === ability);

describe('every ability', () => {
  const source = fs.readFileSync(new URL('../server/fight.ts', import.meta.url), 'utf8');

  it('either does something in the fight, or is written down as doing nothing', () => {
    const unaccounted = ALL_ABILITIES.filter((a) => !(a in NO_EFFECT) && !source.includes(`'${a}'`));
    expect(unaccounted).toEqual([]);
  });

  it('has a name to show', () => {
    for (const a of ALL_ABILITIES) expect(abilityKo(a)).not.toBe('');
  });
});

describe('who has which', () => {
  it('deals the hidden ability about one time in twenty', () => {
    let hidden = 0;
    let n = 0;
    for (let seed = 0; seed < 4000; seed++) {
      if (!SPECIES_ABILITIES[1][1]) break;
      n++;
      if (abilitySlotFor(seed, 1) === 2) hidden++;
    }
    expect(hidden / n).toBeGreaterThan(HIDDEN_ODDS * 0.6);
    expect(hidden / n).toBeLessThan(HIDDEN_ODDS * 1.4);
  });

  it('keeps the slot as a species evolves', () => {
    // 파이리 slot 2 is 선파워, and so is 리자몽's.
    expect(abilityOf(4, 2)).toBe('solar-power');
    expect(abilityOf(6, 2)).toBe('solar-power');
    expect(abilityOf(25, 1)).toBe(abilityOf(25, 0)); // 피카츄 has one ordinary ability
  });

  it('gives a mega its own', () => {
    expect(abilityOf(6, 0, 10034)).toBe('tough-claws'); // 메가리자몽X
  });
});

describe('abilities in battle', () => {
  it('doubles the chance of a secondary effect with 하늘의은총', () => {
    const rate = (ability: string | null) => {
      let used = 0;
      let paralysed = 0;
      for (let k = 0; k < 600; k++) {
        for (const t of turnsOf(fightAt(k, [me([34], 468, ability)], [foe(143, [14])]))) {
          if (!mine(t, 34) || t.missed) continue;
          used++;
          if (t.ailment === 'paralysis') paralysed++;
          break; // the first hit only: a paralysed foe cannot be paralysed again
        }
      }
      return paralysed / used;
    };
    const plain = rate(null);
    const graced = rate('serene-grace');
    expect(plain).toBeGreaterThan(0.2);
    expect(plain).toBeLessThan(0.4);
    expect(graced).toBeGreaterThan(0.48);
  });

  it('lowers the other side\'s attack on the way in with 위협', () => {
    const f = fightAt(0, [me([33], 130, 'intimidate')], [foe(143, [34])]);
    const entry = f.rounds[0].entry;
    expect(entry).toContainEqual({ k: 'ability', on: 'me', ability: 'intimidate' });
    expect(entry).toContainEqual({ k: 'end-stat', on: 'foe', stat: 'atk', delta: -1 });
  });

  it('brings rain in with 잔비', () => {
    const f = fightAt(0, [me([33], 382, 'drizzle')], [foe(143, [34])]);
    expect(f.rounds[0].entry).toContainEqual({ k: 'weather-set', weather: 'rain' });
    expect(turnsOf(f)[0].field.weather).toBe('rain');
  });

  it('floats over Ground moves with 부유 — unless 틀깨기 walks past it', () => {
    for (let k = 0; k < 30; k++) {
      for (const t of turnsOf(fightAt(k, [me([89], 76, null)], [foe(94, [14], 'levitate')]))) {
        if (mine(t, 89) && !t.missed) expect(t.effect).toBe(0);
      }
      for (const t of turnsOf(fightAt(k, [me([89], 76, 'mold-breaker')], [foe(94, [14], 'levitate')]))) {
        if (mine(t, 89) && !t.missed) expect(t.effect).toBeGreaterThan(0);
      }
    }
  });

  it('strikes five times, every time, with 스킬링크', () => {
    for (let k = 0; k < 40; k++) {
      for (const t of turnsOf(fightAt(k, [me([331], 91, 'skill-link')], [foe(143, [14])]))) {
        const h = mine(t, 331) && !t.missed && t.foeHpAfter > 0 ? t.myEvents.find((e) => e.k === 'hits') : undefined;
        if (h && h.k === 'hits') expect(h.n).toBe(5);
      }
    }
  });

  it('drinks in an Electric move with 축전', () => {
    let drank = 0;
    for (let k = 0; k < 40; k++) {
      for (const t of turnsOf(fightAt(k, [me([85], 25, null)], [foe(135, [14], 'volt-absorb')]))) {
        if (mine(t, 85) && !t.missed) {
          expect(t.damage).toBe(0);
          if (said(t, 'volt-absorb')) drank++;
        }
      }
    }
    expect(drank).toBeGreaterThan(0);
  });

  it('hangs on at 1 HP from a full bar with 옹골참', () => {
    let held = 0;
    for (let k = 0; k < 40; k++) {
      // 캐터피 cannot take a 대폭발 — except from a full bar, with 옹골참.
      const f = fightAt(k, [me([153], 76, null)], [foe(10, [14], 'sturdy')]);
      const t = turnsOf(f).find((x) => mine(x, 153));
      if (t && t.foeHpAfter === 1) held++;
    }
    expect(held).toBeGreaterThan(20);
  });

  it('lets only super-effective hits through 불가사의부적', () => {
    for (let k = 0; k < 30; k++) {
      for (const t of turnsOf(fightAt(k, [me([33, 53], 6, null)], [foe(292, [14], 'wonder-guard')]))) {
        if (!t.meActed || t.mySkip || t.missed) continue;
        if (t.moveId === 33) expect(t.damage).toBe(0);
      }
    }
  });

  it('speeds up every turn with 가속', () => {
    const f = fightAt(0, [me([14], 257, 'speed-boost')], [foe(143, [14])]);
    const boosts = turnsOf(f).flatMap((t) => t.endEvents).filter((e) => e.k === 'ability' && e.ability === 'speed-boost');
    expect(boosts.length).toBeGreaterThan(0);
  });

  it('turns its type into the move it uses with 변환자재', () => {
    const t = turnsOf(fightAt(0, [me([53], 658, 'protean')], [foe(143, [14])])).find((x) => mine(x, 53))!;
    expect(t.myEvents).toContainEqual({ k: 'type', on: 'user', types: ['fire'] });
  });

  it('takes nothing from a sandstorm with 매직가드', () => {
    for (let k = 0; k < 20; k++) {
      for (const t of turnsOf(fightAt(k, [me([201, 33], 36, 'magic-guard')], [foe(143, [14])]))) {
        expect(t.endEvents.some((e) => e.k === 'weather-chip' && e.on === 'me')).toBe(false);
      }
    }
  });

  it('turns stat drops into rises with 심술꾸러기', () => {
    const f = fightAt(0, [me([33], 143, 'contrary')], [foe(143, [45])]);
    const growl = turnsOf(f).find((t) => t.foeActed && t.foeMoveId === 45 && !t.foeMissed);
    if (growl) expect(growl.foeEvents).toContainEqual({ k: 'stat', on: 'target', stat: 'atk', delta: 1, tried: 1 });
  });

  it('never lets a paralysed 속보 slow down', () => {
    const f = fightAt(0, [mineOf([33], { mySpeciesId: 135, startStatus: 'paralysis', myAbility: 'quick-feet' })], [foe(19, [33])]);
    expect(turnsOf(f).every((t) => !t.foeFirst || t.myStatus !== 'paralysis')).toBe(true);
  });
});
