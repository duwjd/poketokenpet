/**
 * One-time generator: builds server/forms.ts from PokeAPI.
 *
 * Run: npm run gen:forms
 *
 * Sibling of gen-species.ts, and for the same reason: a battle should never
 * stall because PokeAPI is slow. Where that one covers the 1025 base species,
 * this one covers the FORMS above them — mega (97), gigantamax (34) and the six
 * fusions — which is the second axis the game grows along.
 *
 * Sprites are not bundled here either. A form's PokeAPI pokemon id IS its
 * sprite id, so server/sprites.ts already resolves every one of these with no
 * changes at all; see the note on `id` below.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAMES } from '../server/species.ts';

const ENDPOINT = 'https://graphql.pokeapi.co/v1beta2';
const MAX_SPECIES = 1025;

type Row = {
  id: number;
  name: string;
  pokemon_species_id: number;
  height: number;
  weight: number;
  pokemonstats: { base_stat: number }[];
  pokemontypes: { slot: number; type: { name: string } }[];
  pokemonforms: {
    form_name: string;
    pokemonformnames: { name: string; language: { name: string } }[];
  }[];
};

const Q_FORMS = `{
  pokemon(where: { id: { _gt: 10000 } }, order_by: { id: asc }, limit: 500) {
    id
    name
    pokemon_species_id
    height
    weight
    pokemonstats { base_stat }
    pokemontypes(order_by: { slot: asc }) { slot type { name } }
    pokemonforms {
      form_name
      pokemonformnames(where: { language: { name: { _in: ["ko", "en"] } } }) {
        name
        language { name }
      }
    }
  }
}`;

const Q_BASE = `{
  pokemon(
    where: { id: { _lte: ${MAX_SPECIES} }, is_default: { _eq: true } }
    order_by: { id: asc }
    limit: 1200
  ) {
    id
    pokemonstats { base_stat }
  }
}`;

const Q_STONES = `{
  item(where: { itemcategory: { name: { _eq: "mega-stones" } } }, order_by: { id: asc }) {
    name
    itemnames(where: { language: { name: { _eq: "ko" } } }) { name }
  }
}`;

async function gql<T>(query: string): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const json = (await res.json()) as { data: T; errors?: unknown };
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

/**
 * The six fusions, written down rather than derived.
 *
 * PokeAPI models "Kyurem has a black form" but not "the black form is Kyurem
 * plus Zekrom" — there is no field anywhere for the second Pokemon. So the
 * pairing is the one thing here that cannot be generated. Everything else about
 * these rows (name, types, stats, size) still comes from the query above.
 */
const FUSIONS: { form: number; base: number; partner: number }[] = [
  { form: 10022, base: 646, partner: 644 }, // 블랙큐레무  = 큐레무 + 제크로무
  { form: 10023, base: 646, partner: 643 }, // 화이트큐레무 = 큐레무 + 레시라무
  { form: 10155, base: 800, partner: 791 }, // 황혼의 갈기  = 네크로즈마 + 솔가레오
  { form: 10156, base: 800, partner: 792 }, // 새벽의 날개  = 네크로즈마 + 루나아라
  { form: 10193, base: 898, partner: 896 }, // 백마 탄 모습 = 버드렉스 + 블리자포스
  { form: 10194, base: 898, partner: 897 }, // 흑마 탄 모습 = 버드렉스 + 레이스포스
];

/**
 * Ultra Burst is not a fusion — it is a mega, applied to an already-fused
 * Necrozma. Which is why `from` is a list: this is the one form in the game
 * reachable from something that is itself a form.
 */
const ULTRA_NECROZMA = { form: 10157, from: [10155, 10156] };

/**
 * Battle-only transformations that are mega-shaped but not called "mega".
 *
 * Primal Reversion and Ultra Burst work exactly the way a mega does — an item,
 * a battle, a revert afterwards — so they ride the same machinery rather than
 * getting one of their own. Their trigger items are named here because the
 * `${species}나이트` rule that names every mega stone does not apply to them.
 */
const SPECIAL_ITEMS: Record<number, { ko: string; sprite: string | null }> = {
  10077: { ko: '푸른구슬', sprite: 'blue-orb' },
  10078: { ko: '붉은구슬', sprite: 'red-orb' },
};

/**
 * Forms that need no item at all.
 *
 * Ultra Burst is the only one. Its stone could never be found anyway — stones
 * drop from the wild Pokemon that can use them, and Ultra Necrozma is reachable
 * only from an already-fused Necrozma, which never appears in the grass. And
 * requiring one would be wrong even if it could: getting this far already means
 * raising Solgaleo or Lunala, hatching Necrozma, and paying for the splicers.
 * That IS the cost. In the games it is story-granted for the same reason.
 */
const NO_ITEM = new Set([10157]);

