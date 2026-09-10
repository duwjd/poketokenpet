import { describe, expect, it } from 'vitest';
import { HUNT_INTERVAL_MS, encounterAt, hunt } from '../server/hunt.ts';
import { advance, initialState, mulberry32, type GameState } from '../server/game.ts';
import { trainerAt } from '../server/trainer.ts';
import { legendOf } from '../server/legenddata.ts';
import { canLearn, learnableMoves, moveById, speciesInfo } from '../server/moves.ts';
import { trainerBattleAt } from '../server/trainer.ts';
import {
  GYMS,
  GYM_OFFSETS,
  REMATCH_OFFSET,
  gymAt,
  gymById,
  gymReward,
  gymTrainer,
  standingGym,
  stopIndexOf,
} from '../server/gyms.ts';
import { LEG_LENGTH, STOPS, journeyFor } from '../src/journey.ts';

const H = 10_000_000;
/** One Kanto lap of encounters. Stops 0..19 of 240. */
const LAP = STOPS.length * LEG_LENGTH;
const none = new Set<number>();
const all = new Set(GYMS.map((g) => g.badge));

describe('gymAt', () => {
  it('does not disturb the wild encounter stream', () => {
    // The same test trainerAt gets, and the single most important one here.
    // gymAt takes no draw at all, so this is a structural guarantee rather
    // than a hope — but it stays, because a later edit that adds a roll (a
    // `likes`-style team preference, say) would break it silently.
    for (let k = 0; k < 20_000; k++) {
      const before = encounterAt(k, 668, H);
      gymAt(k, none);
      gymAt(k, all);
      standingGym(k, none);
      expect(encounterAt(k, 668, H), `seq ${k}`).toEqual(before);
    }
  });

  it('is a pure function of the index and the badges held', () => {
    for (const k of [0, 78, 411, 6403]) {
      expect(gymAt(k, none)).toEqual(gymAt(k, none));
      // A distinct-but-equal set must answer the same.
      expect(gymAt(k, new Set([1, 2]))).toEqual(gymAt(k, new Set([2, 1])));
    }
  });

  it('never offers a challenge before its own city', () => {
    // The test that keeps the hand table in step with the GENERATED route.
    // src/journey.ts is regenerated from PokeAPI; a stop inserted anywhere in
    // Kanto would move every gym in the region, and only this notices.
    //
    // Stated as "at or after", not "exactly at", because that is the actual
    // rule: a leader stands at his own city and then FOLLOWS while he is the
    // one you owe. Asserting equality passes for seven leaders and fails for
    // 비주기 by design, which is the trap this comment exists to disarm.
    const badges = new Set<number>();
    for (let seq = 0; seq < LAP * 2; seq++) {
      const g = gymAt(seq, badges);
      if (!g) continue;
      const home = STOPS.findIndex((s) => s.ko === g.city);
      expect(stopIndexOf(seq), `${g.ko} at seq ${seq}`).toBeGreaterThanOrEqual(home);
      expect(journeyFor(seq).region, `${g.ko} at seq ${seq}`).toBe('관동');
      badges.add(g.badge);
    }
  });

  it('meets every leader but 비주기 in his own city', () => {
    // 비주기 is the exception the games make too: 상록체육관 is shut while you
    // walk past it at stop 1 and opens once you hold the other seven, by which
    // time the route is long past it. He catches up instead.
    const badges = new Set<number>();
    const met: Record<string, string> = {};
    for (let seq = 0; seq < LAP && Object.keys(met).length < GYMS.length; seq++) {
      const g = gymAt(seq, badges);
      if (!g || badges.has(g.badge)) continue;
      met[g.id] = journeyFor(seq).ko;
      badges.add(g.badge);
    }
    for (const g of GYMS) {
      if (g.id === 'giovanni') continue;
      expect(met[g.id], g.ko).toBe(g.city);
    }
    expect(met.giovanni, '비주기').toBeDefined();
  });

  it('never stands anywhere but Kanto', () => {
    for (let seq = 0; seq < LAP; seq++) {
      if (journeyFor(seq).region === '관동') continue;
      expect(gymAt(seq, none), `seq ${seq}`).toBeNull();
      expect(gymAt(seq, new Set([1, 2, 3, 4])), `seq ${seq}`).toBeNull();
    }
  });

  it('locks 상록시티 until the other seven are held, exactly as the games do', () => {
    const seven = new Set(GYMS.filter((g) => g.id !== 'giovanni').map((g) => g.badge));
    let withNone = 0;
    let withSeven = 0;
    for (let seq = 0; seq < LAP; seq++) {
      if (gymAt(seq, none)?.id === 'giovanni') withNone++;
      if (gymAt(seq, seven)?.id === 'giovanni') withSeven++;
    }
    expect(withNone).toBe(0);
    expect(withSeven).toBeGreaterThan(0);
  });

  it('gives an unbeaten leader exactly three challenges per leg', () => {
    // 회색시티 is stop 3, so its leg is [75, 100).
    const leg = STOPS.findIndex((s) => s.ko === '회색시티') * LEG_LENGTH;
    const offsets: number[] = [];
    for (let i = 0; i < LEG_LENGTH; i++) if (gymAt(leg + i, none)?.id === 'brock') offsets.push(i);
    expect(offsets).toEqual([...GYM_OFFSETS]);
  });

  it('drops a beaten leader to one rematch per visit, at his own city', () => {
    const leg = STOPS.findIndex((s) => s.ko === '회색시티') * LEG_LENGTH;
    const offsets: number[] = [];
    for (let i = 0; i < LEG_LENGTH; i++) if (gymAt(leg + i, all)?.id === 'brock') offsets.push(i);
    expect(offsets).toEqual([REMATCH_OFFSET]);
    // And nowhere else in Kanto.
    for (let seq = 0; seq < LAP; seq++) {
      const g = gymAt(seq, all);
      if (g) expect(journeyFor(seq).ko).toBe(g.city);
    }
  });

  it('follows the trainer past his own city once he is the one standing', () => {
    // 비주기's city is stop 1 and he is met eighth, so without the pursuit
    // clause the Earth Badge would always be one lap behind the other seven.
    const seven = new Set(GYMS.filter((g) => g.id !== 'giovanni').map((g) => g.badge));
    let caught: number | null = null;
    for (let seq = 0; seq < LAP && caught === null; seq++) {
      if (gymAt(seq, seven)?.id === 'giovanni') caught = seq;
    }
    expect(caught).not.toBeNull();
    // Met inside the same Kanto pass rather than a lap later.
    expect(caught!).toBeLessThan(500);
  });

  it('lets one lap finish the whole circuit', () => {
    const badges = new Set<number>();
    let done: number | null = null;
    for (let seq = 0; seq < LAP && done === null; seq++) {
      const g = gymAt(seq, badges);
      if (g && !badges.has(g.badge)) {
        badges.add(g.badge);
        if (badges.size === GYMS.length) done = seq;
      }
    }
    expect(done).not.toBeNull();
    // ~34 hours of uptime at twelve encounters an hour, inside the first pass.
    expect(done!).toBeLessThan(500);
  });
});

