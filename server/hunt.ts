import { josa } from '../src/josa.ts';
import {
  BUCKET_WEIGHTS,
  battleFormOf,
  companionAbility,
  friendshipOf,
  hasDamaging,
  levelOf,
  isDamaging,
  mulberry32,
  rarityOf,
  rollSpecies,
  speciesIdOf,
  type GameState,
  type HuntEntry,
  type Rarity,
} from './game.ts';
import { formById, formsFrom } from './forms.ts';
import { battleAt, formOpts, BATTLE_MAX_HP, type Battle, type BattleOpts } from './fight.ts';
import { LEGEND_MOVES } from './legendmoves.ts';

/*
 * The battle itself lives in server/fight.ts. These names were exported from
 * here before it moved, and every caller that still imports them from here
 * keeps working.
 */
export {
  BATTLE_LEVEL,
  BATTLE_MAX_HP,
  GMAX_GUARD,
  GMAX_TURNS,
  MAX_TURNS,
  TACKLE,
  battleAt,
  battleStats,
  fightAt,
  foeOf,
  formOpts,
  mineOf,
  speciesStats,
} from './fight.ts';
export type {
  Battle,
  BattleEvent,
  BattleOpts,
  BattleStats,
  BattleTurn,
  Condition,
  EndEvent,
  Fight,
  Fighter,
  FieldView,
  RoundExit,
  SelfEffect,
  SkipReason,
} from './fight.ts';
import { canLearn, learnableMoves, moveById } from './moves.ts';
import type { ShopResult } from './shop.ts';
import { trainerAt, trainerBattleAt, trainerReward } from './trainer.ts';
import {
  leagueAt,
  regionById,
  LEAGUE_REWARD,
  atLeague,
  gymAt,
  gymReward,
  gymTrainer,
  leagueRoundAt,
  leagueStartAt,
} from './gyms.ts';
import { PARTY_SIZE } from './party.ts';
import { LINES } from './species.ts';
import { NO_DEEDS, deedsAfter, type Deeds } from './evolution.ts';
import { unlockedMoves } from './learnset.ts';
import { legendOf } from './legenddata.ts';
import {
  TIER_GRIT,
  droppableItems,
  gateOf,
  openLegends,
  shardableItems,
} from './legends.ts';

/** One encounter every five minutes of hunting. */
export const HUNT_INTERVAL_MS = 300_000;

/**
 * How much backlog a single tick may settle: eight hours.
 *
 * Closing the laptop overnight should not cost a whole night, but leaving the
 * app off for a month must not pay out a month either.
 */
export const HUNT_OFFLINE_CAP = 96;

/**
 * Hunting is capped as a share of tokens actually burned.
 *
 * Without this an idle machine graduates a companion roughly every six days and
 * fills the dex on its own, which inverts the premise of the app. For anyone
 * who codes, the ceiling grows faster than hunting can fill it, so it never
 * binds; for a machine left running it saturates and stops.
 */
export const HUNT_SHARE = 0.25;

/**
 * ...but always allow this much, in hatch thresholds.
 *
 * A brand-new install has earned nothing, so a pure share cap would make
 * hunting inert exactly when it is most wanted. This lets a fresh companion be
 * carried a little way by hunting alone before tokens have to take over.
 */
export const HUNT_FLOOR_MULT = 3;

/** Encounters that leave a TM behind. ~1 per 2 hours of continuous hunting. */
export const TM_DROP_CHANCE = 0.04;

/**
 * Chance a mega-capable wild Pokemon leaves its stone behind.
 *
 * Conditional, and that is where the real rarity lives: only about ninety
 * species have a mega at all, they are almost all final evolutions, and
 * `encounterAt` biases the wild roll toward unevolved forms with a squared
 * draw. So the effective rate is a small fraction of this number — measured in
 * test/stone.test.ts rather than guessed at, and roughly one stone per several
 * hours of hunting.
 *
 * There is no weighting table to go with it. Which stone can drop is decided by
 * which Pokemon turned up, which the encounter stream already answers.
 */
export const MEGA_STONE_DROP_CHANCE = 0.25;

/**
 * Chance a signature item falls out of an encounter, once its gate is cleared.
 *
 * Deliberately low and deliberately conditional. Nothing drops until the gate's
 * metric is met, so this is not "one in forty encounters" — it is one in forty
 * of the encounters that happen AFTER a bar most saves take days to reach. And
 * only the items whose gates are open are in the draw, so the first one arrives
 * far sooner than the twentieth.
 */
export const LEGEND_ITEM_DROP_CHANCE = 0.025;

/**
 * Chance a fragment falls, once a shard gate's bar is cleared.
 *
 * Higher than a whole item because twelve of these are one item — the effort is
 * in the count, not in the luck. At this rate and one encounter per five
 * minutes, a set is roughly twenty hours of hunting AFTER the bar.
 */
export const SHARD_DROP_CHANCE = 0.06;

/** Turns a legendary fight gets. Longer than a trainer round — it is the boss. */
export const LEGEND_TURNS = 6;

/**
 * Legendary battles seed from here, pushed far past any real encounter index
 * and past the trainers' own base, so no legendary fight can borrow a wild
 * battle's stream or a trainer round's.
 */
const LEGEND_SEED_BASE = 2_000_000_000;

/**
 * A legendary fight, as the hunt settles it and as the scene replays it.
 *
 * One function for both so the two cannot drift: the replay used to be simply
 * missing, and the scene, handed no turns, went straight to the faint — the
 * legendary fell over before anyone had moved, even on a fight that was lost.
 */
