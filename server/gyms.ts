import { LEG_LENGTH, STOPS } from '../src/journey.ts';
import { rarityOfSpecies } from './dex.ts';
import type { PartyMember } from './game.ts';
import { BATTLE_MAX_HP, TACKLE, battleAt, type Battle, type BattleOpts } from './hunt.ts';
import { TRAINER_ROUND_TURNS, type Gender, type Trainer } from './trainer.ts';

/**
 * Counter damage per turn in a league round, as a share of one party bar.
 *
 * The trainer share (0.085) unchanged. It is named separately only so the two
 * can be tuned apart later without one silently moving the other — the league
 * is twenty-six opponents against six bars, where the gyms are five against
 * one, and they will not stay balanced by the same number for ever.
 */
const LEAGUE_COUNTER_SHARE = 0.085;

/**
 * The Kanto gym leaders, their badges, and when they stand in the way.
 *
 * ── What this file is ─────────────────────────────────────────────────────
 * The third hand-written table in this project, beside `server/trainer.ts`'s
 * classes and `server/legends.ts`'s gates. PokeAPI carries no trainer data and
 * no badge text at all, so every row below was transcribed by hand.
 *
 * Pure in `seq` AND in the table, exactly as `trainerAt` is — and unlike it,
 * pure without taking a single draw. A leader's team is literal, so nothing
 * here is rolled; the only randomness in a gym fight lives inside `battleAt`,
 * on the salt it already had. That is why adding this file cannot shift the
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
 * One trap for whoever adds Johto: **독수 is a Kanto gym leader here and a
 * Johto Elite Four member in the games.** It is the same person, not a name
 * free to reuse.
 *
 * ## The art
 *
 * Each row carries a Showdown trainer slug that `ensureNpcSprite` resolves and
 * a badge NUMBER that `ensureBadgeSprite` resolves — the same host, the same
 * fetch-and-cache rule, and the same absolute rule as everything else here:
 * never committed, never bundled. See NOTICE.md.
 */

export type GymRow = {
  /**
   * Permanent key. Written onto the log entry, so renaming one severs every
   * past record that mentions it.
   */
  id: string;
  /**
   * The badge, 1..8 in the games' own numbering — which is also its index in
   * PokeAPI's `sprites/badges/`, so this one number is the sprite, the save
   * key and the display order all at once.
   */
  badge: number;
  /**
   * Challenge order, 1..8. NOT the same as `badge`.
   *
   * The journey walks Kanto geographically and 노랑시티 (stop 13) comes before
   * 연분홍시티 (stop 14), so 초련 is met fifth and 독수 sixth while their
   * badges stay numbered 6 and 5. The games permit exactly this — Soul and
   * Marsh may be taken in either order — and the numbering is a listing
   * convention, not a sequence.
   */
  order: number;
  /** Official localisation. See the header. */
  ko: string;
  badgeKo: string;
  /**
   * The city, by the Korean name `src/journey.ts` spells it with.
   *
   * A NAME, not an index. journey.ts is generated from PokeAPI, and a
   * regenerated route that inserts one stop would silently move every gym in
   * the region. Resolved to an index once at module load; a name the route no
   * longer carries throws there rather than quietly pointing at 달맞이산.
   */
  city: string;
  /** Showdown trainer slug, i.e. what `ensureNpcSprite` takes. Never a filename. */
  sprite: string;
  gender: Gender;
  /** The Red/Green/Blue team, entire. Nothing is trimmed for balance. */
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
};

/**
 * The roster, in challenge order.
 *
 * Levels are dropped on purpose: this game has none. What survives from the
 * source is WHICH Pokemon, which is the half the type chart reads.
 */
export const GYMS: GymRow[] = [
  { id: 'brock',    badge: 1, order: 1, ko: '웅',     badgeKo: '회색배지',   city: '회색시티',   sprite: 'brock',    gender: 'm', grit: 1.95, prize: 317, team: [74, 95] },
  { id: 'misty',    badge: 2, order: 2, ko: '이슬',   badgeKo: '블루배지',   city: '블루시티',   sprite: 'misty',    gender: 'f', grit: 2.15, prize: 352, team: [120, 121] },
  { id: 'surge',    badge: 3, order: 3, ko: '마티스', badgeKo: '오렌지배지', city: '갈색시티',   sprite: 'ltsurge',  gender: 'm', grit: 1.50, prize: 351, team: [100, 25, 26] },
  { id: 'erika',    badge: 4, order: 4, ko: '민화',   badgeKo: '무지개배지', city: '무지개시티', sprite: 'erika',    gender: 'f', grit: 1.75, prize: 202, team: [71, 114, 45] },
  { id: 'sabrina',  badge: 6, order: 5, ko: '초련',   badgeKo: '골드배지',   city: '노랑시티',   sprite: 'sabrina',  gender: 'f', grit: 1.56, prize: 347, team: [64, 122, 49, 65] },
  { id: 'koga',     badge: 5, order: 6, ko: '독수',   badgeKo: '핑크배지',   city: '연분홍시티', sprite: 'koga',     gender: 'm', grit: 1.62, prize: 92,  team: [109, 89, 109, 110] },
  { id: 'blaine',   badge: 7, order: 7, ko: '강연',   badgeKo: '진홍색배지', city: '홍련섬',     sprite: 'blaine',   gender: 'm', grit: 1.82, prize: 126, team: [58, 77, 78, 59] },
  { id: 'giovanni', badge: 8, order: 8, ko: '비주기', badgeKo: '그린배지',   city: '상록시티',   sprite: 'giovanni', gender: 'm', grit: 1.72, prize: 89,  team: [111, 51, 31, 34, 112] },
];

