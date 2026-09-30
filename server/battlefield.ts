import type { MoveInfo, MoveType } from './moves.ts';

/**
 * The rules a battle reads that are not about one Pokemon: weather, terrain,
 * screens, Tailwind, Trick Room — and the moves whose power is a formula
 * rather than a number.
 *
 * Tables and pure functions only. `fightAt` in server/fight.ts owns the state
 * of a fight and calls in here to ask what that state means; nothing here
 * draws a random number, so the order of draws stays the engine's business.
 *
 * Everything is Gen 5+ as the games have it, at level 50, with two things this
 * app does not have left out on purpose: abilities (nothing sets weather on
 * switch-in) and held items (Knock Off never gets its bonus, Acrobatics always
 * does, Fling and Natural Gift always fail).
 */

/**
 * The weather. 'winds' is 델타스트림's air current, which only an ability
 * brings; 시작의바다 and 끝의대지 are rain and sun that nothing can replace,
 * which `Field.weather.primal` says.
 */
export type Weather = 'rain' | 'sun' | 'sand' | 'hail' | 'snow' | 'winds';
export type Terrain = 'electric' | 'grassy' | 'misty' | 'psychic';
/** What a side can put up on its own half of the field. */
export type Screen = 'reflect' | 'lightScreen' | 'auroraVeil' | 'tailwind';

/** How long each lasts, in turns, counting the one it went up on. */
export const WEATHER_TURNS = 5;
export const TERRAIN_TURNS = 5;
export const TRICK_ROOM_TURNS = 5;
export const SCREEN_TURNS: Record<Screen, number> = {
  reflect: 5,
  lightScreen: 5,
  auroraVeil: 5,
  tailwind: 4,
};

/** 비바라기, 쾌청, 모래바람, 싸라기눈, 설경. */
export const WEATHER_MOVES: Record<number, Weather> = {
  240: 'rain',
  241: 'sun',
  201: 'sand',
  258: 'hail',
  883: 'snow',
};
/** 일렉트릭필드, 그래스필드, 미스트필드, 사이코필드. */
export const TERRAIN_MOVES: Record<number, Terrain> = {
  604: 'electric',
  580: 'grassy',
  581: 'misty',
  678: 'psychic',
};
/** 리플렉터, 빛의장막, 오로라베일, 순풍. */
export const SCREEN_MOVES: Record<number, Screen> = {
  115: 'reflect',
  113: 'lightScreen',
  694: 'auroraVeil',
  366: 'tailwind',
};
export const TRICK_ROOM = 433;

/** 방어, 판별. They go first (+4) and stop the other side's move for the turn. */
export const PROTECT_MOVES = new Set([182, 197]);
/** 잠자기. Heals everything and sleeps two turns. */
export const REST = 156;
/** 잠꼬대, 코골기: the only moves a sleeping Pokemon can use. */
export const SLEEP_TALK = 214;
export const SNORE = 173;
/** 꿈먹기: only works on something asleep. */
export const DREAM_EATER = 138;
/** 힘껏펀치: fails if the user was hit before it moved. */
export const FOCUS_PUNCH = 264;
/** 솔라빔, 솔라블레이드: a turn of charging unless the sun is out. */
export const SOLAR_MOVES = new Set([76, 669]);
/**
 * Moves that cost the next turn: 파괴광선, 기가임팩트, 블러스트번, 하이드로캐넌,
 * 하드플랜트, 락블레스트, 시간의포효, 프리즘레이저, 스타어설트, 무한다이빔.
 * PokeAPI's `recharge` attribute says the same; this list predates reading it.
 */
export const RECHARGE_MOVES = new Set([63, 416, 307, 308, 338, 439, 459, 711, 794, 795]);
/** 대폭발, 자폭, 미스트버스트: the user faints. PokeAPI has no flag for this either. */
export const SELF_KO_MOVES = new Set([153, 120, 802]);
/**
 * Moves that cannot work here, and so always fail.
 *
 * 내던지기, 자연의은혜, 트릭, 리사이클 and 폴터가이스트 all need a held item
 * and nothing here holds one; 도우미, 사이드체인지, 드래곤옐, 순서미루기 and 코칭 only mean anything in
 * a double battle, and every fight here is one on one. The games fail every one
 * of them in the same position, so "하지만 실패했다!" is the faithful line, not
 * a shortcut.
 */
export const ALWAYS_FAILS = new Set([
  374, 363, 271, 278, 809, 270, 502, 913, 511, 811,
  // 바꿔치기 needs an item; 날따름, 분노가루 and 아로마미스트 need an ally;
  // 트림, 볼가득넣기 and 다과회 need a berry.
  415, 266, 476, 597, 562, 747, 752,
]);

/** The type 대지의파동 takes on each terrain. */
export const TERRAIN_TYPE: Record<Terrain, MoveType> = {
  electric: 'electric',
  grassy: 'grass',
  misty: 'fairy',
  psychic: 'psychic',
};

