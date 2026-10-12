import { mulberry32, MAX_LEVEL, type Companion, type PartyMember } from './game.ts';
import { clampLevel, rollIvs, type Ivs } from './fight.ts';
import { REGIONS, type GymRow, type LeagueRow } from './gymdata.ts';

/**
 * Who fights at what level, and with which IVs.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 * Everything is measured from the companion's own level, because the
 * companion's level is what the user has worked for, and an opponent pinned
 * to a number of its own would either flatten a fresh hatchling or be
 * flattened by a veteran. Measured from it, every fight stays winnable AND
 * losable at every level, which is the promise the grit tuning makes.
 *
 *   야생 · 전설     companion ± 10, uniform
 *   길 위 트레이너  companion ± 5, member by member
 *   관장           ace at companion + 0..5 by badge order, the rest 2 below
 *   사천왕 · 챔피언  ace at the party's level + 5..8 by rank, the rest 3 below
 *
 * Every result is clamped to 1..100.
 *
 * ── Pure, like the rest of the hunt ───────────────────────────────────────
 * Each draw is a function of the encounter index and the companion's level,
 * from a salt of its own, so nothing here shifts which Pokemon was met or who
 * won a trainer's coin. A replay recomputes exactly the same numbers from the
 * level recorded on the log entry (`HuntEntry.mine.level`).
 * ──────────────────────────────────────────────────────────────────────────
 */

/** How far either side of the companion a wild Pokemon's level falls. */
export const WILD_LEVEL_SPREAD = 10;

/** The same, for a route trainer's team, member by member. */
export const TRAINER_LEVEL_SPREAD = 5;

/** How far above the companion a region's last leader's ace stands. The first's stands level. */
export const GYM_ACE_MAX = 5;

/** A leader's team below its ace. The games put the ace a step above the rest. */
export const GYM_REST_BELOW = 2;

/** The first Elite Four member's ace above the party, and the champion's. */
export const LEAGUE_ACE_MIN = 5;
export const LEAGUE_ACE_MAX = 8;

/** A league member's team below its ace. */
export const LEAGUE_REST_BELOW = 3;

/**
 * A seventh RNG salt: levels and IVs.
 *
 * The other six are the encounter, the battle, the hatch, the trainer, the
 * stone and the legendary rolls. `+ 11` keeps the gap the legend salt left.
 */
function levelRng(seq: number, slot: number): () => number {
  return mulberry32(Math.imul(seq + 11 + slot * 7919, 0x5bd1e995) ^ 0x27d4eb2f);
}

function spread(rng: () => number, n: number): number {
  return Math.floor(rng() * (2 * n + 1)) - n;
}

/** The companion's level as the fight reads it: its settled level, 1..100. */
export function companionLevel(a: Companion): number {
  return clampLevel(a.level ?? 1);
}

/**
 * The companion's IVs, dealt from what identifies it.
 *
 * The same idiom as its ability slot (`abilitySlotOf`): the moment it hatched
 * and what it hatched as, so a save from before IVs has them already — the
 * same ones it would have had — and evolving keeps them, as in the games.
 */
export function companionIvs(a: Companion): Ivs {
  return rollIvs(mulberry32(Math.imul(Math.floor(a.bornAt) + 13, 0x01000193) ^ (a.pathIds[0] * 0x9e3779b1)));
}

/**
 * A party member's level: the top of the scale.
 *
 * Party members are graduates, and graduating is reaching level 100.
 */
export const PARTY_LEVEL = MAX_LEVEL;

/** A party member's IVs, dealt from its species and slot — it has no hatch moment of its own to deal from. */
export function partyIvs(m: PartyMember): Ivs {
  return rollIvs(mulberry32(Math.imul(m.speciesId + 17, 0x01000193) ^ ((m.abilitySlot ?? 0) * 0x85ebca6b)));
}

/** A wild Pokemon's level at encounter `seq`, for a companion at `myLevel`. */
export function wildLevelAt(seq: number, myLevel: number): number {
  return clampLevel(myLevel + spread(levelRng(seq, 0), WILD_LEVEL_SPREAD));
}

/** The IVs of the opponent in team slot `slot` at encounter `seq`. Slot 0 is a wild Pokemon's. */
export function foeIvsAt(seq: number, slot = 0): Ivs {
  const rng = levelRng(seq, slot + 1);
  rng(); // the level draw's place, so a slot's level and IVs never share a number
  return rollIvs(rng);
}

/** A route trainer's team levels: each member on its own draw within the spread. */
export function trainerLevelsAt(seq: number, size: number, myLevel: number): number[] {
  return Array.from({ length: size }, (_, i) =>
    clampLevel(myLevel + spread(levelRng(seq, 100 + i), TRAINER_LEVEL_SPREAD)),
  );
}

/** How many gyms the region this leader belongs to has. */
function gymsInRegion(row: GymRow): number {
  return REGIONS.find((r) => r.gyms.includes(row))?.gyms.length ?? 8;
}

/**
 * A leader's offsets from the companion's level, member by member.
 *
 * The ace is the LAST of the team, as the games send it. It climbs from level
 * with the companion at a region's first gym to five above at its last.
 */
export function gymLevelOffsets(row: GymRow): number[] {
  const last = Math.max(1, gymsInRegion(row) - 1);
  const ace = Math.round((GYM_ACE_MAX * Math.min(last, Math.max(0, row.order - 1))) / last);
  return row.team.map((_, i) => (i === row.team.length - 1 ? ace : ace - GYM_REST_BELOW));
}

/** A league member's rank in its region's run, 0 for the first, and how many there are. */
function leagueRank(row: LeagueRow): { rank: number; of: number } {
  const region = REGIONS.find((r) => r.league.includes(row));
  if (!region) return { rank: 0, of: 1 };
  return { rank: region.league.indexOf(row), of: region.league.length };
}

/** A league member's offsets from the party's level. The champion's ace stands highest. */
export function leagueLevelOffsets(row: LeagueRow): number[] {
  const { rank, of } = leagueRank(row);
  const ace = LEAGUE_ACE_MIN + Math.round(((LEAGUE_ACE_MAX - LEAGUE_ACE_MIN) * rank) / Math.max(1, of - 1));
  return row.team.map((_, i) => (i === row.team.length - 1 ? ace : ace - LEAGUE_REST_BELOW));
}

/** Offsets applied to a base level, clamped. */
export function levelsFrom(base: number, offsets: readonly number[]): number[] {
  return offsets.map((o) => clampLevel(base + o));
}
