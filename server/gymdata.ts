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
   * The four moves each of them actually carries, index-aligned with `team`.
   *
   * Optional, and absent means "not transcribed" rather than "none" — the
   * opponent then draws from everything its species can learn, which is what
   * every fight did before this column existed. That fallback is deliberate:
   * an invented moveset is worse than a generated one, and grit measured
   * against the generated pool stays valid until a real set lands.
   *
   * Index-aligned rather than keyed by species because a roster can hold the
   * same species twice with different sets — 카밀레 carries two 에몽가. The
   * length is checked against `team` at module load.
   */
  teamMoves?: number[][];
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
  /** The four each carries, index-aligned with `team`. See `GymRow.teamMoves`. */
  teamMoves?: number[][];
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

/**
 * 하나's Elite Four and its Champion, at 포켓몬 리그.
 *
 * ## Which battle this is
 *
 * The four are their **Black/White first battle** rosters, pre-National-Dex —
 * the same first-version rule the eight gyms above follow. The Champion is
 * **아이리스, from Black 2/White 2**, and that is a deliberate mix of versions
 * worth saying out loud: Black/White's tower does not end with a champion at
 * all. N sits at the top and 노간주 comes after him, and neither is a league
 * fight in any sense this app can stage — one is a story boss, the other an
 * epilogue. 아이리스 is the answer to "who is 하나's Champion" that the series
 * itself settled on, so she is the row, at her B2W2 initial-battle roster.
 *
 * Her Aggron is the plain species: Mega Aggron did not exist in Generation V.
 * 망초's Jellicent is the female form, which is a gender difference and not a
 * regional one — 593 either way. No legendary, no mythical, no paradox, no
 * regional form anywhere on the five rosters.
 *
 * ## Why some sets are shorter than four
 *
 * `teamMoves` holds what each one actually carries, and every member carries
 * four in the games. The arrays below are shorter wherever a move has no
 * machine in any version group, because `server/moves.ts` is exactly the
 * machine-learnable union and an id outside it does not exist to this app.
 * Eleven slots fall out that way — 섀도펀치, 모래뿌리기, 속이기, 야습(×2),
 * 폭기폭배, 태권당수, 암해머, 점프킥, 바디퍼지, 노래하다, 더블촙. Dropping the
 * slot is the honest form: the alternative is substituting a move the trainer
 * does not know, and then the table no longer says what it claims to say.
 *
 * Status and zero-power moves ARE kept here even though `poolFrom` filters
 * them out before the fight. This column is the transcription; deciding what
 * an opponent can swing with is the battle model's business, and keeping the
 * two separate means a later change to that filter needs no edit here.
 *
 * ## The grit column
 *
 * Measured, like 관동's, and against a bag of ~150 machines — what a save
 * actually holds by the time it walks past 쌍용시티, not the ~47 관동's column
 * was sized for. Four parties of six were run 400 runs each at every step:
 * 관동 starters clear about 60%, 하나 starters about 29%, a mixed late-game
 * six about 92%. Wide, and deliberately so — the transcribed sets are the
 * reason. Swapping this table's `teamMoves` out for the generated pools moves
 * those same four numbers by up to 28 points in either direction, because four
 * named moves have a type chart and a weighted draw from a whole learnset
 * averages it away. Who you bring now matters more than how big the bag is,
 * which is the point of transcribing them at all.
 */
const UNOVA_LEAGUE: LeagueRow[] = [
  {
    id: 'shauntal', region: '하나', ko: '사천왕 망초', sprite: 'shauntal', gender: 'f', grit: 1.68,
    team: [563, 593, 623, 609],
    teamMoves: [
      [94, 261, 247, 447],
      [247, 57, 412, 362],
      [174, 280, 89],
      [126, 94, 247, 371],
    ],
  },
  {
    id: 'grimsley', region: '하나', ko: '사천왕 플래리', sprite: 'grimsley', gender: 'm', grit: 1.74,
    team: [560, 553, 510, 625],
    teamMoves: [
      [242, 398, 280],
      [242, 337, 492, 89],
      [213, 332],
      [404, 232, 332],
    ],
  },
  {
    id: 'caitlin', region: '하나', ko: '사천왕 카를레아', sprite: 'caitlin', gender: 'f', grit: 1.79,
    team: [579, 518, 561, 576],
    teamMoves: [
      [412, 87, 411, 94],
      [115, 451, 247, 94],
      [247, 58, 403, 94],
      [347, 85, 247, 94],
    ],
  },
  {
    id: 'marshal', region: '하나', ko: '사천왕 연무', sprite: 'marshal', gender: 'm', grit: 1.85,
    team: [538, 539, 534, 620],
    teamMoves: [
      [444, 371, 523],
      [444, 447, 514],
      [444, 514, 447],
      [369, 157, 514],
    ],
  },
  {
    id: 'iris', region: '하나', ko: '챔피언 아이리스', sprite: 'iris', gender: 'f', grit: 1.90,
    team: [635, 621, 567, 306, 131, 612],
    teamMoves: [
      [53, 451, 406, 57],
      [157, 53, 525, 411],
      [512, 157, 337, 283],
      [89, 38, 157],
      [57, 58, 85],
      [89, 404, 349],
    ],
  },
];

