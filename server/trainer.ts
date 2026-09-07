import { mulberry32, rollSpecies } from './game.ts';
import { rarityOfSpecies } from './dex.ts';
import { BATTLE_MAX_HP, TACKLE, battleAt, type Battle, type BattleOpts } from './hunt.ts';
import { speciesInfo, type MoveType } from './moves.ts';
import { LEGENDS, legendOf } from './legenddata.ts';
import { LINES } from './species.ts';

/**
 * Every line root that leads to a legendary, for `rollSpecies` to skip.
 *
 * Built once. `exclude` tests a line by its ROOT, so this is the roots of the
 * lines that hold a gated species anywhere along them.
 */
const LEGEND_ROOTS = new Set(
  LINES.filter((l) => l.paths.some((p) => p.some((id) => LEGENDS.some((x) => x.id === id)))).map(
    (l) => l.paths[0][0],
  ),
);

/**
 * Random trainer encounters.
 *
 * Pure and clock-free, like the rest of the hunt: a trainer is a function of the
 * encounter index, so `hunt()` stays a replay of `[huntCount, huntCount + n)`
 * and two processes settling the same range agree.
 *
 * PokeAPI has no trainer data, so the classes and names here are written by hand
 * — the Korean class names are ours, not the official localisations, the same
 * way `부자 아저씨` always was.
 *
 * The ART, though, is not ours: each class carries a Showdown trainer slug that
 * `ensureNpcSprite` resolves, the same host and the same fetch-and-cache rule
 * the shop clerk, the battle backdrops and the move effects already use. This
 * file used to say no trainer art existed anywhere. It does; server/sprites.ts
 * had already found it for the counter and the battle simply was not asking.
 */

/** Encounters that turn out to be a trainer. One in twenty-five, about 2 hours. */
export const TRAINER_CHANCE = 0.04;

/** Turns each team member gets. Three of these plus framing is about 18s. */
export const TRAINER_ROUND_TURNS = 4;

/** Round seeds start here so they cannot collide with a wild encounter's. */
const ROUND_SEED_BASE = 1_000_000_000;

/**
 * Counter damage per turn, as a share of the companion's whole HP bar.
 *
 * Twelve turns against a three-Pokemon team costs roughly the full bar at the
 * highest grit, so a long fight is genuinely dangerous and a short one is not.
 */
const COUNTER_SHARE = 0.085;

/** Odds a win also hands over an item. */
const ITEM_CHANCE = 0.35;

/**
 * A win pays this many ordinary encounters, before team size and grit.
 *
 * At 6 a three-Pokemon elite paid 23 encounters. Trainers turn up every 25, so
 * that very nearly doubled hunting income on its own. Three keeps a win worth
 * chasing without making the wild encounters beside the point.
 */
const REWARD_MULT = 3;

export type Gender = 'm' | 'f';

type TrainerClass = {
  name: string;
  /**
   * The Showdown trainer slug per gender.
   *
   * A class with both is rolled; a class with one is that gender and is not
   * asked. This is the whole gender model — there is no separate field to keep
   * in step with it, so a 미니스커트 cannot be given a boy's name by a later
   * edit that forgets one of the two.
   */
  sprite: { m?: string; f?: string };
  team: number;
  /** Multiplied onto the opponent's toughness and counter-attack. */
  grit: number;
  /**
   * Types this class favours, if any.
   *
   * This is what makes the type chart bite: a Fisherman fields Water, so a Grass
   * moveset walks it and an Electric one is in trouble.
   */
  likes?: MoveType[];
};

/**
 * The roster, easiest first.
 *
 * Twenty classes over ten `grit` steps, so the difficulty a name announces is
 * roughly the difficulty you get. Ten are men, five are women, and five field
 * both — about 37% women, which is close to what the games do.
 *
 * Every slug here was checked against the host: all twenty-four are 80x80 and
 * average 762 bytes, which is why Scene.tsx can size them with one constant.
 */
