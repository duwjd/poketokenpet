/**
 * One-time generator: builds server/abilitydata.ts from PokeAPI.
 *
 * Run: npm run gen:abilities
 *
 * What the BATTLE needs to know about abilities, apart from what the dex card
 * shows (server/dexdata.ts has the Korean names and descriptions for that).
 * Kept apart from dexdata.ts on purpose: server/state.ts and server/game.ts may
 * never import dexdata.ts, and server/fight.ts only its stats — see
 * test/payload-shape.test.ts. The battle keys abilities by PokeAPI's English
 * slug ('serene-grace'), which is stable where the Korean name is not unique.
 *
 * Three tables:
 * - every species' abilities, ordinary slots first, the hidden one apart;
 * - every mega / gigantamax / fusion form's ability (a mega has exactly one);
 * - the alternate battle forms that an ability switches into mid-fight —
 *   킬가르도's blade, 불비달마's zen mode, 약어리's school — with their own
 *   types and base stats, so the fight never invents a number.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMS } from '../server/forms.ts';

const ENDPOINT = 'https://graphql.pokeapi.co/v1beta2';
const MAX_SPECIES = 1025;

/**
 * The forms an ability changes a Pokemon into during a fight, by PokeAPI name.
 * Their stats are fetched, never written down.
 */
const ALT_FORMS = [
  'aegislash-shield', 'aegislash-blade', // 배틀스위치
  'darmanitan-standard', 'darmanitan-zen', // 달마모드
  'wishiwashi-solo', 'wishiwashi-school', // 어군
  'minior-red-meteor', 'minior-red', // 리밋실드
  'zygarde-50', 'zygarde-complete', // 스웜체인지
  'palafin-zero', 'palafin-hero', // 마이티체인지
  'mimikyu-disguised', 'mimikyu-busted', // 탈
  'eiscue-ice', 'eiscue-noice', // 아이스페이스
  'castform', 'castform-sunny', 'castform-rainy', 'castform-snowy', // 기분파
  'greninja-battle-bond', 'greninja-ash', // 유대변화
  'morpeko-full-belly', 'morpeko-hangry', // 꼬르륵스위치
  'cramorant', 'cramorant-gulping', 'cramorant-gorging', // 그대로꿀꺽미사일
  'meloetta-aria', 'meloetta-pirouette', // 옛노래 — a move, not an ability, but the same kind of switch
  'terapagos', 'terapagos-terastal', // 테라체인지
];

type Ability = { id: number; name: string; abilitynames: { name: string }[] };
type PokeAbility = { pokemon_id: number; ability: { name: string }; is_hidden: boolean; slot: number };
type PokeRow = {
  id: number;
  name: string;
  pokemontypes: { slot: number; type: { name: string } }[];
  pokemonstats: { base_stat: number; stat: { name: string } }[];
};

async function gql<T>(query: string): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'poketokenpet-gen' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const json = (await res.json()) as { data: T; errors?: unknown };
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const STAT_ORDER = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed'];

async function main() {
  const formIds = FORMS.map((f) => f.id);
  process.stdout.write('종·폼 특성 가져오는 중... ');
  const rows = (
    await gql<{ pokemonability: PokeAbility[] }>(`{
      pokemonability(
        where: { _or: [{ pokemon_id: { _lte: ${MAX_SPECIES} } }, { pokemon_id: { _in: ${JSON.stringify(formIds)} } }] }
        order_by: [{ pokemon_id: asc }, { slot: asc }]
      ) { pokemon_id ability { name } is_hidden slot }
    }`)
  ).pokemonability;
  console.log(`${rows.length}줄`);

  const alt = (
    await gql<{ pokemon: PokeRow[] }>(`{
      pokemon(where: { name: { _in: ${JSON.stringify(ALT_FORMS)} } }) {
        id name
        pokemontypes(order_by: { slot: asc }) { slot type { name } }
        pokemonstats { base_stat stat { name } }
      }
    }`)
  ).pokemon;
  const missingAlt = ALT_FORMS.filter((n) => !alt.some((p) => p.name === n));
  if (missingAlt.length) throw new Error(`없는 배틀 폼: ${missingAlt.join(', ')}`);

  const slugs = [...new Set(rows.map((r) => r.ability.name))].sort();
  const abilities = (
    await gql<{ ability: Ability[] }>(`{
      ability(where: { name: { _in: ${JSON.stringify(slugs)} } }) {
        id name abilitynames(where: { language: { name: { _eq: "ko" } } }) { name }
      }
    }`)
  ).ability;
  const ko: Record<string, string> = {};
  for (const a of abilities) ko[a.name] = a.abilitynames[0]?.name ?? '';
  // A handful of the newest have no Korean name upstream yet. Said here rather
  // than guessed: the battle names them by slug until PokeAPI catches up.
  const noKo = slugs.filter((s) => !ko[s]);
  if (noKo.length) console.log(`   한글명이 없는 특성 ${noKo.length}개: ${noKo.join(', ')}`);

  const species: Record<number, [string[], string | null]> = {};
  const forms: Record<number, string[]> = {};
  for (const r of rows) {
    if (r.pokemon_id <= MAX_SPECIES) {
      const e = (species[r.pokemon_id] ??= [[], null]);
      if (r.is_hidden) e[1] = r.ability.name;
      else if (!e[0].includes(r.ability.name)) e[0].push(r.ability.name);
    } else {
      (forms[r.pokemon_id] ??= []).push(r.ability.name);
    }
  }
  const noAbility = [...Array(MAX_SPECIES).keys()].map((i) => i + 1).filter((id) => !species[id]?.[0].length);
  if (noAbility.length) throw new Error(`특성이 없는 종: ${noAbility.join(', ')}`);

  const altForms: Record<string, { id: number; types: string[]; stats: number[] }> = {};
  for (const p of alt) {
    altForms[p.name] = {
      id: p.id,
      types: p.pokemontypes.map((t) => t.type.name),
      stats: STAT_ORDER.map((s) => p.pokemonstats.find((x) => x.stat.name === s)?.base_stat ?? 0),
    };
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const out = path.join(here, '..', 'server', 'abilitydata.ts');
  const body = `// GENERATED by scripts/gen-abilities.ts — do not edit by hand.
// Source: PokeAPI (https://pokeapi.co). Abilities as the battle reads them.

import type { MoveType } from './moves.ts';

/** Every ability a species or form here can have, slug -> Korean name ('' where PokeAPI has none yet). */
export const ABILITY_KO: Record<string, string> = ${JSON.stringify(ko, null, 2)};

/** speciesId -> [its ordinary abilities, in slot order; its hidden ability or null]. Every id 1..${MAX_SPECIES}. */
export const SPECIES_ABILITIES: Record<number, [string[], string | null]> = ${JSON.stringify(species)};

/** Form id (mega, gigantamax, fusion) -> its abilities. A mega has exactly one. */
export const FORM_ABILITIES: Record<number, string[]> = ${JSON.stringify(forms)};

/** The forms an ability switches into mid-fight, by PokeAPI name: their own types and base stats. */
export const BATTLE_FORMS: Record<string, { id: number; types: MoveType[]; stats: number[] }> = ${JSON.stringify(altForms, null, 2)};
`;
  await fs.writeFile(out, body, 'utf8');
  console.log(`→ server/abilitydata.ts — 특성 ${slugs.length}개, 종 ${Object.keys(species).length}, 폼 ${Object.keys(forms).length}, 배틀 폼 ${alt.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