/**
 * 성도's eight, from Gold/Silver.
 *
 * ## 담청 and 진청, which is which
 *
 * The pair that the badge tables and the gym tables disagree about, so it is
 * settled here off the route rather than off a wiki: stop 96 is 담청등대, and
 * the lighthouse with the sick Ampharos in it is Olivine's. 담청시티 is
 * therefore Olivine, 규리 is its steel leader, and 진청시티 is Cianwood with
 * 사도 in it. The two Korean names are near-homographs and every secondary
 * source this was checked against had them one way or the other, so the
 * tiebreak is a stop nobody had a reason to get wrong.
 *
 * They also swap the way 관동's 초련 and 독수 do — 담청 is stop 70 and 진청 is
 * 71, while the games number 사도's badge before 규리's. `badge` keeps the
 * games' numbering and `order` follows the road, which is exactly the pair
 * those two fields exist for.
 *
 * In the games 규리's gym is shut until 사도 is beaten, because she is at the
 * lighthouse. Not modelled: `lateLock` means "shut until the rest of the
 * region is done", which is 비주기's shape and not hers, and a one-gym
 * exception would cost more than the flavour is worth.
 */
const JOHTO_GYMS: GymRow[] = [
  { id: 'falkner', region: '성도', badge:  9, order: 1, ko: '비상', badgeKo: '윙배지',     city: '도라지시티', sprite: 'falkner', gender: 'm', grit: 2.67, prize: 189, team: [16, 17] },
  { id: 'bugsy',   region: '성도', badge: 10, order: 2, ko: '호일', badgeKo: '인섹트배지', city: '고동마을',   sprite: 'bugsy',   gender: 'm', grit: 1.96, prize: 210, team: [11, 14, 123] },
  { id: 'whitney', region: '성도', badge: 11, order: 3, ko: '꼭두', badgeKo: '레귤러배지', city: '금빛시티',   sprite: 'whitney', gender: 'f', grit: 2.24, prize: 213, team: [35, 241] },
  { id: 'morty',   region: '성도', badge: 12, order: 4, ko: '유빈', badgeKo: '팬텀배지',   city: '인주시티',   sprite: 'morty',   gender: 'm', grit: 1.35, prize: 247, team: [92, 93, 93, 94] },
  { id: 'jasmine', region: '성도', badge: 14, order: 5, ko: '규리', badgeKo: '스틸배지',   city: '담청시티',   sprite: 'jasmine', gender: 'f', grit: 1.78, prize: 231, team: [81, 81, 208] },
  { id: 'chuck',   region: '성도', badge: 13, order: 6, ko: '사도', badgeKo: '쇼크배지',   city: '진청시티',   sprite: 'chuck',   gender: 'm', grit: 2.65, prize: 223, team: [57, 62] },
  { id: 'pryce',   region: '성도', badge: 15, order: 7, ko: '류옹', badgeKo: '아이스배지', city: '황토마을',   sprite: 'pryce',   gender: 'm', grit: 2.34, prize: 196, team: [86, 87, 221] },
  { id: 'clair',   region: '성도', badge: 16, order: 8, ko: '이향', badgeKo: '라이징배지', city: '검은먹시티', sprite: 'clair',   gender: 'f', grit: 1.59, prize: 225, team: [148, 148, 148, 230] },
];