export const SUBSTITUTE = 164;
export const TAUNT = 269;
export const ENCORE = 227;
export const SPITE = 180;
export const HAZE = 114;
export const FOCUS_ENERGY = 116;
export const CURSE = 174;
export const ENDURE = 203;
export const SAFEGUARD = 219;
export const PAIN_SPLIT = 220;
export const PSYCH_UP = 244;
export const POWER_SWAP = 384;
export const GUARD_SWAP = 385;
export const SPEED_SWAP = 683;
export const METRONOME = 118;
export const MIMIC = 102;
export const NATURE_POWER = 267;
export const TELEPORT = 100;
export const BATON_PASS = 226;
export const DEFOG = 432;
export const GRAVITY = 356;
export const WONDER_ROOM = 472;
export const MAGIC_ROOM = 478;
export const TELEKINESIS = 477;
export const IMPRISON = 286;
export const SNATCH = 289;
/** 발버둥: what a Pokemon with no PP left swings. Not a machine move, so not in the table. */
export const STRUGGLE = 165;

/** 울부짖기, 날려버리기: the target is dragged out, or a wild fight ends. */
export const ROAR_MOVES = new Set([46, 18]);
/** 드래곤테일, 배대뒤치기: the same, after the damage. */
export const DRAG_OUT_MOVES = new Set([525, 509]);
/** 유턴, 볼트체인지, 퀵턴: hit, then the user goes back. */
export const PIVOT_MOVES = new Set([369, 521, 812]);
/** 깨뜨리다, 사이코팽: break the target's screens before they land. */
export const SCREEN_BREAKERS = new Set([280, 706]);
/** 압정뿌리기, 독압정, 스텔스록, and how many layers each stacks to. */
export const HAZARD_MOVES: Record<number, { hazard: 'spikes' | 'toxicSpikes' | 'stealthRock' | 'stickyWeb'; max: number }> = {
  191: { hazard: 'spikes', max: 3 },
  390: { hazard: 'toxicSpikes', max: 2 },
  446: { hazard: 'stealthRock', max: 1 },
  564: { hazard: 'stickyWeb', max: 1 }, // 끈적끈적네트
};
/** 뿔드릴, 땅가르기, 가위자르기, 절대영도: a knockout, a third of the time at the same level. */
export const OHKO_MOVES = new Set([32, 90, 12, 329]);
/** 미래예지, 파멸의소원: strike two turns later. */
export const FUTURE_MOVES = new Set([248, 353]);

/**
 * Moves that spend a turn before they land.
 *
 * `vanish` is where the user is while it charges — up in the air, underground,
 * underwater, gone — and every move but the few that reach there misses it.
 * `boost` is a stage the charge turn raises (로케트박치기, 메테오빔).
 */
export const CHARGE_MOVES: Record<number, { vanish?: 'air' | 'ground' | 'water' | 'gone'; boost?: { stat: 'def' | 'spa'; change: number } }> = {
  76: {},
  669: {},
  13: {},
  143: {},
  130: { boost: { stat: 'def', change: 1 } },
  800: { boost: { stat: 'spa', change: 1 } },
  19: { vanish: 'air' },
  340: { vanish: 'air' },
  91: { vanish: 'ground' },
  291: { vanish: 'water' },
  566: { vanish: 'gone' },
  467: { vanish: 'gone' },
  // 프리폴 carries the target up with it — see SKY_DROP.
  507: { vanish: 'air' },
  601: {}, // 지오컨트롤: the charge, then the three stages
  905: { boost: { stat: 'spa', change: 1 } }, // 일렉트로빔: fires at once in the rain
};
/** 프리폴: the target goes up too, cannot move while it is held, and a 200kg one cannot be lifted. */
export const SKY_DROP = 507;

/**
 * What reaches a vanished Pokemon, and how much harder it lands there.
 * 지진 hits something underground for double; 번개 reaches the sky; 파도타기
 * finds a diver.
 */
export const REACHES: Record<'air' | 'ground' | 'water', Record<number, number>> = {
  air: { 87: 1, 542: 1, 16: 2, 239: 2, 327: 1, 479: 1 },
  ground: { 89: 2, 222: 2, 90: 1 },
  water: { 57: 2, 250: 2 },
};

/** What 자연의힘 becomes on each terrain; 트라이어택 anywhere else. */
export const NATURE_POWER_MOVES: Record<Terrain | 'none', number[]> = {
  electric: [85],
  grassy: [412],
  misty: [585, 605],
  psychic: [94],
  none: [161],
};

/**
 * Nine-generation moves PokeAPI has not filled in yet.
 *
 * They ship with no meta row at all, so the stage change each is known for
 * would otherwise be lost. Written from the games' own descriptions.
 */
