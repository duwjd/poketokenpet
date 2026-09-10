import { LEG_LENGTH, STOPS, type Stop } from '../src/journey.ts';
import type { GameState } from './game.ts';
import { LEGENDS } from './legenddata.ts';

/**
 * Rooms that belong to one Pokemon, and stay shut until you have met it.
 *
 * ── What this is for ──────────────────────────────────────────────────────
 * 시작의 방 is where Arceus is. 창기둥 is where Dialga and Palkia are. Walking
 * a pet through them as ordinary scenery — a caption for an hour and a
 * quarter, then on to the next place — makes them the same kind of thing as
 * 3섬 항구. They are not. So they are simply not on the route until their
 * occupant has been met, and the pet lingers a leg longer at the place before
 * instead.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * ## "Met", not "beaten"
 *
 * `state.metLegends` records the encounter, won or lost. A Giratina that
 * flattened you was still met, and the room it lives in is no less real for
 * it. `hunt.ts` writes the id the moment the fight is settled.
 *
 * ## Why the pet walks BACKWARD rather than skipping ahead
 *
 * The route index still advances exactly as it always did; only the place it
 * RESOLVES to changes. A shut room shows the previous open stop, so the lap
 * length, `REGION_AT`, the gym cities and every distance in the badge case are
 * all untouched — a shrine opening does not move anybody's position by one
 * encounter. Skipping forward would have shortened the lap by however many
 * rooms a given save had shut, which is a different route per player and a
 * different answer to "where am I" every time one opens.
 *
 * ## The table
 *
 * Hand-written from a source, not from memory. Each legendary's Bulbapedia
 * article names the room it was sealed in — Regirock's says "In Hoenn, it was
 * sealed in the Desert Ruins; in Sinnoh and Galar, in the Rock Peak Ruins" —
 * and each room's article names its occupant: "It is the shrine in which
 * Wo-Chien was sealed."
 *
 * Both directions were read, because one direction alone lies. Scanning the
 * legendaries' pages for room names paired 해저유적 with the Forces of Nature
 * and 화염의 방 with Ho-Oh; reading those rooms' own pages showed neither
 * sentence exists. **A room whose article does not name an occupant is left
 * out.** So the Unown chambers (이라님 석실 · 옥포그리 유적 · 알프의 유적 ·
 * 신수유적), the Kalos chambers (화염 · 수문 · 무쇠 · 용문양 · 빛의 방), 해저유적
 * and 고시의 석실 are ordinary stops — the last of those unlocks the Regi
 * chambers rather than holding one.
 *
 * Two names appear in two regions each: 바위산의 유적 and 빙산의 유적 are in
 * both Sinnoh and Galar, and hold the same Regi in both. One row locks both,
 * which is what keying by name gets right for free.
 *
 * Keyed by the Korean stop name, the same way `server/gyms.ts` keys its
 * cities: `src/journey.ts` is generated, and an index would move under it.
 * Every key is checked against STOPS at module load.
 */
export const SHRINES: Record<string, number[]> = {
  // ── 관동 ──
  '블루시티동굴': [150],
  '탄생의 섬': [386],
  '배꼽바위': [249, 250],
  // ── 성도 ──
  '방울탑': [250],
  '신도유적': [493],
  '소용돌이섬': [249],
  // ── 호연 ──
  '사막유적': [377],
  '작은 섬 옆굴': [378],
  '고대의 무덤': [379],
  '각성의 사당': [382, 383],
  '하늘기둥': [384],
  '남쪽의 외딴섬': [380, 381],
  '머나먼 고도': [151],
  '육지 동굴': [383],
  '바다 동굴': [382],
  // ── 신오 ──
  //
  // 바위산의 유적과 빙산의 유적은 신오와 가라르 양쪽에 같은 이름으로 있고, 둘 다 같은
  // 레지가 봉인된 곳이라 한 줄이 두 정류장을 함께 잠근다.
  '바위산의 유적': [377],
  '빙산의 유적': [378],
  '무쇠의 유적': [379],
  '시작의 방': [493],
  '창기둥': [483, 484],
  '만월섬': [488],
  '신월섬': [491],
  '송별의샘': [487],
  '귀혼동굴': [487],
  '선단신전': [486],
  '진실호수': [481],
  '입지호수': [482],
  '예지호수': [480],
  // ── 하나 ──
  '땅밑유적': [377, 378, 379],
  '바위산의 방': [377],
  '빙산의 방': [378],
  '쇠철의 방': [379],
  '리버티가든섬': [494],
  '용나선탑': [643, 644],
  '지하수맥굴': [646],
  '풍요의 사당': [645],
  // ── 칼로스 ──
  '끝의 동굴': [718],
  '공허의 방': [720],
  // ── 알로라 ──
  '일륜의 제단': [791],
  '월륜의 제단': [792],
  '전쟁의 유적': [785],
  '생명의 유적': [786],
  '결실의 유적': [787],
  '피안의 유적': [788],
  // ── 가라르 ──
  '쇠철의 유적': [379],
  '결정의 유적': [894, 895],
  '왕관신전': [898],
  '악의 탑': [892],
  '물의 탑': [892],
  // ── 히스이 ──
  '신오신전': [493],
  // ── 팔데아 ──
  '후목의 사당': [1001],
  '동파의 사당': [1002],
  '진토의 사당': [1003],
  '화마의 사당': [1004],
};

/**
 * Checked once, loudly.
 *
 * A key that is not on the route shuts nothing and would sit here looking like
 * it did — the exact failure `server/gyms.ts` resolves its cities by name to
 * avoid. A species that is not a legendary would be a typo.
 */
const KNOWN = new Set(STOPS.map((s) => s.ko));
for (const [ko, ids] of Object.entries(SHRINES)) {
  if (!KNOWN.has(ko)) throw new Error(`shrines.ts: ${ko} is not on the journey`);
  for (const id of ids) {
    if (!LEGENDS.some((l) => l.id === id)) throw new Error(`shrines.ts: ${ko} names ${id}, which is not a legendary`);
  }
}

/** Has this save met the Pokemon, won or lost? */
export function hasMet(state: GameState, speciesId: number): boolean {
  return (state.metLegends ?? []).includes(speciesId);
}

/**
 * Is this stop on the route right now?
 *
 * A room opens once ANY of its occupants has been met — 창기둥 belongs to
 * Dialga and Palkia both, and having met one of them is reason enough for the
 * place to exist.
 */
export function stopOpen(state: GameState, ko: string): boolean {
  const ids = SHRINES[ko];
  return !ids || ids.some((id) => hasMet(state, id));
}

/**
 * Where the pet is, with shut rooms passed over.
 *
 * Walks back to the last open stop, wrapping at the start of the route. Bounded
 * by the number of stops, and by construction it always terminates: the table
 * is far smaller than the route and the gym cities are never in it, so an
 * all-shut route is not reachable.
 */
export function stopFor(huntCount: number, state: GameState): Stop {
  const n = Number.isFinite(huntCount) ? Math.max(0, Math.floor(huntCount)) : 0;
  const at = Math.floor(n / LEG_LENGTH) % STOPS.length;
  for (let back = 0; back < STOPS.length; back++) {
    const s = STOPS[(at - back + STOPS.length) % STOPS.length];
    if (stopOpen(state, s.ko)) return s;
  }
  return STOPS[at];
}

/** How many of the rooms this save has opened, for the screen. */
export function shrinesOpen(state: GameState): { open: number; total: number } {
  const keys = Object.keys(SHRINES);
  return { open: keys.filter((ko) => stopOpen(state, ko)).length, total: keys.length };
}
