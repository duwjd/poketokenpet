import { josa } from '../src/josa.ts';
import { LEG_LENGTH } from '../src/journey.ts';
import { battleFormOf, speciesIdOf, type GameState, type HuntEntry } from './game.ts';
import { formById } from './forms.ts';
import {
  GYM_OFFSETS,
  LEAGUE_REWARD,
  gymReward,
  gymTrainer,
  leagueAt,
  leagueRoundAt,
  standingGym,
  type GymRow,
  type RegionRow,
} from './gyms.ts';
import {
  BATTLE_MAX_HP,
  HUNT_INTERVAL_MS,
  HUNT_LOG_MAX,
  encounterAt,
  formOpts,
  hunt,
  huntCap,
  moveMult,
} from './hunt.ts';
import { PARTY_SIZE } from './party.ts';
import type { ShopResult } from './shop.ts';
import { trainerBattleAt } from './trainer.ts';

/**
 * The named battles the player is asked about, and the answering of them.
 *
 * ── Why this module exists ────────────────────────────────────────────────
 * A gym fight was decided inside `hunt()`, which settles while the app is
 * closed. So the one fight in this game with a badge on it was the one fight
 * nobody could watch: the panel replays only `huntLog[0]`, the log keeps twenty
 * of up to ninety-six settled encounters, and the scene arms silently on the
 * first payload. Three conditions had to coincide, and usually they did not.
 *
 * The fix is not to make the settlement loop wait — it cannot. `huntCount` is a
 * one-way contiguous cursor with no "unsettled" state, and `hunt()` returns
 * nothing to do until an interval has elapsed, so "resolve it on the next tick"
 * means "up to five minutes from now". The fix is to let the loop DECLINE to
 * fight and to resolve the fight here, from a button, where it can be seen.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * ## The offer is derived, never stored
 *
 * Who is standing, which badge is at stake and where: all pure functions of
 * `(huntCount, badges, leagues)`, through `standingGym` and `leagueAt`, neither
 * of which takes a draw. Storing that would make copies that drift, and keeping
 * them true would mean refresh logic — which is exactly the shape of
 * `forcedNext`, whose stored `seq` has no expiry and no withdrawal and jams the
 * whole feature the moment the cursor passes it. Only the player's ANSWER is
 * written down, in `state.challenge`.
 *
 * ## What accepting costs
 *
 * One encounter. `seq` is `state.huntCount` and the cursor advances by one,
 * which is not bookkeeping for its own sake: `src/Scene.tsx` and
 * `src/PetApp.tsx` both decide whether to play by comparing `huntLog[0].seq`
 * against the last one they played, so an entry stamped with a PAST encounter
 * would be silently skipped and the battle would never reach the screen. Taking
 * the next index makes the entry strictly newest, and every existing replay
 * path then works with no change at all.
 *
 * ## Why this is not in hunt.ts
 *
 * `hunt()`'s contract is that it is a pure function of `(saved state, now)` —
 * two dev pipelines settle one file with no lock and stay safe only because
 * both compute identical bytes. Accepting is a user action, so it belongs on
 * the action path beside `buy` and `teach`, which already race the same way and
 * recover the same way: press it again.
 */

/** A leader or a ladder standing in front of the player right now. */
export type Pending =
  | { kind: 'gym'; row: GymRow; left: number }
  | { kind: 'league'; region: RegionRow; left: number };

/**
 * How many times a leg lets the player answer.
 *
 * The same number of attempts auto-hunting gets at a leader in one leg. Without
 * it, choosing to watch a fight would also mean retrying it until it is won —
 * and every gym is meant to be losable, which is what the `grit` column is
 * measured against.
 */
export const CHALLENGE_TRIES = GYM_OFFSETS.length;

/** The leg an encounter index falls in. Monotone, unlike a stop index. */
export const legOf = (seq: number): number =>
  Math.floor(Math.max(0, Math.floor(seq)) / LEG_LENGTH);

/** Attempts left in this leg, given what has already been spent. */
function triesLeft(state: GameState): number {
  const rec = state.challenge;
  const leg = legOf(state.huntCount);
  if (!rec || rec.leg !== leg) return CHALLENGE_TRIES;
  if (rec.declined) return 0;
  return Math.max(0, CHALLENGE_TRIES - rec.used);
}

/**
 * The battle waiting for an answer, or null.
 *
 * Keyed on `standingGym` rather than on `gymAt`, and deliberately: `gymAt` opens
 * three five-minute windows in a leg, which is the right cadence for a fight
 * the app picks on its own and the wrong one for a question a person has to
 * notice. This stays true for the whole leg — an hour and a quarter — and the
 * attempt cap is what keeps the balance `GYM_OFFSETS` was pacing.
 */
