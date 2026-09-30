/**
 * One-time generator: builds server/moves.ts from PokeAPI.
 *
 * Run: npm run gen:moves
 *
 * Same bargain as gen-species.ts — bake the table into the repo so teaching a
 * move never fails because PokeAPI is slow or down.
 *
 * Two learn methods, two scopes:
 *
 * - **Machines** (`move_learn_method_id = 4`), unioned across EVERY version
 *   group. Scarlet/Violet alone is 229 machines but leaves 297 species unable
 *   to learn anything, because they simply aren't in the Paldea dex. The union
 *   covers 1016 of 1025 species. This is what `LEARNSET` and `canLearn` mean.
 * - **Level-up** (`move_learn_method_id = 1`), from ONE version group per
 *   species: the newest mainline game that has it (see `LEVEL_UP_ORDER`).
 *   Levels move between generations — 리자드 learns 화염방사 at 30 in one
 *   and 38 in another — so a union would teach each move at whichever level
 *   was lowest in any game, which is no game at all. This is `LEVELUP`.
 *
 * The move table is the union of both, and nothing else: a move only an old
 * game taught by level-up (추격, 태권당수) is not in it, because nothing here
 * could learn it.
 *
 * TM numbers are deliberately NOT carried: they are renumbered every
 * generation, so the same "TM01" means a different move depending on the game.
 * A TM here is identified by its move, and its icon comes from the move's type
 * (sprites/items/tm-{type}.png, which exists for all 18 types).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENDPOINT = 'https://graphql.pokeapi.co/v1beta2';
const MACHINE = 4; // movelearnmethod.id
const LEVEL_UP = 1;

/**
 * Version groups to take a species' level-up learnset from, newest mainline
 * first: Scarlet/Violet and its two DLCs, Sword/Shield, Brilliant Diamond/
 * Shining Pearl, then back through the generations.
 *
 * Left out on purpose: Let's Go (19), Legends: Arceus (24) and everything past
 * the DLCs (28+). Their movesets are built around mechanics the mainline
 * battle does not have — Legends: Arceus has no PP as the games know it and
 * moves are "mastered" — so their levels are not the answer to "when does it
 * learn this".
 */
