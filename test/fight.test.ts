import { describe, expect, it } from 'vitest';
import { battleAt, fightAt, foeOf, mineOf, type BattleTurn, type Fight } from '../server/fight.ts';

/** A named opponent with exactly these moves. */
const foe = (speciesId: number, moves: number[]) => foeOf(speciesId, 'rare', 1, moves);
/** Every turn of a fight, with the round it sits in. */
const turnsOf = (f: Fight) => f.rounds.flatMap((r) => r.turns.map((t) => ({ t, r })));
/** The first seed under `n` whose fight passes `pick`, and that fight. */
const find = (n: number, make: (k: number) => Fight, pick: (f: Fight) => boolean): Fight => {
  for (let k = 0; k < n; k++) {
    const f = make(k);
    if (pick(f)) return f;
  }
  throw new Error('no seed matched');
};
const used = (f: Fight, id: number) => turnsOf(f).some(({ t }) => t.meActed && t.moveId === id && !t.mySkip);
const has = (t: BattleTurn, k: string, mine = true) => (mine ? t.myEvents : t.foeEvents).some((e) => e.k === k);

describe('substitute', () => {
  it('costs a quarter of the bar and takes the hits instead', () => {
    const f = find(
      300,
      (k) => fightAt(k, [mineOf([164, 34], { mySpeciesId: 143 })], [foe(143, [34])]),
      (x) => turnsOf(x).some(({ t }) => has(t, 'substitute') && t.meActed),
    );
    const all = turnsOf(f).map(({ t }) => t);
    const at = all.findIndex((t) => has(t, 'substitute'));
    // Every hit the foe lands while it stands goes into the substitute.
    for (let i = at + 1; i < all.length; i++) {
      const t = all[i];
      if (!t.foeActed || t.foeMissed || t.foeSkip) continue;
      expect(has(t, 'sub-hit', false)).toBe(true);
      if (has(t, 'sub-broke', false)) break;
      expect(t.myHpAfter).toBe(all[i - 1].myHpAfter - t.mySelfHit - t.myResidual);
    }
  });
});

