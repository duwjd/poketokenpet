/**
 * One-time generator: builds server/legenddata.ts from PokeAPI.
 *
 * Run: npm run gen:legends
 *
 * ## Why this exists at all
 *
 * `rarityOfSpecies` is not a legendary classifier and never was. It reads
 * `capture_rate`, which is wrong in both directions:
 *
 *   전설인데 안 걸림  뮤 45 · 세레비 45 · 쉐이미 45 · 코스모그 45 → 귀함
 *                     네크로즈마 255 · 테라파고스 255 → 흔함
 *   전설이 아닌데 걸림 메타몽 35 · 에어아머 25 · 메탕 3 · 패러독스 16종 → 전설
 *
 * So a gate written against the rarity bucket would let Necrozma walk straight
 * through and stop a Ditto. PokeAPI carries the real answer as two booleans on
 * `pokemonspecies`, and this pulls them.
 *
 * ## And the signature items
 *
 * The other half is 전용 도구 — the Adamant Orb, the Rusted Sword, the Prison
 * Bottle. Those are ordinary PokeAPI items with Korean names, so the same query
 * shape `gen-forms.ts` uses for mega stones works here: `item` + `itemnames`
 * filtered to `ko`.
 *
 * Sprite availability is checked with a HEAD per item rather than assumed, and
 * in all three places upstream keeps them: most item icons sit flat under
 * `items/`, but Generation 8 and 9 filed theirs in `items/gen8/` and
 * `items/gen9/` subfolders. Looking only at the flat one is why the Ogerpon
 * masks and the Clear Amulet were recorded as having no icon when they had one
 * all along. What genuinely has none is recorded as null, and the bag draws a
 * glyph rather than a broken image.
 *
 * Nothing here decides WHICH condition opens WHICH species. That is a design
 * judgement, so it is hand-written in server/legends.ts and left out of the
 * generated file on purpose.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { itemSpriteUrls } from '../server/sprites.ts';

const ENDPOINT = 'https://graphql.pokeapi.co/v1beta2';

/**
 * The signature items, by PokeAPI slug.
 *
 * Hand-listed rather than derived: there is no item category that means "opens
 * a legendary" — the games express that in dialogue, not in data. Every slug
 * here was checked to exist upstream with a Korean name.
 */
const ITEM_SLUGS = [
  'adamant-orb', 'lustrous-orb', 'griseous-orb',
  'red-orb', 'blue-orb', 'soul-dew',
  'light-stone', 'dark-stone',
  'reveal-glass', 'prison-bottle', 'gracidea',
  'rusted-sword', 'rusted-shield', 'reins-of-unity',
  'sun-flute', 'moon-flute', 'azure-flute',
  'meteorite', 'rainbow-wing', 'silver-wing',
  'odd-keystone', 'lunar-wing', 'magma-stone',
  'tidal-bell', 'clear-bell', 'enigma-stone',
  'scroll-of-darkness', 'scroll-of-waters',
  'wellspring-mask', 'hearthflame-mask', 'cornerstone-mask',
  // PokeAPI splits Necrozma's two devices by what they do, and both halves
  // carry the same Korean name. The merge form is the one that matters here.
  'n-solarizer--merge', 'n-lunarizer--merge',
  'malicious-armor', 'auspicious-armor', 'clear-amulet',
  'oaks-letter', 'member-card',
];

type SpeciesRow = {
  id: number;
  name: string;
  is_legendary: boolean;
  is_mythical: boolean;
  generation_id: number;
  pokemonspeciesnames: { name: string }[];
};

type ItemRow = { name: string; itemnames: { name: string }[] };

const QUERY = `{
  pokemonspecies(
    where: { _or: [{ is_legendary: { _eq: true } }, { is_mythical: { _eq: true } }] }
    order_by: { id: asc }
    limit: 300
  ) {
    id
    name
    is_legendary
    is_mythical
    generation_id
    pokemonspeciesnames(where: { language: { name: { _eq: "ko" } } }) { name }
  }
  item(where: { name: { _in: ${JSON.stringify(ITEM_SLUGS)} } }, limit: 100) {
    name
    itemnames(where: { language: { name: { _eq: "ko" } } }) { name }
  }
}`;

async function gql<T>(query: string): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const json = (await res.json()) as { data: T; errors?: unknown };
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

