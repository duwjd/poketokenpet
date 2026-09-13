import type { Gender } from './trainer.ts';

/**
 * The gym leaders, the island kahunas, the Elite Four and the Champions —
 * every region's roster, and the badges they hand over.
 *
 * ── What this file is ─────────────────────────────────────────────────────
 * A hand-written table, beside `server/trainer.ts`'s classes, `server/
 * legenddata.ts`'s gates and `server/dexdata.ts`'s entries. PokeAPI carries no
 * trainer data and no badge text at all, so every row below was transcribed by
 * hand.
 *
 * Split from `server/gyms.ts` for the reason `legenddata.ts` is split from
 * `legends.ts`: the roster is content and the pursuit is code, they grow at
 * completely different rates, and one region is ~13 rows of table plus the
 * prose each row's Korean strings demand. There is a second, sharper reason —
 * this module is a LEAF. It imports one type and nothing else, which is what
 * lets `server/store.ts` clamp the save against `BADGE_IDS` without joining
 * the `gyms.ts` ↔ `hunt.ts` import cycle.
 *
 * Pure in `seq` AND in the table, exactly as `trainerAt` is — and unlike it,
 * pure without taking a single draw. A leader's team is literal, so nothing
 * here is rolled; the only randomness in a gym fight lives inside `battleAt`,
 * on the salt it already had. That is why adding to this file cannot shift the
 * wild encounter stream, and why `test/gyms.test.ts` proves it structurally
 * rather than hopefully.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * ## The names are not ours
 *
 * `server/trainer.ts` says its class names are "ours, not the official
 * localisations", the way `부자 아저씨` always was. **That licence does not
 * extend to this file.** 웅, 이슬, 회색배지 are localised names for real
 * characters and real objects, and inventing one prints a factual error in the
 * message box every couple of hours.
 *
 * So every Korean string below was checked against a source, and three of the
 * first guesses were wrong: the badges are 회색배지 and 무지개배지 and
 * 진홍색배지, not 그레이배지, 레인보우배지, 카멜리아배지. The teams are the
 * Red/Green/Blue rosters, checked one at a time — including Giovanni's, which
 * is his THIRD battle (상록체육관); his first two are the Rocket Hideout and
 * Silph Co. and field a different team.
 *
 * The rule for a new region is three sources that must agree: the Korean name
 * and the gym city from a Korean source, the challenge roster and the teams
 * from an English one, and the city's existence from `src/journey.ts`. Where
 * they disagree, the row does not ship.
 *
 * One trap for whoever adds Johto: **독수 is a Kanto gym leader here and a
 * Johto Elite Four member in the games.** It is the same person, not a name
 * free to reuse — when 성도 lands he needs a `koga-e4` league row beside the
 * `koga` gym row, with the team he actually fields there. Alola has the same
 * shape twice over: 할라 is the Melemele kahuna AND an Elite Four member in
 * Sun/Moon.
 *
 * ## The art
 *
 * Each row carries a Showdown trainer slug that `ensureNpcSprite` resolves and
 * a badge NUMBER that `ensureBadgeSprite` resolves — the same host, the same
 * fetch-and-cache rule, and the same absolute rule as everything else here:
 * never committed, never redistributed. See NOTICE.md.
 */

/**
 * The regions that have a campaign, by the Korean name `src/journey.ts` spells
 * them with.
 *
 * 히스이 is absent ON PURPOSE, and its absence is typed rather than merely
 * unwritten: Legends: Arceus has no gyms, no Elite Four and no Champion. There
 * is nothing to transcribe, so a row for it would have to be invented, which
 * the header forbids. Declaring the union without it means an edit that adds
 * one fails to compile rather than shipping a fabrication.
 */
export type RegionKo =
  | '관동'
  | '성도'
  | '호연'
  | '신오'
  | '하나'
  | '칼로스'
  | '알로라'
  | '가라르'
  | '팔데아';

