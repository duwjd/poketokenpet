import { LINES, NATURES, type SpeciesLine } from './species.ts';
import { formsFrom, type Form } from './forms.ts';
import { lineOf, retireInto } from './dex.ts';
import { learnableMoves, moveById, speciesInfo, type MoveInfo } from './moves.ts';
import type { CountMode } from './usage.ts';

/**
 * Does this move actually hit for something?
 *
 * One predicate for the whole app. It deliberately does NOT require
 * `power > 0`: twenty-three machine moves are physical or special with no power
 * figure (Seismic Toss, Grass Knot, Gyro Ball) because their power is a formula
 * PokeAPI does not ship, and the battle gives them FIXED_POWER. They hit.
 *
 * `foePool` in hunt.ts asks a stricter question — it needs a real number to
 * scale a multiplier against — which is why it filters `power > 0` as well.
 *
 * Lives here rather than in hunt.ts because hunt.ts imports this file, so the
 * dependency can only run one way, and store.ts needs it for migration too.
 */
export function isDamaging(move: MoveInfo | null): boolean {
  return !!move && move.damageClass !== 'status';
}

/** Whether a moveset can hurt anything at all. */
export function hasDamaging(moves: number[]): boolean {
  return moves.some((id) => isDamaging(moveById(id)));
}

/**
 * The attack a species is born knowing.
 *
 * The weakest move of its OWN type it could ever be taught — the one it would
 * have grown up with. Falls back to the weakest attack of any type, and to
 * nothing at all for the thirteen species that cannot learn an attacking move
 * from a machine (Ditto, Wobbuffet, Pyukumuku, Cosmoem and friends). The
 * battle's plain-swing fallback is what covers those.
 *
 * Zero-power moves are excluded here even though they do damage: a Magikarp
 * born knowing Horn Drill reads as a joke rather than as a beginner's move.
 *
 * Deterministic, so a species always starts the same way and a replayed hatch
 * rebuilds the same companion — which the whole idempotence design rests on.
 */
export function starterMove(speciesId: number): number | null {
  const types = speciesInfo(speciesId)?.types ?? [];
  const pool = learnableMoves(speciesId)
    .map(moveById)
    .filter((m): m is MoveInfo => !!m && isDamaging(m) && m.power > 0);
  if (!pool.length) return null;
  const stab = pool.filter((m) => types.includes(m.type));
  const from = stab.length ? stab : pool;
  // Weakest wins; ties go to the lower move id so the pick never wobbles.
  return from.reduce((a, b) =>
    b.power < a.power || (b.power === a.power && b.id < a.id) ? b : a,
  ).id;
}

/**
 * Rarity, worst to best.
 *
 * The union is derived from this array rather than written twice, because the
 * ORDER is load-bearing: a purchased egg guarantees its tier as a floor, and
 * that comparison walks this ladder. A tier that existed in the union but not
 * here would silently never be reachable as a guarantee.
 */
export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'legendary'] as const;

export type Rarity = (typeof RARITY_ORDER)[number];

/**
 * PokeAPI capture_rate, inverted into rarity. Lower rate = harder to catch.
 * Reference points: rattata 255, pichu 190, machop 180, bulbasaur 45.
 */
export function rarityOf(captureRate: number): Rarity {
  if (captureRate >= 190) return 'common';
  if (captureRate >= 120) return 'uncommon';
  if (captureRate >= 45) return 'rare';
  return 'legendary';
}

/** How much longer a rarer companion takes to grow. */
export const RARITY_MULT: Record<Rarity, number> = {
  common: 1.0,
  uncommon: 1.5,
  rare: 2.5,
  legendary: 5.0,
};

/** Odds a companion hatches shiny. Gen-6+ rate; 1/4096 never pays off. */
export const SHINY_ODDS = 512;

/** Cosmetic only — flavour text for idle animations. Never a mechanic. */

export type Companion = {
  /** One committed branch, e.g. [133, 134]. Branching is resolved at hatch. */
  pathIds: number[];
  stageIndex: number;
  isShiny: boolean;
  rarity: Rarity;
  nature: string;
  nickname?: string;
  /** lifetimeTokens at hatch. */
  bornAt: number;
  /** lifetimeTokens when the current stage began. */
  tokensAtStageStart: number;
  /**
   * `huntTokens` and `huntCount` as they stood when this one hatched.
   *
   * The partner tab wants "what has THIS companion brought in", and neither
   * counter can answer that on its own: both are lifetime totals that
   * graduation does not reset. `bornAt` cannot be mined for it either — it is
   * `lifetimeEarned + bonusTokens + huntTokens` blended into one scalar, so the
   * hunted share cannot be recovered from it.
   *
   * Snapshotting at hatch is exact rather than approximate, because `buildState`
   * settles hunting BEFORE `advance` runs: the batch of encounters that pushed
   * the egg over the line is already counted here, so a companion born on that
   * tick correctly starts from zero.
   *
   * Optional, so old saves need no migration — but `migrate` still has to give
   * a live companion a value, or it would read the lifetime totals as its own.
   */
  huntTokensAtBirth?: number;
  huntCountAtBirth?: number;
  /**
   * A permanent alternate form, as a PokeAPI pokemon id >= 10001.
   *
   * Fusions only. Mega and Gigantamax are battle-scoped and never stored: they
   * are decided fresh from `battleFormOf` each encounter, so nothing here can
   * drift out of sync with the bag.
   *
   * Optional, so old saves need no migration — the same reason
   * `HuntEntry.trainer` is optional.
   */
  formId?: number;
  /**
   * Taught moves, as PokeAPI `move.id` — never an index into MOVES, which
   * shifts whenever the generator is re-run. Capped at MOVE_SLOTS.
   *
   * Required, not optional: the hatch branch below builds a fresh object
   * literal rather than spreading, so only a required field makes the compiler
   * catch a new companion that forgot to start with an empty moveset.
   */
  moves: number[];
};

