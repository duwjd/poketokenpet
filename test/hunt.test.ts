import { describe, expect, it } from 'vitest';
import {
  advance,
  companionAbility,
  friendshipOf,
  initialState,
  lifetimeOf,
  mulberry32,
  rarityOf,
  speciesIdOf,
  type GameState,
} from '../server/game.ts';
import { LINES } from '../server/species.ts';
import { formById } from '../server/forms.ts';
import { MOVES, canLearn, learnableMoves, levelUpMoves, moveById, speciesInfo } from '../server/moves.ts';
import type { Condition } from '../server/hunt.ts';
import {
  HUNT_INTERVAL_MS,
  MAX_TURNS,
  HUNT_OFFLINE_CAP,
  MOVE_SLOTS,
  battleAt,
  battleStats,
  encounterAt,
  forget,
  formOpts,
  hunt,
  huntCap,
  moveMult,
  setHuntUncapped,
  teach,
  teachableNow,
} from '../server/hunt.ts';

const H = 10_000_000;
/** A fixed wall clock. The module never reads one itself. */
const T0 = 1_700_000_000_000;

const base = (over: Partial<GameState> = {}): GameState => ({
  ...initialState(),
  hatchThreshold: H,
  ...over,
});

/** A state with a hatched companion, anchored and ready to hunt. */
const hunting = (over: Partial<GameState> = {}): GameState => {
  const hatched = advance(base({ lifetimeEarned: H }), H, mulberry32(1)).state;
  return { ...hatched, lifetimeEarned: 1_000_000_000, huntedAt: T0, ...over };
};

const tick = (s: GameState, n: number) => hunt(s, T0 + n * HUNT_INTERVAL_MS).state;

describe('moveMult', () => {
  it('is 1.0 with nothing taught and never exceeds the clamp', () => {
    expect(moveMult([])).toBe(1);
    // Hyper Beam, 150 power. Four of them is the strongest moveset possible.
    expect(moveById(63)!.power).toBe(150);
    expect(moveMult(Array.from({ length: MOVE_SLOTS }, () => 63))).toBe(2);
  });

  it('counts status moves as pressure rather than zero', () => {
    // Agility has no power and no longer deals any damage, but it still spends
    // the opponent's turn — a moveset of pure status moves should still help.
    expect(moveMult([97])).toBeGreaterThan(1);
  });

  it('ignores move ids that are not machine moves', () => {
    expect(moveMult([999_999])).toBe(1);
  });
});

describe('encounterAt', () => {
  it('is a pure function of the encounter index', () => {
    for (const k of [0, 1, 41, 5000]) {
      expect(encounterAt(k, 668, H)).toEqual(encounterAt(k, 668, H));
    }
  });

  it('meets unevolved forms more often than final ones', () => {
    let unevolved = 0;
    for (let k = 0; k < 3000; k++) {
      const { wildId } = encounterAt(k, 668, H);
      if (LINES.some((l) => l.paths.some((p) => p[0] === wildId))) unevolved++;
    }
    expect(unevolved / 3000).toBeGreaterThan(0.6);
  });

  it('pays out 1.0x hatchThreshold/240 per encounter on average', () => {
    // The headline is "5% of a hatch threshold per hour with no moves taught",
    // and 12 encounters an hour makes that H/240 each. If the rarity weights
    // are not normalised this silently drifts high.
    let total = 0;
    const N = 20_000;
    for (let k = 0; k < N; k++) total += encounterAt(k, 668, H).reward;
    expect(total / N / (H / 240)).toBeGreaterThan(0.94);
    expect(total / N / (H / 240)).toBeLessThan(1.06);
  });

  it('rolls wild rarity from the same table hatching uses', () => {
    const seen: Record<string, number> = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
    const N = 20_000;
    for (let k = 0; k < N; k++) seen[encounterAt(k, 668, H).rarity]++;
    expect(seen.common / N).toBeGreaterThan(0.55);
    expect(seen.common / N).toBeLessThan(0.65);
    expect(seen.legendary / N).toBeGreaterThan(0.02);
    expect(seen.legendary / N).toBeLessThan(0.04);
  });

  it('only ever drops a TM the companion can actually learn', () => {
    for (let k = 0; k < 4000; k++) {
      const { moveId } = encounterAt(k, 668, H);
      if (moveId !== null) expect(canLearn(668, moveId)).toBe(true);
    }
  });

  it('never drops a TM for a species that learns none', () => {
    for (let k = 0; k < 2000; k++) {
      expect(encounterAt(k, 132, H).moveId).toBeNull(); // Ditto
    }
  });

  it('is not correlated with the species advance() would hatch', () => {
    // Both used to be seeded off numbers that move together, which showed up
    // as "the wild Pokemon I just fought is the one that hatched".
    let collisions = 0;
    const N = 2000;
    for (let k = 0; k < N; k++) {
      const wild = encounterAt(k, 668, H).wildId;
      const hatchedState = advance(base(), H + k * 1000, mulberry32(Math.floor(H + k * 1000) ^ 0x9e3779b9)).state;
      if (hatchedState.active?.pathIds[0] === wild) collisions++;
    }
    // Chance alone is roughly 1/LINES.length; allow generous slack.
    expect(collisions / N).toBeLessThan(8 / LINES.length);
  });
});

