import { lifetimeOf, type GameState } from './game.ts';
import { generationOf, retireInto } from './dex.ts';
import { speciesName } from './species.ts';
import { josa } from '../src/josa.ts';
import type { ShopResult } from './shop.ts';
import { LEGENDS, legendItem, type LegendRow } from './legenddata.ts';

/**
 * What it takes to meet a legendary.
 *
 * ── The shape ─────────────────────────────────────────────────────────────
 * Ninety-four species, and none of them turn up in the wild until something is
 * true. Two ways that something can be satisfied:
 *
 *   조건만  a metric over the save — dex size, trainer wins, distance walked.
 *           Meeting the bar opens the species.
 *   전용 도구  the metric decides when the ITEM becomes obtainable; HOLDING the
 *           item is what opens the species. So the effort is doubled on
 *           purpose: reach the bar, then go and find the thing.
 *
 * Once open, the species simply stops being substituted out of the wild roll —
 * it is a 3%-bucket encounter like any other legendary, so it is still rare.
 * Using its item from the bag skips the waiting and pins the next encounter.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * ## Why some rows have no item
 *
 * Not every legendary has a signature item in the games, and inventing one
 * would be worse than not having one — a 뮤츠 gated behind an Odd Keystone is a
 * lie about the source material. The twenty-six pairings below are the ones the
 * games actually make. Everything else is gated by a condition heavy enough to
 * stand on its own.
 *
 * ## Groups
 *
 * The trios and quartets share one gate, because they share one gate in the
 * games and because ninety-four separate sentences would be ninety-four chances
 * to drift. `group()` is what keeps a trio honest.
 *
 * ## The standing rule
 *
 * WHEN A SYSTEM IS ADDED OR CHANGED, THIS TABLE CHANGES WITH IT — the same rule
 * `server/achievements.ts` carries, for the same reason. A gate that measures a
 * counter which no longer means what it used to is a lie the screen repeats
 * every twenty seconds. And a species id here is a PERMANENT key: `legendEggs`
 * and `forcedSpecies` are keyed by it.
 */

export type LegendTier = 'sub' | 'box' | 'myth';

/** How a signature item is obtained. Deliberately three different answers. */
export type LegendSource =
  /** Drops while hunting, but only once the gate's metric is met. */
  | 'drop'
  /** Handed over by an achievement. */
  | 'award'
  /** Fragments drop; enough of them fuse into the item. The longest road. */
  | 'shards';

export type LegendGate = {
  speciesId: number;
  tier: LegendTier;
  /** Signature item slug into LEGEND_ITEMS, or null when the metric alone opens it. */
  item: string | null;
  source: LegendSource | null;
  /**
   * The bar.
   *
   * Same shape as an achievement's metric, and for the same reason: the screen
   * draws a gauge from it and the test is `have >= need`, so the number on
   * screen cannot disagree with whether the row is open.
   *
   * For a row WITH an item this is not the gate — it is when the item starts
   * being obtainable. Holding the item is the gate.
   */
  metric: (s: GameState) => { have: number; need: number };
  /** One line, for the screen. */
  how: string;
};

/** How many shards fuse into one signature item. */
export const SHARDS_PER_ITEM = 12;

// ── metrics ────────────────────────────────────────────────────────────────

const dex = (need: number) => (s: GameState) => ({ have: s.dex.length, need });
const gen = (g: number, need: number) => (s: GameState) => ({
  have: s.dex.filter((d) => generationOf(d.speciesId) === g).length,
  need,
});
const wins = (need: number) => (s: GameState) => ({ have: s.trainerWins ?? 0, need });
const walked = (need: number) => (s: GameState) => ({ have: s.huntCount, need });
const stones = (need: number) => (s: GameState) => ({
  have: Object.values(s.stones ?? {}).filter((n) => (n ?? 0) > 0).length,
  need,
});
const raised = (need: number) => (s: GameState) => ({ have: s.retiredCount, need });
/** Legendaries already registered — the ladder the mythicals sit at the top of. */
export const legendsInDex = (s: GameState) =>
  s.dex.filter((d) => LEGENDS.some((l) => l.id === d.speciesId)).length;