export function legendBattleAt(seq: number, speciesId: number, moves: readonly number[], opts: BattleOpts = {}): Battle {
  return battleAt(LEGEND_SEED_BASE + seq, 'legendary', [...moves], speciesId, {
    grit: TIER_GRIT[gateOf(speciesId)?.tier ?? 'sub'],
    foeMoves: LEGEND_MOVES[speciesId],
    ...opts,
  });
}

/**
 * Every line with no gated species in it.
 *
 * Built once. `substituteAt` draws from this so a substitution cannot hand back
 * a second locked legendary, which is what lets the caller skip a retry loop.
 */
const ORDINARY_LINES = LINES.filter((l) => !l.paths.some((p) => p.some((id) => legendOf(id))));

/** Classic. Learning a fifth move means forgetting one. */
export const MOVE_SLOTS = 4;

/**
 * Why the last attack cannot be dropped.
 *
 * A companion holding only status moves cannot hurt anything — the battle has a
 * plain-swing fallback so it is never stuck, but it is a bad way to play and
 * nothing on screen would explain it. Every Pokemon hatches with an attack
 * (see starterMove) and this is what keeps it that way.
 */
const LAST_ATTACK_REFUSAL = '마지막 공격 기술은 잊을 수 없습니다. 하나는 남겨두세요.';

/** How many encounters the panel remembers. Keeps state.json small. */
export const HUNT_LOG_MAX = 20;

/**
 * What a move with no power figure is worth as PRESSURE.
 *
 * For rating a moveset in `moveMult` only — NOT for what a swing hits for. A
 * status move spends its turn on an effect rather than on damage, and that
 * still makes hunting go faster.
 */
const STATUS_SWING = 35;

/**
 * Reward weight by the wild Pokemon's rarity.
 *
 * Raw numbers — they are normalised below so the EXPECTED reward is exactly 1.0
 * and the headline rate means what it says. Hand-tuning these to average one is
 * how an advertised 5%/hour quietly becomes 7%.
 */
const HUNT_REWARD: Record<Rarity, number> = {
  common: 0.65,
  uncommon: 1.1,
  rare: 1.9,
  legendary: 3.75,
};

const REWARD_MEAN =
  BUCKET_WEIGHTS.reduce((a, [r, w]) => a + HUNT_REWARD[r] * w, 0) /
  BUCKET_WEIGHTS.reduce((a, [, w]) => a + w, 0);

/**
 * Base payout per encounter, as a fraction of hatchThreshold.
 *
 * 12 encounters an hour x 1/240 = 5% of a hatch threshold per hour with no
 * moves taught, which is the "느긋하게" setting.
 */
const YIELD_DIV = 240;

/**
 * Seed for encounter `k`.
 *
 * Deliberately NOT the seed shape buildState uses for advance(), which is
 * `mulberry32(Math.floor(lifetimeTokens) ^ ...)`. huntTokens feeds
 * lifetimeTokens and is roughly linear in the encounter count, so an additive
 * seed here would be linearly correlated with the hatch seed — and correlated
 * mulberry32 seeds produce visibly correlated streams. Users would notice the
 * wild Pokemon they just fought being the one that hatched.
 */
function encounterRng(k: number): () => number {
  return mulberry32(Math.imul(k, 0x9e3779b1) ^ 0x85ebca6b);
}

/**
 * Tokens hunting is allowed to have contributed in total.
 *
 * A LIFETIME total, not a rate: `huntTokens` only ever grows, and graduating a
 * companion does not reset it. So this reads "everything hunting has ever
 * contributed must stay under a quarter of everything you earned" — which is
 * why someone who hunted heavily early can sit against it indefinitely.
 *
 * `Infinity` when the owner has turned the ceiling off. Every caller clamps
 * with Math.min against it, so infinity is the honest way to say "no clamp"
 * without a second code path. The panel prints it as 해제됨 rather than a number.
 */
export function huntCap(state: GameState): number {
  if (state.huntUncapped) return Number.POSITIVE_INFINITY;
  return Math.max(
    state.hatchThreshold * HUNT_FLOOR_MULT,
    Math.floor(state.lifetimeEarned * HUNT_SHARE),
  );
}

/**
 * How much a taught moveset speeds hunting up.
 *
 * Four slots put a hard ceiling on this, but clamp anyway so a future slot
 * count cannot turn into unbounded growth.
 */
export function moveMult(moves: number[]): number {
  const power = moves.reduce((a, id) => {
    const m = moveById(id);
    return a + (m ? m.power || STATUS_SWING : 0);
  }, 0);
  return Math.min(2, 1 + power / 600);
}

export type Encounter = {
  /** The species actually met, which may be an evolved form. */
  wildId: number;
  rarity: Rarity;
  /** Payout before the moveset multiplier and the cap. */
  reward: number;
  /** The TM left behind, as a move id, or null. */
  moveId: number | null;
};

/**
 * Resolve encounter `k`.
 *
 * Pure in (k, species, threshold). Nothing here reads the clock, the dex, or
 * any counter that `advance` mutates — that is what lets a lost write be
 * re-derived on the next tick instead of double-counted. In particular
 * `rollSpecies` gets an EMPTY exclude set: passing dex ids, as the hatch branch
 * does, would make an encounter depend on state that changes mid-pass.
 */
