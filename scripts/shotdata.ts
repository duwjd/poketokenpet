/**
 * The demo payloads the README screenshots are taken against.
 *
 * NOT the machine owner's save. `scripts/gen-shots.ts` serves these instead of
 * `/api/state`, and `scripts/shot-app.mjs` additionally cancels every `/api/*`
 * request at the session level, so the real `buildState` is unreachable by
 * construction rather than by discipline. That matters because the 기록 tab
 * charts which Claude clients you use and your last fourteen days of activity —
 * true of the app, wrong for a picture on the internet.
 *
 * ## Why the species list is hardcoded
 *
 * The obvious move is to read `~/.poketokenpet/sprites/` and use whatever is
 * cached. That makes the output depend on whose machine ran the generator,
 * which is the one property a committed artifact must not have. Instead the ids
 * below are fixed and `ensureSprite` fetches any that are missing — the same
 * call the app itself makes. A cold cache costs a minute of network, not a
 * different screenshot.
 *
 * Nothing here writes a Pokémon asset into the repository. `ensureSprite`
 * caches into `~/.poketokenpet/`, exactly as the running app does, and the
 * screenshots are pictures of the app rather than copies of its art.
 *
 * ## Why not import test/ui/state-fixture.ts
 *
 * `tsconfig.node.json` deliberately excludes `test/ui` and hands it to
 * `tsconfig.app.json` instead, so a `scripts/` → `test/ui/` import would drag a
 * DOM-project file into the node project. The shapes are kept honest by
 * `test/shotdata-shape.test.ts` comparing the two key sets instead.
 */
import {
  ensureBackground,
  ensureEggSprite,
  ensureEffect,
  ensureItemSprite,
  ensureNpcSprite,
  ensureSprite,
} from '../server/sprites.ts';
import { NAMES, NATURE_KO, speciesName } from '../server/species.ts';
import { speciesInfo, TYPE_KO } from '../server/moves.ts';
import { generationOf, rarityOfSpecies } from '../server/dex.ts';
import { PRODUCTS } from '../server/shop.ts';
import { dexStatic } from '../server/dexentry.ts';
import { FX_SLUGS, effectFor } from '../server/movefx.ts';
import { journeyFor } from '../src/journey.ts';

/**
 * The dex grid, hand-picked.
 *
 * Chosen to read as "a collection someone actually built": every generation
 * represented, the shapes varied so the grid does not turn into a row of
 * lookalikes, and the recognisable ones up front because the grid is sorted by
 * id and the top rows are what survives the README's crop.
 */
const DEX_IDS = [
  1, 4, 6, 7, 9, 12, 25, 26, 39, 52, 59, 65, 68, 76, 91, 94, 112, 130, 131, 133,
  143, 149, 155, 158, 196, 197, 212, 229, 248, 254, 257, 260, 282, 289, 359,
  392, 395, 448, 460, 470, 471, 493, 555, 609, 612, 658, 700, 887,
];

/** The two that show as shiny — enough to make the ✨ marker legible. */
const SHINY_IDS = new Set([25, 448]);

/** The pet, its foe, and the region the journey is standing in for the shots. */
const ME = 6; // 리자몽 — a stage-2 fire type, so the type chips read at a glance
const FOE = 94; // 팬텀
const HUNT_COUNT = 412;

function must<T>(v: T | null, what: string): T {
  if (v === null) {
    throw new Error(
      `gen:shots — could not resolve ${what}. The sprite host may be down; ` +
        `re-run when it is back. Nothing was written.`,
    );
  }
  return v;
}

function typesOf(id: number) {
  const info = speciesInfo(id);
  if (!info) throw new Error(`gen:shots — no species info for #${id}`);
  return info.types.map((t) => ({ id: t, name: TYPE_KO[t] }));
}

/** One battle turn. Spelled out because SceneTurn has no defaults. */
function turn(o: {
  moveName: string;
  moveType: string;
  damage: number;
  effect: number;
  foeHpAfter: number;
  myHpAfter: number;
  crit?: boolean;
  foeActed?: boolean;
  foeMoveName?: string;
  foeMoveType?: string;
  foeEffect?: number;
}) {
  return {
    moveName: o.moveName,
    moveType: o.moveType,
    damage: o.damage,
    crit: o.crit ?? false,
    missed: false,
    effect: o.effect,
    foeHpAfter: o.foeHpAfter,
    foeActed: o.foeActed ?? true,
    foeMoveName: o.foeMoveName ?? '섀도볼',
    foeMoveType: o.foeMoveType ?? 'ghost',
    foeEffect: o.foeEffect ?? 1,
    moveClass: 'special',
    foeMoveClass: 'special',
    ailmentKo: null,
    foeAilmentKo: null,
    selfEffect: null,
    foeStatusKo: null,
    myStatusKo: null,
    counter: 0,
    myHpAfter: o.myHpAfter,
  };
}

