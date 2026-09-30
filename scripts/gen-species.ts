/**
 * One-time generator: builds server/species.ts from PokeAPI.
 *
 * Run: npm run gen:species
 *
 * We bake the table into the repo rather than walking evolution chains at
 * runtime — a hatch should never fail because PokeAPI is slow or down. The data
 * is small and essentially static.
 *
 * Covers every species (1..1025). Sprites resolve in layers: gen-5 animated for
 * #1-649, Showdown animated above that, static PNG as a last resort — so every
 * species gets an animated sprite. See server/sprites.ts.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_ID = 1025;
const ENDPOINT = 'https://graphql.pokeapi.co/v1beta2';

type Row = {
  id: number;
  name: string;
  capture_rate: number;
  /** Friendship a freshly caught one starts at: 50 for most, 0 to 140 for a few. */
  base_happiness: number | null;
  evolution_chain_id: number | null;
  evolves_from_species_id: number | null;
  pokemonspeciesnames: { name: string; language: { name: string } }[];
};

const QUERY = `{
  pokemonspecies(
    limit: 1200
    where: { id: { _lte: ${MAX_ID} } }
    order_by: { id: asc }
  ) {
    id
    name
    capture_rate
    base_happiness
    evolution_chain_id
    evolves_from_species_id
    pokemonspeciesnames(where: { language: { name: { _in: ["ko", "en"] } } }) {
      name
      language { name }
    }
  }
  nature(order_by: { id: asc }) {
    name
    naturenames(where: { language: { name: { _eq: "ko" } } }) { name }
  }
}`;

/** A nature and its Korean name. Twenty-five, and PokeAPI has ko for all of them. */
type NatureRow = { name: string; naturenames: { name: string }[] };

/**
 * One way PokeAPI says a species evolves. Several rows per pair is normal: one
 * per generation that changed the rule, one per regional form, one per place.
 */
type EvoRow = {
  evolved_species_id: number;
  min_level: number | null;
  min_happiness: number | null;
  min_affection: number | null;
  min_beauty: number | null;
  time_of_day: string | null;
  gender_id: number | null;
  relative_physical_stats: number | null;
  needs_overworld_rain: boolean;
  turn_upside_down: boolean;
  needs_multiplayer: boolean;
  near_special_rock: boolean;
  min_move_count: number | null;
  min_steps: number | null;
  min_damage_taken: number | null;
  used_move_id: number | null;
  evolutiontrigger: { name: string };
  item: { name: string } | null;
  ItemByHeldItemId: { name: string } | null;
  known_move_id: number | null;
  known_move_type_id: number | null;
  location_id: number | null;
  region_id: number | null;
  party_species_id: number | null;
  party_type_id: number | null;
  trade_species_id: number | null;
  condition_expression: string | null;
  evolved_pokemon_form_id: number | null;
  required_pokemon_form_id: number | null;
  pokemonspecy: { evolves_from_species_id: number | null };
};

const EVO_QUERY = `{
  pokemonevolution(where: { evolved_species_id: { _lte: ${MAX_ID} } }, order_by: { id: asc }) {
    evolved_species_id min_level min_happiness min_affection min_beauty time_of_day gender_id
    relative_physical_stats needs_overworld_rain turn_upside_down needs_multiplayer near_special_rock
    min_move_count min_steps min_damage_taken used_move_id
    evolutiontrigger { name } item { name } ItemByHeldItemId { name }
    known_move_id known_move_type_id location_id region_id party_species_id party_type_id trade_species_id
    condition_expression evolved_pokemon_form_id required_pokemon_form_id
    pokemonspecy { evolves_from_species_id }
  }
}`;

/** PokeAPI type ids, 1-based, in its own order. */
const TYPE_BY_ID = [
  '', 'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
  'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy',
];

/** The item that stands in for a trade with nobody to trade with — 레전드 아르세우스's own answer. */
const LINKING_CORD = 'linking-cord';

/**
 * What it takes to evolve, in the terms this app can check.
 *
 * Every field is a condition and all of them must hold; a species with several
 * rules evolves when any one of them does. See `evoRules` for how PokeAPI's
 * rows become these, and docs/DESIGN.md for why each stand-in is what it is.
 */