/**
 * Korean for the qualifiers PokeAPI itself cannot supply.
 *
 * Most qualifiers are free: `magearna-original-mega` borrows the Korean of
 * `magearna-original`, `toxtricity-low-key-gmax` borrows `toxtricity-low-key`,
 * and 85 such variety names come back with the same query. Tatsugiri's three
 * are the only ones with no Korean anywhere upstream, so they are written down.
 *
 * A qualifier that stays unknown is not an error by itself — it only matters if
 * it lets two forms end up with the same Korean name, which the collision check
 * at the bottom of this file refuses outright.
 */
const QUALIFIER_KO: Record<string, string> = {
  curly: '말린 모습',
  droopy: '늘어진 모습',
  stretchy: '쭉 편 모습',
};

/** mega-x -> X, mega-female -> ♀, mega -> ''. */
function suffixOf(formName: string): string {
  const tail = formName.replace(/^(mega|primal|ultra)-?/, '');
  switch (tail) {
    case '': return '';
    case 'x': return 'X';
    case 'y': return 'Y';
    case 'z': return 'Z';
    case 'male': return '♂';
    case 'female': return '♀';
    default: throw new Error(`알 수 없는 폼 접미사: ${formName}`);
  }
}

/**
 * The slug fragment sitting between the species and the form.
 *
 * `magearna-original-mega` -> 'original'. Empty for the ordinary case.
 *
 * A token the form_name already carries is NOT a qualifier: `meowstic-male-mega`
 * has form_name `mega-male`, so 'male' is the suffix and there is nothing left
 * over. Without that check every gendered mega looks like an unknown word.
 */
function qualifierOf(row: Row, speciesSlug: string, formName: string): string {
  const tail = formName.replace(/^(mega|primal|ultra)-?/, '');
  const rest = row.name
    .slice(speciesSlug.length)
    .replace(/^-/, '')
    .replace(/-?(mega|primal|ultra|gmax).*$/, '')
    .replace(/^-|-$/g, '');
  return rest === tail ? '' : rest;
}