const CLASSES: TrainerClass[] = [
  { name: '짧은바지 꼬마', sprite: { m: 'youngster' }, team: 1, grit: 0.9, likes: ['normal', 'electric'] },
  { name: '미니스커트', sprite: { f: 'lass' }, team: 1, grit: 0.9, likes: ['fairy', 'normal'] },
  { name: '피크닉걸', sprite: { f: 'picnicker' }, team: 1, grit: 0.95, likes: ['grass', 'fairy'] },
  { name: '벌레잡이 소년', sprite: { m: 'bugcatcher' }, team: 2, grit: 0.95, likes: ['bug'] },
  { name: '캠프보이', sprite: { m: 'camper' }, team: 2, grit: 1.0, likes: ['ground', 'grass'] },
  { name: '포켓몬팬', sprite: { m: 'pokefan', f: 'pokefanf' }, team: 2, grit: 1.0, likes: ['normal', 'fairy'] },
  { name: '새박사', sprite: { m: 'birdkeeper' }, team: 2, grit: 1.05, likes: ['flying'] },
  { name: '파라솔아가씨', sprite: { f: 'parasollady' }, team: 2, grit: 1.05, likes: ['water'] },
  { name: '수영복', sprite: { m: 'swimmer', f: 'swimmerf' }, team: 2, grit: 1.05, likes: ['water', 'ice'] },
  { name: '낚시꾼', sprite: { m: 'fisherman' }, team: 2, grit: 1.1, likes: ['water'] },
  { name: '등산가', sprite: { m: 'hiker' }, team: 2, grit: 1.1, likes: ['rock', 'ground'] },
  { name: '선원', sprite: { m: 'sailor' }, team: 2, grit: 1.1, likes: ['water', 'fighting'] },
  { name: '미녀', sprite: { f: 'beauty' }, team: 2, grit: 1.1, likes: ['fairy', 'water'] },
  { name: '검은띠', sprite: { m: 'blackbelt' }, team: 2, grit: 1.15, likes: ['fighting'] },
  { name: '배틀걸', sprite: { f: 'battlegirl' }, team: 2, grit: 1.15, likes: ['fighting'] },
  { name: '부자 아저씨', sprite: { m: 'gentleman' }, team: 2, grit: 1.2, likes: ['normal', 'psychic'] },
  { name: '연구원', sprite: { m: 'scientist' }, team: 2, grit: 1.2, likes: ['electric', 'steel', 'poison'] },
  { name: '초능력자', sprite: { m: 'psychic', f: 'psychicf' }, team: 2, grit: 1.2, likes: ['psychic'] },
  { name: '엘리트 트레이너', sprite: { m: 'acetrainer', f: 'acetrainerf' }, team: 3, grit: 1.3 },
  { name: '베테랑', sprite: { m: 'veteran', f: 'veteranf' }, team: 3, grit: 1.4 },
];

/**
 * Given names, split by gender so the class and the name cannot disagree.
 *
 * They used to be one mixed pool, which is how `미니스커트 도현` happened.
 *
 * EVERY name is two syllables, and that is a layout rule rather than a taste:
 * Scene.tsx's reward lines are built on "the longest trainer name is eleven
 * characters", and the longest class name is `엘리트 트레이너` at eight. Eight
 * plus a space plus two is exactly eleven. A three-syllable name here folds the
 * payout onto a second row, and `test/trainer.test.ts` fails if one appears.
 */
const MALE_NAMES = [
  '민수', '지훈', '도현', '시우', '건우', '태윤', '준서', '재원',
  '성민', '정우', '동현', '준혁', '하준', '서준', '지호', '우진',
  '현우', '예준', '승우', '도윤', '은우', '이준', '지환', '태민',
];

const FEMALE_NAMES = [
  '서연', '하윤', '예은', '수빈', '지아', '나연', '유진', '소율',
  '다은', '채원', '혜인', '가은', '보라', '지우', '서현', '민지',
  '예린', '하은', '수아', '지윤', '아연', '세라', '유나', '소연',
];

