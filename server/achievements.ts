import { lifetimeOf, type GameState } from './game.ts';
import { generationOf, rarityOfSpecies } from './dex.ts';
import { LEGENDS } from './legenddata.ts';
import type { ItemId } from './shop.ts';

/**
 * Achievements.
 *
 * ── The standing rule ─────────────────────────────────────────────────────
 * WHEN A SYSTEM IS ADDED, CHANGED OR REMOVED, THIS TABLE CHANGES WITH IT.
 *
 * An achievement board that lags the systems it measures starts lying the
 * moment a feature lands: the trainer roster grew from eight classes to twenty
 * in the change before this file existed, and a board written against eight
 * would have been wrong on arrival. So the checklist for any new feature is —
 * did it create a durable counter? Then either it earns a row here, or the
 * reason it does not is written down.
 *
 * **An id is a permanent key; a category is presentation.** Rows may be
 * regrouped freely, and two of them have been: `raise-shiny` and `raise-fusion`
 * now sit under 희귀 while keeping the ids they were unlocked with. Renaming an
 * id instead would silently un-achieve it for everyone who has it, because
 * `state.achievements` is keyed by exactly that string.
 *
 * Changing a threshold never revokes an unlock either — an id already in the
 * map is skipped. Someone who cleared "50 wins" keeps it if the bar later moves
 * to 60. That is intended: taking a finished thing back is worse than a board
 * that is slightly generous to people who were here early.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Two rules the rewards obey, both inherited rather than invented:
 *
 * 1. **Money goes to the wallet, never to progress.** `awardTokens` is outside
 *    `lifetimeOf`, so no amount of achieving hatches anything. Paying into
 *    `bonusTokens` instead would walk straight around `huntCap` — the hole
 *    `trainer.ts` names and refuses for exactly the same reason.
 * 2. **Items are free to give.** `hunt.ts` already grants a trainer prize into
 *    `inventory` without a purchase; an item grants no progress, so it cannot
 *    move the ceiling.
 *
 * `settleAchievements` is pure and idempotent, which it has to be: in
 * `electron:dev` two processes run this same pipeline against one state.json,
 * and safety rests on both computing identical bytes. Unlocks are decided by
 * comparing a threshold against the CURRENT state rather than by watching a
 * delta, so running it twice is a no-op rather than a double payout. Repeating
 * rows work the same way — the number of tiers earned is `floor(have / step)`,
 * read fresh each time, never incremented.
 */

export type AwardCat =
  | 'growth'
  | 'travel'
  | 'dex'
  | 'rare'
  | 'trainer'
  | 'battle'
  | 'collect'
  | 'raise'
  | 'shop'
  | 'legend';

/** Category order is board order — the chips and the shelves both read this. */
export const CAT_KO: Record<AwardCat, string> = {
  growth: '성장',
  travel: '여행',
  dex: '도감',
  rare: '희귀',
  trainer: '트레이너',
  battle: '배틀',
  collect: '수집',
  raise: '육성',
  shop: '상점',
  legend: '전설',
};

export type Achievement = {
  id: string;
  cat: AwardCat;
  ko: string;
  desc: string;
  /**
   * Where the player is, and where the bar is.
   *
   * Both numbers, because the screen draws a gauge from them and the unlock
   * test is simply `have >= need`. A boolean condition is expressed as a metric
   * out of 1 — see the shiny and fusion rows.
   *
   * For a repeating row, `need` is the STEP; the next target is worked out from
   * how many tiers have already been paid.
   */
  metric: (s: GameState) => { have: number; need: number };
  /**
   * Reward money, in hatch thresholds.
   *
   * The same unit shop prices use (`priceOf`), which is what makes a reward
   * feel the same to someone earning 200M a day and someone earning 5M.
   */
  money: number;
  /** An item handed over as well. Passives live here; they are unbuyable. */
  item?: ItemId;
  /**
   * A legendary signature item handed over, by PokeAPI slug.
   *
   * Separate from `item` because these are not `ItemId`s — they live in
   * `legendItems`, keyed by slug, for the same reason mega stones live in
   * `stones` keyed by form id: thirty-eight new literals in a hand-copied union
   * is a trap, and a collection to be checked is not a shelf to be bought from.
   */
  legendItem?: string;
  /**
   * Pays again every `metric().need` units, for ever.
   *
   * Deliberately uncapped. The money is wallet-only so it cannot touch growth,
   * and every step is tied to real progress — encounters, graduations, species
   * registered — so an idle machine cannot farm one. They are all worth about
   * 2x, well under the top rung of the ladder they sit beside, because a
   * repeating reward that beat a finite one would make the ladder pointless.
   */
  repeat?: true;
};

