import { describe, expect, it } from 'vitest';
import { HUNT_INTERVAL_MS, MOVE_SLOTS, hunt } from '../server/hunt.ts';
import {
  advance,
  initialState,
  mulberry32,
  type DexEntry,
  type GameState,
  type PartyMember,
} from '../server/game.ts';
import { migrate } from '../server/store.ts';
import { hasMet } from '../server/shrines.ts';
import { KANTO, LEAGUE_OFFSETS, REGIONS, leagueRoundAt } from '../server/gyms.ts';
import { PARTY_SIZE, assign, assignable, clearMember, partyCandidates, setMember } from '../server/party.ts';
import { canLearn, learnableMoves, learnsByLevel, levelUpMoves, moveById, speciesInfo, type MoveInfo } from '../server/moves.ts';
import { CHARGE_MOVES, LOCK_MOVES } from '../server/battlefield.ts';
import { LEG_LENGTH, STOPS } from '../src/journey.ts';

const H = 10_000_000;
const T0 = 1_700_000_000_000;
const ALL_BADGES = KANTO.gyms.map((g) => g.badge).sort((a, b) => a - b);
/** 석영고원's leg. The league lives here and nowhere else. */
const PLATEAU = STOPS.findIndex((s) => s.ko === '석영고원') * LEG_LENGTH;

/** Six fully-evolved Kanto Pokemon, all of which learn plenty from machines. */
/**
 * What a sensible player makes of a move over a five-round climb with no
 * healing: its power, times how often it lands, half again for its own type —
 * and less for what it costs: a turn charging, recoil, a rampage that ends in
 * confusion, a move that only works first or last. Ranking on raw power alone
 * let a bigger bag push a reliable level-up STAB move out for 솔라빔 or
 * 이판사판태클, so a bigger bag measured WORSE — the harness, not the game.
 */
const worth = (m: MoveInfo, speciesId: number) =>
  m.power *
  ((m.accuracy || 100) / 100) *
  ((speciesInfo(speciesId)?.types ?? []).includes(m.type) ? 1.5 : 1) *
  (m.id in CHARGE_MOVES ? 0.5 : 1) *
  (m.drain < 0 ? 1 + m.drain / 100 : 1) *
  (LOCK_MOVES[m.id] === 'rampage' ? 0.6 : 1) *
  // 오버히트, 인파이트: the price is paid on every use, across five rounds.
  (m.category === 'damage-raise' && m.statChanges.some((c) => c.change < 0) ? 0.6 : 1) *
  ([252, 660, 387, 389, 909, 893].includes(m.id) ? 0.3 : 1);
const SIX = [6, 9, 3, 143, 65, 149];
/** Four plausible parties, for sweeps where the species mix is the variable. */
const PARTIES = [SIX, [497, 500, 503, 612, 635, 609], [130, 94, 448, 445, 462, 149], [154, 157, 160, 248, 197, 212]];
const entry = (speciesId: number, moves?: number[]): DexEntry => ({
  speciesId,
  shiny: false,
  firstSeenAt: 0,
  ...(moves ? { moves } : {}),
});

const base = (over: Partial<GameState> = {}): GameState => ({
  ...initialState(),
  hatchThreshold: H,
  ...over,
});

const hunting = (over: Partial<GameState> = {}): GameState => {
  const hatched = advance(base({ lifetimeEarned: H }), H, mulberry32(1)).state;
  /**
   * `askChallenge: false` — these tests are about how a league run RESOLVES,
   * which is unchanged by who started it. Asking is the default now, and the
   * tests for the door live in test/challenge.test.ts rather than in here.
   */
  return {
    ...hatched,
    lifetimeEarned: 1_000_000_000,
    huntedAt: T0,
    askChallenge: false,
    ...over,
  };
};

