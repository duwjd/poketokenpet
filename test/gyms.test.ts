import { describe, expect, it } from 'vitest';
import { HUNT_INTERVAL_MS, encounterAt, hunt } from '../server/hunt.ts';
import { advance, initialState, mulberry32, type GameState } from '../server/game.ts';
import { trainerAt } from '../server/trainer.ts';
import { legendOf } from '../server/legenddata.ts';
import { learnableMoves, moveById, speciesInfo } from '../server/moves.ts';
import { trainerBattleAt } from '../server/trainer.ts';
import {
  ALL_GYMS,
  BADGE_IDS,
  BLOCKS,
  GYM_OFFSETS,
  KANTO,
  REGIONS,
  REMATCH_OFFSET,
  atLeague,
  badgesInRegion,
  gymAt,
  gymById,
  gymReward,
  gymTrainer,
  leagueAt,
  leaguesAt,
  regionOfStop,
  regionSwept,
  standingGym,
  stopInRegion,
  stopIndexOf,
} from '../server/gyms.ts';
import { LEG_LENGTH, STOPS, journeyFor } from '../src/journey.ts';

const H = 10_000_000;
/** One full lap of the route, every region. */
const LAP = STOPS.length * LEG_LENGTH;
const none = new Set<number>();
/** Every badge the whole roster allocates. */
const all = new Set(ALL_GYMS.map((g) => g.badge));

/**
 * Regions with a gym table, for the per-region sweeps below.
 *
 * `describe.each` over this is what makes "add a region, its tests come for
 * free" literal — and what makes a region shipped with an empty table fail
 * loudly here instead of passing every table test vacuously.
 */
const CAMPAIGNS = REGIONS.filter((r) => r.gyms.length > 0);