const caught = (need: number) => (s: GameState) => ({ have: legendsInDex(s), need });

/**
 * Either bar. The gentler sibling of `both`, and the only safe way to add a
 * road to a gate that is already open for somebody.
 *
 * `openLegends` recomputes every row from scratch on every tick — there is no
 * stored "opened" flag the way `state.achievements` stores an unlock — so
 * tightening a gate does not merely slow someone down, it takes a legendary
 * back off them within twenty seconds. `achievements.ts` refuses exactly that
 * for thresholds, and a gate has no id to skip on. So a new condition goes in
 * beside the old one, never on top of it.
 */
const either =
  (a: (s: GameState) => { have: number; need: number }, b: (s: GameState) => { have: number; need: number }) =>
  (s: GameState) => {
    const x = a(s);
    const y = b(s);
    // The nearer of the two, so the gauge shows the road actually being walked.
    return x.have / x.need >= y.have / y.need ? x : y;
  };

/** Pokemon League runs cleared. */
const champion = (need: number) => (s: GameState) => ({ have: s.leagueWins ?? 0, need });

/**
 * Kanto badges held.
 *
 * Exported unused on purpose. With only one region shipped this maxes at eight
 * and can be met or not met, which is a step rather than the ladder every
 * other metric here is. When 성도's eight exist it becomes 8/16/24 and the
 * Johto gates — all of them new, so none of them able to re-lock anything —
 * can lean on it properly.
 */
export const badgesHeld = (need: number) => (s: GameState) => ({
  have: (s.badges ?? []).length,
  need,
});

/** Both bars, so a gate can ask for two things without a new metric shape. */
const both =
  (a: (s: GameState) => { have: number; need: number }, b: (s: GameState) => { have: number; need: number }) =>
  (s: GameState) => {
    const x = a(s);
    const y = b(s);
    // Reported as a fraction of the harder half, so the gauge never reads full
    // while the other half is still short.
    const ratioA = x.have / x.need;
    const ratioB = y.have / y.need;
    return ratioA <= ratioB ? x : y;
  };

// ── the table ──────────────────────────────────────────────────────────────

type Row = Omit<LegendGate, 'speciesId'>;

const group = (ids: number[], row: Row): LegendGate[] => ids.map((speciesId) => ({ speciesId, ...row }));
const one = (speciesId: number, row: Row): LegendGate => ({ speciesId, ...row });

