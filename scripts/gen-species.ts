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

async function main() {
  process.stdout.write(`PokeAPI에서 #1-${MAX_ID} 종 데이터 가져오는 중... `);
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY }),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const json = (await res.json()) as {
    data: { pokemonspecies: Row[]; nature: NatureRow[] };
    errors?: unknown;
  };
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  const rows = json.data.pokemonspecies;
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
  const natures = json.data.nature;
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
