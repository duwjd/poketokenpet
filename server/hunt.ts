import { josa } from '../src/josa.ts';
import {
  BUCKET_WEIGHTS,
  battleFormOf,
  hasDamaging,
  isDamaging,
  mulberry32,
  rarityOf,
  rollSpecies,
  speciesIdOf,
  type GameState,
  type HuntEntry,
  type Rarity,
} from './game.ts';
import { formById, formsFrom, type Form } from './forms.ts';
import {
  canLearn,
  effectiveness,
  learnableMoves,
  moveById,
  speciesInfo,
  TYPES,
  type Ailment,
  type MoveInfo,
  type MoveType,
} from './moves.ts';
import type { ShopResult } from './shop.ts';
import { trainerAt, trainerBattleAt, trainerReward } from './trainer.ts';
import { LINES } from './species.ts';
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
 * For sizing the opponent's pool and rating a moveset — NOT for what a swing
 * hits for. A status move spends its turn on an effect rather than on damage,
 * and that still costs the opponent something. `basePower` decides damage.
 *
 * Keeping this out of the damage line is also what stops an all-status moveset
 * collapsing `swingPower` to zero, which would size the opponent's pool to zero
 * and end the battle before its first turn.
 */
const STATUS_SWING = 35;

/**
 * Damage for a move whose power PokeAPI does not carry.
 *
 * Twenty-three machine moves are physical or special with `power: 0` — Seismic
 * Toss, Low Kick, Grass Knot, Gyro Ball — because their power is a formula of
 * level, weight or speed this game has no inputs for. Without this they would
 * round to 1 and a moveset holding one would limp to MAX_TURNS every time.
 */
const FIXED_POWER = 40;

/** How much of the opponent's bar a lingering ailment takes each turn. */
const DOT_DIVISOR = 16;
/** What a weakening status does to the opponent's answer, per application. */
const WARD_MULT = 0.5;
const WARD_FLOOR = 0.25;
/** What a setup move does to my swings, per application. */
const BOOST_MULT = 1.2;
const BOOST_CAP = 1.8;
/** What a recovery move gives back, as a share of the whole bar. */
const HEAL_SHARE = 0.25;

/**
 * Ailments that keep hurting, versus ailments that just get in the way.
 *
 * The vocabulary is generated (see AILMENTS in server/moves.ts); what each one
 * is WORTH is decided here, so re-tuning the battle never means re-fetching the
 * move table. Anything not listed weakens the opponent generically — a field
 * effect or a forced switch made the fight easier without a name for it.
 */
const DOT_AILMENTS = new Set(['poison', 'burn', 'nightmare', 'trap']);
/** Self-targeting, despite reading as something inflicted. Treated as a guard. */
const SELF_AILMENTS = new Set(['protect']);
/**
 * Ailments that are a hole in the data rather than a thing that happens.
 *
 * PokeAPI labels a handful of moves 'unknown'. Narrating that as
 * "상태가 이상해졌다" invents an effect the move does not have.
 */
const NO_AILMENT = new Set(['none', 'unknown']);

/**
 * The statuses a battle panel shows, worst first.
 *
 * The games put an icon on the info panel for the NON-VOLATILE conditions only
 * — burn, poison, paralysis, sleep, freeze. Confusion and the rest are
 * deliberately invisible there ("Volatile status conditions are not indicated
 * by an icon", Bulbapedia); they live in the message box and nowhere else, and
 * this list is what implements that rule.
 *
 * Ordered because the games allow exactly one at a time and this simulation
 * does not enforce that — see `standing`. Freeze reads worst, paralysis least.
 */
const PANEL_STATUS: Ailment[] = ['freeze', 'sleep', 'burn', 'poison', 'paralysis'] as Ailment[];

/**
 * Which of what is on a side belongs on its plate.
 *
 * Reads the set, changes nothing, takes no draw — so adding this cannot move a
 * single existing battle, which the GOLDEN table in test/hunt.test.ts proves.
 */
function standing(set: Set<Ailment>): Ailment | null {
  return PANEL_STATUS.find((a) => set.has(a)) ?? null;
}

/** What a companion with nothing taught swings with. */
export const TACKLE = { name: '몸통박치기', power: 40 } as const;

/**
 * How tough a wild Pokemon is, relative to how hard the companion hits.
 *
 * NOT an absolute HP number. A fixed pool meant a strong moveset one-shot
 * everything common, which is exactly the "one poke and it's over" the battle
 * was rebuilt to fix. Scaling to the companion's own damage keeps every fight
 * a few turns long however strong it gets, and rarity is what makes a legendary
 * take twice as many swings as a Rattata.
 *
 * It also means the opponent's HP is a meaningless absolute number — which is
 * why the panel shows a bar and never a figure. The games do the same: you
 * never see a wild Pokemon's HP total either.
 */
const TOUGHNESS: Record<Rarity, number> = {
  common: 0.75,
  uncommon: 0.9,
  rare: 1.1,
  legendary: 1.3,
};

/** How hard the wild one hits back, as a share of the companion's own damage. */
const COUNTER: Record<Rarity, number> = {
  common: 0.16,
  uncommon: 0.22,
  rare: 0.3,
  legendary: 0.4,
};

