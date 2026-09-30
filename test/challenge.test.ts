import { describe, expect, it } from 'vitest';
import { levelUpMoves, moveById } from '../server/moves.ts';
import { HUNT_INTERVAL_MS, HUNT_OFFLINE_CAP, encounterAt, hunt, huntCap } from '../server/hunt.ts';
import { advance, initialState, mulberry32, type GameState } from '../server/game.ts';
import { migrate } from '../server/store.ts';
import {
  CHALLENGE_TRIES,
  challengeAction,
  legOf,
  pendingChallenge,
  pendingId,
  setAskChallenge,
} from '../server/challenge.ts';
import { KANTO, gymAt, gymById, standingGym } from '../server/gyms.ts';
import { LEG_LENGTH, STOPS } from '../src/journey.ts';

const LAP = STOPS.length * LEG_LENGTH;

const H = 10_000_000;
const T0 = 1_700_000_000_000;

const base = (over: Partial<GameState> = {}): GameState => ({
  ...initialState(),
  hatchThreshold: H,
  ...over,
});

/** A hatched companion, hunting, with asking ON — the new default. */
const hunting = (over: Partial<GameState> = {}): GameState => {
  const hatched = armed(advance(base({ lifetimeEarned: H }), H, mulberry32(1)).state);
  return { ...hatched, lifetimeEarned: 1_000_000_000, huntedAt: T0, ...over };
};

const settle = (s: GameState, n: number) => hunt(s, T0 + n * HUNT_INTERVAL_MS).state;

/**
 * The encounter 웅 first stands at — DERIVED.
 *
 * The route is generated and this moved once already. Anything here that pins
 * an encounter index has to compute it or it rots on the next `gen:journey`.
 */
const FIRST = (() => {
  const none = new Set<number>();
  for (let k = 0; k < 20_000; k++) if (gymAt(k, none)) return k;
  throw new Error('no gym stands in the first 20,000 encounters');
})();

/** Standing in front of 웅, asked rather than settled. */
const asked = (over: Partial<GameState> = {}) => hunting({ huntCount: FIRST, ...over });

/**
 * Armed the way a companion walking gym to gym is: its four strongest moves
 * learned by Lv.50. A fresh hatchling knows its Lv.1 moves and nothing else,
 * and these tests are about how a named battle is settled, not about whether a
 * newborn can take a leader.
 */
const armed = (s: GameState): GameState => {
  const a = s.active!;
  const moves = [...new Set(levelUpMoves(a.pathIds[a.stageIndex]).filter(([lv]) => lv <= 50).map(([, id]) => id))]
    .map((id) => moveById(id)!)
    .filter((m) => m.power > 0 && ![153, 120, 63, 416].includes(m.id))
    .sort((x, y) => y.power - x.power)
    .slice(0, 4)
    .map((m) => m.id);
  return { ...s, active: { ...a, moves } };
};

describe('the offer', () => {
  it('is there when a leader stands and asking is on', () => {
    const p = pendingChallenge(asked());
    expect(p).not.toBeNull();
    expect(p!.kind).toBe('gym');
    expect(pendingId(p!)).toBe('brock');
    expect(p!.left).toBe(CHALLENGE_TRIES);
  });

  it('is absent when asking is off', () => {
    expect(pendingChallenge(asked({ askChallenge: false }))).toBeNull();
  });

  it('is absent when hunting cannot happen at all', () => {
    expect(pendingChallenge(asked({ huntEnabled: false }))).toBeNull();
    expect(pendingChallenge(asked({ everstone: true }))).toBeNull();
    expect(pendingChallenge(asked({ active: null }))).toBeNull();
  });

  it('is absent once the badge is held', () => {
    // A rematch is never asked about; it is the only thing that still moves
    // gymWins once a region is swept, which 도장깨기 measures.
    expect(pendingChallenge(asked({ badges: [1] }))).toBeNull();
  });

  it('is derived, so it needs nothing stored and cannot go stale', () => {
    // The whole point of not storing it: an ancient record from a leg long past
    // is inert by arithmetic, with no clearing code anywhere.
    const s = asked({ challenge: { leg: 0, used: CHALLENGE_TRIES, declined: true } });
    expect(legOf(s.huntCount)).toBeGreaterThan(0);
    expect(pendingChallenge(s)).not.toBeNull();
  });
});

