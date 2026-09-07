import { rarityOf, type Companion, type DexEntry, type Rarity } from './game.ts';
import { LINES, type SpeciesLine } from './species.ts';

/**
 * Pokedex bookkeeping, kept out of game.ts now that it is a feature of its own.
 *
 * Everything here is pure: no clock, no I/O. `retireInto` takes the timestamp
 * so the caller owns the only impure bit.
 */

/**
 * National dex generation boundaries — the last species id of each generation.
 *
 * Checked against PokeAPI: every one of the nine generations is a contiguous id
 * range (gen 1 is 1-151, gen 9 is 906-1025), so nine numbers replace a
 * 1025-entry generated table. Past boundaries never move; a tenth generation
 * appends to this list.
 */
const GEN_LAST = [151, 251, 386, 493, 649, 721, 809, 905, 1025];

export const GENERATIONS = GEN_LAST.map((to, i) => ({
  gen: i + 1,
  from: i === 0 ? 1 : GEN_LAST[i - 1] + 1,
  to,
}));

/** Which generation a species belongs to. 0 for anything outside the dex. */
export function generationOf(speciesId: number): number {
  // The lower bound matters: without it id 0 falls into generation 1.
  if (!Number.isInteger(speciesId) || speciesId < 1) return 0;
  for (let i = 0; i < GEN_LAST.length; i++) if (speciesId <= GEN_LAST[i]) return i + 1;
  return 0;
}

/**
 * speciesId -> the evolution line it belongs to.
 *
 * Built once from LINES. Verified total and unambiguous: 541 lines cover all
 * 1025 species and no species appears in two lines.
 */
const LINE_BY_SPECIES = (() => {
  const m = new Map<number, SpeciesLine>();
  for (const l of LINES) for (const p of l.paths) for (const id of p) m.set(id, l);
  return m;
})();

export function lineOf(speciesId: number): SpeciesLine | null {
  return LINE_BY_SPECIES.get(speciesId) ?? null;
}

/**
 * A species' rarity.
 *
 * `captureRate` is the ROOT's, so every member of a line shares one rarity —
 * including pre-evolutions registered by `retireInto`, which is what keeps a
 * rarity filter over the dex coherent.
 */
export function rarityOfSpecies(speciesId: number): Rarity {
  const line = lineOf(speciesId);
  // 255 is the most catchable rate there is, so an unknown id reads as common
  // rather than as a legendary.
  return rarityOf(line?.captureRate ?? 255);
}

/**
 * speciesId -> everything that comes before it in its line, oldest first.
 *
 * Only for entries already stored, which carry no path. Live companions have
 * `pathIds` and should slice that instead.
 *
 * Safe despite branching: measured across all 541 lines, no species reaches its
 * position by two different prefixes. Vileplume and Bellossom both arrive via
 * Oddish -> Gloom; Beautifly and Dustox split at Silcoon/Cascoon but neither
 * appears in the other's path.
 */
export function preEvolutionsOf(speciesId: number): number[] {
  const line = lineOf(speciesId);
  if (!line) return [];
  for (const p of line.paths) {
    const i = p.indexOf(speciesId);
    if (i > 0) return p.slice(0, i);
    if (i === 0) return [];
  }
  return [];
}

/**
 * Add one entry, or enrich the one already there.
 *
 * The dex is keyed on (species, shiny) and must stay that way — the collection
 * count, the filters and `preEvolutionsOf` all rest on one row per pair.
 *
 * But "already recorded, so do nothing" quietly lost data. Graduate a plain
 * Kyurem, then later a Black Kyurem, and the second one matched an existing row
 * and returned early — so its `formId` and its nickname were never stored at
 * all, not merely hidden. The result depended on the order the two happened in,
 * which is the worst kind of quiet.
 *
 * So a repeat fills in what the first one did not know. It never overwrites:
 * the first individual to leave under a name keeps that name.
 */
function record(dex: DexEntry[], entry: DexEntry): DexEntry[] {
  const at = dex.findIndex((d) => d.speciesId === entry.speciesId && d.shiny === entry.shiny);
  if (at < 0) return [...dex, entry];

  const had = dex[at];
  const gained = {
    ...(had.nickname === undefined && entry.nickname !== undefined
      ? { nickname: entry.nickname }
      : {}),
    ...(had.formId === undefined && entry.formId !== undefined ? { formId: entry.formId } : {}),
  };
  if (!Object.keys(gained).length) return dex;
  const out = [...dex];
  out[at] = { ...had, ...gained };
  return out;
}

/**
 * File a departing companion into the dex, along with every form it passed
 * through on the way.
 *
 * Raising a Pyroar means having raised a Litleo, so both are recorded. Shared
 * by graduation (server/game.ts) and by trading it in for an egg
 * (server/shop.ts) — the two used to hold a copy each, which is exactly how the
 * two paths would drift apart.
 *
 * The nickname goes only on the form that actually left. The earlier stages are
 * a record of having passed through, not of an individual that departed under
 * that name. A fusion is recorded the same way and for the same reason: under
 * its BASE species, with the form id riding along so the card can show the
 * shape it left as. Filing it under 10022 instead would put an id outside
 * 1..1025 into a list every filter here assumes is inside it.
 */
export function retireInto(dex: DexEntry[], a: Companion, at: number): DexEntry[] {
  let out = dex;
  const seen = a.pathIds.slice(0, a.stageIndex + 1);
  seen.forEach((speciesId, i) => {
    const departing = i === seen.length - 1;
    out = record(out, {
      speciesId,
      shiny: a.isShiny,
      firstSeenAt: at,
      ...(departing && a.nickname ? { nickname: a.nickname } : {}),
      ...(departing && a.formId !== undefined ? { formId: a.formId } : {}),
    });
  });
  return out;
}

/**
 * How many entries are a form a companion actually LEFT as, rather than a
 * stage it merely passed through on the way.
 *
 * An entry is a pass-through exactly when some other collected entry of the
 * same shininess has it as a pre-evolution — which is how `retireInto` and
 * `backfillPreEvolutions` put it in the dex to begin with.
 *
 * This is a LOWER BOUND on individuals, never the number itself: two Pyroars
 * that graduate leave one entry between them, so the count under-reads. It
 * exists only so `retiredCount` — the one figure in the save that nothing can
 * re-derive, and so the one a lost write leaves behind forever — can be
 * repaired upward. It must never replace the counter.
 */
export function departedCount(dex: DexEntry[]): number {
  const passedThrough = new Set<string>();
  const key = (speciesId: number, shiny: boolean) => `${speciesId}:${shiny}`;
  for (const d of dex) {
    for (const id of preEvolutionsOf(d.speciesId)) passedThrough.add(key(id, d.shiny));
  }
  return dex.filter((d) => !passedThrough.has(key(d.speciesId, d.shiny))).length;
}

/**
 * Fill in pre-evolutions for entries recorded before that rule existed.
 *
 * Runs once in migrate(). Needs no schema bump: `dex` is already an array and a
 * longer one requires no other change.
 */
export function backfillPreEvolutions(dex: DexEntry[], at: number): DexEntry[] {
  let out = dex;
  for (const d of dex) {
    for (const speciesId of preEvolutionsOf(d.speciesId)) {
      out = record(out, { speciesId, shiny: d.shiny, firstSeenAt: d.firstSeenAt ?? at });
    }
  }
  return out;
}