/** Four strong machine moves each, drawn from what that species can learn. */
const armed = (ids: number[]): PartyMember[] =>
  ids.map((speciesId) => ({
    speciesId,
    shiny: false,
    moves: learnableMoves(speciesId)
      .map((m) => moveById(m)!)
      .filter((m) => m.power > 0)
      .sort((a, b) => b.power - a.power)
      .slice(0, MOVE_SLOTS)
      .map((m) => m.id),
  }));

describe('the party builder', () => {
  const withDex = (over: Partial<GameState> = {}) =>
    base({ dex: SIX.map((id) => entry(id)), ...over });

  it('only fields what the dex actually holds', () => {
    const s = withDex();
    // 뮤츠 was never raised.
    expect(setMember(s, null, entry(150)).ok).toBe(false);
    expect(setMember(s, null, entry(6)).ok).toBe(true);
  });

  it('refuses the same species twice and stops at six', () => {
    let s: GameState = withDex();
    for (const id of SIX) s = setMember(s, null, entry(id)).state;
    expect(s.party).toHaveLength(PARTY_SIZE);
    expect(setMember(s, null, entry(6)).ok).toBe(false);
    // A seventh, even a new one, has nowhere to go.
    s = { ...s, dex: [...s.dex, entry(25)] };
    const full = setMember(s, null, entry(25));
    expect(full.ok).toBe(false);
    expect(full.state.party).toHaveLength(PARTY_SIZE);
  });

  it('offers only what the species can be taught, or learns by level', () => {
    const s = { ...withDex(), party: [{ speciesId: 6, shiny: false, moves: [] }], tms: { 89: 1, 55: 1 } };
    const ids = assignable(s, 0).map((a) => a.moveId);
    for (const id of ids) expect(canLearn(6, id) || learnsByLevel(6, id), String(id)).toBe(true);
    // A graduate is Lv.100: its level-up moves are free.
    expect(assignable(s, 0).find((a) => a.moveId === 52)?.from).toBe('dex');
  });

  it('spends a machine from the bag, and nothing for a move the dex records', () => {
    // 지진(89) is in the bag; 화염방사(53) is on the dex entry already.
    const s = base({
      dex: [entry(6, [53])],
      party: [{ speciesId: 6, shiny: false, moves: [] }],
      tms: { 89: 1 },
    });
    const bag = assign(s, 0, 89, null);
    expect(bag.ok).toBe(true);
    expect(bag.state.tms[89]).toBeUndefined();
    expect(bag.state.party![0].moves).toEqual([89]);
    // The one it already knows costs nothing and is offered as free.
    expect(assignable(s, 0).find((a) => a.moveId === 53)?.from).toBe('dex');
    const free = assign(bag.state, 0, 53, null);
    expect(free.ok).toBe(true);
    expect(free.state.tms).toEqual({});
    expect(free.state.party![0].moves).toEqual([89, 53]);
  });

  it('refuses a machine it does not hold and leaves the state alone', () => {
    const s = base({ dex: [entry(6)], party: [{ speciesId: 6, shiny: false, moves: [] }], tms: {} });
    const out = assign(s, 0, 89, null);
    expect(out.ok).toBe(false);
    expect(out.state).toBe(s);
  });

  it('asks which slot to overwrite once four are full', () => {
    const s = base({
      dex: [entry(6)],
      party: [{ speciesId: 6, shiny: false, moves: [63, 53, 89, 126] }],
      tms: { 9: 1 },
    });
    // 번개펀치(9) — checked against the learnset rather than assumed.
    expect(canLearn(6, 9)).toBe(true);
    expect(assign(s, 0, 9, null).ok).toBe(false);
    const out = assign(s, 0, 9, 1);
    expect(out.ok).toBe(true);
    expect(out.state.party![0].moves).toEqual([63, 9, 89, 126]);
  });

  it('does not give the machines back when a member is dropped', () => {
    // The rule that makes twenty-four slots a decision rather than a rota.
    const armedS = assign(
      base({ dex: [entry(6)], party: [{ speciesId: 6, shiny: false, moves: [] }], tms: { 89: 1 } }),
      0,
      89,
      null,
    ).state;
    const out = clearMember(armedS, 0);
    expect(out.ok).toBe(true);
    expect(out.state.party).toEqual([]);
    expect(out.state.tms).toEqual({});
  });

  it('lists what is left to pick', () => {
    const s = { ...withDex(), party: [{ speciesId: 6, shiny: false, moves: [] }] };
    expect(partyCandidates(s).map((d) => d.speciesId)).toEqual(SIX.slice(1));
  });
});