/** Turns a common encounter is aimed at. Rarity stretches it from here. */
const TARGET_TURNS = 6;

/**
 * A battle may not end sooner than this.
 *
 * Guaranteed by the `clinging` clamp in the loop, not by arithmetic: the pool
 * is floored at MIN_TURNS times the AVERAGE hit, because sizing it to the
 * biggest possible one pinned every battle to MAX_TURNS instead. Until the
 * minimum is reached the opponent holds on at 1 HP.
 */
export const MIN_TURNS = 4;

/**
 * The companion's HP is a bar, not a number, and it has a floor.
 *
 * Hunting cannot lose — that is the mechanic, not a balance choice. So the bar
 * exists to show that a legendary hurt more than a Rattata did, and the floor is
 * what stops the animation implying a defeat that never happens.
 */
const MY_MAX_HP = 100;
const MY_HP_FLOOR = 18;

/**
 * Turns one battle may run to.
 *
 * The last swing always finishes the job, so the cap shortens a long fight
 * rather than letting the opponent survive it.
 */
export const MAX_TURNS = 8;

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

/** What a status move did for the side that used it. */
export type SelfEffect = 'boost' | 'heal' | 'guard' | 'failed';

export type BattleTurn = {
  /** The move used, or null for the untaught fallback swing. */
  moveId: number | null;
  damage: number;
  crit: boolean;
  /** The swing went wide. Damage is zero and nothing else happens. */
  missed: boolean;
  /**
   * Type matchup, as a multiplier: 0, 0.25, 0.5, 1, 2 or 4.
   *
   * 1 on the forced finishing blow, which ignores the chart — see battleAt.
   */
  effect: number;
  /** Opponent HP once this turn has landed. Zero on the last one. */
  foeHpAfter: number;

  /**
   * Whether the opponent got a turn of its own.
   *
   * False only on the turn it faints. Deliberately its own field rather than
   * `counter > 0`: once the type chart applies to the foe's move, an immune
   * matchup is a counter of zero from an opponent that very much acted, and the
   * panel must not read that as "it went down".
   */
  foeActed: boolean;
  /**
   * What it answered with. Null means the plain fallback swing — either it did
   * not act, or its species has no machine-learnable attack (thirteen do not).
   * Same convention as `moveId` above.
   */
  foeMoveId: number | null;
  /**
   * That move's matchup against MY types: 0, 0.25, 0.5, 1, 2 or 4.
   *
   * 1 when the companion's species was not supplied — see BattleOpts.
   */
  foeEffect: number;

  /** What my move left on the opponent this turn, or null. Narration. */
  ailment: Ailment | null;
  /**
   * What my move did for ME, when it did not inflict anything.
   *
   * 'boost' a setup move, 'heal' a recovery move, 'guard' everything else a
   * status move can be — a weather change, a forced switch — which the fight
   * models the only way it can: the opponent's answer lands softer. 'failed'
   * when the ailment it exists to inflict is already standing, which is what
   * the games say too.
   */
  selfEffect: SelfEffect | null;
  /** What the opponent's move left on ME this turn, or null. */
  foeAilment: Ailment | null;
  /** Chip from a standing ailment on the opponent. Already inside foeHpAfter. */
  residual: number;
  /** Chip from a standing ailment on me. Already inside myHpAfter. */
  myResidual: number;
  /**
   * What is STILL on each side once this turn has finished — the plate badge.
   *
   * Distinct from `ailment`/`foeAilment` above, which are the moment something
   * was inflicted. A burn is news once and a condition thereafter, and the
   * panel is where the second one lives. Non-volatile conditions only; see
   * PANEL_STATUS.
   */
  foeStatus: Ailment | null;
  myStatus: Ailment | null;
  /** What the wild one hit back for. Zero on the turn it faints. */
  counter: number;
  myHpAfter: number;
};

export type Battle = {
  foeMaxHp: number;
  myMaxHp: number;
  turns: BattleTurn[];
};

/** Mean damage one swing of this moveset does, before jitter. */
function swingPower(moves: number[]): number {
  if (!moves.length) return TACKLE.power;
  const total = moves.reduce((a, id) => a + (moveById(id)?.power || STATUS_SWING), 0);
  return total / moves.length;
}

const CRIT_CHANCE = 0.12;
const CRIT_MULT = 1.5;

/**
 * How much a move of the opponent's own type is favoured in its draw.
 *
 * A lean, not a rule — the same language `trainerAt` uses for a class's
 * preferred types. It has to be a weight: six species have no attacking move of
 * their own type at all, and a filter would leave them with nothing to swing.
 * Three puts STAB on roughly three picks in five.
 */
const STAB_WEIGHT = 3;
/** Explosion and Hyper Beam stay reachable, just rare. A Rattata should not open with one. */
const HEAVY_POWER = 130;
const HEAVY_DAMP = 0.4;