/**
 * 성도's Elite Four and its Champion — at 관동's 석영고원, which is the point.
 *
 * Johto's league is Indigo Plateau. Not a lookalike and not a second building:
 * the same plateau 관동's four sit in, which is why `leagueIn` exists as a
 * field separate from `ko`. Two regions' ladders stand at stop 19 and
 * `leagueAt` already picks between them — first eligible and uncleared, so
 * 관동's is fought first and 성도's on a later pass.
 *
 * The cost is a long walk, and it is worth stating rather than discovering.
 * 검은먹시티 is stop 75 and the plateau is stop 19, so the eighth badge and the
 * ladder are most of a lap apart — the pet walks 호연 through 팔데아 and comes
 * back round. That is not dead time, it is the other regions' gyms, but the
 * badge case will read "8 / 8" for a long while before the ladder opens.
 *
 * 독수 is 관동's 연분홍 leader and 시바 is 관동's Elite Four, so both take the
 * `-e4` suffix the header describes, and 목호 takes `-c` for the same reason —
 * he is 관동's fourth and 성도's Champion. They keep their 관동 sprite slugs:
 * one person, one face.
 *
 * The walk is also what the grit column is measured against. By the time the
 * pet is back at the plateau its bag has saturated — every draw is a repeat —
 * so this ladder is faced with a party holding its four best moves outright,
 * not the ~47 machines 관동's column was sized for. Four parties of six, 300
 * runs each: 24% to 75%, which puts it between 관동's ladder and 하나's. The
 * response to grit here is steep — a 6% raise across the column takes the
 * whole band under 25% — because twenty-six opponents compound.
 */
const JOHTO_LEAGUE: LeagueRow[] = [
  { id: 'will',     region: '성도', ko: '사천왕 일목', sprite: 'will',  gender: 'm', grit: 1.65, team: [178, 124, 103, 80, 178] },
  { id: 'koga-e4',  region: '성도', ko: '사천왕 독수', sprite: 'koga',  gender: 'm', grit: 1.70, team: [168, 49, 205, 89, 169] },
  { id: 'bruno-e4', region: '성도', ko: '사천왕 시바', sprite: 'bruno', gender: 'm', grit: 1.75, team: [237, 106, 107, 95, 68] },
  { id: 'karen',    region: '성도', ko: '사천왕 카렌', sprite: 'karen', gender: 'f', grit: 1.80, team: [197, 45, 94, 198, 229] },
  { id: 'lance-c',  region: '성도', ko: '챔피언 목호', sprite: 'lance', gender: 'm', grit: 1.85, team: [130, 149, 149, 142, 6, 149] },
];

/**
 * 신오's eight, from Diamond/Pearl.
 *
 * ## The Korean names, and why three of them were nearly wrong
 *
 * 신오's leaders are named after plants, and the Korean release keeps the
 * joke: 유채 is rapeseed (ナタネ), 동관 is wax gourd (トウガン), 무청 is turnip
 * greens (スズナ), and 자두 is a plum — which is 스모모, Maylene. A first pass
 * had 자두 on Volkner, 맥실러 on Maylene and 전진 on Crasher Wake, all three
 * shifted by the same column slip. Each was checked against its own
 * Bulbapedia page in the end, and the plant etymology is what makes the
 * corrected column self-evidently right.
 *
 * `badge` follows the games and `order` follows the road, and here they
 * disagree five times out of eight — the generated route reaches 운하 and
 * 들판 and 물가 early and leaves 연고, 장막 and 선단 for a later arc, while the
 * games number them 3, 4, 5, 6, 7, 8 in a different sequence entirely.
 */
