/**
 * Generator: builds src/journey.ts — the places the pet travels through.
 *
 * Run: npm run gen:journey
 *
 * ## Where the names come from, and why it is two sources
 *
 * PokeAPI carries every region and location, and it has KOREAN names for the
 * regions — all ten of them. For locations it does not: of 811 named places
 * (routes excluded) only 213 have a Korean name, and they are all in Hoenn,
 * Kalos and Alola. Kanto, Johto, Sinnoh, Unova, Galar, Hisui and Paldea have
 * none at all.
 *
 * So those are written by hand here, the same way server/trainer.ts writes
 * trainer names by hand for the same reason. Every one was checked against a
 * source before being added, and that mattered: the first draft had New Bark
 * Town as 무궁마을, which is Cherrygrove — New Bark is 연두마을. A Korean
 * Wikipedia lookup during research also confidently mislabelled 보라타운 as
 * Viridian City when it is Lavender Town.
 *
 * **A place with no verified Korean name is left out.** It is better for the
 * journey to be short than for it to print a wrong name, and worse still an
 * English slug — `celadon-city` on a Korean caption is the failure this whole
 * arrangement exists to avoid. The regions still missing are listed in TODO
 * below so the next person knows exactly what is left rather than rediscovering
 * it.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENDPOINT = 'https://graphql.pokeapi.co/v1beta2';

/**
 * Travel order — the order the games came out in, which is also the order a
 * player would have walked them.
 *
 * `orre` is deliberately absent: it is a spin-off region and PokeAPI has no
 * Korean name for it, so it would print a slug.
 */
const REGION_ORDER = [
  'kanto', 'johto', 'hoenn', 'sinnoh', 'unova',
  'kalos', 'alola', 'galar', 'hisui', 'paldea',
] as const;

/**
 * Regions with no Korean place names anywhere yet.
 *
 * They are still fetched and still ordered above, so adding names below is all
 * it takes to bring one into the journey. Nothing else has to change.
 *
 * TODO: unova, galar, hisui, paldea — and the rest of sinnoh, which is only
 * partly filled in. Each needs its names checked against a source, one region
 * at a time, exactly as the three below were.
 */

/**
 * Korean names, checked by hand.
 *
 * Keyed by PokeAPI's own slug so the mapping is unambiguous — the slug is what
 * the fetch returns, and a typo here simply fails to match and drops the place
 * rather than mislabelling it.
 */
const HAND: Record<string, [string, string][]> = {
  /**
   * Kanto, in the order the games walk it — Pallet out to the Plateau.
   *
   * The order has to be written down because PokeAPI's ids are alphabetical for
   * Gen 1 (celadon, cerulean, cinnabar…), so leaning on them would open the
   * journey in Celadon. Newer regions ARE stored in game order upstream, which
   * is why Kalos needs none of this and starts correctly in Vaniville.
   */
  kanto: [
    ['pallet-town', '태초마을'],
    ['viridian-city', '상록시티'],
    ['viridian-forest', '상록숲'],
    ['pewter-city', '회색시티'],
    ['mt-moon', '달맞이산'],
    ['cerulean-city', '블루시티'],
    ['vermilion-city', '갈색시티'],
    ['digletts-cave', '디그다굴'],
    ['rock-tunnel', '바위굴'],
    ['lavender-town', '보라타운'],
    ['pokemon-tower', '포켓몬타워'],
    ['celadon-city', '무지개시티'],
    ['kanto-power-plant', '무인발전소'],
    ['saffron-city', '노랑시티'],
    ['fuchsia-city', '연분홍시티'],
    ['kanto-safari-zone', '사파리존'],
    ['cinnabar-island', '홍련섬'],
    ['pokemon-mansion', '포켓몬저택'],
    ['seafoam-islands', '쌍둥이섬'],
    ['indigo-plateau', '석영고원'],
  ],
  johto: [
    ['new-bark-town', '연두마을'],
    ['cherrygrove-city', '무궁시티'],
    ['violet-city', '도라지시티'],
    ['sprout-tower', '방울탑'],
    ['ruins-of-alph', '알프의유적'],
    ['ilex-forest', '뭉게숲'],
    ['azalea-town', '고동마을'],
    ['dark-cave', '어둠의동굴'],
    ['goldenrod-city', '금빛시티'],
    ['national-park', '국립공원'],
    ['ecruteak-city', '인주시티'],
    ['burned-tower', '타버린탑'],
    ['olivine-city', '담청시티'],
    ['cianwood-city', '초옥시티'],
    ['mahogany-town', '황토마을'],
    ['lake-of-rage', '분노의호수'],
    ['ice-path', '얼음길'],
    ['blackthorn-city', '검은먹시티'],
    ['dragons-den', '용의굴'],
    ['whirl-islands', '소용돌이섬'],
    ['mt-silver', '은빛산'],
  ],
  /** Only what a source confirmed. The rest of Sinnoh is still TODO. */
  sinnoh: [
    ['twinleaf-town', '떡잎마을'],
    ['jubilife-city', '축복시티'],
    ['oreburgh-city', '무쇠시티'],
    ['floaroma-town', '꽃향기마을'],
    ['eterna-city', '영원시티'],
    ['canalave-city', '운하시티'],
  ],
};