/**
 * How hard the type chart leans on WHICH move gets thrown.
 *
 * Until this existed the chart only ever applied to the damage, never to the
 * choice — so a companion that knew a Ground move threw it at a Flying type
 * about a quarter of the time, forever, and the panel said "효과가 없는 것
 * 같다…" for it. Both sides now read the chart before picking.
 *
 * Keyed on what `effectiveness` returns: 0, 0.25, 0.5, 1, 2 or 4, every one of
 * them exactly representable, so a Map keyed on the double is exact.
 *
 * THERE IS DELIBERATELY NO ENTRY FOR 1. A neutral matchup falls through to a
 * literal 1, and that is not tidiness — it is what makes an all-neutral pick
 * weigh 1 across the board, which `pickWeighted` turns back into exactly the
 * uniform draw this replaced. Four of the six GOLDEN rows in
 * test/hunt.test.ts are that case and stay byte-identical. Add an entry for 1
 * and they all move.
 *
 * A lean, not a rule, for the reason written above `battleAt`: rotating to the
 * best move made 2000 encounters produce two distinct sequences. 0.05 keeps an
 * immune move on about one pick in sixty against three neutral ones — rare
 * enough to stop being the story of the fight, common enough that "효과가 없는
 * 것 같다…" is still a line the game can say.
 */
const MATCHUP_WEIGHT = new Map<number, number>([
  [0, 0.05],
  [0.25, 0.2],
  [0.5, 0.45],
  [2, 2.6],
  [4, 5],
]);

/**
 * The same lean on the wild one's side, and much softer on purpose.
 *
 * A wild Pokemon is not being directed by anybody. It stops using the move that
 * visibly does nothing; it does not scheme. The top half stays near 1 because
 * it is a budget rather than a taste: `foeMult` below promises a mean of about
 * one over the weighted draw, and the counter is tuned against that mean. This
 * table costs it roughly +6%; applying the chart at full strength cost +19% and
 * quietly made every trainer harder.
 */
const FOE_MATCHUP_WEIGHT = new Map<number, number>([
  [0, 0.15],
  [0.25, 0.6],
  [0.5, 0.8],
  [2, 1.15],
  [4, 1.3],
]);

/** Neutral is the absent key, so it returns the literal 1. See the tables. */
function chartWeight(effect: number, table: Map<number, number>): number {
  return table.get(effect) ?? 1;
}

/**
 * `effectiveness` against one side, resolved once for all eighteen types.
 *
 * EMPTY when there is nothing to hit. Every lookup then misses and the caller's
 * `?? 1` is what keeps a battle with no type information on either side
 * bit-for-bit what it was before the chart was consulted at all.
 *
 * Eighteen chart evaluations per fight rather than one per move per turn: the
 * biggest machine learnset is 222 moves.
 */
function matchupTable(against: readonly MoveType[]): Map<MoveType, number> {
  const out = new Map<MoveType, number>();
  if (against.length) for (const t of TYPES) out.set(t, effectiveness(t, against));
  return out;
}

type FoePool = { moves: MoveInfo[]; weights: number[]; total: number };

/**
 * What a species can plausibly attack with, cached per species.
 *
 * Drawn from the same machine learnset the TM drops use, so the opponent can
 * only ever use a move it could legitimately be taught. Status and
 * formula-power moves are filtered out: neither carries a number this can size
 * a swing against, and "야생 꼬렛의 칼춤!" is not the fight anyone came for.
 *
 * Null for a species with nothing left after the filter — thirteen of them,
 * counting the nine with no machine moves at all and four whose whole pool is
 * status. They fall back to the same plain swing an untaught companion uses.
 */
const foePools = new Map<number, FoePool | null>();

function foePool(speciesId: number): FoePool | null {
  const cached = foePools.get(speciesId);
  if (cached !== undefined) return cached;

  const types: readonly MoveType[] = speciesInfo(speciesId)?.types ?? [];
  const moves = learnableMoves(speciesId)
    .map(moveById)
    .filter((m): m is MoveInfo => !!m && m.damageClass !== 'status' && m.power > 0);

  let pool: FoePool | null = null;
  if (moves.length) {
    const weights = moves.map(
      (m) => (types.includes(m.type) ? STAB_WEIGHT : 1) * (m.power >= HEAVY_POWER ? HEAVY_DAMP : 1),
    );
    pool = { moves, weights, total: weights.reduce((a, w) => a + w, 0) };
  }
  foePools.set(speciesId, pool);
  return pool;
}

/**
 * Mean power of the 222 machine moves that carry one. Measured, not guessed.
 */
const FOE_POWER_REF = 78;
/**
 * Ceiling on the opponent's multiplier.
 *
 * A 4x matchup on a heavy move would otherwise be a 150-point hit on a
 * 100-point bar — an instant loss against a trainer, where there is no floor.
 */
const FOE_MULT_MAX = 2.5;

/**
 * How much harder or softer this particular move lands.
 *
 * The opponent's damage figure is never on screen — the panel shows a bar and a
 * move name, nothing numeric — so the power axis is compressed hard while the
 * type chart is left at full strength. That is the half a player can actually
 * reason about, and it is the half that was missing entirely: until now the
 * chart only ever applied to MY move.
 *
 * Deliberately centred on 1: over the weighted draw this averages 0.99, so the
 * counter keeps the mean it was tuned against and only gains variance. The same
 * discipline REWARD_MEAN applies to hunting payouts.
 */