describe('hunt', () => {
  it('anchors on first sight and awards nothing', () => {
    const s = hunting({ huntedAt: null });
    const r = hunt(s, T0);
    expect(r.changed).toBe(true);
    expect(r.state.huntedAt).toBe(T0);
    expect(r.state.huntTokens).toBe(0);
    expect(r.state.huntCount).toBe(0);
  });

  it('does nothing, and allocates nothing, before the first interval is up', () => {
    const s = hunting();
    const r = hunt(s, T0 + HUNT_INTERVAL_MS - 1);
    expect(r.changed).toBe(false);
    // Same reference: buildState only writes state.json when something changed,
    // so a fresh object here would rewrite the file every 20 seconds forever.
    expect(r.state).toBe(s);
  });

  it('settles one encounter per interval', () => {
    const s = hunting();
    expect(tick(s, 1).huntCount).toBe(1);
    expect(tick(s, 7).huntCount).toBe(7);
    expect(tick(s, 7).huntLog).toHaveLength(7);
  });

  it('pays nothing and drops nothing for a wild fight it lost', () => {
    // A wild encounter is a real fight now. The fixture's companion is a
    // fresh 알통몬 with one move, which loses most of them — so a long enough
    // run has plenty of both outcomes to check.
    const s = tick(hunting(), 200);
    const wild = s.huntLog.filter((e) => !e.trainer && !e.legend);
    const lost = wild.filter((e) => e.won === false);
    const won = wild.filter((e) => e.won === true);
    expect(lost.length).toBeGreaterThan(0);
    expect(won.length).toBeGreaterThan(0);
    for (const e of lost) {
      expect(e.tokens).toBe(0);
      expect(e.moveId).toBeNull();
      expect(e.stoneId).toBeUndefined();
      expect(e.legendItem).toBeUndefined();
    }
    for (const e of won) expect(e.tokens).toBeGreaterThan(0);
  });

  it('settles the same fight the panel replays', () => {
    // The panel re-runs battleAt with the same arguments; the outcome the log
    // records has to be the one it will draw.
    const s = tick(hunting(), 40);
    const me = s.active!;
    for (const e of s.huntLog) {
      // Who fought is on the record, so an evolution in the same pass cannot
      // swap the fighter out from under the replay.
      // Friendship too: it grows with the level, and 은혜갚기 reads it.
      if (!e.league) {
        expect(e.mine, `seq ${e.seq}`).toEqual({
          speciesId: speciesIdOf(me),
          moves: me.moves,
          friendship: friendshipOf(me),
          ability: companionAbility(me),
        });
      }
      if (e.trainer || e.legend) continue;
      const b = battleAt(e.seq, encounterAt(e.seq, speciesIdOf(me), H).rarity, me.moves, e.wildId, {
        mySpeciesId: speciesIdOf(me),
        myFriendship: e.mine!.friendship,
        myAbility: e.mine!.ability,
      });
      expect(b.won, `seq ${e.seq}`).toBe(e.won);
    }
  });

  it('is idempotent — the whole design rests on this', () => {
    // buildState can run in two processes at once (npm run electron:dev starts
    // Vite AND Electron against one state.json). Both must produce the same
    // bytes, or last-write-wins silently double-counts or loses progress.
    const s = hunting();
    const a = hunt(s, T0 + 9 * HUNT_INTERVAL_MS).state;
    const b = hunt(s, T0 + 9 * HUNT_INTERVAL_MS).state;
    expect(a).toEqual(b);
  });

  it('re-derives a lost write instead of double-counting it', () => {
    // Simulate the race directly: two writers settle from the same snapshot,
    // one write is clobbered, and the next tick must land in the same place
    // whichever one survived.
    const s = hunting();
    const at = T0 + 4 * HUNT_INTERVAL_MS;
    const winner = hunt(s, at).state;
    const loser = hunt(s, at).state;
    const next = T0 + 9 * HUNT_INTERVAL_MS;
    expect(hunt(winner, next).state.huntTokens).toBe(hunt(loser, next).state.huntTokens);
    expect(hunt(winner, next).state.huntCount).toBe(hunt(loser, next).state.huntCount);
    expect(hunt(winner, next).state.tms).toEqual(hunt(loser, next).state.tms);
  });

  it('never walks backwards across a long run of ticks', () => {
    let s = hunting();
    let tokens = 0;
    let count = 0;
    for (let i = 1; i <= 5000; i++) {
      s = hunt(s, T0 + i * 60_000).state;
      expect(s.huntTokens).toBeGreaterThanOrEqual(tokens);
      expect(s.huntCount).toBeGreaterThanOrEqual(count);
      tokens = s.huntTokens;
      count = s.huntCount;
    }
  });

  it('re-anchors instead of subtracting when the clock jumps backwards', () => {
    // NTP correction, a timezone change, a restored VM snapshot. Math.floor of
    // a negative gap would decrement huntCount and huntTokens.
    const s = tick(hunting(), 10);
    const back = hunt(s, T0 - 3_600_000);
    expect(back.state.huntTokens).toBe(s.huntTokens);
    expect(back.state.huntCount).toBe(s.huntCount);
    expect(back.state.huntedAt).toBe(T0 - 3_600_000);
  });

  it('forfeits the backlog past the offline cap instead of deferring it', () => {
    const s = hunting();
    const week = hunt(s, T0 + 7 * 24 * 3600_000).state;
    expect(week.huntCount).toBe(HUNT_OFFLINE_CAP);
    // The bug this guards: advancing the anchor by n rather than by the full
    // backlog hands the forfeited remainder straight back on the next tick.
    const after = hunt(week, T0 + 7 * 24 * 3600_000 + 1000).state;
    expect(after.huntCount).toBe(HUNT_OFFLINE_CAP);
  });

  it('stops paying at the cap but keeps the encounters coming', () => {
    let s = hunting({ lifetimeEarned: 0 });
    const cap = huntCap(s);
    for (let i = 1; i <= 400; i++) s = hunt(s, T0 + i * HUNT_OFFLINE_CAP * HUNT_INTERVAL_MS).state;
    expect(s.huntTokens).toBeLessThanOrEqual(cap);
    expect(s.huntCount).toBeGreaterThan(1000);
    // TMs still drop past the cap — farming keeps working, the currency saturates.
    expect(Object.keys(s.tms).length).toBeGreaterThan(0);
    // Thirty-eight thousand encounters, every trainer a whole team fight.
  }, 30_000);

  it('lets the cap grow with tokens actually burned', () => {
    const poor = hunting({ lifetimeEarned: 0 });
    const rich = hunting({ lifetimeEarned: 4_000_000_000 });
    expect(huntCap(rich)).toBeGreaterThan(huntCap(poor));
    expect(huntCap(poor)).toBe(H * 3); // the floor, so a fresh install still moves
  });

  it('is inert while an everstone is on', () => {
    const s = hunting({ everstone: true });
    const r = hunt(s, T0 + 50 * HUNT_INTERVAL_MS);
    expect(r.state.huntTokens).toBe(0);
    expect(r.state.huntCount).toBe(0);
  });

  it('is inert while switched off, and does not bank the pause', () => {
    const off = hunting({ huntEnabled: false });
    const paused = hunt(off, T0 + 100 * HUNT_INTERVAL_MS).state;
    expect(paused.huntedAt).toBeNull();
    expect(paused.huntCount).toBe(0);
    // Turning it back on starts from that moment, not from the pause.
    const on = hunt({ ...paused, huntEnabled: true }, T0 + 200 * HUNT_INTERVAL_MS).state;
    expect(on.huntCount).toBe(0);
    expect(hunt(on, T0 + 201 * HUNT_INTERVAL_MS).state.huntCount).toBe(1);
  });

  it('does not hunt during the egg phase', () => {
    const egg = base({ huntedAt: T0, lifetimeEarned: 1_000_000_000 });
    expect(egg.active).toBeNull();
    const r = hunt(egg, T0 + 50 * HUNT_INTERVAL_MS);
    expect(r.state.huntCount).toBe(0);
    expect(r.state.huntedAt).toBeNull();
  });

  it('keeps the log bounded and newest-first', () => {
    const s = tick(hunting(), 200);
    expect(s.huntLog.length).toBe(20);
    expect(s.huntLog[0].seq).toBeGreaterThan(s.huntLog[19].seq);
  });

  it('awards whole tokens only', () => {
    // buildState seeds advance() off Math.floor(lifetimeTokens); a fractional
    // award would leak float drift into an XOR seed.
    const s = tick(hunting(), 60);
    expect(Number.isInteger(s.huntTokens)).toBe(true);
    for (const e of s.huntLog) expect(Number.isInteger(e.tokens)).toBe(true);
  });

  it('cannot stampede advance() past its loop guard after a month away', () => {
    const s = hunting();
    const month = hunt(s, T0 + 30 * 24 * 3600_000).state;
    const { events } = advance(month, lifetimeOf(month), mulberry32(1));
    expect(events.length).toBeLessThan(100);
  });

  it('lands on the measured rate for a fresh companion', () => {
    // The payout table still AIMS at 5% of a hatch threshold per hour — every
    // encounter's reward is normalised to that — but a wild fight can be lost
    // now, and a loss pays nothing. The fixture is a fresh 알통몬 knowing one
    // 바위깨기, which wins about a quarter of its wild fights at level 50, so
    // it earns about 1.5% an hour. This was 8.10% while every wild fight was a
    // win. A final evolution with four machines wins most of them and earns
    // most of the advertised rate; the rate is a ceiling, not a promise.
    //
    // Measured over many starting points rather than one:
    // a trainer is worth a dozen ordinary encounters, so a single hour that
    // happens to contain one reads far above the average — up to 22%.
    let total = 0;
    const runs = 400;
    for (let start = 0; start < runs; start++) {
      const s = hunting({ huntCount: start * 12 });
      total += hunt(s, T0 + 12 * HUNT_INTERVAL_MS).state.huntTokens / H;
    }
    const mean = total / runs;
    expect(mean).toBeGreaterThan(0.008);
    expect(mean).toBeLessThan(0.03);
  });
});

