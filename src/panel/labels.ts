import type { MoveCard, TabId } from './types.ts';

/** Mirrors NICKNAME_MAX in server/game.ts. The renderer must not import from
 *  server/, so the length lives in both places; the server is authoritative and
 *  truncates anyway, this only stops the box accepting what will be cut. */
export const NICKNAME_MAX = 12;

const DAMAGE_LABEL: Record<string, string> = {
  physical: '물리',
  special: '특수',
  status: '변화',
};

/**
 * Whether a move can actually hurt something.
 *
 * Mirrors `isDamaging` in server/game.ts — `damageClass` alone, no power test,
 * because the twenty-three formula-power moves do hit. The renderer cannot
 * import the server module (test/payload-shape.test.ts forbids it), but
 * `damageClass` is already on every MoveCard, so the rule costs nothing here.
 */
export const isAttack = (m: MoveCard) => m.damageClass !== 'status';

/** "위력 90 · 불꽃 · 특수" — the one-line summary under a move name. */
export const moveSummary = (m: MoveCard) =>
  `${m.typeName} · ${DAMAGE_LABEL[m.damageClass] ?? m.damageClass}` +
  `${m.power ? ` · 위력 ${m.power}` : ''} · PP ${m.pp}`;

export const ITEM_NAMES: Record<string, string> = {
  'rare-candy': '이상한사탕',
  'shiny-charm': '반짝반짝부적',
  everstone: '변함없는돌',
  'key-stone': '키스톤',
  'dynamax-band': '다이맥스밴드',
  'dna-splicers': 'DNA쐐기',
};

/** How long the clerk's parting line stays up. Matches the flash toast. */
export const SAID_MS = 3000;

/**
 * How big the clerk is drawn.
 *
 * The sprite is 80x80, so 160 is an exact 2x — the only kind of scale that maps
 * one source pixel to an even block. `fitScale` is the general answer to this
 * and is what the scene uses, but it needs the natural size from an onLoad, and
 * there is exactly one clerk at one known size.
 */
export const CLERK_PX = 160;

/**
 * What each bag item does, for the description window.
 *
 * A short second sentence rather than the shop's sales copy: by the time it is
 * in the bag the question is no longer "should I buy this" but "what happens if
 * I press it".
 */
export const ITEM_DESC: Record<string, string> = {
  'rare-candy': '레벨이 1 오릅니다. 알일 때는 부화까지를 25% 채웁니다.',
  'shiny-charm': '다음 부화 한 번만 샤이니 확률이 8배가 됩니다.',
  everstone: '진화와 졸업을 멈춰 지금 모습을 유지합니다. 해제는 무료입니다.',
  'key-stone': '가지고 있으면 메가스톤이 있는 종이 배틀에서 메가진화합니다.',
  'dynamax-band': '가지고 있으면 거다이맥스할 수 있는 종이 배틀 3턴 동안 거대해집니다.',
  'dna-splicers': '도감에 있는 상대와 합체합니다. 분리는 무료입니다.',
};

/**
 * What is standing between this companion and a battle form.
 *
 * Ordered by what the player would fix first: an everstone is one press, the
 * item is a purchase, and the stone is a hunt.
 */
export function formNeed(
  f: { kind: 'mega' | 'gmax'; stone: { ko: string; have: boolean } | null },
  everstone: boolean,
): string {
  if (everstone) return '변함없는돌을 빼면 가능';
  if (f.kind === 'mega') {
    if (f.stone && !f.stone.have) return `${f.stone.ko} 필요`;
    return '키스톤 필요';
  }
  return '다이맥스밴드 필요';
}

/**
 * Items that work by being owned, not by being pressed.
 *
 * Mirrors PASSIVE in server/shop.ts. Duplicated rather than imported because
 * the renderer may not import server modules — the same reason SHOP_GROUPS is
 * written twice. The server still decides `owned`; this only decides whether to
 * draw a button.
 */
export const PASSIVE = new Set(['key-stone', 'dynamax-band']);

/**
 * The bag's pockets.
 *
 * Four, where the games have five. Same idiom as the shop's shelf chips, and
 * for the same reason: a 420px column cannot hold fourteen machines plus
 * everything else at once and still be read.
 *
 * `중요한 물건` is the games' own name for the pocket that holds what works by
 * being owned. It is here because a key stone has no button — it sat among the
 * candies and the everstone wearing a `보유 중` badge where they wear a control,
 * which made the one list two kinds of thing. Now 도구 holds only what you
 * press, and this holds only what you check.
 */
/** How a signature item is come by, for the condition screen. */
export const LEGEND_SOURCE_KO: Record<string, string> = {
  drop: '사냥에서 떨어집니다',
  award: '업적 보상',
  shards: '조각 12개를 모아 합성',
};