export const MOVE_PATCHES: Record<number, Partial<MoveInfo>> = {
  884: { category: 'damage-lower', statChance: 100, statChanges: [{ stat: 'speed', change: -1 }] }, // 달려들기
  885: { category: 'damage-raise', statChance: 100, statChanges: [{ stat: 'speed', change: 1 }] }, // 개척하기
  886: { category: 'damage-lower', statChance: 100, statChanges: [{ stat: 'attack', change: -1 }] }, // 찬물끼얹기
  918: { flinchChance: 100 }, // 기선제압
  // 스케일샷: PokeAPI carries its hits but not what it does to its user after the last one.
  799: { category: 'damage-raise', statChance: 100, statChanges: [{ stat: 'defense', change: -1 }, { stat: 'speed', change: 1 }] },

  // ── Level-up moves of the ninth generation, and the few before it that
  // PokeAPI carries without what they do. Each from the games' own text.
  828: { category: 'damage-raise', statChance: 100, statChanges: [{ stat: 'defense', change: 1 }] }, // 배리어러시
  831: { category: 'damage-lower', statChance: 30, statChanges: [{ stat: 'attack', change: -1 }] }, // 봄의폭풍
  832: { category: 'damage-raise', statChance: 100, statChanges: [{ stat: 'special-attack', change: 1 }] }, // 신비의힘
  834: { drain: -33 }, // 웨이브태클
  838: { category: 'damage-raise', statChance: 100, statChanges: [{ stat: 'defense', change: -1 }, { stat: 'special-defense', change: -1 }] }, // 들이받기
  839: { ailment: 'poison', ailmentChance: 50 }, // 독침천발
  846: { category: 'damage-lower', statChance: 30, statChanges: [{ stat: 'speed', change: -1 }] }, // 찬바람폭풍
  847: { ailment: 'paralysis', ailmentChance: 20 }, // 번개폭풍
  848: { ailment: 'burn', ailmentChance: 20 }, // 열사의폭풍
  849: { category: 'heal', healing: 25 }, // 초승달의기도
  853: { ailment: 'confusion', ailmentChance: 30 }, // 발꿈치찍기
  855: { category: 'damage-lower', statChance: 100 }, // 루미나콜리전 (특방 −2, 데이터에 있음)
  859: { category: 'damage-raise', statChance: 100 }, // 휠스핀 (스피드 −2)
  860: { hits: [10, 10] }, // 찍찍베기
  865: { hits: [3, 3] }, // 트리플다이브
  866: { ailment: 'poison', ailmentChance: 100 }, // 킬러스핀
  870: { critRate: 6 }, // 트릭플라워
  871: { category: 'damage-raise', statChance: 100 }, // 플레어송 (특공 +1)
  872: { category: 'damage-raise', statChance: 100 }, // 아쿠아스텝 (스피드 +1)
  874: { category: 'damage-raise', statChance: 100 }, // 골드러시 (특공 −1)
  888: { hits: [2, 2] }, // 트윈빔
  890: { category: 'damage-raise', statChance: 100 }, // 아머캐논 (방어·특방 −1)
  891: { drain: 50 }, // 원념의칼
  895: { critRate: 1 }, // 아쿠아커터
  902: { drain: 50, ailment: 'burn', ailmentChance: 20 }, // 휘적휘적포
  903: { category: 'damage', statChance: 0 }, // 시럽봄 — 3턴 동안 매 턴 스피드 −1은 따로
  904: { critRate: 1 }, // 덩굴방망이
  905: { category: 'damage-raise', statChance: 0 }, // 일렉트로빔 — 충전 턴에 특공 +1
  911: { hits: [2, 2] }, // 타키온커터
  919: { ailment: 'poison', ailmentChance: 50 }, // 악독사슬 (맹독 — TOXIC_MOVES)
};

/** Only the first move a Pokemon makes after coming in: 속이기, 만나자마자. */
export const FIRST_TURN_MOVES = new Set([252, 660]);
/** Fail unless the target is about to use a damaging move: 기습, 질풍신뢰. */
export const SUCKER_MOVES = new Set([389, 909]);
/** Go through Protect — and, for the last three, break it. */
export const PROTECT_PIERCERS = new Set([566, 467, 364, 593, 621, 887, 910]);
export const PROTECT_BREAKERS = new Set([364, 593, 621]);
/**
 * Protection with a sting: 킹실드, 니들가드, 토치카, 블로킹, 스레드트랩,
 * 화염의수호. What a contact move that runs into it gets back.
 */
