/**
 * One-time generator: builds server/dexdata.ts from PokeAPI.
 *
 * Run: npm run gen:dex
 *
 * Same bargain as gen-species.ts and gen-moves.ts — bake the table into the
 * repo so opening a Pokedex card never fails because PokeAPI is slow or down.
 *
 * This is the 도감 상세 화면's data and nothing else: the dex entry text, the
 * base stats and the abilities. Deliberately NOT folded into server/moves.ts,
 * which server/hunt.ts imports on every battle tick and which reads none of
 * this — 180KB of dex prose has no business in that import graph.
 *
 * What is NOT here, and why:
 *
 *   포획률 — rarityOfSpecies() reads the LINE ROOT's rate so a whole line shares
 *   one badge, which is what keeps the rarity filter coherent. Butterfree's own
 *   rate is 45 while its badge says 흔함 (Caterpie's 255). Printing both puts a
 *   visible contradiction on the card and invites someone to "fix" the filter.
 *
 *   알 그룹 · 성비 · 부화 걸음수 — this app has no breeding, no second parent and
 *   no steps, and Companion has no gender. Baking a statistic the app can never
 *   act on is the same mistake the README declines for 성격.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENDPOINT = 'https://graphql.pokeapi.co/v1beta2';
const MAX_SPECIES = 1025;

/**
 * The last species PokeAPI has a Korean dex entry for.
 *
 * #899 and up have none at all — not a fetch that failed, a translation that
 * does not exist upstream. Written as a BOUNDARY rather than as a count of 127
 * so the failure mode is loud: a request that silently comes back empty drags
 * this line down and the generator stops. Good news — a newly localised species
 * above it — only logs, because refusing to regenerate over that would be
 * perverse.
 *
 * Same instinct as NO_MACHINE_MOVES in gen-moves.ts: write the expectation down
 * so a failed request cannot masquerade as truth.
 */
const KO_FLAVOR_THROUGH = 898;

/** PokeAPI stat ids, in the order the six values are stored. */
const STAT_IDS = [1, 2, 3, 4, 5, 6];

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

/**
 * Upstream carries the original game text-box wrapping — \n between lines and
 * \f between pages. On a 420px panel those wrap a second time, so they are
 * collapsed to single spaces here rather than in the renderer: the stored
 * string should be the sentence, not the Game Boy's line breaks.
 */
function flatten(text: string): string {
  return text.replace(/[\n\f\r­]/g, ' ').replace(/\s+/g, ' ').trim();
}

type FlavorRow = { pokemon_species_id: number; flavor_text: string };
type PokemonRow = {
  id: number;
  pokemonstats: { stat_id: number; base_stat: number }[];
  pokemonabilities: { ability_id: number; is_hidden: boolean; slot: number }[];
};
type AbilityRow = {
  id: number;
  abilitynames: { name: string }[];
  abilityflavortexts: { flavor_text: string }[];
};