/**
 * The battle the shot is aimed at.
 *
 * Exactly ONE turn carries `effect: 2`, which makes `Scene` print
 * "효과가 굉장했다!" on exactly one beat. That single unambiguous string is the
 * wait condition `shot-app.mjs` polls for — without it there is no way to know
 * which of five 750ms windows the capture landed in.
 */
const BATTLE = {
  foeMaxHp: 148,
  myMaxHp: 162,
  turns: [
    turn({ moveName: '화염방사', moveType: 'fire', damage: 41, effect: 1, foeHpAfter: 107, myHpAfter: 138 }),
    turn({ moveName: '섀도크루', moveType: 'ghost', damage: 62, effect: 2, foeHpAfter: 45, myHpAfter: 121 }),
    turn({ moveName: '화염방사', moveType: 'fire', damage: 45, effect: 1, foeHpAfter: 0, myHpAfter: 121, crit: true, foeActed: false }),
  ],
};

export type ShotPayloads = {
  /** Before the encounter lands — the walking/travel scene. */
  stateA: Record<string, unknown>;
  /** One new encounter newer than A, which is what arms the battle. */
  stateB: Record<string, unknown>;
  index: unknown[];
  entry: Record<string, unknown>;
  /** Which species ids were used, for the generator's manifest line. */
  dexIds: number[];
};