export type GymRow = {
  /**
   * Permanent key. Written onto the log entry, so renaming one severs every
   * past record that mentions it.
   *
   * UNIQUE ACROSS EVERY REGION, which is what lets `HuntEntry.gym` stay
   * `{id, badge, prize}` with no region field at all: `gymById` recovers the
   * region from the row, so no past record has to be migrated.
   */
  id: string;
  /**
   * Denormalised from the row's container, and load-bearing anyway: rows
   * escape. `gymById(id)` is called on an id read off a log entry with no
   * region in hand, and the panel has to say which region's badge it was. A
   * column checked against its container at module load is cheaper than
   * returning `{ row, region }` and destructuring at every call site — the
   * same bargain `badge` and `order` already make.
   */
  region: RegionKo;
  /**
   * The badge, in PokeAPI's GLOBAL numbering.
   *
   * One number is the save key, the upstream sprite's filename and the case's
   * display order all at once. Kanto is 1..8, which is why existing saves need
   * no migration at all. The full allocation is in the note above `BADGE_IDS`.
   */
  badge: number;
  /**
   * Challenge order WITHIN this region, 1..gyms.length. NOT the same as `badge`.
   *
   * Assigned by the ROUTE POSITION of the city, not by the games' gym order,
   * because `src/journey.ts` is generated from PokeAPI's location list and
   * that list is not geographic. Kanto already works this way: 노랑시티 (stop
   * 13) comes before 연분홍시티 (14), so 초련 is met fifth and 독수 sixth while
   * their badges stay numbered 6 and 5. The games permit exactly this — Soul
   * and Marsh may be taken in either order — and the numbering is a listing
   * convention, not a sequence.
   *
   * Outside Kanto the divergence is not a detail, it is the whole reason this
   * column exists. Galar's first gym town is stop 543 of a 477..555 block with
   * the other seven behind it; ordering by the games would leave nobody
   * standing until 543 and then open all eight at once, squeezing a region of
   * losable fights into thirteen stops.
   *
   * The one exception is a lock the games themselves impose. Those rows carry
   * `lateLock`, so the test that asserts "every leader is met in his own city"
   * derives its exceptions instead of listing them.
   */
  order: number;
  /** Official localisation. See the header. */
  ko: string;
  /**
   * What the message box calls this one. Defaults to `관장`.
   *
   * Per ROW rather than per region, because Alola's four are not
   * interchangeable: 할라 is 섬킹 and 하푸우 is 섬퀸. Absent on every gym row,
   * which keeps `gymTrainer` branch-free and every existing row unchanged.
   */
  title?: string;
  badgeKo: string;
  /**
   * The city, by the Korean name `src/journey.ts` spells it with — resolved
   * WITHIN this row's region, never against the whole route.
   *
   * A NAME, not an index. journey.ts is generated from PokeAPI, and a
   * regenerated route that inserts one stop would silently move every gym in
   * the region.
   *
   * Region-scoping the lookup is not tidiness. Stop names are not unique: 17
   * names repeat across the route, including every league plateau but Kanto's
   * — `포켓몬리그` is stops 143 (호연), 382 (칼로스) and 450 (알로라), and
   * `포켓몬 리그`, with a space, is 175 (신오), 276 (하나) and 650 (팔데아). A
   * bare `STOPS.findIndex` hands all six to 호연, which is how a Kalos leader
   * ends up standing in Hoenn with nothing thrown and nothing logged.
   */
  city: string;
  /** Showdown trainer slug, i.e. what `ensureNpcSprite` takes. Never a filename. */
  sprite: string;
  gender: Gender;
  /** The original team, entire. Nothing is trimmed for balance. */
  team: number[];
  /**
   * Toughness PER POKEMON, which is why the column is not sorted.
   *
   * `battleAt` multiplies this onto one opponent's HP pool and onto one
   * counter-attack, so a four-Pokemon team at a given grit is more than twice
   * the fight a two-Pokemon team is. The original teams run from two to five,
   * so holding grit flat would make 웅 a formality and 비주기 impossible.
   * These numbers are measured, not derived: they put every first-pass win
   * rate between 51% and 78%, so every gym can actually be lost.
   *
   * Measured against the encounter at which that region's leader is actually
   * MET, which is a different number in every region. A grit column copied
   * from Kanto's would be wrong twice over — different team sizes, different
   * bag by the time you arrive.
   *
   * How different: 관동's eight are met between encounters 47 and 411, against
   * a bag of two to seventeen machines. 하나's are met around encounter 3,900,
   * against a bag of a hundred and fifty. Copying 관동's column there put every
   * one of the eight between 84% and 99% — a formality with a badge attached.
   * So 하나's numbers run 1.8 to 3.0 where 관동's run 1.5 to 2.15, and they were
   * found the same way: a binary search over nine hundred fights per step,
   * aiming at 62% and landing every row between 60% and 71%.
   */
  grit: number;
  /**
   * The TM the badge comes with, as a move id.
   *
   * The FireRed/LeafGreen list, not Red/Blue's. R/B hands out 참기,
   * 사이코웨이브 and 땅가르기, which carry `power: 0` here and fall through to
   * FIXED_POWER — and 땅가르기 at 30 accuracy misses seven times in ten.
   * Awarding a move the battle cannot use is a worse infidelity than taking
   * the remake's list.
   *
   * The list is itself a ladder — 60, 60, 60, 75, status, status, 110, 100 —
   * so the badge that is hardest to win is the one that most changes the next
   * fight. That is what makes losing self-correcting rather than a spiral.
   */
  prize: number;
  /**
   * True for a leader the GAMES shut until the rest of the region is done, and
   * who therefore is not expected to be met at home.
   *
   * Exactly one row today: 비주기. It exists so the generalised "met in his own
   * city" test can derive its exceptions per region instead of naming them.
   */
  lateLock?: boolean;
};