export const SPIKY_PROTECT: Record<number, { stat?: { key: 'atk' | 'def' | 'spe'; change: number }; hurt?: number; condition?: 'poison' | 'burn'; damagingOnly?: boolean }> = {
  588: { stat: { key: 'atk', change: -1 }, damagingOnly: true }, // 킹실드 (7세대 이후 −1)
  596: { hurt: 8 }, // 니들가드
  661: { condition: 'poison' }, // 토치카
  792: { stat: { key: 'def', change: -2 }, damagingOnly: true }, // 블로킹
  852: { stat: { key: 'spe', change: -1 }, damagingOnly: true }, // 스레드트랩
  908: { condition: 'burn', damagingOnly: true }, // 화염의수호
};
/** 크로스플레임 and 크로스썬더: double if the other one was the move used just before. */
export const FUSION_MOVES: Record<number, number> = { 558: 559, 559: 558 };
/** Moves that punish a 작아지기: double damage, and they cannot miss it. */
export const MINIMIZE_PUNISH = new Set([23, 34, 407, 484, 535, 560]);
/** Moves that keep the target from getting away: 검은눈빛, 블록, 사우전드웨이브, 그림자꿰매기, 앵커샷, 물고버티기. */
export const NO_ESCAPE_MOVES = new Set([212, 335, 615, 662, 677, 746]);
/** Moves that keep their USER from leaving too: 물고버티기, 배수의진. */
export const SELF_NO_ESCAPE = new Set([746, 748]);
/** Moves that free the user: 고속스핀, 킬러스핀 — hazards on its side, a bind, a seed. */
export const SPIN_MOVES = new Set([229, 866]);
/** 이차원홀, 분노의앞니… power 0 moves that deal half the target's HP. */
export const HALF_HP_MOVES = new Set([162, 717, 877]);
/** Moves whose power the user's remaining HP decides: 분화, 해수스파우팅, 드래곤에너지. */
export const HP_POWER_MOVES = new Set([284, 323, 820]);
/** 묵사발 and its kin: the target's remaining HP. */
export const TARGET_HP_POWER_MOVES = new Set([462]);
/** 전격부리, 아가미물기: double if the target has not moved yet. */
export const FIRST_STRIKE_MOVES = new Set([754, 755]);
/** 엑셀브레이크, 라이트닝드라이브: a third again when super effective. */
export const SE_BOOST_MOVES = new Set([878, 879]);
/** 플라잉프레스: Fighting, and Flying too. */
export const FLYING_PRESS = 560;
/** 프리즈드라이: Ice that is super effective on Water. */
export const FREEZE_DRY = 573;
/** 성묘: fifty more for every teammate that has fainted. */
export const LAST_RESPECTS = 854;
/** 분노의주먹: fifty more for every time the user has been hit. */
export const RAGE_FIST = 889;
/** 거대해머: not twice in a row. */
export const GIGATON_HAMMER = 893;
/** 전광쌍격 and 불사르기: the user must be that type, and stops being it. */
export const TYPE_SPENDERS: Record<number, MoveType> = { 892: 'electric', 682: 'fire' };
/** 페이탈클로: half the time, one of poison, paralysis or sleep. */
export const DIRE_CLAW = 827;
/** 암석액스: scatters 스텔스록 on a hit. */
export const STONE_AXE = 830;
/** 소금절이: a salt that stings every turn, twice as much on Water and Steel. */
export const SALT_CURE = 864;
/** 시럽봄: three turns of speed falling. */
export const SYRUP_BOMB = 903;
/** 대검돌격: until its next move the user takes double and cannot dodge. */
export const GLAIVE_RUSH = 862;
/** 변덕레이저: three times in ten, twice the power. */
export const FICKLE_BEAM = 907;
/** 일렉트로빔: charges, special attack up — or fires at once in the rain. */
export const ELECTRO_SHOT = 905;
/** 마지막일침: a knockout with it raises the user's attack three stages. */
export const FELL_STINGER = 565;
/** 클리어스모그: the target's stages go back to zero. */
export const CLEAR_SMOG = 499;
/** 섀도스틸: takes the target's raised stages first. */
export const SPECTRAL_THIEF = 712;
/** 물거품아리아: cures the target's burn. */
export const SPARKLING_ARIA = 664;
/** 플라스마피스트: normal moves turn Electric for the rest of the turn. */
export const PLASMA_FISTS = 721;
/** 잠재댄스: the type of the user. */
export const REVELATION_DANCE = 686;
/** 대지의파동: type and double power from the terrain. */
export const TERRAIN_PULSE = 805;
/** 아이언롤러: needs a terrain, and flattens it. */
export const STEEL_ROLLER = 798;
/** 트랩셸: explodes only if a physical move hit it first this turn. */
export const SHELL_TRAP = 704;
/** 부리캐논: heats up first; a contact move on it burns the attacker. */
export const BEAK_BLAST = 690;
/** 점프킥, 무릎차기, 발꿈치찍기: half the user's bar on a miss. */
export const CRASH_MOVES = new Set([26, 136, 853, 916]);
/** 프레젠트: a present, or a quarter of a bar back. */
export const PRESENT = 217;
/** 목숨걸기: the user's HP, and the user. */
export const FINAL_GAMBIT = 515;
/** 다크홀: only 다크라이 can make it work. */
export const DARK_VOID = 464;
/** 절대영도: Ice types are immune; anything else is hit a fifth of the time. */
export const SHEER_COLD = 329;
/** 비장의무기: only once everything else it knows has been used. */
export const LAST_RESORT = 387;
/** 토해내기, 꿀꺽, 비축하기. */
export const STOCKPILE = 254;
export const SPIT_UP = 255;
export const SWALLOW = 256;
/** 치유파동, 플라워힐: heal the target. 정화: cure the target, heal the user. */
export const HEAL_TARGET = new Set([505, 666]);
export const PURIFY = 685;

/**
 * Multi-hit moves whose hits are not all alike.
 *
 * `powers` is each hit's power in turn — 트리플악셀 20/40/60, 트리플킥 10/20/30.
 * `each` rolls accuracy before every hit and stops at the first miss, as those
 * two and 네즈미산 do; every other multi-hit move rolls once for the whole move.
 */
export const MULTI_HIT: Record<number, { powers?: number[]; each?: boolean }> = {
  813: { powers: [20, 40, 60], each: true }, // 트리플악셀
  167: { powers: [10, 20, 30], each: true }, // 트리플킥
  860: { each: true }, // 네즈미산
};
/** 집단구타: one hit per healthy teammate, each at that teammate's own strength. */
export const BEAT_UP = 251;

/**
 * Moves that lock their user in for several turns.
 *
 * 'rampage' is 역린 and its kin: two or three turns, then the user is confused
 * from the exhaustion. 'rollout' is 구르기: five, each hit doubling. 'uproar'
 * is 소란피기: three, and nobody on the field can fall asleep meanwhile.
 * 'bide' is 참기: two turns taking it, then twice what was taken back.
 */