describe('battleAt', () => {
  const strong = [63, 53, 89, 87]; // Hyper Beam, Flamethrower, Earthquake, Thunder

  it('is a pure function of the encounter index', () => {
    for (const k of [0, 3, 91, 5000]) {
      expect(battleAt(k, 'rare', strong)).toEqual(battleAt(k, 'rare', strong));
    }
  });

  it('takes more than one swing almost always — that was the whole complaint', () => {
    let single = 0;
    const N = 2000;
    for (let k = 0; k < N; k++) {
      if (battleAt(k, (['common', 'uncommon', 'rare', 'legendary'] as const)[k % 4], strong).turns.length === 1) {
        single++;
      }
    }
    expect(single / N).toBeLessThan(0.02);
  });

  it('takes longer against a rarer opponent', () => {
    const mean = (rarity: 'common' | 'legendary') => {
      let t = 0;
      for (let k = 0; k < 600; k++) t += battleAt(k, rarity, strong).turns.length;
      return t / 600;
    };
    expect(mean('legendary')).toBeGreaterThan(mean('common') + 1);
  });

  it('hits harder with a stronger move, and criticals hit hardest', () => {
    // Hyper Beam is 150, Pound is 40.
    const hard = battleAt(5, 'legendary', [63]).turns[0].damage;
    const soft = battleAt(5, 'legendary', [1]).turns[0].damage;
    expect(hard).toBeGreaterThan(soft * 2);
    const crits = [];
    for (let k = 0; k < 3000; k++) for (const t of battleAt(k, 'rare', strong).turns) if (t.crit) crits.push(t);
    expect(crits.length).toBeGreaterThan(100); // roughly 12% of swings
  });

  it('spends a status move on its effect rather than on chip damage', () => {
    // Agility has no power. It used to be worth 35 damage anyway, which made
    // "전기자석파로 상대를 때렸다" a thing the game said out loud.
    const b = battleAt(2, 'rare', [97]);
    expect(b.turns[0].damage).toBe(0);
    // Something happened, though — Agility sharply raises Speed.
    expect(b.turns[0].myEvents).toContainEqual({ k: 'stat', on: 'user', stat: 'spe', delta: 2, tried: 2 });
    expect(b.turns[0].ailment).toBeNull();
  });

  it('lands the ailment a status move exists for', () => {
    // Thunder Wave: no power, paralysis every time it connects.
    const tw = moveById(86)!;
    expect(tw.power).toBe(0);
    expect(tw.ailment).toBe('paralysis');

    let sawParalysis = false;
    for (let k = 0; k < 200; k++) {
      for (const t of battleAt(k, 'rare', [86], 19, { mySpeciesId: 25 }).turns) {
        expect(t.damage === 0 || t.moveId === null).toBe(true);
        if (t.ailment === 'paralysis') sawParalysis = true;
      }
    }
    expect(sawParalysis).toBe(true);
  });

  it('lets an attack carry its own side effect', () => {
    // Flamethrower burns one time in ten. That is a real column now, not a guess.
    expect(moveById(53)!.ailmentChance).toBe(10);
    let burns = 0;
    let swings = 0;
    for (let k = 0; k < 800; k++) {
      for (const t of battleAt(k, 'rare', [53], 19, { mySpeciesId: 25 }).turns) {
        if (t.moveId === 53 && !t.missed) swings++;
        if (t.ailment === 'burn') burns++;
      }
    }
    expect(swings).toBeGreaterThan(1000);
    expect(burns / swings).toBeGreaterThan(0.05);
    expect(burns / swings).toBeLessThan(0.16);
  });

  it('gives a status-only moveset its plain swing back', () => {
    // Teaching one status move used to leave a companion strictly worse off
    // than teaching nothing at all: the roll only ever picked taught moves, so
    // every turn dealt zero and the finisher did the whole fight alone.
    const allStatus = [14, 97, 86, 92];
    let hits = 0;
    let turns = 0;
    for (let k = 0; k < 300; k++) {
      for (const t of battleAt(k, 'rare', allStatus, 19, { mySpeciesId: 25 }).turns) {
        turns++;
        if (t.damage > 0) hits++;
      }
    }
    // One in five of the pool plus the finisher — comfortably above the
    // finisher-only 1/8 this replaced.
    expect(hits / turns).toBeGreaterThan(0.2);

    // An untaught moveset is untouched: it takes no draw at all, which is what
    // keeps the GOLDEN table's bare case exact.
    for (const t of battleAt(13, 'uncommon', [], 19).turns) expect(t.moveId).toBeNull();
  });

  it('does not spend a turn re-inflicting what is already there', () => {
    // 맹독 on an already-poisoned opponent fails. A player would pick something
    // else; so does the roll. Before this the same status move could be thrown
    // five turns running for nothing.
    let failed = 0;
    let turns = 0;
    for (let k = 0; k < 800; k++) {
      const foe = 1 + ((k * 7919) % 1025);
      for (const t of battleAt(k, 'rare', [92, 86, 14, 53], foe, { mySpeciesId: 6 }).turns) {
        turns++;
        if (t.selfEffect === 'failed') failed++;
      }
    }
    expect(turns).toBeGreaterThan(2000);
    expect(failed).toBe(0);
  });

  it('keeps volatile conditions off the panel, as the games do', () => {
    // Confusion, bind and the rest get a message-box line and no icon.
    const volatile = ['confusion', 'trap', 'silence', 'nightmare', 'infatuation', 'torment', 'embargo'];
    let shown = 0;
    for (let k = 0; k < 1200; k++) {
      const foe = 1 + ((k * 7919) % 1025);
      const me = 1 + ((k * 104729) % 1025);
      for (const t of battleAt(k, 'rare', [53, 86, 92, 89], foe, { mySpeciesId: me }).turns) {
        for (const st of [t.foeStatus, t.myStatus]) {
          if (st === null) continue;
          shown++;
          expect(volatile, `${st}`).not.toContain(st);
        }
      }
    }
    expect(shown).toBeGreaterThan(1000);
  });

  it('only lets the opponent use moves its species learns by Lv.50, or by machine', () => {
    let picks = 0;
    let stab = 0;
    for (let k = 0; k < 2000; k++) {
      const foe = 1 + ((k * 7919) % 1025);
      const legal = new Set([...learnableMoves(foe), ...levelUpMoves(foe).filter(([lv]) => lv <= 50).map(([, id]) => id)]);
      const types = speciesInfo(foe)?.types ?? [];
      for (const t of battleAt(k, 'rare', strong, foe, { mySpeciesId: 25 }).turns) {
        if (t.foeMoveId === null) continue;
        picks++;
        expect(legal.has(t.foeMoveId), `${foe}/${t.foeMoveId}`).toBe(true);
        if (types.includes(moveById(t.foeMoveId)!.type)) stab++;
      }
    }
    expect(picks).toBeGreaterThan(1000);
    // A lean, not a rule: STAB is weighted, and six species have no attacking
    // move of their own type for it to prefer.
    //
    // The draw now multiplies a second factor in — how the chart bites ME — and
    // this band is deliberately unmoved by it: a median pool holds 33 attacking
    // moves spread across many types, so the two factors are close to
    // independent and the share only slid 0.578 -> 0.577. If this band ever
    // does move, the matchup table is fighting STAB rather than layering on it.
    expect(stab / picks).toBeGreaterThan(0.5);
    expect(stab / picks).toBeLessThan(0.8);
  });

  /**
   * The complaint this was built for, from the companion's side.
   *
   * Gyarados is Water/Flying: Thunder is 4x on it and Earthquake cannot touch
   * it at all. The old uniform draw threw each of the four about a quarter of
   * the time regardless, so a fight against it opened with "효과가 없는 것
   * 같다…" roughly once in four.
   */
  it('throws the move the chart likes', () => {
    const picks = new Map<number | null, number>();
    let total = 0;
    for (let k = 0; k < 500; k++) {
      for (const t of battleAt(k, 'rare', strong, 130, { mySpeciesId: 25 }).turns) {
        picks.set(t.moveId, (picks.get(t.moveId) ?? 0) + 1);
        total++;
      }
    }
    // 87 Thunder, 4x. 89 Earthquake, 0x.
    expect((picks.get(87) ?? 0) / total).toBeGreaterThan(0.5);
    expect((picks.get(89) ?? 0) / total).toBeLessThan(0.08);
  });

  /**
   * And still throws the useless one now and then.
   *
   * The floor in MATCHUP_WEIGHT, tested directly. Two things rest on it: the
   * pick stays a preference rather than a decision — the lesson written above
   * `battleAt` about a rotation that read as a script — and "효과가 없는 것
   * 같다…" stays a line the game can actually say. The GOLDEN table used to
   * carry this coverage in row 91 and no longer does.
   */
  it('still throws the useless one now and then', () => {
    let immune = 0;
    let total = 0;
    for (const foe of [130, 92]) {
      for (let k = 0; k < 500; k++) {
        // The floor alone: abilities change how long each fight runs.
        for (const t of battleAt(k, 'rare', strong, foe, { mySpeciesId: 25, myAbility: null, foeAbility: null }).turns) {
          total++;
          if (t.effect === 0) immune++;
        }
      }
    }
    expect(immune).toBeGreaterThan(0);
    expect(immune / total).toBeGreaterThan(0.005);
    expect(immune / total).toBeLessThan(0.03);
  });

  /**
   * When the chart has nothing to say, the draw is the uniform one it replaced.
   *
   * Rattata is Normal and all four of `strong` are neutral against it, so every
   * weight is exactly 1 — and an all-ones weighted draw returns exactly
   * `Math.floor(roll * n)`. This is that identity measured; GOLDEN rows 0, 5, 7
   * and 13 are the same identity frozen.
   */
  it('draws uniformly when the chart has nothing to say', () => {
    const picks = new Map<number | null, number>();
    let total = 0;
    for (let k = 0; k < 800; k++) {
      for (const t of battleAt(k, 'rare', strong, 19, { mySpeciesId: 25 }).turns) {
        // A turn spent recharging from 파괴광선 is not a pick.
        if (!t.meActed || t.mySkip) continue;
        picks.set(t.moveId, (picks.get(t.moveId) ?? 0) + 1);
        total++;
      }
    }
    for (const id of strong) {
      expect((picks.get(id) ?? 0) / total, `${id}`).toBeGreaterThan(0.2);
      expect((picks.get(id) ?? 0) / total, `${id}`).toBeLessThan(0.3);
    }
  });

  /**
   * A status move is not in the argument about types.
   *
   * Toxic is Poison and Skarmory is Steel/Flying, so as an ATTACK it would be a
   * 0x and the weight would bury it. It deals no damage either way, though,
   * `statusOutcome` never reads a type, and the panel prints its effect line
   * rather than an effectiveness one — so it takes the neutral weight and keeps
   * its share. Earthquake, a real 0x attack, is the control.
   *
   * Its share sits under a clean quarter because the re-inflict filter drops it
   * once the poison is standing, and because the finisher swaps it out.
   */
  it('leaves a status move out of the argument', () => {
    const withToxic = [92, 53, 89, 63];
    const picks = new Map<number | null, number>();
    let total = 0;
    for (let k = 0; k < 600; k++) {
      // Pidgeot: Normal/Flying, so Earthquake is 0x and Toxic still lands.
      for (const t of battleAt(k, 'rare', withToxic, 18, { mySpeciesId: 25 }).turns) {
        picks.set(t.moveId, (picks.get(t.moveId) ?? 0) + 1);
        total++;
      }
    }
    const toxic = (picks.get(92) ?? 0) / total;
    const quake = (picks.get(89) ?? 0) / total;
    expect(toxic).toBeGreaterThan(0.1);
    expect(toxic).toBeGreaterThan(quake * 5);
  });

  it('falls back to a plain swing for a species with no attacking machine move', () => {
    // Ditto learns nothing from a machine at all.
    for (const t of battleAt(4, 'common', strong, 132, { mySpeciesId: 6 }).turns) {
      expect(t.foeMoveId).toBeNull();
    }
  });

  it('leaves the chart off the foe when the companion species is not supplied', () => {
    // The compatibility contract: omit mySpeciesId and nothing about the
    // opponent's half can bite, which is what the old behaviour was.
    for (let k = 0; k < 200; k++) {
      for (const t of battleAt(k, 'rare', strong, 130).turns) expect(t.foeEffect).toBe(1);
    }
    const seen = new Set<number>();
    for (let k = 0; k < 200; k++) {
      for (const t of battleAt(k, 'rare', strong, 130, { mySpeciesId: 6 }).turns) seen.add(t.foeEffect);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  /**
   * The opponent stops swinging at nothing too.
   *
   * The same sample as the envelope above, read for the chart rather than the
   * damage. Both numbers moved and both are the point: a move that cannot touch
   * me went from one pick in twenty-eight to one in a hundred, and the mean
   * matchup rose from 1.02 to 1.09.
   *
   * The STAB band is not a substitute for this — it would still pass with the
   * matchup factor deleted outright.
   */
  it('lets the opponent read the chart as well', () => {
    let picks = 0;
    let effSum = 0;
    let immune = 0;
    for (let k = 0; k < 1500; k++) {
      const foe = 1 + ((k * 7919) % 1025);
      const me = 1 + ((k * 104729) % 1025);
      // The chart alone: an ability that drinks a move in is a different lesson.
      for (const t of battleAt(k, 'rare', strong, foe, { mySpeciesId: me, myAbility: null, foeAbility: null }).turns) {
        if (!t.foeActed || t.foeMoveId === null) continue;
        picks++;
        effSum += t.foeEffect;
        if (t.foeEffect === 0) immune++;
      }
    }
    expect(picks).toBeGreaterThan(2000);
    expect(effSum / picks).toBeGreaterThan(1.05);
    expect(immune / picks).toBeLessThan(0.02);
    // A lean, not a rule, on this side as well.
    expect(immune).toBeGreaterThan(0);
  });

  it('says nothing hit when nothing hit', () => {
    // Ground move against a Flying type: the panel prints "효과가 없는 것 같다",
    // so the bar must not move either.
    for (let k = 0; k < 400; k++) {
      for (const t of battleAt(k, 'rare', strong, 19, { mySpeciesId: 130 }).turns) {
        const quiet = t.foeEvents.some((e) => e.k === 'charge' || e.k === 'blocked' || e.k === 'future');
        const swung = t.foeActed && !t.foeMissed && !t.foeSkip && t.foeSelfEffect === null && !t.foeAilment && !quiet;
        if (t.foeActed && t.foeEffect === 0) expect(t.counter).toBe(0);
        if (swung && t.foeEffect > 0) expect(t.counter).toBeGreaterThan(0);
      }
    }
  });

  // ── Level-50 stats ──────────────────────────────────────────────────────

  it('computes level-50 stats from base stats, with no IVs and no EVs', () => {
    // 이상해씨: 45/49/49/65/65/45. HP is base + 60, everything else base + 5.
    expect(battleStats([45, 49, 49, 65, 65, 45])).toEqual({
      hp: 105,
      atk: 54,
      def: 54,
      spa: 70,
      spd: 70,
      spe: 50,
    });
    // 껍질몬 is the games' one exception: always 1 HP.
    expect(battleStats([1, 90, 45, 30, 30, 40]).hp).toBe(1);
  });

  it('sizes both bars from the species, not from the moveset', () => {
    // 꼬렛 (HP 30) against 잠만보 (HP 160).
    const b = battleAt(1, 'common', [], 19, { mySpeciesId: 143 });
    expect(b.foeMaxHp).toBe(90);
    expect(b.myMaxHp).toBe(220);
    expect(battleAt(1, 'common', strong, 19, { mySpeciesId: 143 }).foeMaxHp).toBe(90);
  });

  it('ends with somebody down, at the turn cap, or with the wild one gone', () => {
    for (let k = 0; k < 400; k++) {
      const foe = 1 + ((k * 7919) % 1025);
      const b = battleAt(k, 'rare', strong, foe, { mySpeciesId: 1 + ((k * 104729) % 1025) });
      const last = b.turns.at(-1)!;
      // 드래곤테일 in a wild fight blows the companion clean out of it.
      const fled = b.exit === 'fled';
      expect(last.foeHpAfter === 0 || last.myHpAfter === 0 || b.turns.length === MAX_TURNS || fled, `${k}`).toBe(true);
      expect(b.won).toBe(last.foeHpAfter === 0 && last.myHpAfter > 0);
      // Nobody moves once they are down.
      b.turns.slice(0, -1).forEach((t) => expect(t.foeHpAfter > 0 && t.myHpAfter > 0).toBe(true));
    }
  });

  it('can be lost, wild or not', () => {
    // 꼬렛 with nothing taught against 망나뇽. Nothing props the companion up.
    let lost = 0;
    for (let k = 0; k < 200; k++) {
      if (!battleAt(k, 'rare', [], 149, { mySpeciesId: 19 }).won) lost++;
    }
    expect(lost).toBeGreaterThan(190);
  });

  it('wins more for a stronger species with the same moves', () => {
    const rate = (me: number) => {
      let won = 0;
      for (let k = 0; k < 600; k++) {
        const foe = 1 + ((k * 7919) % 1025);
        if (battleAt(k, 'rare', strong, foe, { mySpeciesId: me }).won) won++;
      }
      return won / 600;
    };
    // 캐터피 against 망나뇽, carrying the very same four machines.
    expect(rate(149)).toBeGreaterThan(rate(10) + 0.3);
  });

  it('lets the faster side move first', () => {
    // 쥬피썬더 (Speed 130) against 잠만보 (Speed 30), and the other way round.
    for (let k = 0; k < 100; k++) {
      for (const t of battleAt(k, 'rare', [87], 143, { mySpeciesId: 135 }).turns) {
        if (t.myStatus !== 'paralysis') expect(t.foeFirst, `${k}`).toBe(false);
      }
      for (const t of battleAt(k, 'rare', [89], 135, { mySpeciesId: 143 }).turns) {
        if (t.foeStatus !== 'paralysis') expect(t.foeFirst, `${k}`).toBe(true);
      }
    }
  });

  it('hits harder off the stat the move uses', () => {
    // Hyper Beam is special: 후딘 (Sp. Atk 135) against 괴력몬 (Sp. Atk 65).
    const mean = (me: number) => {
      let total = 0;
      let n = 0;
      for (let k = 0; k < 300; k++) {
        for (const t of battleAt(k, 'rare', [63], 143, { mySpeciesId: me }).turns) {
          if (t.meActed && !t.missed && !t.mySkip) {
            total += t.damage;
            n++;
          }
        }
      }
      return total / n;
    };
    expect(mean(65)).toBeGreaterThan(mean(68) * 1.5);
  });

  it('lets one side act and the other fall before its turn', () => {
    for (let k = 0; k < 300; k++) {
      const b = battleAt(k, 'rare', strong, 130, { mySpeciesId: 6 });
      b.turns.forEach((t, i) => {
        const last = i === b.turns.length - 1;
        // Both halves happen on every turn but the last.
        if (!last) {
          expect(t.meActed && t.foeActed, `${k}/${i}`).toBe(true);
          return;
        }
        // On the last, a half that never came belongs to whoever went down
        // before its slot — and it did nothing.
        if (!t.meActed) {
          expect(t.foeFirst && t.myHpAfter === 0, `${k}`).toBe(true);
          expect(t.damage).toBe(0);
        }
        if (!t.foeActed) {
          expect(!t.foeFirst && t.foeHpAfter === 0, `${k}`).toBe(true);
          expect(t.counter).toBe(0);
        }
      });
    }
  });

  // ── Status conditions ───────────────────────────────────────────────────

  /** Every turn of `n` fights of `me` against `foe`, starting under `status`. */
  // Without abilities: these measure what a condition does, and 속보 or 유연
  // would measure the ability instead.
  const under = (status: Condition, me: number, foe: number, moves: number[], n = 400) =>
    Array.from({ length: n }, (_, k) =>
      battleAt(k, 'rare', moves, foe, { mySpeciesId: me, startStatus: status, myAbility: null, foeAbility: null }),
    );

  it('paralysis halves Speed and costs a turn about one time in four', () => {
    // 쥬피썬더 paralysed is 67 against 꼬렛's 77, so it now moves second.
    let skipped = 0;
    let turns = 0;
    for (const b of under('paralysis', 135, 19, [87])) {
      for (const t of b.turns) {
        if (t.myStatus !== 'paralysis') continue;
        expect(t.foeFirst).toBe(true);
        if (!t.meActed) continue;
        turns++;
        if (t.mySkip === 'paralysis') skipped++;
      }
    }
    expect(skipped / turns).toBeGreaterThan(0.18);
    expect(skipped / turns).toBeLessThan(0.32);
  });

  it('sleep costs one to three turns and then wears off', () => {
    for (const b of under('sleep', 143, 19, [89])) {
      const awake = b.turns.findIndex((t) => t.meActed && t.mySkip !== 'sleep');
      const slept = b.turns.slice(0, awake < 0 ? undefined : awake).filter((t) => t.mySkip === 'sleep').length;
      expect(slept).toBeGreaterThanOrEqual(1);
      expect(slept).toBeLessThanOrEqual(3);
      // The first turn it gets to move is the turn it woke up on.
      if (awake >= 0) expect(b.turns[awake].myCured).toBe('sleep');
    }
  });

  it('freezes solid until a one-in-five thaw', () => {
    let frozen = 0;
    let thawed = 0;
    for (const b of under('freeze', 143, 19, [89])) {
      for (const t of b.turns) {
        if (t.mySkip === 'freeze') frozen++;
        if (t.myCured === 'freeze') thawed++;
      }
    }
    const rate = thawed / (thawed + frozen);
    expect(rate).toBeGreaterThan(0.14);
    expect(rate).toBeLessThan(0.26);
  });

  it('burns: half the damage of a physical move, and a sixteenth each turn', () => {
    // Seed for seed the draws are the same, so the burned hit is the plain one halved.
    for (let k = 0; k < 200; k++) {
      // A foe held to Hyper Beam, so no bind stacks its own chip on top.
      const plain = battleAt(k, 'rare', [89], 143, { mySpeciesId: 76, foeMoves: [63] });
      const burnt = battleAt(k, 'rare', [89], 143, { mySpeciesId: 76, foeMoves: [63], startStatus: 'burn' });
      const a = plain.turns[0];
      const b = burnt.turns[0];
      if (a.meActed && b.meActed && !a.missed && a.damage > 1) {
        expect(b.damage).toBe(Math.max(1, Math.floor(a.damage / 2)));
      }
      for (const t of burnt.turns) {
        if (t.myHpAfter > 0) expect(t.myResidual).toBe(Math.floor(burnt.myMaxHp / 16));
      }
    }
  });

  it('leaves a special move alone under a burn', () => {
    for (let k = 0; k < 100; k++) {
      const plain = battleAt(k, 'rare', [63], 143, { mySpeciesId: 76 });
      const burnt = battleAt(k, 'rare', [63], 143, { mySpeciesId: 76, startStatus: 'burn' });
      expect(burnt.turns[0].damage).toBe(plain.turns[0].damage);
    }
  });

  it('poisons for an eighth, and 맹독 for a sixteenth more every turn', () => {
    for (const b of under('poison', 143, 19, [89], 50)) {
      for (const t of b.turns) if (t.myHpAfter > 0) expect(t.myResidual).toBe(Math.floor(b.myMaxHp / 8));
    }
    for (const b of under('toxic', 143, 19, [89], 50)) {
      b.turns.forEach((t, i) => {
        if (t.myHpAfter > 0) expect(t.myResidual).toBe(Math.floor((b.myMaxHp * (i + 1)) / 16));
      });
    }
  });

  it('lets the chip itself fell', () => {
    // No more "clings at 1": a 맹독 is allowed to finish the job.
    let felledByChip = 0;
    for (const b of under('toxic', 10, 143, [], 300)) {
      const last = b.turns.at(-1)!;
      if (last.myHpAfter === 0 && last.myResidual > 0) felledByChip++;
    }
    expect(felledByChip).toBeGreaterThan(0);
  });

  it('confuses: now and then it hits itself instead', () => {
    // A named foe carrying nothing but 이상한빛.
    let selfHits = 0;
    for (let k = 0; k < 300; k++) {
      for (const t of battleAt(k, 'rare', [89], 143, { mySpeciesId: 76, foeMoves: [109] }).turns) {
        if (t.mySkip === 'confusion') {
          selfHits++;
          expect(t.mySelfHit).toBeGreaterThan(0);
          expect(t.damage).toBe(0);
        }
      }
    }
    expect(selfHits).toBeGreaterThan(20);
  });

  it('respects the type immunities', () => {
    // 전기자석파 does nothing to a Ground type, 맹독 nothing to Steel. A player
    // knows that, so neither is ever thrown at them.
    for (let k = 0; k < 200; k++) {
      for (const t of battleAt(k, 'rare', [86, 87], 50, { mySpeciesId: 25 }).turns) {
        expect(t.moveId).not.toBe(86);
      }
      for (const t of battleAt(k, 'rare', [92, 89], 81, { mySpeciesId: 76 }).turns) {
        expect(t.moveId).not.toBe(92);
      }
    }
    // And the condition itself cannot land on the type that is immune to it.
    for (let k = 0; k < 400; k++) {
      for (const t of battleAt(k, 'rare', [53], 126, { mySpeciesId: 6 }).turns) {
        expect(t.ailment).not.toBe('burn');
      }
    }
  });

  it('holds one non-volatile condition at a time', () => {
    const NON_VOLATILE = new Set(['burn', 'poison', 'toxic', 'paralysis', 'sleep', 'freeze']);
    for (let k = 0; k < 600; k++) {
      const foe = 1 + ((k * 7919) % 1025);
      const b = battleAt(k, 'rare', [92, 86, 53, 87], foe, { mySpeciesId: 135 });
      let before: string | null = null;
      for (const t of b.turns) {
        if (t.ailment && NON_VOLATILE.has(t.ailment)) expect(before, `${k}`).toBeNull();
        before = t.foeStatus;
      }
    }
  });

  it('keeps a landed condition on the plate until it lifts', () => {
    let k = 0;
    let b = battleAt(k, 'rare', [86, 53], 143, { mySpeciesId: 25 });
    while (!b.turns.some((t) => t.ailment === 'paralysis') && k < 100) {
      b = battleAt(++k, 'rare', [86, 53], 143, { mySpeciesId: 25 });
    }
    const at = b.turns.findIndex((t) => t.ailment === 'paralysis');
    expect(at).toBeGreaterThanOrEqual(0);
    for (let i = at; i < b.turns.length; i++) expect(b.turns[i].foeStatus, `turn ${i}`).toBe('paralysis');
    for (let i = 0; i < at; i++) expect(b.turns[i].foeStatus).toBeNull();
  });

  it('heals everything and sleeps two turns on 잠자기', () => {
    let rested = 0;
    for (let k = 0; k < 300; k++) {
      const b = battleAt(k, 'rare', [156, 89], 68, { mySpeciesId: 143 });
      b.turns.forEach((t, i) => {
        if (t.moveId !== 156 || t.selfEffect !== 'heal') return;
        rested++;
        expect(t.myStatus === 'sleep' || t.myHpAfter === 0).toBe(true);
        // The next two turns it sleeps, if the fight lasts that long.
        for (const u of b.turns.slice(i + 1, i + 3)) if (u.meActed) expect(u.mySkip).toBe('sleep');
      });
    }
    expect(rested).toBeGreaterThan(0);
  });

  it('ends at the turn cap when nothing can hurt anything', () => {
    // Normal moves against a Ghost, from a Ghost that cannot hurt a Normal
    // type back. Nobody wins; the cap is what stops it.
    // Two ghost moves, so it has the PP to last — with one it would run dry
    // and 발버둥, which is typeless and hurts anybody.
    const b = battleAt(3, 'rare', [], 92, { mySpeciesId: 19, foeMoves: [247, 421] });
    expect(b.turns).toHaveLength(MAX_TURNS);
    expect(b.exit).toBe('stall');
    expect(b.won).toBe(false);
  });

  // ── Weather, terrain, screens, stages, priority ─────────────────────────

  /** Every turn of `n` seeded fights, with the field as it stood when the turn began. */
  const turnsOf = (n: number, moves: number[], foe: number, opts: Parameters<typeof battleAt>[4]) =>
    Array.from({ length: n }, (_, k) => battleAt(k, 'rare', moves, foe, opts)).flatMap((b) =>
      b.turns.map((t, i) => ({ t, before: i > 0 ? b.turns[i - 1].field : null, b })),
    );

  it('lets the rain make Water moves hit half again as hard', () => {
    // 거북왕 with 비바라기 and 파도타기, into a 잠만보 that only knows 몸통박치기.
    let wet = 0;
    let wetN = 0;
    let dry = 0;
    let dryN = 0;
    // No abilities: 급류 at a third of the bar would measure itself, not the rain.
    for (const { t, before } of turnsOf(600, [240, 57], 143, { mySpeciesId: 9, foeMoves: [34], myAbility: null, foeAbility: null })) {
      if (t.moveId !== 57 || !t.meActed || t.mySkip || t.missed || t.crit || t.damage === 0) continue;
      if (t.foeHpAfter === 0) continue; // a finishing blow is clipped to what was left
      if (before?.weather === 'rain') {
        wet += t.damage;
        wetN++;
      } else if (!before?.weather) {
        dry += t.damage;
        dryN++;
      }
    }
    expect(wetN).toBeGreaterThan(20);
    expect(dryN).toBeGreaterThan(20);
    expect(wet / wetN / (dry / dryN)).toBeGreaterThan(1.35);
    expect(wet / wetN / (dry / dryN)).toBeLessThan(1.65);
  });

  it('chips all but the spared types in a sandstorm, for five turns', () => {
    // 단단지 is Bug/Rock: sand leaves it alone and grinds the 잠만보 down.
    let chipped = 0;
    for (let k = 0; k < 60; k++) {
      const b = battleAt(k, 'rare', [201], 143, { mySpeciesId: 213 });
      const set = b.turns.findIndex((t) => t.myEvents.some((e) => e.k === 'weather'));
      if (set < 0) continue;
      for (const t of b.turns) {
        for (const e of t.endEvents) {
          if (e.k === 'weather-chip') {
            expect(e.on).toBe('foe');
            chipped++;
          }
        }
      }
      // Five end phases, counting the one it went up on — if the fight lasts that long.
      const ended = b.turns.findIndex((t) => t.endEvents.some((e) => e.k === 'weather-end'));
      if (ended >= 0) expect(ended - set).toBe(4);
    }
    expect(chipped).toBeGreaterThan(20);
  });

  it('never re-uses a weather that is already up', () => {
    for (let k = 0; k < 200; k++) {
      for (const t of battleAt(k, 'rare', [240, 57], 143, { mySpeciesId: 9 }).turns) {
        if (t.moveId === 240 && t.meActed && !t.mySkip && !t.missed) expect(t.selfEffect).not.toBe('failed');
      }
    }
  });

  it('powers up a grounded Electric move on 일렉트릭필드', () => {
    // 라이츄 lays the field and throws 10만볼트 at a 잠만보 held to 몸통박치기.
    let on = 0;
    let onN = 0;
    let off = 0;
    let offN = 0;
    for (const { t, before } of turnsOf(600, [604, 85], 143, { mySpeciesId: 26, foeMoves: [34] })) {
      if (t.moveId !== 85 || !t.meActed || t.mySkip || t.missed || t.crit || t.foeHpAfter === 0) continue;
      if (before?.terrain === 'electric') {
        on += t.damage;
        onN++;
      } else if (!before?.terrain) {
        off += t.damage;
        offN++;
      }
    }
    expect(onN).toBeGreaterThan(20);
    expect(on / onN / (off / offN)).toBeGreaterThan(1.2);
    expect(on / onN / (off / offN)).toBeLessThan(1.4);
  });

  it('halves physical hits behind 리플렉터, unless they crit', () => {
    // 후딘 puts up a Reflect against a 잠만보 that only knows 지진.
    let behind = 0;
    let behindN = 0;
    let open = 0;
    let openN = 0;
    for (const { t, before } of turnsOf(600, [115, 94], 143, { mySpeciesId: 65, foeMoves: [89] })) {
      if (!t.foeActed || t.foeSkip || t.foeMissed || t.foeCrit || t.counter === 0 || t.myHpAfter === 0) continue;
      const up = !!before?.mine.reflect || (t.foeFirst === false && t.myEvents.some((e) => e.k === 'screen'));
      if (up) {
        behind += t.counter;
        behindN++;
      } else if (!before?.mine.reflect) {
        open += t.counter;
        openN++;
      }
    }
    expect(behindN).toBeGreaterThan(20);
    expect(behind / behindN / (open / openN)).toBeGreaterThan(0.4);
    expect(behind / behindN / (open / openN)).toBeLessThan(0.6);
  });

  it('lets the slower side move first under 트릭룸', () => {
    // 야도란 (Speed 30) against 쥬피썬더 (130), which only knows 10만볼트.
    let seen = 0;
    for (const { t, before } of turnsOf(300, [433, 94], 135, { mySpeciesId: 80, foeMoves: [85] })) {
      if (!before || before.trickRoom === 0 || t.moveId === 433) continue;
      if (t.myStatus === 'paralysis' || t.foeStatus === 'paralysis') continue;
      seen++;
      expect(t.foeFirst).toBe(false);
    }
    expect(seen).toBeGreaterThan(10);
  });

  it('puts a higher-priority move first, whatever the speeds', () => {
    // 잠만보's 방어 is +4 against a 쥬피썬더 that is four times faster.
    let seen = 0;
    for (const { t } of turnsOf(300, [182, 89], 135, { mySpeciesId: 143, foeMoves: [85] })) {
      if (t.moveId !== 182 || !t.meActed) continue;
      seen++;
      expect(t.foeFirst).toBe(false);
    }
    expect(seen).toBeGreaterThan(10);
  });

  it('blocks the other move with 방어', () => {
    let blocked = 0;
    for (const { t } of turnsOf(300, [182, 89], 135, { mySpeciesId: 143, foeMoves: [85] })) {
      if (t.myEvents.some((e) => e.k === 'protect')) {
        expect(t.counter).toBe(0);
        if (t.foeActed && !t.foeSkip) {
          expect(t.foeEvents).toContainEqual({ k: 'blocked' });
          blocked++;
        }
      }
    }
    expect(blocked).toBeGreaterThan(10);
  });

  it('moves stages the way the data says, on the side it says', () => {
    const first = (moves: number[], foe = 143, me = 34) => {
      for (let k = 0; k < 50; k++) {
        const t = battleAt(k, 'rare', moves, foe, { mySpeciesId: me }).turns.find(
          (x) => x.moveId === moves[0] && x.meActed && !x.mySkip && !x.missed,
        );
        if (t) return t.myEvents;
      }
      return [];
    };
    expect(first([14, 89])).toContainEqual({ k: 'stat', on: 'user', stat: 'atk', delta: 2, tried: 2 });
    expect(first([103, 89])).toContainEqual({ k: 'stat', on: 'target', stat: 'def', delta: -2, tried: -2 });
    expect(first([347, 94], 143, 65)).toEqual([
      { k: 'stat', on: 'user', stat: 'spa', delta: 1, tried: 1 },
      { k: 'stat', on: 'user', stat: 'spd', delta: 1, tried: 1 },
    ]);
    // 오버히트 costs its user two stages of special attack.
    expect(first([315], 143, 6)).toContainEqual({ k: 'stat', on: 'user', stat: 'spa', delta: -2, tried: -2 });
  });

  it('heals off 기가드레인 and hurts itself on 이판사판태클', () => {
    let drained = 0;
    let recoiled = 0;
    for (const { t } of turnsOf(300, [202, 38], 143, { mySpeciesId: 3 })) {
      for (const e of t.myEvents) {
        if (e.k === 'drain') {
          drained++;
          expect(e.hp).toBeLessThanOrEqual(Math.max(1, Math.floor(t.damage / 2)));
        }
        if (e.k === 'recoil') {
          recoiled++;
          // A third of what it dealt — or whatever HP it had left, if less.
          expect(e.hp).toBeLessThanOrEqual(Math.max(1, Math.floor((t.damage * 33) / 100)));
        }
      }
    }
    expect(drained).toBeGreaterThan(10);
    expect(recoiled).toBeGreaterThan(10);
  });

  it('lands a 2–5 hit move 2, 3, 4 and 5 times at 35/35/15/15', () => {
    const count = [0, 0, 0, 0, 0, 0];
    let n = 0;
    for (const { t } of turnsOf(1500, [331], 143, { mySpeciesId: 3 })) {
      const hits = t.myEvents.find((e) => e.k === 'hits');
      if (!hits || hits.k !== 'hits' || t.foeHpAfter === 0) continue;
      count[hits.n]++;
      n++;
    }
    expect(count[2] / n).toBeGreaterThan(0.3);
    expect(count[3] / n).toBeGreaterThan(0.3);
    expect(count[4] / n).toBeLessThan(0.2);
    expect(count[5] / n).toBeLessThan(0.2);
  });

  it('only flinches a side that has not moved yet', () => {
    // A named foe with nothing but 스톤샤워 (30% flinch).
    let flinched = 0;
    for (const { t } of turnsOf(600, [89], 142, { mySpeciesId: 143, foeMoves: [157] })) {
      if (t.mySkip === 'flinch') {
        flinched++;
        expect(t.foeFirst).toBe(true);
      }
    }
    expect(flinched).toBeGreaterThan(10);
  });

  it('owes a turn after 파괴광선, and charges 솔라빔 unless the sun is out', () => {
    for (let k = 0; k < 50; k++) {
      const b = battleAt(k, 'rare', [63], 143, { mySpeciesId: 149 });
      b.turns.forEach((t, i) => {
        const next = b.turns[i + 1];
        if (t.meActed && !t.mySkip && !t.missed && t.damage > 0 && next?.meActed) expect(next.mySkip).toBe('recharge');
      });
    }
    const solar = battleAt(1, 'rare', [76], 143, { mySpeciesId: 3 });
    expect(solar.turns[0].myEvents).toContainEqual({ k: 'charge', moveId: 76 });
    expect(solar.turns[0].damage).toBe(0);
  });

  it('fells its user with 대폭발', () => {
    const b = battleAt(1, 'rare', [153], 143, { mySpeciesId: 76 });
    const t = b.turns.find((x) => x.myEvents.some((e) => e.k === 'self-ko'))!;
    expect(t).toBeDefined();
    expect(t.myHpAfter).toBe(0);
    expect(b.won).toBe(false);
  });

  it('deals exactly fifty with 지구던지기', () => {
    let seen = 0;
    for (const { t } of turnsOf(100, [69], 143, { mySpeciesId: 68 })) {
      // Clipped only by what the target had left.
      if (t.meActed && !t.mySkip && !t.missed && t.foeHpAfter > 0) {
        expect(t.damage).toBe(50);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(20);
  });

  it('is seeded apart from the encounter roll', () => {
    // Sharing a stream would mean asking for the battle changed which Pokemon
    // was met, which would break the replay the whole design rests on.
    const before = encounterAt(11, 668, 10_000_000);
    battleAt(11, 'rare', strong);
    expect(encounterAt(11, 668, 10_000_000)).toEqual(before);
  });
});

describe('form boosts in battle', () => {
  const strong = [63, 53, 89, 87];
  const MEGA_ZARD_X = 10034;
  const GMAX_ZARD = 10196;

  it('fights a mega with its own base stats and types', () => {
    const zard = formById(MEGA_ZARD_X)!;
    const opts = formOpts(zard);
    expect(opts.myStats).toEqual(zard.stats);
    expect(opts.myTypes).toEqual(zard.types);
    // 메가리자몽X trades special attack for attack: its Earthquake lands harder.
    let plain = 0;
    let mega = 0;
    for (let k = 0; k < 200; k++) {
      plain += battleAt(k, 'rare', [89], 143, { mySpeciesId: 6 }).turns[0].damage;
      mega += battleAt(k, 'rare', [89], 143, { mySpeciesId: 6, ...opts }).turns[0].damage;
    }
    expect(mega).toBeGreaterThan(plain * 1.3);
  });

  it('gives a fused companion its own stats and type chart', () => {
    // A fusion is not a battle transformation — it is what this Pokemon now is.
    const dusk = formById(10155)!;
    expect(dusk.kind).toBe('fusion');
    expect(formOpts(null, dusk)).toEqual({ myTypes: dusk.types, myStats: dusk.stats, myWeightKg: dusk.weightKg });
    // And a battle form on top of it wins: that is the shape actually swinging.
    const ultra = formById(10157)!;
    expect(formOpts(ultra, dusk).myTypes).toEqual(ultra.types);
    expect(formOpts(ultra, dusk).myStats).toEqual(ultra.stats);
  });

  it('asks a gigantamax for toughness rather than power', () => {
    const g = formById(GMAX_ZARD)!;
    const opts = formOpts(g);
    // The base stats are untouched, as in the games.
    expect(g.stats).toEqual([78, 84, 78, 109, 85, 100]);
    expect(opts.counterMult).toBe(0.5);
    expect(opts.counterMultTurns).toBe(3);
  });

  it('halves incoming damage for exactly three turns', () => {
    let early = 0;
    let earlyPlain = 0;
    let late = 0;
    let latePlain = 0;
    for (let k = 0; k < 300; k++) {
      const plain = battleAt(k, 'rare', [], 143, { mySpeciesId: 143 });
      const big = battleAt(k, 'rare', [], 143, { mySpeciesId: 143, counterMult: 0.5, counterMultTurns: 3 });
      for (let i = 0; i < Math.min(plain.turns.length, big.turns.length); i++) {
        if (i < 3) {
          early += big.turns[i].counter;
          earlyPlain += plain.turns[i].counter;
        } else if (i === 3) {
          late += big.turns[i].counter;
          latePlain += plain.turns[i].counter;
        }
      }
    }
    expect(early / earlyPlain).toBeGreaterThan(0.4);
    expect(early / earlyPlain).toBeLessThan(0.6);
    expect(late / latePlain).toBeGreaterThan(0.8);
  });

  it('is worth fights won', () => {
    let plain = 0;
    let big = 0;
    for (let k = 0; k < 400; k++) {
      const foe = 1 + ((k * 7919) % 1025);
      if (battleAt(k, 'rare', strong, foe, { mySpeciesId: 6 }).won) plain++;
      if (battleAt(k, 'rare', strong, foe, { mySpeciesId: 6, ...formOpts(formById(GMAX_ZARD)) }).won) big++;
    }
    expect(big).toBeGreaterThan(plain);
  });

  it('does nothing when no form is worn', () => {
    expect(formOpts(null)).toEqual({});
    for (const seq of [0, 7, 42]) {
      expect(battleAt(seq, 'rare', strong, 19, formOpts(null))).toEqual(
        battleAt(seq, 'rare', strong, 19),
      );
    }
  });

  it('gives a mega its own type chart', () => {
    // Mega Charizard X is Fire/Dragon, which the base species is not.
    expect(formOpts(formById(MEGA_ZARD_X)).myTypes).toEqual(['fire', 'dragon']);
  });

});

describe('huntCap', () => {
  it('is the greater of the floor and the earned share', () => {
    // A fresh install has earned nothing, so the floor is what carries it.
    const fresh = base({ hatchThreshold: H, lifetimeEarned: 0 });
    expect(huntCap(fresh)).toBe(H * 3);
    // Once earnings are large the share takes over.
    const rich = base({ hatchThreshold: H, lifetimeEarned: 1_000_000_000 });
    expect(huntCap(rich)).toBe(250_000_000);
  });

  it('grows only when the user earns, which is the whole point', () => {
    const a = huntCap(base({ hatchThreshold: H, lifetimeEarned: 1_000_000_000 }));
    const b = huntCap(base({ hatchThreshold: H, lifetimeEarned: 1_100_000_000 }));
    // A quarter of what was earned, exactly.
    expect(b - a).toBe(25_000_000);
  });

  it('stops paying once hunting has had its share', () => {
    const cap = huntCap(hunting());
    const full = { ...hunting(), huntTokens: cap };
    const after = tick(full, 12);
    expect(after.huntTokens).toBe(cap);
    // The encounters still happened — only the tokens stopped.
    expect(after.huntCount).toBeGreaterThan(full.huntCount);
    expect(after.huntLog.every((e) => e.tokens === 0)).toBe(true);
  });

  it('pays right through the ceiling once it is lifted', () => {
    const capped = { ...hunting(), huntTokens: huntCap(hunting()) };
    const lifted = { ...capped, huntUncapped: true };
    expect(huntCap(lifted)).toBe(Number.POSITIVE_INFINITY);

    const after = tick(lifted, 12);
    expect(after.huntTokens).toBeGreaterThan(lifted.huntTokens);
    expect(after.huntLog.some((e) => e.tokens > 0)).toBe(true);
  });

  it('lifts the ceiling without inventing what was already forfeited', () => {
    // Turning it off is not a refund: an encounter that paid nothing was never
    // recorded, and back-dating it would mean guessing how long it had bound.
    const capped = { ...hunting(), huntTokens: 999 };
    const r = setHuntUncapped(capped, true);
    expect(r.ok).toBe(true);
    expect(r.state.huntUncapped).toBe(true);
    expect(r.state.huntTokens).toBe(999);
    // Idempotent, and reversible.
    expect(setHuntUncapped(r.state, true).state).toBe(r.state);
    expect(setHuntUncapped(r.state, false).state.huntUncapped).toBe(false);
  });
});

describe('teach / forget', () => {
  const withTm = (moveId: number, over: Partial<GameState> = {}) =>
    hunting({ tms: { [moveId]: 1 }, ...over });

  /** A move Pyroar can actually learn, taken from the generated table. */
  const learnable = () => learnableMoves(668).slice(0, 6);

  const asPyroar = (s: GameState): GameState => ({
    ...s,
    active: { ...s.active!, pathIds: [667, 668], stageIndex: 1, moves: [] },
  });

  it('teaches a held TM and consumes it', () => {
    const [id] = learnable();
    const s = asPyroar(withTm(id));
    const r = teach(s, id, null);
    expect(r.ok).toBe(true);
    expect(r.state.active!.moves).toEqual([id]);
    expect(r.state.tms[id]).toBeUndefined();
    expect(r.message).toContain(moveById(id)!.ko);
  });

  it('refuses a TM that is not held, and takes nothing', () => {
    const [id] = learnable();
    const s = asPyroar(hunting());
    const r = teach(s, id, null);
    expect(r.ok).toBe(false);
    expect(r.state).toBe(s);
  });

  it('refuses a move the species cannot learn', () => {
    const notLearnable = MOVES.find((m) => !canLearn(668, m.id))!.id;
    expect(canLearn(668, notLearnable)).toBe(false);
    const s = asPyroar(withTm(notLearnable));
    const r = teach(s, notLearnable, null);
    expect(r.ok).toBe(false);
    expect(r.state.active!.moves).toEqual([]);
    expect(r.state.tms[notLearnable]).toBe(1); // TM not consumed
  });

  it('refuses a duplicate even when another copy of the TM is held', () => {
    const [id] = learnable();
    const first = teach(asPyroar(withTm(id)), id, null).state;
    const again = teach({ ...first, tms: { [id]: 1 } }, id, null);
    expect(again.ok).toBe(false);
    expect(again.state.active!.moves).toEqual([id]);
  });

  it('needs a slot once all four are full, and swaps exactly one', () => {
    const ids = learnable();
    let s = asPyroar(hunting());
    for (const id of ids.slice(0, MOVE_SLOTS)) {
      s = teach({ ...s, tms: { [id]: 1 } }, id, null).state;
    }
    expect(s.active!.moves).toHaveLength(MOVE_SLOTS);

    const fifth = ids[MOVE_SLOTS];
    const full = { ...s, tms: { [fifth]: 1 } };
    expect(teach(full, fifth, null).ok).toBe(false); // no slot given

    const swapped = teach(full, fifth, 1);
    expect(swapped.ok).toBe(true);
    expect(swapped.state.active!.moves).toHaveLength(MOVE_SLOTS);
    expect(swapped.state.active!.moves[1]).toBe(fifth);
    expect(swapped.state.active!.moves).not.toContain(s.active!.moves[1]);
    expect(swapped.message).toContain(moveById(s.active!.moves[1])!.ko);
  });

  it('rejects an out-of-range slot rather than growing the moveset', () => {
    const ids = learnable();
    let s = asPyroar(hunting());
    for (const id of ids.slice(0, MOVE_SLOTS)) {
      s = teach({ ...s, tms: { [id]: 1 } }, id, null).state;
    }
    for (const slot of [-1, MOVE_SLOTS, 1.5, NaN]) {
      expect(teach({ ...s, tms: { [ids[4]]: 1 } }, ids[4], slot).ok).toBe(false);
    }
  });

  it('makes hunting faster once moves are taught', () => {
    const ids = learnable();
    let s = asPyroar(hunting());
    const before = tick(s, 20).huntTokens;
    for (const id of ids.slice(0, MOVE_SLOTS)) {
      s = teach({ ...s, tms: { [id]: 1 } }, id, null).state;
    }
    expect(tick(s, 20).huntTokens).toBeGreaterThan(before);
  });

  /** 누르기 (physical) and 울부짖기 (status), both learnable by Pyroar. */
  const ATTACK = 34;
  const STATUS = 46;

  it('forgets by slot without refunding the TM', () => {
    let s = asPyroar(withTm(ATTACK));
    s = teach(s, ATTACK, null).state;
    s = teach({ ...s, tms: { [STATUS]: 1 } }, STATUS, null).state;
    expect(s.active!.moves).toEqual([ATTACK, STATUS]);

    const r = forget(s, 1);
    expect(r.ok).toBe(true);
    expect(r.state.active!.moves).toEqual([ATTACK]);
    expect(r.state.tms[STATUS]).toBeUndefined();
    // The slot is gone now, not merely empty — forget compacts.
    expect(forget(r.state, 1).ok).toBe(false);
  });

  it('will not let the last attack go', () => {
    // A companion holding nothing but status moves cannot hurt anything. Every
    // Pokemon hatches with an attack; this is what keeps it that way.
    let s = asPyroar(withTm(ATTACK));
    s = teach(s, ATTACK, null).state;
    s = teach({ ...s, tms: { [STATUS]: 1 } }, STATUS, null).state;

    const r = forget(s, 0);
    expect(r.ok).toBe(false);
    expect(r.state).toBe(s);
    expect(r.message).toMatch(/마지막 공격 기술/);
    // The status move beside it is still free to go.
    expect(forget(s, 1).ok).toBe(true);
  });

  it('will not let a status TM overwrite the last attack either', () => {
    // Four slots, exactly one of them an attack.
    let s = asPyroar(hunting({ tms: {} }));
    s = { ...s, active: { ...s.active!, moves: [ATTACK, 46, 104, 156] } };
    const another = 164; // 대타출동, status, learnable by Pyroar
    s = { ...s, tms: { [another]: 1 } };

    const onto = teach(s, another, 0);
    expect(onto.ok).toBe(false);
    expect(onto.state).toBe(s);
    expect(onto.message).toMatch(/마지막 공격 기술/);
    // Onto a status slot it goes through, and the TM is spent.
    const elsewhere = teach(s, another, 1);
    expect(elsewhere.ok).toBe(true);
    expect(elsewhere.state.active!.moves[1]).toBe(another);
  });

  it('lets one attack replace another', () => {
    let s = asPyroar(hunting({ tms: {} }));
    s = { ...s, active: { ...s.active!, moves: [ATTACK, 46, 104, 156] } };
    const other = 36; // 돌진, physical
    s = { ...s, tms: { [other]: 1 } };
    const r = teach(s, other, 0);
    expect(r.ok).toBe(true);
    expect(r.state.active!.moves[0]).toBe(other);
  });

  it('lists only TMs that are held, learnable and not already known', () => {
    const ids = learnable();
    const s = asPyroar(hunting({ tms: { [ids[0]]: 1, [ids[1]]: 2, 1: 1 } }));
    expect(teachableNow(s)).toEqual([ids[0], ids[1]].sort((a, b) => a - b));
    const taught = teach(s, ids[0], null).state;
    expect(teachableNow(taught)).toEqual([ids[1]]);
  });

  it('refuses everything while there is no companion', () => {
    const egg = base();
    expect(teach(egg, 63, null).ok).toBe(false);
    expect(forget(egg, 0).ok).toBe(false);
    expect(teachableNow(egg)).toEqual([]);
  });
});

describe('rarity table agreement', () => {
  it('uses the same buckets the rest of the game does', () => {
    expect(rarityOf(255)).toBe('common');
    expect(rarityOf(3)).toBe('legendary');
  });
});