/**
 * Where in a leg a challenge falls. Three of them, twenty-five minutes apart.
 *
 * One shot per visit would make a loss cost a whole lap — five weeks of
 * continuous uptime, and a good deal more at a realistic eight hours a day.
 * Three keeps the cost of losing at an afternoon while leaving it a real cost.
 *
 * Sized to `LEG_LENGTH`, which is fifteen. They were 3/11/19 when a leg was
 * twenty-five encounters long, and the last of the three simply stopped
 * happening when the route grew and the leg shrank — a leader you could only
 * challenge twice, with nothing on screen to say so. `test/gyms.test.ts`
 * asserts the count for exactly that reason.
 */
export const GYM_OFFSETS = [2, 7, 12] as const;

/** A beaten leader offers one rematch per visit, at his own city. */
export const REMATCH_OFFSET = 2;

/** What a gym win pays, over the ordinary trainer formula. */
export const GYM_BONUS = 2;

/** Resolved once, from the name. A city the route no longer carries is a bug, not a fallback. */
const STOP_OF = new Map<string, number>(
  GYMS.map((g) => {
    const i = STOPS.findIndex((s) => s.ko === g.city);
    if (i < 0) throw new Error(`gyms.ts: ${g.city} is not on the journey`);
    return [g.id, i];
  }),
);

/** The Kanto stretch of the route, derived rather than written down. */
const KANTO_FIRST = STOPS.findIndex((s) => s.region === '관동');
const KANTO_LAST = STOPS.reduce((last, s, i) => (s.region === '관동' ? i : last), -1);

const BY_ORDER = [...GYMS].sort((a, b) => a.order - b.order);
const BY_ID = new Map(GYMS.map((g) => [g.id, g]));
const BY_STOP = new Map(GYMS.map((g) => [STOP_OF.get(g.id)!, g]));

export function gymById(id: string): GymRow | null {
  return BY_ID.get(id) ?? null;
}

/** The stop INDEX, where `journeyFor` answers with the Stop itself. */
export function stopIndexOf(seq: number): number {
  const n = Number.isFinite(seq) ? Math.max(0, Math.floor(seq)) : 0;
  return Math.floor(n / LEG_LENGTH) % STOPS.length;
}

/**
 * The leader standing in the way right now, or null.
 *
 * The lowest-order leader who is eligible, unbeaten, and whose city is at or
 * behind the current stop. The last clause is what turns a fixed appointment
 * into a pursuit: 비주기's gym is the second stop in Kanto and he is the eighth
 * challenge, so without it the Earth Badge would always be a lap away. He
 * catches up instead, which is what the games have him do anyway — 상록체육관
 * is shut while you walk past it and opens once you hold the other seven.
 *
 * Eligibility is one rule, not eight: a leader of order N wants N-1 badges.
 * That is the games' Viridian lock generalised, and it costs nothing on the
 * other seven because the standing leader is by construction the lowest
 * unbeaten one.
 */
export function standingGym(seq: number, badges: ReadonlySet<number>): GymRow | null {
  const stop = stopIndexOf(seq);
  if (stop < KANTO_FIRST || stop > KANTO_LAST) return null;
  for (const g of BY_ORDER) {
    if (badges.has(g.badge)) continue;
    // Not enough badges for this one, and everyone before is beaten: nobody stands.
    if (badges.size < g.order - 1) return null;
    return STOP_OF.get(g.id)! <= stop ? g : null;
  }
  return null;
}

/**
 * Is `seq` a gym challenge, and against whom?
 *
 * Pure in `(seq, badges)` and takes no draw at all — the whole reason this file
 * needs no RNG salt of its own.
 *
 * A pending leader outranks a rematch, so a leg never offers two named fights.
 */