async function main() {
  process.stdout.write(`PokeAPI에서 #1-${MAX_SPECIES} 도감 정보 가져오는 중... `);

  /*
   * Newest version first, then folded to one row per species in code.
   * `distinct_on` would do the same server-side, but Hasura requires the
   * distinct column to lead `order_by`, which fights "newest first" — and the
   * whole set is only a megabyte.
   */
  const flavorQ = `{
    pokemonspeciesflavortext(
      where: {
        language: { name: { _eq: "ko" } }
        pokemon_species_id: { _lte: ${MAX_SPECIES} }
      }
      order_by: [{ pokemon_species_id: asc }, { version_id: desc }]
    ) { pokemon_species_id flavor_text }
  }`;

  const pokemonQ = `{
    pokemon(where: { id: { _lte: ${MAX_SPECIES} } }, order_by: { id: asc }, limit: 1200) {
      id
      pokemonstats { stat_id base_stat }
      pokemonabilities(order_by: { slot: asc }) { ability_id is_hidden slot }
    }
  }`;

  const abilityQ = `{
    ability(limit: 400) {
      id
      abilitynames(where: { language: { name: { _eq: "ko" } } }) { name }
      abilityflavortexts(
        where: { language: { name: { _eq: "ko" } } }
        order_by: { version_group_id: desc }
        limit: 1
      ) { flavor_text }
    }
  }`;

  const [flavorData, pokemonData, abilityData] = await Promise.all([
    gql<{ pokemonspeciesflavortext: FlavorRow[] }>(flavorQ),
    gql<{ pokemon: PokemonRow[] }>(pokemonQ),
    gql<{ ability: AbilityRow[] }>(abilityQ),
  ]);
  console.log('완료');

  // ── 도감 설명 ──────────────────────────────────────────────────────────────
  const flavor = new Map<number, string>();
  for (const r of flavorData.pokemonspeciesflavortext) {
    // Rows arrive newest-first per species, so the first one wins.
    if (!flavor.has(r.pokemon_species_id)) flavor.set(r.pokemon_species_id, flatten(r.flavor_text));
  }

  const missingBelow: number[] = [];
  for (let id = 1; id <= KO_FLAVOR_THROUGH; id++) if (!flavor.get(id)) missingBelow.push(id);
  if (missingBelow.length) {
    throw new Error(
      `한글 도감 설명이 사라진 종 ${missingBelow.length}개: ${missingBelow.slice(0, 20).join(', ')}` +
        ` — 요청이 조용히 실패했거나 KO_FLAVOR_THROUGH(${KO_FLAVOR_THROUGH})가 틀렸습니다.`,
    );
  }
  const gained: number[] = [];
  for (let id = KO_FLAVOR_THROUGH + 1; id <= MAX_SPECIES; id++) if (flavor.get(id)) gained.push(id);

  // ── 종족값 ─────────────────────────────────────────────────────────────────
  const stats = new Map<number, number[]>();
  for (const p of pokemonData.pokemon) {
    if (p.id > MAX_SPECIES) continue;
    /*
     * Read stat_id. Do NOT trust row order.
     *
     * gen-forms.ts gets away with `pokemonstats { base_stat }` because it only
     * SUMS them. A labelled six-tuple that silently transposes 공격 and 방어
     * looks perfectly reasonable and is wrong forever, so the mapping is
     * explicit and the shape is asserted.
     */
    const by = new Map(p.pokemonstats.map((s) => [s.stat_id, s.base_stat]));
    const row = STAT_IDS.map((sid) => by.get(sid));
    if (row.some((v) => v === undefined)) {
      throw new Error(`#${p.id}의 종족값이 모자랍니다: ${JSON.stringify(p.pokemonstats)}`);
    }
    const vals = row as number[];
    for (const v of vals) {
      if (!Number.isInteger(v) || v < 1 || v > 255) throw new Error(`#${p.id}의 종족값이 범위 밖입니다: ${v}`);
    }
    stats.set(p.id, vals);
  }

  // ── 특성 ───────────────────────────────────────────────────────────────────
  const abilityMeta = new Map(
    abilityData.ability.map((a) => [
      a.id,
      {
        ko: a.abilitynames[0]?.name ?? null,
        desc: a.abilityflavortexts[0] ? flatten(a.abilityflavortexts[0].flavor_text) : null,
      },
    ]),
  );

  const rawAbilities = new Map<number, { id: number; hidden: boolean }[]>();
  for (const p of pokemonData.pokemon) {
    if (p.id > MAX_SPECIES) continue;
    rawAbilities.set(
      p.id,
      p.pokemonabilities.map((a) => ({ id: a.ability_id, hidden: a.is_hidden })),
    );
  }

  const used = [...new Set([...rawAbilities.values()].flat().map((a) => a.id))].sort((a, b) => a - b);

  /*
   * A missing Korean NAME throws — the gen-species.ts rule, one table over.
   * Falling back to the slug would put "static" on a Korean screen, which is
   * the bug that rule exists to prevent. A missing DESCRIPTION does not throw:
   * upstream has 248 of 284, and the row simply ends after the name.
   */
  const noKoName = used.filter((id) => !abilityMeta.get(id)?.ko);
  if (noKoName.length) throw new Error(`한글명이 없는 특성: ${noKoName.join(', ')}`);

  const emptyAbilities = [...rawAbilities].filter(([, v]) => !v.length).map(([id]) => id);
  if (emptyAbilities.length) throw new Error(`특성이 없는 종: ${emptyAbilities.join(', ')}`);
  const missingStats: number[] = [];
  for (let id = 1; id <= MAX_SPECIES; id++) {
    if (!stats.has(id)) missingStats.push(id);
    if (!rawAbilities.has(id)) missingStats.push(id);
  }
  if (missingStats.length) throw new Error(`종족값/특성이 빠진 종: ${[...new Set(missingStats)].join(', ')}`);

  /** ability id -> its position in the emitted ABILITIES table. */
  const slot = new Map(used.map((id, i) => [id, i + 1]));
  const multiHidden = [...rawAbilities].filter(([, v]) => v.filter((a) => a.hidden).length > 1);

  // ── emit ───────────────────────────────────────────────────────────────────
  const abilityRows = used
    .map((id) => {
      const m = abilityMeta.get(id)!;
      return `  [${JSON.stringify(m.ko)},${m.desc ? JSON.stringify(m.desc) : 'null'}],`;
    })
    .join('\n');

  const speciesAbilityRows = Array.from({ length: MAX_SPECIES }, (_, i) => i + 1)
    .map((id) => {
      const v = rawAbilities.get(id)!;
      const enc = v.map((a) => (a.hidden ? -slot.get(a.id)! : slot.get(a.id)!));
      return `  ${id}: [${enc.join(',')}],`;
    })
    .join('\n');

  const statRows = Array.from({ length: MAX_SPECIES }, (_, i) => i + 1)
    .map((id) => `  ${id}: [${stats.get(id)!.join(',')}],`)
    .join('\n');

  const flavorRows = Array.from({ length: MAX_SPECIES }, (_, i) => i + 1)
    .filter((id) => flavor.get(id))
    .map((id) => `  ${id}: ${JSON.stringify(flavor.get(id))},`)
    .join('\n');

  const withDesc = used.filter((id) => abilityMeta.get(id)!.desc).length;

  const body = `// GENERATED by scripts/gen-dex.ts — do not edit by hand.
// Source: PokeAPI (https://pokeapi.co). Per-species facts the 도감 상세 화면 shows.
// Kept out of server/moves.ts on purpose: server/hunt.ts imports that on every
// battle tick and reads none of this.

/** The six base stats, in the order STATS rows store them. */
export const STAT_KO = ['HP', '공격', '방어', '특수공격', '특수방어', '스피드'] as const;

/** One ability: its Korean name, and its Korean description where there is one. */
export type AbilityInfo = { ko: string; desc: string | null };

/**
 * Every ability any species has, as [한글명, 한글설명].
 *
 * ${used.length} of them. Names are complete — a missing one throws at
 * generation rather than leaking an English slug onto a Korean screen.
 * Descriptions are ${withDesc}/${used.length}; the rest are null and the row
 * ends after the name.
 *
 * Indices are 1-based so SPECIES_ABILITY can negate one to mean "hidden".
 */
const ABILITIES: [string, string | null][] = [
${abilityRows}
];

/**
 * speciesId -> its abilities, as indices into ABILITIES. Hidden ones negated.
 *
 * A sign rather than an [index, boolean] pair: indices start at 1, so the
 * encoding can never be ambiguous, and the table is half the size. Measured
 * across all ${MAX_SPECIES} species, ${multiHidden.length} have more than one
 * hidden ability — but this encoding carries them anyway if that ever changes.
 */
const SPECIES_ABILITY: Record<number, number[]> = {
${speciesAbilityRows}
};

/**
 * speciesId -> [HP, 공격, 방어, 특수공격, 특수방어, 스피드].
 *
 * DISPLAY ONLY, and there is a test that keeps it that way. server/hunt.ts
 * models damage from move power and type effectiveness and must go on doing so:
 * the GOLDEN tables in test/hunt.test.ts are a promise that no fight changes,
 * and teaching the battle to read these would move every number in them.
 *
 * The one place a base stat is already allowed to matter is server/forms.ts's
 * \`power\` — measured from these totals at generation time, which is exactly
 * why the totals are worth showing on the card.
 */
const STATS: Record<number, number[]> = {
${statRows}
};

/**
 * The Korean dex entry, newest game first.
 *
 * ${flavor.size} of ${MAX_SPECIES}. Absent above #${KO_FLAVOR_THROUGH} rather
 * than English: an English sentence on a Korean screen is the failure
 * scripts/gen-species.ts throws over for natures. The panel draws no box at all
 * for a species without one.
 *
 * Line breaks are stripped at generation — upstream carries the original game
 * text-box wrapping, which wraps a second time in a 420px panel.
 */
const FLAVOR: Record<number, string> = {
${flavorRows}
};

/** The last species with a Korean dex entry. See scripts/gen-dex.ts. */
export const KO_FLAVOR_THROUGH = ${KO_FLAVOR_THROUGH};

/** This species' abilities, already in Korean. Hidden ones last. */
export function abilitiesOf(id: number): { ko: string; desc: string | null; hidden: boolean }[] {
  return (SPECIES_ABILITY[id] ?? []).map((n) => {
    const [ko, desc] = ABILITIES[Math.abs(n) - 1];
    return { ko, desc, hidden: n < 0 };
  });
}

/** The six base stats, or null outside 1..${MAX_SPECIES} — speciesInfo's contract. */
export function statsOf(id: number): number[] | null {
  return STATS[id] ?? null;
}

/** The Korean dex entry, or null where upstream has none. */
export function flavorOf(id: number): string | null {
  return FLAVOR[id] ?? null;
}
`;

  const here = path.dirname(fileURLToPath(import.meta.url));
  const out = path.join(here, '..', 'server', 'dexdata.ts');
  await fs.writeFile(out, body, 'utf8');

  console.log('→ server/dexdata.ts');
  console.log(`   종족값 ${stats.size}/${MAX_SPECIES}종`);
  console.log(`   특성 ${used.length}종류 — 한글명 전부, 한글설명 ${withDesc}개`);
  console.log(`   도감 설명 ${flavor.size}/${MAX_SPECIES}종 (한글이 있는 마지막 종 #${KO_FLAVOR_THROUGH})`);
  if (gained.length) {
    console.log(`   새로 번역된 종 ${gained.length}개 — KO_FLAVOR_THROUGH를 올릴 수 있습니다: ${gained.slice(0, 10).join(', ')}`);
  }
  if (multiHidden.length) {
    console.log(`   숨겨진 특성이 둘 이상인 종 ${multiHidden.length}개: ${multiHidden.map(([id]) => id).join(', ')}`);
  }
  const kb = Math.round(Buffer.byteLength(body) / 1024);
  console.log(`   파일 크기 ${kb}KB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
