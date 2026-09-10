/**
 * A complete /api/state payload, shared by the panel's UI tests.
 *
 * Extracted from tabs.test.tsx when a second suite needed it. Two copies would
 * drift, and a payload that no longer matches the real shape makes every test
 * built on it quietly meaningless.
 */
export const STATE = {
  tokens: {
    total: 1_700_000_000,
    today: 390_000_000,
    todayMessages: 1400,
    messageCount: 7000,
    lifetime: 26_000_000,
    byDay: { '2026-08-20': 183_000_000, '2026-08-21': 390_000_000 },
    byEntrypoint: { 'claude-vscode': 1_600_000_000, cli: 20_000_000 },
    byModel: { 'claude-opus-5': 1_000_000_000, 'claude-sonnet-5': 700_000_000 },
    mode: 'activity',
  },
  companion: {
    speciesId: 667,
    name: '레오꼬',
    nameEn: 'Litleo',
    stageIndex: 0,
    stageCount: 2,
    isShiny: false,
    rarity: 'common',
    nature: 'hardy',
    nickname: null,
    sprite: '667-w.gif',
    backSprite: '667-wb.gif',
    types: [
      { id: 'fire', name: '불꽃' },
      { id: 'normal', name: '노말' },
    ],
    genus: '작은사자포켓몬',
    heightM: 0.6,
    weightKg: 13.5,
    withYou: 41_000_000,
    path: [
      { id: 667, name: '레오꼬' },
      { id: 668, name: '화염레오' },
    ],
    displayId: 667,
    /**
     * Typed rather than left as `never[]`: a test that overrides one of these
     * with a real row would otherwise be rejected by the compiler while
     * passing at runtime, which is the least useful combination there is.
     */
    form: null as { id: number; kind: string; ko: string } | null,
    fusions: [] as {
      id: number;
      ko: string;
      partner: number;
      partnerKo: string;
      sprite: string | null;
    }[],
    forms: [] as {
      id: number;
      kind: string;
      ko: string;
      stone: { ko: string; have: boolean } | null;
      item: boolean;
      ready: boolean;
    }[],
    battleForm: null as { id: number; kind: string; ko: string; sprite: string | null } | null,
  },
  eggSprite: null,
  progress: { phase: 'growing', have: 8_000_000, need: 40_000_000, ratio: 0.2 },
  dex: [
    {
      speciesId: 25,
      name: '피카츄',
      shiny: true,
      sprite: '25-ash.gif',
      rarity: 'common',
      generation: 1,
      types: [{ id: 'electric', name: '전기' }],
    },
    {
      speciesId: 6,
      name: '리자몽',
      shiny: false,
      sprite: '6-a.gif',
      rarity: 'rare',
      generation: 1,
      types: [
        { id: 'fire', name: '불꽃' },
        { id: 'flying', name: '비행' },
      ],
    },
    {
      speciesId: 906,
      name: '나오하',
      shiny: false,
      sprite: '906-w.gif',
      rarity: 'rare',
      generation: 9,
      types: [{ id: 'grass', name: '풀' }],
    },
  ],
  dexTotal: 1025,
  retiredCount: 2,
  hatchThreshold: 26_701_053,
  /*
   * Hand-written, but the numbers are the real ones for this threshold:
   * key-stone 20x and egg-legendary 80x of 26,701,053, and rare-candy
   * 0.3x of the CURRENT milestone — 레오꼬 is common at stage 0, so that
   * is 4 x 26,701,053, not the threshold itself.
   *
   * The wallet is deliberately between them: candy affordable, the other
   * two not, which is what the afford/can't-afford rendering needs.
   */
  shop: {
    wallet: 43_000_000,
    clerk: 'npc-waitress.png' as string | null,
    products: [
      { id: 'rare-candy', name: '이상한사탕', desc: '진행도 +25%', kind: 'item', group: 'growth', price: 32_041_264, sprite: 'item-rare-candy.png', owned: false },
      { id: 'key-stone', name: '키스톤', desc: '배틀에서 메가진화', kind: 'item', group: 'evolution', price: 534_021_060, sprite: 'item-key-stone.png', owned: false },
      { id: 'egg-legendary', name: '전설의 알', desc: '전설 보장', kind: 'egg', group: 'egg', price: 2_136_084_240, sprite: null, owned: false },
    ],
  },
  bag: {
    inventory: { 'rare-candy': 2 } as Record<string, number | undefined>,
    everstone: false,
    showBattleForm: false,
    shinyCharmActive: false,
    forcedRarity: null,
    stones: [] as {
      id: number;
      ko: string;
      formKo: string;
      count: number;
      usable: boolean;
      sprite: string | null;
    }[],
  },
  hunt: {
    enabled: true,
    tokens: 4_200_000,
    cap: 80_103_159,
    uncapped: false,
    count: 37,
    sinceBirth: { tokens: 1_200_000, count: 14 },
    /** 회색시티 — a Kanto gym town, so no shut shrine shadows it. */
    stop: { ko: '회색시티', region: '관동', terrain: 'town' as const, sky: 'city' as const },
    shrines: { open: 2, total: 36 },
    intervalMs: 300_000,
    slots: 4,
    nextInMs: 92_000,
    speed: 1.25,
    idleReason: null,
    log: [
      {
        seq: 36,
        wildId: 19,
        tokens: 112_000,
        moveId: 53,
        wildName: '꼬렛',
        moveName: '화염방사',
        wildSprite: '19-a.gif',
        icon: '19-s.png',
      },
      {
        seq: 35,
        wildId: 16,
        tokens: 74_000,
        moveId: null,
        wildName: '구구',
        moveName: null,
        wildSprite: null,
        icon: null,
      },
    ],
  },
  moves: [
    {
      id: 53,
      name: '화염방사',
      nameEn: 'Flamethrower',
      type: 'fire',
      typeName: '불꽃',
      power: 90,
      accuracy: 100,
      pp: 15,
      damageClass: 'special',
      sprite: 'item-tm-fire.png',
    },
  ],
  tms: [
    {
      id: 63,
      name: '파괴광선',
      nameEn: 'Hyper Beam',
      type: 'normal',
      typeName: '노말',
      power: 150,
      accuracy: 90,
      pp: 5,
      damageClass: 'special',
      sprite: 'item-tm-normal.png',
      count: 2,
    },
  ],
  unusableTmCount: 1,
  sprites: { bytes: 3_670_016, files: 42 },
  /** Two rows, one of each state — enough to render the board and its gauge. */
  legends: {
    items: [
      { slug: 'adamant-orb', ko: '금강옥', count: 1, forKo: '디아루가', sprite: null },
    ],
    shards: [
      { slug: 'azure-flute', ko: '천계의피리', count: 4, need: 12, ready: false, sprite: null },
    ],
    eggs: [{ speciesId: 144, ko: '프리져', count: 1, sprite: null }],
    waiting: null,
    gates: [
      {
        speciesId: 144, ko: '프리져', tier: 'sub', myth: false, gen: 1,
        how: '관동 도감 40종', have: 40, need: 40, ratio: 1,
        itemKo: null, source: null, ready: true, held: false, open: true, done: false,
      },
      {
        speciesId: 150, ko: '뮤츠', tier: 'box', myth: false, gen: 1,
        how: '도감 300종 · 트레이너 80승', have: 12, need: 300, ratio: 0.04,
        itemKo: null, source: null, ready: false, held: false, open: false, done: false,
      },
    ],
  },
  /** One of each state: done, locked, repeating, and a second category. */
  /** A league party half built: two seats filled, one of them armed. */
  party: {
    size: 6,
    ready: false,
    cityKo: '석영고원',
    members: [
      {
        speciesId: 6,
        name: '리자몽',
        shiny: false,
        sprite: '6-a.gif',
        moves: [
          { id: 53, name: '화염방사', nameEn: 'Flamethrower', type: 'fire', typeName: '불꽃', power: 90, accuracy: 100, pp: 15, damageClass: 'special' as const },
        ],
        canTake: [63],
        free: [
          { id: 17, name: '날개치기', nameEn: 'Wing Attack', type: 'flying', typeName: '비행', power: 60, accuracy: 100, pp: 35, damageClass: 'physical' as const },
        ],
      },
      {
        speciesId: 9,
        name: '거북왕',
        shiny: false,
        sprite: '9-a.gif',
        moves: [],
        canTake: [],
        free: [],
      },
    ],
  },
  /**
   * The badge case, with one of each state the card has to draw: earned,
   * still ahead on the road, and shut behind the other seven.
   */
  badges: {
    count: 1,
    total: 8,
    wins: 3,
    league: {
      cityKo: '석영고원',
      open: false,
      at: null,
      size: 5,
      best: 2,
      wins: 0,
      clearedAt: null,
      until: 5972,
      members: [
        { id: 'lorelei', ko: '사천왕 칸나', down: false, sprite: 'npc-lorelei-gen1.png' },
        { id: 'bruno', ko: '사천왕 시바', down: false, sprite: 'npc-bruno.png' },
        { id: 'agatha', ko: '사천왕 국화', down: false, sprite: 'npc-agatha-gen1.png' },
        { id: 'lance', ko: '사천왕 목호', down: false, sprite: 'npc-lance.png' },
        { id: 'blue', ko: '챔피언 그린', down: false, sprite: 'npc-blue.png' },
      ],
    },
    cases: [
      { no: 1, ko: '회색배지', leaderKo: '웅', cityKo: '회색시티', have: true, locked: false, until: 0, prizeKo: '암석봉인', sprite: 'badge-1.png' },
      { no: 2, ko: '블루배지', leaderKo: '이슬', cityKo: '블루시티', have: false, locked: false, until: 47, prizeKo: '물의파동', sprite: 'badge-2.png' },
      { no: 3, ko: '오렌지배지', leaderKo: '마티스', cityKo: '갈색시티', have: false, locked: false, until: 72, prizeKo: '전격파', sprite: 'badge-3.png' },
      { no: 4, ko: '무지개배지', leaderKo: '민화', cityKo: '무지개시티', have: false, locked: false, until: 197, prizeKo: '기가드레인', sprite: 'badge-4.png' },
      { no: 5, ko: '핑크배지', leaderKo: '독수', cityKo: '연분홍시티', have: false, locked: false, until: 272, prizeKo: '맹독', sprite: 'badge-5.png' },
      { no: 6, ko: '골드배지', leaderKo: '초련', cityKo: '노랑시티', have: false, locked: false, until: 247, prizeKo: '명상', sprite: 'badge-6.png' },
      { no: 7, ko: '진홍색배지', leaderKo: '강연', cityKo: '홍련섬', have: false, locked: false, until: 322, prizeKo: '불대문자', sprite: 'badge-7.png' },
      { no: 8, ko: '그린배지', leaderKo: '비주기', cityKo: '상록시티', have: false, locked: true, until: 5947, prizeKo: '지진', sprite: 'badge-8.png' },
    ],
  },
  awards: [
    {
      id: 'raise-1',
      cat: 'raise',
      catKo: '육성',
      ko: '첫 졸업',
      desc: '한 마리를 도감으로 떠나보냈다.',
      have: 2,
      need: 1,
      ratio: 1,
      at: 1_700_000_000_000,
      repeat: null,
      times: 0,
      money: 5_000_000,
      itemKo: null,
      itemSprite: null,
    },
    {
      id: 'raise-repeat',
      cat: 'raise',
      catKo: '육성',
      ko: '잘 가',
      desc: '열 마리를 떠나보낼 때마다.',
      have: 22,
      need: 30,
      ratio: 0.2,
      at: null,
      repeat: 10,
      times: 2,
      money: 4_000_000,
      itemKo: null,
      itemSprite: null,
    },
    {
      id: 'dex-50',
      cat: 'dex',
      catKo: '도감',
      ko: '도감 50종',
      desc: '쉰 종류를 도감에 등록했다.',
      have: 3,
      need: 50,
      ratio: 0.06,
      at: null,
      repeat: null,
      times: 0,
      money: 10_000_000,
      itemKo: '반짝반짝부적',
      itemSprite: null,
    },
  ],
  events: [],
  generatedAt: '2026-08-21T12:25:00.000Z',
};