/**
 * A fourth RNG salt.
 *
 * The other three are the encounter roll, the battle roll, and the hatch roll.
 * Sharing any of them would mean asking whether an encounter is a trainer
 * changes which Pokemon was met — the replay the whole hunt design rests on.
 */
function trainerRng(seq: number): () => number {
  return mulberry32(Math.imul(seq + 3, 0x2545f491) ^ 0x9e3779b9);
}

export type Trainer = {
  className: string;
  /** "짧은바지 꼬마 민수" */
  name: string;
  gender: Gender;
  /** The Showdown slug, i.e. what `ensureNpcSprite` takes. Never a filename. */
  sprite: string;
  team: number[];
  grit: number;
};

/** How many attempts to honour a class's preferred types before settling. */
const TYPE_TRIES = 12;

/**
 * Is encounter `seq` a trainer, and if so, who?
 *
 * Pure in `seq`. Nothing here reads the clock, the dex, or any counter that
 * `advance` mutates — the same contract `encounterAt` works to.
 *
 * Pure in `seq` AND in the tables above, which is the part worth saying out
 * loud: growing CLASSES or a name pool re-rolls who stood at every past `seq`.
 * The wild stream is untouched — `trainerRng` is a fourth salt precisely so
 * that adding trainers could not shift it, and that still holds — but a log
 * entry settled by an older build carries a name this function no longer
 * produces. `state.ts` checks for exactly that before it replays a fight.
 */
export function trainerAt(seq: number): Trainer | null {
  const rng = trainerRng(seq);
  if (rng() >= TRAINER_CHANCE) return null;

  const klass = CLASSES[Math.floor(rng() * CLASSES.length)];
  // A class with one slug IS that gender, and is not asked — rolling for a
  // 미니스커트 would burn a draw to arrive at the only answer there is.
  const gender: Gender =
    klass.sprite.m && klass.sprite.f ? (rng() < 0.5 ? 'm' : 'f') : klass.sprite.m ? 'm' : 'f';
  const pool = gender === 'm' ? MALE_NAMES : FEMALE_NAMES;
  const given = pool[Math.floor(rng() * pool.length)];

  const team: number[] = [];
  for (let i = 0; i < klass.team; i++) {
    let pick = 0;
    // Prefer the class's types, but never dead-end: after TYPE_TRIES the roll
    // stands whatever it is.
    for (let t = 0; t < TYPE_TRIES; t++) {
      // A route trainer does not carry a legendary — one 등산가 fielding Arceus
      // would undo the whole gate. Excluding the lines up front rather than
      // rerolling after the fact costs no extra draw: `exclude` narrows the
      // pool, and `rollSpecies` takes its two draws either way.
      const line = rollSpecies(rng, LEGEND_ROOTS, null);
      const path = line.paths[Math.floor(rng() * line.paths.length)];
      pick = path[Math.floor(rng() * path.length)];
      // Backstop for a line whose root is ordinary but whose tip is not: walk
      // back to the root, which the exclusion above has already vouched for.
      if (legendOf(pick)) pick = path[0];
      if (!klass.likes) break;
      const types = speciesInfo(pick)?.types ?? [];
      if (types.some((x) => klass.likes!.includes(x))) break;
    }
    team.push(pick);
  }

  return {
    className: klass.name,
    name: `${klass.name} ${given}`,
    gender,
    sprite: klass.sprite[gender]!,
    grit: klass.grit,
    team,
  };
}

export type TrainerBattle = {
  /** One per team member fought. Shorter than the team if the companion fell. */
  rounds: Battle[];
  won: boolean;
  /** Which round the companion went down in, or null if it won. */
  lostAt: number | null;
};