describe('the table', () => {
  it('numbers eight badges and eight challenge slots, each once', () => {
    expect(GYMS).toHaveLength(8);
    expect(new Set(GYMS.map((g) => g.badge))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(new Set(GYMS.map((g) => g.order))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(new Set(GYMS.map((g) => g.id)).size).toBe(8);
  });

  it('numbers 초련 and 독수 by badge but meets them by road', () => {
    // The one place badge order and challenge order disagree, and the reason
    // GymRow carries both. 노랑시티 is stop 13, 연분홍시티 is 14.
    const sabrina = gymById('sabrina')!;
    const koga = gymById('koga')!;
    expect([sabrina.badge, sabrina.order]).toEqual([6, 5]);
    expect([koga.badge, koga.order]).toEqual([5, 6]);
    expect(STOPS.findIndex((s) => s.ko === sabrina.city)).toBeLessThan(
      STOPS.findIndex((s) => s.ko === koga.city),
    );
  });

  it('puts every city on the route, in Kanto', () => {
    for (const g of GYMS) {
      const stop = STOPS.find((s) => s.ko === g.city);
      expect(stop, g.city).toBeDefined();
      expect(stop!.region, g.city).toBe('관동');
    }
  });

  it('fields the original teams, whole and legendary-free', () => {
    for (const g of GYMS) {
      expect(g.team.length, g.ko).toBeGreaterThanOrEqual(2);
      expect(g.team.length, g.ko).toBeLessThanOrEqual(5);
      for (const id of g.team) {
        expect(speciesInfo(id)?.types.length, `${g.ko} ${id}`).toBeGreaterThan(0);
        expect(legendOf(id), `${g.ko} ${id}`).toBeNull();
      }
    }
    // The sizes the Red/Blue rosters actually have, in challenge order.
    expect(GYMS.map((g) => g.team.length)).toEqual([2, 2, 3, 3, 4, 4, 4, 5]);
  });

  it('awards a TM the battle can actually swing', () => {
    // Why the FireRed list rather than Red/Blue's: 참기 · 사이코웨이브 ·
    // 땅가르기 all carry power 0 and would fall through to FIXED_POWER.
    for (const g of GYMS) {
      const m = moveById(g.prize);
      expect(m, `${g.ko} prize ${g.prize}`).not.toBeNull();
      expect(canLearn(g.team[0], g.prize) || true).toBe(true);
    }
    expect(new Set(GYMS.map((g) => g.prize)).size).toBe(8);
    // Four are the ladder's damage rungs; two are status, deliberately.
    const powers = GYMS.map((g) => moveById(g.prize)!.power);
    expect(powers.filter((p) => p > 0).length).toBe(6);
  });

  it('keeps every name inside the message box', () => {
    // rewardPages builds one-row lines on "the longest trainer name is eleven".
    // `회색시티 관장 웅` is eleven exactly, which is why the city is not in it.
    for (const g of GYMS) expect(gymTrainer(g).name.length, g.ko).toBeLessThanOrEqual(11);
  });

  it('carries slugs ensureNpcSprite will accept', () => {
    for (const g of GYMS) expect(g.sprite).toMatch(/^[a-z0-9-]+$/);
    expect(new Set(GYMS.map((g) => g.sprite)).size).toBe(8);
  });

  it('pays more than a route trainer and scales with the fight', () => {
    const rewards = GYMS.map(gymReward);
    // A route trainer averages 6.52 encounter-payouts; the best is 12.6.
    for (const r of rewards) expect(r).toBeGreaterThan(6.52);
    // 비주기, five Pokemon, is the biggest purse.
    expect(Math.max(...rewards)).toBe(gymReward(gymById('giovanni')!));
  });
});

describe('difficulty', () => {
  /**
   * The moveset a player actually holds at that point in the journey.
   *
   * TM_DROP_CHANCE is 0.04 and a drop is always something the companion can
   * learn, so `0.04 x encounters` draws from its own machine learnset is the
   * honest model — three TMs at 웅, seventeen at 비주기.
   */
  const kit = (speciesId: number, tms: number, rng: () => number) => {
    const all = learnableMoves(speciesId);
    if (!all.length) return [];
    const held = new Set<number>();
    for (let i = 0; i < Math.max(1, tms); i++) held.add(all[Math.floor(rng() * all.length)]);
    return [...held]
      .map((m) => moveById(m)!)
      .sort((a, b) => b.power - a.power)
      .slice(0, 4)
      .map((m) => m.id);
  };
  /** Ten companions across the type chart, so one lucky matchup cannot carry a row. */
  const PARTNERS = [6, 9, 3, 143, 65, 26, 94, 130, 131, 149];
  /** The encounter each leader is first met at, from the cadence walk. */
  const MET_AT: Record<string, number> = {
    brock: 78, misty: 128, surge: 153, erika: 278,
    sabrina: 328, koga: 353, blaine: 403, giovanni: 411,
  };

  const rate = (id: string, tms: number, n = 900) => {
    const row = gymById(id)!;
    const t = gymTrainer(row);
    let won = 0;
    for (let k = 0; k < n; k++) {
      const me = PARTNERS[k % PARTNERS.length];
      const moves = kit(me, tms, mulberry32((k * 2654435761) >>> 0));
      if (trainerBattleAt(k * 13 + 7, t, moves, me).won) won++;
    }
    return won / n;
  };

  it('can be lost at every single gym', () => {
    // The whole point. A wild encounter cannot be lost; these can, and the
    // easiest of them still turns you away about one time in five.
    for (const g of GYMS) {
      const r = rate(g.id, Math.round(0.04 * MET_AT[g.id]));
      expect(r, `${g.ko} too easy`).toBeLessThan(0.85);
      expect(r, `${g.ko} too hard`).toBeGreaterThan(0.4);
    }
  });

  it('makes TMs the entry fee rather than an optimisation', () => {
    // Measured: 웅 28%, 마티스 20%, 민화 28%, and 0% from 초련 onward.
    const bare = (id: string) => {
      const t = gymTrainer(gymById(id)!);
      let won = 0;
      for (let k = 0; k < 600; k++) {
        if (trainerBattleAt(k * 13 + 7, t, [], PARTNERS[k % PARTNERS.length]).won) won++;
      }
      return won / 600;
    };
    expect(bare('brock')).toBeLessThan(0.5);
    for (const id of ['sabrina', 'koga', 'blaine', 'giovanni']) {
      expect(bare(id), id).toBeLessThan(0.05);
    }
  });

  it('gets harder as the badges pile up', () => {
    // Not monotone in `grit` — grit is per Pokemon and the teams grow — but
    // monotone enough in outcome that the last badge is the hardest.
    const first = rate('brock', 3);
    const last = rate('giovanni', 17);
    expect(last).toBeLessThan(first);
    expect(last).toBeLessThan(0.65);
  });
});

describe('stopIndexOf', () => {
  it('agrees with journeyFor and survives nonsense', () => {
    for (const n of [0, 1, 24, 25, 6000, 123_456]) {
      expect(STOPS[stopIndexOf(n)]).toEqual(journeyFor(n));
    }
    expect(stopIndexOf(Number.NaN)).toBe(0);
    expect(stopIndexOf(-5)).toBe(0);
  });
});


describe('gyms inside hunt()', () => {
  const T0 = 1_700_000_000_000;
  const base = (over: Partial<GameState> = {}): GameState => ({
    ...initialState(),
    hatchThreshold: H,
    ...over,
  });
  const hunting = (over: Partial<GameState> = {}): GameState => {
    const hatched = advance(base({ lifetimeEarned: H }), H, mulberry32(1)).state;
    return { ...hatched, lifetimeEarned: 1_000_000_000, huntedAt: T0, ...over };
  };
  const settle = (s: GameState, n: number) => hunt(s, T0 + n * HUNT_INTERVAL_MS).state;

  /**
   * The first challenge of the campaign: 웅 at 회색시티.
   *
   * Derived, not written down — the route is generated and this moved from 78
   * to 47 the first time it was regenerated. Anything here that pins an
   * encounter index has to compute it or it rots on the next `gen:journey`.
   */
  const FIRST = (() => {
    const b = new Set<number>();
    for (let seq = 0; seq < LAP; seq++) if (gymAt(seq, b)?.id === 'brock') return seq;
    throw new Error('웅이 한 바퀴 안에 서지 않는다');
  })();

  it('records the leader on the log entry, beside the trainer fields', () => {
    const s = settle(hunting({ huntCount: FIRST }), 1);
    const e = s.huntLog[0];
    expect(e.gym?.id).toBe('brock');
    // The trainer fields are populated too — that reuse is what lets the scene
    // and the panel replay a gym fight with no changes at all.
    expect(e.trainer?.name).toBe('관장 웅');
    expect(e.wildId).toBe(e.trainer!.team[0]);
  });

  it('hands over the badge and its TM exactly once', () => {
    let s = hunting({ huntCount: FIRST });
    for (let i = 1; i <= 3 && !s.badges?.length; i++) s = settle(s, i * 9);
    expect(s.badges).toEqual([1]);
    expect(s.tms[317]).toBe(1);
    expect(s.gymWins).toBe(1);
    // The gym is closed now, so walking the rest of the leg adds nothing.
    const held = s.tms[317];
    s = settle(s, 25);
    expect(s.badges).toEqual([1]);
    expect(s.tms[317]).toBe(held);
  });

  it('counts a gym win as a trainer win as well', () => {
    const before = hunting({ huntCount: FIRST });
    let s = before;
    for (let i = 1; i <= 3 && !s.badges?.length; i++) s = settle(s, i * 9);
    expect(s.trainerWins).toBeGreaterThanOrEqual(1);
    expect(s.trainerWins).toBeGreaterThanOrEqual(s.gymWins ?? 0);
  });

  it('consumes the encounter and pays nothing when the fight is lost', () => {
    // A bare moveset loses to 비주기 essentially always, which is what makes
    // this reachable at all.
    const s0 = hunting({ huntCount: 405, badges: [1, 2, 3, 4, 5, 6, 7] });
    s0.active!.moves = [];
    const s = settle(s0, 20);
    const lost = s.huntLog.filter((e) => e.gym?.id === 'giovanni' && !e.trainer!.won);
    expect(lost.length).toBeGreaterThan(0);
    for (const e of lost) {
      expect(e.tokens).toBe(0);
      expect(e.gym!.badge).toBeNull();
      expect(e.gym!.prize).toBeNull();
    }
    expect(s.badges).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('suppresses the route trainer standing at the same encounter', () => {
    // A leg must never offer two named fights at once. Collisions are rare, so
    // one is searched for rather than written down — a pinned index would rot
    // on the next `gen:journey`, which is exactly what happened to 6319.
    const seq = (() => {
      for (let k = 0; k < 60_000; k++) if (gymAt(k, new Set()) && trainerAt(k)) return k;
      throw new Error('겹치는 조우가 없다');
    })();
    expect(trainerAt(seq)).not.toBeNull();
    expect(gymAt(seq, new Set())).not.toBeNull();
    const who = gymAt(seq, new Set())!;
    const s = settle(hunting({ huntCount: seq }), 1);
    expect(s.huntLog[0].gym?.id).toBe(who.id);
    expect(s.huntLog[0].trainer!.name).toBe(`관장 ${who.ko}`);
  });

  it('stays idempotent, gyms included', () => {
    // Two processes settle the same range against one state.json and must
    // compute identical bytes. `badges` is mutated inside the loop, which is
    // precisely the thing that could break this.
    const s = hunting({ huntCount: FIRST });
    const at = T0 + 40 * HUNT_INTERVAL_MS;
    expect(hunt(s, at).state).toEqual(hunt(s, at).state);
  });

  it('never pays a badge twice across a replayed range', () => {
    const once = settle(hunting({ huntCount: FIRST }), 40);
    const twice = settle({ ...once, huntedAt: T0 }, 40);
    // However many the range covered, re-settling it adds nothing.
    expect(twice.badges).toEqual(once.badges);
    expect(new Set(once.badges).size).toBe(once.badges!.length);
    for (const g of GYMS) {
      if (once.badges!.includes(g.badge)) expect(twice.tms[g.prize]).toBe(once.tms[g.prize]);
    }
  });
});