const SINNOH_GYMS: GymRow[] = [
  { id: 'roark',       region: '신오', badge: 25, order: 1, ko: '강석',   badgeKo: '콜배지',       city: '무쇠시티', sprite: 'roark',       gender: 'm', grit: 2.00, prize: 446, team: [74, 95, 408] },
  { id: 'gardenia',    region: '신오', badge: 26, order: 2, ko: '유채',   badgeKo: '포레스트배지', city: '영원시티', sprite: 'gardenia',    gender: 'f', grit: 2.18, prize: 447, team: [420, 387, 407] },
  { id: 'byron',       region: '신오', badge: 30, order: 3, ko: '동관',   badgeKo: '마인배지',     city: '운하시티', sprite: 'byron',       gender: 'm', grit: 1.71, prize: 430, team: [82, 208, 411] },
  { id: 'crasherwake', region: '신오', badge: 28, order: 4, ko: '맥실러', badgeKo: '펜배지',       city: '들판시티', sprite: 'crasherwake', gender: 'm', grit: 2.31, prize: 362, team: [130, 195, 419] },
  { id: 'volkner',     region: '신오', badge: 32, order: 5, ko: '전진',   badgeKo: '비컨배지',     city: '물가시티', sprite: 'volkner',     gender: 'm', grit: 1.84, prize: 451, team: [26, 424, 224, 405] },
  { id: 'fantina',     region: '신오', badge: 29, order: 6, ko: '멜리사', badgeKo: '레릭배지',     city: '연고시티', sprite: 'fantina',     gender: 'f', grit: 1.35, prize: 421, team: [355, 93, 429] },
  { id: 'maylene',     region: '신오', badge: 27, order: 7, ko: '자두',   badgeKo: '코블배지',     city: '장막시티', sprite: 'maylene',     gender: 'f', grit: 1.98, prize: 409, team: [307, 67, 448] },
  { id: 'candice',     region: '신오', badge: 31, order: 8, ko: '무청',   badgeKo: '글레이셔배지', city: '선단시티', sprite: 'candice',     gender: 'f', grit: 1.93, prize: 419, team: [215, 308, 459, 460] },
];

/**
 * 신오's Elite Four and 난천, from Diamond/Pearl.
 *
 * Measured against a saturated bag for the same reason 성도's is: the route
 * puts 신오's plateau at stop 175 and its last three gym cities at 204-206, so
 * the eighth badge lands after the ladder has already gone past and the pet
 * comes round again. 24% to 69% across four parties.
 */
const SINNOH_LEAGUE: LeagueRow[] = [
  { id: 'aaron',   region: '신오', ko: '사천왕 충호',   sprite: 'aaron',   gender: 'm', grit: 1.71, team: [269, 267, 416, 214, 452] },
  { id: 'bertha',  region: '신오', ko: '사천왕 들국화', sprite: 'bertha',  gender: 'f', grit: 1.77, team: [195, 185, 76, 340, 450] },
  { id: 'flint',   region: '신오', ko: '사천왕 대엽',   sprite: 'flint',   gender: 'm', grit: 1.82, team: [78, 208, 426, 428, 392] },
  { id: 'lucian',  region: '신오', ko: '사천왕 오엽',   sprite: 'lucian',  gender: 'm', grit: 1.87, team: [122, 203, 308, 65, 437] },
  { id: 'cynthia', region: '신오', ko: '챔피언 난천',   sprite: 'cynthia', gender: 'f', grit: 1.93, team: [442, 407, 423, 448, 350, 445] },
];

/**
 * 칼로스's eight, from X/Y.
 *
 * The one region where the badge Korean names are transparent rather than
 * invented — 버그, 월, 파이트, 플랜트, 볼티지, 페어리, 사이킥, 아이스버그 — so
 * the risk here was the leaders, not the badges. 우르프 in particular: a
 * summarised source returned "Lysandre" for him once, which is a different
 * character entirely, so his slug was checked against the sprite directory
 * like every other.
 */
const KALOS_GYMS: GymRow[] = [
  { id: 'viola',   region: '칼로스', badge: 43, order: 1, ko: '비올라', badgeKo: '버그배지',       city: '백단시티', sprite: 'viola',   gender: 'f', grit: 2.76, prize: 611, team: [283, 666] },
  { id: 'clemont', region: '칼로스', badge: 47, order: 2, ko: '시트론', badgeKo: '볼티지배지',     city: '미르시티', sprite: 'clemont', gender: 'm', grit: 2.22, prize:  85, team: [587, 82, 695] },
  { id: 'grant',   region: '칼로스', badge: 44, order: 3, ko: '자크로', badgeKo: '월배지',         city: '삼채시티', sprite: 'grant',   gender: 'm', grit: 2.41, prize: 317, team: [698, 696] },
  { id: 'korrina', region: '칼로스', badge: 45, order: 4, ko: '코르니', badgeKo: '파이트배지',     city: '사라시티', sprite: 'korrina', gender: 'f', grit: 2.05, prize: 612, team: [619, 67, 701] },
  { id: 'ramos',   region: '칼로스', badge: 46, order: 5, ko: '후쿠지', badgeKo: '플랜트배지',     city: '비익시티', sprite: 'ramos',   gender: 'm', grit: 2.29, prize: 447, team: [189, 70, 673] },
  { id: 'valerie', region: '칼로스', badge: 48, order: 6, ko: '마슈',   badgeKo: '페어리배지',     city: '후늬시티', sprite: 'valerie', gender: 'f', grit: 1.81, prize: 605, team: [303, 122, 700] },
  { id: 'olympia', region: '칼로스', badge: 49, order: 7, ko: '고지카', badgeKo: '사이킥배지',     city: '향전시티', sprite: 'olympia', gender: 'f', grit: 2.06, prize: 347, team: [561, 199, 678] },
  { id: 'wulfric', region: '칼로스', badge: 50, order: 8, ko: '우르프', badgeKo: '아이스버그배지', city: '이설시티', sprite: 'wulfric', gender: 'm', grit: 2.29, prize:  58, team: [460, 615, 713] },
];