/**
 * One member of the Pokemon League party.
 *
 * Backed by the dex — you may only field something you actually raised — and
 * so keyed the way the dex is, on (species, shiny). Lives here rather than in
 * server/party.ts because it is save state, and because server/gyms.ts needs
 * the type to fight with and must not import the builder to get it.
 *
 * `moves` is a copy, not a reference to the dex entry's: a TM spent putting a
 * move here is spent, and the dex's own record of what the species has known
 * keeps growing independently.
 */
export type PartyMember = {
  speciesId: number;
  shiny: boolean;
  /** Decoration, as in the dex entry it came from. */
  formId?: number;
  /** Up to MOVE_SLOTS. May be empty — an unarmed member is a legal bad choice. */
  moves: number[];
};

export type DexEntry = {
  speciesId: number;
  shiny: boolean;
  firstSeenAt: number;
  /** Whatever it was called when it graduated. Absent on older entries. */
  nickname?: string;
  /**
   * The form it left as, if it was fused.
   *
   * Decoration only: the entry is still filed under the BASE species, because
   * every dex filter (generation, rarity, type) and `preEvolutionsOf` assume an
   * id in 1..1025. This changes the card's picture, nothing else.
   */
  formId?: number;
  /**
   * Machine moves this species has been left knowing, across every individual
   * of it that has graduated.
   *
   * A UNION rather than the last one's moveset, and never overwritten — the
   * dex is a record of the collection, so "이 종이 배운 적 있는 기술" is the
   * honest reading and it can only ever grow. `server/party.ts` treats these
   * as free: the Pokemon already knows them, so putting one back on a league
   * party costs no TM from the bag.
   *
   * Filtered by `canLearn` on the species it is filed under. A move taught to
   * a 파이리 and carried into a 리자몽 is real for the 리자몽 only if a 리자몽
   * could be taught it too, and claiming otherwise would let the party builder
   * offer a move the battle would refuse.
   *
   * Absent on every entry that predates this, which is the honest answer: no
   * record of those movesets exists anywhere to recover.
   */
  moves?: number[];
};

/** One settled encounter, kept for the UI. Keyed by `seq` so re-runs overwrite. */
export type HuntEntry = {
  /** The encounter index that produced this. Doubles as a dedupe key. */
  seq: number;
  wildId: number;
  tokens: number;
  /** The TM that dropped, as a move id, or null. */
  moveId: number | null;
  /**
   * The mega stone picked up here, as the form id it opens.
   *
   * Optional for the same reason `trainer` is: an older entry simply has none,
   * so no schema bump is needed to start recording it.
   */
  stoneId?: number;
  /**
   * The battle form the companion took for this encounter.
   *
   * Recorded rather than re-derived because the bag can change: a key stone
   * switched off tomorrow must not rewrite what the log says happened today.
   */
  form?: { id: number; kind: 'mega' | 'gmax' };
  /**
   * Set when this encounter was a trainer rather than a wild Pokemon.
   *
   * Optional, so no schema bump: `migrate` passes `huntLog` through and an older
   * entry simply has none. Bumping the version for something that needs no
   * migration teaches people to ignore the number.
   */
  trainer?: {
    name: string;
    team: number[];
    won: boolean;
    /** The item handed over, if any. */
    item?: 'shiny-charm' | 'everstone';
  };
  /**
   * Set when the trainer above was a gym leader rather than someone off a route.
   *
   * A SIBLING of `trainer`, not a replacement. A leader's name, team and
   * outcome are the same three facts a route trainer records, and the scene
   * draws them with the same component — so reusing that field is what lets
   * `SceneTrainerFight`, the `meet` beat, the portrait and the ball tray work
   * with no changes at all. Only what a badge adds lives here.
   *
   * Recorded rather than re-derived, and here that is a correctness rule
   * rather than a preference: a gym challenge is NOT pure in `seq` the way
   * `trainerAt` is — it reads the badge count, which changes inside the very
   * range `hunt()` replays. The panel must read this record.
   */
  gym?: {
    /** `GymRow.id`. A permanent key; see server/gyms.ts. */
    id: string;
    /** The badge handed over on a win, or null on a loss or a rematch. */
    badge: number | null;
    /** The TM that came with it, as a move id. Null when no badge was won. */
    prize: number | null;
  };
  /**
   * Set when this encounter was one Elite Four member of a league run.
   *
   * Like `gym`, it rides beside `trainer` rather than replacing it — the panel
   * draws a named challenger the same way either way. What is new is `party`:
   * WHICH of the six were out, in round order. Without it a replay would draw
   * today's party into yesterday's fight, the same failure `form` is recorded
   * to avoid.
   */
  league?: {
    /** `LeagueRow.id`. */
    id: string;
    /** Which member, 0..4. */
    at: number;
    won: boolean;
    /** True on the encounter that finished the whole run. */
    cleared: boolean;
    /** The party species that actually stood, per round. */
    party: number[];
    /**
     * The party as it was when this encounter began: its six species, and its
     * six bars.
     *
     * Enough to replay the fight exactly, and enough to know when not to try.
     * The panel re-runs `leagueRoundAt` rather than storing turns — the same
     * bargain every other battle here makes — and that needs the HP it started
     * from, which nothing else records. `team` is the tripwire: a party
     * rebuilt since would narrate somebody else's fight.
     */
    team: number[];
    hp: number[];
  };
  /**
   * Set when this encounter was a gated legendary.
   *
   * Recorded rather than re-derived, exactly as `form` is: the gate depends on
   * the save, and a signature item spent tomorrow must not rewrite what the log
   * says happened today.
   */
  legend?: { speciesId: number; won: boolean };
  /** The signature item this encounter left behind, as a PokeAPI slug. */
  legendItem?: string;
};