export async function buildPayloads(): Promise<ShotPayloads> {
  for (const id of [...DEX_IDS, ME, FOE]) {
    if (!NAMES[id]) throw new Error(`gen:shots — #${id} is not a known species`);
  }

  // Every sprite the shots reference, resolved up front so a miss fails here
  // with a name rather than rendering an empty card three steps later.
  const sprites = new Map<number, string>();
  for (const id of DEX_IDS) {
    const shiny = SHINY_IDS.has(id);
    sprites.set(id, must(await ensureSprite(id, shiny), `sprite for #${id}`));
  }
  const mySprite = must(await ensureSprite(ME), `sprite for #${ME}`);
  const myBack = must(await ensureSprite(ME, false, true), `back sprite for #${ME}`);
  const foeSprite = must(await ensureSprite(FOE), `sprite for #${FOE}`);
  const clerk = await ensureNpcSprite('waitress');
  const stop = journeyFor(HUNT_COUNT);
  const skylineBg = await ensureBackground(stop.sky);
  const battleBg = await ensureBackground('forest');

  const fx: Record<string, string | null> = {};
  for (const slug of FX_SLUGS) fx[slug] = await ensureEffect(slug);

  /**
   * The real shelf, priced by hand.
   *
   * `priceOf` needs a whole GameState and this file has none — building a fake
   * one to price nine rows would be a second, worse copy of the save format.
   * The numbers below are the real multipliers applied to the threshold above,
   * so the shop still reads as a coherent economy against the wallet.
   */
  const eggIcon = await ensureEggSprite();
  const PRICE: Record<string, number> = {
    'rare-candy': 32_041_264,
    'shiny-charm': 133_505_265,
    everstone: 26_701_053,
    'key-stone': 534_021_060,
    'dynamax-band': 534_021_060,
    'dna-splicers': 400_515_795,
    'egg-common': 53_402_106,
    'egg-uncommon': 106_804_212,
    'egg-rare': 267_010_530,
    'egg-legendary': 2_136_084_240,
  };
  const products = [];
  for (const p of PRODUCTS) {
    products.push({
      id: p.id,
      name: p.name,
      desc: p.desc,
      kind: p.kind,
      group: p.group,
      award: p.award ?? false,
      rarity: p.rarity,
      price: PRICE[p.id] ?? 26_701_053,
      owned: p.id === 'key-stone' || p.id === 'dynamax-band',
      sprite: p.sprite ? await ensureItemSprite(p.sprite) : p.kind === 'egg' ? eggIcon : null,
    });
  }

  const dex = DEX_IDS.map((id) => ({
    speciesId: id,
    name: speciesName(id),
    shiny: SHINY_IDS.has(id),
    sprite: sprites.get(id)!,
    rarity: rarityOfSpecies(id),
    generation: generationOf(id),
    types: typesOf(id),
  }));

  const tmTypes = ['fire', 'water', 'grass', 'electric', 'ice', 'fighting', 'psychic', 'dark'];
  const tms = [];
  for (let i = 0; i < tmTypes.length; i++) {
    const t = tmTypes[i]!;
    tms.push({
      id: 300 + i,
      name: ['화염방사', '파도타기', '기가드레인', '10만볼트', '냉동빔', '기와깨기', '사이코키네시스', '악의파동'][i]!,
      nameEn: 'TM',
      type: t,
      typeName: TYPE_KO[t as keyof typeof TYPE_KO] ?? t,
      power: 90,
      accuracy: 100,
      pp: 15,
      damageClass: 'special',
      sprite: await ensureItemSprite(`tm-${t}`),
      count: (i % 3) + 1,
    });
  }

  const moves = tms.slice(0, 4).map((t) => ({ ...t, count: undefined }));

  const log = [];
  const wilds = [19, 16, 21, 41, 74, 92, 129, 133];
  for (let i = 0; i < wilds.length; i++) {
    const id = wilds[i]!;
    log.push({
      seq: 400 - i,
      wildId: id,
      tokens: 90_000 + i * 17_000,
      moveId: i === 1 ? 53 : null,
      wildName: speciesName(id),
      moveName: i === 1 ? '화염방사' : null,
      wildSprite: await ensureSprite(id),
      icon: null,
      battle: null,
      trainerFight: null,
      formKo: null,
      formKind: null,
      formBackSprite: null,
      battleBg: null,
    });
  }

  const awards = [
    ['raise-1', 'raise', '육성', '첫 졸업', '한 마리를 도감으로 떠나보냈다.', 12, 1, 1, 1_700_000_000_000, null, 0],
    ['raise-10', 'raise', '육성', '잘 가', '열 마리를 떠나보낼 때마다.', 12, 20, 0.6, null, 10, 1],
    ['dex-25', 'dex', '도감', '도감 25종', '스물다섯 종류를 등록했다.', 48, 25, 1, 1_700_100_000_000, null, 0],
    ['dex-50', 'dex', '도감', '도감 50종', '쉰 종류를 등록했다.', 48, 50, 0.96, null, null, 0],
    ['dex-100', 'dex', '도감', '도감 100종', '백 종류를 등록했다.', 48, 100, 0.48, null, null, 0],
    ['hunt-100', 'hunt', '사냥', '백 번의 조우', '야생 포켓몬을 백 번 만났다.', 412, 100, 1, 1_700_200_000_000, null, 0],
    ['hunt-500', 'hunt', '사냥', '오백 번의 조우', '야생 포켓몬을 오백 번 만났다.', 412, 500, 0.82, null, null, 0],
    ['tm-8', 'tm', '기술', '기술머신 여덟 개', '서로 다른 기술머신을 여덟 개 모았다.', 8, 8, 1, 1_700_300_000_000, null, 0],
    ['shiny-1', 'special', '특별', '반짝이는 만남', '이로치를 만났다.', 2, 1, 1, 1_700_400_000_000, null, 0],
    ['trainer-10', 'hunt', '사냥', '트레이너 열 명', '트레이너 열 명을 이겼다.', 10, 10, 1, 1_700_500_000_000, null, 0],
  ] as const;

  const tokens = {
    total: 1_857_534_919,
    today: 412_800_000,
    todayMessages: 1_620,
    messageCount: 41_300,
    lifetime: 1_857_534_919,
    byDay: {
      '2026-08-15': 121_000_000,
      '2026-08-16': 264_000_000,
      '2026-08-17': 88_000_000,
      '2026-08-18': 341_000_000,
      '2026-08-19': 402_000_000,
      '2026-08-20': 183_000_000,
      '2026-08-21': 412_800_000,
    },
    byEntrypoint: { cli: 1_240_000_000, 'claude-vscode': 570_000_000, 'claude-desktop': 47_534_919 },
    byModel: { 'claude-opus-5': 1_180_000_000, 'claude-sonnet-5': 620_000_000, 'claude-haiku-4-5': 57_534_919 },
    mode: 'activity',
  };

  const stateA = {
    tokens,
    companion: {
      speciesId: ME,
      name: speciesName(ME),
      nameEn: speciesName(ME, 'en'),
      stageIndex: 2,
      stageCount: 3,
      isShiny: false,
      rarity: rarityOfSpecies(ME),
      nature: NATURE_KO['brave'] ?? 'brave',
      nickname: '불꽃이',
      sprite: mySprite,
      backSprite: myBack,
      types: typesOf(ME),
      genus: speciesInfo(ME)?.genus ?? '',
      heightM: speciesInfo(ME)?.heightM ?? 1.7,
      weightKg: speciesInfo(ME)?.weightKg ?? 90.5,
      withYou: 612_400_000,
      path: [1, 2, 3].map((_, i) => {
        const chain = [4, 5, 6][i]!;
        return { id: chain, name: speciesName(chain) };
      }),
      displayId: ME,
      form: null,
      fusions: [],
      forms: [],
      battleForm: null,
    },
    eggSprite: null,
    progress: { phase: 'growing', have: 62_400_000, need: 100_000_000, ratio: 0.62 },
    dex,
    dexTotal: 1025,
    retiredCount: 12,
    hatchThreshold: 26_701_053,
    shop: { wallet: 268_400_000, clerk, products },
    bag: {
      inventory: { 'rare-candy': 10, everstone: 15, 'shiny-charm': 18, 'key-stone': 2, 'dynamax-band': 2 },
      everstone: false,
      showBattleForm: false,
      shinyCharmActive: true,
      forcedRarity: null,
      stones: [],
    },
    hunt: {
      enabled: true,
      tokens: 41_200_000,
      cap: 464_383_729,
      uncapped: false,
      count: HUNT_COUNT,
      sinceBirth: { tokens: 12_400_000, count: 96 },
      stop: { ko: '홍련섬', region: '관동', terrain: 'seaside', sky: 'beach' },
      shrines: { open: 3, total: 36 },
      intervalMs: 300_000,
      slots: 4,
      nextInMs: 138_000,
      speed: 1.4,
      idleReason: null,
      skylineBg,
      log,
    },
    moves,
    tms,
    unusableTmCount: 2,
    sprites: { bytes: 37_748_736, files: 764 },
    legends: {
      items: [{ slug: 'adamant-orb', ko: '금강옥', count: 1, forKo: '디아루가', sprite: null }],
      shards: [{ slug: 'azure-flute', ko: '천계의피리', count: 7, need: 12, ready: false, sprite: null }],
      eggs: [],
      waiting: null,
      gates: [
        { speciesId: 144, ko: '프리져', tier: 'sub', myth: false, gen: 1, how: '관동 도감 40종', have: 48, need: 40, ratio: 1, itemKo: null, source: null, ready: true, held: false, open: true, done: false },
        { speciesId: 243, ko: '라이코', tier: 'sub', myth: false, gen: 2, how: '성도 도감 30종', have: 22, need: 30, ratio: 0.73, itemKo: null, source: null, ready: false, held: false, open: false, done: false },
        { speciesId: 150, ko: '뮤츠', tier: 'box', myth: false, gen: 1, how: '도감 300종 · 트레이너 80승', have: 48, need: 300, ratio: 0.16, itemKo: null, source: null, ready: false, held: false, open: false, done: false },
        { speciesId: 483, ko: '디아루가', tier: 'box', myth: false, gen: 4, how: '금강옥 보유', have: 1, need: 1, ratio: 1, itemKo: '금강옥', source: null, ready: true, held: true, open: true, done: false },
      ],
    },
    /** A league party part-built, so the dex tab's third view has something in it. */
    party: {
      size: 6,
      ready: false,
      cityKo: '석영고원',
      members: [
        { speciesId: 6, name: '리자몽', shiny: false, sprite: '6-a.gif', canTake: [89], free: [],
          moves: [{ id: 53, name: '화염방사', nameEn: 'Flamethrower', type: 'fire', typeName: '불꽃', power: 90, accuracy: 100, pp: 15, damageClass: 'special' }] },
        { speciesId: 143, name: '잠만보', shiny: false, sprite: '143-a.gif', canTake: [], free: [],
          moves: [{ id: 63, name: '파괴광선', nameEn: 'Hyper Beam', type: 'normal', typeName: '노말', power: 150, accuracy: 90, pp: 5, damageClass: 'special' }] },
        { speciesId: 65, name: '후딘', shiny: false, sprite: '65-a.gif', canTake: [], free: [], moves: [] },
      ],
    },
    /** Four badges in, mid-Kanto — the case with something in it and something left. */
    badges: {
      count: 4,
      total: 8,
      wins: 6,
      league: {
        cityKo: '석영고원',
        open: false,
        at: null,
        size: 5,
        best: 0,
        wins: 0,
        clearedAt: null,
        until: 387,
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
        { no: 2, ko: '블루배지', leaderKo: '이슬', cityKo: '블루시티', have: true, locked: false, until: 0, prizeKo: '물의파동', sprite: 'badge-2.png' },
        { no: 3, ko: '오렌지배지', leaderKo: '마티스', cityKo: '갈색시티', have: true, locked: false, until: 0, prizeKo: '전격파', sprite: 'badge-3.png' },
        { no: 4, ko: '무지개배지', leaderKo: '민화', cityKo: '무지개시티', have: true, locked: false, until: 0, prizeKo: '기가드레인', sprite: 'badge-4.png' },
        { no: 5, ko: '핑크배지', leaderKo: '독수', cityKo: '연분홍시티', have: false, locked: false, until: 62, prizeKo: '맹독', sprite: 'badge-5.png' },
        { no: 6, ko: '골드배지', leaderKo: '초련', cityKo: '노랑시티', have: false, locked: false, until: 37, prizeKo: '명상', sprite: 'badge-6.png' },
        { no: 7, ko: '진홍색배지', leaderKo: '강연', cityKo: '홍련섬', have: false, locked: false, until: 112, prizeKo: '불대문자', sprite: 'badge-7.png' },
        { no: 8, ko: '그린배지', leaderKo: '비주기', cityKo: '상록시티', have: false, locked: true, until: 5737, prizeKo: '지진', sprite: 'badge-8.png' },
      ],
    },
    awards: awards.map(([id, cat, catKo, ko, desc, have, need, ratio, at, repeat, times]) => ({
      id, cat, catKo, ko, desc, have, need, ratio, at, repeat, times,
      money: 4_000_000 + (id.length % 5) * 3_000_000,
      itemKo: null,
      itemSprite: null,
    })),
    events: [],
    fx,
    generatedAt: '2026-08-21T04:24:00.000Z',
  };

  /**
   * The same state one encounter later.
   *
   * `Scene` arms on the first payload it sees and only plays when a strictly
   * newer `seq` arrives (src/Scene.tsx:498-506), so the battle needs two
   * payloads — there is no way to make it play from a cold start.
   */
  const stateB = {
    ...stateA,
    hunt: {
      ...stateA.hunt,
      count: HUNT_COUNT + 1,
      log: [
        {
          seq: 401,
          wildId: FOE,
          tokens: 214_000,
          moveId: null,
          wildName: speciesName(FOE),
          moveName: null,
          wildSprite: foeSprite,
          icon: null,
          battle: BATTLE,
          trainerFight: null,
          formKo: null,
          formKind: null,
          formBackSprite: null,
          battleBg,
        },
        ...log,
      ],
    },
  };

  /**
   * `dexStatic`, not `dexEntry`.
   *
   * `dexEntry` calls `loadState()` — it would read the machine owner's real
   * save to decide which stages are marked collected. `dexStatic` is pure, and
   * the two derived fields it leaves out are reproduced here against the demo
   * dex instead.
   */
  const base = dexStatic(ME);
  if (!base) throw new Error(`gen:shots — no dex entry for #${ME}`);
  const owned = new Set(DEX_IDS);
  const entry = {
    ...base,
    sprite: mySprite,
    stages: base.stages.map((col) =>
      col.map((st) => ({ ...st, collected: owned.has(st.speciesId), here: st.speciesId === ME })),
    ),
    mine: {
      firstSeenAt: 1_700_500_000_000,
      nickname: '불꽃이',
      shiny: false,
      formKo: null,
    },
  };

  const index = dex.map((d) => ({
    speciesId: d.speciesId,
    name: d.name,
    rarity: d.rarity,
    generation: d.generation,
    types: d.types,
  }));

  return { stateA, stateB, index, entry, dexIds: [...DEX_IDS] };
}

/** Which fx slug the battle's one super-effective turn will ask for. */
export const BATTLE_FX_SLUG = effectFor('ghost');