type EvoRule = {
  level?: number;
  happiness?: number;
  time?: 'day' | 'night' | 'dusk' | 'full-moon';
  item?: string;
  count?: number;
  move?: number;
  moveType?: string;
  partySpecies?: number;
  partyType?: string;
  rain?: true;
  upsideDown?: true;
  steps?: number;
  uses?: [number, number];
  recoil?: number;
  damage?: number;
  crits?: number;
  defeat?: [number, number];
  encounters?: number;
  byPath?: true;
};

/** A row for a regional form, or reaching one. This app has no regional forms. */
const regional = (r: EvoRow) =>
  r.region_id != null || (r.required_pokemon_form_id ?? 0) >= 10000 || (r.evolved_pokemon_form_id ?? 0) >= 10000;

/**
 * PokeAPI's rows for one evolution, as the rules this app checks.
 *
 * In order: a regional form's rows go if the plain species has its own (Alolan
 * Sandshrew's ice stone does not make a Kanto one evolve by stone), and are kept
 * if they are all there is (Sirfetch'd has only Galarian Farfetch'd to come
 * from; this app has one Farfetch'd, so it is that one). A row that needs a
 * particular place goes if the games also allow a stone — Magnezone, Leafeon,
 * Glaceon, Probopass, Vikavolt and Crabominable all do since Sword and Shield.
 * Then each row becomes one rule, and duplicates collapse.
 */
function evoRules(rows: EvoRow[], siblingLevel: (from: number) => number | undefined): EvoRule[] {
  let use = rows.filter((r) => !regional(r));
  if (!use.length) use = rows;
  const placeless = use.filter((r) => r.location_id == null && !r.near_special_rock);
  if (placeless.length) use = placeless;
  // 님피아: the games take either affection or friendship; this app has friendship.
  const noAffection = use.filter((r) => r.min_affection == null);
  if (noAffection.length) use = noAffection;
  // 밀로틱: beauty is a contest stat this app lacks; the Prism Scale route stands.
  const noBeauty = use.filter((r) => r.min_beauty == null);
  if (noBeauty.length) use = noBeauty;
  // 우라오스: the towers are places; the scrolls do the same job.
  const noTower = use.filter((r) => !r.evolutiontrigger.name.startsWith('tower-of-'));
  if (noTower.length) use = noTower;

  const out = new Map<string, EvoRule>();
  for (const r of use) {
    const t = r.evolutiontrigger.name;
    const rule: EvoRule = {};
    if (r.min_level) rule.level = r.min_level;
    if (r.min_happiness) rule.happiness = r.min_happiness;
    // 마빌크's spin is how it is turned, not what it is fed; the sweet is the rule.
    if (r.time_of_day && t !== 'spin') rule.time = r.time_of_day as EvoRule['time'];
    if (t === 'use-item' && r.item) rule.item = r.item.name;
    // Held while levelling up, or while traded: used from the bag here, as 레전드 아르세우스 does.
    if (r.ItemByHeldItemId) rule.item = r.ItemByHeldItemId.name;
    if (t === 'trade' && !rule.item) rule.item = LINKING_CORD;
    if (r.known_move_id) rule.move = r.known_move_id;
    if (r.known_move_type_id) rule.moveType = TYPE_BY_ID[r.known_move_type_id];
    if (r.party_species_id) rule.partySpecies = r.party_species_id;
    if (r.party_type_id) rule.partyType = TYPE_BY_ID[r.party_type_id];
    if (r.needs_overworld_rain) rule.rain = true;
    if (r.turn_upside_down) rule.upsideDown = true;
    if (r.min_steps) rule.steps = r.min_steps;
    if (r.used_move_id && r.min_move_count) rule.uses = [r.used_move_id, r.min_move_count];
    if (t === 'recoil-damage' && r.min_damage_taken) rule.recoil = r.min_damage_taken;
    if (t === 'take-damage' && r.min_damage_taken) rule.damage = r.min_damage_taken;
    if (t === 'three-critical-hits') rule.crits = 3;
    if (t === 'three-defeated-bisharp') rule.defeat = [625, 3];
    if (t === 'gimmighoul-coins') {
      rule.item = 'gimmighoul-coin';
      rule.count = 999;
    }
    // Candy is walked and caught for in Pokemon GO; encounters are this app's walking.
    if (t === 'meltan-candies') rule.encounters = 400;
    // 껍질몬 appears as 아이스크 does, at the same level.
    if (t === 'shed') {
      const lv = siblingLevel(r.pokemonspecy.evolves_from_species_id!);
      if (lv) rule.level = lv;
    }
    // Gender, a hidden personality value and the balance of two stats are all
    // things this app decides by which branch was drawn at hatch.
    if (r.gender_id != null || r.relative_physical_stats != null || r.condition_expression) rule.byPath = true;
    const key = JSON.stringify(rule);
    if (!out.has(key)) out.set(key, rule);
  }
  return [...out.values()];
}