export type GameState = {
  schemaVersion: 4;
  /**
   * Scan total at the previous poll, per count mode. A moving reference for the
   * next delta — NOT an install baseline; see `accrue`. Keyed by mode because
   * `billable` is roughly 5% of `activity`, so a shared anchor would book the
   * whole difference as earnings the first time someone switched back.
   */
  lastTotal: Partial<Record<CountMode, number>>;
  /**
   * Tokens earned since install: the running sum of forward deltas. Monotonic
   * by construction, so pruned transcripts can never walk progress backwards.
   */
  lifetimeEarned: number;
  hatchThreshold: number;
  /** lifetimeTokens when the current egg was laid. */
  eggStartedAt: number;
  active: Companion | null;
  dex: DexEntry[];
  retiredCount: number;

  /** Tokens spent in the shop. Reduces the wallet only, never progression. */
  spentTokens: number;
  /** Progress granted by items (Rare Candy). Added on top of earned tokens. */
  bonusTokens: number;
  /**
   * Achievement id -> when it was unlocked, in ms.
   *
   * Retroactive unlocks record 0, the same thing `backfillPreEvolutions` writes
   * into a dex entry's `firstSeenAt` for a row it inferred rather than watched.
   *
   * Optional, so old saves need no migration — but it MUST still be named in
   * `migrate`; see the allow-list warning there.
   */
  achievements?: Record<string, number>;
  /**
   * Repeatable achievement id -> how many times its reward has been paid.
   *
   * Kept apart from `achievements` because the two answer different questions.
   * A one-shot's state is "when did this open"; a repeatable's is "how many
   * times has this paid". Folding both into one map would make every reader ask
   * which kind it is holding before it could use the number.
   *
   * Optional, no schema bump — and it MUST be named in `migrate` like the rest.
   */
  repeats?: Record<string, number>;
  /**
   * Shopping money handed out by achievements.
   *
   * Deliberately NOT part of `lifetimeOf`. Everything in that sum moves the egg
   * along, and an achievement is not something you earned by coding — putting it
   * there would hatch Pokemon for filling in the dex. It is also not
   * `lifetimeEarned`, which is the denominator `huntCap` divides: crediting
   * there would quietly raise the hunting ceiling as a side effect of an award.
   *
   * So it sits on the wallet side of the line this app already draws between
   * growth and money, and `wallet()` is the only function that reads it.
   */
  awardTokens?: number;
  /**
   * Trainer battles won, ever.
   *
   * Nothing else can answer "how many have I beaten": a win is recorded on a
   * `HuntEntry`, and `huntLog` keeps twenty of those — about a hundred minutes.
   * Replaying is not an option either, because `trainerBattleAt` needs the
   * moveset and form the companion had at the time and neither is written down.
   *
   * So this starts at zero on an existing save. That is honest rather than
   * ideal, and the achievements screen says so.
   */
  trainerWins?: number;
  /**
   * Gym badges earned, by badge number. 1..8 is Kanto.
   *
   * A sorted array rather than a Set because state.json is JSON, and keyed by
   * NUMBER rather than by leader id for the same reason `stones` is keyed by
   * form id: the number IS the upstream sprite's filename, and every region
   * numbers its badges 1..8 in gym order. One number is the save key, the
   * sprite and the display order at once.
   *
   * Nothing else in the save can re-derive a badge, so `migrate` dedupes,
   * sorts and clamps it rather than passing it through.
   *
   * Optional, so old saves need no migration — but it MUST still be named in
   * `migrate`; see the allow-list warning there.
   */
  badges?: number[];
  /**
   * Gym battles won, ever, rematches included.
   *
   * Separate from `trainerWins`, which a gym win also increments — a leader IS
   * a trainer, and a board that did not count the biggest trainer battles in
   * the game would start lying the day they shipped. This one exists because
   * `badges` caps at eight and stops moving, so it cannot measure the habit
   * the way a repeating achievement needs to.
   */
  gymWins?: number;
  /**
   * The Pokemon League party — up to six, drawn from the dex.
   *
   * The only save field that is a CHOICE rather than a tally, which is why it
   * has no self-healing floor in `migrate`: nothing else in the save can say
   * what six the player picked, so a lost write costs the picking, not the
   * Pokemon. Arming a member spends the machine, so `tms` moves with this.
   *
   * Optional, no schema bump — and it MUST be named in `migrate`.
   */
  party?: PartyMember[];
  /**
   * A league challenge in progress.
   *
   * `at` is which Elite Four member comes next (0..4) and `hp` is the party's
   * six bars as they stand. Cleared by a loss, by clearing the fifth, and by
   * walking out of 석영고원 — a challenge is something you finish where you
   * started it.
   */
  leagueRun?: { at: number; hp: number[] } | null;
  /** Region -> when its Hall of Fame was first reached, in ms. */
  leagues?: Record<string, number>;
  /** League runs cleared, ever. */
  leagueWins?: number;
  /**
   * Legendaries this save has actually MET in the wild, by species id.
   *
   * Written whether the fight was won or lost — meeting is the encounter, not
   * the outcome, and a Palkia that knocked you flat was still met. Nothing
   * else in the save can answer this: `legendEggs` records a WIN and empties
   * when the egg hatches, `dex` records a graduation, and a loss leaves no
   * trace at all.
   *
   * `server/shrines.ts` reads it. Optional, no schema bump, and `migrate`
   * floors it at what the save can already prove — see there.
   */
  metLegends?: number[];
  /**
   * The furthest a challenge has ever reached, 0..5.
   *
   * Most runs end in a loss, and a loss that leaves nothing behind gives the
   * screen nothing to say. This one number feeds both the "사천왕 돌파"
   * achievement and the case's "목호까지 갔다". It never goes down.
   */
  leagueBest?: number;
  /**
   * TMs picked up, ever.
   *
   * `tms` is a holding, not a record — teaching a move decrements it and deletes
   * the key at zero, so someone who taught every TM they found reads as having
   * found none. `migrate` floors this at the current holding, which is the same
   * self-healing trick `retiredCount` gets from `departedCount(dex)`.
   */
  tmsFound?: number;
  inventory: Partial<
    Record<
      'rare-candy' | 'shiny-charm' | 'everstone' | 'key-stone' | 'dynamax-band' | 'dna-splicers',
      number
    >
  >;
  /**
   * form id -> how many of that mega stone is held.
   *
   * Keyed by the FORM it opens rather than by an item slug, so a species with
   * two megas needs no naming scheme: Charizardite X is simply 10034.
   * Survives the companion, exactly as `tms` does — the stones are a collection
   * of their own, and losing them every graduation would make them pointless.
   */
  stones?: Record<number, number>;
  /**
   * Signature items for the legendaries, by PokeAPI slug.
   *
   * Keyed by slug rather than folded into `inventory` for the same reason
   * `stones` is keyed by form id: thirty-eight new literals in the hand-copied
   * `ItemId` union — which is spelled out twice, here and in shop.ts — is a
   * maintenance trap, and these are a collection to be checked rather than a
   * shelf to be bought from. Never consumed by holding; see `forcedNext`.
   */
  legendItems?: Record<string, number>;
  /**
   * Fragments, by the slug of the item they fuse into.
   *
   * The long road: `SHARDS_PER_ITEM` of them become the item. Only the handful
   * of gates marked `source: 'shards'` use this.
   */
  shards?: Record<string, number>;
  /**
   * Legendary eggs won in battle. speciesId -> count.
   *
   * Beating a legendary does not register it — the dex still means "raised and
   * graduated". It hands over an egg instead, so a legendary has to be brought
   * up like anything else.
   */
  legendEggs?: Record<number, number>;
  /**
   * The next hatch is this species, whatever the roll says.
   *
   * Set by using a legendary egg, read and cleared by the hatch branch — the
   * same lifetime `forcedRarity` and `shinyCharmActive` have.
   */
  forcedSpecies?: number | null;
  /**
   * An encounter reserved by using a signature item.
   *
   * The `seq` is stamped at use-time from `huntCount`, not left implicit: the
   * hunt loop replays a cursor range and two processes must reach the same
   * conclusion about WHICH encounter was claimed. "the next one" is not a fact
   * two writers can agree on; an absolute index is.
   */
  forcedNext?: { seq: number; speciesId: number } | null;
  /** Consumed by the next hatch. */
  shinyCharmActive: boolean;
  /** Set by an egg purchase; forces the next hatch's rarity, then clears. */
  forcedRarity: Rarity | null;
  /** While true the companion holds its current form. */
  everstone: boolean;
  /**
   * Draw the battle form on the floating pet and the panel.
   *
   * Purely cosmetic and read by nothing in the rules. A mega lasts one battle,
   * which is ten seconds of a five-minute cycle, and the floating pet is what
   * the app is actually looked at — so this is the switch that lets someone see
   * what they unlocked without pretending the transformation is permanent.
   */
  showBattleForm?: boolean;

  /**
   * Progress won by auto-hunting. Feeds progression only, never the wallet —
   * same rule as bonusTokens, so hunting cannot fund the shop.
   */
  huntTokens: number;
  /**
   * Clock origin for the encounter cursor. null means "not anchored yet", the
   * same first-sight convention `accrue` uses for lastTotal.
   */
  huntedAt: number | null;
  /** Encounters already settled into huntTokens. The replay cursor. */
  huntCount: number;
  /** move.id -> how many of that TM are held. Survives the companion. */
  tms: Record<number, number>;
  /** The most recent encounters, newest first. Capped; see HUNT_LOG_MAX. */
  huntLog: HuntEntry[];
  /**
   * Auto-hunt on/off. A game rule rather than a window preference, so it lives
   * here next to everstone and not in Prefs — buildState has no access to
   * Prefs, and Prefs is invisible on the web build.
   */
  huntEnabled: boolean;
  /**
   * Let hunting earn without the share ceiling.
   *
   * Off by default, because the ceiling is what stops a machine left running
   * from filling the dex on its own — see HUNT_SHARE. But that is a judgement
   * about how the app should feel, not a safety property, and it is the owner's
   * to make: the cap is cumulative and never decays, so someone who hunted a
   * lot early can find it permanently saturated with no way back.
   *
   * A game rule, so it lives here beside huntEnabled rather than in Prefs.
   */
  huntUncapped: boolean;
};