export const LOCK_MOVES: Record<number, 'rampage' | 'rollout' | 'uproar' | 'bide'> = {
  200: 'rampage', // 역린
  37: 'rampage', // 난동부리기
  80: 'rampage', // 꽃잎댄스
  833: 'rampage', // 레이징불
  205: 'rollout', // 구르기
  301: 'rollout', // 아이스볼
  253: 'uproar', // 소란피기
  117: 'bide', // 참기
};

/** 카운터 and 미러코트, and which kind of hit each sends back doubled. 메탈버스트 sends either back at half again. */
export const RETURN_MOVES: Record<number, { from: 'physical' | 'special' | 'any'; mult: number }> = {
  68: { from: 'physical', mult: 2 },
  243: { from: 'special', mult: 2 },
  368: { from: 'any', mult: 1.5 },
};

/** 분노: while the user keeps at it, every hit it takes raises its attack. */
export const RAGE = 99;
/** 충전: the next Electric move hits twice as hard. */
export const CHARGE = 268;
/** 웅크리기: 구르기 and 아이스볼 hit twice as hard afterwards. */
export const DEFENSE_CURL = 111;
/** 날개쉬기: the user loses its Flying type until the turn is over. */
export const ROOST = 355;
/** 베놈트랩: only works on a poisoned target. */
export const VENOM_DRENCH = 599;
/** 칼등치기, 봐주기: always leave the target on at least 1 HP. */
export const FALSE_SWIPES = new Set([206, 610]);
/** 떨어뜨리기, 사우전드애로: bring a flying target down to the ground. */
export const SMACK_DOWN_MOVES = new Set([479, 614]);
/** 철제광선, 마인드플레어: the user pays half its bar whether or not it lands. */
export const HALF_COST_MOVES = new Set([796, 720]);
/** 트라이어택: a fifth of the time, one of burn, paralysis or freeze. */
export const TRI_ATTACK = 161;
/** 비밀의힘: what it does depends on where the fight is. */
export const SECRET_POWER = 290;
/** 질투의불꽃: burns only a target whose stats rose this turn. */
export const BURNING_JEALOUSY = 807;
/** 지옥찌르기: two turns without sound moves. */
export const THROAT_CHOP = 675;
/** 용의분노 always does 40, 소닉붐 20. */
export const FIXED_DAMAGE: Record<number, number> = { 82: 40, 49: 20 };
/** 사이코웨이브: level × (50..150)%. Rolled in the fight, so not in `powerOf`. */
export const PSYWAVE = 149;
/** 와이드포스: half again as strong on Psychic Terrain. */
export const EXPANDING_FORCE = 797;
/** 그래스슬라이더: +1 priority on Grassy Terrain. */
export const GRASSY_GLIDE = 803;

/**
 * Moves that read somebody else's stats.
 *
 * 속임수 hits with the TARGET's attack; 바디프레스 with the user's own
 * defence; 사이코쇼크 and its kin are special moves that land on physical
 * defence. `ignoreStages` is DD래리어트 and 성스러운칼: the target's defence and
 * evasion changes do not count.
 */
export const STAT_READS: Record<number, { atk?: 'target-atk' | 'user-def'; def?: 'def'; ignoreStages?: boolean }> = {
  492: { atk: 'target-atk' }, // 속임수
  776: { atk: 'user-def' }, // 바디프레스
  473: { def: 'def' }, // 사이코쇼크
  540: { def: 'def' }, // 사이코브레이크
  548: { def: 'def' }, // 신비의칼
  663: { ignoreStages: true }, // DD래리어트
  533: { ignoreStages: true }, // 성스러운칼
};

/**
 * Sound moves — what 지옥찌르기 keeps its target from using. The list is the
 * games' own flag, over every move this table can hold.
 */
export const SOUND_MOVES = new Set([
  45, 46, 47, 48, 103, 173, 195, 215, 253, 304, 319, 320, 336, 405, 448, 496, 497, 547, 555, 568, 574, 575, 586,
  590, 664, 691, 728, 786, 826, 871, 914, 917,
]);

/**
 * Moves that thaw their user before they are used, and the target they hit.
 * Every Fire move thaws a frozen target as well; these do it from the user's
 * side too, and 열탕 and 열사의대지 are Water and Ground moves that do both.
 */
export const DEFROST_MOVES = new Set([172, 221, 394, 503, 558, 592, 682, 780, 815]);

/** Powder and spore moves: Grass types are immune to all of them. */
export const POWDER_MOVES = new Set([77, 78, 79, 147, 178, 476, 600]);
export const ICE_SPINNER = 861;
export const HARD_PRESS = 912;
export const TEMPER_FLARE = 915;
export const SUPERCELL_SLAM = 916;
export const UPPER_HAND = 918;
export const PSYCHIC_NOISE = 917;
export const ALLURING_VOICE = 914;
export const DOOM_DESIRE = 353;

