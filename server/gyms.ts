import { LEG_LENGTH, STOPS } from '../src/journey.ts';
import { rarityOfSpecies } from './dex.ts';
import type { PartyMember } from './game.ts';
import {
  BADGE_IDS,
  MIN_LEAGUE_SIZE,
  REGIONS,
  type GymRow,
  type LeagueRow,
  type RegionKo,
  type RegionRow,
} from './gymdata.ts';
import { BATTLE_MAX_HP, TACKLE, battleAt, type Battle, type BattleOpts } from './hunt.ts';
import { TRAINER_ROUND_TURNS, type Trainer } from './trainer.ts';

export { BADGE_IDS, MIN_LEAGUE_SIZE, REGIONS };
export type { GymRow, LeagueRow, RegionKo, RegionRow };

/**
 * Counter damage per turn in a league round, as a share of one party bar.
 *
 * The trainer share (0.085) unchanged. It is named separately only so the two
 * can be tuned apart later without one silently moving the other — the league
 * is twenty-six opponents against six bars, where the gyms are five against
 * one, and they will not stay balanced by the same number for ever.
 */
const LEAGUE_COUNTER_SHARE = 0.085;

/**
 * Where in a leg a challenge falls. Three of them, twenty-five minutes apart.
 *
 * One shot per visit would make a loss cost a whole lap — five weeks of
 * continuous uptime, and a good deal more at a realistic eight hours a day.
 * Three keeps the cost of losing at an afternoon while leaving it a real cost.
 *
 * Sized to `LEG_LENGTH`, which is fifteen. They were 3/11/19 when a leg was
 * twenty-five encounters long, and the last of the three simply stopped
 * happening when the route grew and the leg shrank — a leader you could only
 * challenge twice, with nothing on screen to say so. `test/gyms.test.ts`
 * asserts the count for exactly that reason.
 */
export const GYM_OFFSETS = [2, 7, 12] as const;

/** A beaten leader offers one rematch per visit, at his own city. */
export const REMATCH_OFFSET = 2;

/** What a gym win pays, over the ordinary trainer formula. */
export const GYM_BONUS = 2;

/**
 * Kanto, by name.
 *
 * Named rather than reached for through `regionById('kanto')!` at each call
 * site, because a Kanto-specific reference is legitimate in two places and
 * nowhere else: the payload, until it grows a region dimension of its own, and
 * the tests that assert facts about the Red/Green/Blue rosters. Everything that
 * is about "the region the pet is in" uses `regionAt` instead, and the
 * difference between the two is exactly what this name makes visible.
 */
export const KANTO: RegionRow = REGIONS.find((r) => r.id === 'kanto')!;

/** Every gym of every region, flat. What a table test wants to sweep. */
export const ALL_GYMS: readonly GymRow[] = REGIONS.flatMap((r) => r.gyms);

/** Every league member of every region, flat. */
export const ALL_LEAGUE: readonly LeagueRow[] = REGIONS.flatMap((r) => r.league);

/** One region's contiguous stretch of the route. */
export type Block = { ko: string; first: number; last: number };

/**
 * The route's region blocks, in route order, derived from `STOPS`.
 *
 * ALL TEN, including 히스이 — it is on the route even though it has no
 * campaign, and `regionOfStop` has to be able to say "this stop has a region,
 * and that region has no campaign" rather than confusing the two.
 *
 * Contiguity is ASSERTED below, not assumed. `src/journey.ts` is generated, and
 * a generator change that interleaved two regions would silently make a block
 * span stops it does not contain — which is the exact class of failure this
 * file's resolve-by-name-inside-a-region discipline exists to prevent, so it is
 * checked loudly in the same place.
 */
export const BLOCKS: readonly Block[] = (() => {
  const out: Block[] = [];
  STOPS.forEach((s, i) => {
    const open = out.at(-1);
    if (open && open.ko === s.region) {
      open.last = i;
      return;
    }
    if (out.some((b) => b.ko === s.region)) {
      throw new Error(`journey.ts: ${s.region} is not contiguous — stop ${i} reopens it`);
    }
    out.push({ ko: s.region, first: i, last: i });
  });
  return out;
})();

/**
 * The stop index of `city` INSIDE `regionKo`'s block, or -1.
 *
 * The whole reason this exists rather than a bare `findIndex`: stop names are
 * not unique. Seventeen names repeat across the route, including every league
 * plateau but Kanto's — `포켓몬리그` is stops 143 (호연), 382 (칼로스) and 450
 * (알로라), and `포켓몬 리그`, with a space, is 175 (신오), 276 (하나) and 650
 * (팔데아). `STOPS.findIndex((s) => s.ko === city)` answers 143 for all six.
 */