function foeMult(move: MoveInfo | null, effect: number): number {
  if (!move) return 1;
  const pw = Math.min(1.35, Math.max(0.7, 0.55 + 0.45 * (move.power / FOE_POWER_REF)));
  return Math.min(FOE_MULT_MAX, effect * pw);
}

/**
 * What a status move does, given it deals no damage.
 *
 * Order matters: an ailment is the move's whole point when it has one, and
 * everything else falls back to a generic weakening rather than to nothing.
 * "당신의 칼춤은 아무 일도 일어나지 않았다" is the story this replaced.
 */
function statusOutcome(move: MoveInfo): { ailment: Ailment | null; self: SelfEffect } {
  if (!NO_AILMENT.has(move.ailment) && !SELF_AILMENTS.has(move.ailment)) {
    return { ailment: move.ailment, self: 'guard' };
  }
  if (move.category === 'net-good-stats' || move.category === 'swagger' || move.category === 'damage-raise') {
    return { ailment: null, self: 'boost' };
  }
  if (move.category === 'heal' || move.category === 'damage-heal') {
    return { ailment: null, self: 'heal' };
  }
  return { ailment: null, self: 'guard' };
}

/**
 * One roll, one item, weighted.
 *
 * The subtract-and-test body is kept exactly as the opponent's draw has always
 * run it, because the arithmetic is load-bearing: with every weight at 1, the
 * partial `roll * n - i` is exact for every i in [0, n), so the first negative
 * residual lands at `Math.floor(roll * n)` — the uniform index this replaced on
 * the companion's side. That identity is the whole reason the chart can be
 * consulted without rewriting every battle the app has ever produced.
 */
function pickWeighted<T>(items: readonly T[], weights: readonly number[], total: number, roll: number): T {
  let pick = roll * total;
  for (let i = 0; i < items.length; i++) {
    pick -= weights[i];
    if (pick < 0) return items[i];
  }
  // Floating point can leave a sliver at the top of the range.
  return items[items.length - 1];
}

/**
 * Play out one encounter, turn by turn.
 *
 * Pure in (seq, rarity, moves, foeTypes), and seeded on a different salt from
 * `encounterAt` so asking for the battle cannot change which Pokemon was met.
 *
 * ## The move is rolled, not rotated
 *
 * This used to be `moves[i % moves.length]` — "as a lazy trainer would", said
 * the old comment. That made the move order IDENTICAL in every single battle:
 * 2000 encounters produced two distinct sequences, differing only in length.
 * With the strongest move always landing first, its damage read as a scripted
 * critical hit. Rolling per turn is the fix.
 *
 * ## Ending the fight
 *
 * Two rules would otherwise contradict each other. The last allowed turn must
 * end the battle, but a miss or a zero-effectiveness matchup deals nothing — so
 * "the swing went wide and the opponent fainted" was reachable. The final turn
 * therefore cannot miss and ignores the type chart. That is also what
 * guarantees termination for a moveset that is entirely immune against this
 * opponent, e.g. nothing but Normal moves against a Ghost.
 */
export type BattleOpts = {
  /**
   * HP this round starts on. Defaults to full.
   *
   * A trainer's team is fought one after another without healing, so each round
   * picks up where the last one left off.
   */
  startHp?: number;
  /** Turns this round may run to. Defaults to MAX_TURNS. */
  budget?: number;
  /**
   * Whether the companion's HP has a floor.
   *
   * True for wild encounters, where losing is not something the mechanic does.
   * False for trainers — that is precisely what lets a trainer battle be lost.
   */
  floor?: boolean;
  /** Multiplied onto TOUGHNESS. A trainer's class makes their team hardier. */
  grit?: number;
  /**
   * Turns the opponent's HP pool is sized for. Defaults to TARGET_TURNS.
   *
   * Must match `budget`, or the round runs out before the opponent can fall.
   */
  targetTurns?: number;
  /**
   * Damage per counter-attack, overriding the default.
   *
   * The default is a share of the companion's own swing, which works while the
   * HP floor hides it. With the floor OFF it inverts the fight: a stronger
   * moveset draws proportionally bigger counters against the same 100-point
   * pool, so the better team loses. A losable battle has to express the counter
   * in HP units instead.
   */
  counterHit?: number;
  /**
   * Swing value the opponent's HP pool is sized against, instead of the
   * companion's own.
   *
   * Wild encounters deliberately size the pool to your own damage so a fight is
   * always the same length however strong you get — that is what stops a good
   * moveset one-shotting everything. A trainer wants the opposite: a fixed pool
   * means a stronger moveset really does win faster, and taking fewer turns is
   * what makes it take fewer counters. Without this the win rate barely moves
   * between a bare companion and a fully taught one — measured.
   */
  swingRef?: number;
  /**
   * The companion's species, so the type chart can apply to the FOE's move too.
   *
   * An option rather than a positional because omitting it has to reproduce the
   * old one-directional behaviour exactly — `foeEffect` is then 1 everywhere.
   */
  mySpeciesId?: number;

  /*
   * ── Form options ────────────────────────────────────────────────────────
   *
   * Every one of these MULTIPLIES a number that has already been drawn. None of
   * them takes a draw of its own, and each defaults to the identity, so a
   * battle fought without a form is byte-identical to one fought before they
   * existed — which is the whole reason the GOLDEN table still passes.
   */

  /**
   * Multiplied onto my damage. A mega's base-stat ratio, about 1.19.
   *
   * Applied to the damage rather than to `swingRef`, deliberately. Sizing is
   * what keeps a wild fight the same length however strong you get; leaving it
   * alone means a mega actually fells things sooner, and so takes fewer
   * counters, instead of being sized back into the same six turns.
   */
  myPower?: number;
  /**
   * Multiplied onto the counter I take.
   *
   * Gigantamax passes 0.5 for `counterMultTurns` turns, which is this app's
   * translation of the games' doubled HP — the same arithmetic, expressed on a
   * bar that is already fixed at a hundred points. It is worth most in a
   * trainer battle, the only fight here that can actually be lost.
   */
  counterMult?: number;
  /** How many turns `counterMult` lasts. Gigantamax reverts after three. */
  counterMultTurns?: number;
  /** My types, overriding `mySpeciesId`. A Mega Charizard X is Fire/Dragon. */
  myTypes?: readonly MoveType[];
};

