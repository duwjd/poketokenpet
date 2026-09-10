import { describe, expect, it } from 'vitest';
import { initialState, type GameState } from '../server/game.ts';
import { migrate } from '../server/store.ts';
import { LEGENDS } from '../server/legenddata.ts';
import { SHRINES, hasMet, shrinesOpen, stopFor, stopOpen } from '../server/shrines.ts';
import { LEG_LENGTH, STOPS, journeyFor } from '../src/journey.ts';
import { GYMS } from '../server/gyms.ts';

const at = (ko: string) => STOPS.findIndex((s) => s.ko === ko);
const base = (over: Partial<GameState> = {}): GameState => ({ ...initialState(), ...over });

describe('the shrine table', () => {
  it('names only places that are on the route', () => {
    // Checked at module load too — this is the version that says which one.
    for (const ko of Object.keys(SHRINES)) expect(at(ko), ko).toBeGreaterThanOrEqual(0);
  });

  it('names only legendaries', () => {
    for (const [ko, ids] of Object.entries(SHRINES)) {
      for (const id of ids) expect(LEGENDS.some((l) => l.id === id), `${ko} ${id}`).toBe(true);
    }
  });

  it('never shuts a gym town or the league', () => {
    // A shut gym city would move a leader somewhere he does not live, and the
    // whole campaign resolves cities by name.
    for (const g of GYMS) expect(SHRINES[g.city], g.city).toBeUndefined();
    expect(SHRINES['석영고원']).toBeUndefined();
  });
});

describe('stopOpen', () => {
  it('shuts a room until its Pokemon has been met', () => {
    const shut = base();
    expect(stopOpen(shut, '시작의 방')).toBe(false);
    expect(stopOpen({ ...shut, metLegends: [493] }, '시작의 방')).toBe(true);
  });

  it('opens a shared room on either occupant', () => {
    // 창기둥 is Dialga's and Palkia's both; having met one is reason enough
    // for the place to exist.
    expect(stopOpen(base({ metLegends: [483] }), '창기둥')).toBe(true);
    expect(stopOpen(base({ metLegends: [484] }), '창기둥')).toBe(true);
    expect(stopOpen(base(), '창기둥')).toBe(false);
  });

  it('leaves every ordinary place alone', () => {
    const shut = base();
    for (const s of STOPS) {
      if (SHRINES[s.ko]) continue;
      expect(stopOpen(shut, s.ko), s.ko).toBe(true);
    }
  });

  it('counts what has been opened', () => {
    expect(shrinesOpen(base())).toEqual({ open: 0, total: Object.keys(SHRINES).length });
    // 아르세우스의 방은 셋이다: 시작의 방 · 신오신전 · 신도유적.
    expect(shrinesOpen(base({ metLegends: [493] })).open).toBe(3);
  });
});

describe('stopFor', () => {
  it('shows the place before a shut room rather than the room', () => {
    const i = at('시작의 방');
    const shut = base();
    expect(stopFor(i * LEG_LENGTH, shut).ko).toBe(STOPS[i - 1].ko);
    // ...and the room itself once its Pokemon has been met.
    expect(stopFor(i * LEG_LENGTH, base({ metLegends: [493] })).ko).toBe('시작의 방');
  });

  it('agrees with journeyFor everywhere else', () => {
    // The index still advances exactly as it always did. That is the whole
    // reason a shut room resolves BACKWARD: nothing else in the game moves.
    const shut = base();
    for (let seq = 0; seq < STOPS.length * LEG_LENGTH; seq += 7) {
      const plain = journeyFor(seq);
      if (SHRINES[plain.ko]) continue;
      expect(stopFor(seq, shut).ko, String(seq)).toBe(plain.ko);
    }
  });

  it('never lands on a shut room, whatever the count', () => {
    const shut = base();
    for (let seq = 0; seq < STOPS.length * LEG_LENGTH; seq += 5) {
      expect(SHRINES[stopFor(seq, shut).ko], String(seq)).toBeUndefined();
    }
  });

  it('terminates even where shut rooms sit back to back', () => {
    // The table is 54 rooms now and some of them are neighbours — 신오's three
    // Regi ruins, 팔데아's four shrines. Walking back has to stop inside one
    // lap however long the shut run is, and it has to land somewhere real.
    const shut = base();
    const runs: number[] = [];
    let run = 0;
    for (let i = 0; i < STOPS.length; i++) {
      if (SHRINES[STOPS[i].ko]) run++;
      else { runs.push(run); run = 0; }
    }
    expect(Math.max(...runs), '잠긴 방이 연달아').toBeGreaterThan(1);
    for (let seq = 0; seq < STOPS.length * LEG_LENGTH; seq += 3) {
      const s = stopFor(seq, shut);
      expect(STOPS, String(seq)).toContain(s);
      expect(SHRINES[s.ko], String(seq)).toBeUndefined();
    }
  });

  it('survives nonsense and a shut run at the start of the route', () => {
    const shut = base();
    expect(STOPS).toContain(stopFor(Number.NaN, shut));
    expect(STOPS).toContain(stopFor(-1, shut));
    expect(STOPS).toContain(stopFor(1e9, shut));
  });

  it('opens the rooms of a save that met them before this existed', () => {
    // `migrate` floors metLegends at what the save can already prove: a
    // legendary raised into the dex, an egg won, or the one out right now.
    const old = { ...initialState(), dex: [{ speciesId: 493, shiny: false, firstSeenAt: 0 }] };
    const back = migrate(JSON.parse(JSON.stringify(old)));
    expect(hasMet(back, 493)).toBe(true);
    expect(stopOpen(back, '시작의 방')).toBe(true);
  });
});