export const POCKETS = [
  { id: 'item', label: '도구' },
  { id: 'key', label: '중요한 물건' },
  { id: 'tm', label: '기술머신' },
  { id: 'stone', label: '메가스톤' },
  { id: 'legend', label: '전설' },
] as const;
export type Pocket = (typeof POCKETS)[number]['id'];

/**
 * Machines shown on one page of the 기술머신 pocket.
 *
 * The pocket is the one place the bag can genuinely run long: a save with 47
 * machines held shows every one this companion can still learn, which is 19
 * today and climbs as the dex fills. At ~50px a row that is 950px of column in
 * a window that is 760px at its tallest and 420px at its shortest.
 *
 * Eight is what fits the common case without scrolling: 8 x 50 = 400px, and the
 * tab bar, the pocket chips and the description window take about 220px before
 * the first row. Pockets already exist to stop the bag being "화면 여섯 장"; this
 * is the same argument one level down.
 */
export const TM_PAGE = 8;

/** The shop's shelves, in the order they are drawn. */
export const SHOP_GROUPS = [
  { id: 'egg', label: '알' },
  { id: 'growth', label: '성장' },
  { id: 'evolution', label: '진화' },
] as const;
export type ShopGroup = (typeof SHOP_GROUPS)[number]['id'];

export const compact = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n.toLocaleString();

/**
 * The eighteen types, for the dex filter row.
 *
 * Hardcoded rather than derived from the index, so the filter is complete
 * before the index has been fetched — and it never changes.
 */
export const TYPE_FILTERS: { id: string; name: string }[] = [
  { id: 'normal', name: '노말' },
  { id: 'fighting', name: '격투' },
  { id: 'flying', name: '비행' },
  { id: 'poison', name: '독' },
  { id: 'ground', name: '땅' },
  { id: 'rock', name: '바위' },
  { id: 'bug', name: '벌레' },
  { id: 'ghost', name: '고스트' },
  { id: 'steel', name: '강철' },
  { id: 'fire', name: '불꽃' },
  { id: 'water', name: '물' },
  { id: 'grass', name: '풀' },
  { id: 'electric', name: '전기' },
  { id: 'psychic', name: '에스퍼' },
  { id: 'ice', name: '얼음' },
  { id: 'dragon', name: '드래곤' },
  { id: 'dark', name: '악' },
  { id: 'fairy', name: '페어리' },
];

/**
 * How old the data on screen is: "방금" / "3분 전" / "2시간 전".
 *
 * Only ever shown alongside the staleness bar, so it does not need to be exact
 * past an hour.
 */
export function agoLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 45) return '방금';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}분 전`;
  return `${Math.round(m / 60)}시간 전`;
}

/** Missed polls before the panel admits it. One blip is not news. */
export const STALE_AFTER = 2;

export const RARITY_LABEL: Record<string, string> = {
  common: '흔함',
  uncommon: '조금 귀함',
  rare: '귀함',
  legendary: '전설',
};

/**
 * The key a dex card is filed under.
 *
 * One expression used for the React key, the entry cache and the focus-restore
 * lookup. Three hand-written copies of `${id}-${shiny}` is exactly how those
 * three drift apart.
 */
export const dexKey = (d: { speciesId: number; shiny: boolean }) =>
  `${d.speciesId}-${d.shiny ? 's' : 'n'}`;

/**
 * 방어 상성 bucket labels.
 *
 * Digits rather than ×4 / ×¼: the fraction glyphs are not in Galmuri, so they
 * would fall back to a system font in the middle of a pixel row. 무효 is the
 * games' own word, and Scene.tsx already prints 효과가 없는 것 같다 for the
 * same number.
 */
export const FACTOR_LABEL: Record<number, string> = {
  4: '4배',
  2: '2배',
  0.5: '0.5배',
  0.25: '0.25배',
  0: '무효',
};

/**
 * The 지방 chip's id, sitting in the same state the category chips write.
 *
 * Not a category — nothing in `server/achievements.ts` carries it — which is
 * exactly why it is safe: `a.cat === awardCat` matches nothing, so the list is
 * empty by construction rather than by a second flag anyone could forget.
 */
export const REGION_VIEW = 'region';

export const TABS: { id: TabId; label: string }[] = [
  { id: 'pet', label: '파트너' },
  { id: 'stats', label: '기록' },
  { id: 'bag', label: '가방' },
  { id: 'dex', label: '도감' },
  { id: 'awards', label: '업적' },
  { id: 'shop', label: '상점' },
  { id: 'settings', label: '설정' },
];

export const ENTRYPOINT_LABEL: Record<string, string> = {
  'claude-vscode': 'VS Code',
  cli: '터미널',
  'claude-desktop': '데스크톱',
  unknown: '알 수 없음',
};

/**
 * How long an accepted fight may take to reach the scene before the panel
 * stops waiting for it. Well past one poll and a sprite download.
 */
export const AWAIT_MS = 20_000;