/**
 * The Kanto roster, in challenge order.
 *
 * Levels are dropped on purpose: this game has none. What survives from the
 * source is WHICH Pokemon, which is the half the type chart reads.
 */
const KANTO_GYMS: GymRow[] = [
  { id: 'brock',    region: '관동', badge: 1, order: 1, ko: '웅',     badgeKo: '회색배지',   city: '회색시티',   sprite: 'brock',    gender: 'm', grit: 1.95, prize: 317, team: [74, 95] },
  { id: 'misty',    region: '관동', badge: 2, order: 2, ko: '이슬',   badgeKo: '블루배지',   city: '블루시티',   sprite: 'misty',    gender: 'f', grit: 2.15, prize: 352, team: [120, 121] },
  { id: 'surge',    region: '관동', badge: 3, order: 3, ko: '마티스', badgeKo: '오렌지배지', city: '갈색시티',   sprite: 'ltsurge',  gender: 'm', grit: 1.50, prize: 351, team: [100, 25, 26] },
  { id: 'erika',    region: '관동', badge: 4, order: 4, ko: '민화',   badgeKo: '무지개배지', city: '무지개시티', sprite: 'erika',    gender: 'f', grit: 1.75, prize: 202, team: [71, 114, 45] },
  { id: 'sabrina',  region: '관동', badge: 6, order: 5, ko: '초련',   badgeKo: '골드배지',   city: '노랑시티',   sprite: 'sabrina',  gender: 'f', grit: 1.56, prize: 347, team: [64, 122, 49, 65] },
  { id: 'koga',     region: '관동', badge: 5, order: 6, ko: '독수',   badgeKo: '핑크배지',   city: '연분홍시티', sprite: 'koga',     gender: 'm', grit: 1.62, prize: 92,  team: [109, 89, 109, 110] },
  { id: 'blaine',   region: '관동', badge: 7, order: 7, ko: '강연',   badgeKo: '진홍색배지', city: '홍련섬',     sprite: 'blaine',   gender: 'm', grit: 1.82, prize: 126, team: [58, 77, 78, 59] },
  { id: 'giovanni', region: '관동', badge: 8, order: 8, ko: '비주기', badgeKo: '그린배지',   city: '상록시티',   sprite: 'giovanni', gender: 'm', grit: 1.72, prize: 89,  team: [111, 51, 31, 34, 112], lateLock: true },
];

