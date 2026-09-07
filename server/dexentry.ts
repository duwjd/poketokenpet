import { generationOf, lineOf, rarityOfSpecies } from './dex.ts';
import { abilitiesOf, flavorOf, STAT_KO, statsOf } from './dexdata.ts';
import { FORMS, formById } from './forms.ts';
import { TYPES, TYPE_KO, effectiveness, learnableMoves, speciesInfo, type MoveType } from './moves.ts';
import { speciesName } from './species.ts';
import type { SpeciesLine } from './species.ts';
import { ensureSprite } from './sprites.ts';
import { loadState } from './store.ts';

/**
 * One 도감 entry, built on demand.
 *
 * A second builder standing beside buildState, deliberately in its own file: it
 * is the only thing that imports server/dexdata.ts, and keeping those 183KB of
 * dex prose out of state.ts's import graph is the whole reason this is served
 * separately rather than folded into the payload or the index.
 *
 * The split inside is the same one server/dex.ts makes: `dexStatic` is pure and
 * does no I/O, so a test can sweep all 1025 species without a network. Only
 * `dexEntry` reads the save and resolves a sprite.
 */

/** Group labels are the renderer's; the factor is the number the battle uses. */
export type Matchup = { factor: number; types: { id: string; name: string }[] };

/** One column of an evolution line — usually one species, more when it branches. */
export type DexStage = { speciesId: number; name: string; collected: boolean; here: boolean };

export type DexStatic = {
  speciesId: number;
  name: string;
  nameEn: string;
  genus: string;
  types: { id: string; name: string }[];
  heightM: number;
  weightKg: number;
  rarity: string;
  generation: number;
  /** null for the species PokeAPI has no Korean dex entry for. */
  flavor: string | null;
  stats: { name: string; value: number }[];
  statTotal: number;
  abilities: { ko: string; desc: string | null; hidden: boolean }[];
  matchups: Matchup[];
  /** Stage columns. Branching lines put every alternative in one column. */
  stages: { speciesId: number; name: string }[][];
  forms: { id: number; kind: 'mega' | 'gmax' | 'fusion'; ko: string; power: number }[];
  tmCount: number;
};

export type DexDetail = Omit<DexStatic, 'stages'> & {
  sprite: string | null;
  stages: DexStage[][];
  /**
   * The player's own row for this (species, shiny) pair.
   *
   * `formKo` rather than a form id: test/payload-shape.test.ts forbids the
   * renderer importing server/forms.ts, so it could never resolve one. Same
   * reason HuntLogEntry carries `formKo`.
   */
  mine: {
    firstSeenAt: number;
    nickname: string | null;
    shiny: boolean;
    formKo: string | null;
  } | null;
};

/**
 * What this species TAKES from each of the eighteen types.
 *
 * `effectiveness` has only ever been called the other way round — one attacking
 * move against a defender. Here the ATTACKER is the loop variable and this
 * species' types are held fixed. Getting the two arguments backwards produces a
 * table that looks entirely plausible and is silently wrong, which is why
 * test/dexentry.test.ts pins 리자몽 against 땅 at 0: reversed, fire-hits-ground
 * reads 1 and nothing looks amiss.
 *
 * This is NOT wiki trivia. server/hunt.ts multiplies every swing by this exact
 * function, and src/Scene.tsx already prints 효과가 굉장했다! from the same
 * number — so this section is the table the battle log is written from.
 *
 * 1x is dropped. Eighteen rows where ten of them say "보통" is a wall rather
 * than information, and it would bury the 4x that actually matters.
 */
function matchupsOf(types: readonly MoveType[]): Matchup[] {
  const by = new Map<number, MoveType[]>();
  for (const t of TYPES) {
    const f = effectiveness(t, types);
    if (f === 1) continue;
    const bucket = by.get(f);
    if (bucket) bucket.push(t);
    else by.set(f, [t]);
  }
  return [...by]
    .sort((a, b) => b[0] - a[0]) // 4 → 2 → 0.5 → 0.25 → 0
    .map(([factor, ts]) => ({ factor, types: ts.map((t) => ({ id: t, name: TYPE_KO[t] })) }));
}