/**
 * 칼로스's Elite Four and 카르네, from X/Y.
 *
 * The games let you fight the four in any order — the plateau opens all four
 * doors at once. Fixed here in Bulbapedia's listing order, because a ladder
 * this app settles has to be a sequence, and a rung that moved would move the
 * seeds under it.
 *
 * Measured at 23% to 81% across four parties, against the ~230-machine bag
 * this ladder is actually reached with.
 */
const KALOS_LEAGUE: LeagueRow[] = [
  { id: 'malva',    region: '칼로스', ko: '사천왕 파키라',  sprite: 'malva',    gender: 'f', grit: 1.68, team: [668, 324, 609, 663] },
  { id: 'siebold',  region: '칼로스', ko: '사천왕 즈미',    sprite: 'siebold',  gender: 'm', grit: 1.73, team: [693, 130, 121, 689] },
  { id: 'wikstrom', region: '칼로스', ko: '사천왕 간피',    sprite: 'wikstrom', gender: 'm', grit: 1.79, team: [707, 476, 212, 681] },
  { id: 'drasna',   region: '칼로스', ko: '사천왕 드라세나', sprite: 'drasna',   gender: 'f', grit: 1.84, team: [691, 621, 334, 715] },
  { id: 'diantha',  region: '칼로스', ko: '챔피언 카르네',  sprite: 'diantha',  gender: 'f', grit: 1.89, team: [701, 697, 699, 711, 706, 282] },
];

/**
 * 호연's eight, from Ruby/Sapphire.
 *
 * ## 윤진 is a leader here, not a champion
 *
 * He is 루네시티's water leader in Ruby and Sapphire and the Champion in
 * Emerald, with 아단 taking the gym. First-version is this table's rule
 * everywhere, so he is the eighth leader and 성호 is the Champion. Written
 * down because it is the entry most likely to be read as a bug.
 *
 * ## 풍&란 are two people and one row
 *
 * 이끼시티's gym is a double battle against a brother and sister, and they
 * field two Pokemon between them — the smallest team on the whole roster. Grit
 * carries the difference: it is per Pokemon, so a short team means each one is
 * very hard, which is the right shape for a gym that only ever sends two.
 * `gender` has to be one letter and is cosmetic for a named row whose sprite
 * is explicit, so it says 'f' and means nothing.
 *
 * The art is the `-gen3` variant throughout, which is the art these teams
 * come from. Three of them have no plain slug at all.
 */
const HOENN_GYMS: GymRow[] = [
  { id: 'norman',     region: '호연', badge: 21, order: 1, ko: '종길',  badgeKo: '밸런스배지',  city: '등화도시',   sprite: 'norman-gen3',      gender: 'm', grit: 2.25, prize: 263, team: [289, 288, 289] },
  { id: 'tateliza',   region: '호연', badge: 23, order: 2, ko: '풍&란', badgeKo: '마인드배지',  city: '이끼시티',   sprite: 'tateandliza-gen3', gender: 'f', grit: 1.94, prize: 347, team: [338, 337] },
  { id: 'wallace',    region: '호연', badge: 24, order: 3, ko: '윤진',  badgeKo: '레인배지',    city: '루네시티',   sprite: 'wallace-gen3',     gender: 'm', grit: 1.93, prize: 352, team: [370, 340, 364, 119, 350] },
  { id: 'brawly',     region: '호연', badge: 18, order: 4, ko: '철구',  badgeKo: '너클배지',    city: '무로마을',   sprite: 'brawly-gen3',      gender: 'm', grit: 1.99, prize: 339, team: [66, 307, 296] },
  { id: 'flannery',   region: '호연', badge: 20, order: 5, ko: '민지',  badgeKo: '히트배지',    city: '용암마을',   sprite: 'flannery-gen3',    gender: 'f', grit: 1.99, prize: 315, team: [218, 218, 324] },
  { id: 'wattson',    region: '호연', badge: 19, order: 6, ko: '암페어', badgeKo: '다이나모배지', city: '보라시티',   sprite: 'wattson-gen3',     gender: 'm', grit: 1.94, prize: 351, team: [81, 100, 82] },
  { id: 'roxanne',    region: '호연', badge: 17, order: 7, ko: '원규',  badgeKo: '스톤배지',    city: '금탄도시',   sprite: 'roxanne-gen3',     gender: 'f', grit: 2.29, prize: 317, team: [74, 74, 299] },
  { id: 'winona',     region: '호연', badge: 22, order: 8, ko: '은송',  badgeKo: '깃털배지',    city: '검방울시티', sprite: 'winona-gen3',      gender: 'f', grit: 1.72, prize: 332, team: [277, 279, 227, 334] },
];