/**
 * What the companion IS, for the dex, its rarity, its learnset and the tray.
 *
 * A form never changes this. Raising a Black Kyurem is still raising a Kyurem,
 * and every one of those lookups is keyed on 1..1025.
 */
export function speciesIdOf(a: Companion): number {
  return a.pathIds[a.stageIndex];
}

/**
 * What the companion LOOKS like — the id the sprite, name and types come from.
 *
 * The whole form feature funnels through this one line. It returns a PokeAPI
 * pokemon id, and because a form's id IS its sprite id, `ensureSprite` needs no
 * change at all to draw one.
 */
export function displayIdOf(a: Companion): number {
  return a.formId ?? a.pathIds[a.stageIndex];
}

/**
 * Fusions the companion could perform right now.
 *
 * The dex is the box. There is exactly one companion at a time, so "you must
 * own both Pokemon" has to mean something else here, and the honest translation
 * is "you must have RAISED the other one" — which is precisely what the dex
 * records. Shininess is not required to match: the dex keys on (species, shiny)
 * and demanding a shiny Zekrom would put the fusion out of reach forever.
 */
export function fusionsAvailable(state: GameState): Form[] {
  const a = state.active;
  if (!a || a.formId !== undefined) return [];
  const owned = new Set(state.dex.map((d) => d.speciesId));
  return formsFrom(displayIdOf(a)).filter(
    (f) => f.kind === 'fusion' && f.partner !== undefined && owned.has(f.partner),
  );
}