export function stopInRegion(regionKo: string, city: string): number {
  return STOPS.findIndex((s) => s.ko === city && s.region === regionKo);
}

/** The stop INDEX, where `journeyFor` answers with the Stop itself. */
export function stopIndexOf(seq: number): number {
  const n = Number.isFinite(seq) ? Math.max(0, Math.floor(seq)) : 0;
  return Math.floor(n / LEG_LENGTH) % STOPS.length;
}

/** Per-region indexes, resolved once. A city the route does not carry is a bug, not a fallback. */
type RegionIndex = {
  region: RegionRow;
  first: number;
  last: number;
  byOrder: GymRow[];
  stopOf: Map<string, number>;
  byStop: Map<number, GymRow>;
  leagueStop: number | null;
};

const INDEX: Map<string, RegionIndex> = new Map(
  REGIONS.map((region) => {
    const first = STOPS.findIndex((s) => s.region === region.ko);
    const last = STOPS.reduce((acc, s, i) => (s.region === region.ko ? i : acc), -1);
    if (first < 0) throw new Error(`gymdata.ts: ${region.ko} is not a region on the journey`);

    const stopOf = new Map<string, number>();
    for (const g of region.gyms) {
      if (g.region !== region.ko) {
        throw new Error(`gymdata.ts: ${g.id} says ${g.region} but sits in ${region.ko}`);
      }
      const i = stopInRegion(region.ko, g.city);
      if (i < 0) throw new Error(`gymdata.ts: ${g.city} is not in ${region.ko} on the journey`);
      stopOf.set(g.id, i);
    }

    let leagueStop: number | null = null;
    if (region.leagueCity !== null) {
      const i = stopInRegion(region.leagueIn, region.leagueCity);
      if (i < 0) {
        throw new Error(`gymdata.ts: ${region.leagueCity} is not in ${region.leagueIn} on the journey`);
      }
      leagueStop = i;
    }

    return [
      region.ko,
      {
        region,
        first,
        last,
        byOrder: [...region.gyms].sort((a, b) => a.order - b.order),
        stopOf,
        byStop: new Map(region.gyms.map((g) => [stopOf.get(g.id)!, g])),
        leagueStop,
      },
    ];
  }),
);

/**
 * No region's league city may be any region's gym city.
 *
 * `server/hunt.ts` checks the league branch ABOVE the gym branch, and argues
 * that is safe because a plateau is not a gym city, so the only leader who
 * could stand there is one still being pursued — and pursuit is only possible
 * below a full badge set, which is exactly when the league is shut. That
 * argument generalises only under this invariant. Without it a leader pursuing
 * you through region B could stand at region A's plateau while A's league
 * runs, and the gym would be silently swallowed: a lost badge with nothing on
 * screen to explain it.
 */
(() => {
  const gymCities = new Set(ALL_GYMS.map((g) => g.city));
  for (const r of REGIONS) {
    if (r.leagueCity !== null && gymCities.has(r.leagueCity)) {
      throw new Error(`gymdata.ts: ${r.leagueCity} is both a league city and a gym city`);
    }
  }
})();

const BY_ID = new Map(ALL_GYMS.map((g) => [g.id, g]));

export function gymById(id: string): GymRow | null {
  return BY_ID.get(id) ?? null;
}

export function regionById(id: string): RegionRow | null {
  return REGIONS.find((r) => r.id === id) ?? null;
}

export function regionByKo(ko: string): RegionRow | null {
  return REGIONS.find((r) => r.ko === ko) ?? null;
}

/**
 * The campaign region containing this stop, or null.
 *
 * Null for 히스이, and for nothing else while every other region has a row —
 * which is what makes the staged rollout a data edit: a region whose table is
 * not written yet simply answers null here, and every query below goes quiet
 * for it without a single branch of its own.
 */
export function regionOfStop(stop: number): RegionRow | null {
  for (const ix of INDEX.values()) {
    if (stop >= ix.first && stop <= ix.last) return ix.region;
  }
  return null;
}

/** `regionOfStop(stopIndexOf(seq))`. The form the hunt loop wants. */
export function regionAt(seq: number): RegionRow | null {
  return regionOfStop(stopIndexOf(seq));
}

/** How many of `region`'s badges this save holds. */
export function badgesInRegion(region: RegionRow, badges: ReadonlySet<number>): number {
  let held = 0;
  for (const g of region.gyms) if (badges.has(g.badge)) held++;
  return held;
}