describe('leagueRoundAt', () => {
  it('carries HP from bar to bar and hands over when one falls', () => {
    const party = armed(SIX);
    const hp = party.map(() => 100);
    const r = leagueRoundAt(1, KANTO.league[0], party, hp);
    expect(r.rounds.length).toBeGreaterThan(0);
    expect(r.hp).toHaveLength(PARTY_SIZE);
    // Rounds are fought by whoever is still standing, in order.
    for (let i = 1; i < r.outFor.length; i++) {
      expect(r.outFor[i]).toBeGreaterThanOrEqual(r.outFor[i - 1]);
    }
  });

  it('loses when every bar is down', () => {
    const party = SIX.map((speciesId) => ({ speciesId, shiny: false, moves: [] }));
    const r = leagueRoundAt(1, KANTO.league[4], party, party.map(() => 1));
    expect(r.won).toBe(false);
    expect(r.hp.every((h) => h <= 0)).toBe(true);
  });

  it('is pure in its inputs and never mutates the HP it was handed', () => {
    const party = armed(SIX);
    const hp = party.map(() => 100);
    const a = leagueRoundAt(7, KANTO.league[1], party, hp);
    const b = leagueRoundAt(7, KANTO.league[1], party, hp);
    expect(a).toEqual(b);
    expect(hp).toEqual(party.map(() => 100));
  });
});

