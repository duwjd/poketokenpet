import { describe, expect, it } from 'vitest';
import {
  advance,
  initialState,
  lifetimeOf,
  mulberry32,
  rarityOf,
  type GameState,
  type Rarity,
} from '../server/game.ts';
import { LINES } from '../server/species.ts';
import { formById } from '../server/forms.ts';
import { MOVES, canLearn, learnableMoves, moveById, speciesInfo } from '../server/moves.ts';
import {
  HUNT_INTERVAL_MS,
  MAX_TURNS,
  HUNT_OFFLINE_CAP,
  MOVE_SLOTS,
  battleAt,
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
    expect(tick(s, 1).huntTokens).toBeGreaterThan(0);
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
  });

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

  it('lands on the advertised rate on a bare moveset', () => {
    // About 5% of a hatch threshold per hour from wild encounters, plus a
    // little from trainers, plus a little more since every companion now
    // hatches knowing one attack. "Bare" no longer means empty; nothing is
    // ever empty.
    //
    // Measured at 8.10%, where it was 6.05%. The gap is the gym leaders: this
    // samples encounters 0 to 4,800, which is Kanto and the start of Johto,
    // and a badge fight pays twice a route trainer's formula. It is real
    // income in the stretch it happens, and `huntCap` still holds the ceiling
    // — so the band moves rather than the numbers.
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
    expect(mean).toBeGreaterThan(0.055);
    expect(mean).toBeLessThan(0.100);
  });
});