export function pendingChallenge(state: GameState): Pending | null {
  if (!(state.askChallenge ?? true)) return null;
  // The same conditions that make hunting idle make a challenge impossible:
  // no companion to send out, hunting switched off, or an everstone on.
  if (!state.active || !state.huntEnabled || state.everstone) return null;
  const left = triesLeft(state);
  if (left <= 0) return null;

  const badges = new Set(state.badges ?? []);
  const seq = state.huntCount;

  /**
   * The league first, though the two can never both apply — no region's league
   * city is any region's gym city, and `server/gyms.ts` asserts that at module
   * load. Ordered anyway so the answer does not depend on the order of two
   * lookups that happen to be mutually exclusive today.
   */
  const league = leagueAt(seq, badges, state.leagues ?? {});
  if (league && (state.party ?? []).length === PARTY_SIZE && !state.leagueRun) {
    /**
     * Only if the leg still has room for the whole ladder.
     *
     * `LEAGUE_OFFSETS`' last slot is chosen so an automatic run begun there
     * ends on the final encounter before the pet walks off the plateau, and
     * `hunt()` wipes a run that leaves. A button that could be pressed at any
     * point in the leg would otherwise let someone start a climb they cannot
     * finish and lose it one member in.
     */
    const room = LEG_LENGTH - (seq % LEG_LENGTH);
    if (room >= league.league.length) return { kind: 'league', region: league, left };
  }

  const gym = standingGym(seq, badges);
  // A rematch is never asked about — see the note on `askChallenge` in game.ts.
  if (gym && !badges.has(gym.badge)) return { kind: 'gym', row: gym, left };
  return null;
}

/** The id the panel shows, and the one an accept has to name back. */
export function pendingId(p: Pending): string {
  return p.kind === 'gym' ? p.row.id : p.region.id;
}

/** The name the panel prints. */
export function pendingKo(p: Pending): string {
  return p.kind === 'gym' ? gymTrainer(p.row).name : `${p.region.leagueKind} 도전`;
}

/**
 * Spend one encounter on the accepted battle.
 *
 * Shared by both kinds so the cursor, the clock and the log can only be
 * advanced one way. `huntedAt` moves with `huntCount` because the fight took
 * that encounter's five minutes, and it is clamped to `now` so it can never be
 * future-dated — a future anchor trips `hunt()`'s backwards-clock guard on the
 * next tick, which would re-anchor to `now` and hand the time straight back.
 */
function spendEncounter(state: GameState, entry: HuntEntry, now: number, gained: number) {
  /**
   * A reservation that named this very encounter has to move with it.
   *
   * `hunt()` claims `forcedNext` by an exact `seq` match, so a reservation left
   * pointing at an index the cursor has passed is never claimed and never
   * cleared — and `spendLegendItem` then refuses every later reservation for
   * ever. Sliding it forward one is the whole fix.
   */
  const forcedNext =
    state.forcedNext && state.forcedNext.seq === state.huntCount
      ? { ...state.forcedNext, seq: state.huntCount + 1 }
      : (state.forcedNext ?? null);

  return {
    ...state,
    huntCount: state.huntCount + 1,
    huntTokens: state.huntTokens + gained,
    huntedAt:
      state.huntedAt === null ? null : Math.min(now, state.huntedAt + HUNT_INTERVAL_MS),
    forcedNext,
    huntLog: [entry, ...state.huntLog].slice(0, HUNT_LOG_MAX),
    challenge: { leg: legOf(state.huntCount), used: CHALLENGE_TRIES - triesLeft(state) + 1 },
  };
}

/**
 * Accept or refuse the battle on offer.
 *
 * `id` is `accept:<id>` or `decline`. The accept names who the player was
 * looking at, and a mismatch is refused rather than silently fought: the offer
 * is derived, so a poll landing between the render and the click can change
 * who is standing. The same equality-claim discipline `hunt()` applies to
 * `forcedNext`, applied to intent.
 */