describe('hunt() with asking on', () => {
  it('does not fight the leader, and does not record anything either', () => {
    const s = settle(asked(), 6);
    expect(s.badges).toEqual([]);
    expect(s.huntLog.some((e) => e.gym)).toBe(false);
    // Nothing is written: the offer is computed, so hunt() has no bookkeeping.
    expect(s.challenge ?? null).toBeNull();
  });

  it('still pays the encounter rather than skipping it', () => {
    // Falling through instead of `continue` is what keeps walking past a leader
    // from taxing three encounters a leg for being away.
    const asking = settle(asked(), 6);
    const auto = settle(asked({ askChallenge: false }), 6);
    expect(asking.huntLog).toHaveLength(6);
    expect(auto.huntLog).toHaveLength(6);
    expect(asking.huntTokens).toBeGreaterThan(0);
  });

  it('leaves exactly one question after a catch-up inside his city', () => {
    // The invariant the single slot exists for: the same leader stands three
    // times in one leg, and a catch-up across all three still asks once.
    let stands = 0;
    const none = new Set<number>();
    for (let k = FIRST; k < FIRST + LEG_LENGTH; k++) if (gymAt(k, none)?.id === 'brock') stands++;
    expect(stands).toBe(3);

    const s = settle(asked(), 10);
    const p = pendingChallenge(s);
    expect(p).not.toBeNull();
    expect(pendingId(p!)).toBe('brock');
  });

  it('does not follow the pet out of his city', () => {
    // The bug this replaced: with no badge held, 웅 used to stand at every
    // later Kanto stop. Walk on past 회색시티 and he is gone.
    const s = settle(asked(), HUNT_OFFLINE_CAP);
    const p = pendingChallenge(s);
    expect(p === null || pendingId(p) !== 'brock').toBe(true);
  });

  it('still settles a rematch on its own', () => {
    const s = settle(asked({ badges: KANTO.gyms.map((g) => g.badge) }), 200);
    expect(s.gymWins ?? 0).toBeGreaterThan(0);
  });

  it('stays idempotent', () => {
    const s = asked();
    expect(settle(s, 12)).toEqual(settle(s, 12));
  });

  it('does not disturb the wild encounter stream', () => {
    for (let k = FIRST; k < FIRST + 400; k++) {
      const before = encounterAt(k, 668, H);
      pendingChallenge(asked({ huntCount: k }));
      expect(encounterAt(k, 668, H), `seq ${k}`).toEqual(before);
    }
  });
});

describe('accepting', () => {
  it('fights on the spot and hands the badge over', () => {
    const s = asked();
    const r = challengeAction(s, 'accept:brock', T0);
    expect(r.ok).toBe(true);
    expect(r.state.huntLog[0].gym?.id).toBe('brock');
    expect(r.state.huntLog[0].trainer?.name).toBe('관장 웅');
    // The fixture's companion wins this one; if grit ever moves, assert on the
    // recorded outcome rather than on a win.
    if (r.state.huntLog[0].trainer!.won) {
      expect(r.state.badges).toEqual([1]);
      expect(r.state.tms[gymById('brock')!.prize]).toBe(1);
      expect(r.state.gymWins).toBe(1);
      expect(r.state.trainerWins).toBe(1);
    }
  });

  it('stamps the entry as the NEWEST encounter', () => {
    /**
     * The condition the scene replays on. `src/Scene.tsx` and `src/PetApp.tsx`
     * both bail when `huntLog[0].seq` is not greater than the last one they
     * played, so an entry stamped with a past encounter would be silently
     * skipped and the battle would never reach the screen. This is why
     * accepting spends the cursor rather than reusing the offer's index.
     */
    const s = settle(asked(), 4);
    const before = Math.max(...s.huntLog.map((e) => e.seq));
    const r = challengeAction(s, 'accept:brock', T0 + 4 * HUNT_INTERVAL_MS);
    expect(r.ok).toBe(true);
    expect(r.state.huntLog[0].seq).toBeGreaterThan(before);
    expect(r.state.huntCount).toBe(s.huntCount + 1);
    expect(r.state.huntLog[0].seq).toBe(r.state.huntCount - 1);
  });

  it('settles an owed backlog first, so the fight stays the newest entry', () => {
    // Three encounters are due but no poll has settled them. Accepting must
    // not leave them for the next buildState to stack on top of the fight —
    // the scene replays huntLog[0] only, and the badge would change hands off
    // screen.
    const s = asked();
    const now = T0 + 3 * HUNT_INTERVAL_MS;
    const r = challengeAction(s, 'accept:brock', now);
    expect(r.ok).toBe(true);
    expect(r.state.huntLog[0].gym?.id).toBe('brock');
    expect(hunt(r.state, now).state.huntLog[0].gym?.id).toBe('brock');
  });

  it('keeps the outcome out of its reply', () => {
    // The panel used to toast "회색배지를 받았습니다!" before the battle had
    // started playing. The scene tells the result; the reply only says a
    // challenge was made, whichever way it went.
    const r = challengeAction(asked(), 'accept:brock', T0);
    expect(r.message).toBe('관장 웅에게 승부를 걸었습니다!');
  });

  it('never leaves the clock ahead of now', () => {
    // A future anchor trips hunt()'s backwards-clock guard, which would
    // re-anchor to now and hand the five minutes straight back.
    const s = asked();
    const r = challengeAction(s, 'accept:brock', T0);
    expect(r.state.huntedAt!).toBeLessThanOrEqual(T0);
  });

  it('records what fought, so a replay cannot narrate somebody else', () => {
    const s = asked();
    const r = challengeAction(s, 'accept:brock', T0);
    expect(r.state.huntLog[0].mine?.speciesId).toBeDefined();
    expect(r.state.huntLog[0].mine?.moves).toEqual(s.active!.moves);
  });

  it('pays no more than the cap leaves', () => {
    const s = asked({ huntTokens: huntCap(asked()) });
    const r = challengeAction(s, 'accept:brock', T0);
    expect(r.state.huntLog[0].tokens).toBe(0);
    expect(r.state.huntTokens).toBe(s.huntTokens);
  });

  it('spends an attempt, and runs out after the third', () => {
    let s: GameState = asked();
    for (let i = 0; i < CHALLENGE_TRIES; i++) {
      const p = pendingChallenge(s);
      expect(p, `try ${i}`).not.toBeNull();
      // Keep him unbeaten so the offer is only ever closed by the cap.
      s = { ...challengeAction(s, 'accept:brock', T0).state, badges: [] };
    }
    expect(pendingChallenge(s)).toBeNull();
  });

  it('refuses when nobody is standing, and when the wrong leader is named', () => {
    expect(challengeAction(hunting({ huntCount: 0 }), 'accept:brock', T0).ok).toBe(false);
    const bad = challengeAction(asked(), 'accept:misty', T0);
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain('웅');
  });

  it('slides a legendary reservation off the encounter it just spent', () => {
    /**
     * `hunt()` claims `forcedNext` by an exact seq match, so a reservation left
     * pointing at an index the cursor has passed is never claimed and never
     * cleared — and `spendLegendItem` then refuses every later reservation for
     * ever. Accepting must not create that.
     */
    const s = asked({ forcedNext: { seq: FIRST, speciesId: 150 } });
    const r = challengeAction(s, 'accept:brock', T0);
    expect(r.state.forcedNext).toEqual({ seq: FIRST + 1, speciesId: 150 });
    expect(r.state.forcedNext!.seq).toBeGreaterThanOrEqual(r.state.huntCount);
  });
});