/**
 * 호연's Elite Four and 성호, from Ruby/Sapphire.
 *
 * Bulbapedia gives his Korean name in full as 나성호. The games print the
 * given name in battle, and every other row here is a given name, so 성호 is
 * what the message box says and the surname is recorded in this comment
 * rather than in the string.
 *
 * Measured at 21% to 73% across four parties, against the ~85-machine bag this
 * ladder is reached with.
 */
const HOENN_LEAGUE: LeagueRow[] = [
  { id: 'sidney', region: '호연', ko: '사천왕 혁진', sprite: 'sidney-gen3', gender: 'm', grit: 1.68, team: [262, 275, 332, 342, 359] },
  { id: 'phoebe', region: '호연', ko: '사천왕 회연', sprite: 'phoebe-gen3', gender: 'f', grit: 1.73, team: [356, 354, 354, 302, 356] },
  { id: 'glacia', region: '호연', ko: '사천왕 미혜', sprite: 'glacia-gen3', gender: 'f', grit: 1.79, team: [364, 364, 362, 362, 365] },
  { id: 'drake',  region: '호연', ko: '사천왕 권수', sprite: 'drake-gen3',  gender: 'm', grit: 1.84, team: [372, 334, 230, 330, 373] },
  { id: 'steven', region: '호연', ko: '챔피언 성호', sprite: 'steven-gen3', gender: 'm', grit: 1.89, team: [227, 344, 306, 346, 348, 376] },
];

/**
 * 팔데아's eight, from Scarlet/Violet.
 *
 * ## The badges have no names
 *
 * Every other region's `badgeKo` is a proper noun the games invented. 팔데아's
 * are not: the games give eight badges and call them by type, so 벌레배지 and
 * 노말배지 are not a shorthand this table made up for want of a real name —
 * they are the name. Said here because a reader who knows 관동's 회색배지 will
 * assume the opposite.
 *
 * ## 청목 is here twice
 *
 * He is 참푸르's normal leader AND 팔데아's flying Elite Four, which is the
 * first time one person holds both jobs in the same region. The league row
 * takes the `-e4` suffix the header describes and both rows carry the same
 * sprite slug, because Showdown has exactly one 청목 and one face is correct.
 *
 * The games let the eight be taken in any order. `order` follows the road, as
 * everywhere else.
 */