/** Does this save hold every badge `region` can hand over? */
export function regionSwept(region: RegionRow, badges: ReadonlySet<number>): boolean {
  return region.gyms.length > 0 && region.gyms.every((g) => badges.has(g.badge));
}

/**
 * The leader standing in the way right now, or null.
 *
 * The lowest-order leader who is eligible, unbeaten, and whose city is at or
 * behind the current stop. The last clause is what turns a fixed appointment
 * into a pursuit: 비주기's gym is the second stop in Kanto and he is the eighth
 * challenge, so without it the Earth Badge would always be a lap away. He
 * catches up instead, which is what the games have him do anyway — 상록체육관
 * is shut while you walk past it and opens once you hold the other seven.
 *
 * Eligibility is one rule, not eight: a leader of order N wants N-1 badges
 * FROM HIS OWN REGION. That is the games' Viridian lock generalised, and it
 * costs nothing on the other seven because the standing leader is by
 * construction the lowest unbeaten one.
 *
 * The per-region count is the one semantic change the region work makes here,
 * and it is the one that matters. This read the GLOBAL count, which is the same
 * number while Kanto is the only region and becomes a ladder that collapses the
 * moment a second one lands: a player carrying Kanto's eight into 성도 would
 * satisfy `held < order - 1` for all eight Johto leaders at once and be handed
 * the whole region's eligibility on arrival.
 */
export function standingGym(seq: number, badges: ReadonlySet<number>): GymRow | null {
  const stop = stopIndexOf(seq);
  const region = regionOfStop(stop);
  if (!region) return null;
  const ix = INDEX.get(region.ko)!;
  const held = badgesInRegion(region, badges);
  for (const g of ix.byOrder) {
    if (badges.has(g.badge)) continue;
    // Not enough badges for this one, and everyone before is beaten: nobody stands.
    if (held < g.order - 1) return null;
    return ix.stopOf.get(g.id)! <= stop ? g : null;
  }
  return null;
}

/**
 * Is `seq` a gym challenge, and against whom?
 *
 * Pure in `(seq, badges)` and takes no draw at all — the whole reason this file
 * needs no RNG salt of its own.
 *
 * A pending leader outranks a rematch, so a leg never offers two named fights.
 */
export function gymAt(seq: number, badges: ReadonlySet<number>): GymRow | null {
  const off = ((Math.max(0, Math.floor(seq)) % LEG_LENGTH) + LEG_LENGTH) % LEG_LENGTH;
  const stop = stopIndexOf(seq);
  const region = regionOfStop(stop);
  if (!region) return null;
  const ix = INDEX.get(region.ko)!;

  const standing = standingGym(seq, badges);
  if (standing) return GYM_OFFSETS.includes(off as (typeof GYM_OFFSETS)[number]) ? standing : null;

  // Nobody is pending, so a leader whose badge is already held will spar.
  if (off !== REMATCH_OFFSET) return null;
  const home = ix.byStop.get(stop);
  return home && badges.has(home.badge) ? home : null;
}

/**
 * A leader as a `Trainer`, so the battle, the scene and the panel's replay all
 * work with no changes at all.
 *
 * `관장` rather than the city: `회색시티 관장 웅` is eleven characters exactly,
 * and `test/trainer.test.ts` caps names at eleven because `rewardPages` builds
 * one-row lines on it. Sitting on the boundary is not a margin. The city has
 * room on the badge case and the log row instead.
 *
 * The title comes off the row rather than being a constant, because Alola's
 * four are 섬킹 and 섬퀸 and are not interchangeable with each other.
 */
export function gymTrainer(row: GymRow): Trainer {
  const title = row.title ?? '관장';
  return {
    className: title,
    name: `${title} ${row.ko}`,
    gender: row.gender,
    sprite: row.sprite,
    team: row.team,
    grit: row.grit,
  };
}

/**
 * Is this gym shut for want of badges?
 *
 * True for 비주기 until the other seven are held, and never for anyone else —
 * the eligibility rule is `order - 1` badges from the same region and the
 * standing leader is always the lowest unbeaten one, so nobody but a region's
 * last can ever be short. The badge case says so rather than leaving a blank
 * slot unexplained.
 */
export function gymLocked(row: GymRow, badges: ReadonlySet<number>): boolean {
  const region = regionByKo(row.region);
  if (!region) return false;
  return !badges.has(row.badge) && badgesInRegion(region, badges) < row.order - 1;
}