/** Registered species out of this many; the dex ladder's top rung. */
const DEX_TOTAL = 1024;

/** Generations in the national dex. `generationOf` returns 1..9. */
const GENERATIONS = 9;

/**
 * Where each region starts, in encounters.
 *
 * `journeyFor` is `STOPS[floor(huntCount / LEG_LENGTH) % STOPS.length]`, so a
 * region's first stop index times `LEG_LENGTH` is the encounter it is first
 * reached at. Read off the generated table rather than guessed — and REREAD
 * whenever `npm run gen:journey` changes the route, because these are the
 * numbers the 여행 rows print as goals and a stale one claims you arrived
 * somewhere you have not.
 *
 * The route was 240 stops over six regions on a 25-encounter leg, and is now
 * 728 over ten on a 15-encounter one. Every number below moved, and four
 * regions that had no row at all now have one.
 *
 * Raising these is safe in the one way that matters: `settleAchievements`
 * never revokes an id already in `state.achievements`, so nobody loses a
 * 도달 they already earned. Somebody still walking toward one has further to
 * go, which is simply true — the region really is further away now.
 */
const REGION_AT = {
  johto: 870,
  hoenn: 1455,
  sinnoh: 2505,
  unova: 3825,
  kalos: 4995,
  alola: 6075,
  galar: 7155,
  hisui: 8340,
  paldea: 9675,
  lap: 10920,
} as const;

const stoneKinds = (s: GameState) =>
  Object.values(s.stones ?? {}).filter((n) => (n ?? 0) > 0).length;
const shinyCount = (s: GameState) => s.dex.filter((d) => d.shiny).length;
const legendCount = (s: GameState) =>
  s.dex.filter((d) => rarityOfSpecies(d.speciesId) === 'legendary').length;
/** How many of the nine generations are represented at all. */
const genSpread = (s: GameState) => new Set(s.dex.map((d) => generationOf(d.speciesId))).size;
/** TM KINDS in the bag, as opposed to `tmsFound` which is a lifetime tally. */
const tmKinds = (s: GameState) => Object.keys(s.tms).length;
const one = (yes: boolean) => ({ have: yes ? 1 : 0, need: 1 });
/** Legendaries raised to graduation. The dex is still the only record. */
const legendsRaised = (s: GameState) =>
  s.dex.filter((d) => LEGENDS.some((l) => l.id === d.speciesId)).length;