describe('declining', () => {
  it('goes quiet for that leg and asks again in the next one', () => {
    const s = asked();
    const r = challengeAction(s, 'decline', T0);
    expect(r.ok).toBe(true);
    expect(r.state.challenge).toEqual({ leg: legOf(FIRST), used: 0, declined: true });
    expect(pendingChallenge(r.state)).toBeNull();
    // One leg on the pet is in the next town, and he is not there.
    const next = { ...r.state, huntCount: FIRST + LEG_LENGTH };
    expect(standingGym(next.huntCount, new Set())?.id).not.toBe('brock');
    // A lap on it is back in 회색시티, and he is entitled to ask again.
    const lap = { ...r.state, huntCount: FIRST + LAP };
    expect(standingGym(lap.huntCount, new Set())?.id).toBe('brock');
    expect(pendingChallenge(lap)).not.toBeNull();
  });

  it('refuses when there is nothing to refuse', () => {
    expect(challengeAction(hunting({ huntCount: 0 }), 'decline', T0).ok).toBe(false);
  });
});

describe('the setting', () => {
  it('returns the same object when it is already where it is asked to be', () => {
    const s = asked();
    const r = setAskChallenge(s, true);
    expect(r.ok).toBe(false);
    expect(r.state).toBe(s);
  });

  it('drops a refusal on the way to automatic, so nothing lingers', () => {
    const s = asked({ challenge: { leg: legOf(FIRST), used: 1, declined: true } });
    const r = setAskChallenge(s, false);
    expect(r.ok).toBe(true);
    expect(r.state.challenge).toBeNull();
    expect(pendingChallenge(r.state)).toBeNull();
  });
});

describe('the save', () => {
  it('starts an older save asking', () => {
    const old = { ...base(), askChallenge: undefined, challenge: undefined };
    expect(migrate(JSON.parse(JSON.stringify(old))).askChallenge).toBe(true);
  });

  it('survives a reload, and refuses nonsense', () => {
    const s = asked({ challenge: { leg: 4, used: 2, declined: true } });
    const back = migrate(JSON.parse(JSON.stringify(s)));
    expect(back.challenge).toEqual({ leg: 4, used: 2, declined: true });
    expect(back.askChallenge).toBe(true);

    const junk = migrate(
      JSON.parse(JSON.stringify({ ...s, challenge: { leg: 'x', used: null } })),
    );
    expect(junk.challenge).toBeNull();
  });

  it('keeps schemaVersion where it was', () => {
    expect(migrate(JSON.parse(JSON.stringify(asked()))).schemaVersion).toBe(4);
  });
});
