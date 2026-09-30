import { describe, expect, it } from 'vitest';
import { fightAt, foeOf, mineOf, type BattleEvent, type BattleTurn, type Fight } from '../server/fight.ts';

/**
 * What moves do beyond their damage: multi-hit counts, the secondary effects
 * the data cannot say on its own, and the moves that are their own rule.
 */

const foe = (speciesId: number, moves: number[]) => foeOf(speciesId, 'rare', 1, moves);
const turnsOf = (f: Fight) => f.rounds.flatMap((r) => r.turns);
const mine = (t: BattleTurn, id: number) => t.meActed && !t.mySkip && t.moveId === id;
const ev = <K extends BattleEvent['k']>(t: BattleTurn, k: K, me = true) =>
  (me ? t.myEvents : t.foeEvents).find((e): e is Extract<BattleEvent, { k: K }> => e.k === k);

describe('multi-hit moves', () => {
  it('lands 씨기관총 two to five times, mostly two or three', () => {
    const seen = new Map<number, number>();
    for (let k = 0; k < 300; k++) {
      for (const t of turnsOf(fightAt(k, [mineOf([331], { mySpeciesId: 143 })], [foe(143, [14])]))) {
        // A knockout stops the hits early.
        if (!mine(t, 331) || t.missed || t.foeHpAfter === 0) continue;
        const n = ev(t, 'hits')!.n;
        seen.set(n, (seen.get(n) ?? 0) + 1);
      }
    }
    expect([...seen.keys()].sort()).toEqual([2, 3, 4, 5]);
    expect((seen.get(2)! + seen.get(3)!) / [...seen.values()].reduce((a, b) => a + b)).toBeGreaterThan(0.6);
  });

  it('rolls 트리플악셀 before every hit, each one harder, and stops at a miss', () => {
    const counts = new Set<number>();
    for (let k = 0; k < 300; k++) {
      for (const t of turnsOf(fightAt(k, [mineOf([813], { mySpeciesId: 143 })], [foe(143, [14])]))) {
        if (!mine(t, 813) || t.missed) continue;
        counts.add(ev(t, 'hits')!.n);
      }
    }
    // 90% a hit: a full three most of the time, and sometimes cut short.
    expect(counts).toEqual(new Set([1, 2, 3]));
  });

  it('hits once per healthy teammate with 집단구타', () => {
    for (let k = 0; k < 40; k++) {
      const f = fightAt(
        k,
        [mineOf([251], { mySpeciesId: 143 }), mineOf([34], { mySpeciesId: 25 }), mineOf([34], { mySpeciesId: 25, startHp: 0 })],
        [foe(143, [14])],
      );
      const t = f.rounds[0].turns.find((x) => mine(x, 251) && !x.missed);
      if (!t) continue;
      // The fainted third one does not join in.
      expect(ev(t, 'hits')!.n).toBe(2);
    }
  });

  it('drops the user\'s defence and raises its speed after 스케일샷', () => {
    const t = turnsOf(fightAt(1, [mineOf([799], { mySpeciesId: 143 })], [foe(143, [14])])).find((x) => mine(x, 799) && !x.missed)!;
    const stats = t.myEvents.filter((e) => e.k === 'stat');
    expect(stats).toContainEqual({ k: 'stat', on: 'user', stat: 'def', delta: -1, tried: -1 });
    expect(stats).toContainEqual({ k: 'stat', on: 'user', stat: 'spe', delta: 1, tried: 1 });
  });

  it('counts each critical hit of a multi-hit move', () => {
    let crits = 0;
    for (let k = 0; k < 300; k++) {
      for (const t of turnsOf(fightAt(k, [mineOf([331], { mySpeciesId: 143 })], [foe(143, [14])]))) {
        const h = mine(t, 331) ? ev(t, 'hits') : undefined;
        if (!h) continue;
        expect(!!h.crits).toBe(t.crit);
        crits += h.crits ?? 0;
      }
    }
    expect(crits).toBeGreaterThan(0);
  });
});