describe('battleAt', () => {
  const strong = [63, 53, 89, 87]; // Hyper Beam, Flamethrower, Earthquake, Thunder

  /**
   * The companion's half of the fight, frozen.
   *
   * Rows are [moveId, damage, crit, missed, effect, foeHpAfter]. Booleans are
   * 0/1 so a row stays one short line.
   *
   * ## Four of these are compatibility anchors
   *
   * `0`, `5`, `7` and `13` are the cases where the type chart has nothing to
   * say — no foe species at all, or a Normal one every move is neutral against,
   * or no moveset to choose from. Every weight is therefore exactly 1, and
   * `pickWeighted` turns an all-ones draw back into the uniform index it
   * replaced. These were captured before the opponent had a moveset of its own
   * and they have not moved since. NONE OF THEM MAY MOVE. If one does, either a
   * draw leaked into the companion's stream or an entry for 1 crept into
   * MATCHUP_WEIGHT, and every battle the app has ever shown just changed
   * underneath it.
   *
   * ## Two were re-recorded on purpose
   *
   * `42` and `91` are the rows with a real matchup, and they are what the
   * chart-aware pick was FOR. Against Gyarados the companion now leads with
   * Thunder at 4x instead of spreading its picks over a 0.5x Flamethrower and a
   * 0x Earthquake; against Gastly it no longer opens with a Normal move that
   * does nothing at all. Both fights got shorter, which is the reward for a
   * good matchup and is deliberate: `foeMaxHp` is sized off `swingPower`, which
   * stays chart-blind.
   *
   * That cost this table the coverage it used to carry — 42's immune turn and
   * 91's immune opener are now rare by design. Do not tune them back. The two
   * tests named for that coverage below own it instead, where the next
   * re-record cannot quietly take it away again.
   *
   * 13 is still untaught, 5 is still a single-move set long enough to reach
   * MAX_TURNS, and three rows still carry a miss.
   */
  const GOLDEN: [string, { foeMaxHp: number; turns: (number | null)[][] }][] = [
    ['0-common-strong', {"foeMaxHp":498,"turns":[[53,135,1,0,1,363],[63,165,0,0,1,198],[53,97,0,0,1,101],[89,88,0,0,1,13],[53,116,1,0,1,0]]}],
    ['7-rare-strong-19', {"foeMaxHp":643,"turns":[[63,136,0,0,1,507],[89,145,1,0,1,362],[63,243,1,0,1,119],[89,93,0,0,1,26],[87,106,0,0,1,0]]}],
    ['42-legendary-strong-130', {"foeMaxHp":809,"turns":[[87,445,0,0,4,364],[87,0,0,1,4,364],[87,428,0,0,4,1],[87,0,0,1,4,1],[87,379,0,0,4,0]]}],
    ['13-uncommon-bare-19', {"foeMaxHp":234,"turns":[[null,46,0,0,1,188],[null,37,0,0,1,151],[null,65,1,0,1,86],[null,45,0,0,1,41],[null,60,1,0,1,0]]}],
    ['5-legendary-hyper', {"foeMaxHp":1220,"turns":[[63,165,0,0,1,1055],[63,163,0,0,1,892],[63,238,1,0,1,654],[63,0,0,1,1,654],[63,159,0,0,1,495],[63,139,0,0,1,356],[63,138,0,0,1,218],[63,218,0,0,1,0]]}],
    ['91-common-strong-92', {"foeMaxHp":450,"turns":[[53,81,0,0,1,369],[89,227,0,0,2,142],[87,111,0,0,1,31],[89,329,1,0,2,0]]}],
  ];

  const GOLDEN_ARGS: Record<string, [number, Rarity, number[], number | undefined]> = {
    '0-common-strong': [0, 'common', strong, undefined],
    '7-rare-strong-19': [7, 'rare', strong, 19],
    '42-legendary-strong-130': [42, 'legendary', strong, 130],
    '13-uncommon-bare-19': [13, 'uncommon', [], 19],
    '5-legendary-hyper': [5, 'legendary', [63], undefined],
    '91-common-strong-92': [91, 'common', strong, 92],
  };

  it('has not moved the companion half of any recorded fight', () => {
    for (const [label, want] of GOLDEN) {
      const [seq, rarity, moves, foe] = GOLDEN_ARGS[label];
      const b = battleAt(seq, rarity, moves, foe);
      expect(b.foeMaxHp, label).toBe(want.foeMaxHp);
      expect(
        b.turns.map((t) => [t.moveId, t.damage, t.crit ? 1 : 0, t.missed ? 1 : 0, t.effect, t.foeHpAfter]),
        label,
      ).toEqual(want.turns);
    }
  });

  it('is a pure function of the encounter index', () => {
    for (const k of [0, 3, 91, 5000]) {
      expect(battleAt(k, 'rare', strong)).toEqual(battleAt(k, 'rare', strong));
    }
  });

  it('always ends with the opponent down', () => {
    for (const rarity of ['common', 'uncommon', 'rare', 'legendary'] as const) {
      for (let k = 0; k < 400; k++) {
        const b = battleAt(k, rarity, k % 2 ? strong : []);
        expect(b.turns.at(-1)!.foeHpAfter, `${rarity}/${k}`).toBe(0);
        expect(b.turns.length).toBeLessThanOrEqual(MAX_TURNS);
        expect(b.turns.length).toBeGreaterThan(0);
      }
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

  it('keeps the fight the same length however strong the moveset gets', () => {
    // A fixed HP pool meant a good moveset one-shot everything common. Scaling
    // the opponent to the companion's own damage is what fixes that.
    const mean = (moves: number[]) => {
      let t = 0;
      for (let k = 0; k < 600; k++) t += battleAt(k, 'uncommon', moves).turns.length;
      return t / 600;
    };
    expect(Math.abs(mean(strong) - mean([]))).toBeLessThan(1);
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
    // Something happened, though — Agility is a setup move.
    expect(b.turns[0].selfEffect).toBe('boost');
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

  it('keeps a landed status standing for the rest of the fight', () => {
    // The plate badge reads this. An ailment is news once and a condition after.
    const b = battleAt(5, 'rare', [86, 53], 19, { mySpeciesId: 25 });
    const at = b.turns.findIndex((t) => t.ailment === 'paralysis');
    expect(at).toBeGreaterThanOrEqual(0);
    for (let i = at; i < b.turns.length; i++) {
      expect(b.turns[i].foeStatus, `turn ${i}`).toBe('paralysis');
    }
    // And nothing before it.
    for (let i = 0; i < at; i++) expect(b.turns[i].foeStatus).toBeNull();
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

  it('still fells the opponent when nothing in the moveset can hit', () => {
    // Four setup moves deal nothing all fight. The finisher swaps in the plain
    // swing so the battle cannot stall, and the pool never sizes to zero.
    const allStatus = [14, 97, 86, 92];
    for (let k = 0; k < 300; k++) {
      const b = battleAt(k, 'legendary', allStatus, 130, { mySpeciesId: 6 });
      expect(b.foeMaxHp, `${k}`).toBeGreaterThan(0);
      expect(b.turns.length).toBeGreaterThan(0);
      expect(b.turns.length).toBeLessThanOrEqual(MAX_TURNS);
      expect(b.turns.at(-1)!.foeHpAfter).toBe(0);
      // The felling blow is never a status move.
      expect(b.turns.at(-1)!.moveId).toBeNull();
    }
  });

  it('never lets a lingering ailment be the thing that fells', () => {
    for (let k = 0; k < 400; k++) {
      const b = battleAt(k, 'rare', [92, 53], 19, { mySpeciesId: 25 });
      b.turns.forEach((t, i) => {
        if (i < b.turns.length - 1) expect(t.foeHpAfter, `${k}/${i}`).toBeGreaterThan(0);
      });
    }
  });

  it('lets the wild one hit back, but never past the floor', () => {
    let sawCounter = false;
    for (let k = 0; k < 500; k++) {
      const b = battleAt(k, 'legendary', strong);
      for (const t of b.turns) {
        if (t.counter > 0) sawCounter = true;
        expect(t.myHpAfter).toBeGreaterThan(0);
        expect(t.myHpAfter).toBeLessThanOrEqual(b.myMaxHp);
      }
      // The felling blow draws no counter.
      expect(b.turns.at(-1)!.counter).toBe(0);
    }
    expect(sawCounter).toBe(true);
  });

  it('only lets the opponent use moves its species could be taught', () => {
    let picks = 0;
    let stab = 0;
    for (let k = 0; k < 2000; k++) {
      const foe = 1 + ((k * 7919) % 1025);
      const legal = new Set(learnableMoves(foe));
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
        for (const t of battleAt(k, 'rare', strong, foe, { mySpeciesId: 25 }).turns) {
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
      for (const t of battleAt(k, 'rare', withToxic, 227, { mySpeciesId: 25 }).turns) {
        picks.set(t.moveId, (picks.get(t.moveId) ?? 0) + 1);
        total++;
      }
    }
    const toxic = (picks.get(92) ?? 0) / total;
    const quake = (picks.get(89) ?? 0) / total;
    expect(toxic).toBeGreaterThan(0.1);
    expect(toxic).toBeGreaterThan(quake * 5);
  });

  /**
   * Termination, when the chart says every single option is pointless.
   *
   * Four Normal moves against a Ghost. Every weight is the 0x floor, so the
   * draw still resolves; every turn but the last deals nothing; and the finisher
   * — which ignores the chart and cannot miss — is what ends it.
   */
  it('ends even when everything it knows is immune', () => {
    const normalOnly = [63, 70, 36, 5];
    for (let k = 0; k < 300; k++) {
      const b = battleAt(k, 'rare', normalOnly, 92, { mySpeciesId: 25 });
      expect(b.turns.length, `${k}`).toBeLessThanOrEqual(MAX_TURNS);
      expect(b.turns.at(-1)!.foeHpAfter, `${k}`).toBe(0);
      for (const t of b.turns.slice(0, -1)) {
        expect(t.effect, `${k}`).toBe(0);
        expect(t.damage, `${k}`).toBe(0);
      }
    }
  });

  /**
   * A good matchup really does end the fight sooner.
   *
   * `foeMaxHp` is drawn from `swingPower`, which is chart-blind, so the pool is
   * the same size whoever is standing in it. Sizing it to the chart-aware swing
   * instead would cancel the whole feature — the fight would simply be
   * re-lengthened to the same six turns and picking well would buy nothing.
   */
  it('does not re-size the opponent to cancel a good matchup', () => {
    for (const k of [0, 7, 42, 91, 500]) {
      const sized = battleAt(k, 'rare', strong).foeMaxHp;
      expect(battleAt(k, 'rare', strong, 130).foeMaxHp, `${k}`).toBe(sized);
      expect(battleAt(k, 'rare', strong, 92).foeMaxHp, `${k}`).toBe(sized);
    }
  });

  it('falls back to a plain swing for a species with no attacking machine move', () => {
    // Ditto learns nothing from a machine at all.
    for (const t of battleAt(4, 'common', strong, 132, { mySpeciesId: 6 }).turns) {
      expect(t.foeMoveId).toBeNull();
    }
  });

  it('gives the opponent a turn on every exchange but the one it goes down on', () => {
    for (let k = 0; k < 300; k++) {
      const b = battleAt(k, 'legendary', strong, 130, { mySpeciesId: 6 });
      b.turns.forEach((t, i) => {
        expect(t.foeActed, `${k}/${i}`).toBe(i < b.turns.length - 1);
      });
      const last = b.turns.at(-1)!;
      expect(last.foeMoveId).toBeNull();
      expect(last.counter).toBe(0);
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

  it('keeps the counter inside the envelope it was tuned in', () => {
    // The foe's move varies its damage; it must not run away with it. The mean
    // is what trainer balance was measured against.
    //
    // `sum / n > 0` used to be the whole assertion here, which was blind to the
    // one thing that can actually go wrong: the opponent now avoids the moves
    // that do nothing to me, so it hits for more on average. That is a PRICE,
    // paid on purpose and measured — 30.9 -> 33.4 HP a swing, about +8% — and
    // the band below is what stops the next tweak to FOE_MATCHUP_WEIGHT
    // spending more of it without anyone noticing. The dial for this is that
    // table, never foeMult or FOE_MULT_MAX.
    let sum = 0;
    let n = 0;
    let sawZero = false;
    let sawBig = false;
    for (let k = 0; k < 1500; k++) {
      const foe = 1 + ((k * 7919) % 1025);
      const me = 1 + ((k * 104729) % 1025);
      const b = battleAt(k, 'rare', strong, foe, { mySpeciesId: me });
      for (const t of b.turns) {
        if (!t.foeActed) continue;
        n++;
        sum += t.counter;
        if (t.counter === 0) sawZero = true;
        if (t.foeEffect > 1) sawBig = true;
        // Ceiling: FOE_MULT_MAX 2.5, times the 1.3 top of the jitter.
        expect(t.counter, `${foe}/${me}`).toBeLessThanOrEqual(Math.ceil(b.myMaxHp * 2.5 * 1.3));
      }
    }
    expect(n).toBeGreaterThan(2000);
    // An immune matchup really is zero, not the old Math.max(1, ...).
    expect(sawZero).toBe(true);
    expect(sawBig).toBe(true);
    expect(sum / n).toBeGreaterThan(32);
    expect(sum / n).toBeLessThan(35);
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
      for (const t of battleAt(k, 'rare', strong, foe, { mySpeciesId: me }).turns) {
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
        if (t.foeActed && t.foeEffect === 0) expect(t.counter).toBe(0);
        if (t.foeActed && t.foeEffect > 0) expect(t.counter).toBeGreaterThan(0);
      }
    }
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

  /**
   * The one invariant that matters most here.
   *
   * Every form option multiplies a number that has ALREADY been drawn, so a
   * battle fought with the identity values has to be the very same battle,
   * turn for turn. If this fails, an option took a draw and every past
   * encounter just changed — which is what the GOLDEN table above would then
   * also catch, more loudly and less usefully.
   */
  it('changes nothing at their defaults', () => {
    for (const seq of [0, 7, 42, 91]) {
      const plain = battleAt(seq, 'rare', strong, 19);
      const identity = battleAt(seq, 'rare', strong, 19, {
        myPower: 1,
        counterMult: 1,
        counterMultTurns: Infinity,
      });
      expect(identity).toEqual(plain);
    }
  });

  it('gives a fused companion its own type chart, and nothing else', () => {
    // A fusion is not a battle transformation — it is what this Pokemon now is.
    // Without this a fused Necrozma reads Psychic/Steel on the panel and fights
    // as plain Psychic, which is a lie the type chart tells.
    const dusk = formById(10155)!;
    expect(dusk.kind).toBe('fusion');
    expect(formOpts(null, dusk)).toEqual({ myTypes: dusk.types });

    // And a battle form on top of it wins: that is the shape actually swinging.
    const ultra = formById(10157)!;
    expect(formOpts(ultra, dusk).myTypes).toEqual(ultra.types);
    expect(formOpts(ultra, dusk).myPower).toBe(ultra.power);
  });

  it('does nothing when no form is worn', () => {
    expect(formOpts(null)).toEqual({});
    for (const seq of [0, 7, 42]) {
      expect(battleAt(seq, 'rare', strong, 19, formOpts(null))).toEqual(
        battleAt(seq, 'rare', strong, 19),
      );
    }
  });

  it('lets a mega hit harder and so end the fight sooner', () => {
    const opts = formOpts(formById(MEGA_ZARD_X));
    expect(opts.myPower).toBeGreaterThan(1);
    // The opponent's pool is sized to the untouched swing, deliberately, so the
    // extra damage really does buy turns rather than being sized back out.
    const plain = battleAt(3, 'rare', strong, 19);
    const mega = battleAt(3, 'rare', strong, 19, opts);
    expect(mega.foeMaxHp).toBe(plain.foeMaxHp);
    expect(mega.turns[0].damage).toBeGreaterThan(plain.turns[0].damage);
    expect(mega.turns.length).toBeLessThanOrEqual(plain.turns.length);
  });

  it('gives a mega its own type chart', () => {
    // Mega Charizard X is Fire/Dragon, which the base species is not.
    expect(formOpts(formById(MEGA_ZARD_X)).myTypes).toEqual(['fire', 'dragon']);
  });

  it('asks a gigantamax for toughness rather than power', () => {
    const opts = formOpts(formById(GMAX_ZARD));
    expect(opts.myPower).toBeUndefined(); // no stat change, as in the games
    expect(opts.counterMult).toBe(0.5);
    expect(opts.counterMultTurns).toBe(3);
  });

  it('halves incoming damage for exactly three turns', () => {
    // The guard on its own, with no type override — the chart is tested above,
    // and mixing the two hides one behind the other. (It did: Charizard's
    // Fire/Flying doubles one counter, which cancelled the halving exactly.)
    const args = { floor: false, counterHit: 20, budget: MAX_TURNS } as const;
    const plain = battleAt(11, 'rare', [], 19, args);
    const big = battleAt(11, 'rare', [], 19, {
      ...args,
      counterMult: 0.5,
      counterMultTurns: 3,
    });
    const took = (b: typeof plain, i: number) => b.turns[i]?.counter ?? 0;
    // Turn 0 can be a 1-point floor either way, so compare where there is room.
    for (let i = 0; i < 3; i++) {
      if (took(plain, i) > 2) expect(took(big, i)).toBeLessThan(took(plain, i));
    }
    // And once it lapses the numbers line back up exactly, because nothing else
    // about the fight differs.
    for (let i = 3; i < plain.turns.length; i++) {
      expect(took(big, i)).toBe(took(plain, i));
    }
  });

  it('is worth turns in a fight that can actually be lost', () => {
    const args = { floor: false, counterHit: 20, budget: MAX_TURNS } as const;
    const plain = battleAt(11, 'rare', [], 19, args);
    const big = battleAt(11, 'rare', [], 19, { ...args, counterMult: 0.5, counterMultTurns: 3 });
    // The point of the whole thing: it stands up longer against a trainer.
    expect(big.turns.length).toBeGreaterThan(plain.turns.length);
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