/** The first encounter of the leg that stands at `city`, inside `region`. */
const legAt = (regionKo: string, city: string) => stopInRegion(regionKo, city) * LEG_LENGTH;

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
      // Resolved INSIDE the leader's own region. A bare `STOPS.findIndex` is
      // the bug this assertion exists to catch: seventeen stop names repeat
      // across the route, so the global lookup would hand six regions' league
      // plateaux to 호연 and quietly compare against the wrong stop.
      const home = stopInRegion(g.region, g.city);
      expect(stopIndexOf(seq), `${g.ko} at seq ${seq}`).toBeGreaterThanOrEqual(home);
      expect(journeyFor(seq).region, `${g.ko} at seq ${seq}`).toBe(g.region);
      badges.add(g.badge);
    }
  });

  it('meets every leader in his own city, but for a lateLock', () => {
    // 비주기 is the exception the games make too: 상록체육관 is shut while you
    // walk past it at stop 1 and opens once you hold the other seven, by which
    // time the route is long past it. He catches up instead.
    //
    // The exception is DERIVED from the `lateLock` column rather than listed
    // by id, so a region that needs one says so in the table and a region that
    // does not cannot quietly acquire one.
    const badges = new Set<number>();
    const met: Record<string, string> = {};
    for (let seq = 0; seq < LAP * 2 && Object.keys(met).length < ALL_GYMS.length; seq++) {
      const g = gymAt(seq, badges);
      if (!g || badges.has(g.badge)) continue;
      met[g.id] = journeyFor(seq).ko;
      badges.add(g.badge);
    }
    for (const g of ALL_GYMS) {
      if (g.lateLock) {
        expect(met[g.id], g.ko).toBeDefined();
        continue;
      }
      expect(met[g.id], g.ko).toBe(g.city);
    }
  });

  it('never stands in a region with no gym table', () => {
    // The inverse of what the roster does, and the assertion that keeps a
    // half-written region from standing anybody up. 히스이 is the permanent
    // case — it has no gyms in any game — and every region whose table has not
    // landed yet answers here too.
    const campaigns = new Set<string>(CAMPAIGNS.map((r) => r.ko));
    for (let seq = 0; seq < LAP; seq++) {
      if (campaigns.has(journeyFor(seq).region)) continue;
      expect(gymAt(seq, none), `seq ${seq}`).toBeNull();
      expect(gymAt(seq, all), `seq ${seq}`).toBeNull();
      expect(standingGym(seq, none), `seq ${seq}`).toBeNull();
    }
  });

  it('gives each region its own eligibility ladder', () => {
    // The bug this catches is the one that does not exist while Kanto is the
    // only region: eligibility used to read the GLOBAL badge count, so a save
    // holding one region's full set would satisfy `held < order - 1` for every
    // leader of the NEXT region at once and be handed the whole ladder on
    // arrival. Counting per region is what makes each region start at zero.
    for (const r of CAMPAIGNS) {
      const others = new Set(ALL_GYMS.filter((g) => g.region !== r.ko).map((g) => g.badge));
      expect(badgesInRegion(r, others), r.ko).toBe(0);
      // Holding every OTHER region's badges must not open this one past its
      // first leader.
      const first = r.gyms.find((g) => g.order === 1)!;
      for (let seq = 0; seq < LAP; seq++) {
        const g = standingGym(seq, others);
        if (g?.region === r.ko) expect(g.order, `${r.ko} ${g.ko}`).toBe(first.order);
      }
    }
  });

  it('locks 상록시티 until the other seven are held, exactly as the games do', () => {
    const seven = new Set(KANTO.gyms.filter((g) => g.id !== 'giovanni').map((g) => g.badge));
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
    // The count is the point: they were 3/11/19 on a 25-encounter leg and the
    // third silently stopped happening when the leg shrank to fifteen, leaving
    // a leader you could only challenge twice with nothing on screen to say
    // so. Checked on each region's FIRST leader, who is the one nobody needs a
    // badge to reach.
    for (const r of CAMPAIGNS) {
      const first = r.gyms.find((g) => g.order === 1)!;
      const leg = legAt(r.ko, first.city);
      const offsets: number[] = [];
      for (let i = 0; i < LEG_LENGTH; i++) {
        if (gymAt(leg + i, none)?.id === first.id) offsets.push(i);
      }
      expect(offsets, `${r.ko} ${first.ko}`).toEqual([...GYM_OFFSETS]);
    }
  });

  it('drops a beaten leader to one rematch per visit, at his own city', () => {
    for (const r of CAMPAIGNS) {
      const first = r.gyms.find((g) => g.order === 1)!;
      const leg = legAt(r.ko, first.city);
      const offsets: number[] = [];
      for (let i = 0; i < LEG_LENGTH; i++) {
        if (gymAt(leg + i, all)?.id === first.id) offsets.push(i);
      }
      expect(offsets, `${r.ko} ${first.ko}`).toEqual([REMATCH_OFFSET]);
    }
    // And a sparring leader stands nowhere but at home, anywhere on the route.
    for (let seq = 0; seq < LAP; seq++) {
      const g = gymAt(seq, all);
      if (g) expect(journeyFor(seq).ko, g.ko).toBe(g.city);
    }
  });

  it('follows the trainer past his own city once he is the one standing', () => {
    // 비주기's city is stop 1 and he is met eighth, so without the pursuit
    // clause the Earth Badge would always be one lap behind the other seven.
    const seven = new Set(KANTO.gyms.filter((g) => g.id !== 'giovanni').map((g) => g.badge));
    let caught: number | null = null;
    for (let seq = 0; seq < LAP && caught === null; seq++) {
      if (gymAt(seq, seven)?.id === 'giovanni') caught = seq;
    }
    expect(caught).not.toBeNull();
    // Met inside the same Kanto pass rather than a lap later.
    expect(caught!).toBeLessThan(500);
  });

  it('finishes every region circuit inside a single lap', () => {
    // One greedy walk of the whole route collects every badge the roster
    // allocates. The bound is derived, not pinned: a region's circuit has to
    // close before the pet walks out of that region's own block, which is the
    // constraint `order` is assigned to satisfy. Galar is the reason this is
    // written as a bound rather than a total — its first gym town is stop 543
    // of a 477..555 block, so ordering by the games' gym numbers would leave
    // nobody standing until 543 and then open all eight at once.
    const badges = new Set<number>();
    const doneAt: Record<string, number> = {};
    for (let seq = 0; seq < LAP; seq++) {
      const g = gymAt(seq, badges);
      if (!g || badges.has(g.badge)) continue;
      badges.add(g.badge);
      const r = REGIONS.find((x) => x.ko === g.region)!;
      if (regionSwept(r, badges)) doneAt[r.ko] ??= seq;
    }
    for (const r of CAMPAIGNS) {
      const block = BLOCKS.find((b) => b.ko === r.ko)!;
      expect(doneAt[r.ko], r.ko).toBeDefined();
      expect(doneAt[r.ko], r.ko).toBeLessThanOrEqual((block.last + 1) * LEG_LENGTH);
    }
  });
});