/**
 * A /api/dex/:id payload, for the entry-screen tests.
 *
 * Charizard, because it is the one species whose real matchups exercise every
 * bucket — 4x, 2x, 0.5x, 0.25x and 0 — and the values here are the ones
 * server/moves.ts's chart actually produces.
 */
export const DEX_ENTRY = {
  speciesId: 6,
  name: '리자몽',
  nameEn: 'Charizard',
  genus: '화염포켓몬',
  types: [
    { id: 'fire', name: '불꽃' },
    { id: 'flying', name: '비행' },
  ],
  heightM: 1.7,
  weightKg: 90.5,
  rarity: 'rare',
  generation: 1,
  sprite: '6-a.gif',
  flavor: '지상 1400m까지 날개를 사용해 날 수 있다.',
  stats: [
    { name: 'HP', value: 78 },
    { name: '공격', value: 84 },
    { name: '방어', value: 78 },
    { name: '특수공격', value: 109 },
    { name: '특수방어', value: 85 },
    { name: '스피드', value: 100 },
  ],
  statTotal: 534,
  abilities: [
    { ko: '맹화', desc: 'HP가 줄어들면 불꽃타입의 기술의 위력이 올라간다.', hidden: false },
    { ko: '태양의힘', desc: '쾌청일 때 특수공격이 올라간다.', hidden: true },
  ],
  matchups: [
    { factor: 4, types: [{ id: 'rock', name: '바위' }] },
    {
      factor: 2,
      types: [
        { id: 'water', name: '물' },
        { id: 'electric', name: '전기' },
      ],
    },
    { factor: 0.5, types: [{ id: 'fighting', name: '격투' }] },
    { factor: 0.25, types: [{ id: 'bug', name: '벌레' }] },
    { factor: 0, types: [{ id: 'ground', name: '땅' }] },
  ],
  stages: [
    [{ speciesId: 4, name: '파이리', collected: false, here: false }],
    [{ speciesId: 5, name: '리자드', collected: false, here: false }],
    [{ speciesId: 6, name: '리자몽', collected: true, here: true }],
  ],
  forms: [
    { id: 10034, kind: 'mega' as const, ko: '메가리자몽X', power: 1.187 },
    { id: 10035, kind: 'mega' as const, ko: '메가리자몽Y', power: 1.187 },
  ],
  tmCount: 111,
  mine: { firstSeenAt: 1_755_000_000_000, nickname: '불덩이', shiny: false, formKo: null },
};