export function encounterAt(k: number, speciesId: number, hatchThreshold: number): Encounter {
  const rng = encounterRng(k);
  const line = rollSpecies(rng, new Set(), null);
  const path = line.paths[Math.floor(rng() * line.paths.length)];
  // Squared roll biases toward the unevolved form — most wild Pokemon are.
  const r = rng();
  const wildId = path[Math.floor(r * r * path.length)];
  const rarity = rarityOf(line.captureRate);

  const pool = learnableMoves(speciesId);
  const moveId =
    pool.length && rng() < TM_DROP_CHANCE ? pool[Math.floor(rng() * pool.length)] : null;

  return {
    wildId,
    rarity,
    reward: Math.round((hatchThreshold / YIELD_DIV) * (HUNT_REWARD[rarity] / REWARD_MEAN)),
    moveId,
  };
}

/**
 * A fifth RNG salt.
 *
 * The other four are the encounter roll, the battle roll, the hatch roll and
 * the trainer roll. Asking "did a stone drop?" must not change which Pokemon
 * was met, so it cannot borrow `encounterRng` — one extra draw inside
 * `encounterAt` would rewrite every encounter the app has ever produced, which
 * is exactly what the GOLDEN table in test/hunt.test.ts is there to catch.
 *
 * This is the same move `trainerAt` makes, for the same reason.
 */
function stoneRng(seq: number): () => number {
  return mulberry32(Math.imul(seq + 5, 0x7feb352d) ^ 0x846ca68b);
}

/**
 * The mega stone encounter `seq` leaves behind, as the form id it opens.
 *
 * Pure in (seq, wildId), so a replayed range hands back the same stones.
 * Returns null for the ~90% of species that have no mega at all — checked
 * before any draw, so species without one cost nothing.
 *
 * A species with two megas (Charizard X and Y) picks one at random. The stones
 * are separate items in the games too, and holding one should not silently hand
 * over the other.
 */
export function stoneAt(seq: number, wildId: number): number | null {
  const megas = formsFrom(wildId).filter((f) => f.kind === 'mega');
  if (!megas.length) return null;
  const rng = stoneRng(seq);
  if (rng() >= MEGA_STONE_DROP_CHANCE) return null;
  return megas[Math.floor(rng() * megas.length)].id;
}

/**
 * A sixth RNG salt: the legendary substitution and its item drops.
 *
 * Same reasoning as the fifth. Asking "is this species still locked, and did a
 * signature item fall out of the grass?" must not change which Pokemon the
 * encounter stream produced, so `encounterAt` and `rollSpecies` are not touched
 * at all — the substitution happens downstream, on the encounter's OUTPUT, and
 * the result is written onto the log entry so a replay reads the record rather
 * than recomputing it.
 *
 * `+ 7` rather than `+ 6`: the offsets are 0/1/3/5 today, and leaving a gap
 * keeps a future salt from landing on a neighbour's stream at small seq.
 */
function legendRng(seq: number): () => number {
  return mulberry32(Math.imul(seq + 7, 0x2c1b3c6d) ^ 0x165667b1);
}

/**
 * What turns up instead, when the roll produced a locked legendary.
 *
 * Pure in `seq`. Draws from the ordinary lines only, so a substitution can
 * never hand back a second locked species; the caller therefore needs no loop.
 *
 * Deliberately NOT weighted by rarity: this is the consolation for an encounter
 * that was going to be special and is not, and re-running the bucket ladder
 * here would just reproduce the 3% band the substitution exists to gate.
 */
export function substituteAt(seq: number): number {
  const rng = legendRng(seq);
  // One draw, from the pool of lines with no gated species in them.
  const line = ORDINARY_LINES[Math.floor(rng() * ORDINARY_LINES.length)];
  const path = line.paths[Math.floor(rng() * line.paths.length)];
  const r = rng();
  // Same squared bias `encounterAt` uses, so a substitute reads like a wild
  // encounter rather than like a different system's output.
  return path[Math.floor(r * r * path.length)];
}

/**
 * Whether a signature item fell out of this encounter.
 *
 * The candidate list comes from the caller — it is state-dependent (which gates
 * have been cleared) and so must be resolved once per batch, outside the loop.
 * Given the list, this is pure in `seq`.
 */
export function legendDropAt(seq: number, candidates: string[]): string | null {
  if (!candidates.length) return null;
  const rng = legendRng(seq);
  // Two draws already went into `substituteAt` for a different question; this
  // stream is private to legendaries so the extra length is harmless.
  rng();
  if (rng() >= LEGEND_ITEM_DROP_CHANCE) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}

/**
 * Whether a fragment fell out of this encounter, and of which item.
 *
 * Sibling of `legendDropAt` on the same private stream, one draw further along
 * so the two questions cannot answer alike. Fragments are commoner than a
 * finished item by design — twelve of them ARE the item, so the road is long
 * rather than lucky.
 */
export function shardDropAt(seq: number, candidates: string[]): string | null {
  if (!candidates.length) return null;
  const rng = legendRng(seq);
  rng();
  rng();
  rng();
  if (rng() >= SHARD_DROP_CHANCE) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}

/**
 * Settle every encounter that has come due since the last tick.
 *
 * ## Why this replays a cursor instead of accumulating elapsed time
 *
 * `buildState` is idempotent today, and quietly depends on it:
 * `npm run electron:dev` starts Vite AND Electron (scripts/dev-electron.mjs),
 * so opening localhost:5173 next to the tray app gives two independent 20s
 * pipelines writing one state.json. `accrue` survives that because it derives a
 * delta from a stored anchor, and `advance` is pure — both writers produce the
 * same bytes, so last-write-wins is a no-op.
 *
 * `huntTokens += f(now - huntedAt)` would break that. So instead the settled
 * range `[huntCount, huntCount + n)` is replayed from the encounter index: two
 * writers starting from the same saved state compute the same tokens, the same
 * TMs and the same log. A write that loses the race is simply re-derived.
 *
 * The one remaining non-idempotent field is `huntedAt`, and it is bounded: two
 * writers straddling a five-minute boundary differ by at most one encounter,
 * which the next tick settles anyway.
 */