/** Turns a Gigantamax lasts, as in the games. */
export const GMAX_TURNS = 3;

/**
 * What a Gigantamax does to incoming damage.
 *
 * Halving it is doubled HP said the other way round, and doubled HP is what
 * Dynamax actually does in the games. Expressing it here rather than as a
 * bigger bar keeps `myMaxHp` fixed at a hundred, which every HP figure the
 * panel draws is already scaled against.
 */
export const GMAX_GUARD = 0.5;

/**
 * The battle knobs a form contributes.
 *
 * One definition, every call site: the trainer fight settled in `hunt`, and
 * both replays the panel builds. Written down once because a form that boosted
 * damage in the settled fight but not in the replay would show a battle that
 * did not happen.
 *
 * `worn` is the PERMANENT form, if the companion is fused. It contributes types
 * and nothing else — a fusion is not a battle transformation, it is simply what
 * this Pokemon is now. Without it a fused Necrozma reads Psychic/Steel on the
 * panel and fights as plain Psychic, which is a lie the type chart tells.
 * A battle form on top of it wins, because that is the shape actually swinging.
 */
export function formOpts(form: Form | null, worn: Form | null = null): BattleOpts {
  const types = form?.types ?? worn?.types;
  if (!form) return types ? { myTypes: types } : {};
  return {
    myTypes: types,
    // A mega hits harder; a gigantamax is tougher for three turns. Neither
    // does the other, which is what the base stats say: every mega is +100,
    // every gigantamax is +0.
    ...(form.kind === 'mega' ? { myPower: form.power } : {}),
    ...(form.kind === 'gmax'
      ? { counterMult: GMAX_GUARD, counterMultTurns: GMAX_TURNS }
      : {}),
  };
}