export function gymAt(seq: number, badges: ReadonlySet<number>): GymRow | null {
  const off = ((Math.max(0, Math.floor(seq)) % LEG_LENGTH) + LEG_LENGTH) % LEG_LENGTH;
  const stop = stopIndexOf(seq);
  if (stop < KANTO_FIRST || stop > KANTO_LAST) return null;

  const standing = standingGym(seq, badges);
  if (standing) return GYM_OFFSETS.includes(off as (typeof GYM_OFFSETS)[number]) ? standing : null;

  // Nobody is pending, so a leader whose badge is already held will spar.
  if (off !== REMATCH_OFFSET) return null;
  const home = BY_STOP.get(stop);
  return home && badges.has(home.badge) ? home : null;
}

/**
 * A leader as a `Trainer`, so the battle, the scene and the panel's replay all
 * work with no changes at all.
 *
 * `관장` rather than the city: `회색시티 관장 웅` is eleven characters exactly,
 * and `test/trainer.test.ts` caps names at eleven because `rewardPages` builds
 * one-row lines on it. Sitting on the boundary is not a margin. The city has
 * room on the badge case and the log row instead.
 */
export function gymTrainer(row: GymRow): Trainer {
  return {
    className: '관장',
    name: `관장 ${row.ko}`,
    gender: row.gender,
    sprite: row.sprite,
    team: row.team,
    grit: row.grit,
  };
}

/**
 * Is this gym shut for want of badges?
 *
 * True for 비주기 until the other seven are held, and never for anyone else —
 * the eligibility rule is `order - 1` badges and the standing leader is always
 * the lowest unbeaten one, so nobody but the eighth can ever be short.
 * The badge case says so rather than leaving a blank slot unexplained.
 */
export function gymLocked(row: GymRow, badges: ReadonlySet<number>): boolean {
  return !badges.has(row.badge) && badges.size < row.order - 1;
}

/**
 * Encounters until the pet next stands in `city`, or 0 if it is there now.
 *
 * What turns waiting into something to read. The badge case draws "연분홍시티
 * 까지 40조우" from this, which is the same job the egg gauge and every
 * achievement bar already do — and the honest answer for someone who installed
 * this update while walking through 칼로스 is a number, not a blank.
 */
export function encountersUntilStop(huntCount: number, city: string): number {
  const target = STOPS.findIndex((s) => s.ko === city);
  if (target < 0) return 0;
  const n = Number.isFinite(huntCount) ? Math.max(0, Math.floor(huntCount)) : 0;
  const legs = (target - stopIndexOf(n) + STOPS.length) % STOPS.length;
  return legs === 0 ? 0 : legs * LEG_LENGTH - (n % LEG_LENGTH);
}

/**
 * What beating a leader is worth, as a multiplier on one ordinary encounter.
 *
 * `trainerReward`'s own formula times GYM_BONUS. That formula already scales
 * with the two things that make a leader hard, so there is nothing to invent —
 * and it still passes through `huntCap` at the call site, exactly as a route
 * trainer's payout does. No item roll here: a gym leader handing over an
 * everstone is odd, and the badge and its TM are the prize.
 */
export function gymReward(row: Pick<GymRow, 'team' | 'grit'>): number {
  return 3 * row.team.length * row.grit * GYM_BONUS;
}

// ── 포켓몬리그 ─────────────────────────────────────────────────────────────

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
  /** Permanent key, written onto the log entry. */
  id: string;
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

export const LEAGUE: LeagueRow[] = [
  { id: 'lorelei', ko: '사천왕 칸나', sprite: 'lorelei-gen1', gender: 'f', grit: 1.57, team: [87, 91, 80, 124, 131] },
  { id: 'bruno',   ko: '사천왕 시바', sprite: 'bruno',        gender: 'm', grit: 1.62, team: [95, 107, 106, 95, 68] },
  { id: 'agatha',  ko: '사천왕 국화', sprite: 'agatha-gen1',  gender: 'f', grit: 1.67, team: [94, 42, 93, 24, 94] },
  { id: 'lance',   ko: '사천왕 목호', sprite: 'lance',        gender: 'm', grit: 1.73, team: [130, 148, 148, 142, 149] },
  { id: 'blue',    ko: '챔피언 그린', sprite: 'blue',         gender: 'm', grit: 1.80, team: [18, 65, 112, 130, 103, 59] },
];

/** Where the league is. A name, for the same reason a gym's city is. */
export const LEAGUE_CITY = '석영고원';

/**
 * Where in the leg a CHALLENGE MAY START. Three, twenty-five minutes apart.
 *
 * Once a run is under way every encounter in the leg is its next member, so
 * these gate only the beginning — and the last of them has to leave room for
 * all five. A leg is fifteen encounters, so a run begun at 10 ends at 14, on
 * the last encounter before the pet walks out of 석영고원 and the run is wiped.
 */