export function hunt(state: GameState, now: number): { state: GameState; changed: boolean } {
  // No companion, no hunt: an egg cannot battle, and an everstone means the
  // companion is held exactly as it is — including its progress.
  const idle = !state.huntEnabled || state.everstone || !state.active;
  if (idle) {
    // Drop the anchor rather than letting a backlog build up while hunting is
    // off; re-enabling should start from that moment, not pay for the pause.
    if (state.huntedAt === null) return { state, changed: false };
    return { state: { ...state, huntedAt: null }, changed: true };
  }

  // First sight: anchor and award nothing, the same contract as accrue().
  if (state.huntedAt === null) return { state: { ...state, huntedAt: now }, changed: true };

  // The clock can go backwards — NTP correction, a timezone change, a restored
  // VM snapshot. Math.floor of a negative gap would walk huntCount and
  // huntTokens BACKWARDS. Re-anchor forward, never subtract.
  if (now < state.huntedAt) return { state: { ...state, huntedAt: now }, changed: true };

  const due = Math.floor((now - state.huntedAt) / HUNT_INTERVAL_MS);
  if (due < 1) return { state, changed: false };
  const n = Math.min(due, HUNT_OFFLINE_CAP);

  const active = state.active!;
  const speciesId = speciesIdOf(active);
  const cap = huntCap(state);
  const mult = moveMult(active.moves);
  /**
   * The form the companion wears for this whole batch.
   *
   * Read once, outside the loop: nothing this function writes can change the
   * answer, and re-asking per encounter would only invite that to stop being
   * true. It goes onto each entry so the panel replays what happened rather
   * than what the bag says right now.
   */
  const form = battleFormOf(state);
  const formTag = form ? { form: { id: form.id, kind: form.kind as 'mega' | 'gmax' } } : {};
  /** The permanent form, if fused. Contributes its types to every fight. */
  const worn = active.formId !== undefined ? formById(active.formId) : null;
  /** Friendship grows with the level; it is what 은혜갚기 reads. Recorded on `mine` for the replay. */
  const friendship = friendshipOf(active);
  /** Its ability — the mega's own while it is one. Recorded on `mine` so the replay fights with it too. */
  const ability = companionAbility(active, form?.id ?? worn?.id);
  const boosts = { ...formOpts(form, worn), myFriendship: friendship, myAbility: ability };
  // A mega swings 19% harder, so it earns 19% more from the same encounter.
  // A gigantamax earns nothing extra here on purpose — its base stats are
  // unchanged, and what it buys instead is surviving trainers.
  const formMult = form?.kind === 'mega' ? form.power : 1;
  /**
   * Who fought, recorded on every entry the companion fights.
   *
   * `buildState` runs `advance` between settling these fights and replaying
   * the newest one, so the fight that pays enough to evolve is replayed by the
   * evolved species unless the entry says otherwise — a different set of
   * stats, and very possibly a different winner.
   */
  const mine = { speciesId, moves: [...active.moves], friendship, ability };
  /** What the companion does in these fights, for the evolutions that ask. See server/evolution.ts. */
  let deeds: Deeds = active.deeds ?? NO_DEEDS();

  /**
   * The legendary picture for this batch, resolved once for the same reason
   * `form` above is: two processes settle the same range against one file and
   * can only agree if both read this from the same saved state. Re-asking
   * inside the loop would make the answer drift with what the loop itself is
   * writing.
   */
  const open = openLegends(state);
  const droppable = droppableItems(state);
  const shardable = shardableItems(state);
  const reserved = state.forcedNext ?? null;
  /**
   * Whether a named battle waits for an answer, and what is already waiting.
   *
   * Read here, once, for the same reason `reserved` and `form` are: two
   * processes settle the same range against one file and can only agree if both
   * read this from the saved state rather than from what the loop is writing.
   */
  const asks = state.askChallenge ?? true;

  const tms = { ...state.tms };
  const stones = { ...state.stones };
  const inventory = { ...state.inventory };
  const legendItems = { ...state.legendItems };
  const legendEggs = { ...state.legendEggs };
  const shards = { ...state.shards };
  let forcedNext = reserved;
  const fresh: HuntEntry[] = [];
  let gained = 0;
  /**
   * Lifetime tallies the rolling log cannot hold, counted here beside `gained`
   * for the same reason it is: this loop settles the range [huntCount, +n)
   * exactly once from a given saved state, so two writers racing the same file
   * compute the same number rather than each adding their own.
   */
  let wins = 0;
  let tmsFound = 0;
  /**
   * Badges held, MUTATED as the loop settles.
   *
   * The opposite treatment `openLegends` gets, and deliberately: nothing the
   * loop writes can change which legendaries are open, so that one is resolved
   * once and frozen. Badges are the other case — winning one closes that gym
   * for the rest of the batch, and freezing this would let the same leader be
   * fought three times in one catch-up. Deterministic either way, so two
   * writers settling the same range still compute identical bytes.
   */
  const badges = new Set(state.badges ?? []);
  let gymWon = 0;
  /**
   * Legendaries met in this batch, added to whatever the save already knew.
   *
   * Mutated in the loop like `badges`, and for the same reason: meeting one
   * opens its shrine, and a batch that met Palkia at its first encounter
   * should not go on pretending otherwise for the next ninety-five.
   */
  const metLegends = new Set(state.metLegends ?? []);
  /**
   * The league challenge, also mutated as the loop settles.
   *
   * A run spans five encounters, so unlike everything else in this loop it is
   * a thing the batch carries across iterations rather than a tally it adds
   * to. The party itself is read once and never written — the builder is the
   * only thing that changes it, and a catch-up that rewrote it would be
   * editing a choice the player made.
   */
  const party = state.party ?? [];
  let leagueRun = state.leagueRun ?? null;
  const leagues = { ...state.leagues };
  let leagueWins = state.leagueWins ?? 0;
  let leagueBest = state.leagueBest ?? 0;

  for (let i = 0; i < n; i++) {
    const seq = state.huntCount + i;
    const e = encounterAt(seq, speciesId, state.hatchThreshold);
    // Past the cap the encounter still happens and TMs still drop; only the
    // tokens stop. TM farming keeps working while the currency saturates.
    const room = () => Math.max(0, cap - (state.huntTokens + gained));

    /**
     * The Pokemon League, wherever this region holds it.
     *
     * Above the gym branch because the two cannot both apply — a plateau is
     * not a gym city, so the only leader who could stand here is a lateLock
     * one following the pet, and he follows only while his badge is missing,
     * which is exactly when the league is shut. `server/gyms.ts` asserts that
     * invariant at module load rather than leaving it as an argument.
     *
     * A run is one encounter per ladder member. It begins only at the three
     * offsets, and once begun every encounter of the leg is its next member —
     * so a visit holds about three attempts, and a loss costs the run rather
     * than the lap.
     *
     * `leagueAt` is what decides WHOSE ladder: a stop can hold two (석영고원
     * will hold Kanto's and Johto's) and only the badges held tell them apart.
     * A run already under way reads the region it RECORDED instead, for the
     * same reason the gym branch reads the id off the log entry — clearing one
     * league mid-batch flips what `leagueAt` answers, and a run must not
     * change ladders underneath itself.
     */
    const standing = leagueAt(seq, badges, leagues);
    if (standing && party.length === PARTY_SIZE) {
      /**
       * Starting is asked about; the run itself is not.
       *
       * A challenge is one encounter per ladder member and it is the shape of
       * the thing that it runs to its end — so the question is asked once, at
       * the door, and the five that follow settle as they always have. Asking
       * per member would turn one climb into five prompts and make a lost run
       * feel like five separate refusals.
       */
      if (!leagueRun && leagueStartAt(seq)) {
        if (!asks) {
          leagueRun = { at: 0, hp: party.map(() => BATTLE_MAX_HP), region: standing.id };
        }
      }
      const lg = (leagueRun?.region ? regionById(leagueRun.region) : null) ?? standing;
      if (leagueRun) {
        const member = lg.league[leagueRun.at];
        /** Snapshotted before the fight, so the panel can replay from it. */
        const startedFrom = [...leagueRun.hp];
        // No `boosts`: a mega belongs to the companion, and the companion is
        // not in this fight.
        const round = leagueRoundAt(seq, member, party, startedFrom);
        const at = leagueRun.at;
        const cleared = round.won && at + 1 === lg.league.length;
        // Per member, so a run that gets three deep is not worth nothing —
        // and a bonus on the clear, which is what the whole thing is for.
        const mult2 = (round.won ? 4 : 0) + (cleared ? LEAGUE_REWARD - 4 * lg.league.length : 0);
        const tokens = mult2 > 0 ? Math.min(room(), Math.round(e.reward * mult * mult2)) : 0;
        gained += tokens;
        if (round.won) {
          // An Elite Four member is a trainer, like a gym leader.
          wins += 1;
          leagueBest = Math.max(leagueBest, at + 1);
        }
        if (cleared) {
          leagues[lg.id] ??= now;
          leagueWins += 1;
          // The one item the league hands over. Outside huntCap, like every
          // other item, because an item is not progress.
          inventory['shiny-charm'] = (inventory['shiny-charm'] ?? 0) + 1;
        }
        // A loss ends the challenge; so does clearing it. Either way the next
        // start slot in this leg opens a fresh run at full HP.
        leagueRun = cleared || !round.won ? null : { at: at + 1, hp: round.hp, region: lg.id };
        fresh.push({
          seq,
          wildId: member.team[0],
          tokens,
          moveId: null,
          trainer: { name: member.ko, team: member.team, won: round.won },
          league: {
            id: member.id,
            at,
            region: lg.id,
            won: round.won,
            cleared,
            party: round.outFor.map((i) => party[i].speciesId),
            team: party.map((m) => m.speciesId),
            hp: startedFrom,
          },
        });
        continue;
      }
    }

    /**
     * A gym leader, if one is standing here.
     *
     * Above the trainer roll because the person in front of you is 관장 웅,
     * not 짧은바지 꼬마 민수 — and because the two are mutually exclusive by
     * construction, which is what lets a gym fight share `trainerBattleAt`'s
     * seed base without ever colliding with a route trainer's.
     *
     * `gymAt` takes no draw, so this asks the encounter stream nothing and
     * cannot shift it. See server/gyms.ts.
     */
    const gym = gymAt(seq, badges);
    /**
     * Ask rather than decide, when the rule says so and a badge is at stake.
     *
     * Nothing is WRITTEN here. The offer the panel shows is computed from
     * `(huntCount, badges, leagues)` by `pendingChallenge`, so this branch only
     * has to decline to fight — no bookkeeping, no refresh, nothing that can
     * drift. That is the whole reason the offer is derived rather than stored.
     *
     * It FALLS THROUGH rather than `continue`-ing: the encounter still happens,
     * so walking past a leader spends those five minutes on whatever else was
     * on that road rather than on nothing. The route trainer below may
     * therefore stand where a leader was standing, which is the honest reading
     * — you did not fight 관장 웅, so you did what you would have done anyway.
     * Skipping instead would tax three encounters a leg for being away.
     *
     * Only a FIRST win is asked about, and that is load-bearing. `gymAt`
     * returns a beaten leader at `REMATCH_OFFSET` for a spar that hands nothing
     * over, and that spar is the only thing that still moves `gymWins` once a
     * region is swept — which is what 도장깨기 measures. Gating it would make
     * that row unreachable for ever. `!badges.has` is the same condition the
     * branch below already uses to decide whether a badge changes hands, so
     * this adds no new concept.
     */
    if (gym && asks && !badges.has(gym.badge)) {
      // Deliberately empty: fall through to the roll below.
    } else if (gym) {
      const g = gymTrainer(gym);
      const fight = trainerBattleAt(seq, g, active.moves, speciesId, boosts);
      deeds = deedsAfter(deeds, fight.rounds, (r) => g.team[r.foeSlot]);
      /** A rematch pays, but the badge and its TM are handed over only once. */
      const first = !badges.has(gym.badge);
      const tokens = fight.won ? Math.min(room(), Math.round(e.reward * mult * gymReward(gym))) : 0;
      gained += tokens;
      if (fight.won) {
        // A gym win IS a trainer win. Leaving it out would make the awards
        // board understate the biggest trainer battles in the game from the
        // day they shipped, which is exactly the lie that file forbids.
        wins += 1;
        gymWon += 1;
        if (first) {
          badges.add(gym.badge);
          // The badge comes with its leader's machine, and it counts as found:
          // `tmsFound` measures the collection, not how it arrived.
          tms[gym.prize] = (tms[gym.prize] ?? 0) + 1;
          tmsFound += 1;
        }
      }
      fresh.push({
        seq,
        wildId: g.team[0],
        tokens,
        moveId: null,
        ...formTag,
        mine,
        trainer: { name: g.name, team: g.team, won: fight.won },
        gym: {
          id: gym.id,
          badge: fight.won && first ? gym.badge : null,
          prize: fight.won && first ? gym.prize : null,
        },
      });
      continue;
    }

    // A trainer rides on top of the wild roll rather than replacing it: the
    // encounter stream must keep producing exactly what it did before, or every
    // past encounter shifts.
    const t = trainerAt(seq);
    if (t) {
      const fight = trainerBattleAt(seq, t, active.moves, speciesId, boosts);
      deeds = deedsAfter(deeds, fight.rounds, (r) => t.team[r.foeSlot]);
      const prize = fight.won ? trainerReward(seq, t) : null;
      const tokens = prize ? Math.min(room(), Math.round(e.reward * mult * prize.payout)) : 0;
      gained += tokens;
      if (fight.won) wins += 1;
      // Items are not progress, so they sit outside huntCap entirely. This is
      // the first write to `inventory` that is not a purchase — the wallet is
      // untouched, but spentTokens and inventory can now disagree.
      if (prize?.item) inventory[prize.item] = (inventory[prize.item] ?? 0) + 1;
      fresh.push({
        seq,
        wildId: t.team[0],
        tokens,
        moveId: null,
        ...formTag,
        mine,
        trainer: {
          name: t.name,
          team: t.team,
          won: fight.won,
          ...(prize?.item ? { item: prize.item } : {}),
        },
      });
      continue;
    }

    /**
     * Which Pokemon this encounter actually shows.
     *
     * `encounterAt` is untouched — it still rolls whatever it always rolled, so
     * every past encounter and the GOLDEN table are exactly as they were. The
     * gate is applied to its OUTPUT, the way a stone drop is, and the answer is
     * written onto the entry below so a replay reads the record.
     *
     * A reservation made with a signature item outranks the roll, and only for
     * the one encounter index it named.
     */
    const claimed = forcedNext && forcedNext.seq === seq ? forcedNext.speciesId : null;
    const rolled = claimed ?? e.wildId;
    const locked = !claimed && !!legendOf(rolled) && !open.has(rolled);
    const wildId = locked ? substituteAt(seq) : rolled;
    if (claimed) forcedNext = null;

    const legend = legendOf(wildId);
    if (legend) {
      /**
       * A legendary is a trainer-shaped fight: no HP floor, so it can be lost.
       * Composed from `battleAt` for the same reason a trainer round is — the
       * wild guarantees (a felling last turn, MAX_TURNS, the global turn index)
       * would all have to break to fold this into one battle.
       */
      const fight = legendBattleAt(seq, wildId, active.moves, { mySpeciesId: speciesId, ...boosts });
      deeds = deedsAfter(deeds, [fight], () => wildId);
      const won = fight.won;
      // Met, whatever happened next. The shrine opens on the meeting rather
      // than on the win — a Giratina that flattened you was still met, and
      // `server/shrines.ts` is the only thing that reads this.
      metLegends.add(wildId);
      // The prize is an egg, never a dex entry: the dex still means "raised and
      // graduated", and a legendary is not exempt from that.
      if (won) legendEggs[wildId] = (legendEggs[wildId] ?? 0) + 1;
      // A reservation is spent whether or not the fight went well. Losing has
      // to cost something or the battle is decoration.
      const tokens = won ? Math.min(room(), Math.round(e.reward * mult * formMult * 4)) : 0;
      gained += tokens;
      fresh.push({
        seq,
        wildId,
        tokens,
        moveId: null,
        ...formTag,
        mine,
        legend: { speciesId: wildId, won },
      });
      continue;
    }

    /**
     * The wild fight itself, settled here rather than only replayed.
     *
     * It can be lost: nothing props the companion up any more, so a Caterpie
     * that walks into a Dragonite goes home with nothing. A loss pays no
     * tokens and drops nothing — no machine, no stone, no signature item, no
     * fragment. The drop rolls are still ASKED for either way, so which
     * encounter drops what never depends on who won.
     */
    const wild = battleAt(seq, e.rarity, active.moves, wildId, { mySpeciesId: speciesId, ...boosts });
    deeds = deedsAfter(deeds, [wild], () => wildId);
    const won = wild.won;
    const tokens = won ? Math.min(room(), Math.round(e.reward * mult * formMult)) : 0;
    gained += tokens;
    const moveId = won ? e.moveId : null;
    if (moveId !== null) {
      tms[moveId] = (tms[moveId] ?? 0) + 1;
      tmsFound += 1;
    }
    // Stones sit outside huntCap, like every other item: the ceiling is on
    // progress, and a stone is not progress.
    const rolledStone = stoneAt(seq, wildId);
    const stoneId = won ? rolledStone : null;
    if (stoneId !== null) stones[stoneId] = (stones[stoneId] ?? 0) + 1;
    // A signature item, from the gates whose bar has already been cleared.
    // Outside huntCap for the same reason every other item is.
    const rolledDrop = legendDropAt(seq, droppable);
    const drop = won ? rolledDrop : null;
    if (drop !== null) legendItems[drop] = (legendItems[drop] ?? 0) + 1;
    // Fragments, for the gates whose item is only ever assembled. Kept off the
    // log entry: twelve of them is a lot of rows to say the same thing, and the
    // bag counts them anyway.
    const rolledShard = shardDropAt(seq, shardable);
    const shard = won ? rolledShard : null;
    if (shard !== null) shards[shard] = (shards[shard] ?? 0) + 1;
    fresh.push({
      seq,
      wildId,
      tokens,
      moveId,
      won,
      mine,
      ...(stoneId !== null ? { stoneId } : {}),
      ...(drop !== null ? { legendItem: drop } : {}),
      ...formTag,
    });
  }

  return {
    state: {
      ...state,
      active: { ...active, deeds },
      huntTokens: state.huntTokens + gained,
      huntCount: state.huntCount + n,
      trainerWins: (state.trainerWins ?? 0) + wins,
      gymWins: (state.gymWins ?? 0) + gymWon,
      badges: [...badges].sort((a, b) => a - b),
      metLegends: [...metLegends].sort((a, b) => a - b),
      // A challenge does not survive leaving 석영고원: it is something you
      // finish where you started it, and a run resumed a lap later against a
      // party that has since been rebuilt is not the run that was begun.
      leagueRun: atLeague(state.huntCount + n - 1) ? leagueRun : null,
      leagues,
      leagueWins,
      leagueBest,
      tmsFound: (state.tmsFound ?? 0) + tmsFound,
      // Advance by the FULL backlog, not by n. Advancing by n instead would
      // hand the forfeited remainder straight back on the following tick,
      // which would make the offline cap decorative.
      huntedAt: state.huntedAt + due * HUNT_INTERVAL_MS,
      tms,
      stones,
      inventory,
      legendItems,
      legendEggs,
      shards,
      forcedNext,
      huntLog: [...fresh.reverse(), ...state.huntLog].slice(0, HUNT_LOG_MAX),
    },
    changed: true,
  };
}