/**
 * Encounters until the pet next stands at stop `target`, or 0 if it is there now.
 *
 * What turns waiting into something to read. The badge case draws "연분홍시티
 * 까지 40조우" from this, which is the same job the egg gauge and every
 * achievement bar already do — and the honest answer for someone who installed
 * this update while walking through 칼로스 is a number, not a blank.
 *
 * Takes an INDEX, not a city name. The name-shaped version of this function was
 * the duplicate-name bug in exported form: six regions' plateaux share two
 * names between them, and a bare `findIndex` gave all six to 호연. The two
 * callers both hold a row, so the fix is to make the wrong call impossible to
 * write rather than to document it.
 */
export function encountersUntilStop(huntCount: number, target: number): number {
  if (target < 0) return 0;
  const n = Number.isFinite(huntCount) ? Math.max(0, Math.floor(huntCount)) : 0;
  const legs = (target - stopIndexOf(n) + STOPS.length) % STOPS.length;
  return legs === 0 ? 0 : legs * LEG_LENGTH - (n % LEG_LENGTH);
}

/** Encounters until the pet stands in this leader's city. */
export function encountersUntilGym(huntCount: number, row: GymRow): number {
  const ix = INDEX.get(row.region);
  return encountersUntilStop(huntCount, ix?.stopOf.get(row.id) ?? -1);
}

/** Encounters until the pet stands where this region's league is held. */
export function encountersUntilLeague(huntCount: number, region: RegionRow): number {
  return encountersUntilStop(huntCount, INDEX.get(region.ko)?.leagueStop ?? -1);
}

/**
 * What beating a leader is worth, as a multiplier on one ordinary encounter.
 *
 * `trainerReward`'s own formula times GYM_BONUS. That formula already scales
 * with the two things that make a leader hard, so there is nothing to invent —
 * and it still passes through `huntCap` at the call site, exactly as a route
 * trainer's payout does. No item roll here: a gym leader handing over an
 * everstone is odd, and the badge and its TM are the prize.
 */
export function gymReward(row: Pick<GymRow, 'team' | 'grit'>): number {
  return 3 * row.team.length * row.grit * GYM_BONUS;
}

// ── 포켓몬리그 ─────────────────────────────────────────────────────────────

/**
 * Where in the leg a CHALLENGE MAY START. Three, twenty-five minutes apart.
 *
 * Once a run is under way every encounter in the leg is its next member, so
 * these gate only the beginning — and the last of them has to leave room for
 * all five. A leg is fifteen encounters, so a run begun at 10 ends at 14, on
 * the last encounter before the pet walks out of 석영고원 and the run is wiped.
 */
export const LEAGUE_OFFSETS = [0, 5, 10] as const;

/**
 * Seed base for a league round.
 *
 * Wild encounters use `seq`, trainer rounds `1e9`, legendary fights `2e9`.
 * Far past any of them, and past 26 rounds' worth of room per encounter.
 *
 * Deliberately NOT offset per region. Two leagues can share a stop — 석영고원
 * holds Kanto's and Johto's — but `leagueAt` returns exactly one of them for
 * any given save, so there is nothing to collide. A per-region offset would
 * buy nothing and reshape every existing player's league history.
 */
const LEAGUE_SEED_BASE = 3_000_000_000;

const BY_LEAGUE_ID = new Map(ALL_LEAGUE.map((m) => [m.id, m]));

export function leagueById(id: string): LeagueRow | null {
  return BY_LEAGUE_ID.get(id) ?? null;
}

/**
 * Is the pet standing where SOME league is held?
 *
 * Kept boolean and kept badge-free, because that is the exact question
 * `server/hunt.ts` asks when it decides whether a run in progress survives the
 * batch. A run is something you finish where you started it; whether you were
 * ever ELIGIBLE is a different question with a different answer.
 */
export function atLeague(seq: number): boolean {
  const stop = stopIndexOf(seq);
  for (const ix of INDEX.values()) if (ix.leagueStop === stop) return true;
  return false;
}

/** Every league standing at this stop, in `REGIONS` order. 0 or 1, except 석영고원's 2. */
export function leaguesAt(seq: number): RegionRow[] {
  const stop = stopIndexOf(seq);
  return REGIONS.filter((r) => INDEX.get(r.ko)?.leagueStop === stop);
}