export const LEAGUE_OFFSETS = [0, 5, 10] as const;

/**
 * Seed base for a league round.
 *
 * Wild encounters use `seq`, trainer rounds `1e9`, legendary fights `2e9`.
 * Far past any of them, and past 26 rounds' worth of room per encounter.
 */
const LEAGUE_SEED_BASE = 3_000_000_000;

const LEAGUE_STOP = (() => {
  const i = STOPS.findIndex((s) => s.ko === LEAGUE_CITY);
  if (i < 0) throw new Error(`gyms.ts: ${LEAGUE_CITY} is not on the journey`);
  return i;
})();

export function leagueById(id: string): LeagueRow | null {
  return LEAGUE.find((m) => m.id === id) ?? null;
}

/** Is the pet standing at 석영고원 right now? */
export function atLeague(seq: number): boolean {
  return stopIndexOf(seq) === LEAGUE_STOP;
}

/** May a fresh challenge begin at this encounter? */
export function leagueStartAt(seq: number): boolean {
  if (!atLeague(seq)) return false;
  const off = ((Math.max(0, Math.floor(seq)) % LEG_LENGTH) + LEG_LENGTH) % LEG_LENGTH;
  return (LEAGUE_OFFSETS as readonly number[]).includes(off);
}

export type LeagueRound = {
  /** One per opponent fought. Shorter than the member's team if the party fell. */
  rounds: Battle[];
  /** The party's HP after, bar by bar. */
  hp: number[];
  won: boolean;
  /** Which party member was out for each round — the scene swaps art on this. */
  outFor: number[];
};

/**
 * Fight one Elite Four member with a party of six.
 *
 * Composed from `battleAt` rather than folded into it, for the same three
 * reasons `trainerBattleAt` gives — the felling last turn, MAX_TURNS, the
 * global turn index. The one thing that is new is on my side of the field:
 * six bars instead of one, and a bar at zero hands over to the next.
 *
 * The turn budget is `TRAINER_ROUND_TURNS`, unchanged. Measured across sixty
 * thousand league losses, not one came from running out of turns — every
 * single one was an HP knockout — so a longer budget buys the opponent extra
 * counter-attacks and nothing else.
 *
 * HP arrives from the caller and leaves in the return, so it can carry across
 * the five encounters a full run takes without this function knowing about
 * them.
 */
export function leagueRoundAt(
  seq: number,
  member: LeagueRow,
  party: PartyMember[],
  startHp: number[],
  boosts: BattleOpts = {},
): LeagueRound {
  const hp = [...startHp];
  const rounds: Battle[] = [];
  const outFor: number[] = [];
  let cur = hp.findIndex((h) => h > 0);
  /** Global round index, so two rounds against the same opponent differ. */
  let r = 0;

  for (const foe of member.team) {
    let felled = false;
    // An opponent does not go away because one of my six ran out. It stays,
    // and the next bar comes in against it — which is the whole reason six
    // bars are worth more than one big one, and the reason this is a `while`
    // rather than one round per opponent.
    while (!felled) {
      if (cur < 0) return { rounds, hp, won: false, outFor };
      const me = party[cur];
      const round = battleAt(LEAGUE_SEED_BASE + seq * 32 + r, rarityOfSpecies(foe), me.moves, foe, {
        startHp: hp[cur],
        budget: TRAINER_ROUND_TURNS,
        targetTurns: TRAINER_ROUND_TURNS,
        // A fixed pool, as a trainer round uses: what beats the league is the
        // moveset you assembled, not how hard your species happens to swing.
        swingRef: TACKLE.power,
        floor: false,
        counterHit: Math.max(1, Math.round(BATTLE_MAX_HP * LEAGUE_COUNTER_SHARE * member.grit)),
        grit: member.grit,
        mySpeciesId: me.speciesId,
        ...boosts,
      });
      rounds.push(round);
      outFor.push(cur);
      r++;

      const last = round.turns.at(-1);
      hp[cur] = Math.max(0, last?.myHpAfter ?? hp[cur]);
      felled = (last?.foeHpAfter ?? 0) === 0;
      // Out of turns with the opponent still standing spends that bar. It is
      // also what makes this loop terminate: every pass either fells an
      // opponent or empties a bar, so the whole fight is at most
      // `team.length + party.length` rounds.
      if (!felled) hp[cur] = 0;
      if (hp[cur] <= 0) cur = hp.findIndex((h) => h > 0);
    }
  }

  return { rounds, hp, won: true, outFor };
}

/** What clearing the whole league is worth, as a multiplier on one encounter. */
export const LEAGUE_REWARD = 25;