export function battleAt(
  seq: number,
  rarity: Rarity,
  moves: number[],
  foeSpeciesId?: number,
  opts?: BattleOpts,
): Battle {
  // Defaults reproduce wild-encounter behaviour exactly, RNG draw order
  // included. The nine battleAt tests are what hold that.
  const startHp = opts?.startHp ?? MY_MAX_HP;
  const budget = opts?.budget ?? MAX_TURNS;
  const floored = opts?.floor ?? true;
  const grit = opts?.grit ?? 1;
  const target = opts?.targetTurns ?? TARGET_TURNS;

  const rng = mulberry32(Math.imul(seq + 1, 0x27d4eb2d) ^ 0xc2b2ae35);
  /**
   * The opponent's own stream.
   *
   * Separate on purpose. The draws inside the loop below are conditional, so a
   * single extra draw taken from `rng` would shift every one after it and
   * rewrite every battle the app has ever produced. Giving the opponent its own
   * salt keeps the companion's half bit-for-bit identical — which is what
   * `test/hunt.test.ts`'s GOLDEN table exists to prove.
   */
  const foeRng = mulberry32(Math.imul(seq + 1, 0x85ebca6b) ^ 0x27d4eb2d);
  const foeTypes = foeSpeciesId ? (speciesInfo(foeSpeciesId)?.types ?? []) : [];
  const myTypes: readonly MoveType[] =
    opts?.myTypes ?? (opts?.mySpeciesId ? (speciesInfo(opts.mySpeciesId)?.types ?? []) : []);
  const myPower = opts?.myPower ?? 1;
  const counterMult = opts?.counterMult ?? 1;
  const counterMultTurns = opts?.counterMultTurns ?? Infinity;
  const pool = foeSpeciesId ? foePool(foeSpeciesId) : null;
  /** My move's type -> how the chart bites the opponent. Empty when it has none. */
  const vsFoe = matchupTable(foeTypes);
  /** Theirs -> how it bites me. Empty when my own types are unknown. */
  const vsMe = matchupTable(myTypes);
  /**
   * The opponent's weights for THIS fight.
   *
   * Layered on top of the species cache rather than folded into it. The species
   * half — STAB, the heavy damp — is intrinsic and memoised across every battle
   * that species ever fights; this half depends on who it is facing, and
   * `opts.myTypes` can override the companion's species outright (a Mega
   * Charizard X is Fire/Dragon), so a species id is not even a valid key for it.
   *
   * With `myTypes` empty every factor is exactly 1: the same doubles, summed in
   * the same order, for the same `total`. That is what leaves every fight
   * against a companion of unknown type identical to the one before this
   * existed — and `foeRng` feeds the ailment rolls on BOTH sides, so a single
   * different foe move here would have shifted my half of the fight too.
   */
  const foeWeights = pool
    ? pool.weights.map(
        (w, i) => w * chartWeight(vsMe.get(pool.moves[i].type) ?? 1, FOE_MATCHUP_WEIGHT),
      )
    : null;
  const foeTotal = foeWeights ? foeWeights.reduce((a, w) => a + w, 0) : 0;

  /**
   * What the companion may swing with. `null` in the list is the plain swing,
   * the same convention `moveId` already uses.
   */
  const swingPool: (number | null)[] = !moves.length
    ? []
    : hasDamaging(moves)
      ? moves
      : [...moves, null];

  const swing = swingPower(moves);
  const sizing = opts?.swingRef ?? swing;
  const foeMaxHp = Math.max(
    // A soft floor at average damage. Sizing it to the biggest hit the moveset
    // could theoretically land instead pinned every battle to MAX_TURNS. Never
    // above the budget, or a short round cannot fell anything.
    Math.ceil(sizing * Math.min(MIN_TURNS, budget)),
    Math.round(sizing * target * TOUGHNESS[rarity] * grit * (0.85 + rng() * 0.3)),
  );
  const counterHit =
    opts?.counterHit ?? Math.max(1, Math.round(swing * COUNTER[rarity] * grit));

  const myMaxHp = MY_MAX_HP;
  const turns: BattleTurn[] = [];
  let foeHp = foeMaxHp;
  let myHp = startHp;
  /** Standing effects. All of them last the rest of the fight, as the games do. */
  let foeDot = false;
  let myDot = false;
  let wards = 0;
  let boosts = 0;
  /** What is already on each side, so nothing gets inflicted twice. */
  const foeStanding = new Set<Ailment>();
  const myStanding = new Set<Ailment>();

  // `myHp > 0` only ever ends a round when the floor is off, i.e. a trainer.
  for (let i = 0; i < budget && foeHp > 0 && myHp > 0; i++) {
    const finisher = i === budget - 1;
    // A moveset with nothing that hits gets its plain swing back as a candidate.
    // Otherwise teaching one status move left a companion strictly worse off
    // than teaching nothing at all, which is how this started.
    //
    // An EMPTY moveset still takes no draw, exactly as before — start drawing
    // there and every untaught battle ever produced shifts, which the GOLDEN
    // table in test/hunt.test.ts would catch. The only pool that changes size
    // is "taught, but all of it status", and none of the goldens is that.
    // A status move whose ailment is already standing would just fail. A player
    // would pick something else, so this does too — the pool is filtered before
    // the draw rather than the turn being wasted on "하지만 실패했다!".
    //
    // No new draw, and for a moveset with nothing status in it the filter
    // removes nothing and the pick is byte-identical — which is what keeps the
    // GOLDEN table in test/hunt.test.ts still true.
    const usable = swingPool.filter((id) => {
      if (id === null) return true;
      const m = moveById(id);
      if (!m || m.damageClass !== 'status') return true;
      const out = statusOutcome(m);
      return !(out.ailment && foeStanding.has(out.ailment));
    });
    // Everything filtered out means every move it knows is already spent. Fall
    // back to the whole pool so the turn still happens and still narrates.
    const pickFrom = usable.length ? usable : swingPool;
    /**
     * Which of them to actually throw, leaning on the chart.
     *
     * Weighted AFTER the filter above, never before — `usable` is what a player
     * would still consider, and re-inflicting a status that already stands is
     * not on that list. Hoisting this out of the loop to weigh `swingPool` once
     * would be the tempting refactor and would quietly undo that.
     *
     * A status move takes the neutral weight unconditionally. Its damage is
     * zero whatever the chart says, `statusOutcome` never reads a type, and the
     * panel prints its effect line rather than an effectiveness one — the chart
     * has nothing to say about it, and this is what stops it saying something
     * anyway. The pleasant consequence: into a bad matchup the attacks lose
     * weight and the status moves keep theirs, so a companion that cannot hit
     * hard visibly sets up instead.
     */
    const weights = pickFrom.map((id) => {
      const m = id === null ? null : moveById(id);
      if (m?.damageClass === 'status') return 1;
      // null, and an id the table does not know, are both the plain swing.
      return chartWeight(vsFoe.get(m?.type ?? 'normal') ?? 1, MATCHUP_WEIGHT);
    });
    const total = weights.reduce((a, w) => a + w, 0);
    const rolledId = pickFrom.length
      ? pickWeighted(pickFrom, weights, total, rng())
      : null;
    const rolled = rolledId === null ? null : moveById(rolledId);
    // The last allowed turn has to fell the opponent, and a status move deals
    // nothing — "화염레오의 칼춤! 꼬렛을 쓰러뜨렸다!" is not a fight. Swap in the
    // plain swing instead. No draw either way, so the stream is untouched.
    const swapped = finisher && rolled?.damageClass === 'status';
    const moveId = swapped ? null : rolledId;
    const move = swapped ? null : rolled;
    const isStatus = move?.damageClass === 'status';
    const base = !move ? TACKLE.power : isStatus ? 0 : move.power || FIXED_POWER;

    // accuracy 0 means the move never misses. The finisher never misses either.
    const acc = move?.accuracy ?? 0;
    const missed = !finisher && acc > 0 && rng() * 100 >= acc;

    const effect = finisher || !foeTypes.length
      ? 1
      : effectiveness(move?.type ?? 'normal', foeTypes);

    const crit = !missed && rng() < CRIT_CHANCE;
    // The jitter is drawn even for a status move, which deals nothing: skipping
    // the draw would move every one after it. `base === 0` is the arm that lets
    // the result actually be zero — the old floor of 1 is what made a status
    // move chip.
    const boost = Math.min(BOOST_CAP, BOOST_MULT ** boosts);
    let damage = missed
      ? 0
      : Math.max(
          effect === 0 || base === 0 ? 0 : 1,
          Math.round(base * (0.85 + rng() * 0.3) * (crit ? CRIT_MULT : 1) * effect * boost * myPower),
        );
    if (finisher) damage = Math.max(damage, foeHp);
    // Before MIN_TURNS it clings on at 1 HP. Clamping the damage instead would
    // flatten a 150-power move into a 40-power one; letting the opponent hold
    // out is both honest about the numbers and a beat the games already have.
    // Only while the round still has room for its minimum; a short trainer
    // round has no minimum to protect.
    const clinging = budget >= MAX_TURNS && i < MIN_TURNS - 1;
    foeHp = clinging ? Math.max(1, foeHp - damage) : Math.max(0, foeHp - damage);

    // What my move left behind, when it spent its turn on an effect rather than
    // on damage. Ailment rolls come off the OPPONENT's stream — see foeRng.
    let ailment: Ailment | null = null;
    let selfEffect: SelfEffect | null = null;
    if (move && !missed) {
      if (isStatus) {
        const out = statusOutcome(move);
        // One non-volatile status at a time, as the games have it: a second
        // 맹독 on an already-poisoned opponent fails rather than re-reporting.
        if (out.ailment && foeStanding.has(out.ailment)) {
          selfEffect = 'failed';
        } else {
          ailment = out.ailment;
          selfEffect = out.self;
          if (out.self === 'boost') boosts++;
          if (out.self === 'guard') wards++;
          if (out.self === 'heal') myHp = Math.min(myMaxHp, myHp + Math.round(myMaxHp * HEAL_SHARE));
        }
      } else if (
        !NO_AILMENT.has(move.ailment) &&
        move.ailmentChance > 0 &&
        !foeStanding.has(move.ailment) &&
        foeRng() * 100 < move.ailmentChance
      ) {
        // A Flamethrower that burns. Forty-four machine moves carry one of these.
        ailment = move.ailment;
      }
      if (ailment) {
        foeStanding.add(ailment);
        if (DOT_AILMENTS.has(ailment)) foeDot = true;
        else wards++;
      }
    }

    // It only hits back if it is still standing.
    const foeActed = foeHp > 0;
    const foeMove =
      foeActed && pool && foeWeights
        ? pickWeighted(pool.moves, foeWeights, foeTotal, foeRng())
        : null;
    const foeEffect = foeMove && myTypes.length ? effectiveness(foeMove.type, myTypes) : 1;
    // The jitter is drawn whenever it acts, BEFORE deciding whether the hit
    // lands. Skipping the draw on an immune matchup would move every subsequent
    // draw in this stream and rewrite the companion's half of the fight.
    const jitter = foeActed ? 0.7 + rng() * 0.6 : 0;
    // A true zero on an immunity, not the old Math.max(1, ...) — otherwise the
    // panel says "효과가 없는 것 같다" while the bar drops anyway.
    const ward = Math.max(WARD_FLOOR, WARD_MULT ** wards);
    const mult = foeMult(foeMove, foeEffect) * ward;
    // A gigantamax runs out partway through: `i` is the turn index, so the
    // guard simply stops applying and the fight carries on at full weight.
    const guard = i < counterMultTurns ? counterMult : 1;
    const counter =
      foeActed && mult !== 0 ? Math.max(1, Math.round(counterHit * mult * jitter * guard)) : 0;
    myHp = floored ? Math.max(MY_HP_FLOOR, myHp - counter) : Math.max(0, myHp - counter);

    /**
     * What the opponent's move left on me.
     *
     * Deliberately damage-only in both directions: an ailment never costs
     * either side its turn. Turn counts are what every length invariant rests
     * on — the opponent's pool is sized to my average swing — so a paralysis
     * that skipped actions would quietly stretch every fight against an
     * Electric type and nothing in the tuning would know.
     */
    let foeAilment: Ailment | null = null;
    if (
      foeActed &&
      foeMove &&
      !NO_AILMENT.has(foeMove.ailment) &&
      foeMove.ailmentChance > 0 &&
      !myStanding.has(foeMove.ailment) &&
      foeRng() * 100 < foeMove.ailmentChance
    ) {
      foeAilment = foeMove.ailment;
      myStanding.add(foeAilment);
      if (DOT_AILMENTS.has(foeAilment)) myDot = true;
    }

    // End of turn. Chip never fells: the last turn's `foeHpAfter === 0` has to
    // keep meaning "my swing did that", which is what MIN_TURNS and the finisher
    // both rest on.
    let residual = 0;
    if (foeDot && foeHp > 1) {
      residual = Math.min(Math.max(1, Math.round(foeMaxHp / DOT_DIVISOR)), foeHp - 1);
      foeHp -= residual;
    }
    let myResidual = 0;
    const myFloor = floored ? MY_HP_FLOOR : 1;
    if (myDot && myHp > myFloor) {
      myResidual = Math.min(Math.max(1, Math.round(myMaxHp / DOT_DIVISOR)), myHp - myFloor);
      myHp -= myResidual;
    }

    turns.push({
      moveId,
      damage,
      crit,
      missed,
      effect,
      foeHpAfter: foeHp,
      foeActed,
      foeMoveId: foeMove?.id ?? null,
      foeEffect,
      ailment,
      selfEffect,
      foeAilment,
      residual,
      myResidual,
      foeStatus: standing(foeStanding),
      myStatus: standing(myStanding),
      counter,
      myHpAfter: myHp,
    });
  }

  return { foeMaxHp, myMaxHp, turns };
}