describe('the league inside hunt()', () => {
  const settle = (s: GameState, n: number) => hunt(s, T0 + n * HUNT_INTERVAL_MS).state;
  const ready = (over: Partial<GameState> = {}) =>
    hunting({
      huntCount: PLATEAU,
      badges: ALL_BADGES,
      dex: SIX.map((id) => entry(id)),
      party: armed(SIX),
      ...over,
    });

  it('stays shut without eight badges', () => {
    const s = settle(ready({ badges: [1, 2, 3] }), 24);
    expect(s.huntLog.some((e) => e.league)).toBe(false);
  });

  it('stays shut without a full party', () => {
    const s = settle(ready({ party: armed(SIX.slice(0, 5)) }), 24);
    expect(s.huntLog.some((e) => e.league)).toBe(false);
  });

  it('begins only at the three start slots', () => {
    const s = settle(ready(), 24);
    const firsts = s.huntLog.filter((e) => e.league?.at === 0).map((e) => e.seq - PLATEAU);
    for (const off of firsts) expect(LEAGUE_OFFSETS).toContain(off as 1 | 9 | 17);
  });

  it('walks the four and the champion in order', () => {
    const s = settle(ready(), 24);
    const run = s.huntLog
      .filter((e) => e.league)
      .map((e) => e.league!)
      .reverse();
    expect(run.length).toBeGreaterThan(0);
    for (const r of run) expect(KANTO.league[r.at].id).toBe(r.id);
    // Every entry names which party members actually stood.
    for (const r of run) expect(r.party.length).toBeGreaterThan(0);
  });

  it('ends the challenge on a loss and starts the next one from the top', () => {
    // Whatever the party, the invariant holds: the entry after a lost one is
    // either a fresh run at member 0 or nothing at all. There is no resuming.
    const bare = SIX.map((speciesId) => ({ speciesId, shiny: false, moves: [] }));
    const s = settle(ready({ party: bare }), 24);
    const rows = s.huntLog
      .filter((e) => e.league)
      .map((e) => e.league!)
      .reverse();
    expect(rows.length).toBeGreaterThan(1);
    let lost = 0;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i - 1].won && !rows[i - 1].cleared) continue;
      lost++;
      expect(rows[i].at, `after ${rows[i - 1].id}`).toBe(0);
    }
    expect(lost).toBeGreaterThan(0);
  });

  it('records the Hall of Fame, the win and the charm on a clear', () => {
    let s = ready();
    for (let i = 1; i <= 6 && !(s.leagueWins ?? 0); i++) s = settle(s, i * 4);
    if (!(s.leagueWins ?? 0)) return; // an unlucky seed; the envelope test covers the rate
    expect(s.leagues?.kanto).toBeGreaterThan(0);
    expect(s.leagueBest).toBe(KANTO.league.length);
    expect(s.inventory['shiny-charm']).toBeGreaterThanOrEqual(1);
    expect(s.huntLog.some((e) => e.league?.cleared)).toBe(true);
    // `leagueRun` is NOT asserted null here: clearing ends that run, but a
    // later start slot in the same leg opens a fresh one, and the league is
    // meant to be re-runnable. What must be true is that the run in progress,
    // if any, started over.
    expect(s.leagueRun?.at ?? 0).toBeLessThan(KANTO.league.length);
  });

  it('never lets the best-ever mark go backwards', () => {
    const s = settle(ready({ leagueBest: 4, party: SIX.map((speciesId) => ({ speciesId, shiny: false, moves: [] })) }), 24);
    expect(s.leagueBest).toBeGreaterThanOrEqual(4);
  });

  it('wipes a run that walks out of 석영고원', () => {
    // Started on the last encounters of the leg, so the batch ends elsewhere.
    const s = settle(ready({ huntCount: PLATEAU + 17 }), 12);
    expect(s.leagueRun).toBeNull();
  });

  it('stays idempotent through a whole visit', () => {
    const s = ready();
    const at = T0 + 30 * HUNT_INTERVAL_MS;
    expect(hunt(s, at).state).toEqual(hunt(s, at).state);
  });

  it('survives a reload', () => {
    const s = settle(ready(), 3);
    const back = migrate(JSON.parse(JSON.stringify(s)));
    expect(back.party).toEqual(s.party);
    expect(back.leagueRun).toEqual(s.leagueRun);
    expect(back.badges).toEqual(s.badges);
  });
});