/**
 * The Elite Four and the Champion, at 석영고원.
 *
 * The Red/Green/Blue rosters, entire. Four of five and one of six — **no
 * version of Kanto gives the Elite Four six each.** Red/Blue, FireRed's first
 * run and its rematch, and Let's Go's first run are all five; only Let's Go's
 * rematch reaches six, and it does it with 알로라 고지, 알로라 딱구리 and
 * 메가리자몽X. This app has no regional-form data at all (server/forms.ts is
 * megas, gigantamaxes and fusions), so that version would have to be faked in
 * two places to be used at all. Twenty-six real Pokemon beat thirty invented
 * ones.
 *
 * 그린's last three vary with the starter in the games. Fixed here, and said
 * out loud rather than pretended away.
 */
export type LeagueRow = {
  /**
   * Permanent key, written onto the log entry.
   *
   * A SEPARATE namespace from `GymRow.id` — `HuntEntry.league` and
   * `HuntEntry.gym` are separate fields with separate lookups. Where one
   * person is both, the league row takes a suffix: 할라 is the Melemele kahuna
   * and an Alola Elite Four member, so `hala` and `hala-e4`.
   */
  id: string;
  region: RegionKo;
  /** Display name, `관장 웅`-shaped and under the eleven-character cap. */
  ko: string;
  sprite: string;
  gender: Gender;
  team: number[];
  /**
   * Rising, unlike the gym column.
   *
   * The gyms' grit falls as their teams grow because the party there is one
   * Pokemon on one bar. Here six bars face twenty-six opponents in a row, so
   * team size is nearly constant across the five and grit is free to say what
   * it means: 그린 at 1.80 sits between 프리져 (sub, 1.6) and 뮤츠 (box, 2.0),
   * which is exactly where a champion belongs.
   *
   * Measured, not derived. A party armed out of a ~47-machine bag — what
   * INTERNALS records in a real save — clears the run about 40% of the time,
   * so a three-start visit opens the Hall of Fame roughly four times in five.
   * A party armed out of eight machines clears about 4%: eight badges do not
   * by themselves make a league team.
   */
  grit: number;
};

const KANTO_LEAGUE: LeagueRow[] = [
  { id: 'lorelei', region: '관동', ko: '사천왕 칸나', sprite: 'lorelei-gen1', gender: 'f', grit: 1.57, team: [87, 91, 80, 124, 131] },
  { id: 'bruno',   region: '관동', ko: '사천왕 시바', sprite: 'bruno',        gender: 'm', grit: 1.62, team: [95, 107, 106, 95, 68] },
  { id: 'agatha',  region: '관동', ko: '사천왕 국화', sprite: 'agatha-gen1',  gender: 'f', grit: 1.67, team: [94, 42, 93, 24, 94] },
  { id: 'lance',   region: '관동', ko: '사천왕 목호', sprite: 'lance',        gender: 'm', grit: 1.73, team: [130, 148, 148, 142, 149] },
  { id: 'blue',    region: '관동', ko: '챔피언 그린', sprite: 'blue',         gender: 'm', grit: 1.80, team: [18, 65, 112, 130, 103, 59] },
];

export type RegionRow = {
  /**
   * ASCII save key, and THE key `state.leagues` is already keyed by.
   *
   * `'kanto'` is already on disk in every save that has cleared the league, so
   * this one string is not free to rename, ever.
   */
  id: string;
  /** Must equal a `Stop.region` that exists on the route. Checked at module load. */
  ko: RegionKo;
  /** The roster. Need not be in challenge order; `order` is what orders it. */
  gyms: GymRow[];
  /** The ladder, in the order it is fought. The LAST row is the Champion. */
  league: LeagueRow[];
  /**
   * Where the league stands, by stop name.
   *
   * Null is the shape a region whose league stop is missing from the generated
   * route would take. Making it representable keeps that from becoming a
   * module-load throw on somebody's machine.
   */
  leagueCity: string | null;
  /**
   * Which region's BLOCK `leagueCity` falls in. Not always `ko`.
   *
   * Johto's Elite Four is at 석영고원, which `src/journey.ts` files under 관동 —
   * stop 19, in front of every Johto gym. So Johto's league is reached on the
   * lap AFTER its badges are collected, which is what the games have you do
   * anyway, and which the panel has to say out loud rather than leave as a
   * five-week blank.
   */
  leagueIn: RegionKo;
  /**
   * What the panel calls this region's ladder.
   *
   * PRESENTATION ONLY. Galar has no Elite Four — it has a Champion Cup
   * semifinal ladder ending with Leon — and that difference is absorbed
   * entirely by `league.length`. If an `if (leagueKind === …)` ever appears in
   * `gyms.ts` or `hunt.ts`, the shape is wrong and this field is being used to
   * paper over it.
   */
  leagueKind: '사천왕' | '챔피언컵';
  /** What the badge shelf calls this region's gyms: `체육관`, `섬 시련`. */
  gymNoun: string;
};