export const LEGEND_GATES: LegendGate[] = [
  // ── 1세대 ──
  ...group([144, 145, 146], {
    tier: 'sub', item: null, source: null,
    metric: gen(1, 40), how: '관동 도감 40종',
  }),
  one(150, {
    tier: 'box', item: null, source: null,
    // 무단침입굴 opens after the Hall of Fame in the games, so the league is
    // the most faithful second road there is. Added with `either`, never
    // folded into the `both` — the old condition still opens it on its own.
    metric: either(both(dex(300), wins(80)), champion(1)),
    how: '도감 300종 · 트레이너 80승 — 또는 명예의 전당 등록',
  }),
  one(151, {
    tier: 'myth', item: null, source: null,
    metric: both(dex(450), caught(6)), how: '도감 450종 · 전설 6종 등록',
  }),

  // ── 2세대 ──
  ...group([243, 244, 245], {
    tier: 'sub', item: null, source: null,
    metric: both(gen(2, 35), wins(40)), how: '성도 도감 35종 · 트레이너 40승',
  }),
  one(249, {
    tier: 'box', item: 'silver-wing', source: 'drop',
    metric: gen(2, 50), how: '성도 도감 50종을 채우면 은빛깃털이 떨어지기 시작한다',
  }),
  one(250, {
    tier: 'box', item: 'rainbow-wing', source: 'drop',
    metric: gen(2, 50), how: '성도 도감 50종을 채우면 무지갯빛깃털이 떨어지기 시작한다',
  }),
  one(251, {
    tier: 'myth', item: 'clear-bell', source: 'shards',
    metric: both(dex(400), caught(5)), how: '도감 400종 · 전설 5종 등록',
  }),

  // ── 3세대 ──
  ...group([377, 378, 379], {
    tier: 'sub', item: null, source: null,
    metric: stones(15), how: '메가스톤 15종 수집',
  }),
  ...group([380, 381], {
    tier: 'box', item: 'soul-dew', source: 'drop',
    metric: gen(3, 45), how: '호연 도감 45종을 채우면 마음의물방울이 떨어지기 시작한다',
  }),
  one(382, {
    tier: 'box', item: 'blue-orb', source: 'drop',
    metric: gen(3, 50), how: '호연 도감 50종을 채우면 쪽빛구슬이 떨어지기 시작한다',
  }),
  one(383, {
    tier: 'box', item: 'red-orb', source: 'drop',
    metric: gen(3, 50), how: '호연 도감 50종을 채우면 주홍구슬이 떨어지기 시작한다',
  }),
  one(384, {
    tier: 'box', item: null, source: null,
    metric: both(caught(2), walked(3000)), how: '전설 2종 등록 · 3,000조우',
  }),
  one(385, {
    tier: 'myth', item: null, source: null,
    metric: both(dex(350), raised(30)), how: '도감 350종 · 30마리 졸업',
  }),
  one(386, {
    tier: 'myth', item: 'meteorite', source: 'shards',
    metric: both(dex(380), caught(4)), how: '도감 380종 · 전설 4종 등록',
  }),

  // ── 4세대 ──
  ...group([480, 481, 482], {
    tier: 'sub', item: null, source: null,
    metric: dex(250), how: '도감 250종',
  }),
  one(483, {
    tier: 'box', item: 'adamant-orb', source: 'drop',
    metric: both(gen(4, 40), walked(3500)), how: '신오 도감 40종 · 3,500조우면 금강옥이 떨어지기 시작한다',
  }),
  one(484, {
    tier: 'box', item: 'lustrous-orb', source: 'drop',
    metric: both(gen(4, 40), walked(3500)), how: '신오 도감 40종 · 3,500조우면 백옥이 떨어지기 시작한다',
  }),
  one(485, {
    tier: 'sub', item: 'magma-stone', source: 'drop',
    metric: stones(20), how: '메가스톤 20종을 모으면 화산의돌이 떨어지기 시작한다',
  }),
  one(486, {
    tier: 'box', item: null, source: null,
    // The three golems in the games. Here: register all three first.
    metric: (s) => ({
      have: [377, 378, 379].filter((id) => s.dex.some((d) => d.speciesId === id)).length,
      need: 3,
    }),
    how: '레지락·레지아이스·레지스틸을 전부 도감에 등록',
  }),
  one(487, {
    tier: 'box', item: 'griseous-orb', source: 'award',
    metric: caught(8), how: '전설 8종 등록 (업적 보상)',
  }),
  one(488, {
    tier: 'sub', item: 'lunar-wing', source: 'drop',
    metric: gen(4, 35), how: '신오 도감 35종을 채우면 초승달깃털이 떨어지기 시작한다',
  }),
  ...group([489, 490], {
    tier: 'myth', item: 'tidal-bell', source: 'shards',
    metric: both(dex(320), gen(4, 45)), how: '도감 320종 · 신오 도감 45종',
  }),
  one(491, {
    tier: 'myth', item: 'member-card', source: 'shards',
    metric: both(dex(400), wins(120)), how: '도감 400종 · 트레이너 120승',
  }),
  one(492, {
    tier: 'myth', item: 'gracidea', source: 'drop',
    metric: both(dex(360), raised(40)), how: '도감 360종 · 40마리 졸업하면 그라시데아꽃이 떨어지기 시작한다',
  }),
  one(493, {
    tier: 'myth', item: 'azure-flute', source: 'shards',
    // The hardest gate in the table, and it should be.
    metric: both(dex(600), caught(20)), how: '도감 600종 · 전설 20종 등록',
  }),

  // ── 5세대 ──
  one(494, {
    tier: 'myth', item: null, source: null,
    metric: both(wins(150), raised(25)), how: '트레이너 150승 · 25마리 졸업',
  }),
  ...group([638, 639, 640], {
    tier: 'sub', item: null, source: null,
    metric: wins(70), how: '트레이너 70승',
  }),
  ...group([641, 642, 645], {
    tier: 'sub', item: 'reveal-glass', source: 'award',
    metric: walked(5000), how: '5,000조우 (업적 보상)',
  }),
  one(643, {
    tier: 'box', item: 'light-stone', source: 'drop',
    metric: both(gen(5, 40), caught(3)), how: '하나 도감 40종 · 전설 3종 등록하면 라이트스톤이 떨어지기 시작한다',
  }),
  one(644, {
    tier: 'box', item: 'dark-stone', source: 'drop',
    metric: both(gen(5, 40), caught(3)), how: '하나 도감 40종 · 전설 3종 등록하면 다크스톤이 떨어지기 시작한다',
  }),
  one(646, {
    tier: 'box', item: null, source: null,
    // Kyurem needs both halves, which is what the games say too.
    metric: (s) => ({
      have: [643, 644].filter((id) => s.dex.some((d) => d.speciesId === id)).length,
      need: 2,
    }),
    how: '레시라무와 제크로무를 전부 도감에 등록',
  }),
  one(647, {
    tier: 'myth', item: null, source: null,
    metric: both(wins(200), dex(380)), how: '트레이너 200승 · 도감 380종',
  }),
  one(648, {
    tier: 'myth', item: null, source: null,
    metric: both(dex(400), raised(45)), how: '도감 400종 · 45마리 졸업',
  }),
  one(649, {
    tier: 'myth', item: null, source: null,
    metric: both(dex(420), stones(30)), how: '도감 420종 · 메가스톤 30종',
  }),

  // ── 6세대 ──
  ...group([716, 717], {
    tier: 'box', item: null, source: null,
    metric: both(gen(6, 30), caught(5)), how: '칼로스 도감 30종 · 전설 5종 등록',
  }),
  one(718, {
    tier: 'box', item: null, source: null,
    metric: (s) => ({
      have: [716, 717].filter((id) => s.dex.some((d) => d.speciesId === id)).length,
      need: 2,
    }),
    how: '제르네아스와 이벨타르를 전부 도감에 등록',
  }),
  one(719, {
    tier: 'myth', item: 'enigma-stone', source: 'shards',
    metric: both(dex(400), stones(25)), how: '도감 400종 · 메가스톤 25종',
  }),
  one(720, {
    tier: 'myth', item: 'prison-bottle', source: 'shards',
    metric: both(dex(430), caught(10)), how: '도감 430종 · 전설 10종 등록',
  }),
  one(721, {
    tier: 'myth', item: null, source: null,
    metric: both(dex(410), wins(160)), how: '도감 410종 · 트레이너 160승',
  }),

  // ── 7세대 ──
  ...group([772, 773], {
    tier: 'sub', item: null, source: null,
    metric: both(gen(7, 25), raised(35)), how: '알로라 도감 25종 · 35마리 졸업',
  }),
  ...group([785, 786, 787, 788], {
    tier: 'sub', item: null, source: null,
    /**
     * The bar is 4,400 encounters and it stays there.
     *
     * It used to READ "알로라 도달(4,400조우)", which was true of a 240-stop
     * route on a 25-encounter leg. The route is 665 stops on a 15-encounter leg
     * now and 4,400 lands in 칼로스, so the claim went first. The NUMBER did
     * not: `openLegends` recomputes every gate on every tick with no record of
     * what was already open, so raising this would take these four back off
     * anybody holding them, twenty seconds after the update.
     */
    metric: both(walked(4400), dex(300)), how: '4,400조우 · 도감 300종',
  }),
  ...group([789, 790], {
    tier: 'sub', item: null, source: null,
    metric: both(gen(7, 35), caught(6)), how: '알로라 도감 35종 · 전설 6종 등록',
  }),
  one(791, {
    tier: 'box', item: 'sun-flute', source: 'shards',
    metric: both(gen(7, 40), caught(8)), how: '알로라 도감 40종 · 전설 8종 등록',
  }),
  one(792, {
    tier: 'box', item: 'moon-flute', source: 'shards',
    metric: both(gen(7, 40), caught(8)), how: '알로라 도감 40종 · 전설 8종 등록',
  }),
  one(800, {
    tier: 'box', item: 'n-solarizer--merge', source: 'award',
    metric: (s) => ({
      have: [791, 792].filter((id) => s.dex.some((d) => d.speciesId === id)).length,
      need: 2,
    }),
    how: '솔가레오와 루나아라를 전부 도감에 등록 (업적 보상)',
  }),
  one(801, {
    tier: 'myth', item: null, source: null,
    metric: both(dex(440), stones(35)), how: '도감 440종 · 메가스톤 35종',
  }),
  one(802, {
    tier: 'myth', item: null, source: null,
    metric: both(dex(450), wins(180)), how: '도감 450종 · 트레이너 180승',
  }),
  one(807, {
    tier: 'myth', item: null, source: null,
    metric: both(dex(460), walked(7000)), how: '도감 460종 · 7,000조우',
  }),
  ...group([808, 809], {
    tier: 'myth', item: null, source: null,
    metric: both(dex(470), raised(60)), how: '도감 470종 · 60마리 졸업',
  }),

  // ── 8세대 ──
  one(888, {
    tier: 'box', item: 'rusted-sword', source: 'award',
    metric: both(wins(100), gen(8, 25)), how: '트레이너 100승 · 가라르 도감 25종 (업적 보상)',
  }),
  one(889, {
    tier: 'box', item: 'rusted-shield', source: 'award',
    metric: both(wins(100), gen(8, 25)), how: '트레이너 100승 · 가라르 도감 25종 (업적 보상)',
  }),
  one(890, {
    tier: 'box', item: null, source: null,
    metric: (s) => ({
      have: [888, 889].filter((id) => s.dex.some((d) => d.speciesId === id)).length,
      need: 2,
    }),
    how: '자시안과 자마젠타를 전부 도감에 등록',
  }),
  one(891, {
    tier: 'sub', item: null, source: null,
    metric: both(wins(90), raised(40)), how: '트레이너 90승 · 40마리 졸업',
  }),
  one(892, {
    tier: 'sub', item: 'scroll-of-darkness', source: 'drop',
    metric: wins(110), how: '트레이너 110승을 채우면 악의 족자가 떨어지기 시작한다',
  }),
  one(893, {
    tier: 'myth', item: null, source: null,
    metric: both(dex(480), wins(200)), how: '도감 480종 · 트레이너 200승',
  }),
  ...group([894, 895], {
    tier: 'sub', item: null, source: null,
    metric: both(stones(25), gen(8, 30)), how: '메가스톤 25종 · 가라르 도감 30종',
  }),
  ...group([896, 897], {
    tier: 'sub', item: null, source: null,
    metric: both(gen(8, 35), caught(10)), how: '가라르 도감 35종 · 전설 10종 등록',
  }),
  one(898, {
    tier: 'box', item: 'reins-of-unity', source: 'award',
    metric: (s) => ({
      have: [896, 897].filter((id) => s.dex.some((d) => d.speciesId === id)).length,
      need: 2,
    }),
    how: '블리자포스와 레이스포스를 전부 도감에 등록 (업적 보상)',
  }),
  one(905, {
    tier: 'sub', item: null, source: null,
    metric: (s) => ({
      have: [641, 642, 645].filter((id) => s.dex.some((d) => d.speciesId === id)).length,
      need: 3,
    }),
    how: '토네로스·볼트로스·랜드로스를 전부 도감에 등록',
  }),

  // ── 9세대 ──
  ...group([1001, 1002, 1003, 1004], {
    tier: 'sub', item: null, source: null,
    metric: both(gen(9, 30), caught(12)), how: '팔데아 도감 30종 · 전설 12종 등록',
  }),
  ...group([1007, 1008], {
    tier: 'box', item: null, source: null,
    metric: both(gen(9, 40), walked(9000)), how: '팔데아 도감 40종 · 9,000조우',
  }),
  ...group([1014, 1015, 1016], {
    tier: 'sub', item: 'malicious-armor', source: 'drop',
    metric: both(gen(9, 35), wins(140)), how: '팔데아 도감 35종 · 트레이너 140승이면 저주받은갑옷이 떨어지기 시작한다',
  }),
  one(1017, {
    tier: 'sub', item: 'wellspring-mask', source: 'drop',
    metric: both(gen(9, 45), raised(50)), how: '팔데아 도감 45종 · 50마리 졸업하면 우물의가면이 떨어지기 시작한다',
  }),
  one(1024, {
    tier: 'box', item: 'clear-amulet', source: 'award',
    metric: both(dex(550), caught(18)), how: '도감 550종 · 전설 18종 등록 (업적 보상)',
  }),
  one(1025, {
    tier: 'myth', item: 'auspicious-armor', source: 'shards',
    metric: both(dex(500), caught(15)), how: '도감 500종 · 전설 15종 등록',
  }),
];