/**
 * Fight a trainer's whole team.
 *
 * Composed from `battleAt` rather than folded into it. A team inside one
 * `Battle` would break three things the wild encounter guarantees — the last
 * turn always felling the opponent, the total staying under MAX_TURNS, and the
 * finishing blow being tied to the global turn index.
 *
 * HP carries across rounds and has no floor, which is what makes a trainer
 * losable while a wild encounter still cannot be lost.
 */
export function trainerBattleAt(
  seq: number,
  t: Trainer,
  moves: number[],
  /** The companion's species, so the type chart applies to the team's moves too. */
  mySpeciesId?: number,
  /**
   * What the companion's form contributes, from `formOpts`.
   *
   * This is where a Gigantamax is worth something. A wild encounter has an HP
   * floor and cannot be lost, so halving incoming damage there is decoration; a
   * trainer round has no floor, and three turns of it is the difference between
   * holding on for the fourth member and going down on the third.
   *
   * Already composed by the caller rather than resolved here, so the settled
   * fight and the panel's replay of it cannot be given different opts.
   */
  boosts: BattleOpts = {},
): TrainerBattle {
  const rounds: Battle[] = [];
  let hp = BATTLE_MAX_HP;

  for (let i = 0; i < t.team.length; i++) {
    const foe = t.team[i];
    const rarity = rarityOfSpecies(foe);
    // A distinct seed per round, pushed far past any real encounter index so a
    // trainer round never borrows a wild battle's stream.
    const round = battleAt(ROUND_SEED_BASE + seq * 8 + i, rarity, moves, foe, {
      startHp: hp,
      budget: TRAINER_ROUND_TURNS,
      // Sized to the round, not to a wild encounter's six turns — otherwise the
      // opponent cannot fall inside the budget and every trainer "holds".
      targetTurns: TRAINER_ROUND_TURNS,
      // A fixed pool, not one scaled to my own damage. This is what makes a
      // taught moveset actually beat a trainer a bare one loses to.
      swingRef: TACKLE.power,
      floor: false,
      // In HP units, not swing units. Tie it to the moveset and a stronger team
      // takes proportionally bigger hits against the same pool, which makes the
      // better trainer-fighter lose more often — measured, and backwards.
      counterHit: Math.max(1, Math.round(BATTLE_MAX_HP * COUNTER_SHARE * t.grit)),
      grit: t.grit,
      mySpeciesId,
      ...boosts,
    });
    rounds.push(round);

    const last = round.turns.at(-1);
    hp = last?.myHpAfter ?? hp;
    if (hp <= 0) return { rounds, won: false, lostAt: i };
    // The round ran out of turns without felling it — the team holds.
    if ((last?.foeHpAfter ?? 0) > 0) return { rounds, won: false, lostAt: i };
  }

  return { rounds, won: true, lostAt: null };
}

export type TrainerReward = {
  /** Multiplier on one ordinary encounter's payout, not a token count. */
  payout: number;
  /**
   * An item, sometimes.
   *
   * Never a Rare Candy: that credits `bonusTokens`, and `huntCap` only caps
   * `huntTokens` — a free candy would walk straight around the hunt ceiling.
   * These two grant no progress, so they cannot.
   */
  item: 'shiny-charm' | 'everstone' | null;
};

/**
 * What beating a trainer is worth.
 *
 * Returned as a MULTIPLIER on one ordinary encounter's payout, so the reward
 * scales with the user's own hatch threshold exactly as everything else does.
 * It still passes through `huntCap` at the call site — a trainer cannot lift
 * the ceiling.
 */
export function trainerReward(seq: number, t: Trainer): TrainerReward {
  // A separate integer seed — Math.imul truncates, so a fractional offset would
  // silently be the same stream as trainerAt's.
  const rng = trainerRng(ROUND_SEED_BASE + seq);
  return {
    payout: REWARD_MULT * t.team.length * t.grit,
    item: rng() < ITEM_CHANCE ? (rng() < 0.5 ? 'shiny-charm' : 'everstone') : null,
  };
}