/** Does any icon source the app reaches actually carry this one? */
async function hasSprite(slug: string): Promise<boolean> {
  try {
    // The very list `ensureItemSprite` walks, imported rather than copied: an
    // icon recorded here as present that the app never asks for is a permanent
    // blank in the bag, and the two drifting apart is how that happens.
    for (const url of itemSpriteUrls(slug)) {
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15_000) });
      if (res.ok) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function main() {
  process.stdout.write('PokeAPI에서 전설·환상 종과 전용 도구 가져오는 중... ');
  const data = await gql<{ pokemonspecies: SpeciesRow[]; item: ItemRow[] }>(QUERY);
  console.log(`종 ${data.pokemonspecies.length}, 도구 ${data.item.length}`);

  const species = data.pokemonspecies.map((r) => {
    const ko = r.pokemonspeciesnames[0]?.name;
    // Same rule as gen-species.ts: falling back to the slug is how "arceus"
    // ends up on a Korean screen, so refuse instead.
    if (!ko) throw new Error(`한글명이 없는 전설: ${r.name} (#${r.id})`);
    return { id: r.id, ko, myth: r.is_mythical, gen: r.generation_id };
  });

  const missing = ITEM_SLUGS.filter((s) => !data.item.some((i) => i.name === s));
  if (missing.length) throw new Error(`PokeAPI에 없는 도구: ${missing.join(', ')}`);

  process.stdout.write('도구 아이콘 확인 중... ');
  const items = await Promise.all(
    data.item.map(async (r) => {
      const ko = r.itemnames[0]?.name;
      if (!ko) throw new Error(`한글명이 없는 도구: ${r.name}`);
      return { slug: r.name, ko, sprite: (await hasSprite(r.name)) ? r.name : null };
    }),
  );
  items.sort((a, b) => a.slug.localeCompare(b.slug));
  const withIcon = items.filter((i) => i.sprite).length;
  console.log(`${withIcon}/${items.length}개에 아이콘 있음`);

  const body = `// GENERATED by scripts/gen-legends.ts — do not edit by hand.
// Source: PokeAPI (https://pokeapi.co). Legendary and mythical species, and the
// signature items the games gate them behind.
// Sprites themselves are never bundled; they are fetched at runtime.

/**
 * One legendary or mythical species.
 *
 * \`myth\` is PokeAPI's \`is_mythical\`. Everything here that is not mythical is
 * legendary — the query asks for nothing else — so the two together are the
 * classification \`rarityOfSpecies\` cannot give (it reads capture_rate, which
 * calls Necrozma common and Ditto legendary).
 *
 * There is no gate in this file. Which condition opens which species is a
 * design decision and lives in server/legends.ts, hand-written.
 */
export type LegendRow = { id: number; ko: string; myth: boolean; gen: number };

export const LEGENDS: LegendRow[] = ${JSON.stringify(species, null, 2)};

/** speciesId -> row, for the O(1) test every encounter does. */
const BY_ID = new Map(LEGENDS.map((l) => [l.id, l]));

/** Is this species gated at all? The one question the hunt loop asks. */
export function legendOf(speciesId: number): LegendRow | null {
  return BY_ID.get(speciesId) ?? null;
}

/**
 * A signature item.
 *
 * \`sprite\` is the PokeAPI slug, or null where the sprite repository has no
 * icon — it thins out around Gen 7, so the Rusted Sword and the masks have
 * none. The bag draws a glyph for those, exactly as it does for the Dynamax
 * Band.
 */
export type LegendItem = { slug: string; ko: string; sprite: string | null };

export const LEGEND_ITEMS: LegendItem[] = ${JSON.stringify(items, null, 2)};

const ITEM_BY_SLUG = new Map(LEGEND_ITEMS.map((i) => [i.slug, i]));

export function legendItem(slug: string): LegendItem | null {
  return ITEM_BY_SLUG.get(slug) ?? null;
}
`;

  const here = path.dirname(fileURLToPath(import.meta.url));
  const out = path.join(here, '..', 'server', 'legenddata.ts');
  await fs.writeFile(out, body, 'utf8');

  const myth = species.filter((s) => s.myth).length;
  console.log(`→ server/legenddata.ts`);
  console.log(`   전설 ${species.length - myth} · 환상 ${myth} · 도구 ${items.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