const GATE_BY_ID = new Map(LEGEND_GATES.map((g) => [g.speciesId, g]));

export function gateOf(speciesId: number): LegendGate | null {
  return GATE_BY_ID.get(speciesId) ?? null;
}

/** Does the bag hold this signature item? */
export function holdsLegendItem(s: GameState, slug: string): boolean {
  return (s.legendItems?.[slug] ?? 0) > 0;
}

/** Has the metric been cleared? For an item row this means "the item can drop". */
export function metricMet(g: LegendGate, s: GameState): boolean {
  const { have, need } = g.metric(s);
  return have >= need;
}

/**
 * Every species that may currently turn up in the wild.
 *
 * Resolved ONCE per hunt batch and handed to the loop, never re-read inside it:
 * two processes settle the same encounter range against one state.json, and
 * they can only agree if they both computed this from the same saved state.
 */
export function openLegends(s: GameState): Set<number> {
  const open = new Set<number>();
  for (const g of LEGEND_GATES) {
    const ok = g.item ? holdsLegendItem(s, g.item) : metricMet(g, s);
    if (ok) open.add(g.speciesId);
  }
  return open;
}

/**
 * The signature items that may currently drop.
 *
 * A gate whose metric is cleared but whose item is not yet held. Award and
 * shard items are excluded — those arrive by their own road, and letting them
 * also fall out of the grass would make three sources into one.
 */
