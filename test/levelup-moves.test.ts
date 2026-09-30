import { describe, expect, it } from 'vitest';
import { fightAt, foeOf, mineOf, type BattleEvent, type BattleTurn, type EndEvent, type Fight } from '../server/fight.ts';
import { advance, growthBudget, initialState, mulberry32, tokensForLevel, type Companion, type GameState } from '../server/game.ts';
import { relearn } from '../server/hunt.ts';
import { levelUpMoves, moveById } from '../server/moves.ts';
import { movesLearnedBetween, startingMoves, unlockedMoves } from '../server/learnset.ts';
import { REGIONS } from '../server/gymdata.ts';

const foe = (speciesId: number, moves: number[]) => foeOf(speciesId, 'rare', 1, moves);
const turnsOf = (f: Fight) => f.rounds.flatMap((r) => r.turns);
const mine = (t: BattleTurn, id: number) => t.meActed && !t.mySkip && t.moveId === id;
const has = (t: BattleTurn, k: BattleEvent['k'], me = true) => (me ? t.myEvents : t.foeEvents).some((e) => e.k === k);
const end = (t: BattleTurn, k: EndEvent['k']) => t.endEvents.filter((e) => e.k === k);

describe('the level-up moves', () => {
  it('has 마구할퀴기 strike two to five times', () => {
    const seen = new Set<number>();
    for (let k = 0; k < 200; k++) {
      for (const t of turnsOf(fightAt(k, [mineOf([154], { mySpeciesId: 52 })], [foe(143, [14])]))) {
        const h = mine(t, 154) && !t.missed && t.foeHpAfter > 0 ? t.myEvents.find((e) => e.k === 'hits') : undefined;
        if (h && h.k === 'hits') seen.add(h.n);
      }
    }
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
  });

  it('lets 속이기 work only on the first turn out', () => {
    for (let k = 0; k < 30; k++) {
      const ts = turnsOf(fightAt(k, [mineOf([252, 33], { mySpeciesId: 52 })], [foe(143, [34])]));
      ts.forEach((t, i) => {
        if (mine(t, 252) && i > 0) expect(t.selfEffect).toBe('failed');
      });
      if (mine(ts[0], 252)) expect(ts[0].selfEffect).toBeNull();
    }
  });

  it('drains a seeded foe every turn with 씨뿌리기, and never a Grass type', () => {
    let drained = 0;
    for (let k = 0; k < 50; k++) {
      for (const t of turnsOf(fightAt(k, [mineOf([73, 33], { mySpeciesId: 1 })], [foe(143, [14])]))) drained += end(t, 'leech-seed').length;
      // 이상해씨 against 이상해씨: nothing to seed.
      for (const t of turnsOf(fightAt(k, [mineOf([73, 33], { mySpeciesId: 1 })], [foe(1, [14])]))) expect(t.moveId).not.toBe(73);
    }
    expect(drained).toBeGreaterThan(20);
  });

  it('puts the target to sleep at the end of the next turn with 하품', () => {
    let slept = 0;
    for (let k = 0; k < 60; k++) {
      const ts = turnsOf(fightAt(k, [mineOf([281, 33], { mySpeciesId: 143 })], [foe(143, [14])]));
      const i = ts.findIndex((t) => mine(t, 281) && has(t, 'drowsy' as BattleEvent['k']) === false && !t.selfEffect);
      if (i < 0 || !ts[i + 1]) continue;
      if (end(ts[i + 1], 'yawn-sleep').length) slept++;
    }
    expect(slept).toBeGreaterThan(5);
  });

  it('counts both sides down with 멸망의노래', () => {
    const f = fightAt(2, [mineOf([195], { mySpeciesId: 94 })], [foe(143, [14])]);
    const counts = turnsOf(f).flatMap((t) => end(t, 'perish'));
    expect(counts.length).toBeGreaterThan(0);
    expect(f.end === 'won' || f.end === 'lost').toBe(true);
  });

  it('halves the bar for a maxed attack with 배북', () => {
    const t = turnsOf(fightAt(0, [mineOf([187, 33], { mySpeciesId: 143 })], [foe(143, [14])])).find((x) => mine(x, 187))!;
    expect(has(t, 'belly-drum')).toBe(true);
  });

  it('makes 기습 fail into a status move', () => {
    for (let k = 0; k < 40; k++) {
      for (const t of turnsOf(fightAt(k, [mineOf([389], { mySpeciesId: 359 })], [foe(143, [14])]))) {
        if (mine(t, 389)) expect(t.selfEffect).toBe('failed');
      }
    }
  });

  it('keeps a disabled move out of the foe\'s hands until it wears off', () => {
    let checked = 0;
    for (let k = 0; k < 100; k++) {
      let barredId: number | null = null;
      for (const t of turnsOf(fightAt(k, [mineOf([50, 33], { mySpeciesId: 94 })], [foe(143, [34, 33])]))) {
        if (barredId !== null && t.foeActed && !t.foeSkip) {
          expect(t.foeMoveId).not.toBe(barredId);
          checked++;
        }
        const d = t.myEvents.find((e) => e.k === 'disable');
        if (d && d.k === 'disable') barredId = d.moveId;
        if (t.endEvents.some((e) => e.k === 'wore-off-2' && e.what === 'disable')) barredId = null;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('turns into the target with 변신', () => {
    let changed = 0;
    for (let k = 0; k < 40; k++) {
      for (const t of turnsOf(fightAt(k, [mineOf([144], { mySpeciesId: 132 })], [foe(143, [33])]))) {
        if (mine(t, 144) && has(t, 'transform')) changed++;
      }
    }
    expect(changed).toBeGreaterThan(5);
  });

  it('holds its stockpile, then spits it out', () => {
    let spat = 0;
    for (let k = 0; k < 40; k++) {
      for (const t of turnsOf(fightAt(k, [mineOf([254, 255], { mySpeciesId: 316 })], [foe(143, [14])]))) {
        if (mine(t, 255) && t.damage > 0) spat++;
      }
    }
    expect(spat).toBeGreaterThan(0);
  });

  it('stings what touches 니들가드', () => {
    let stung = 0;
    for (let k = 0; k < 60; k++) {
      for (const t of turnsOf(fightAt(k, [mineOf([596, 33], { mySpeciesId: 652 })], [foe(143, [34])]))) {
        if (t.foeEvents.some((e) => e.k === 'sting' && e.hp > 0)) stung++;
      }
    }
    expect(stung).toBeGreaterThan(5);
  });

  it('knows what every gym leader in 하나 carries — four moves each', () => {
    const unova = REGIONS.find((r) => r.id === 'unova')!;
    for (const row of unova.league) for (const set of row.teamMoves ?? []) {
      expect(set).toHaveLength(4);
      for (const id of set) expect(moveById(id), String(id)).not.toBeNull();
    }
  });
});

describe('learning by level', () => {
  const H = 1000;
  const companion = (pathIds: number[], over: Partial<Companion> = {}): Companion => ({
    pathIds,
    stageIndex: 0,
    isShiny: false,
    rarity: 'common',
    nature: 'hardy',
    bornAt: 0,
    tokensAtStageStart: 0,
    level: 1,
    moves: startingMoves(pathIds[0]),
    ...over,
  });
  const state = (a: Companion): GameState => ({ ...initialState(), hatchThreshold: H, eggStartedAt: -H, active: a });
  const at = (a: Companion, level: number) => tokensForLevel(level, growthBudget(a.pathIds, a.rarity, H));

  it('hatches knowing the level-1 moves', () => {
    expect(startingMoves(4)).toEqual(levelUpMoves(4).filter(([lv]) => lv === 1).map(([, id]) => id).slice(-4));
  });

  it('learns a move at its level, into a free slot', () => {
    const a = companion([4, 5, 6]);
    const learnedAt = levelUpMoves(4).find(([lv]) => lv > 1)!;
    const r = advance(state(a), at(a, learnedAt[0]), mulberry32(1));
    expect(r.state.active!.moves).toContain(learnedAt[1]);
    expect(r.events).toContainEqual({ kind: 'learned', moveId: learnedAt[1], placed: true });
  });

  it('learns its evolution moves on evolving', () => {
    expect(movesLearnedBetween(6, 35, 36, true)).toEqual(expect.arrayContaining(levelUpMoves(6).filter(([lv]) => lv === 0).map(([, id]) => id)));
  });

  it('keeps what did not fit, for free, in the move reminder', () => {
    const full = companion([4, 5, 6], { moves: [53, 89, 14, 34], level: 40 });
    const s = state(full);
    const life = at(full, 40);
    const old = unlockedMoves(full.pathIds, 0, 40).find((id) => !full.moves.includes(id))!;
    expect(relearn(s, old, null, life).ok).toBe(false);
    const r = relearn(s, old, 2, life);
    expect(r.ok).toBe(true);
    expect(r.state.active!.moves[2]).toBe(old);
    // Nothing it has not reached yet.
    const later = levelUpMoves(4).find(([lv]) => lv > 40)?.[1];
    if (later) expect(relearn(s, later, 0, life).ok).toBe(false);
  });
});