/** Exported so a trainer round can start where the previous one ended. */
export const BATTLE_MAX_HP = MY_MAX_HP;

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
  const boosts = formOpts(form, worn);
  // A mega swings 19% harder, so it earns 19% more from the same encounter.
  // A gigantamax earns nothing extra here on purpose — its base stats are
  // unchanged, and what it buys instead is surviving trainers.
  const formMult = form?.kind === 'mega' ? form.power : 1;

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

  for (let i = 0; i < n; i++) {
    const seq = state.huntCount + i;
    const e = encounterAt(seq, speciesId, state.hatchThreshold);
    // Past the cap the encounter still happens and TMs still drop; only the
    // tokens stop. TM farming keeps working while the currency saturates.
    const room = () => Math.max(0, cap - (state.huntTokens + gained));

    // A trainer rides on top of the wild roll rather than replacing it: the
    // encounter stream must keep producing exactly what it did before, or every
    // past encounter shifts.
    const t = trainerAt(seq);
    if (t) {
      const fight = trainerBattleAt(seq, t, active.moves, speciesId, boosts);
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
      const grit = TIER_GRIT[gateOf(wildId)?.tier ?? 'sub'];
      const fight = battleAt(LEGEND_SEED_BASE + seq, 'legendary', active.moves, wildId, {
        budget: LEGEND_TURNS,
        targetTurns: LEGEND_TURNS,
        swingRef: TACKLE.power,
        floor: false,
        counterHit: Math.max(1, Math.round(BATTLE_MAX_HP * 0.11 * grit)),
        grit,
        mySpeciesId: speciesId,
        ...boosts,
      });
      const last = fight.turns.at(-1);
      const won = (last?.foeHpAfter ?? 1) === 0 && (last?.myHpAfter ?? 0) > 0;
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
        legend: { speciesId: wildId, won },
      });
      continue;
    }

    const tokens = Math.min(room(), Math.round(e.reward * mult * formMult));
    gained += tokens;
    if (e.moveId !== null) {
      tms[e.moveId] = (tms[e.moveId] ?? 0) + 1;
      tmsFound += 1;
    }
    // Stones sit outside huntCap, like every other item: the ceiling is on
    // progress, and a stone is not progress.
    const stoneId = stoneAt(seq, wildId);
    if (stoneId !== null) stones[stoneId] = (stones[stoneId] ?? 0) + 1;
    // A signature item, from the gates whose bar has already been cleared.
    // Outside huntCap for the same reason every other item is.
    const drop = legendDropAt(seq, droppable);
    if (drop !== null) legendItems[drop] = (legendItems[drop] ?? 0) + 1;
    // Fragments, for the gates whose item is only ever assembled. Kept off the
    // log entry: twelve of them is a lot of rows to say the same thing, and the
    // bag counts them anyway.
    const shard = shardDropAt(seq, shardable);
    if (shard !== null) shards[shard] = (shards[shard] ?? 0) + 1;
    fresh.push({
      seq,
      wildId,
      tokens,
      moveId: e.moveId,
      ...(stoneId !== null ? { stoneId } : {}),
      ...(drop !== null ? { legendItem: drop } : {}),
      ...formTag,
    });
  }

  return {
    state: {
      ...state,
      huntTokens: state.huntTokens + gained,
      huntCount: state.huntCount + n,
      trainerWins: (state.trainerWins ?? 0) + wins,
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