export function droppableItems(s: GameState): string[] {
  const out = new Set<string>();
  for (const g of LEGEND_GATES) {
    if (!g.item || g.source !== 'drop') continue;
    if (holdsLegendItem(s, g.item)) continue;
    if (metricMet(g, s)) out.add(g.item);
  }
  return [...out].sort();
}

/** The same, for shard rows: which items are worth finding fragments of. */
export function shardableItems(s: GameState): string[] {
  const out = new Set<string>();
  for (const g of LEGEND_GATES) {
    if (!g.item || g.source !== 'shards') continue;
    if (holdsLegendItem(s, g.item)) continue;
    if (metricMet(g, s)) out.add(g.item);
  }
  return [...out].sort();
}

/** Name and tier for the screen, from the generated table. */
export function legendRow(speciesId: number): LegendRow | null {
  return LEGENDS.find((l) => l.id === speciesId) ?? null;
}

/** How hard the fight is, by tier. Multiplied onto the opponent exactly as a trainer's grit is. */
export const TIER_GRIT: Record<LegendTier, number> = { sub: 1.6, box: 2.0, myth: 2.4 };

/** The signature-item name, for a message. */
export function itemKo(slug: string): string {
  return legendItem(slug)?.ko ?? slug;
}

/**
 * Spend a signature item: reserve the next encounter for its legendary.
 *
 * Named `spend*` rather than `use*` because the lint rule that guards React's
 * rules-of-hooks matches on the prefix, and this is server code.
 *
 * The reservation is stamped with an ABSOLUTE encounter index rather than "the
 * next one". `hunt()` replays a cursor range and two processes have to reach
 * the same conclusion about which encounter was claimed; "next" is not a fact
 * they can agree on, and `huntCount` is.
 *
 * The item is spent here, not on victory. Losing has to cost something, or the
 * fight is decoration — and the gate itself stays open, so the road back is the
 * item, not the whole condition again.
 */