describe('taunt and encore', () => {
  it('keeps a taunted foe off its status moves until the taunt wears off', () => {
    let checked = 0;
    for (let k = 0; k < 200; k++) {
      const f = fightAt(k, [mineOf([269, 34], { mySpeciesId: 143 })], [foe(143, [14, 34])]);
      let taunted = false;
      for (const { t } of turnsOf(f)) {
        if (taunted && t.foeActed && !t.foeSkip) {
          expect(t.foeMoveId).not.toBe(14);
          checked++;
        }
        if (has(t, 'taunt')) taunted = true;
        if (t.endEvents.some((e) => e.k === 'wore-off' && e.what === 'taunt')) taunted = false;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('locks an encored foe into the move it last used', () => {
    let checked = 0;
    for (let k = 0; k < 200; k++) {
      const f = fightAt(k, [mineOf([227, 34], { mySpeciesId: 143 })], [foe(143, [14, 34])]);
      let locked: number | null = null;
      let last: number | null = null;
      for (const { t } of turnsOf(f)) {
        if (locked !== null && t.foeActed && !t.foeSkip) {
          expect(t.foeMoveId).toBe(locked);
          checked++;
        }
        // Locked into the last move it actually used — this turn's, if it had
        // already moved. A turn lost to paralysis is not a move used.
        const usedNow = t.foeActed && !t.foeSkip;
        if (has(t, 'encore')) locked = t.foeFirst && usedNow ? t.foeMoveId : last;
        if (usedNow) last = t.foeMoveId;
        if (t.endEvents.some((e) => e.k === 'wore-off' && e.what === 'encore')) locked = null;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});

describe('PP', () => {
  it('runs out, and then there is only 발버둥', () => {
    // 파괴광선 has five PP; a long fight against a wall spends them.
    const f = find(
      200,
      (k) => fightAt(k, [mineOf([63], { mySpeciesId: 143 })], [foe(213, [34])]),
      (x) => turnsOf(x).some(({ t }) => t.moveId === 165),
    );
    const beams = turnsOf(f).filter(({ t }) => t.meActed && t.moveId === 63 && !t.mySkip).length;
    expect(beams).toBe(5);
    const struggle = turnsOf(f).find(({ t }) => t.moveId === 165)!.t;
    expect(struggle.myEvents.some((e) => e.k === 'recoil')).toBe(true);
  });

  it('loses up to four to 원한', () => {
    const f = find(
      200,
      (k) => fightAt(k, [mineOf([180, 34], { mySpeciesId: 143 })], [foe(143, [34])]),
      (x) => turnsOf(x).some(({ t }) => has(t, 'spite')),
    );
    const e = turnsOf(f).flatMap(({ t }) => t.myEvents).find((x) => x.k === 'spite')!;
    expect(e).toMatchObject({ k: 'spite', moveId: 34 });
    if (e.k === 'spite') expect(e.n).toBeLessThanOrEqual(4);
  });
});

describe('the moves that are each their own rule', () => {
  it('curses at the cost of half its own bar, for a quarter of theirs every turn', () => {
    const f = find(
      100,
      (k) => fightAt(k, [mineOf([174, 247], { mySpeciesId: 94 })], [foe(143, [34])]),
      (x) => turnsOf(x).some(({ t }) => t.myEvents.some((e) => e.k === 'curse' && e.ghost)),
    );
    const chips = turnsOf(f).flatMap(({ t }) => t.endEvents).filter((e) => e.k === 'status-chip' && e.condition === 'curse');
    expect(chips.length).toBeGreaterThan(0);
    for (const e of chips) if (e.k === 'status-chip') expect(e.hp).toBeLessThanOrEqual(Math.floor(220 / 4));
  });

  it('turns a non-Ghost 저주 into slower, stronger, sturdier', () => {
    const f = find(
      100,
      (k) => fightAt(k, [mineOf([174, 34], { mySpeciesId: 143 })], [foe(143, [34])]),
      (x) => used(x, 174),
    );
    const t = turnsOf(f).find(({ t }) => t.moveId === 174 && t.meActed && !t.mySkip)!.t;
    expect(t.myEvents).toEqual([
      { k: 'stat', on: 'user', stat: 'spe', delta: -1, tried: -1 },
      { k: 'stat', on: 'user', stat: 'atk', delta: 1, tried: 1 },
      { k: 'stat', on: 'user', stat: 'def', delta: 1, tried: 1 },
    ]);
  });

  it('shares out the HP evenly with 아픔나누기', () => {
    // A foe that only ever sets up, so nothing else touches the bars.
    const f = find(
      100,
      (k) => fightAt(k, [mineOf([220, 34], { mySpeciesId: 143, startHp: 30 })], [foe(143, [14])]),
      (x) => used(x, 220),
    );
    const t = turnsOf(f).find(({ t }) => has(t, 'pain-split'))!.t;
    expect(t.myHpAfter).toBe(t.foeHpAfter);
  });

  it('never throws a move that cannot work here', () => {
    // 트릭 needs a held item. Nothing here holds one.
    for (let k = 0; k < 50; k++) {
      const f = fightAt(k, [mineOf([271, 34], { mySpeciesId: 143 })], [foe(143, [34])]);
      expect(used(f, 271)).toBe(false);
    }
  });

  it('calls a random move with 손가락흔들기', () => {
    const f = find(
      50,
      (k) => fightAt(k, [mineOf([118], { mySpeciesId: 35 })], [foe(143, [34])]),
      (x) => turnsOf(x).some(({ t }) => t.meActed && !t.mySkip),
    );
    const t = turnsOf(f).find(({ t }) => t.meActed && !t.mySkip)!.t;
    expect(t.moveId).toBe(118);
    expect(t.myEvents[0]).toMatchObject({ k: 'call', by: 'metronome' });
  });

  it('holds on at 1 HP with 버티기', () => {
    let held = 0;
    for (let k = 0; k < 300; k++) {
      const f = fightAt(k, [mineOf([203, 34], { mySpeciesId: 19 })], [foe(149, [89])]);
      for (const { t } of turnsOf(f)) {
        if (t.foeEvents.some((e) => e.k === 'endured')) {
          held++;
          // Left on exactly 1 by the hit; only the end of the turn can take it.
          expect(t.myHpAfter + t.myResidual).toBeGreaterThanOrEqual(1);
        }
      }
    }
    expect(held).toBeGreaterThan(0);
  });

  it('lands 미래예지 two turns after it is foreseen', () => {
    const f = find(
      300,
      (k) => fightAt(k, [mineOf([248, 34], { mySpeciesId: 65 })], [foe(143, [14])]),
      (x) => turnsOf(x).some(({ t }) => has(t, 'future')),
    );
    const all = turnsOf(f).map(({ t }) => t);
    const at = all.findIndex((t) => has(t, 'future'));
    const hit = all.findIndex((t) => t.endEvents.some((e) => e.k === 'future-hit'));
    if (hit >= 0) expect(hit - at).toBe(2);
    else expect(all.length - at).toBeLessThanOrEqual(2);
  });

  it('lets 가로채기 take the other side\'s 칼춤', () => {
    let stolen = 0;
    for (let k = 0; k < 400; k++) {
      const f = fightAt(k, [mineOf([289, 34], { mySpeciesId: 143 })], [foe(143, [14, 34])]);
      for (const { t } of turnsOf(f)) {
        const e = t.foeEvents.find((x) => x.k === 'snatched');
        if (!e) continue;
        stolen++;
        // The foe's half: the raise lands on its target — me.
        expect(t.foeEvents).toContainEqual(expect.objectContaining({ k: 'stat', on: 'target', stat: 'atk', tried: 2 }));
      }
    }
    expect(stolen).toBeGreaterThan(0);
  });
});

describe('switching', () => {
  it('drags a trainer\'s Pokemon out with 울부짖기, and brings in a random other', () => {
    const f = find(
      300,
      (k) => fightAt(k, [mineOf([46, 34], { mySpeciesId: 143 })], [foe(19, [34]), foe(20, [34]), foe(21, [34])]),
      (x) => x.rounds.some((r) => r.exit === 'foe-forced'),
    );
    const i = f.rounds.findIndex((r) => r.exit === 'foe-forced');
    expect(f.rounds[i + 1].foeSlot).not.toBe(f.rounds[i].foeSlot);
    expect(f.rounds[i].turns.at(-1)!.myEvents).toContainEqual({ k: 'forced-out' });
  });

  it('never has the companion flee a wild fight on purpose', () => {
    for (let k = 0; k < 200; k++) {
      const b = battleAt(k, 'rare', [46, 100, 34], 19, { mySpeciesId: 143 });
      expect(b.turns.some((t) => t.meActed && (t.moveId === 46 || t.moveId === 100) && !t.mySkip)).toBe(false);
    }
  });

  it('ends a wild fight when the wild one blows the companion away', () => {
    const b = (() => {
      for (let k = 0; k < 300; k++) {
        const x = battleAt(k, 'rare', [34], 149, { mySpeciesId: 143, foeMoves: [525] });
        if (x.exit === 'fled') return x;
      }
      throw new Error('never fled');
    })();
    expect(b.won).toBe(false);
    expect(b.turns.at(-1)!.foeEvents).toContainEqual({ k: 'fled', who: 'target' });
  });

  it('pivots out with 유턴 when there is someone to send, and not when alone', () => {
    const party = fightAt(1, [mineOf([369], { mySpeciesId: 123 }), mineOf([89], { mySpeciesId: 34 })], [foe(143, [34])]);
    expect(party.rounds.some((r) => r.exit === 'me-retreat')).toBe(true);
    const alone = fightAt(1, [mineOf([369], { mySpeciesId: 123 })], [foe(143, [34])]);
    expect(alone.rounds.every((r) => r.exit !== 'me-retreat')).toBe(true);
  });

  it('hands the next one its stages with 배턴터치', () => {
    const f = find(
      300,
      (k) => fightAt(k, [mineOf([14, 226], { mySpeciesId: 143 }), mineOf([89], { mySpeciesId: 34 })], [foe(143, [14])]),
      (x) => {
        const all = turnsOf(x).map(({ t }) => t);
        const sd = all.findIndex((t) => t.moveId === 14 && t.meActed && !t.mySkip);
        const bp = all.findIndex((t) => has(t, 'retreat'));
        return sd >= 0 && bp > sd;
      },
    );
    const i = f.rounds.findIndex((r) => r.exit === 'me-retreat');
    expect(f.rounds[i + 1].mySlot).toBe(1);
    // 니드킹's first 지진 after the pass hits harder than one with no boost would.
    const first = f.rounds[i + 1].turns.find((t) => t.meActed && t.moveId === 89 && !t.mySkip && !t.crit && t.foeHpAfter > 0);
    const plain = fightAt(7, [mineOf([89], { mySpeciesId: 34 })], [foe(143, [14])]).rounds[0].turns.find(
      (t) => t.meActed && !t.crit && t.foeHpAfter > 0,
    );
    if (first && plain) expect(first.damage).toBeGreaterThan(plain.damage * 1.5);
  });
});

describe('entry hazards', () => {
  const layered = () =>
    find(
      400,
      (k) => fightAt(k, [mineOf([191, 446, 390, 89], { mySpeciesId: 227 })], [foe(19, [34]), foe(20, [34]), foe(143, [34]), foe(24, [34])]),
      (x) => x.rounds.some((r) => r.entry.length > 0),
    );

  it('strike whoever comes in, by the rules for each', () => {
    const f = layered();
    for (const r of f.rounds) {
      for (const e of r.entry) {
        if (e.k === 'hazard-hit' && e.hazard === 'spikes') {
          const frac = [1 / 8, 1 / 6, 1 / 4].map((x) => Math.floor(r.foeMaxHp * x));
          expect(frac).toContain(e.hp);
        }
        if (e.k === 'hazard-hit' && e.hazard === 'stealthRock') expect(e.hp).toBeGreaterThan(0);
      }
    }
  });

  it('let a grounded Poison type soak up 독압정', () => {
    const f = find(
      400,
      (k) => fightAt(k, [mineOf([390, 89], { mySpeciesId: 227 })], [foe(19, [34]), foe(24, [34])]),
      (x) => x.rounds.some((r) => r.entry.some((e) => e.k === 'toxic-spikes-gone')),
    );
    expect(f.rounds.some((r) => r.foeSlot === 1)).toBe(true);
  });

  it('are cleared by 안개제거', () => {
    const f = find(
      400,
      // Two on my side, or laying spikes in front of me would be a wasted turn.
      (k) =>
        fightAt(k, [mineOf([432, 34], { mySpeciesId: 143 }), mineOf([34], { mySpeciesId: 20 })], [foe(227, [191, 34]), foe(20, [34])]),
      (x) => turnsOf(x).some(({ t }) => has(t, 'defog') && (t.field.mine.spikes ?? 0) === 0),
    );
    const t = turnsOf(f).find(({ t }) => has(t, 'defog'))!.t;
    expect(t.field.mine.spikes ?? 0).toBe(0);
  });
});

describe('two-turn moves', () => {
  it('put the user out of reach while it charges', () => {
    let dodged = 0;
    for (let k = 0; k < 100; k++) {
      const f = fightAt(k, [mineOf([19], { mySpeciesId: 18 })], [foe(143, [34])]);
      for (const { t } of turnsOf(f)) {
        // The foe swinging after my charge turn hits nothing.
        if (has(t, 'charge') && !t.foeFirst && t.foeActed && !t.foeSkip) {
          expect(t.foeMissed).toBe(true);
          dodged++;
        }
      }
    }
    expect(dodged).toBeGreaterThan(10);
  });
});

describe('one-hit knockouts', () => {
  it('either miss or take the whole bar', () => {
    let hit = 0;
    for (let k = 0; k < 200; k++) {
      const f = fightAt(k, [mineOf([32], { mySpeciesId: 34 })], [foe(143, [14])]);
      for (const { t } of turnsOf(f)) {
        if (!t.meActed || t.mySkip || t.moveId !== 32) continue;
        if (t.missed) continue;
        expect(t.foeHpAfter).toBe(0);
        expect(t.myEvents).toContainEqual({ k: 'ohko' });
        hit++;
      }
    }
    expect(hit).toBeGreaterThan(20);
  });
});