describe('secondary effects the data cannot say', () => {
  it('has 트라이어택 burn, paralyse or freeze, and nothing else', () => {
    const got = new Set<string>();
    for (let k = 0; k < 400; k++) {
      for (const t of turnsOf(fightAt(k, [mineOf([161], { mySpeciesId: 143 })], [foe(143, [14])]))) {
        if (mine(t, 161) && t.ailment) got.add(t.ailment);
      }
    }
    expect(got).toEqual(new Set(['burn', 'paralysis', 'freeze']));
  });

  it('burns with 질투의불꽃 only a target that just powered up', () => {
    let burned = 0;
    for (let k = 0; k < 200; k++) {
      for (const t of turnsOf(fightAt(k, [mineOf([807], { mySpeciesId: 143 })], [foe(143, [14, 34])]))) {
        if (!mine(t, 807) || !t.ailment) continue;
        // It moved first and used 칼춤 this very turn.
        expect(t.foeFirst && t.foeMoveId === 14 && !t.foeSkip).toBe(true);
        burned++;
      }
    }
    expect(burned).toBeGreaterThan(0);
  });

  it('confuses a Normal type with 이상한빛 — status moves go past the type chart', () => {
    const t = turnsOf(fightAt(0, [mineOf([109], { mySpeciesId: 94 })], [foe(143, [14])])).find((x) => mine(x, 109))!;
    expect(t.selfEffect).toBeNull();
    expect(t.ailment).toBe('confusion');
  });

  it('still keeps 전기자석파 off a Ground type', () => {
    const t = turnsOf(fightAt(0, [mineOf([86, 34], { mySpeciesId: 25 })], [foe(51, [14])])).find((x) => x.meActed);
    // A player never wastes a turn on it.
    expect(t?.moveId).not.toBe(86);
  });

  it('brings a Flying type down with 떨어뜨리기, and then 지진 reaches it', () => {
    let reached = 0;
    for (let k = 0; k < 400; k++) {
      let down = false;
      for (const t of turnsOf(fightAt(k, [mineOf([479, 89], { mySpeciesId: 76 })], [foe(18, [14])]))) {
        if (mine(t, 89) && !t.missed) {
          expect(t.effect).toBe(down ? 1 : 0);
          if (down) reached++;
        }
        if (mine(t, 479) && ev(t, 'grounded')) down = true;
      }
    }
    expect(reached).toBeGreaterThan(5);
  });

  it('keeps sound moves away for two turns after 지옥찌르기', () => {
    let kept = 0;
    for (let k = 0; k < 200; k++) {
      for (const t of turnsOf(fightAt(k, [mineOf([675], { mySpeciesId: 143 })], [foe(143, [304])]))) {
        if (t.foeSkip === 'throat-chop') kept++;
      }
    }
    expect(kept).toBeGreaterThan(20);
  });

  it('thaws a frozen user of 열탕 as it moves', () => {
    const f = fightAt(3, [mineOf([503], { mySpeciesId: 9, startStatus: 'freeze' })], [foe(143, [14])]);
    const t = turnsOf(f).find((x) => x.meActed)!;
    expect(t.myCured).toBe('freeze');
    expect(t.mySkip).toBeNull();
  });

  it('only drops a poisoned target with 베놈트랩', () => {
    for (let k = 0; k < 50; k++) {
      // No ability: 독수 would poison it on contact and give 베놈트랩 its reason.
      for (const t of turnsOf(fightAt(k, [mineOf([599, 34], { mySpeciesId: 89, myAbility: null })], [foe(143, [14])]))) {
        // Nothing poisons the foe here, so a player never reaches for it.
        expect(t.moveId).not.toBe(599);
      }
    }
  });
});