/** Moves whose power this file computes. Anything else keeps its listed power. */
export const VARIABLE_POWER = new Set([
  681, // 기어오르기 — 어시스트파워와 같다
  284, 323, 820, 462, // 분화류, 묵사발 — HP
  162, 717, 877, // 분노의앞니, 자연의분노, 카타스트로피 — half the target's HP
  754, 755, 839, 875, 876, 804, 805, 788, 854, 889, 907, // conditional
  217, // 프레젠트
  69, 101, 162, 283, // 지구던지기, 나이트헤드, 분노의앞니, 죽기살기 — fixed damage
  67, 447, 484, 535, // 안다리걸기, 풀묶기, 헤비봄버, 히트스탬프 — weight
  360, 486, // 자이로볼, 일렉트릭볼 — speed
  175, 179, // 바둥바둥, 기사회생 — HP
  500, // 어시스트파워
  263, 506, 474, 362, 371, 419, 512, // conditional doubles
  205, 301, 210, 497, // 구르기, 아이스볼, 연속자르기, 에코보이스 — repeated use
  279, 707, 808, 372, 514, // 리벤지, 분함의발구르기, 분풀이, 승부굳히기, 원수갚기
  797, // 와이드포스
  216, 218, // 은혜갚기, 화풀이 — friendship
  311, 76, 669, // 웨더볼, 솔라빔, 솔라블레이드 — weather
  912, 915, // 하드프레스, 열불내기
]);

/** Flying types are the only ones this app treats as off the ground. */
export function grounded(types: readonly MoveType[]): boolean {
  return !types.includes('flying');
}

/** Damage multiplier the weather puts on a move of this type. */
export function weatherPowerMult(weather: Weather | null, type: MoveType): number {
  if (weather === 'rain') return type === 'water' ? 1.5 : type === 'fire' ? 0.5 : 1;
  if (weather === 'sun') return type === 'fire' ? 1.5 : type === 'water' ? 0.5 : 1;
  return 1;
}

/**
 * The accuracy the weather forces on a move, or null to leave it alone.
 *
 * 0 is "never misses", the same reading `MoveInfo.accuracy` already has.
 * 번개 and 폭풍 cannot miss in rain and drop to 50 in sun; 눈보라 cannot miss in
 * hail or snow.
 */
export function weatherAccuracy(weather: Weather | null, moveId: number): number | null {
  const stormy = moveId === 87 || moveId === 542;
  if (stormy && weather === 'rain') return 0;
  if (stormy && weather === 'sun') return 50;
  if (moveId === 59 && (weather === 'hail' || weather === 'snow')) return 0;
  return null;
}

/** Whether this weather chips a Pokemon of these types for 1/16 each turn. */
export function weatherChips(weather: Weather | null, types: readonly MoveType[]): boolean {
  if (weather === 'sand') return !types.some((t) => t === 'rock' || t === 'ground' || t === 'steel');
  if (weather === 'hail') return !types.includes('ice');
  return false;
}

/**
 * What the weather does to a defending stat: sand gives Rock types half again
 * their special defence, snow gives Ice types half again their defence.
 */
export function weatherDefenceMult(weather: Weather | null, types: readonly MoveType[], physical: boolean): number {
  if (weather === 'sand' && !physical && types.includes('rock')) return 1.5;
  if (weather === 'snow' && physical && types.includes('ice')) return 1.5;
  return 1;
}

/**
 * What a terrain does to a move's damage.
 *
 * The boosts need the ATTACKER grounded; Misty's dragon cut and Grassy's
 * Earthquake cut need the TARGET grounded. 1.3 is the Gen 8+ figure.
 */
export function terrainPowerMult(
  terrain: Terrain | null,
  move: MoveInfo | null,
  type: MoveType,
  userGrounded: boolean,
  targetGrounded: boolean,
): number {
  if (!terrain) return 1;
  if (userGrounded) {
    if (terrain === 'electric' && type === 'electric') return 1.3;
    if (terrain === 'grassy' && type === 'grass') return 1.3;
    if (terrain === 'psychic' && type === 'psychic') return 1.3;
  }
  if (targetGrounded) {
    if (terrain === 'misty' && type === 'dragon') return 0.5;
    if (terrain === 'grassy' && move && (move.id === 89 || move.id === 523)) return 0.5;
  }
  return 1;
}

/**
 * Whether the field stops this condition landing on this target.
 *
 * Sun never freezes anything; Electric Terrain keeps the grounded awake; Misty
 * Terrain keeps the grounded free of every non-volatile condition and of
 * confusion.
 */
export function fieldBlocks(
  weather: Weather | null,
  terrain: Terrain | null,
  condition: string,
  targetGrounded: boolean,
  nonVolatile: boolean,
): boolean {
  if (weather === 'sun' && condition === 'freeze') return true;
  if (!targetGrounded) return false;
  if (terrain === 'electric' && condition === 'sleep') return true;
  if (terrain === 'misty' && (nonVolatile || condition === 'confusion')) return true;
  return false;
}

/** What 웨더볼 turns into. */
export function weatherBallType(weather: Weather | null): MoveType {
  switch (weather) {
    case 'rain':
      return 'water';
    case 'sun':
      return 'fire';
    case 'sand':
      return 'rock';
    case 'hail':
    case 'snow':
      return 'ice';
    default:
      return 'normal';
  }
}

/** One side, as `powerOf` needs to see it. */
export type PowerSide = {
  hp: number;
  maxHp: number;
  /** Effective speed this turn, stages and Tailwind included. */
  speed: number;
  weightKg: number;
  status: string | null;
  /** Sum of every positive stage, for 어시스트파워. */
  boosts: number;
  /** 255 for the companion, 70 for anything else. See `friendshipOf`. */
  friendship: number;
};