/** The most recent encounters, newest first. */
export function recentHunts(state: GameState, n = HUNT_LOG_MAX): HuntEntry[] {
  return state.huntLog.slice(0, n);
}

/**
 * Teach a held TM.
 *
 * `slot` picks which move to overwrite and is required once all four slots are
 * full. Same ShopResult contract as the shop: never throws, returns the
 * unchanged state on refusal, message is what the user reads.
 */
export function teach(state: GameState, moveId: number, slot: number | null): ShopResult {
  const active = state.active;
  if (!active) return { state, ok: false, message: '아직 포켓몬이 없습니다.' };

  const move = moveById(moveId);
  if (!move) return { state, ok: false, message: '없는 기술입니다.' };
  if ((state.tms[moveId] ?? 0) < 1) return { state, ok: false, message: '그 기술머신이 없습니다.' };

  const speciesId = active.pathIds[active.stageIndex];
  if (!canLearn(speciesId, moveId)) {
    return { state, ok: false, message: `${move.ko}${josa(move.ko, '은', '는')} 배울 수 없는 기술입니다.` };
  }
  if (active.moves.includes(moveId)) {
    return { state, ok: false, message: `이미 ${move.ko}${josa(move.ko, '을', '를')} 배웠습니다.` };
  }

  const moves = [...active.moves];
  let replaced: number | null = null;
  if (moves.length < MOVE_SLOTS) {
    moves.push(moveId);
  } else {
    if (slot == null || !Number.isInteger(slot) || slot < 0 || slot >= MOVE_SLOTS) {
      return { state, ok: false, message: '기술이 4개라 하나를 잊어야 합니다.' };
    }
    replaced = moves[slot];
    // Overwriting the only attack with a status move would leave the companion
    // unable to hurt anything. Swapping one attack for another is fine.
    if (isDamaging(moveById(replaced)) && !isDamaging(move) && !hasDamaging(moves.filter((_, i) => i !== slot))) {
      return { state, ok: false, message: LAST_ATTACK_REFUSAL };
    }
    moves[slot] = moveId;
  }

  const tms = { ...state.tms };
  const left = (tms[moveId] ?? 0) - 1;
  if (left > 0) tms[moveId] = left;
  else delete tms[moveId];

  const forgotten = replaced === null ? null : moveById(replaced);
  return {
    state: { ...state, tms, active: { ...active, moves } },
    ok: true,
    message: forgotten
      ? `${forgotten.ko}${josa(forgotten.ko, '을', '를')} 잊고 ${move.ko}${josa(move.ko, '을', '를')} 배웠습니다!`
      : `${move.ko}${josa(move.ko, '을', '를')} 배웠습니다!`,
  };
}