/**
 * Every region with a campaign, in route order.
 *
 * One row today. The shape is what this release ships; the other eight are
 * data, added one commit at a time — and with a single row every derivation in
 * `server/gyms.ts` collapses to exactly the constant it replaced, which is how
 * the whole test suite stays green through the refactor.
 */
/**
 * 하나's eight, in ROUTE order — which here is also the games' own order.
 *
 * ## Black, not Black 2
 *
 * The first-version rule. It decides three things: 사간 holds 쌍용시티 (아이리스
 * has it in White), the Striaton gym is the trio rather than 체렌, and the two
 * badges 톡식 and 웨이브 do not exist here at all. That last one is why this
 * region's badge numbers are NOT contiguous — 33 34 35 37 38 39 40 41, skipping
 * 36 and 42, which belong to the two B2W2-only leaders. A per-region 1..8 index
 * could not express that; the global number can.
 *
 * ## The Striaton trio
 *
 * 성신시티 has three leaders — 덴트, 팟 and 콘 — and one badge between them. The
 * games send out whichever counters your starter, and this app has no starter.
 * So 덴트 is fixed, and said out loud rather than pretended away, exactly as
 * 그린's starter-dependent last three are in 관동's table.
 */
const UNOVA_GYMS: GymRow[] = [
  { id: 'cilan',   region: '하나', badge: 33, order: 1, ko: '덴트',   badgeKo: '트라이배지',   city: '성신시티',   sprite: 'cilan',   gender: 'm', grit: 2.88, prize: 526, team: [506, 511] },
  { id: 'lenora',  region: '하나', badge: 34, order: 2, ko: '알로에', badgeKo: '베이직배지',   city: '칠보시티',   sprite: 'lenora',  gender: 'f', grit: 3.00, prize: 514, team: [507, 505] },
  { id: 'burgh',   region: '하나', badge: 35, order: 3, ko: '아티',   badgeKo: '비틀배지',     city: '구름시티',   sprite: 'burgh',   gender: 'm', grit: 2.17, prize: 522, team: [544, 557, 542] },
  { id: 'elesa',   region: '하나', badge: 37, order: 4, ko: '카밀레', badgeKo: '볼트배지',     city: '뇌문시티',   sprite: 'elesa',   gender: 'f', grit: 2.18, prize: 521, team: [587, 587, 523] },
  { id: 'clay',    region: '하나', badge: 38, order: 5, ko: '야콘',   badgeKo: '퀘이크배지',   city: '물풍경시티', sprite: 'clay',    gender: 'm', grit: 2.38, prize: 523, team: [552, 536, 530] },
  { id: 'skyla',   region: '하나', badge: 39, order: 6, ko: '풍란',   badgeKo: '제트배지',     city: '궐수시티',   sprite: 'skyla',   gender: 'f', grit: 2.29, prize: 512, team: [528, 521, 581] },
  { id: 'brycen',  region: '하나', badge: 40, order: 7, ko: '담죽',   badgeKo: '아이시클배지', city: '설화시티',   sprite: 'brycen',  gender: 'm', grit: 2.27, prize: 524, team: [583, 615, 614] },
  { id: 'drayden', region: '하나', badge: 41, order: 8, ko: '사간',   badgeKo: '레전드배지',   city: '쌍용시티',   sprite: 'drayden', gender: 'm', grit: 1.82, prize: 525, team: [611, 621, 612] },
];