/** Whether the bag holds one, for the two items that only need holding. */
function holds(state: GameState, item: 'key-stone' | 'dynamax-band'): boolean {
  return (state.inventory[item] ?? 0) > 0;
}

/**
 * The form the companion takes for this battle, or null.
 *
 * Pure in `state`, which is what lets `hunt` record it on the entry and the
 * scene replay it.
 *
 * The Key Stone and the Dynamax Band are PASSIVE: holding one is the whole
 * condition. They used to be worn toggles, copied from the everstone, and that
 * was wrong — an everstone is a thing you switch, while these two are a bracelet
 * and a band you simply own. Nothing about them ever wanted an off switch.
 *
 * Order is deliberate:
 *
 * 1. An everstone means "hold this shape", and that outranks both.
 * 2. A mega needs the Key Stone AND that species' own stone, as in the games.
 * 3. A gigantamax needs only the band, because it is a trait of the species.
 *
 * Mega before gigantamax, which is the opposite of what it was. With both items
 * passive there is no longer a band to take off, so whichever loses this
 * comparison becomes unreachable — and exactly four species can do both
 * (Venusaur, Charizard, Blastoise, Gengar). The mega is the one that had to be
 * EARNED: the band is a single purchase, while the stone had to turn up in the
 * grass under that very species. So the earned shape wins, and those four still
 * gigantamax right up until their stone is found.
 *
 * A species with two megas (Charizard X and Y) takes the lower id when both
 * stones are held. Arbitrary, but it must be deterministic: the same state has
 * to produce the same battle every time it is replayed.
 *
 * Ultra Burst is the one mega with no stone at all — see NO_ITEM in
 * scripts/gen-forms.ts — and getting a Necrozma fused in the first place is
 * what stands in for one.
 */