const LEVEL_UP_ORDER = [25, 27, 26, 20, 23, 18, 17, 16, 15, 14, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

/**
 * Moves a transcribed gym roster carries that no species here learns any more.
 *
 * server/gymdata.ts transcribes leaders from the game each roster comes from,
 * and a Generation 5 leader can know a move Generation 9 dropped. Keeping those
 * few in the table is what lets the transcription say what the leader
 * actually carried.
 */
const ROSTER_ONLY: number[] = [
  2, 26, // 태권당수 (연무의 타격귀), 점프킥 (연무의 비조도)
  // server/legendmoves.ts: signature moves the current games teach no species
  // by level — 거수참 · 거수탄 (자시안 · 자마젠타), 블리자드랜스 · 아스트랄비트
  // (블리자포스 · 레이스포스).
  781, 782, 824, 825,
];

/** PokeAPI's move attributes, in id order — the bit each sets in `MoveInfo.flags`. */
const FLAGS = [
  'contact', 'charge', 'recharge', 'protect', 'reflectable', 'snatch', 'mirror', 'punch', 'sound',
  'gravity', 'defrost', 'distance', 'heal', 'authentic', 'powder', 'bite', 'pulse', 'ballistics',
  'mental', 'non-sky-battle', 'dance',
] as const;
const MAX_SPECIES = 1025;
/** Species ids to fetch per request. 340k rows total, so this must be chunked. */
const CHUNK = 40;

/**
 * Species that legitimately learn nothing by machine.
 *
 * Hard-coded so a chunk that silently fails cannot masquerade as "this Pokemon
 * can never learn anything". Weedle/Kakuna, Ditto, Smeargle, Wurmple/Silcoon/
 * Cascoon, Cosmog, Blipbug — all faithful to the games.
 */
const NO_MACHINE_MOVES = [13, 14, 132, 235, 265, 266, 268, 789, 824];

const TYPES = [
  'normal', 'fighting', 'flying', 'poison', 'ground', 'rock',
  'bug', 'ghost', 'steel', 'fire', 'water', 'grass',
  'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy',
] as const;

const DAMAGE_CLASSES = ['physical', 'special', 'status'] as const;

/** The stats a move can move, in PokeAPI's stat-id order. */
const STATS = [
  'attack', 'defense', 'special-attack', 'special-defense', 'speed', 'accuracy', 'evasion',
] as const;

type MoveRow = {
  id: number;
  name: string;
  power: number | null;
  accuracy: number | null;
  pp: number | null;
  movedamageclass: { name: string } | null;
  type: { name: string } | null;
  /** -7..+5. Quick Attack is +1, Focus Punch -3. */
  priority: number | null;
  /** Who it lands on: 'user', 'selected-pokemon', 'entire-field', … */
  movetarget: { name: string } | null;
  /** The stat stages it moves, and by how much. Empty for most moves. */
  movemetastatchanges: { change: number; stat: { name: string } }[];
  movenames: { name: string; language: { name: string } }[];
  /** PokeAPI's effect id: moves that share one work the same way. Null for the newest. */
  move_effect_id: number | null;
  moveattributemaps: { moveattribute: { name: string } }[];
  /**
   * What the move DOES beyond damage. An array upstream, but at most one row
   * in practice — and empty for a handful of Gen-9 machines PokeAPI has not
   * filled in yet, which is why every read of it is guarded.
   */
  movemeta: {
    ailment_chance: number | null;
    movemetaailment: { name: string } | null;
    movemetacategory: { name: string } | null;
    /** Percent of the damage dealt: positive heals the user, negative is recoil. */
    drain: number | null;
    /** Percent of max HP a healing move restores. */
    healing: number | null;
    crit_rate: number | null;
    flinch_chance: number | null;
    /** Percent chance a damaging move's stat change lands. 0 on a status move. */
    stat_chance: number | null;
    min_hits: number | null;
    max_hits: number | null;
  }[];
};

/**
 * Moves PokeAPI ships with no `movemeta` row.
 *
 * Newer moves, mostly Gen 9 — 75 of them once level-up moves came in. They are
 * emitted with no ailment and no category rather than throwing, and
 * server/battlefield.ts's MOVE_PATCHES writes back what each one does. The
 * count is asserted: if it grows without bound the query shape has changed
 * and the whole column is quietly empty.
 */
const MAX_MISSING_META = 90;

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

/** These moves, in full. */
async function fetchMoves(ids: number[]): Promise<MoveRow[]> {
  const data = await gql<{ move: MoveRow[] }>(`{
    move(where: { id: { _in: ${JSON.stringify(ids)} } }) {
        id
        name
        power
        accuracy
        pp
        movedamageclass { name }
        type { name }
        priority
        movetarget { name }
        movemetastatchanges(order_by: { stat_id: asc }) { change stat { name } }
        movemeta {
          ailment_chance
          movemetaailment { name }
          movemetacategory { name }
          drain
          healing
          crit_rate
          flinch_chance
          stat_chance
          min_hits
          max_hits
        }
        movenames(where: { language: { name: { _in: ["ko", "en"] } } }) {
          name
          language { name }
        }
        move_effect_id
        moveattributemaps { moveattribute { name } }
    }
  }`);
  return data.move.sort((a, b) => a.id - b.id);
}

/**
 * Each species' level-up learnset, from the newest version group that has one.
 *
 * `[level, moveId]` pairs, level order. Level 0 is PokeAPI's "on evolution" —
 * learned the moment it evolves into this species, whatever its level.
 */
async function fetchLevelUp(): Promise<Map<number, [number, number][]>> {
  const out = new Map<number, [number, number][]>();
  for (let lo = 1; lo <= MAX_SPECIES; lo += CHUNK) {
    const hi = Math.min(lo + CHUNK - 1, MAX_SPECIES);
    const data = await gql<{
      pokemonmove: { pokemon_id: number; move_id: number; level: number; version_group_id: number }[];
    }>(`{
      pokemonmove(
        where: {
          move_learn_method_id: { _eq: ${LEVEL_UP} }
          pokemon_id: { _gte: ${lo}, _lte: ${hi} }
        }
      ) {
        pokemon_id
        move_id
        level
        version_group_id
      }
    }`);
    const byVg = new Map<number, Map<number, [number, number][]>>();
    for (const r of data.pokemonmove) {
      if (!byVg.has(r.pokemon_id)) byVg.set(r.pokemon_id, new Map());
      const m = byVg.get(r.pokemon_id)!;
      if (!m.has(r.version_group_id)) m.set(r.version_group_id, []);
      m.get(r.version_group_id)!.push([r.level, r.move_id]);
    }
    for (const [id, vgs] of byVg) {
      const vg = LEVEL_UP_ORDER.find((v) => vgs.has(v));
      if (vg === undefined) continue;
      const seen = new Set<string>();
      const rows = vgs
        .get(vg)!
        .filter(([lv, mv]) => {
          const k = `${lv}:${mv}`;
          return seen.has(k) ? false : (seen.add(k), true);
        })
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      out.set(id, rows);
    }
    process.stdout.write(`\r   #${lo}-${hi} … ${out.size}종`);
  }
  process.stdout.write('\n');
  return out;
}

/** Korean type names, for the TM label. */
async function fetchTypeNames(): Promise<Record<string, string>> {
  const data = await gql<{ type: { name: string; typenames: { name: string }[] }[] }>(`{
    type(where: { name: { _in: [${TYPES.map((t) => `"${t}"`).join(', ')}] } }) {
      name
      typenames(where: { language: { name: { _eq: "ko" } } }) { name }
    }
  }`);
  const out: Record<string, string> = {};
  for (const t of data.type) out[t.name] = t.typenames[0]?.name ?? t.name;
  return out;
}

/**
 * (species, move) pairs, chunked by species id.
 *
 * 340k rows do not come back in one request. `distinct_on` collapses the same
 * pair appearing in several version groups, which is the common case.
 */
async function fetchLearnsets(): Promise<Map<number, Set<number>>> {
  const out = new Map<number, Set<number>>();
  for (let lo = 1; lo <= MAX_SPECIES; lo += CHUNK) {
    const hi = Math.min(lo + CHUNK - 1, MAX_SPECIES);
    const data = await gql<{ pokemonmove: { pokemon_id: number; move_id: number }[] }>(`{
      pokemonmove(
        where: {
          move_learn_method_id: { _eq: ${MACHINE} }
          pokemon_id: { _gte: ${lo}, _lte: ${hi} }
        }
        distinct_on: [pokemon_id, move_id]
        order_by: [{ pokemon_id: asc }, { move_id: asc }]
      ) {
        pokemon_id
        move_id
      }
    }`);
    for (const r of data.pokemonmove) {
      let set = out.get(r.pokemon_id);
      if (!set) out.set(r.pokemon_id, (set = new Set()));
      set.add(r.move_id);
    }
    process.stdout.write(`\r   #${lo}-${hi} … ${out.size}종`);
  }
  process.stdout.write('\n');
  return out;
}

type SpeciesRow = {
  types: MoveType[];
  genus: string;
  heightM: number;
  weightKg: number;
};

type MoveType = (typeof TYPES)[number];

/**
 * Per-species facts the status screen shows: types, genus, height, weight.
 *
 * `pokemon` is keyed by FORM, so #668 comes back as "pyroar-male". Base forms
 * are ids 1..1025, which is exactly the range we raise, so the filter is enough.
 *
 * height is in decimetres and weight in hectograms upstream — both get divided
 * by ten here so nothing downstream has to remember that.
 */
async function fetchSpecies(): Promise<Map<number, SpeciesRow>> {
  const forms = await gql<{
    pokemon: {
      id: number;
      height: number | null;
      weight: number | null;
      pokemontypes: { slot: number; type: { name: string } | null }[];
    }[];
  }>(`{
    pokemon(where: { id: { _lte: ${MAX_SPECIES} } }, order_by: { id: asc }, limit: 1200) {
      id
      height
      weight
      pokemontypes(order_by: { slot: asc }) { slot type { name } }
    }
  }`);

  const genera = await gql<{
    pokemonspecies: { id: number; pokemonspeciesnames: { genus: string }[] }[];
  }>(`{
    pokemonspecies(where: { id: { _lte: ${MAX_SPECIES} } }, order_by: { id: asc }, limit: 1200) {
      id
      pokemonspeciesnames(where: { language: { name: { _eq: "ko" } } }) { genus }
    }
  }`);

  const genusById = new Map(
    genera.pokemonspecies.map((s) => [s.id, s.pokemonspeciesnames[0]?.genus ?? '']),
  );

  const known = new Set<string>(TYPES);
  const out = new Map<number, SpeciesRow>();
  for (const f of forms.pokemon) {
    const types = f.pokemontypes
      .map((t) => t.type?.name)
      .filter((n): n is MoveType => typeof n === 'string' && known.has(n));
    out.set(f.id, {
      types,
      genus: genusById.get(f.id) ?? '',
      heightM: Math.round(((f.height ?? 0) / 10) * 10) / 10,
      weightKg: Math.round(((f.weight ?? 0) / 10) * 10) / 10,
    });
  }
  return out;
}

/**
 * The 18x18 type chart.
 *
 * PokeAPI's type ids line up exactly with the TYPES array above (id = index+1),
 * verified against fire->grass 200, water->fire 200, electric->ground 0 and
 * normal->ghost 0. Every factor is 0, 50, 100 or 200, so the whole chart packs
 * into 324 single digits.
 */
async function fetchTypeChart(): Promise<string> {
  const data = await gql<{
    typeefficacy: { damage_type_id: number; target_type_id: number; damage_factor: number }[];
  }>(`{
    typeefficacy(where: { damage_type_id: { _lte: 18 }, target_type_id: { _lte: 18 } }) {
      damage_type_id
      target_type_id
      damage_factor
    }
  }`);

  const CODE: Record<number, string> = { 0: '0', 50: '1', 100: '2', 200: '3' };
  const cells = new Array<string>(18 * 18).fill('');
  for (const r of data.typeefficacy) {
    const code = CODE[r.damage_factor];
    if (code === undefined) throw new Error(`모르는 상성 배율: ${r.damage_factor}`);
    cells[(r.damage_type_id - 1) * 18 + (r.target_type_id - 1)] = code;
  }
  const missing = cells.findIndex((c) => c === '');
  if (missing >= 0) {
    throw new Error(`상성표에 빈칸이 있습니다: ${Math.floor(missing / 18) + 1} -> ${(missing % 18) + 1}`);
  }
  return cells.join('');
}

/** Pack move indices into a bitset, little-endian within each byte. */
function packBitset(indices: number[], bits: number): string {
  const bytes = new Uint8Array(Math.ceil(bits / 8));
  for (const i of indices) bytes[i >> 3] |= 1 << (i & 7);
  return Buffer.from(bytes).toString('base64');
}

async function main() {
  console.log('종별 학습 가능 기술 가져오는 중...');
  const learnsets = await fetchLearnsets();
  console.log('종별 레벨업 기술 가져오는 중...');
  const levelUp = await fetchLevelUp();
  const missingLevelUp = [...Array(MAX_SPECIES).keys()].map((i) => i + 1).filter((id) => !levelUp.has(id));
  if (missingLevelUp.length) throw new Error(`레벨업 기술이 없는 종: ${missingLevelUp.slice(0, 20).join(', ')}`);

  const machineIds = new Set([...learnsets.values()].flatMap((s) => [...s]));
  const levelIds = new Set([...levelUp.values()].flatMap((rows) => rows.map(([, m]) => m)));
  const ids = [...new Set([...machineIds, ...levelIds, ...ROSTER_ONLY])].sort((a, b) => a - b);
  process.stdout.write(`기술 ${ids.length}개 가져오는 중 (기술머신 ${machineIds.size} · 레벨업 ${levelIds.size})... `);
  const moves = await fetchMoves(ids);
  console.log(`${moves.length}개`);
  if (moves.length !== ids.length) throw new Error(`기술 수가 맞지 않습니다: ${moves.length} / ${ids.length}`);

  const typeKo = await fetchTypeNames();

  process.stdout.write('종 정보(타입·분류·크기) 가져오는 중... ');
  const species = await fetchSpecies();
  console.log(`${species.size}종`);

  process.stdout.write('타입 상성표 가져오는 중... ');
  const typeChart = await fetchTypeChart();
  console.log(`${typeChart.length}칸`);

  // Every move must land in the 18 known types and 3 damage classes; a new
  // type would silently become "normal" and pick the wrong TM sprite.
  const typeIndex = new Map<string, number>(TYPES.map((t, i) => [t, i]));
  const dcIndex = new Map<string, number>(DAMAGE_CLASSES.map((d, i) => [d, i]));
  for (const m of moves) {
    if (!m.type || !typeIndex.has(m.type.name)) {
      throw new Error(`모르는 타입: ${m.name} -> ${m.type?.name}`);
    }
    if (!m.movedamageclass || !dcIndex.has(m.movedamageclass.name)) {
      throw new Error(`모르는 분류: ${m.name} -> ${m.movedamageclass?.name}`);
    }
  }

  /**
   * The ailment and category vocabularies, read off the data rather than
   * written down here.
   *
   * Deliberately NOT collapsed into the handful the battle simulator models:
   * the generator ships facts and `server/hunt.ts` decides what a torment or a
   * leech-seed is worth. Re-tuning that should never need a network round trip.
   * 'none' is pinned to index 0 so an absent column reads as "does nothing".
   */
  const vocab = (names: (string | undefined)[]) => {
    const rest = [...new Set(names.filter((n): n is string => !!n && n !== 'none'))].sort();
    return ['none', ...rest];
  };
  const metaOf = (m: MoveRow) => m.movemeta[0];
  const AILMENTS = vocab(moves.map((m) => metaOf(m)?.movemetaailment?.name));
  const CATEGORIES = vocab(moves.map((m) => metaOf(m)?.movemetacategory?.name));

  const noMeta = moves.filter((m) => !metaOf(m));
  if (noMeta.length > MAX_MISSING_META) {
    throw new Error(
      `movemeta가 없는 기술이 ${noMeta.length}개입니다 (허용 ${MAX_MISSING_META}).\n` +
        '쿼리 모양이 바뀌어 상태 컬럼이 통째로 비었을 수 있습니다.',
    );
  }
  if (noMeta.length) {
    console.log(`   상태 정보가 없는 기술 ${noMeta.length}개는 효과 없음으로 둡니다`);
  }
  console.log(`   상태이상 ${AILMENTS.length - 1}종 · 분류 ${CATEGORIES.length - 1}종`);

  const TARGETS = vocab(moves.map((m) => m.movetarget?.name));
  const targetIndex = new Map(TARGETS.map((t, i) => [t, i]));
  const statIndex = new Map<string, number>(STATS.map((t, i) => [t, i]));
  for (const m of moves) {
    for (const c of m.movemetastatchanges) {
      if (!statIndex.has(c.stat.name)) throw new Error(`모르는 능력치: ${c.stat.name} (${m.name})`);
    }
  }
  const ailIndex = new Map(AILMENTS.map((a, i) => [a, i]));
  const catIndex = new Map(CATEGORIES.map((c, i) => [c, i]));

  /**
   * How often the ailment lands, as a percentage.
   *
   * Upstream reports 0 for a status move whose entire purpose IS the ailment —
   * Thunder Wave paralyses every time it connects, and its ailment_chance is 0.
   * Normalising here means the runtime has exactly one reading of the number.
   */
  const ailmentChance = (m: MoveRow) => {
    const meta = metaOf(m);
    const name = meta?.movemetaailment?.name;
    if (!name || name === 'none') return 0;
    const raw = meta?.ailment_chance ?? 0;
    if (raw > 0) return raw;
    return m.movedamageclass?.name === 'status' ? 100 : 0;
  };

  const moveIndex = new Map(moves.map((m, i) => [m.id, i]));
  const ko = (m: MoveRow) => m.movenames.find((n) => n.language.name === 'ko')?.name ?? m.name;
  const en = (m: MoveRow) => m.movenames.find((n) => n.language.name === 'en')?.name ?? m.name;

  const missingKo = moves.filter((m) => !m.movenames.some((n) => n.language.name === 'ko'));
  if (missingKo.length) {
    console.log(`   한글명 없는 기술 ${missingKo.length}개는 영문 슬러그로 대체합니다`);
  }

  // Bitsets, only for species inside the Pokedex we actually raise.
  const learnset: Record<number, string> = {};
  const empty: number[] = [];
  for (let id = 1; id <= MAX_SPECIES; id++) {
    const ids = [...(learnsets.get(id) ?? [])]
      .map((mid) => moveIndex.get(mid))
      .filter((i): i is number => i !== undefined)
      .sort((a, b) => a - b);
    if (ids.length === 0) {
      empty.push(id);
      continue; // absent key = learns nothing; canLearn handles it
    }
    learnset[id] = packBitset(ids, moves.length);
  }

  // The assertion that matters: a dropped chunk must never look like a
  // Pokemon that legitimately cannot learn anything.
  const unexpected = empty.filter((id) => !NO_MACHINE_MOVES.includes(id));
  if (unexpected.length) {
    throw new Error(
      `학습 가능 기술이 하나도 없는 예상 밖의 종: ${unexpected.join(', ')}\n` +
        '청크 요청이 조용히 실패했을 수 있습니다. 다시 실행해 보세요.',
    );
  }
  const alsoMissing = NO_MACHINE_MOVES.filter((id) => !empty.includes(id));
  if (alsoMissing.length) {
    console.log(`   기술머신을 배우게 된 종이 생겼습니다: ${alsoMissing.join(', ')} — 목록 갱신 필요`);
  }

  // Same discipline as gen-species.ts: a silently failed query must not become
  // a Pokemon with no type, which would render as an empty badge row forever.
  const badTypes: number[] = [];
  const badGenus: number[] = [];
  for (let id = 1; id <= MAX_SPECIES; id++) {
    const r = species.get(id);
    if (!r || r.types.length < 1 || r.types.length > 2) badTypes.push(id);
    if (!r || !r.genus) badGenus.push(id);
  }
  if (badTypes.length) throw new Error(`타입이 1~2개가 아닌 종: ${badTypes.slice(0, 20).join(', ')}`);
  if (badGenus.length) throw new Error(`한글 분류가 없는 종: ${badGenus.slice(0, 20).join(', ')}`);

  const speciesRows = [...Array(MAX_SPECIES).keys()].map((i) => {
    const id = i + 1;
    const r = species.get(id)!;
    const ts = r.types.map((t) => typeIndex.get(t)!).join(',');
    return `  ${id}: [[${ts}],${JSON.stringify(r.genus)},${r.heightM},${r.weightKg}],`;
  });

  const rows = moves.map(
    (m) =>
      `  [${m.id},${JSON.stringify(ko(m))},${JSON.stringify(en(m))},` +
      `${typeIndex.get(m.type!.name)},${m.power ?? 0},${m.accuracy ?? 0},${m.pp ?? 0},` +
      `${dcIndex.get(m.movedamageclass!.name)},` +
      `${ailIndex.get(metaOf(m)?.movemetaailment?.name ?? 'none') ?? 0},${ailmentChance(m)},` +
      `${catIndex.get(metaOf(m)?.movemetacategory?.name ?? 'none') ?? 0},` +
      `${m.priority ?? 0},${targetIndex.get(m.movetarget?.name ?? 'none') ?? 0},` +
      `${metaOf(m)?.drain ?? 0},${metaOf(m)?.healing ?? 0},${metaOf(m)?.crit_rate ?? 0},` +
      `${metaOf(m)?.flinch_chance ?? 0},${metaOf(m)?.stat_chance ?? 0},` +
      `${metaOf(m)?.min_hits ?? 0},${metaOf(m)?.max_hits ?? 0},` +
      `${JSON.stringify(m.movemetastatchanges.map((c) => [statIndex.get(c.stat.name), c.change]))},` +
      `${machineIds.has(m.id) ? 1 : 0},${flagBits(m)},${m.move_effect_id ?? 0}],`,
  );

  // Level-up learnsets as "level.move" pairs joined by commas — a third the
  // size of the JSON, and read once per species.
  const levelRows = [...levelUp.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, rows]) => `  ${id}: '${rows.map(([lv, mv]) => `${lv}.${mv}`).join(',')}',`);

  const learnsetRows = Object.entries(learnset).map(([id, b64]) => `  ${id}: '${b64}',`);

  /** The move's attributes as a bitmask over FLAGS. */
  function flagBits(m: MoveRow): number {
    let b = 0;
    for (const a of m.moveattributemaps) {
      const i = FLAGS.indexOf(a.moveattribute.name as (typeof FLAGS)[number]);
      if (i < 0) throw new Error(`모르는 기술 속성: ${a.moveattribute.name} (${m.name})`);
      b |= 1 << i;
    }
    return b;
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const out = path.join(here, '..', 'server', 'moves.ts');

  const body = `// GENERATED by scripts/gen-moves.ts — do not edit by hand.
// Source: PokeAPI (https://pokeapi.co). Every move learnable from a machine in
// any version group, and every move in each species' newest level-up learnset.
// TM icons are fetched at runtime from sprites/items/tm-{type}.png and are
// never bundled.

/** The 18 elemental types. Index order is what LEARNSET rows encode. */
export const TYPES = ${JSON.stringify(TYPES)} as const;
export type MoveType = (typeof TYPES)[number];

export const DAMAGE_CLASSES = ${JSON.stringify(DAMAGE_CLASSES)} as const;
export type DamageClass = (typeof DAMAGE_CLASSES)[number];

/**
 * Everything a move can inflict, straight from PokeAPI — deliberately NOT
 * collapsed into the few the battle models. server/fight.ts decides what each
 * one is worth, so re-tuning that never needs a regeneration. Index 0 is
 * 'none', so an absent column reads as "does nothing".
 */
export const AILMENTS = ${JSON.stringify(AILMENTS)} as const;
export type Ailment = (typeof AILMENTS)[number];

/** PokeAPI's own grouping of what a move is for. */
export const CATEGORIES = ${JSON.stringify(CATEGORIES)} as const;
export type MoveCategory = (typeof CATEGORIES)[number];

/** Who a move lands on, in PokeAPI's own words. */
export const TARGETS = ${JSON.stringify(TARGETS)} as const;
export type MoveTarget = (typeof TARGETS)[number];

/** The stats a stage change can touch. */
export const STAT_NAMES = ${JSON.stringify(STATS)} as const;
export type StatName = (typeof STAT_NAMES)[number];

/** Korean type names, for TM labels. */
export const TYPE_KO: Record<MoveType, string> = ${JSON.stringify(
    Object.fromEntries(TYPES.map((t) => [t, typeKo[t] ?? t])),
    null,
    2,
  )};

export type MoveInfo = {
  /** PokeAPI move.id. This — never an array index — is what gets persisted. */
  id: number;
  ko: string;
  en: string;
  type: MoveType;
  /** 0 for status moves, which have no power. */
  power: number;
  /** 0 where the move never misses. */
  accuracy: number;
  pp: number;
  damageClass: DamageClass;
  /** What it inflicts, or 'none'. The battle rules for each live in server/fight.ts. */
  ailment: Ailment;
  /** 0-100. Already normalised: a status move that always inflicts reads 100, not 0. */
  ailmentChance: number;
  /** 'net-good-stats', 'heal', 'field-effect' and so on. */
  category: MoveCategory;
  /** -7..+5. Higher goes first whatever the speeds. */
  priority: number;
  /** 'user', 'selected-pokemon', 'entire-field' and so on. */
  target: MoveTarget;
  /** Percent of the damage dealt: positive heals the user, negative is recoil. */
  drain: number;
  /** Percent of max HP a healing move restores. */
  healing: number;
  /** Critical-hit stage the move adds: 1 for Slash and friends. */
  critRate: number;
  /** Percent chance the target flinches. */
  flinchChance: number;
  /** Percent chance a damaging move's stat change lands. 0 on a status move, which always does. */
  statChance: number;
  /** [min, max] strikes for a multi-hit move, or null. */
  hits: [number, number] | null;
  /** Stage changes, in PokeAPI's order. Who they land on is the battle's call. */
  statChanges: { stat: StatName; change: number }[];
  /** Some species can learn it from a machine. Only these ever drop as a TM. */
  machine: boolean;
  /** PokeAPI's attributes — contact, punch, sound… — as a bitmask over MOVE_FLAGS. See \`hasFlag\`. */
  flags: number;
  /** PokeAPI's effect id: moves sharing one work alike. 0 where PokeAPI has none yet. */
  effect: number;
};

/** The attributes a move can carry, in PokeAPI order; bit i of \`MoveInfo.flags\` is MOVE_FLAGS[i]. */
export const MOVE_FLAGS = ${JSON.stringify(FLAGS)} as const;
export type MoveFlag = (typeof MOVE_FLAGS)[number];

/** Whether a move carries an attribute: \`hasFlag(m, 'contact')\`. */
export function hasFlag(m: MoveInfo, f: MoveFlag): boolean {
  return (m.flags & (1 << MOVE_FLAGS.indexOf(f))) !== 0;
}

/**
 * [id, ko, en, typeIndex, power, accuracy, pp, damageClassIndex,
 *  ailmentIndex, ailmentChance, categoryIndex,
 *  priority, targetIndex, drain, healing, critRate, flinchChance, statChance,
 *  minHits, maxHits, [[statIndex, change], ...], machine, flags, effect]
 */
type Row = [
  number, string, string, number, number, number, number, number,
  number, number, number,
  number, number, number, number, number, number, number,
  number, number, [number, number][], number, number, number,
];

const ROWS: Row[] = [
${rows.join('\n')}
];

/** Ordered by move id. A move's position here is its LEARNSET bit index. */
export const MOVES: MoveInfo[] = ROWS.map((r) => ({
  id: r[0],
  ko: r[1],
  en: r[2],
  type: TYPES[r[3]],
  power: r[4],
  accuracy: r[5],
  pp: r[6],
  damageClass: DAMAGE_CLASSES[r[7]],
  ailment: AILMENTS[r[8]],
  ailmentChance: r[9],
  category: CATEGORIES[r[10]],
  priority: r[11],
  target: TARGETS[r[12]],
  drain: r[13],
  healing: r[14],
  critRate: r[15],
  flinchChance: r[16],
  statChance: r[17],
  hits: r[18] > 0 && r[19] > 1 ? [r[18], r[19]] : null,
  statChanges: r[20].map(([i, change]) => ({ stat: STAT_NAMES[i], change })),
  machine: r[21] === 1,
  flags: r[22],
  effect: r[23],
}));

/** move.id -> index into MOVES. */
export const MOVE_INDEX: Record<number, number> = Object.fromEntries(
  MOVES.map((m, i) => [m.id, i]),
);

/**
 * speciesId -> base64 bitset over MOVES indices.
 *
 * ${moves.length} bits = ${Math.ceil(moves.length / 8)} bytes per species. A missing key means the species
 * learns nothing by machine — true for ${NO_MACHINE_MOVES.length} species (${NO_MACHINE_MOVES.join(', ')}),
 * exactly as in the games.
 */
export const LEARNSET: Record<number, string> = {
${learnsetRows.join('\n')}
};

/**
 * The type chart, as 324 digits: 0 = immune, 1 = half, 2 = normal, 3 = double.
 *
 * Row-major, attacker first: index = attackerIndex * 18 + defenderIndex, where
 * both indices are positions in TYPES.
 */
const CHART = '${typeChart}';

const FACTOR = [0, 0.5, 1, 2];

/**
 * How much a move of one type does to something of the given types.
 *
 * Dual types multiply, so 0.25x and 4x are both reachable, and a single
 * immunity zeroes the whole thing — Earthquake against a Fire/Flying Pokemon
 * does nothing at all.
 */
export function effectiveness(moveType: MoveType, foeTypes: readonly MoveType[]): number {
  const a = TYPES.indexOf(moveType);
  if (a < 0) return 1;
  let out = 1;
  for (const t of foeTypes) {
    const d = TYPES.indexOf(t);
    if (d < 0) continue;
    out *= FACTOR[Number(CHART[a * 18 + d])];
  }
  return out;
}

export type SpeciesInfo = {
  /** One or two of the eighteen types. */
  types: MoveType[];
  /** Korean genus, e.g. "임금포켓몬". */
  genus: string;
  /** Metres and kilograms. Upstream is decimetres and hectograms. */
  heightM: number;
  weightKg: number;
};

/** [typeIndices, genus, heightM, weightKg] */
type SpeciesRow = [number[], string, number, number];

const SPECIES_ROWS: Record<number, SpeciesRow> = {
${speciesRows.join('\n')}
};

/** speciesId -> its types, genus and size. Every id 1..${MAX_SPECIES} is present. */
export const SPECIES: Record<number, SpeciesInfo> = Object.fromEntries(
  Object.entries(SPECIES_ROWS).map(([id, r]) => [
    Number(id),
    { types: r[0].map((i) => TYPES[i]), genus: r[1], heightM: r[2], weightKg: r[3] },
  ]),
);

export function speciesInfo(id: number): SpeciesInfo | null {
  return SPECIES[id] ?? null;
}

/** Decoded bitsets, kept because canLearn runs once per TM per render. */
const decoded = new Map<number, Uint8Array>();

function bits(speciesId: number): Uint8Array | null {
  const cached = decoded.get(speciesId);
  if (cached) return cached;
  const b64 = LEARNSET[speciesId];
  if (!b64) return null;
  const buf = new Uint8Array(Buffer.from(b64, 'base64'));
  decoded.set(speciesId, buf);
  return buf;
}

export function moveById(id: number): MoveInfo | null {
  const i = MOVE_INDEX[id];
  return i === undefined ? null : MOVES[i];
}

/** Can this species learn this move from a machine, in any generation? */
export function canLearn(speciesId: number, moveId: number): boolean {
  const i = MOVE_INDEX[moveId];
  if (i === undefined) return false;
  const b = bits(speciesId);
  if (!b) return false;
  return (b[i >> 3] & (1 << (i & 7))) !== 0;
}

/** Every machine-learnable move id for a species, in move-id order. */
export function learnableMoves(speciesId: number): number[] {
  const b = bits(speciesId);
  if (!b) return [];
  const out: number[] = [];
  for (let i = 0; i < MOVES.length; i++) {
    if (b[i >> 3] & (1 << (i & 7))) out.push(MOVES[i].id);
  }
  return out;
}

/**
 * speciesId -> its level-up learnset, as "level.moveId" pairs in level order.
 *
 * From ONE version group per species, the newest mainline one that has it —
 * see scripts/gen-moves.ts. Level 0 is "on evolution".
 */
const LEVELUP: Record<number, string> = {
${levelRows.join('\n')}
};

const levelDecoded = new Map<number, [number, number][]>();

/** A species' level-up moves, \`[level, moveId]\` in level order. Level 0 is learned on evolving into it. */
export function levelUpMoves(speciesId: number): [number, number][] {
  const hit = levelDecoded.get(speciesId);
  if (hit) return hit;
  const raw = LEVELUP[speciesId];
  const out: [number, number][] = raw
    ? raw.split(',').map((p) => {
        const [lv, mv] = p.split('.');
        return [Number(lv), Number(mv)];
      })
    : [];
  levelDecoded.set(speciesId, out);
  return out;
}

/** Whether a species learns this move by levelling up, at any level. */
export function learnsByLevel(speciesId: number, moveId: number): boolean {
  return levelUpMoves(speciesId).some(([, m]) => m === moveId);
}
`;

  await fs.writeFile(out, body, 'utf8');

  const counts = Object.values(learnset).length;
  const totalPairs = [...learnsets.values()].reduce((a, s) => a + s.size, 0);
  console.log('→ server/moves.ts');
  console.log(`   기술 ${moves.length}개 · 학습 가능한 종 ${counts}/${MAX_SPECIES}`);
  console.log(`   (종,기술) 쌍 ${totalPairs.toLocaleString()} · 종당 평균 ${Math.round(totalPairs / counts)}개`);
  console.log(`   기술머신을 못 배우는 종 ${empty.length}개: ${empty.join(', ')}`);
  console.log(`   종 정보 ${species.size}종 — 타입·한글 분류·키·무게`);
  const kb = Math.round(Buffer.byteLength(body) / 1024);
  console.log(`   파일 크기 ${kb}KB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