export const REGIONS: RegionRow[] = [
  {
    id: 'kanto',
    ko: '관동',
    gyms: KANTO_GYMS,
    league: KANTO_LEAGUE,
    leagueCity: '석영고원',
    leagueIn: '관동',
    leagueKind: '사천왕',
    gymNoun: '체육관',
  },
  {
    id: 'unova',
    ko: '하나',
    gyms: UNOVA_GYMS,
    /**
     * The ladder is NOT transcribed yet, and an empty array says exactly that.
     *
     * Not `leagueCity: null`, which is what a region with no league at all
     * would carry — 하나 has one, at 포켓몬 리그, and conflating "there is none"
     * with "we have not written it down" is the kind of quiet lie this table
     * exists to avoid. The panel reads the pair and says which it is.
     *
     * It is empty because the four names could not be verified. Every other
     * Korean string in this row was cross-checked against two sources; the
     * Elite Four's could not be, and the header's rule is that an unverified
     * name does not ship. There is a second question waiting behind it: Black's
     * league does not end with the champion at all — N is at the top of the
     * tower, and 노간주 comes after — so which five rows this should hold is a
     * content decision as much as a transcription.
     */
    league: [],
    leagueCity: '포켓몬 리그',
    leagueIn: '하나',
    leagueKind: '사천왕',
    gymNoun: '체육관',
  },
];

/**
 * Every badge number the table allocates.
 *
 * `server/store.ts` clamps the save against THIS rather than against a
 * literal, which is the whole reason that clamp never needs editing again: a
 * number the table does not allocate is not a badge, so the legal set widens
 * by a region landing and there is no second place to remember.
 *
 * ## The allocation, verified against the upstream sprites
 *
 * PokeAPI files badges as bare numbers under `badges/`, 1..77, "ordered by
 * region and then by gym" (`server/sprites.ts`). All seventy-seven were
 * downloaded and looked at rather than guessed, because a wrong number draws
 * another region's badge — which is worse than the blank slot a miss gives.
 *
 *   관동 1–8 · 성도 9–16 · 호연 17–24 · 신오 25–32 · 하나 33–42 ·
 *   칼로스 43–50 · 가라르 51–60 · 팔데아 70–77
 *
 * 61–69 are nine badges from outside the main series (the Orange Islands and
 * friends) and are not allocated here. 68 + 9 = 77 exactly.
 *
 * **하나 and 가라르 are ten, not eight, and not contiguous.** Both have gyms
 * whose leader differs by version, and the upstream list carries every
 * distinct badge:
 *
 *   하나 트리오 33 · 베이직 34 · 인섹트 35 · 톡식 36 · 볼트 37 · 퀘이크 38 ·
 *        제트 39 · 프리즈 40 · 레전드 41 · 웨이브 42
 *        → Black/White takes 33 34 35 37 38 39 40 41 (톡식 and 웨이브 are B2W2)
 *   가라르 풀 51 · 물 52 · 불꽃 53 · 격투 54 · 고스트 55 · 페어리 56 ·
 *        바위 57 · 얼음 58 · 악 59 · 드래곤 60
 *        → Sword takes 51 52 53 54 56 57 59 60 (고스트 and 얼음 are Shield)
 *
 * That is the case against keying badges by a per-region 1..8 index: two
 * regions cannot be expressed by one.
 *
 * **알로라 will take 78–81.** It has no badges at all — the island challenge
 * hands over Z-Crystals — so there is no upstream art and no upstream number.
 * The meaning of this column widens there to "the save key, of which 1..77 are
 * also the upstream filename". `ensureBadgeSprite` already returns null above
 * 77, and a miss draws the same empty slot an unearned badge draws.
 */
export const BADGE_IDS: ReadonlySet<number> = new Set(
  REGIONS.flatMap((r) => r.gyms.map((g) => g.badge)),
);

/**
 * The shortest ladder any region fields.
 *
 * `server/store.ts` floors `leagueBest` on it for a save that recorded a clear
 * without recording where. Derived because the number is not five everywhere:
 * Galar's Champion Cup is shorter, and a literal five would claim a depth that
 * region cannot reach.
 */
export const MIN_LEAGUE_SIZE: number = Math.min(...REGIONS.map((r) => r.league.length));