export function battleFormOf(state: GameState): Form | null {
  const a = state.active;
  if (!a || state.everstone) return null;
  const here = formsFrom(displayIdOf(a));
  if (holds(state, 'key-stone')) {
    const mega = here.find(
      (f) => f.kind === 'mega' && (!f.stone || (state.stones?.[f.id] ?? 0) > 0),
    );
    if (mega) return mega;
  }
  if (holds(state, 'dynamax-band')) {
    const gmax = here.find((f) => f.kind === 'gmax');
    if (gmax) return gmax;
  }
  return null;
}

/**
 * Why a form is not happening, for the panel to say out loud.
 *
 * Returns every form reachable from the companion's current shape, each with
 * what is still missing. The panel used to show a row only once EVERY condition
 * was met, which meant the one moment it had something useful to say was the
 * one moment it said nothing.
 */
export type FormChance = {
  form: Form;
  /** The stone this form needs, and whether it is held. Null when it needs none. */
  stone: { ko: string; have: boolean } | null;
  /** Whether the passive item for this kind is in the bag. */
  item: boolean;
  /** True when it would happen in the next battle. */
  ready: boolean;
};

export function formChances(state: GameState): FormChance[] {
  const a = state.active;
  if (!a) return [];
  return formsFrom(displayIdOf(a))
    .filter((f) => f.kind !== 'fusion')
    .map((f) => {
      const stone = f.stone ? { ko: f.stone.ko, have: (state.stones?.[f.id] ?? 0) > 0 } : null;
      const item = holds(state, f.kind === 'mega' ? 'key-stone' : 'dynamax-band');
      return { form: f, stone, item, ready: item && (!stone || stone.have) && !state.everstone };
    });
}

/**
 * The one definition of progression currency.
 *
 * This sum used to be written out longhand in three places — server/state.ts,
 * server/shop.ts and the two shop surfaces — and they only agreed by accident.
 * Adding a term to one and not the others silently corrupts `eggStartedAt`,
 * which turns the most expensive product in the shop into an instant hatch.
 *
 * `awardTokens` is deliberately absent, and that is the one omission here that
 * is not a bug. The three terms above are all progress — earned, bought, or
 * hunted. An achievement award is shopping money; see its field comment. Add it
 * here and finishing the dex starts hatching Pokemon.
 */
export function lifetimeOf(state: GameState): number {
  return state.lifetimeEarned + state.bonusTokens + state.huntTokens;
}

export function initialState(): GameState {
  return {
    schemaVersion: 4,
    lastTotal: {},
    lifetimeEarned: 0,
    hatchThreshold: 5_000_000,
    eggStartedAt: 0,
    active: null,
    dex: [],
    retiredCount: 0,
    spentTokens: 0,
    bonusTokens: 0,
    inventory: {},
    shinyCharmActive: false,
    forcedRarity: null,
    everstone: false,
    huntTokens: 0,
    huntedAt: null,
    huntCount: 0,
    tms: {},
    huntLog: [],
    huntEnabled: true,
    huntUncapped: false,
  };
}

/**
 * Fold a fresh scan total into the running earned counter.
 *
 * The transcript corpus is NOT monotonic. Claude Code prunes sessions older
 * than `cleanupPeriodDays`, and deleting a project drops its history outright,
 * so `totalTokens` can drop by hundreds of millions overnight. v2 compared the
 * live total against a fixed install baseline, which meant one prune froze the
 * pet until the user re-earned everything that had been deleted — the tray kept
 * showing today's tokens (it never consulted the baseline) while the bar sat at
 * zero forever.
 *
 * Counting forward deltas instead makes progress monotonic: a shrunken corpus
 * contributes nothing and simply re-anchors, so the very next token counts.
 */
export function accrue(
  state: GameState,
  totalTokens: number,
  mode: CountMode = 'activity',
): { state: GameState; changed: boolean } {
  const prev = state.lastTotal[mode];
  const lastTotal = { ...state.lastTotal, [mode]: totalTokens };
  // First sight of the corpus: anchor on it. What is already on disk is history,
  // not progress — counting it would max out a fresh companion instantly.
  if (prev == null) return { state: { ...state, lastTotal }, changed: true };
  if (totalTokens === prev) return { state, changed: false };
  return {
    state: { ...state, lastTotal, lifetimeEarned: state.lifetimeEarned + Math.max(0, totalTokens - prev) },
    changed: true,
  };
}

/** The games allow twelve characters. No reason to differ. */
export const NICKNAME_MAX = 12;

/**
 * Give the companion a name, or clear it.
 *
 * Pure, and the same ShopResult contract the shop uses — never throws, returns
 * the unchanged state on refusal, message is what the user reads.
 *
 * Control characters are stripped rather than rejected: they arrive from paste,
 * not from typing, and silently cleaning them is friendlier than a complaint
 * about something the user cannot see.
 */