/**
 * Put a level-up move the companion has learned back into its moveset.
 *
 * Free, as the games' move reminder is by now: the move was never a TM, and
 * the companion already knows it — `unlockedMoves` says which. `slot` picks the
 * move to forget once all four are full, the same contract `teach` has.
 */
export function relearn(state: GameState, moveId: number, slot: number | null, lifetime: number): ShopResult {
  const active = state.active;
  if (!active) return { state, ok: false, message: '아직 포켓몬이 없습니다.' };
  const move = moveById(moveId);
  if (!move) return { state, ok: false, message: '없는 기술입니다.' };
  const level = levelOf(active, lifetime, state.hatchThreshold);
  if (!unlockedMoves(active.pathIds, active.stageIndex, level).includes(moveId)) {
    return { state, ok: false, message: `${move.ko}${josa(move.ko, '은', '는')} 아직 배우지 않은 기술입니다.` };
  }
  if (active.moves.includes(moveId)) {
    return { state, ok: false, message: `이미 ${move.ko}${josa(move.ko, '을', '를')} 알고 있습니다.` };
  }
  const moves = [...active.moves];
  let replaced: number | null = null;
  if (moves.length < MOVE_SLOTS) {
    moves.push(moveId);
  } else {
    if (slot == null || !Number.isInteger(slot) || slot < 0 || slot >= MOVE_SLOTS) {
      return { state, ok: false, message: '기술이 4개라 하나를 잊어야 합니다.' };
    }
    replaced = moves[slot];
    if (isDamaging(moveById(replaced)) && !isDamaging(move) && !hasDamaging(moves.filter((_, i) => i !== slot))) {
      return { state, ok: false, message: LAST_ATTACK_REFUSAL };
    }
    moves[slot] = moveId;
  }
  const forgotten = replaced === null ? null : moveById(replaced);
  return {
    state: { ...state, active: { ...active, moves } },
    ok: true,
    message: forgotten
      ? `${forgotten.ko}${josa(forgotten.ko, '을', '를')} 잊고 ${move.ko}${josa(move.ko, '을', '를')} 다시 떠올렸습니다!`
      : `${move.ko}${josa(move.ko, '을', '를')} 다시 떠올렸습니다!`,
  };
}