const PALDEA_GYMS: GymRow[] = [
  { id: 'katy',     region: '팔데아', badge: 70, order: 1, ko: '단풍',   badgeKo: '벌레배지',   city: '세르클마을', sprite: 'katy',     gender: 'f', grit: 2.41, prize: 884, team: [915, 917, 216] },
  { id: 'tulip',    region: '팔데아', badge: 76, order: 2, ko: '리파',   badgeKo: '에스퍼배지', city: '베이크마을', sprite: 'tulip',    gender: 'f', grit: 1.82, prize:  94, team: [981, 282, 956, 671] },
  { id: 'brassius', region: '팔데아', badge: 71, order: 3, ko: '콜사',   badgeKo: '풀배지',     city: '보울마을',   sprite: 'brassius', gender: 'm', grit: 2.53, prize: 885, team: [548, 928, 185] },
  { id: 'iono',     region: '팔데아', badge: 72, order: 4, ko: '모야모', badgeKo: '전기배지',   city: '누룩스시티', sprite: 'iono',     gender: 'f', grit: 1.59, prize: 521, team: [940, 939, 404, 429] },
  { id: 'kofu',     region: '팔데아', badge: 73, order: 5, ko: '곤포',   badgeKo: '물배지',     city: '카라프시티', sprite: 'kofu',     gender: 'm', grit: 2.29, prize: 886, team: [976, 961, 740] },
  { id: 'larry',    region: '팔데아', badge: 74, order: 6, ko: '청목',   badgeKo: '노말배지',   city: '참푸르마을', sprite: 'larry',    gender: 'm', grit: 2.36, prize: 263, team: [775, 982, 398] },
  { id: 'ryme',     region: '팔데아', badge: 75, order: 7, ko: '라임',   badgeKo: '고스트배지', city: '프리지마을', sprite: 'ryme',     gender: 'f', grit: 1.12, prize: 247, team: [778, 354, 972, 849] },
  { id: 'grusha',   region: '팔데아', badge: 77, order: 8, ko: '그루샤', badgeKo: '얼음배지',   city: '나페산',     sprite: 'grusha',   gender: 'm', grit: 2.08, prize: 861, team: [873, 614, 975, 334] },
];

/**
 * 팔데아's Elite Four and 테사, from Scarlet/Violet.
 *
 * 청목 fights his ladder round with a flying team and his gym round with a
 * normal one, which is the games' own joke and needs no note beyond the two
 * rows sharing a face.
 *
 * The grit column is the highest on the roster, and 팔데아's position on the
 * route is why. 나페산 is stop 689 and the plateau is 650, so the eighth badge
 * lands after the ladder has already gone past and the pet comes round with a
 * bag that saturated long ago. Measured at 25% to 79% across four parties.
 */
const PALDEA_LEAGUE: LeagueRow[] = [
  { id: 'rika',      region: '팔데아', ko: '사천왕 칠리',  sprite: 'rika',   gender: 'f', grit: 1.81, team: [340, 323, 232, 51, 980] },
  { id: 'poppy',     region: '팔데아', ko: '사천왕 뽀삐',  sprite: 'poppy',  gender: 'f', grit: 1.86, team: [879, 437, 823, 958, 959] },
  { id: 'larry-e4',  region: '팔데아', ko: '사천왕 청목',  sprite: 'larry',  gender: 'm', grit: 1.92, team: [357, 398, 334, 741, 973] },
  { id: 'hassel',    region: '팔데아', ko: '사천왕 팔자크', sprite: 'hassel', gender: 'm', grit: 1.98, team: [715, 691, 841, 612, 998] },
  { id: 'geeta',     region: '팔데아', ko: '챔피언 테사',  sprite: 'geeta',  gender: 'f', grit: 2.03, team: [956, 713, 983, 976, 673, 970] },
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
    id: 'johto',
    ko: '성도',
    gyms: JOHTO_GYMS,
    league: JOHTO_LEAGUE,
    leagueCity: '석영고원',
    leagueIn: '관동',
    leagueKind: '사천왕',
    gymNoun: '체육관',
  },
  {
    id: 'sinnoh',
    ko: '신오',
    gyms: SINNOH_GYMS,
    league: SINNOH_LEAGUE,
    leagueCity: '포켓몬 리그',
    leagueIn: '신오',
    leagueKind: '사천왕',
    gymNoun: '체육관',
  },
  {
    id: 'kalos',
    ko: '칼로스',
    gyms: KALOS_GYMS,
    league: KALOS_LEAGUE,
    leagueCity: '포켓몬리그',
    leagueIn: '칼로스',
    leagueKind: '사천왕',
    gymNoun: '체육관',
  },
  {
    id: 'hoenn',
    ko: '호연',
    gyms: HOENN_GYMS,
    league: HOENN_LEAGUE,
    leagueCity: '포켓몬리그',
    leagueIn: '호연',
    leagueKind: '사천왕',
    gymNoun: '체육관',
  },
  {
    id: 'paldea',
    ko: '팔데아',
    gyms: PALDEA_GYMS,
    league: PALDEA_LEAGUE,
    leagueCity: '포켓몬 리그',
    leagueIn: '팔데아',
    leagueKind: '사천왕',
    gymNoun: '체육관',
  },
  {
    id: 'unova',
    ko: '하나',
    gyms: UNOVA_GYMS,
    league: UNOVA_LEAGUE,
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