/**
 * The league a save may challenge here, or null.
 *
 * Pure in its three arguments and takes no draw, exactly as `gymAt` is.
 *
 * The rule at a shared stop is one rule, not a table: the first ELIGIBLE league
 * in `REGIONS` order that has not been cleared, and if every eligible one has
 * been cleared, the LAST eligible one.
 *
 * 석영고원 will hold Kanto's Elite Four and Johto's, and the only thing that
 * tells them apart is which region's badges the save holds. Route order means
 * Kanto is always eligible first, so "first uncleared" hands Kanto's league to
 * a save that has never won it and Johto's to one that has. Falling back to the
 * last eligible keeps the league re-runnable once both are in the Hall of Fame
 * — a cleared league has to re-open, and the harder of the two is the honest
 * one to re-offer.
 */
export function leagueAt(
  seq: number,
  badges: ReadonlySet<number>,
  leagues: Readonly<Record<string, number>>,
): RegionRow | null {
  const here = leaguesAt(seq).filter((r) => r.league.length > 0 && regionSwept(r, badges));
  if (here.length === 0) return null;
  return here.find((r) => leagues[r.id] === undefined) ?? here[here.length - 1];
}

/** May a fresh challenge begin at this encounter? */
export function leagueStartAt(seq: number): boolean {
  if (!atLeague(seq)) return false;
  const off = ((Math.max(0, Math.floor(seq)) % LEG_LENGTH) + LEG_LENGTH) % LEG_LENGTH;
  return (LEAGUE_OFFSETS as readonly number[]).includes(off);
}

export type LeagueRound = {
  /** One per opponent fought. Shorter than the member's team if the party fell. */
  rounds: Battle[];
  /** The party's HP after, bar by bar. */
  hp: number[];
  won: boolean;
  /** Which party member was out for each round — the scene swaps art on this. */
  outFor: number[];
};

/**
 * Fight one Elite Four member with a party of six.
 *
 * Composed from `battleAt` rather than folded into it, for the same three
 * reasons `trainerBattleAt` gives — the felling last turn, MAX_TURNS, the
 * global turn index. The one thing that is new is on my side of the field:
 * six bars instead of one, and a bar at zero hands over to the next.
 *
 * The turn budget is `TRAINER_ROUND_TURNS`, unchanged. Measured across sixty
 * thousand league losses, not one came from running out of turns — every
 * single one was an HP knockout — so a longer budget buys the opponent extra
 * counter-attacks and nothing else.
 *
 * HP arrives from the caller and leaves in the return, so it can carry across
 * the five encounters a full run takes without this function knowing about
 * them.
 */
export function leagueRoundAt(
  seq: number,
  member: LeagueRow,
  party: PartyMember[],
  startHp: number[],
  boosts: BattleOpts = {},
): LeagueRound {
  const hp = [...startHp];
  const rounds: Battle[] = [];
  const outFor: number[] = [];
  let cur = hp.findIndex((h) => h > 0);
  /** Global round index, so two rounds against the same opponent differ. */
  let r = 0;

  for (const foe of member.team) {
    let felled = false;
    // An opponent does not go away because one of my six ran out. It stays,
    // and the next bar comes in against it — which is the whole reason six
    // bars are worth more than one big one, and the reason this is a `while`
    // rather than one round per opponent.
    while (!felled) {
      if (cur < 0) return { rounds, hp, won: false, outFor };
      const me = party[cur];
      const round = battleAt(LEAGUE_SEED_BASE + seq * 32 + r, rarityOfSpecies(foe), me.moves, foe, {
        startHp: hp[cur],
        budget: TRAINER_ROUND_TURNS,
        targetTurns: TRAINER_ROUND_TURNS,
        // A fixed pool, as a trainer round uses: what beats the league is the
        // moveset you assembled, not how hard your species happens to swing.
        swingRef: TACKLE.power,
        floor: false,
        counterHit: Math.max(1, Math.round(BATTLE_MAX_HP * LEAGUE_COUNTER_SHARE * member.grit)),
        grit: member.grit,
        mySpeciesId: me.speciesId,
        ...boosts,
      });
      rounds.push(round);
      outFor.push(cur);
      r++;

      const last = round.turns.at(-1);
      hp[cur] = Math.max(0, last?.myHpAfter ?? hp[cur]);
      felled = (last?.foeHpAfter ?? 0) === 0;
      // Out of turns with the opponent still standing spends that bar. It is
      // also what makes this loop terminate: every pass either fells an
      // opponent or empties a bar, so the whole fight is at most
      // `team.length + party.length` rounds.
      if (!felled) hp[cur] = 0;
      if (hp[cur] <= 0) cur = hp.findIndex((h) => h > 0);
    }
  }

  return { rounds, hp, won: true, outFor };
}

/** What clearing the whole league is worth, as a multiplier on one encounter. */
export const LEAGUE_REWARD = 25;