export function spendLegendItem(state: GameState, slug: string): ShopResult {
  const have = state.legendItems?.[slug] ?? 0;
  const ko = itemKo(slug);
  if (have < 1) return { state, ok: false, message: `${ko}${josa(ko, '이', '가')} 없습니다.` };

  const gate = LEGEND_GATES.find((g) => g.item === slug);
  if (!gate) return { state, ok: false, message: `${ko}${josa(ko, '은', '는')} 쓸 곳이 없습니다.` };
  if (!state.huntEnabled) {
    return { state, ok: false, message: '자동사냥이 꺼져 있어 조우를 예약할 수 없습니다.' };
  }
  if (state.forcedNext) {
    const already = speciesName(state.forcedNext.speciesId);
    return { state, ok: false, message: `이미 ${already}${josa(already, '을', '를')} 기다리는 중입니다.` };
  }

  const name = speciesName(gate.speciesId);
  return {
    state: {
      ...state,
      legendItems: { ...state.legendItems, [slug]: have - 1 },
      forcedNext: { seq: state.huntCount, speciesId: gate.speciesId },
    },
    ok: true,
    message: `${ko}${josa(ko, '을', '를')} 썼습니다. 다음 조우에 ${name}${josa(name, '이', '가')} 나타납니다.`,
  };
}