/** Flattened, for the lookup. The arrays above are the order; this is the map. */
const KO: Record<string, string> = Object.fromEntries(
  Object.values(HAND).flat(),
);

/**
 * Places PokeAPI lists that are not places.
 *
 * Bookkeeping rows for roaming encounters, shop interiors and the Pokewalker.
 * They have slugs like anything else, so they have to be named to be excluded.
 */
const NOT_A_PLACE = /^(roaming-|unknown-)|pokemart|pokecenter|pokewalker|-gate$|altering-cave/;

/**
 * Hoenn ships a location whose Korean name is literally "???".
 *
 * It is the mystery zone the games use for out-of-bounds encounters, and it has
 * a real localised name, so nothing above catches it — the name IS three
 * question marks. Left in, the caption reads "???를 지나는 중", which is the
 * same failure as printing a slug: a place the player cannot be.
 */
const NOT_A_NAME = /^\?+$/;

/**
 * Which sheet a place is walked on.
 *
 * Order matters — the first pattern that matches wins. That is the whole
 * design, and most of the entries below are here because of an order bug:
 * `ice-path` has to meet the ice rule before `path`, `frost-cavern` has to meet
 * it before `cave`, and `viridian-forest` has to meet `forest` before anything
 * else claims it. Everything unmatched is a plain field, the one sheet that
 * suits anywhere.
 *
 * This used to be five rules and it put 62 places — every cave, every mountain,
 * every ruin and every tower — on `stonepath`, which is a lawn-edged cobble
 * road. There are ten sheets now; see src/terrain.ts for why not more.
 */
const TERRAIN: [RegExp, string][] = [
  // Ice first, or 얼음길 matches `길` and becomes a road. There is no white
  // tileset in any CC0 pack that fits, so these walk on cave rock — which is
  // not a fallback: 얼음길 and 프로스트케이브 are both caves in the games. The
  // SKY table below is what makes them read as ICE caves.
  [/ice|snow|frost|glacier|얼음|프로스트|빙산|눈꽃/, 'cave'],
  [/forest|woods|jungle|나무|숲|밀림/, 'forest'],
  [/desert|dune|사막|모래/, 'desert'],
  [/cave|cavern|tunnel|grotto|굴$|동굴|땅굴|석실/, 'cave'],
  [/mt-|mount|volcano|plateau|peak|canyon|산$|산길|고원|화산|봉$/, 'mountain'],
  [/ruins|tower|mansion|temple|chamber|shrine|유적|탑$|저택|신전|사당|무덤|묘/, 'ruins'],
  [/sea|island|beach|shore|bay|ocean|reef|섬$|바다|해변|해안|비치|물가/, 'seaside'],
  [/lake|river|falls|water|marsh|호수|호숫|폭포|늪/, 'lakeside'],
  [/meadow|garden|park|flower|공원|꽃|화원|정원/, 'flowers'],
  [/-city$|-town$|시티|마을|타운|도시/, 'town'],
  [/path|road|route|길$|가도|로드/, 'stonepath'],
];

/**
 * Which backdrop hangs at the horizon behind the walk.
 *
 * A SECOND, independent classification, and it is independent on purpose. The
 * terrain table above is capped by what CC0 pixel art exists — there is no
 * desert sheet and no snow sheet, so 사막 and 얼음길 fall back to field and
 * stonepath. The backdrops are Game Freak's Gen-5 battle art, fetched at
 * runtime and never committed (server/sprites.ts), so that shelf has a desert,
 * an ice cave and a volcano already paid for.
 *
 * Splitting the axes means a place gets the best answer each layer can give
 * rather than the worse of the two. 사막 walks on field and stands in front of
 * a desert; 얼음길 walks on cobble in front of an ice cave.
 *
 * Every value must be one of server/biome.ts's BG_SLUGS — it is interpolated
 * into a URL and a cache filename. A test holds that.
 */