function main() {
  return run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

async function run() {
  process.stdout.write('PokeAPI에서 폼 데이터 가져오는 중... ');
  const [{ pokemon: rows }, { pokemon: bases }, { item: stoneItems }] = await Promise.all([
    gql<{ pokemon: Row[] }>(Q_FORMS),
    gql<{ pokemon: { id: number; pokemonstats: { base_stat: number }[] }[] }>(Q_BASE),
    gql<{ item: { name: string; itemnames: { name: string }[] }[] }>(Q_STONES),
  ]);
  console.log(`폼 ${rows.length}개 · 기준 종 ${bases.length}개 · 메가스톤 ${stoneItems.length}개`);

  const bst = (stats: { base_stat: number }[]) => stats.reduce((a, s) => a + s.base_stat, 0);
  const baseBst = new Map(bases.map((b) => [b.id, bst(b.pokemonstats)]));

  /** Korean stone name -> PokeAPI sprite slug. Only the localised ones land here. */
  const stoneSprite = new Map<string, string>();
  for (const it of stoneItems) {
    const ko = it.itemnames[0]?.name;
    if (ko) stoneSprite.set(ko, it.name);
  }

  const byId = new Map(rows.map((r) => [r.id, r]));
  const koName = (id: number) => {
    const n = NAMES[id];
    // Same rule as gen-species.ts: falling back to the slug is how "clefable-mega"
    // ends up on a Korean screen, so refuse instead.
    if (!n) throw new Error(`species.ts에 #${id}의 한글명이 없습니다`);
    return n[0];
  };
  const enName = (id: number) => {
    const n = NAMES[id];
    if (!n) throw new Error(`species.ts에 #${id}의 영문명이 없습니다`);
    return n[1];
  };

  /**
   * variety token -> its Korean name, harvested from the same response.
   *
   * `low-key` -> 로우한 모습, `original` -> 500년 전의 색. These are the labels
   * that tell two megas of one species apart, and PokeAPI already carries them
   * on the plain variety even when it has nothing for the mega itself.
   */
  const variantKo = new Map<string, string>();
  for (const r of rows) {
    const f = r.pokemonforms[0];
    if (!f?.form_name || /^(mega|gmax|primal|ultra)/.test(f.form_name)) continue;
    const ko = f.pokemonformnames.find((n) => n.language.name === 'ko')?.name;
    if (ko) variantKo.set(f.form_name, ko);
  }

  /** The parenthesised label that tells two forms of one species apart, or ''. */
  const tagFor = (r: Row, formName: string) => {
    const qual = qualifierOf(r, r.name.split('-')[0], formName);
    const ko = qual ? (QUALIFIER_KO[qual] ?? variantKo.get(qual)) : undefined;
    return ko ? `(${ko})` : '';
  };

  type Out = {
    id: number;
    base: number;
    kind: 'mega' | 'gmax' | 'fusion';
    ko: string;
    en: string;
    from: number[];
    types: string[];
    power: number;
    heightM: number;
    weightKg: number;
    stone?: { ko: string; sprite: string | null };
    partner?: number;
  };


  const rawName = (r: Row, lang: 'ko' | 'en') =>
    r.pokemonforms[0]?.pokemonformnames.find((n) => n.language.name === lang)?.name ?? null;

  /**
   * The upstream name, but only when it is a NAME.
   *
   * Some locales fill this field with a generic label instead: both Primal
   * Kyogre and Primal Groudon come back as 원시회귀의 모습, and every
   * Gigantamax is "Gigantamax Form". A label does not contain the species, so
   * requiring the species name to appear is what separates the two — and it
   * fails safe, since composing is what we would do anyway.
   */
  const official = (r: Row, lang: 'ko' | 'en', species: string) => {
    const n = rawName(r, lang);
    return n && n.includes(species) ? n : null;
  };

  const shared = (r: Row) => {
    const base = r.pokemon_species_id;
    const bb = baseBst.get(base);
    if (bb === undefined) throw new Error(`#${base}의 기준 종족값을 찾을 수 없습니다`);
    return {
      id: r.id,
      base,
      types: r.pokemontypes.map((t) => t.type.name),
      // Rounded to three places: 625/525 is 1.190476..., and a full float in a
      // generated file is noise in every future diff.
      power: Math.round((bst(r.pokemonstats) / bb) * 1000) / 1000,
      heightM: r.height / 10,
      weightKg: r.weight / 10,
    };
  };

  const out: Out[] = [];
  let composedName = 0;
  let composedStone = 0;

  // ── mega + primal ────────────────────────────────────────────────────────
  for (const r of rows) {
    const form = r.pokemonforms[0]?.form_name ?? '';
    if (!/^(mega|primal|ultra)/.test(form)) continue;
    const s = shared(r);
    const speciesKo = koName(s.base);
    const suffix = suffixOf(form);
    const tag = tagFor(r, form);
    const prefix = form.startsWith('primal') ? '원시' : form.startsWith('ultra') ? '울트라' : '메가';
    const ko = official(r, 'ko', speciesKo) ?? `${prefix}${speciesKo}${suffix}${tag}`;
    if (!official(r, 'ko', speciesKo)) composedName += 1;

    let stone = SPECIAL_ITEMS[r.id];
    if (!stone && !NO_ITEM.has(r.id)) {
      const stoneKo = `${speciesKo}나이트${suffix}${tag}`;
      stone = { ko: stoneKo, sprite: stoneSprite.get(stoneKo) ?? null };
    }
    if (stone && !stone.sprite) composedStone += 1;

    out.push({
      ...s,
      kind: 'mega',
      ko,
      en: official(r, 'en', enName(s.base)) ?? `Mega ${enName(s.base)}${suffix && ` ${suffix}`}`,
      from: r.id === ULTRA_NECROZMA.form ? ULTRA_NECROZMA.from : [s.base],
      ...(stone ? { stone } : {}),
    });
  }

  // ── gigantamax ───────────────────────────────────────────────────────────
  // PokeAPI has no Korean for any of these — the only ko string it carries is
  // the generic "Gigantamax Form" label, and not even that in Korean. So every
  // one is composed, the same way the games name them.
  for (const r of rows) {
    if ((r.pokemonforms[0]?.form_name ?? '') !== 'gmax') continue;
    const s = shared(r);
    // The qualifier matters here too: Toxtricity and Urshifu each have two
    // gigantamax forms, one per battle stance.
    const tag = tagFor(r, 'gmax');
    out.push({
      ...s,
      kind: 'gmax',
      ko: `거다이맥스 ${koName(s.base)}${tag}`,
      en: `Gigantamax ${enName(s.base)}`,
      from: [s.base],
    });
    composedName += 1;
  }

  // ── fusions ──────────────────────────────────────────────────────────────
  for (const f of FUSIONS) {
    const r = byId.get(f.form);
    if (!r) throw new Error(`합체 폼 #${f.form}이 PokeAPI 응답에 없습니다`);
    const s = shared(r);
    if (s.base !== f.base) throw new Error(`#${f.form}의 base가 ${s.base}, 표에는 ${f.base}`);
    const rawKo = rawName(r, 'ko');
    if (!rawKo) throw new Error(`합체 폼 #${f.form}에 한글명이 없습니다`);
    // Some fusions get a whole new name (블랙큐레무), others only a form label
    // (황혼의 갈기). A bare label on the partner tab reads as a different
    // Pokemon, so a label is put back under the species it belongs to.
    const speciesKo = koName(s.base);
    const ko = rawKo.includes(speciesKo) ? rawKo : `${speciesKo}(${rawKo})`;
    out.push({
      ...s,
      kind: 'fusion',
      ko,
      en: rawName(r, 'en') ?? r.name,
      from: [f.base],
      partner: f.partner,
    });
  }

  out.sort((a, b) => a.id - b.id);

  // ── invariants ───────────────────────────────────────────────────────────
  const dupe = new Map<string, number[]>();
  for (const f of out) {
    if (!dupe.has(f.ko)) dupe.set(f.ko, []);
    dupe.get(f.ko)!.push(f.id);
  }
  const collisions = [...dupe].filter(([, ids]) => ids.length > 1);
  if (collisions.length) {
    throw new Error(
      `한글명이 겹치는 폼: ${collisions.map(([ko, ids]) => `${ko} (${ids.join(', ')})`).join(' / ')}`,
    );
  }
  for (const f of out) {
    if (f.base < 1 || f.base > MAX_SPECIES) throw new Error(`#${f.id}의 base ${f.base}가 도감 밖입니다`);
    for (const src of f.from) {
      const ok = src <= MAX_SPECIES ? src >= 1 : out.some((o) => o.id === src);
      if (!ok) throw new Error(`#${f.id}의 from ${src}이 유효한 display id가 아닙니다`);
    }
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const dest = path.join(here, '..', 'server', 'forms.ts');

  const body = `// GENERATED by scripts/gen-forms.ts — do not edit by hand.
// Source: PokeAPI (https://pokeapi.co). Mega, Gigantamax and fusion forms.
// Sprites themselves are never bundled; they are fetched at runtime.

import type { MoveType } from './moves.ts';

export type FormKind = 'mega' | 'gmax' | 'fusion';

/**
 * One alternate form — the second axis a companion can move along.
 *
 * The first axis is \`stageIndex\` walking \`pathIds\`, which never leaves the
 * 1025 base species. A form sits beside that: it replaces what is DRAWN and
 * NAMED without touching which species the companion is for the dex, its
 * rarity, its learnset or its evolution line.
 */
export type Form = {
  /**
   * PokeAPI pokemon id, which is also the sprite id.
   *
   * That equality is why this whole feature needs no change to
   * server/sprites.ts: \`ensureSprite\` resolves any number, and its
   * \`id <= BW_MAX_ID ? 0 : 1\` already starts these above the Gen-5 tier.
   */
  id: number;
  /** The base species. Dex, rarity, learnset and the tray all keep using this. */
  base: number;
  kind: FormKind;
  ko: string;
  en: string;
  /**
   * Display ids this form can be reached from. Usually just \`[base]\`.
   *
   * Ultra Necrozma is the reason this is a list: it is an Ultra Burst on an
   * ALREADY-FUSED Necrozma, so it is reachable only from two other forms.
   */
  from: number[];
  types: MoveType[];
  /**
   * Form base-stat total over the base species'.
   *
   * Measured, not invented: every mega is a flat +100 (about 1.19), and every
   * gigantamax is exactly 1 — Gigantamax changes no stat in the games, it
   * doubles HP, which this app expresses as halved incoming damage instead.
   */
  power: number;
  heightM: number;
  weightKg: number;
  /** Mega only: the stone that opens it. \`sprite\` is null where PokeAPI has no icon. */
  stone?: { ko: string; sprite: string | null };
  /** Fusion only: the species that must already be in the dex. */
  partner?: number;
};

export const FORMS: Form[] = ${JSON.stringify(out, null, 2)} as Form[];

const BY_ID = new Map(FORMS.map((f) => [f.id, f]));

export function formById(id: number): Form | null {
  return BY_ID.get(id) ?? null;
}

/**
 * display id -> the forms reachable from it.
 *
 * Keyed by display id rather than by species precisely so a fused Necrozma can
 * offer Ultra Burst while a plain one cannot.
 */
const FROM = (() => {
  const m = new Map<number, Form[]>();
  for (const f of FORMS) {
    for (const src of f.from) {
      if (!m.has(src)) m.set(src, []);
      m.get(src)!.push(f);
    }
  }
  return m;
})();

export function formsFrom(displayId: number): Form[] {
  return FROM.get(displayId) ?? [];
}
`;

  await fs.writeFile(dest, body, 'utf8');

  const n = (k: string) => out.filter((f) => f.kind === k).length;
  console.log('→ server/forms.ts');
  console.log(`   메가 ${n('mega')} · 거다이맥스 ${n('gmax')} · 합체 ${n('fusion')} (총 ${out.length})`);
  console.log(`   한글명 공식 ${out.length - composedName}개 / 합성 ${composedName}개`);
  console.log(`   메가스톤 아이콘 있음 ${n('mega') - composedStone}개 / 없음 ${composedStone}개`);
}

main();