export const ACHIEVEMENTS: Achievement[] = [
  // ── 성장 ── what the tokens actually bought, in hatch thresholds.
  {
    id: 'growth-1',
    cat: 'growth',
    ko: '첫 동료',
    desc: '알에서 첫 포켓몬이 태어났다.',
    metric: (s) => ({ have: s.dex.length + (s.active ? 1 : 0), need: 1 }),
    money: 0.5,
  },
  {
    id: 'growth-10',
    cat: 'growth',
    ko: '열 배',
    desc: '부화 임계값의 열 배를 벌었다.',
    metric: (s) => ({ have: lifetimeOf(s), need: s.hatchThreshold * 10 }),
    money: 1,
  },
  {
    id: 'growth-100',
    cat: 'growth',
    ko: '백 배',
    desc: '부화 임계값의 백 배를 벌었다.',
    metric: (s) => ({ have: lifetimeOf(s), need: s.hatchThreshold * 100 }),
    money: 3,
  },
  {
    id: 'growth-1000',
    cat: 'growth',
    ko: '천 배',
    desc: '부화 임계값의 천 배를 벌었다.',
    metric: (s) => ({ have: lifetimeOf(s), need: s.hatchThreshold * 1000 }),
    money: 12,
  },
  {
    id: 'growth-repeat',
    cat: 'growth',
    ko: '계속 자란다',
    desc: '부화 임계값의 250배를 벌 때마다.',
    metric: (s) => ({ have: lifetimeOf(s), need: s.hatchThreshold * 250 }),
    money: 2,
    repeat: true,
  },

  // ── 여행 ── huntCount, read as distance. The dynamax band rides here.
  {
    id: 'travel-johto',
    cat: 'travel',
    ko: '성도 도달',
    desc: '관동을 지나 성도에 들어섰다.',
    metric: (s) => ({ have: s.huntCount, need: REGION_AT.johto }),
    money: 1,
  },
  {
    id: 'travel-hoenn',
    cat: 'travel',
    ko: '호연 도달',
    desc: '성도를 지나 호연에 들어섰다.',
    metric: (s) => ({ have: s.huntCount, need: REGION_AT.hoenn }),
    money: 2,
    item: 'dynamax-band',
  },
  {
    id: 'travel-sinnoh',
    cat: 'travel',
    ko: '신오 도달',
    desc: '호연을 지나 신오에 들어섰다.',
    metric: (s) => ({ have: s.huntCount, need: REGION_AT.sinnoh }),
    money: 3,
  },
  {
    id: 'travel-unova',
    cat: 'travel',
    ko: '하나 도달',
    desc: '신오를 지나 하나에 들어섰다.',
    metric: (s) => ({ have: s.huntCount, need: REGION_AT.unova }),
    money: 4,
  },
  {
    id: 'travel-kalos',
    cat: 'travel',
    ko: '칼로스 도달',
    desc: '하나를 지나 칼로스에 들어섰다.',
    metric: (s) => ({ have: s.huntCount, need: REGION_AT.kalos }),
    money: 5,
  },
  {
    id: 'travel-alola',
    cat: 'travel',
    ko: '알로라 도달',
    desc: '칼로스를 지나 알로라에 들어섰다.',
    metric: (s) => ({ have: s.huntCount, need: REGION_AT.alola }),
    money: 6,
  },
  {
    id: 'travel-galar',
    cat: 'travel',
    ko: '가라르 도달',
    desc: '알로라를 지나 가라르에 들어섰다.',
    metric: (s) => ({ have: s.huntCount, need: REGION_AT.galar }),
    money: 8,
  },
  {
    id: 'travel-hisui',
    cat: 'travel',
    ko: '히스이 도달',
    desc: '가라르를 지나 히스이에 들어섰다.',
    metric: (s) => ({ have: s.huntCount, need: REGION_AT.hisui }),
    money: 10,
  },
  {
    id: 'travel-paldea',
    cat: 'travel',
    ko: '팔데아 도달',
    desc: '히스이를 지나 팔데아에 들어섰다. 열 지방의 마지막이다.',
    metric: (s) => ({ have: s.huntCount, need: REGION_AT.paldea }),
    money: 12,
  },
  {
    id: 'travel-lap',
    cat: 'travel',
    ko: '세계일주',
    desc: '728개 정거장을 한 바퀴 다 돌았다.',
    metric: (s) => ({ have: s.huntCount, need: REGION_AT.lap }),
    money: 15,
  },
  {
    id: 'travel-repeat',
    cat: 'travel',
    ko: '길 위에서',
    desc: '1,000번 조우할 때마다.',
    metric: (s) => ({ have: s.huntCount, need: 1000 }),
    money: 2,
    repeat: true,
  },

  // ── 도감 ──
  //
  // The shiny charm is the reward here, and at four rungs rather than one,
  // because it is consumed by the next hatch. In the games it is literally what
  // completing the Pokedex pays out, so this is where it belongs.
  {
    id: 'dex-10',
    cat: 'dex',
    ko: '도감 10종',
    desc: '열 종류를 도감에 등록했다.',
    metric: (s) => ({ have: s.dex.length, need: 10 }),
    money: 1,
  },
  {
    id: 'dex-50',
    cat: 'dex',
    ko: '도감 50종',
    desc: '쉰 종류를 도감에 등록했다.',
    metric: (s) => ({ have: s.dex.length, need: 50 }),
    money: 2,
    item: 'shiny-charm',
  },
  {
    id: 'dex-150',
    cat: 'dex',
    ko: '도감 150종',
    desc: '백쉰 종류를 도감에 등록했다.',
    metric: (s) => ({ have: s.dex.length, need: 150 }),
    money: 4,
    item: 'shiny-charm',
  },
  {
    id: 'dex-500',
    cat: 'dex',
    ko: '도감 500종',
    desc: '오백 종류를 도감에 등록했다.',
    metric: (s) => ({ have: s.dex.length, need: 500 }),
    money: 8,
    item: 'shiny-charm',
  },
  {
    id: 'dex-full',
    cat: 'dex',
    ko: '도감 완성',
    desc: '도감을 전부 채웠다.',
    metric: (s) => ({ have: s.dex.length, need: DEX_TOTAL }),
    money: 25,
    item: 'shiny-charm',
  },
  {
    id: 'dex-gen',
    cat: 'dex',
    ko: '아홉 세대',
    desc: '아홉 세대에서 한 종씩은 등록했다.',
    metric: (s) => ({ have: genSpread(s), need: GENERATIONS }),
    money: 6,
  },
  {
    id: 'dex-repeat',
    cat: 'dex',
    ko: '수집은 계속된다',
    desc: '도감에 25종을 채울 때마다.',
    metric: (s) => ({ have: s.dex.length, need: 25 }),
    money: 2,
    repeat: true,
  },

  // ── 희귀 ──
  //
  // `raise-shiny` and `raise-fusion` keep the ids they were introduced with;
  // see the header. They belong here by subject, and an id is not a subject.
  {
    id: 'legend-1',
    cat: 'rare',
    ko: '전설 등록',
    desc: '전설급 포켓몬을 도감에 등록했다.',
    metric: (s) => ({ have: legendCount(s), need: 1 }),
    money: 4,
  },
  {
    id: 'legend-10',
    cat: 'rare',
    ko: '전설 10종',
    desc: '전설급을 열 종류 등록했다.',
    metric: (s) => ({ have: legendCount(s), need: 10 }),
    money: 12,
  },
  {
    id: 'raise-shiny',
    cat: 'rare',
    ko: '이로치 등록',
    desc: '색이 다른 포켓몬을 도감에 등록했다.',
    metric: (s) => ({ have: shinyCount(s), need: 1 }),
    money: 5,
  },
  {
    id: 'shiny-3',
    cat: 'rare',
    ko: '이로치 3종',
    desc: '색이 다른 포켓몬을 세 종류 등록했다.',
    metric: (s) => ({ have: shinyCount(s), need: 3 }),
    money: 10,
  },
  {
    id: 'shiny-10',
    cat: 'rare',
    ko: '이로치 10종',
    desc: '색이 다른 포켓몬을 열 종류 등록했다.',
    metric: (s) => ({ have: shinyCount(s), need: 10 }),
    money: 20,
  },
  {
    id: 'raise-fusion',
    cat: 'rare',
    ko: '합체 등록',
    desc: '합체한 모습을 도감에 등록했다.',
    metric: (s) => one(s.dex.some((d) => d.formId !== undefined)),
    money: 4,
  },

  // ── 트레이너 ──
  //
  // These alone start at zero on an existing save. A win was only ever written
  // to the twenty-entry log, and the fight cannot be replayed because the
  // moveset it was fought with is not recorded. The screen says so.
  {
    id: 'trainer-1',
    cat: 'trainer',
    ko: '첫 승부',
    desc: '트레이너와의 승부에서 처음 이겼다.',
    metric: (s) => ({ have: s.trainerWins ?? 0, need: 1 }),
    money: 1,
  },
  {
    id: 'trainer-10',
    cat: 'trainer',
    ko: '10승',
    desc: '트레이너를 열 번 이겼다.',
    metric: (s) => ({ have: s.trainerWins ?? 0, need: 10 }),
    money: 2,
  },
  {
    id: 'trainer-50',
    cat: 'trainer',
    ko: '50승',
    desc: '트레이너를 쉰 번 이겼다.',
    metric: (s) => ({ have: s.trainerWins ?? 0, need: 50 }),
    money: 5,
  },
  {
    id: 'trainer-100',
    cat: 'trainer',
    ko: '100승',
    desc: '트레이너를 백 번 이겼다.',
    metric: (s) => ({ have: s.trainerWins ?? 0, need: 100 }),
    money: 10,
  },
  {
    id: 'trainer-repeat',
    cat: 'trainer',
    ko: '승부사',
    desc: '트레이너를 25번 이길 때마다.',
    metric: (s) => ({ have: s.trainerWins ?? 0, need: 25 }),
    money: 2,
    repeat: true,
  },

  // ── 체육관 ──
  //
  // Deliberately NOT a new category. `AwardCat` is presentation and the chip
  // row is already at ten, which docs/DESIGN.md names as a layout limit — and
  // a gym leader IS a trainer, which is also why a gym win increments
  // `trainerWins` in hunt.ts. These rows measure the badges rather than the
  // wins, because the badges are the thing the road is for.
  {
    id: 'badge-1',
    cat: 'trainer',
    ko: '첫 배지',
    desc: '체육관 관장에게 처음 이겼다.',
    metric: (s) => ({ have: s.badges?.length ?? 0, need: 1 }),
    money: 1,
  },
  {
    id: 'badge-4',
    cat: 'trainer',
    ko: '배지 4개',
    desc: '관동의 체육관을 절반 돌았다.',
    metric: (s) => ({ have: s.badges?.length ?? 0, need: 4 }),
    money: 3,
  },
  {
    id: 'badge-8',
    cat: 'trainer',
    ko: '관동 제패',
    desc: '관동의 배지 여덟 개를 전부 모았다.',
    metric: (s) => ({ have: s.badges?.length ?? 0, need: 8 }),
    money: 8,
  },
  {
    id: 'league-4',
    cat: 'trainer',
    ko: '사천왕 돌파',
    /**
     * Reads `leagueBest`, not a live run: most challenges end in a loss, and a
     * board that only noticed the wins would say nothing to the many people
     * who got to 목호 and fell.
     */
    desc: '한 번의 도전에서 사천왕 넷을 모두 꺾었다.',
    metric: (s) => ({ have: s.leagueBest ?? 0, need: 4 }),
    money: 10,
  },
  {
    id: 'league-champion',
    cat: 'trainer',
    ko: '명예의 전당',
    desc: '사천왕과 챔피언을 꺾고 명예의 전당에 올랐다.',
    metric: (s) => ({ have: s.leagueWins ?? 0, need: 1 }),
    money: 20,
    item: 'shiny-charm',
  },
  {
    id: 'league-repeat',
    cat: 'trainer',
    ko: '다시 도전',
    desc: '포켓몬리그를 제패할 때마다.',
    metric: (s) => ({ have: s.leagueWins ?? 0, need: 1 }),
    money: 5,
    repeat: true,
  },
  {
    id: 'gym-rematch',
    cat: 'trainer',
    ko: '도장깨기',
    /**
     * Not `badges`, which stops at eight and then measures nothing. A beaten
     * leader spars once per visit, so this grows by at most eight a lap and
     * every step needs a won fight — an idle machine with a bare companion
     * earns none of it.
     */
    desc: '관장을 10번 이길 때마다.',
    metric: (s) => ({ have: s.gymWins ?? 0, need: 10 }),
    money: 2,
    repeat: true,
  },

  // ── 배틀 ──
  //
  // What the companion can actually do in a fight. `moves` dies with the
  // companion and TM kinds go down when one is taught, so these are all things
  // that were TRUE at some moment — which is what an unlock records anyway.
  {
    id: 'battle-slots',
    cat: 'battle',
    ko: '기술 네 칸',
    desc: '기술 네 칸을 전부 채웠다.',
    metric: (s) => ({ have: s.active?.moves.length ?? 0, need: 4 }),
    money: 2,
  },
  {
    id: 'battle-tm-30',
    cat: 'battle',
    ko: '기술머신 30종',
    desc: '서로 다른 기술머신을 서른 종류 가졌다.',
    metric: (s) => ({ have: tmKinds(s), need: 30 }),
    money: 3,
  },
  {
    id: 'battle-tm-60',
    cat: 'battle',
    ko: '기술머신 60종',
    desc: '서로 다른 기술머신을 예순 종류 가졌다.',
    metric: (s) => ({ have: tmKinds(s), need: 60 }),
    money: 6,
  },

  // ── 수집 ──
  //
  // The key stone sits on the three-stone rung on purpose: it is worthless
  // without a mega stone to pair it with, so handing it over before any have
  // dropped would be handing over a blank.
  {
    id: 'stone-1',
    cat: 'collect',
    ko: '첫 메가스톤',
    desc: '야생에서 메가스톤을 처음 주웠다.',
    metric: (s) => ({ have: stoneKinds(s), need: 1 }),
    money: 1,
  },
  {
    id: 'stone-3',
    cat: 'collect',
    ko: '메가스톤 3종',
    desc: '서로 다른 메가스톤을 세 개 모았다.',
    metric: (s) => ({ have: stoneKinds(s), need: 3 }),
    money: 2,
    item: 'key-stone',
  },
  {
    id: 'stone-10',
    cat: 'collect',
    ko: '메가스톤 10종',
    desc: '서로 다른 메가스톤을 열 개 모았다.',
    metric: (s) => ({ have: stoneKinds(s), need: 10 }),
    money: 4,
  },
  {
    id: 'stone-30',
    cat: 'collect',
    ko: '메가스톤 30종',
    desc: '서로 다른 메가스톤을 서른 개 모았다.',
    metric: (s) => ({ have: stoneKinds(s), need: 30 }),
    money: 10,
  },
  {
    id: 'tm-1',
    cat: 'collect',
    ko: '첫 기술머신',
    desc: '사냥에서 기술머신을 처음 주웠다.',
    metric: (s) => ({ have: s.tmsFound ?? 0, need: 1 }),
    money: 0.5,
  },
  {
    id: 'tm-50',
    cat: 'collect',
    ko: '기술머신 50개',
    desc: '기술머신을 쉰 개 주웠다.',
    metric: (s) => ({ have: s.tmsFound ?? 0, need: 50 }),
    money: 3,
  },
  {
    id: 'tm-200',
    cat: 'collect',
    ko: '기술머신 200개',
    desc: '기술머신을 이백 개 주웠다.',
    metric: (s) => ({ have: s.tmsFound ?? 0, need: 200 }),
    money: 8,
  },
  {
    id: 'tm-repeat',
    cat: 'collect',
    ko: '주워 담는 사람',
    desc: '기술머신을 100개 주울 때마다.',
    metric: (s) => ({ have: s.tmsFound ?? 0, need: 100 }),
    money: 2,
    repeat: true,
  },

  // ── 육성 ──
  {
    id: 'raise-1',
    cat: 'raise',
    ko: '첫 졸업',
    desc: '한 마리를 도감으로 떠나보냈다.',
    metric: (s) => ({ have: s.retiredCount, need: 1 }),
    money: 1,
  },
  {
    id: 'raise-10',
    cat: 'raise',
    ko: '10마리 졸업',
    desc: '열 마리를 도감으로 떠나보냈다.',
    metric: (s) => ({ have: s.retiredCount, need: 10 }),
    money: 3,
  },
  {
    id: 'raise-50',
    cat: 'raise',
    ko: '50마리 졸업',
    desc: '쉰 마리를 도감으로 떠나보냈다.',
    metric: (s) => ({ have: s.retiredCount, need: 50 }),
    money: 8,
  },
  {
    id: 'raise-100',
    cat: 'raise',
    ko: '100마리 졸업',
    desc: '백 마리를 도감으로 떠나보냈다.',
    metric: (s) => ({ have: s.retiredCount, need: 100 }),
    money: 16,
  },
  {
    id: 'raise-nickname',
    cat: 'raise',
    ko: '이름을 지어줬다',
    desc: '별명을 붙인 채로 한 마리를 떠나보냈다.',
    metric: (s) => one(s.dex.some((d) => d.nickname !== undefined)),
    money: 2,
  },
  {
    id: 'raise-repeat',
    cat: 'raise',
    ko: '잘 가',
    desc: '열 마리를 떠나보낼 때마다.',
    metric: (s) => ({ have: s.retiredCount, need: 10 }),
    money: 2,
    repeat: true,
  },

  // ── 상점 ──
  //
  // `spentTokens` is the only trace shopping leaves — it cannot say WHAT was
  // bought — so these are all about the total, which is the honest reading.
  {
    id: 'shop-1',
    cat: 'shop',
    ko: '첫 구매',
    desc: '프렌들리숍에서 처음 물건을 샀다.',
    metric: (s) => one(s.spentTokens > 0),
    money: 0.5,
  },
  {
    id: 'shop-10',
    cat: 'shop',
    ko: '단골',
    desc: '부화 임계값의 열 배를 상점에서 썼다.',
    metric: (s) => ({ have: s.spentTokens, need: s.hatchThreshold * 10 }),
    money: 2,
  },
  {
    id: 'shop-100',
    cat: 'shop',
    ko: '큰손',
    desc: '부화 임계값의 백 배를 상점에서 썼다.',
    metric: (s) => ({ have: s.spentTokens, need: s.hatchThreshold * 100 }),
    money: 6,
  },
  /*
   * The two rungs above exist because the shelf got eight times dearer.
   *
   * 10x and 100x used to be the whole ladder, and at the old prices 100x was
   * five of everything in the shop. It is now roughly one legendary egg, which
   * makes it an early marker rather than a summit — so the ladder grows upward
   * instead of having its old rungs renumbered. Renumbering would strand the
   * `shop-10` already sitting unlocked in saves, and an unlock that points at
   * an id no longer in the table is a quiet loss of something earned.
   */
  {
    id: 'shop-500',
    cat: 'shop',
    ko: '단골 중의 단골',
    desc: '부화 임계값의 오백 배를 상점에서 썼다.',
    metric: (s) => ({ have: s.spentTokens, need: s.hatchThreshold * 500 }),
    money: 10,
  },
  {
    id: 'shop-repeat',
    cat: 'shop',
    ko: '오늘도 프렌들리숍',
    desc: '부화 임계값의 150배를 쓸 때마다.',
    metric: (s) => ({ have: s.spentTokens, need: s.hatchThreshold * 150 }),
    money: 3,
    repeat: true,
  },
  // ── 전설 ──
  //
  // Seven of these hand over a signature item. That is not decoration: those
  // gates have `source: 'award'`, so without the row the species behind them
  // is unreachable — the same failure the shop's award-only items already have
  // a test for, and this category gets the same one.
  {
    id: 'legend-first-meet',
    cat: 'legend',
    ko: '첫 전설 조우',
    /**
     * Reads the MEETING now, where it used to read a win.
     *
     * The row said 만났다 and measured `eggsWon || legendsRaised`, both of
     * which require beating one — so somebody who had stood in front of
     * 기라티나 and lost was told they had never met a legendary. `metLegends`
     * exists for the shrines and answers this honestly.
     *
     * Strictly more generous, so nobody's unlock is at risk: `migrate` floors
     * `metLegends` at exactly what the old condition could prove.
     */
    desc: '전설의 포켓몬을 처음 만났다. 이기지 못했어도 만난 것이다.',
    metric: (s) => one((s.metLegends?.length ?? 0) > 0),
    money: 5,
  },
  {
    id: 'legend-meet-5',
    cat: 'legend',
    ko: '전설 5종과 마주침',
    desc: '서로 다른 전설의 포켓몬 다섯을 만났다.',
    metric: (s) => ({ have: s.metLegends?.length ?? 0, need: 5 }),
    money: 6,
  },
  {
    id: 'legend-meet-15',
    cat: 'legend',
    ko: '전설 15종과 마주침',
    /**
     * Worth its own rung because meeting one opens its room — see
     * server/shrines.ts. This is the counter the journey grows on.
     */
    desc: '서로 다른 전설의 포켓몬 열다섯을 만났다. 만난 곳은 여정에 남는다.',
    metric: (s) => ({ have: s.metLegends?.length ?? 0, need: 15 }),
    money: 10,
  },
  {
    id: 'legend-raise-1',
    cat: 'legend',
    ko: '전설을 키웠다',
    desc: '전설의 포켓몬을 도감에 등록했다.',
    metric: (s) => ({ have: legendsRaised(s), need: 1 }),
    money: 8,
  },
  {
    id: 'legend-raise-5',
    cat: 'legend',
    ko: '전설 5종',
    desc: '전설의 포켓몬을 다섯 종류 등록했다.',
    metric: (s) => ({ have: legendsRaised(s), need: 5 }),
    money: 12,
    legendItem: 'griseous-orb',
  },
  {
    id: 'legend-raise-10',
    cat: 'legend',
    ko: '전설 10종',
    desc: '전설의 포켓몬을 열 종류 등록했다.',
    metric: (s) => ({ have: legendsRaised(s), need: 10 }),
    money: 16,
    legendItem: 'reveal-glass',
  },
  {
    id: 'legend-raise-20',
    cat: 'legend',
    ko: '전설 20종',
    desc: '전설의 포켓몬을 스무 종류 등록했다.',
    metric: (s) => ({ have: legendsRaised(s), need: 20 }),
    money: 24,
    legendItem: 'n-solarizer--merge',
  },
  {
    id: 'legend-wins-100',
    cat: 'legend',
    ko: '검을 얻을 자격',
    desc: '트레이너를 백 번 이기고 가라르 도감을 25종 채웠다.',
    metric: (s) => {
      const w = s.trainerWins ?? 0;
      const g = s.dex.filter((d) => generationOf(d.speciesId) === 8).length;
      return w / 100 <= g / 25 ? { have: w, need: 100 } : { have: g, need: 25 };
    },
    money: 10,
    legendItem: 'rusted-sword',
  },
  {
    id: 'legend-wins-100b',
    cat: 'legend',
    ko: '방패를 얻을 자격',
    desc: '트레이너를 백 번 이기고 가라르 도감을 25종 채웠다.',
    metric: (s) => {
      const w = s.trainerWins ?? 0;
      const g = s.dex.filter((d) => generationOf(d.speciesId) === 8).length;
      return w / 100 <= g / 25 ? { have: w, need: 100 } : { have: g, need: 25 };
    },
    money: 10,
    legendItem: 'rusted-shield',
  },
  {
    id: 'legend-kings',
    cat: 'legend',
    ko: '두 왕을 모시다',
    desc: '블리자포스와 레이스포스를 전부 도감에 등록했다.',
    metric: (s) => ({
      have: [896, 897].filter((id) => s.dex.some((d) => d.speciesId === id)).length,
      need: 2,
    }),
    money: 14,
    legendItem: 'reins-of-unity',
  },
  {
    id: 'legend-dex-550',
    cat: 'legend',
    ko: '테라파고스의 자격',
    desc: '도감 550종을 채우고 전설 18종을 등록했다.',
    metric: (s) => {
      const d = s.dex.length;
      const l = legendsRaised(s);
      return d / 550 <= l / 18 ? { have: d, need: 550 } : { have: l, need: 18 };
    },
    money: 20,
    legendItem: 'clear-amulet',
  },
  {
    id: 'legend-repeat',
    cat: 'legend',
    ko: '전설 수집가',
    desc: '전설의 포켓몬을 세 종류 등록할 때마다.',
    metric: (s) => ({ have: legendsRaised(s), need: 3 }),
    money: 4,
    repeat: true,
  },
];