const SKY: [RegExp, string][] = [
  [/ice|snow|frost|glacier|얼음|프로스트|빙산|눈꽃/, 'icecave'],
  [/volcano|magma|화산|용암/, 'volcanocave'],
  [/desert|dune|사막|모래/, 'desert'],
  [/forest|woods|jungle|나무|숲|밀림/, 'forest'],
  [/power-plant|발전소|공장/, 'thunderplains'],
  [/cave|cavern|tunnel|grotto|굴$|동굴|땅굴|석실/, 'dampcave'],
  [/mt-|mount|plateau|peak|canyon|산$|산길|고원|봉$/, 'mountain'],
  [/ruins|tower|mansion|temple|chamber|shrine|유적|탑$|저택|신전|사당|무덤|묘/, 'earthycave'],
  [/beach|shore|비치|해변|해안|물가/, 'beachshore'],
  [/sea|island|ocean|reef|섬$|바다/, 'beach'],
  [/lake|river|falls|water|marsh|호수|호숫|폭포|늪/, 'river'],
  [/meadow|garden|park|flower|공원|꽃|화원|정원/, 'meadow'],
  [/-city$|-town$|시티|마을|타운|도시/, 'city'],
];

/** Every slug SKY can produce. Emitted as a union so the renderer is typed. */
const SKY_IDS = [...new Set(SKY.map(([, id]) => id))].sort();

function matchFor(table: [RegExp, string][], slug: string, ko: string): string | null {
  for (const [re, id] of table) {
    if (re.test(slug) || re.test(ko)) return id;
  }
  return null;
}

function terrainFor(slug: string, ko: string): string {
  return matchFor(TERRAIN, slug, ko) ?? 'field';
}

/**
 * Null for anywhere with no obvious backdrop — a plain route, a laboratory.
 *
 * Null is not a failure path: it means the scene keeps the flat sky colour it
 * has always had, which is what an ordinary field should look like anyway.
 */
function skyFor(slug: string, ko: string): string | null {
  return matchFor(SKY, slug, ko);
}

type Loc = { name: string; region: { name: string } | null; locationnames: { name: string }[] };
type Reg = { name: string; regionnames: { name: string }[] };