describe('the table', () => {
  it('gives every region a whole, once-numbered ladder', () => {
    for (const r of CAMPAIGNS) {
      // `order` is a permutation of 1..n WITHIN the region. Not `badge`, which
      // keeps the games' numbering and is global.
      expect(
        r.gyms.map((g) => g.order).sort((a, b) => a - b),
        r.ko,
      ).toEqual(r.gyms.map((_, i) => i + 1));
      // Exactly one leader may be shut until the rest of the region is done.
      expect(r.gyms.filter((g) => g.lateLock).length, r.ko).toBeLessThanOrEqual(1);
      for (const g of r.gyms) expect(g.region, g.id).toBe(r.ko);
    }
  });

  it('allocates every badge number once across the whole roster', () => {
    // Global, not per region: the badge number is the save key, so two regions
    // sharing one would make a Johto win hand over a Kanto badge. This is the
    // invariant that rules out keying badges by a per-region 1..8 index —
    // 하나 and 가라르 field ten distinct badges each.
    const badges = ALL_GYMS.map((g) => g.badge);
    expect(new Set(badges).size).toBe(badges.length);
    expect(BADGE_IDS.size).toBe(badges.length);
    for (const b of badges) expect(Number.isInteger(b) && b >= 1, String(b)).toBe(true);
    // Ids too, and for the same reason: `HuntEntry.gym` records an id with no
    // region beside it, so `gymById` has to be able to recover one.
    expect(new Set(ALL_GYMS.map((g) => g.id)).size).toBe(ALL_GYMS.length);
  });

  it('puts every city on the route, inside its own region', () => {
    for (const g of ALL_GYMS) {
      expect(stopInRegion(g.region, g.city), `${g.region} ${g.city}`).toBeGreaterThanOrEqual(0);
    }
    for (const r of REGIONS) {
      expect(BLOCKS.some((b) => b.ko === r.ko), r.ko).toBe(true);
      if (r.leagueCity !== null) {
        expect(stopInRegion(r.leagueIn, r.leagueCity), r.leagueCity).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('fields the original teams, whole and legendary-free', () => {
    for (const g of ALL_GYMS) {
      expect(g.team.length, g.ko).toBeGreaterThanOrEqual(2);
      expect(g.team.length, g.ko).toBeLessThanOrEqual(6);
      for (const id of g.team) {
        expect(speciesInfo(id)?.types.length, `${g.ko} ${id}`).toBeGreaterThan(0);
        expect(legendOf(id), `${g.ko} ${id}`).toBeNull();
      }
    }
  });

  it('awards a TM the battle can actually swing', () => {
    // Why the FireRed list rather than Red/Blue's: 참기 · 사이코웨이브 ·
    // 땅가르기 all carry power 0 and would fall through to FIXED_POWER.
    for (const g of ALL_GYMS) {
      const m = moveById(g.prize);
      expect(m, `${g.ko} prize ${g.prize}`).not.toBeNull();
    }
    for (const r of CAMPAIGNS) {
      // Unique WITHIN a region. Across regions the same machine legitimately
      // repeats — two regions' ice gyms both have an ice TM to give.
      expect(new Set(r.gyms.map((g) => g.prize)).size, r.ko).toBe(r.gyms.length);
      // Enough of the ladder has to be damage for a badge to change the next
      // fight; a region of pure status prizes would not be self-correcting.
      const powers = r.gyms.map((g) => moveById(g.prize)!.power);
      expect(powers.filter((p) => p > 0).length, r.ko).toBeGreaterThanOrEqual(
        Math.ceil(r.gyms.length / 2),
      );
    }
  });

  it('keeps every name inside the message box', () => {
    // rewardPages builds one-row lines on "the longest trainer name is eleven".
    // `회색시티 관장 웅` is eleven exactly, which is why the city is not in it.
    for (const g of ALL_GYMS) expect(gymTrainer(g).name.length, g.ko).toBeLessThanOrEqual(11);
    for (const r of REGIONS) {
      for (const m of r.league) expect(m.ko.length, m.ko).toBeLessThanOrEqual(11);
    }
  });

  it('carries slugs ensureNpcSprite will accept', () => {
    for (const g of ALL_GYMS) expect(g.sprite).toMatch(/^[a-z0-9-]+$/);
    for (const r of REGIONS) for (const m of r.league) expect(m.sprite).toMatch(/^[a-z0-9-]+$/);
    // Unique per region. Across regions a slug may repeat: 독수 is a Kanto gym
    // leader and a Johto Elite Four member, and it is the same person.
    for (const r of CAMPAIGNS) {
      expect(new Set(r.gyms.map((g) => g.sprite)).size, r.ko).toBe(r.gyms.length);
    }
  });

  it('pays more than a route trainer and scales with the fight', () => {
    // A route trainer averages 6.52 encounter-payouts; the best is 12.6.
    for (const g of ALL_GYMS) expect(gymReward(g), g.ko).toBeGreaterThan(6.52);
  });

  it('says whether a missing ladder is absent or merely unwritten', () => {
    /**
     * An empty `league` is allowed, and it means one of two different things
     * that must not be confused. `leagueCity: null` is "this region has no
     * league at all"; a city with an empty ladder is "it has one and the four
     * names have not been verified yet". The panel prints a different sentence
     * for each, so the pair has to stay coherent.
     */
    for (const r of REGIONS) {
      if (r.league.length === 0) {
        expect(typeof r.leagueCity === 'string' || r.leagueCity === null, r.ko).toBe(true);
        continue;
      }
      for (const m of r.league) expect(m.region, m.id).toBe(r.ko);
      expect(new Set(r.league.map((m) => m.id)).size, r.ko).toBe(r.league.length);
      // The LAST row is the champion. Positional, because 가라르 and 알로라 are
      // not four-plus-one and the panel must not assume five.
      expect(r.league.at(-1)!.ko, r.ko).toContain('챔피언');
    }
  });
});

describe('the route it is pinned to', () => {
  it('covers every stop with exactly one contiguous region block', () => {
    expect(BLOCKS.reduce((n, b) => n + (b.last - b.first + 1), 0)).toBe(STOPS.length);
    expect(new Set(BLOCKS.map((b) => b.ko)).size).toBe(BLOCKS.length);
    let next = 0;
    for (const b of BLOCKS) {
      expect(b.first, b.ko).toBe(next);
      next = b.last + 1;
    }
    expect(next).toBe(STOPS.length);
  });

  it('resolves a repeated stop name inside the region that asked', () => {
    // The bug the whole name-inside-a-region discipline exists to prevent.
    // Six regions' league plateaux share two names between them, so a bare
    // `STOPS.findIndex` answers 143 for all six and a Kalos leader ends up
    // standing in Hoenn with nothing thrown and nothing logged.
    const shared: [string, string, number][] = [
      ['호연', '포켓몬리그', 143],
      ['칼로스', '포켓몬리그', 382],
      ['알로라', '포켓몬리그', 450],
      ['신오', '포켓몬 리그', 175],
      ['하나', '포켓몬 리그', 276],
      ['팔데아', '포켓몬 리그', 650],
    ];
    for (const [region, city, at] of shared) {
      expect(stopInRegion(region, city), `${region} ${city}`).toBe(at);
      expect(STOPS[at].region).toBe(region);
    }
    // And a name that region does not carry is -1, not somebody else's stop.
    expect(stopInRegion('관동', '포켓몬리그')).toBe(-1);
  });

  it('keeps every league city out of every region\'s gym cities', () => {
    // `server/hunt.ts` checks the league branch above the gym branch, and that
    // is only sound while a plateau is never a gym town. The module asserts
    // this at load; the test says why out loud.
    const gymCities = new Set(ALL_GYMS.map((g) => g.city));
    for (const r of REGIONS) {
      if (r.leagueCity !== null) expect(gymCities.has(r.leagueCity), r.leagueCity).toBe(false);
    }
  });

  it('opens exactly one league at a stop, whoever is standing there', () => {
    let seen = 0;
    for (let seq = 0; seq < LAP; seq += LEG_LENGTH) {
      const here = leaguesAt(seq);
      if (here.length === 0) {
        expect(atLeague(seq), `seq ${seq}`).toBe(false);
        expect(leagueAt(seq, all, {}), `seq ${seq}`).toBeNull();
        continue;
      }
      seen++;
      expect(atLeague(seq), `seq ${seq}`).toBe(true);
      const open = leagueAt(seq, all, {});
      // A stop whose only ladder is still unwritten stands there and offers
      // nothing — which is the honest answer, not a bug.
      if (!here.some((r) => r.league.length > 0)) {
        expect(open, `seq ${seq}`).toBeNull();
        continue;
      }
      // Swept everything: exactly one ladder is offered, never two.
      expect(open, `seq ${seq}`).not.toBeNull();
      expect(here.some((r) => r.id === open!.id)).toBe(true);
      // Nothing swept: no ladder at all.
      expect(leagueAt(seq, none, {}), `seq ${seq}`).toBeNull();
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('takes no draw when it looks up a region or a league', () => {
    // The same structural guarantee `gymAt` gets, extended to the region
    // machinery: if any of this ever consumed a roll, the wild encounter
    // stream would shift under every existing save.
    for (let k = 0; k < 4000; k++) {
      const before = encounterAt(k, 668, H);
      regionOfStop(stopIndexOf(k));
      leaguesAt(k);
      leagueAt(k, all, {});
      atLeague(k);
      expect(encounterAt(k, 668, H), `seq ${k}`).toEqual(before);
    }
  });
});

describe('관동', () => {
  // The facts below are about the Red/Green/Blue rosters specifically. They are
  // literal ON PURPOSE — the general shape is asserted above, and these are the
  // measured facts that made the general shape the right one.

  it('numbers eight badges and eight challenge slots, each once', () => {
    expect(KANTO.gyms).toHaveLength(8);
    expect(new Set(KANTO.gyms.map((g) => g.badge))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(new Set(KANTO.gyms.map((g) => g.order))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8]));
  });

  it('numbers 초련 and 독수 by badge but meets them by road', () => {
    // The one place badge order and challenge order disagree, and the reason
    // GymRow carries both. 노랑시티 is stop 13, 연분홍시티 is 14.
    const sabrina = gymById('sabrina')!;
    const koga = gymById('koga')!;
    expect([sabrina.badge, sabrina.order]).toEqual([6, 5]);
    expect([koga.badge, koga.order]).toEqual([5, 6]);
    expect(stopInRegion('관동', sabrina.city)).toBeLessThan(stopInRegion('관동', koga.city));
  });

  it('fields the team sizes the originals have, in challenge order', () => {
    expect(KANTO.gyms.map((g) => g.team.length)).toEqual([2, 2, 3, 3, 4, 4, 4, 5]);
  });

  it('hands out six damaging machines and two status ones', () => {
    const powers = KANTO.gyms.map((g) => moveById(g.prize)!.power);
    expect(powers.filter((p) => p > 0).length).toBe(6);
  });

  it('makes 비주기 the biggest purse', () => {
    const rewards = KANTO.gyms.map(gymReward);
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
  /**
   * The encounter each leader is first met at — DERIVED, not written down.
   *
   * These were literals (brock 78, misty 128, …) and every one of them was
   * already wrong: the route is generated, and regenerating it moved 웅's first
   * stand from 78 to 47. The same trap this file warns about further down, and
   * the same fix — walk the cadence and read the answer off it. A grit column
   * measured against a rotted encounter index is measured against a bag the
   * player does not have yet.
   */
  const MET_AT: Record<string, number> = (() => {
    const out: Record<string, number> = {};
    const badges = new Set<number>();
    for (let seq = 0; seq < LAP * 2 && Object.keys(out).length < ALL_GYMS.length; seq++) {
      const g = gymAt(seq, badges);
      if (!g || badges.has(g.badge)) continue;
      out[g.id] = seq;
      badges.add(g.badge);
    }
    return out;
  })();

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

  it('can be lost at every single gym, in every region', () => {
    /**
     * The whole point. A wild encounter cannot be lost; these can, and the
     * easiest of them still turns you away about one time in five.
     *
     * Swept across every region rather than 관동's eight, because the bag is
     * what makes this hard to keep true and the bag is a function of WHEN a
     * region is reached. 관동's leaders are met against two to seventeen
     * machines; 하나's against about a hundred and fifty. A grit column copied
     * from one region to the next puts every fight above 90%, which is how
     * this test earns its keep.
     */
    for (const g of ALL_GYMS) {
      const r = rate(g.id, Math.round(0.04 * MET_AT[g.id]));
      expect(r, `${g.region} ${g.ko} too easy`).toBeLessThan(0.85);
      expect(r, `${g.region} ${g.ko} too hard`).toBeGreaterThan(0.4);
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
    /**
     * These tests are about how a named battle RESOLVES, and that is unchanged
     * by who started it — so they keep exercising the automatic path. The
     * ask-first rule is the default now, and the tests for it live beside
     * these rather than inside them.
     */
    return { ...hatched, lifetimeEarned: 1_000_000_000, huntedAt: T0, askChallenge: false, ...over };
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
    for (const g of KANTO.gyms) {
      if (once.badges!.includes(g.badge)) expect(twice.tms[g.prize]).toBe(once.tms[g.prize]);
    }
  });
});