/**
 * A line as stage columns rather than as root-to-leaf paths.
 *
 * 이브이's `paths` has EIGHT entries. Drawn one row per path that is eight rows
 * whose first cell is 이브이 every time. One column per stage is how the games
 * draw a branching tree, and a line with no branches — which is most of them —
 * comes out of here unchanged.
 */
function stagesOf(line: SpeciesLine): number[][] {
  const cols: number[][] = [];
  for (const p of line.paths) {
    p.forEach((id, depth) => {
      const col = (cols[depth] ??= []);
      if (!col.includes(id)) col.push(id);
    });
  }
  return cols;
}

/**
 * Everything about a species that no save can change.
 *
 * Memoised because it is the expensive half — `learnableMoves` walks a 340-bit
 * set and `matchupsOf` runs the type chart eighteen times — and because it can
 * never go stale: nothing in here reads the save.
 */
const staticCache = new Map<number, DexStatic | null>();

export function dexStatic(speciesId: number): DexStatic | null {
  const hit = staticCache.get(speciesId);
  if (hit !== undefined) return hit;

  const info = speciesInfo(speciesId);
  // Same contract as speciesInfo: an id outside the dex is null, not a throw.
  if (!info) {
    staticCache.set(speciesId, null);
    return null;
  }

  const raw = statsOf(speciesId) ?? [];
  const line = lineOf(speciesId);

  const out: DexStatic = {
    speciesId,
    name: speciesName(speciesId),
    nameEn: speciesName(speciesId, 'en'),
    genus: info.genus,
    types: info.types.map((t) => ({ id: t, name: TYPE_KO[t] })),
    heightM: info.heightM,
    weightKg: info.weightKg,
    rarity: rarityOfSpecies(speciesId),
    generation: generationOf(speciesId),
    flavor: flavorOf(speciesId),
    stats: raw.map((value, i) => ({ name: STAT_KO[i], value })),
    statTotal: raw.reduce((a, b) => a + b, 0),
    abilities: abilitiesOf(speciesId),
    matchups: matchupsOf(info.types),
    stages: line
      ? stagesOf(line).map((col) => col.map((id) => ({ speciesId: id, name: speciesName(id) })))
      : [[{ speciesId, name: speciesName(speciesId) }]],
    /*
     * Every form this SPECIES has — not `formsFrom`, which answers the battle's
     * question of what the shape on the field can turn into next. Ultra
     * Necrozma is reachable only from an already-fused Necrozma, so its `from`
     * is [10155, 10156] and formsFrom(800) misses it entirely.
     */
    forms: FORMS.filter((f) => f.base === speciesId).map((f) => ({
      id: f.id,
      kind: f.kind,
      ko: f.ko,
      power: f.power,
    })),
    tmCount: learnableMoves(speciesId).length,
  };

  staticCache.set(speciesId, out);
  return out;
}

/**
 * One dex entry, with the player's own record and a picture.
 *
 * Keyed on (species, shiny) because that is what a card is: the grid files a
 * shiny and a plain individual as two rows, and they carry different dates and
 * different nicknames.
 */
export async function dexEntry(speciesId: number, shiny = false): Promise<DexDetail | null> {
  const base = dexStatic(speciesId);
  if (!base) return null;

  const state = await loadState();
  const mine = state.dex.find((d) => d.speciesId === speciesId && d.shiny === shiny) ?? null;
  const form = mine?.formId !== undefined ? formById(mine.formId) : null;

  /** Everything collected, for marking up the line — either shininess counts. */
  const collected = new Set(state.dex.map((d) => d.speciesId));

  return {
    ...base,
    /*
     * The picture and the name follow the form it left as, exactly as the grid
     * card does (server/state.ts). Opening a 블랙큐레무 card onto a plain 큐레무
     * reads as a bug. Everything factual above stays on the base species.
     */
    name: form?.ko ?? base.name,
    sprite: await ensureSprite(form?.id ?? speciesId, shiny),
    stages: base.stages.map((col) =>
      col.map((s) => ({
        ...s,
        collected: collected.has(s.speciesId),
        here: s.speciesId === speciesId,
      })),
    ),
    mine: mine
      ? {
          firstSeenAt: mine.firstSeenAt,
          nickname: mine.nickname ?? null,
          shiny: mine.shiny,
          formKo: form?.ko ?? null,
        }
      : null,
  };
}