describe('moves that are their own rule', () => {
  it('sends a physical hit back doubled with 카운터', () => {
    let checked = 0;
    for (let k = 0; k < 200; k++) {
      for (const t of turnsOf(fightAt(k, [mineOf([68], { mySpeciesId: 143 })], [foe(143, [34])]))) {
        if (!mine(t, 68) || t.selfEffect === 'failed' || t.missed) continue;
        expect(t.foeFirst).toBe(true);
        expect(t.damage).toBe(Math.min(t.counter * 2, t.damage + t.foeHpAfter + t.residual));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('does exactly 40 with 용의분노, whatever it hits', () => {
    const t = turnsOf(fightAt(0, [mineOf([82], { mySpeciesId: 147 })], [foe(143, [14])])).find((x) => mine(x, 82) && !x.missed)!;
    expect(t.damage).toBe(40);
    expect(t.effect).toBe(1);
  });

  it('leaves the target on 1 HP with 칼등치기', () => {
    const f = fightAt(0, [mineOf([206], { mySpeciesId: 143 })], [foeOf(10, 'rare', 1, [14])]);
    expect(f.won).toBe(false);
    expect(turnsOf(f).at(-1)!.foeHpAfter).toBe(1);
  });

  it('costs 철제광선 half its user\'s bar, landed or missed', () => {
    const t = turnsOf(fightAt(0, [mineOf([796], { mySpeciesId: 208 })], [foe(143, [14])])).find((x) => mine(x, 796))!;
    const hp = ev(t, 'half-cost')!.hp;
    expect(hp).toBe(Math.ceil(fightAt(0, [mineOf([796], { mySpeciesId: 208 })], [foe(143, [14])]).rounds[0].myMaxHp / 2));
  });

  it('locks 역린 in for two or three turns, then confuses its user', () => {
    let ended = 0;
    for (let k = 0; k < 100; k++) {
      const ts = turnsOf(fightAt(k, [mineOf([200, 34], { mySpeciesId: 149 })], [foe(143, [14])]));
      const start = ts.findIndex((t) => mine(t, 200));
      if (start < 0) continue;
      const end = ts.findIndex((t) => !!ev(t, 'rampage-end'));
      if (end < 0) continue;
      expect(end - start).toBeGreaterThanOrEqual(1);
      expect(end - start).toBeLessThanOrEqual(2);
      for (let i = start; i <= end; i++) if (ts[i].meActed && !ts[i].mySkip) expect(ts[i].moveId).toBe(200);
      ended++;
    }
    expect(ended).toBeGreaterThan(10);
  });

  it('stores up with 참기 and gives back double', () => {
    let released = 0;
    for (let k = 0; k < 100; k++) {
      const ts = turnsOf(fightAt(k, [mineOf([117], { mySpeciesId: 143 })], [foe(143, [34])]));
      const i = ts.findIndex((t) => !!ev(t, 'bide-release') && t.damage > 0);
      if (i < 0) continue;
      // The two turns before took the hits being returned.
      const taken = ts[i - 1].counter + ts[i - 2].counter + (ts[i].foeFirst ? ts[i].counter : 0);
      expect(ts[i].damage).toBe(Math.min(taken * 2, ts[i].damage + ts[i].foeHpAfter + ts[i].residual));
      released++;
    }
    expect(released).toBeGreaterThan(10);
  });

  it('gets angrier with every hit while it keeps at 분노', () => {
    let angry = 0;
    for (let k = 0; k < 50; k++) {
      for (const t of turnsOf(fightAt(k, [mineOf([34], { mySpeciesId: 143 })], [foe(143, [99])]))) {
        if (ev(t, 'rage')) angry++;
      }
    }
    expect(angry).toBeGreaterThan(10);
  });

  it('hits 50 to 150% of the level with 사이코웨이브', () => {
    for (let k = 0; k < 50; k++) {
      for (const t of turnsOf(fightAt(k, [mineOf([149], { mySpeciesId: 65 })], [foe(143, [14])]))) {
        if (!mine(t, 149) || t.missed || t.foeHpAfter === 0) continue;
        expect(t.damage).toBeGreaterThanOrEqual(25);
        expect(t.damage).toBeLessThanOrEqual(75);
      }
    }
  });

  it('carries the target up with 프리폴, which cannot move until it lands', () => {
    let held = 0;
    for (let k = 0; k < 100; k++) {
      for (const t of turnsOf(fightAt(k, [mineOf([507], { mySpeciesId: 6 })], [foe(25, [34])]))) {
        if (t.foeSkip === 'held') held++;
      }
    }
    expect(held).toBeGreaterThan(10);
  });
});