export function challengeAction(given: GameState, id: string, now: number): ShopResult {
  /**
   * Settle whatever encounters are already due BEFORE spending one on this.
   *
   * The panel replays `huntLog[0]` only. If a backlog were still owed — the
   * lid was shut, the poll has not landed yet — the next `buildState` would
   * settle it on top of this fight and push it off the top of the log, and the
   * badge would change hands with nothing on screen. Settling first also
   * re-asks who is standing against where the pet really is, which the
   * mismatch check below then holds the click to.
   */
  const state = hunt(given, now).state;
  const p = pendingChallenge(state);
  if (!p) return { state, ok: false, message: '지금은 걸어온 승부가 없습니다.' };

  if (id === 'decline') {
    return {
      state: {
        ...state,
        challenge: { leg: legOf(state.huntCount), used: CHALLENGE_TRIES - triesLeft(state), declined: true },
      },
      ok: true,
      message: `${pendingKo(p)}${josa(pendingKo(p), '을', '를')} 지나쳤습니다.`,
    };
  }

  const [verb, named] = id.split(':');
  if (verb !== 'accept') return { state, ok: false, message: '알 수 없는 요청입니다.' };
  if (named && named !== pendingId(p)) {
    return { state, ok: false, message: `지금 서 있는 건 ${pendingKo(p)}입니다.` };
  }

  const active = state.active!;
  const speciesId = speciesIdOf(active);
  const seq = state.huntCount;
  const e = encounterAt(seq, speciesId, state.hatchThreshold);
  const mult = moveMult(active.moves);
  const form = battleFormOf(state);
  const formTag = form ? { form: { id: form.id, kind: form.kind as 'mega' | 'gmax' } } : {};
  const worn = active.formId !== undefined ? formById(active.formId) : null;
  const boosts = formOpts(form, worn);
  const room = Math.max(0, huntCap(state) - state.huntTokens);
  /**
   * What fought, recorded for the same reason `form` is.
   *
   * An accepted fight can pay enough progress to evolve the companion inside
   * the very `buildState` pass that first replays it — `hunt` runs, then
   * `advance`, then the payload — and `trainerFor` re-derives the battle from
   * the LIVE moveset. Without this the panel would narrate a different fight
   * than the one that handed over the badge.
   */
  const mine = { speciesId, moves: [...active.moves] };

  if (p.kind === 'gym') {
    const row = p.row;
    const g = gymTrainer(row);
    const fight = trainerBattleAt(seq, g, active.moves, speciesId, boosts);
    const first = !new Set(state.badges ?? []).has(row.badge);
    const tokens = fight.won ? Math.min(room, Math.round(e.reward * mult * gymReward(row))) : 0;

    const badges = new Set(state.badges ?? []);
    const tms = { ...state.tms };
    let tmsFound = state.tmsFound ?? 0;
    if (fight.won && first) {
      badges.add(row.badge);
      tms[row.prize] = (tms[row.prize] ?? 0) + 1;
      tmsFound += 1;
    }

    const entry: HuntEntry = {
      seq,
      wildId: g.team[0],
      tokens,
      moveId: null,
      ...formTag,
      mine,
      trainer: { name: g.name, team: g.team, won: fight.won },
      gym: {
        id: row.id,
        badge: fight.won && first ? row.badge : null,
        prize: fight.won && first ? row.prize : null,
      },
    };

    const out = spendEncounter(
      {
        ...state,
        badges: [...badges].sort((a, b) => a - b),
        tms,
        tmsFound,
        trainerWins: (state.trainerWins ?? 0) + (fight.won ? 1 : 0),
        gymWins: (state.gymWins ?? 0) + (fight.won ? 1 : 0),
      },
      entry,
      now,
      tokens,
    );
    // Deliberately says nothing about how it went. The fight has already
    // been decided, but the panel is about to PLAY it, and a toast that said
    // "회색배지를 받았습니다!" before the first Pokemon is out is the spoiler
    // this reply used to be. The scene carries the outcome.
    return { state: out, ok: true, message: `${g.name}에게 승부를 걸었습니다!` };
  }

  // The league. The first member is fought here so there is something to
  // watch; the rest settle on the cadence, because a climb running to its end
  // is the shape of the thing.
  const region = p.region;
  const party = state.party ?? [];
  const startHp = party.map(() => BATTLE_MAX_HP);
  const member = region.league[0];
  const round = leagueRoundAt(seq, member, party, startHp);
  const cleared = round.won && region.league.length === 1;
  const mult2 = (round.won ? 4 : 0) + (cleared ? LEAGUE_REWARD - 4 * region.league.length : 0);
  const tokens = mult2 > 0 ? Math.min(room, Math.round(e.reward * mult * mult2)) : 0;

  const entry: HuntEntry = {
    seq,
    wildId: member.team[0],
    tokens,
    moveId: null,
    trainer: { name: member.ko, team: member.team, won: round.won },
    league: {
      id: member.id,
      at: 0,
      region: region.id,
      won: round.won,
      cleared,
      party: round.outFor.map((i) => party[i].speciesId),
      team: party.map((m) => m.speciesId),
      hp: startHp,
    },
  };

  const out = spendEncounter(
    {
      ...state,
      trainerWins: (state.trainerWins ?? 0) + (round.won ? 1 : 0),
      leagueBest: Math.max(state.leagueBest ?? 0, round.won ? 1 : 0),
      leagueRun: round.won && !cleared ? { at: 1, hp: round.hp, region: region.id } : null,
    },
    entry,
    now,
    tokens,
  );
  // Neutral for the same reason the gym reply is: the scene tells the result.
  return { state: out, ok: true, message: `${member.ko}에게 승부를 걸었습니다!` };
}

/**
 * Toggle the ask-first rule.
 *
 * A no-op returns the SAME object reference, which `test/hunt.test.ts` asserts
 * of `setHuntUncapped` and which keeps a redundant press from writing the file.
 */
export function setAskChallenge(state: GameState, on: boolean): ShopResult {
  if ((state.askChallenge ?? true) === on) {
    return { state, ok: false, message: on ? '이미 물어봅니다.' : '이미 자동입니다.' };
  }
  return {
    state: { ...state, askChallenge: on, ...(on ? {} : { challenge: null }) },
    ok: true,
    message: on ? '승부를 물어봅니다.' : '승부를 자동으로 받습니다.',
  };
}