async function main() {
  process.stdout.write('PokeAPI에서 지방·지명 가져오는 중... ');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `{
        region(order_by: { id: asc }) {
          name
          regionnames(where: { language: { name: { _eq: "ko" } } }) { name }
        }
        location(order_by: { id: asc }) {
          name
          region { name }
          locationnames(where: { language: { name: { _eq: "ko" } } }) { name }
        }
      }`,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const json = (await res.json()) as { data: { region: Reg[]; location: Loc[] }; errors?: unknown };
  if (json.errors) throw new Error(JSON.stringify(json.errors));

  const regionKo = new Map<string, string>();
  for (const r of json.data.region) {
    const ko = r.regionnames[0]?.name;
    if (ko) regionKo.set(r.name, ko);
  }
  for (const r of REGION_ORDER) {
    if (!regionKo.has(r)) throw new Error(`지방 한글명이 없습니다: ${r}`);
  }
  console.log(`지방 ${regionKo.size}개 · 지명 ${json.data.location.length}개`);

  /** Numbered routes are skipped: "1번도로" fifty times is not a journey. */
  const isRoute = (n: string) => /route-\d+$/.test(n);

  const stops: { ko: string; region: string; terrain: string; sky: string | null }[] = [];
  const dropped: Record<string, number> = {};
  /**
   * Alola splits one place into several sub-areas that share a Korean name, so
   * PokeAPI hands back 하우올리시티 three times and 텐캐럿힐 twice. Walked
   * straight through, the caption says the same place for two hours, moves on,
   * and says it again — which reads as a stuck app, not a journey.
   *
   * Keyed by region as well as name because two regions really can share one:
   * 사파리존 is in both Kanto and Hoenn, and 챔피언로드 is in most of them.
   */
  const seen = new Set<string>();

  for (const region of REGION_ORDER) {
    const all = json.data.location.filter((l) => l.region?.name === region);
    // A hand-written region walks in the order it was written; a machine one
    // walks in PokeAPI's, which for everything after Gen 3 is already the order
    // the game visits them in.
    const order = HAND[region];
    const here = order
      ? (order
          .map(([slug]) => all.find((l) => l.name === slug))
          .filter((l): l is Loc => !!l))
      : all;
    let kept = 0;
    for (const l of here) {
      if (isRoute(l.name) || NOT_A_PLACE.test(l.name)) continue;
      // Hand-checked name first: PokeAPI's own is authoritative where it exists,
      // but an override is there because someone verified it.
      const ko = KO[l.name] ?? l.locationnames[0]?.name;
      if (!ko || NOT_A_NAME.test(ko)) {
        dropped[region] = (dropped[region] ?? 0) + 1;
        continue;
      }
      const key = `${region}/${ko}`;
      if (seen.has(key)) continue;
      seen.add(key);
      stops.push({
        ko,
        region: regionKo.get(region)!,
        terrain: terrainFor(l.name, ko),
        sky: skyFor(l.name, ko),
      });
      kept++;
    }
    if (order) dropped[region] = all.filter((l) => !isRoute(l.name) && !NOT_A_PLACE.test(l.name)).length - kept;
    const miss = dropped[region] ?? 0;
    console.log(`   ${regionKo.get(region)!.padEnd(5)} ${String(kept).padStart(3)}곳` +
      (miss ? `  (한글명 없어 제외 ${miss})` : ''));
  }

  if (!stops.length) throw new Error('여정에 넣을 지명이 하나도 없습니다');

  const byTerrain: Record<string, number> = {};
  const bySky: Record<string, number> = {};
  for (const s of stops) {
    byTerrain[s.terrain] = (byTerrain[s.terrain] ?? 0) + 1;
    bySky[s.sky ?? '(없음)'] = (bySky[s.sky ?? '(없음)'] ?? 0) + 1;
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const out = path.join(here, '..', 'src', 'journey.ts');

  const body = `// GENERATED by scripts/gen-journey.ts — do not edit by hand.
// Source: PokeAPI (https://pokeapi.co) for regions and for Hoenn/Kalos/Alola
// place names; the rest are hand-checked in the generator. See that file.

import type { TerrainId } from './terrain.ts';

/**
 * Every backdrop the journey can ask for at the horizon.
 *
 * A subset of server/biome.ts's BG_SLUGS, which is the authority on what
 * actually exists upstream. Declared here rather than imported because this
 * file is renderer-side and that one is not — a test keeps the two in step.
 */
export type SkyId = ${SKY_IDS.map((id) => `'${id}'`).join(' | ')};

/**
 * One place on the journey, and the two independent things it looks like.
 *
 * \`terrain\` is which of the ten sheets gets painted underfoot. It is NOT what
 * the place is — a town and a stone road walk on the same cobble, and the
 * sheets have to cover ${stops.length} places between them.
 *
 * \`sky\` is the Gen-5 backdrop hung at the horizon, or null for nowhere in
 * particular. It is classified separately because the two layers have different
 * limits: sheets are capped by what CC0 art exists, backdrops are not, so a
 * desert can have a sky without having a floor.
 */
export type Stop = { ko: string; region: string; terrain: TerrainId; sky: SkyId | null };

export const STOPS: Stop[] = ${JSON.stringify(stops, null, 1)};

/**
 * Encounters spent at one stop before moving on.
 *
 * Hunting settles every five minutes, so this is about two hours — the same
 * number server/trainer.ts uses for "one encounter in twenty-five". At ${stops.length}
 * stops the whole journey runs about ${Math.round((stops.length * 25) / 12 / 24)} days of
 * uptime, then starts again at ${stops[0].ko}.
 */
export const LEG_LENGTH = 25;

/**
 * Where the pet is, from how much hunting has happened.
 *
 * Derived, never stored — \`hunt.count\` only counts up, so this needs no schema
 * bump and cannot drift. Total by construction: a missing or nonsense count
 * reads as "just set out" rather than indexing off the end.
 */
export function journeyFor(huntCount: number): Stop {
  const n = Number.isFinite(huntCount) ? Math.max(0, Math.floor(huntCount)) : 0;
  return STOPS[Math.floor(n / LEG_LENGTH) % STOPS.length];
}
`;

  await fs.writeFile(out, body, 'utf8');
  console.log(`→ src/journey.ts`);
  console.log(`   ${stops.length}곳 · 한 바퀴 약 ${Math.round((stops.length * 25) / 12 / 24)}일`);
  const tally = (t: Record<string, number>) =>
    Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ');
  console.log(`   지형 분포: ${tally(byTerrain)}`);
  console.log(`   배경 분포: ${tally(bySky)}`);
  const total = Object.values(dropped).reduce((a, b) => a + b, 0);
  if (total) console.log(`   한글명이 없어 뺀 곳: ${total} (생성기의 KO 표를 채우면 들어옵니다)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