export function rename(state: GameState, raw: string): { state: GameState; ok: boolean; message: string } {
  const active = state.active;
  if (!active) return { state, ok: false, message: '아직 포켓몬이 없습니다.' };

  // Cleaned, then trimmed, then cut BY CODE POINT.
  //
  // Filtering by code point rather than a control-character regex keeps the
  // intent readable. The cut has to happen on the code-point array too: a plain
  // String.slice counts UTF-16 units, so a twelve-unit budget only fits six
  // emoji. Trim before cutting, or leading spaces eat into the allowance.
  const cleaned = [...String(raw ?? '')]
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return c > 0x1f && c !== 0x7f;
    })
    .join('')
    .trim();
  const name = [...cleaned].slice(0, NICKNAME_MAX).join('');

  if (!name) {
    if (active.nickname === undefined) {
      return { state, ok: false, message: '이미 원래 이름입니다.' };
    }
    const { nickname: _drop, ...rest } = active;
    void _drop;
    return { state: { ...state, active: rest }, ok: true, message: '원래 이름으로 되돌렸습니다.' };
  }
  if (name === active.nickname) return { state, ok: false, message: '같은 이름입니다.' };
  return {
    state: { ...state, active: { ...active, nickname: name } },
    ok: true,
    message: `이제 ${name}입니다.`,
  };
}

/**
 * Draw the battle form outside of battle, or stop.
 *
 * A game-state field rather than a Prefs one, for the same reason `huntEnabled`
 * is: `buildState` cannot see Prefs, and Prefs does not exist on the web build.
 * It changes nothing about how a battle resolves — it decides which sprite the
 * floating pet and the panel ask for, and that is all.
 */
export function setShowBattleForm(
  state: GameState,
  on: boolean,
): { state: GameState; ok: boolean; message: string } {
  if ((state.showBattleForm ?? false) === on) {
    return { state, ok: false, message: on ? '이미 켜져 있습니다.' : '이미 꺼져 있습니다.' };
  }
  return {
    state: { ...state, showBattleForm: on },
    ok: true,
    message: on ? '배틀 모습으로 보여줍니다.' : '평소 모습으로 되돌립니다.',
  };
}

/**
 * Pick a hatch threshold from how much this user actually burns.
 *
 * A fixed threshold is wrong for everyone: 5M is minutes for a heavy user and
 * weeks for a light one. Averaging over ACTIVE days (not calendar days) keeps
 * long idle gaps from deflating it.
 */