/** The items only an achievement can hand over. `shop.ts` marks these unbuyable. */
export const AWARD_ONLY_ITEMS: ItemId[] = ['key-stone', 'dynamax-band', 'shiny-charm'];

/** How many times a repeating row has paid out, and the target after that. */
export function tiersOf(a: Achievement, s: GameState): { times: number; next: number } {
  const { have, need } = a.metric(s);
  const times = need > 0 ? Math.floor(have / need) : 0;
  return { times, next: (times + 1) * need };
}

/**
 * Unlock whatever the current state has earned, and pay for it.
 *
 * Pure. Returns the SAME object when nothing changed, so the caller can use
 * identity to decide whether the save is dirty.
 *
 * `now` is stamped on each unlock. A save that predates this feature unlocks its
 * whole backlog on the first tick with the same timestamp, which is honest — the
 * app genuinely does not know when any of it happened. (`migrate` cannot stamp 0
 * here the way it does for backfilled dex rows, because it has never seen these
 * ids before; there is nothing to distinguish a backlog from a fresh unlock at
 * the moment it is granted.)
 *
 * A repeating row pays for every tier it has passed but not been paid for, in
 * one go. Backlogs settle the same way an offline hunting backlog does.
 */
export function settleAchievements(state: GameState, now: number): GameState {
  const done = state.achievements ?? {};
  const paidFor = state.repeats ?? {};

  const achievements = { ...done };
  const repeats = { ...paidFor };
  const inventory = { ...state.inventory };
  const legendItems = { ...state.legendItems };
  let money = 0;
  let changed = false;

  for (const a of ACHIEVEMENTS) {
    if (a.repeat) {
      // Derived from `have`, never incremented — that is what keeps a second
      // pass (or a second process) from paying twice.
      const { times } = tiersOf(a, state);
      const paid = paidFor[a.id] ?? 0;
      if (times <= paid) continue;
      money += (times - paid) * Math.round(a.money * state.hatchThreshold);
      repeats[a.id] = times;
      changed = true;
      continue;
    }
    if (done[a.id] !== undefined) continue;
    const { have, need } = a.metric(state);
    if (have < need) continue;
    achievements[a.id] = now;
    money += Math.round(a.money * state.hatchThreshold);
    if (a.item) inventory[a.item] = (inventory[a.item] ?? 0) + 1;
    if (a.legendItem) legendItems[a.legendItem] = (legendItems[a.legendItem] ?? 0) + 1;
    changed = true;
  }

  if (!changed) return state;

  return {
    ...state,
    achievements,
    repeats,
    inventory,
    legendItems,
    // The wallet, and only the wallet. See the header.
    awardTokens: (state.awardTokens ?? 0) + money,
  };
}