export type PowerContext = {
  user: PowerSide;
  target: PowerSide;
  weather: Weather | null;
  /** The target has already moved this turn — 보복. */
  targetMovedFirst: boolean;
  /** The user was hit by the target earlier this turn — 눈사태. */
  userWasHit: boolean;
  /** How many turns in a row this same move has now been used, 1 on the first. */
  streak: number;
  /** The user's last move failed — 열불내기, 분함의발구르기. */
  userLastFailed?: boolean;
  /** The target has already taken damage this turn — 승부굳히기. */
  targetWasHit?: boolean;
  /** The user's stats fell this turn — 분풀이. */
  userStatsFell?: boolean;
  /** One of the user's team fainted last turn — 원수갚기. */
  allyFainted?: boolean;
  /** The user used 웅크리기 while out — 구르기, 아이스볼. */
  curled?: boolean;
  /** The target has not moved yet this turn — 전격부리. */
  targetYetToMove?: boolean;
  /** Gravity is up — G의힘. */
  gravity?: boolean;
  /** Teammates of the user that have fainted — 성묘. */
  fallen?: number;
  /** Times the user has been hit this fight — 분노의주먹. */
  timesHit?: number;
  /** A roll, for the moves whose power is dice — 프레젠트, 변덕레이저. */
  roll?: number;
  /** The terrain, and whether the user stands on it — 와이드포스. */
  terrain?: Terrain | null;
  userGrounded?: boolean;
};

/** What a damaging move does this time: a power, or a fixed amount, and its type. */
export type Power = { power: number; fixed: number | null; type: MoveType };

const NON_VOLATILE = new Set(['burn', 'poison', 'toxic', 'paralysis', 'sleep', 'freeze']);

/**
 * Friendship, for 은혜갚기 and 화풀이.
 *
 * The companion is the one Pokemon here anybody has raised, so it is at the
 * top of the scale; anything else sits at 70, what a wild Pokemon has in the
 * games. So the companion's 은혜갚기 hits for 102 and its 화풀이 for 1, as a
 * much-loved Pokemon's do.
 */
export const COMPANION_FRIENDSHIP = 255;
export const DEFAULT_FRIENDSHIP = 70;

/**
 * A move's power this turn, for the moves whose power the games compute.
 *
 * Returns the move's own figure for everything outside VARIABLE_POWER. `fixed`
 * is set for the moves that deal an amount rather than a power — 지구던지기's
 * 50 at level 50, 분노의앞니's half — which skip the damage formula entirely.
 */