async function main() {
  process.stdout.write(`PokeAPI에서 #1-${MAX_ID} 종 데이터 가져오는 중... `);
  const json = await gql<{ pokemonspecies: Row[]; nature: NatureRow[] }>(QUERY);
  const rows = json.pokemonspecies;
  console.log(`${rows.length}종`);

  /**
   * Natures, with their Korean names.
   *
   * Generated rather than written down for the same reason TYPE_KO is: a
   * hand-kept list drifts, and half of this one was simply missing — the app
   * shipped twelve of the twenty-five for a long time.
   *
   * A missing Korean name throws rather than falling back to the slug. Falling
   * back would put "sassy" on a Korean screen, which is the bug this fixes.
   */
  const natures = json.nature;
  const noKo = natures.filter((n) => !n.naturenames[0]?.name);
  if (noKo.length) {
    throw new Error(`한글명이 없는 성격: ${noKo.map((n) => n.name).join(', ')}`);
  }
  if (natures.length !== 25) {
    throw new Error(`성격이 25종이 아닙니다: ${natures.length}종`);
  }
  const natureKo = Object.fromEntries(natures.map((n) => [n.name, n.naturenames[0].name]));
  console.log(`   성격 ${natures.length}종 (한글명 전부 확인)`);

  const byId = new Map(rows.map((r) => [r.id, r]));
  const children = new Map<number, number[]>();
  for (const r of rows) {
    const p = r.evolves_from_species_id;
    if (p == null) continue;
    if (!children.has(p)) children.set(p, []);
    children.get(p)!.push(r.id);
  }

  // Root-to-leaf paths, keyed by ROOT species rather than by chain.
  //
  // A chain can have more than one root — chain 250 holds both Phione and
  // Manaphy — so keying by chain id silently drops all but the last root.
  // Branching roots (Eevee, Poliwag, ...) still yield several paths; the game
  // picks one at hatch and commits to it.
  const lines: { chainId: number; captureRate: number; paths: number[][] }[] = [];
  for (const r of rows) {
    if (r.evolves_from_species_id != null) continue; // roots only
    const paths: number[][] = [];
    const walk = (id: number, acc: number[]) => {
      const next = (children.get(id) ?? []).filter((c) => byId.has(c));
      const trail = [...acc, id];
      // Cap at 3 stages: deeper lines add UI work for no extra delight.
      if (next.length === 0 || trail.length >= 3) {
        paths.push(trail);
        return;
      }
      for (const c of next) walk(c, trail);
    };
    walk(r.id, []);
    if (paths.length) {
      lines.push({ chainId: r.evolution_chain_id ?? r.id, captureRate: r.capture_rate ?? 255, paths });
    }
  }

  // Safety net: nothing in the Pokedex may be unreachable. If PokeAPI models a
  // species in some way this walk misses, give it a line of its own rather than
  // quietly making it impossible to hatch.
  const covered = new Set(lines.flatMap((l) => l.paths.flat()));
  const orphans = rows.filter((r) => !covered.has(r.id));
  for (const r of orphans) {
    lines.push({ chainId: r.evolution_chain_id ?? r.id, captureRate: r.capture_rate ?? 255, paths: [[r.id]] });
  }
  if (orphans.length) {
    console.log(`   고아 종 ${orphans.length}개를 단독 라인으로 추가: ${orphans.map((r) => `#${r.id}`).join(', ')}`);
  }

  // ── How each species evolves ─────────────────────────────────────────────
  process.stdout.write('   진화 조건 가져오는 중... ');
  const evoRows = (await gql<{ pokemonevolution: EvoRow[] }>(EVO_QUERY)).pokemonevolution;
  console.log(`${evoRows.length}줄`);
  const rowsFor = new Map<number, EvoRow[]>();
  for (const r of evoRows) {
    if (!rowsFor.has(r.evolved_species_id)) rowsFor.set(r.evolved_species_id, []);
    rowsFor.get(r.evolved_species_id)!.push(r);
  }
  /** The level a sibling evolves at — 껍질몬 borrows 아이스크's. */
  const siblingLevel = (from: number) =>
    evoRows.find((r) => r.pokemonspecy.evolves_from_species_id === from && r.min_level)?.min_level ?? undefined;
  const evolutions: Record<number, EvoRule[]> = {};
  const steps = new Set(lines.flatMap((l) => l.paths.flatMap((p) => p.slice(1))));
  const noRule: number[] = [];
  for (const to of [...steps].sort((a, b) => a - b)) {
    const rules = evoRules(rowsFor.get(to) ?? [], siblingLevel);
    if (!rules.length || rules.some((r) => !Object.keys(r).filter((k) => k !== 'byPath').length)) noRule.push(to);
    evolutions[to] = rules;
  }
  if (noRule.length) throw new Error(`진화 조건을 만들지 못한 종: ${noRule.join(', ')}`);

  // Korean names for every item an evolution asks for.
  const itemSlugs = [...new Set(Object.values(evolutions).flatMap((rs) => rs.map((r) => r.item).filter(Boolean)))] as string[];
  const itemQ = `{ item(where: { name: { _in: ${JSON.stringify(itemSlugs)} } }) { name itemnames(where: { language: { name: { _eq: "ko" } } }) { name } } }`;
  const items = (await gql<{ item: { name: string; itemnames: { name: string }[] }[] }>(itemQ)).item;
  const itemKo: Record<string, string> = Object.fromEntries(items.map((i) => [i.name, i.itemnames[0]?.name ?? '']));
  const noItemKo = itemSlugs.filter((s) => !itemKo[s]);
  if (noItemKo.length) throw new Error(`한글명이 없는 진화 도구: ${noItemKo.join(', ')}`);
  console.log(`   진화 도구 ${itemSlugs.length}종 (한글명 전부 확인)`);

  const happiness: number[] = [];
  for (const r of rows) happiness[r.id] = r.base_happiness ?? 50;

  const korean = (r: Row) =>
    r.pokemonspeciesnames.find((n) => n.language.name === 'ko')?.name ?? r.name;
  const english = (r: Row) =>
    r.pokemonspeciesnames.find((n) => n.language.name === 'en')?.name ?? r.name;

  const names: Record<number, [string, string]> = {};
  for (const r of rows) names[r.id] = [korean(r), english(r)];

  lines.sort((a, b) => a.paths[0][0] - b.paths[0][0]);

  // Hard assertion: every species in the Pokedex must be raisable.
  const finalCovered = new Set(lines.flatMap((l) => l.paths.flat()));
  const stillMissing = rows.filter((r) => !finalCovered.has(r.id));
  if (stillMissing.length) {
    throw new Error(`도감에서 빠진 종이 있습니다: ${stillMissing.map((r) => r.id).join(', ')}`);
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const out = path.join(here, '..', 'server', 'species.ts');

  const body = `// GENERATED by scripts/gen-species.ts — do not edit by hand.
// Source: PokeAPI (https://pokeapi.co). All species #1-${MAX_ID}.
// Sprites themselves are never bundled; they are fetched at runtime.

/** One evolution line: a chain id, the root's capture rate, and its branches. */
export type SpeciesLine = {
  chainId: number;
  /** PokeAPI capture_rate of the root species. Lower = rarer. */
  captureRate: number;
  /** Root-to-leaf paths. Branching lines have more than one. */
  paths: number[][];
};

export const LINES: SpeciesLine[] = ${JSON.stringify(lines, null, 2)};

/** speciesId -> [Korean, English] */
export const NAMES: Record<number, [string, string]> = ${JSON.stringify(names, null, 2)};

/**
 * The twenty-five natures, in PokeAPI id order.
 *
 * Purely cosmetic here — a companion is dealt one at hatch and nothing reads it
 * again. The games use natures to nudge two stats by 10%, and this app has no
 * stats to nudge, so carrying the mechanic across would mean inventing one.
 */
export const NATURES = ${JSON.stringify(natures.map((n) => n.name))} as const;
export type Nature = (typeof NATURES)[number];

/** Korean names, so the panel never shows "sassy" to a Korean reader. */
export const NATURE_KO: Record<string, string> = ${JSON.stringify(natureKo, null, 2)};

/**
 * One way to evolve into a species. Every field present must hold; a species
 * with several rules evolves when any one of them does. server/evolution.ts is
 * what reads these, and docs/DESIGN.md says what each stand-in stands for.
 *
 * - \`level\`: at a level-up to at least this level.
 * - \`happiness\`: friendship at least this, at a level-up.
 * - \`time\`: only at this time of day (or under a full moon).
 * - \`item\` (× \`count\`): used from the bag — a stone, or what the games have it
 *   hold or be traded with. A plain trade is ${LINKING_CORD}.
 * - \`move\` / \`moveType\`: knowing that move, or a move of that type.
 * - \`partySpecies\` / \`partyType\`: with that in the league party.
 * - \`rain\`, \`upsideDown\`, \`steps\`, \`uses\`, \`recoil\`, \`damage\`, \`crits\`,
 *   \`defeat\`, \`encounters\`: the rest, each read from what the companion did.
 * - \`byPath\`: gender, personality or stat balance — decided by the branch drawn at hatch.
 */
export type EvoRule = {
  level?: number;
  happiness?: number;
  time?: 'day' | 'night' | 'dusk' | 'full-moon';
  item?: string;
  count?: number;
  move?: number;
  moveType?: string;
  partySpecies?: number;
  partyType?: string;
  rain?: true;
  upsideDown?: true;
  steps?: number;
  uses?: [number, number];
  recoil?: number;
  damage?: number;
  crits?: number;
  defeat?: [number, number];
  encounters?: number;
  byPath?: true;
};

/** speciesId -> the ways to evolve INTO it. Every non-root species on a path has at least one. */
export const EVOLUTIONS: Record<number, EvoRule[]> = ${JSON.stringify(evolutions)};

/** Korean names of every item an evolution asks for, by PokeAPI slug. */
export const EVO_ITEM_KO: Record<string, string> = ${JSON.stringify(itemKo, null, 2)};

/** Friendship each species starts at, by id. Index 0 is unused. */
export const BASE_HAPPINESS: number[] = ${JSON.stringify(Array.from(happiness, (h) => h ?? 0))};

export function speciesName(id: number, lang: 'ko' | 'en' = 'ko'): string {
  const n = NAMES[id];
  if (!n) return \`#\${id}\`;
  return lang === 'ko' ? n[0] : n[1];
}
`;

  await fs.writeFile(out, body, 'utf8');
  const branching = lines.filter((l) => l.paths.length > 1).length;
  console.log(`→ server/species.ts`);
  console.log(`   진화 라인 ${lines.length}개 (분기 있는 라인 ${branching}개)`);
  console.log(`   키울 수 있는 종 ${finalCovered.size}/${rows.length} — 전부 도달 가능`);
}

/** One GraphQL round trip. PokeAPI refuses a request with no user agent. */
async function gql<T>(query: string): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'poketokenpet-gen' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const json = (await res.json()) as { data: T; errors?: unknown };
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