/** Forget the move in `slot`. The TM is not refunded — it was consumed. */
export function forget(state: GameState, slot: number): ShopResult {
  const active = state.active;
  if (!active) return { state, ok: false, message: '아직 포켓몬이 없습니다.' };
  if (!Number.isInteger(slot) || slot < 0 || slot >= active.moves.length) {
    return { state, ok: false, message: '없는 기술 칸입니다.' };
  }
  const move = moveById(active.moves[slot]);
  const moves = active.moves.filter((_, i) => i !== slot);
  // Same floor as teach: something in there has to be able to hit.
  if (isDamaging(move) && !hasDamaging(moves)) {
    return { state, ok: false, message: LAST_ATTACK_REFUSAL };
  }
  const gone = move?.ko ?? '기술';
  return {
    state: { ...state, active: { ...active, moves } },
    ok: true,
    message: `${gone}${josa(gone, '을', '를')} 잊었습니다.`,
  };
}

/**
 * Toggle the share ceiling.
 *
 * Turning it off does not hand back anything already forfeited — the tokens an
 * encounter did not pay were never recorded, and inventing them now would mean
 * guessing how long the cap had been binding. It only stops the clamp from here.
 */
export function setHuntUncapped(state: GameState, off: boolean): ShopResult {
  if (state.huntUncapped === off) {
    return { state, ok: true, message: off ? '사냥 상한이 해제되어 있습니다.' : '사냥 상한이 걸려 있습니다.' };
  }
  return {
    state: { ...state, huntUncapped: off },
    ok: true,
    message: off ? '사냥 상한을 해제했습니다.' : '사냥 상한을 다시 켰습니다.',
  };
}

/** Toggle auto-hunting. Turning it off drops the anchor on the next tick. */
export function setHuntEnabled(state: GameState, on: boolean): ShopResult {
  if (state.huntEnabled === on) {
    return { state, ok: true, message: on ? '자동사냥 중입니다.' : '자동사냥을 껐습니다.' };
  }
  return {
    state: { ...state, huntEnabled: on },
    ok: true,
    message: on ? '자동사냥을 켰습니다.' : '자동사냥을 껐습니다.',
  };
}

/** Every move this companion could still learn, given the TMs on hand. */
export function teachableNow(state: GameState): number[] {
  const active = state.active;
  if (!active) return [];
  const speciesId = active.pathIds[active.stageIndex];
  return Object.keys(state.tms)
    .map(Number)
    .filter((id) => (state.tms[id] ?? 0) > 0 && canLearn(speciesId, id) && !active.moves.includes(id))
    .sort((a, b) => a - b);
}