export function calibrateHatchThreshold(byDay: Record<string, number>): number {
  // Sort by date key first. Object key order is insertion order, and byDay is
  // built in file-scan order, so slicing it directly would pick arbitrary days.
  const recent = Object.entries(byDay)
    .filter(([, v]) => v > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(-7)
    .map(([, v]) => v);
  if (recent.length === 0) return 5_000_000;
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  return Math.round(Math.min(50_000_000, Math.max(2_000_000, avg * 0.15)));
}

/** Tokens needed to leave `stageIndex`. Stages get progressively longer. */
export function tokensForStage(stageIndex: number, rarity: Rarity, hatchThreshold: number): number {
  const mult = RARITY_MULT[rarity];
  const curve = stageIndex === 0 ? 4 : 12;
  return Math.round(hatchThreshold * curve * mult);
}

/** Tokens a final-form companion must earn before it graduates to the dex. */
export function tokensForRetirement(rarity: Rarity, hatchThreshold: number): number {
  return Math.round(hatchThreshold * 20 * RARITY_MULT[rarity]);
}

/** Deterministic RNG so hatch/shiny rolls are testable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rarity odds for a fresh roll. Exported so hunting can normalise against it. */
export const BUCKET_WEIGHTS: [Rarity, number][] = [
  ['common', 60],
  ['uncommon', 25],
  ['rare', 12],
  ['legendary', 3],
];

/** Weighted by rarity bucket, then uniform inside it. */
export function rollSpecies(
  rng: () => number,
  exclude: Set<number> = new Set(),
  forced: Rarity | null = null,
): SpeciesLine {
  const total = BUCKET_WEIGHTS.reduce((a, [, w]) => a + w, 0);
  let pick = rng() * total;
  let bucket: Rarity = 'common';
  for (const [r, w] of BUCKET_WEIGHTS) {
    if (pick < w) { bucket = r; break; }
    pick -= w;
  }
  // A purchased egg guarantees its tier as a FLOOR, not an exact match: a roll
  // that already beat what you paid for is kept. So the rare egg can still hand
  // back a legendary, and the cheapest egg — floor 'common' — guarantees nothing
  // at all and is sold as the plain swap it is.
  if (forced && RARITY_ORDER.indexOf(bucket) < RARITY_ORDER.indexOf(forced)) {
    bucket = forced;
  }

  const inBucket = LINES.filter((l) => rarityOf(l.captureRate) === bucket);
  const pool = inBucket.length ? inBucket : LINES;
  // Prefer lines not yet collected, but never dead-end once the dex fills up.
  const fresh = pool.filter((l) => !l.paths.some((p) => exclude.has(p[0])));
  const finalPool = fresh.length ? fresh : pool;
  return finalPool[Math.floor(rng() * finalPool.length)];
}

export type GameEvent =
  | { kind: 'hatched'; speciesId: number; shiny: boolean; rarity: Rarity }
  | { kind: 'evolved'; from: number; to: number }
  | { kind: 'retired'; speciesId: number };

/**
 * Drive the companion forward to match `lifetimeTokens`.
 *
 * Pure: same inputs, same outputs. Loops because a long gap (app closed for a
 * week) can cross several thresholds at once.
 */
export function advance(
  state: GameState,
  lifetimeTokens: number,
  rng: () => number,
): { state: GameState; events: GameEvent[] } {
  let s: GameState = { ...state, dex: [...state.dex] };
  const events: GameEvent[] = [];

  // Safety valve: a corrupt threshold could otherwise spin forever.
  for (let guard = 0; guard < 100; guard++) {
    if (!s.active) {
      if (lifetimeTokens - s.eggStartedAt < s.hatchThreshold) break;
      /**
       * A legendary egg names its species outright.
       *
       * Read before the roll and cleared with it, exactly as `forcedRarity` and
       * `shinyCharmActive` are. The roll still HAPPENS — `rollSpecies` and the
       * path draw both run — because skipping them would shift every later draw
       * in this stream and re-roll the shiny and the nature below.
       */
      const forcedLine = s.forcedSpecies != null ? lineOf(s.forcedSpecies) : null;
      const line = rollSpecies(rng, new Set(s.dex.map((d) => d.speciesId)), s.forcedRarity);
      const rolledPath = line.paths[Math.floor(rng() * line.paths.length)];
      // The path that actually ENDS at the promised species, so a legendary egg
      // hatches the legendary rather than something earlier in its line.
      const pathIds =
        forcedLine?.paths.find((p) => p.includes(s.forcedSpecies!)) ??
        (forcedLine ? forcedLine.paths[0] : rolledPath);
      const rarity = rarityOf((forcedLine ?? line).captureRate);
      // Deterministic, so it takes no draw and cannot shift the shiny roll below.
      const starter = starterMove(pathIds[0]);
      // A Shiny Charm is spent on this hatch whether or not it pays off.
      const odds = s.shinyCharmActive ? SHINY_ODDS / 8 : SHINY_ODDS;
      const isShiny = rng() < 1 / odds;
      s.shinyCharmActive = false;
      s.forcedRarity = null;
      s.forcedSpecies = null;
      const bornAt = s.eggStartedAt + s.hatchThreshold;
      s.active = {
        pathIds,
        stageIndex: 0,
        isShiny,
        rarity,
        nature: NATURES[Math.floor(rng() * NATURES.length)],
        bornAt,
        tokensAtStageStart: bornAt,
        // Hunting is settled before advance() is called, so these are the
        // counters as of this very tick — this companion starts at zero.
        huntTokensAtBirth: s.huntTokens,
        huntCountAtBirth: s.huntCount,
        // Born knowing one attack, as they are in the games. Without it a fresh
        // companion swung the generic fallback for the two hours it takes a TM
        // to drop — and worse, teaching it a single status move used to leave it
        // unable to hurt anything at all.
        moves: starter === null ? [] : [starter],
      };
      events.push({ kind: 'hatched', speciesId: pathIds[0], shiny: isShiny, rarity });
      continue;
    }

    const a = s.active;

    // Everstone holds the companion exactly as it is: it neither evolves nor
    // graduates to the dex. Progress simply sits at full until it comes off.
    if (s.everstone) break;

    const atFinalStage = a.stageIndex >= a.pathIds.length - 1;
    const earned = lifetimeTokens - a.tokensAtStageStart;

    if (!atFinalStage) {
      const need = tokensForStage(a.stageIndex, a.rarity, s.hatchThreshold);
      if (earned < need) break;
      const from = a.pathIds[a.stageIndex];
      const to = a.pathIds[a.stageIndex + 1];
      s.active = {
        ...a,
        stageIndex: a.stageIndex + 1,
        tokensAtStageStart: a.tokensAtStageStart + need,
      };
      events.push({ kind: 'evolved', from, to });
      continue;
    }

    const need = tokensForRetirement(a.rarity, s.hatchThreshold);
    if (earned < need) break;
    const speciesId = a.pathIds[a.stageIndex];
    // Every form it passed through goes in, not just the one that left.
    s.dex = retireInto(s.dex, a, Date.now());
    s.retiredCount += 1;
    s.active = null;
    s.eggStartedAt = a.tokensAtStageStart + need;
    events.push({ kind: 'retired', speciesId });
  }

  return { state: s, events };
}

/** Progress toward the next milestone, for the UI bar. */
export function progress(state: GameState, lifetimeTokens: number) {
  if (!state.active) {
    const need = state.hatchThreshold;
    const have = Math.max(0, lifetimeTokens - state.eggStartedAt);
    return { phase: 'egg' as const, have, need, ratio: Math.min(1, have / need) };
  }
  const a = state.active;
  const atFinal = a.stageIndex >= a.pathIds.length - 1;
  const need = atFinal
    ? tokensForRetirement(a.rarity, state.hatchThreshold)
    : tokensForStage(a.stageIndex, a.rarity, state.hatchThreshold);
  const have = Math.max(0, lifetimeTokens - a.tokensAtStageStart);
  return {
    phase: (atFinal ? 'final' : 'growing') as 'final' | 'growing',
    have,
    need,
    ratio: Math.min(1, have / need),
  };
}