/**
 * Hatch a legendary egg: the current companion graduates and the egg takes over.
 *
 * Deliberately the same shape as buying an egg in the shop, down to anchoring
 * `eggStartedAt` to `lifetimeOf` — anchoring to a smaller sum is what turns an
 * expensive egg into an instant hatch.
 */
export function hatchLegendEgg(state: GameState, speciesId: number): ShopResult {
  const have = state.legendEggs?.[speciesId] ?? 0;
  const name = speciesName(speciesId);
  if (have < 1) return { state, ok: false, message: `${name}의 알이 없습니다.` };

  const s: GameState = {
    ...state,
    dex: [...state.dex],
    legendEggs: { ...state.legendEggs, [speciesId]: have - 1 },
  };
  if (s.active) {
    s.dex = retireInto(s.dex, s.active, Date.now());
    s.retiredCount += 1;
  }
  s.active = null;
  s.forcedSpecies = speciesId;
  // A legendary egg names its species outright, so the rarity floor has nothing
  // left to say. Clearing it stops a leftover floor from a shop egg outliving
  // the purchase it came from.
  s.forcedRarity = null;
  s.eggStartedAt = lifetimeOf(state);
  return { state: s, ok: true, message: `${name}의 알을 품기 시작했습니다.` };
}

/**
 * Fuse a full set of fragments into its item.
 *
 * The bag button only appears at a full set, but this checks again: the panel
 * polls, and a set that was full when the screen drew could have been fused by
 * the other window in between.
 */
export function fuseShards(state: GameState, slug: string): ShopResult {
  const have = state.shards?.[slug] ?? 0;
  const ko = itemKo(slug);
  if (have < SHARDS_PER_ITEM) {
    return {
      state,
      ok: false,
      message: `${ko} 조각이 모자랍니다. ${have} / ${SHARDS_PER_ITEM}`,
    };
  }
  return {
    state: {
      ...state,
      shards: { ...state.shards, [slug]: have - SHARDS_PER_ITEM },
      legendItems: { ...state.legendItems, [slug]: (state.legendItems?.[slug] ?? 0) + 1 },
    },
    ok: true,
    message: `조각이 하나로 모여 ${ko}${josa(ko, '이', '가')} 되었습니다.`,
  };
}