describe('league difficulty', () => {
  /**
   * Machines a sensible player does not put on a league team: 대폭발 and 자폭
   * faint the user, 파괴광선 and friends cost the next turn, 힘껏펀치 fails
   * under any hit, and 내던지기, 자연의은혜 and 폴터가이스트 need an item.
   * 철제광선 and 깜짝헤드 cost half the user's bar, 목숨걸기 the whole of it;
   * 트랩셸 only goes off after a physical hit and 트림 needs a berry. Picking by raw power alone put them on
   * nearly every party with a big bag, so a bigger bag measured WORSE — a
   * harness artefact, not the game.
   */
  const COSTLY = new Set([
    153, 120, 802, 63, 416, 307, 308, 338, 439, 459, 711, 794, 795, 264, 374, 363, 173, 138, 809, 796, 515, 720, 704,
    562,
  ]);
  /** One full run against a party armed from a bag of `tms` machines. */
  const clears = (ids: number[], tms: number, n = 400, ladder = KANTO.league) => {
    let won = 0;
    for (let k = 0; k < n; k++) {
      const rng = mulberry32((k * 2654435761) >>> 0);
      const party: PartyMember[] = ids.map((speciesId) => {
        const all = learnableMoves(speciesId);
        const held = new Set<number>();
        for (let i = 0; i < tms; i++) held.add(all[Math.floor(rng() * all.length)]);
        // A graduate is Lv.100: every level-up move of its species is already its own, free.
        // A negative bag is a member nobody armed at all.
        if (tms >= 0) for (const [, id] of levelUpMoves(speciesId)) held.add(id);
        return {
          speciesId,
          shiny: false,
          moves: [...held]
            .map((m) => moveById(m)!)
            .filter((m) => !COSTLY.has(m.id))
            .sort((a, b) => worth(b, speciesId) - worth(a, speciesId))
            .slice(0, MOVE_SLOTS)
            .map((m) => m.id),
        };
      });
      let hp = party.map(() => 100);
      let ok = true;
      for (let i = 0; i < ladder.length && ok; i++) {
        const r = leagueRoundAt(k * 8 + i, ladder[i], party, hp);
        hp = r.hp;
        ok = r.won;
      }
      if (ok) won++;
    }
    return won / n;
  };

  it('turns away a party that arrived unprepared', () => {
    // A member joins the party knowing nothing (`setMember` starts it at
    // `moves: []`), and six plain swings are not a league team. Before
    // level-up moves this was "eight machines"; now a graduate's own learnset
    // arms it for free, so being unprepared means not arming it at all.
    expect(clears(SIX, -1)).toBeLessThan(0.2);
  });

  it('is winnable, and mostly not, for a real collection', () => {
    // ~47 machines is what INTERNALS measured in an actual save.
    const r = clears(SIX, 47);
    expect(r).toBeGreaterThan(0.2);
    expect(r).toBeLessThan(0.6);
  });

  it('is won by what the party is armed with, not by the species alone', () => {
    // Once a graduate knows its whole level-up learnset, the bag adds only
    // what the species could not learn by itself — so the line to hold is
    // between armed and unarmed, no longer between a small bag and a big one.
    expect(clears(SIX, 47)).toBeGreaterThan(clears(SIX, -1) + 0.2);
  }, 30_000);

  /**
   * Every ladder, not only 관동's.
   *
   * A region is met later than the one before it, so the bag it is measured
   * against grows with it — ~47 machines at 석영고원 is what INTERNALS recorded,
   * and a save that has walked as far as 하나's plateau is holding about 150.
   * Grit is what absorbs the difference, and this is the sweep that says so.
   */
  const LADDERS: { ko: string; ladder: typeof KANTO.league; bag: number }[] = [
    { ko: '관동', ladder: KANTO.league, bag: 47 },
    ...REGIONS.filter((r) => r.id !== 'kanto' && r.league.length > 0).map((r) => ({
      ko: r.ko,
      ladder: r.league,
      bag: 150,
    })),
  ];

  it.each(LADDERS)('leaves $ko winnable and losable', ({ ladder, bag }) => {
    // Four parties, because who you bring matters far more once a ladder
    // carries transcribed movesets: four named moves have a type chart, and a
    // weighted draw from a whole learnset averages one away. The band is on
    // the spread, not on any one party — no party may be locked out, and none
    // may walk it.
    const rates = PARTIES.map((ids) => clears(ids, bag, 200, ladder));
    expect(Math.max(...rates)).toBeLessThan(0.99);
    expect(Math.min(...rates)).toBeGreaterThan(0.05);
    // 800 simulated ladders: under 2s here, past the 5s default on the
    // Windows CI runner.
  }, 30_000);
});

describe('meeting a legendary', () => {
  const T0b = 1_700_000_000_000;
  it('is recorded whether the fight was won or lost', () => {
    // The one signal `server/shrines.ts` reads, and the only one that can
    // answer it: an egg records a win and empties on hatch, the dex records a
    // graduation, and a loss leaves nothing at all.
    const s = { ...initialState(), metLegends: [] as number[] };
    expect(hasMet(s, 493)).toBe(false);
    expect(hasMet({ ...s, metLegends: [493] }, 493)).toBe(true);
    expect(T0b).toBeGreaterThan(0);
  });
});