export function powerOf(move: MoveInfo, ctx: PowerContext, level: number, fallback: number): Power {
  const { user, target } = ctx;
  const base = move.power || fallback;
  const plain: Power = { power: base, fixed: null, type: move.type };
  switch (move.id) {
    case 69: // 지구던지기
    case 101: // 나이트헤드
      return { power: 0, fixed: level, type: move.type };
    case 162: // 분노의앞니
      return { power: 0, fixed: Math.max(1, Math.floor(target.hp / 2)), type: move.type };
    case 283: // 죽기살기
      return { power: 0, fixed: Math.max(0, target.hp - user.hp), type: move.type };
    case 67: // 안다리걸기
    case 447: {
      // 풀묶기
      const w = target.weightKg;
      return { ...plain, power: w < 10 ? 20 : w < 25 ? 40 : w < 50 ? 60 : w < 100 ? 80 : w < 200 ? 100 : 120 };
    }
    case 484: // 헤비봄버
    case 535: {
      // 히트스탬프
      const r = user.weightKg / Math.max(0.1, target.weightKg);
      return { ...plain, power: r >= 5 ? 120 : r >= 4 ? 100 : r >= 3 ? 80 : r >= 2 ? 60 : 40 };
    }
    case 360: // 자이로볼
      return { ...plain, power: Math.min(150, Math.floor((25 * target.speed) / Math.max(1, user.speed)) + 1) };
    case 486: {
      // 일렉트릭볼
      const r = user.speed / Math.max(1, target.speed);
      return { ...plain, power: r >= 4 ? 150 : r >= 3 ? 120 : r >= 2 ? 80 : r >= 1 ? 60 : 40 };
    }
    case 175: // 바둥바둥
    case 179: {
      // 기사회생
      const p = Math.floor((48 * user.hp) / Math.max(1, user.maxHp));
      return { ...plain, power: p <= 1 ? 200 : p <= 4 ? 150 : p <= 9 ? 100 : p <= 16 ? 80 : p <= 32 ? 40 : 20 };
    }
    case 500: // 어시스트파워
    case 681: // 기어오르기
      return { ...plain, power: 20 + 20 * user.boosts };
    case 284: // 분화
    case 323: // 해수스파우팅
    case 820: // 드래곤에너지
      return { ...plain, power: Math.max(1, Math.floor((150 * user.hp) / Math.max(1, user.maxHp))) };
    case 462: // 묵사발
      return { ...plain, power: Math.max(1, Math.floor((120 * target.hp) / Math.max(1, target.maxHp))) };
    case 717: // 자연의분노
    case 877: // 카타스트로피
      return { power: 0, fixed: Math.max(1, Math.floor(target.hp / 2)), type: move.type };
    case 754: // 전격부리
    case 755: // 아가미물기
      return ctx.targetYetToMove ? { ...plain, power: base * 2 } : plain;
    case 839: // 독침천발
      return target.status === 'poison' || target.status === 'toxic' ? { ...plain, power: base * 2 } : plain;
    case 875: // 사이코블레이드
      return ctx.terrain === 'electric' ? { ...plain, power: Math.floor(base * 1.5) } : plain;
    case 876: // 하이드로스팀: sun makes it stronger, not weaker — the halving is undone in the fight
      return plain;
    case 804: // 라이징볼트
      return ctx.terrain === 'electric' ? { ...plain, power: base * 2 } : plain;
    case 805: // 대지의파동
      return ctx.terrain && ctx.userGrounded
        ? { power: base * 2, fixed: null, type: TERRAIN_TYPE[ctx.terrain] }
        : plain;
    case 788: // G의힘
      return ctx.gravity ? { ...plain, power: Math.floor(base * 1.5) } : plain;
    case 854: // 성묘
      return { ...plain, power: Math.min(300, base + 50 * (ctx.fallen ?? 0)) };
    case 889: // 분노의주먹
      return { ...plain, power: Math.min(350, base + 50 * (ctx.timesHit ?? 0)) };
    case 907: // 변덕레이저
      return (ctx.roll ?? 1) < 0.3 ? { ...plain, power: base * 2 } : plain;
    case 217: {
      // 프레젠트: 40 / 80 / 120, or a heal the fight hands out instead (power 0)
      const r = ctx.roll ?? 0;
      return { ...plain, power: r < 0.4 ? 40 : r < 0.7 ? 80 : r < 0.8 ? 120 : 0 };
    }
    case 263: // 객기
      return user.status && user.status !== 'sleep' && user.status !== 'freeze' ? { ...plain, power: base * 2 } : plain;
    case 506: // 병상첨병
      return target.status && NON_VOLATILE.has(target.status) ? { ...plain, power: base * 2 } : plain;
    case 474: // 베놈쇼크
      return target.status === 'poison' || target.status === 'toxic' ? { ...plain, power: base * 2 } : plain;
    case 362: // 소금물
      return target.hp * 2 <= target.maxHp ? { ...plain, power: base * 2 } : plain;
    case 371: // 보복
      return ctx.targetMovedFirst ? { ...plain, power: base * 2 } : plain;
    case 419: // 눈사태
      return ctx.userWasHit ? { ...plain, power: base * 2 } : plain;
    case 512: // 애크러뱃: nothing here holds an item
      return { ...plain, power: base * 2 };
    case 205: // 구르기: doubles for five turns, then starts over
    case 301: // 아이스볼
      return { ...plain, power: base * 2 ** ((ctx.streak - 1) % 5) * (ctx.curled ? 2 : 1) };
    case 279: // 리벤지
      return ctx.userWasHit ? { ...plain, power: base * 2 } : plain;
    case 707: // 분함의발구르기
      return ctx.userLastFailed ? { ...plain, power: base * 2 } : plain;
    case 808: // 분풀이
      return ctx.userStatsFell ? { ...plain, power: base * 2 } : plain;
    case 372: // 승부굳히기
      return ctx.targetWasHit ? { ...plain, power: base * 2 } : plain;
    case 514: // 원수갚기
      return ctx.allyFainted ? { ...plain, power: base * 2 } : plain;
    case 797: // 와이드포스
      return ctx.terrain === 'psychic' && ctx.userGrounded ? { ...plain, power: Math.floor(base * 1.5) } : plain;
    case 210: // 연속자르기
      return { ...plain, power: Math.min(160, base * 2 ** (ctx.streak - 1)) };
    case 497: // 에코보이스
      return { ...plain, power: Math.min(200, base * ctx.streak) };
    case 216: // 은혜갚기
      return { ...plain, power: Math.max(1, Math.floor(user.friendship / 2.5)) };
    case 218: // 화풀이
      return { ...plain, power: Math.max(1, Math.floor((255 - user.friendship) / 2.5)) };
    case 311: // 웨더볼
      return ctx.weather ? { power: 100, fixed: null, type: weatherBallType(ctx.weather) } : plain;
    case 912: // 하드프레스
      return { ...plain, power: Math.max(1, Math.floor((100 * target.hp) / Math.max(1, target.maxHp))) };
    case 915: // 열불내기
      return ctx.userLastFailed ? { ...plain, power: base * 2 } : plain;
    case 76: // 솔라빔
    case 669: // 솔라블레이드
      return ctx.weather && ctx.weather !== 'sun' ? { ...plain, power: Math.floor(base / 2) } : plain;
    default:
      return plain;
  }
}

/**
 * What 아침햇살, 광합성 and 달빛 heal, which the weather decides: two thirds in
 * sun, a quarter under any other weather, half otherwise. Null for every other
 * healing move, which heals what the data says.
 */
export function weatherHealShare(move: MoveInfo, weather: Weather | null): number | null {
  if (move.id !== 234 && move.id !== 235 && move.id !== 236) return null;
  if (weather === 'sun') return 2 / 3;
  if (weather) return 1 / 4;
  return 1 / 2;
}
