import { Fragment, useEffect, useRef, useState } from 'react';
import './App.css';
import Scene, { type SceneBattle, type SceneTrainerFight } from './Scene.tsx';
import { journeyFor } from './journey.ts';
import { timeOfDayAt } from './timeOfDay.ts';
import { euro, josa } from './josa.ts';
import { battleUiVars } from './battleui.ts';
import { fitScale } from './pixelFit.ts';

/** Mirrors NICKNAME_MAX in server/game.ts. The renderer must not import from
 *  server/, so the length lives in both places; the server is authoritative and
 *  truncates anyway, this only stops the box accepting what will be cut. */
const NICKNAME_MAX = 12;
import {
  bridge,
  fetchDexEntry,
  fetchDexIndex,
  fetchState,
  isElectron,
  shopAction,
  spriteUrl,
  type DexDetail,
  type DexIndexEntry,
  type PetActionKind,
  type Prefs,
} from './api.ts';

type Progress = { phase: 'egg' | 'growing' | 'final'; have: number; need: number; ratio: number };

type Companion = {
  speciesId: number;
  name: string;
  nameEn: string;
  stageIndex: number;
  stageCount: number;
  isShiny: boolean;
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
  nature: string;
  nickname: string | null;
  sprite: string | null;
  /** Rear view, for the battle scene. */
  backSprite: string | null;
  types: { id: string; name: string }[];
  /** Korean genus, e.g. "임금포켓몬". */
  genus: string;
  heightM: number;
  weightKg: number;
  /** Progress burned since this one hatched. */
  withYou: number;
  path: { id: number; name: string }[];
  /** The id actually drawn. Differs from speciesId only when fused. */
  displayId: number;
  /** The permanent form it is wearing, if any. */
  form: { id: number; kind: 'mega' | 'gmax' | 'fusion'; ko: string } | null;
  /** Fusions the dex makes possible right now. */
  fusions: { id: number; ko: string; partner: number; partnerKo: string; sprite: string | null }[];
  /** Every battle form this species could reach, and what is still missing. */
  forms: {
    id: number;
    kind: 'mega' | 'gmax';
    ko: string;
    stone: { ko: string; have: boolean } | null;
    item: boolean;
    ready: boolean;
  }[];
  /** What it becomes in a battle, if anything would. */
  battleForm: { id: number; kind: 'mega' | 'gmax' | 'fusion'; ko: string; sprite: string | null } | null;
};

/**
 * A card in the dex grid: a collected row, or an unseen slot wearing its shape.
 *
 * Declared from `State['dex']` rather than written out, so a field added to the
 * payload row cannot go missing here.
 */
type DexCard = State['dex'][number] & {
  seen: boolean;
  /**
   * A legendary whose gate is still shut.
   *
   * Shown even with 미수집 포함 off, and pressable where an ordinary unseen slot
   * is not — see the note beside the card list for why that exception is the
   * one the existing comment already allows for.
   */
  locked?: State['legends']['gates'][number];
};

/** A move as buildState resolves it — the renderer never sees server/moves.ts. */
type MoveCard = {
  id: number;
  name: string;
  nameEn: string;
  type: string;
  typeName: string;
  /** 0 for status moves. */
  power: number;
  accuracy: number;
  pp: number;
  damageClass: 'physical' | 'special' | 'status';
  sprite: string | null;
};

type HuntLogEntry = {
  seq: number;
  wildId: number;
  tokens: number;
  moveId: number | null;
  wildName: string;
  moveName: string | null;
  /** What the companion attacked with. Derived server-side, never stored. */
  /** Only the newest entry carries one, to cap downloads at one per encounter. */
  wildSprite: string | null;
  /** The row's still thumbnail. Every entry has one — a static PNG is 1.7KB. */
  icon: string | null;
  /** Set when this encounter was a gated legendary. */
  legend?: { speciesId: number; won: boolean };
  /** The blow-by-blow, again only for the newest entry. */
  battle: SceneBattle | null;
  /** Set when this encounter was a trainer rather than a wild Pokemon. */
  trainer?: { name: string; team: number[]; won: boolean; item?: string };
  trainerFight: SceneTrainerFight | null;
  /** Backdrop for the battle screen, newest entry only. Same rule as wildSprite. */
  battleBg: string | null;
  /** The mega stone this encounter left behind, already named. */
  stoneId?: number;
  stoneKo: string | null;
  stoneSprite: string | null;
  /** The battle form worn here. Read off the entry, never off the current bag. */
  formKo: string | null;
  formKind: 'mega' | 'gmax' | null;
  formSprite: string | null;
  formBackSprite: string | null;
};

type State = {
  tokens: {
    total: number;
    today: number;
    todayMessages: number;
    messageCount: number;
    lifetime: number;
    byDay: Record<string, number>;
    byEntrypoint: Record<string, number>;
    byModel: Record<string, number>;
    mode: string;
  };
  companion: Companion | null;
  progress: Progress;
  eggSprite: string | null;
  dex: {
    speciesId: number;
    name: string;
    shiny: boolean;
    sprite: string | null;
    rarity: string;
    generation: number;
    types: { id: string; name: string }[];
  }[];
  dexTotal: number;
  retiredCount: number;
  hatchThreshold: number;
  shop: {
    wallet: number;
    /** The clerk sprite, or null while it is still downloading. */
    clerk: string | null;
    products: {
      id: string;
      name: string;
      desc: string;
      kind: 'item' | 'egg';
      /** Null for items; the tier an egg guarantees. */
      rarity: 'common' | 'uncommon' | 'rare' | 'legendary' | null;
      price: number;
      sprite: string | null;
      /** Which shelf it sits on. Drives the category chips. */
      group: 'egg' | 'growth' | 'evolution';
      /** Already owned. Only ever true for the items that need owning once. */
      owned: boolean;
      /** An achievement reward. Shipped for the bag's sake, never shelved. */
      award: boolean;
    }[];
  };
  bag: {
    inventory: Record<string, number | undefined>;
    everstone: boolean;
    showBattleForm: boolean;
    shinyCharmActive: boolean;
    forcedRarity: string | null;
    /** Mega stones held. `usable` is the one this companion could actually use. */
    stones: {
      id: number;
      ko: string;
      formKo: string;
      count: number;
      usable: boolean;
      sprite: string | null;
    }[];
  };
  hunt: {
    enabled: boolean;
    tokens: number;
    /** Null when the share ceiling is off. */
    cap: number | null;
    uncapped: boolean;
    count: number;
    /** The same two, scoped to the companion that is out right now. */
    sinceBirth: { tokens: number; count: number };
    /** Gen-5 backdrop for where the pet is walking. Null is the flat sky. */
    skylineBg: string | null;
    intervalMs: number;
    slots: number;
    nextInMs: number | null;
    speed: number;
    idleReason: 'off' | 'everstone' | 'egg' | null;
    log: HuntLogEntry[];
  };
  moves: MoveCard[];
  tms: (MoveCard & { count: number })[];
  unusableTmCount: number;
  legends: {
    items: { slug: string; ko: string; count: number; forKo: string | null; sprite: string | null }[];
    shards: { slug: string; ko: string; count: number; need: number; ready: boolean; sprite: string | null }[];
    eggs: { speciesId: number; ko: string; count: number; sprite: string | null }[];
    waiting: { speciesId: number; ko: string } | null;
    gates: {
      speciesId: number; ko: string; tier: string; myth: boolean; gen: number;
      how: string; have: number; need: number; ratio: number;
      itemKo: string | null; source: string | null;
      ready: boolean; held: boolean; open: boolean; done: boolean;
    }[];
  };
  awards: {
    id: string;
    cat: string;
    catKo: string;
    ko: string;
    desc: string;
    have: number;
    need: number;
    /** 0..1, worked out server-side so a repeating row's bar means its tier. */
    ratio: number;
    /** Unlocked at, in ms. Null while it is still locked. */
    at: number | null;
    /** The step of a repeating row, or null for a one-shot. */
    repeat: number | null;
    /** How many times a repeating row has paid. Zero for a one-shot. */
    times: number;
    money: number;
    itemKo: string | null;
    itemSprite: string | null;
  }[];
  events: { kind: string; speciesId?: number; shiny?: boolean }[];
  sprites: { bytes: number; files: number };
  /** Impact art for the move types swung this encounter, by type. */
  fx?: Record<string, string | null>;
  generatedAt: string;
};

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
const isAttack = (m: MoveCard) => m.damageClass !== 'status';

/** "위력 90 · 불꽃 · 특수" — the one-line summary under a move name. */
const moveSummary = (m: MoveCard) =>
  `${m.typeName} · ${DAMAGE_LABEL[m.damageClass] ?? m.damageClass}` +
  `${m.power ? ` · 위력 ${m.power}` : ''} · PP ${m.pp}`;

const ITEM_NAMES: Record<string, string> = {
  'rare-candy': '이상한사탕',
  'shiny-charm': '반짝반짝부적',
  everstone: '변함없는돌',
  'key-stone': '키스톤',
  'dynamax-band': '다이맥스밴드',
  'dna-splicers': 'DNA쐐기',
};

/**
 * What the clerk is doing.
 *
 * Three beats, which is what the games' counter is: a greeting, a question, and
 * an answer. `ask` holds only the product id — the row it names is looked up
 * from the live payload, so a price that moves between the question and the
 * answer cannot be quoted stale.
 */
type Till =
  | { at: 'idle' }
  /** Pointing at a row. Reached by hover or focus, and costs nothing. */
  | { at: 'pick'; id: string }
  | { at: 'ask'; id: string }
  | { at: 'said'; line: string };

/** How long the clerk's parting line stays up. Matches the flash toast. */
const SAID_MS = 3000;

/**
 * How big the clerk is drawn.
 *
 * The sprite is 80x80, so 160 is an exact 2x — the only kind of scale that maps
 * one source pixel to an even block. `fitScale` is the general answer to this
 * and is what the scene uses, but it needs the natural size from an onLoad, and
 * there is exactly one clerk at one known size.
 */
const CLERK_PX = 160;

/**
 * What each bag item does, for the description window.
 *
 * A short second sentence rather than the shop's sales copy: by the time it is
 * in the bag the question is no longer "should I buy this" but "what happens if
 * I press it".
 */
const ITEM_DESC: Record<string, string> = {
  'rare-candy': '지금 단계 진행도를 25% 채웁니다.',
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
function formNeed(
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
const PASSIVE = new Set(['key-stone', 'dynamax-band']);

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
const LEGEND_SOURCE_KO: Record<string, string> = {
  drop: '사냥에서 떨어집니다',
  award: '업적 보상',
  shards: '조각 12개를 모아 합성',
};

const POCKETS = [
  { id: 'item', label: '도구' },
  { id: 'key', label: '중요한 물건' },
  { id: 'tm', label: '기술머신' },
  { id: 'stone', label: '메가스톤' },
  { id: 'legend', label: '전설' },
] as const;
type Pocket = (typeof POCKETS)[number]['id'];

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
const TM_PAGE = 8;

/** The shop's shelves, in the order they are drawn. */
const SHOP_GROUPS = [
  { id: 'egg', label: '알' },
  { id: 'growth', label: '성장' },
  { id: 'evolution', label: '진화' },
] as const;
type ShopGroup = (typeof SHOP_GROUPS)[number]['id'];

const compact = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n.toLocaleString();

/**
 * The eighteen types, for the dex filter row.
 *
 * Hardcoded rather than derived from the index, so the filter is complete
 * before the index has been fetched — and it never changes.
 */
const TYPE_FILTERS: { id: string; name: string }[] = [
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
 * A dex thumbnail, scaled by a whole-number ladder step.
 *
 * Measured from `<img onLoad>` rather than spriteBox's `measureSprite`, which
 * needs a canvas that happy-dom does not provide — and the panel's tests render
 * this for real.
 */
function DexSprite({ name, alt, box = 44 }: { name: string; alt: string; box?: number }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);

  // Deliberately NOT Scene.css's `.scene-silhouette`: that class belongs to the
  // battle screen, and reaching for it here would tie the dex grid's rendering
  // to the battle stylesheet. The dex already has its own word for this — the
  // same '?' an entry with no sprite name shows — and the card keeps its solid
  // border and real name, so it reads as "art missing" rather than as the
  // dashed `.unseen` "not collected yet".
  if (failed) return <span className="miss">?</span>;

  return (
    <img
      src={spriteUrl(name)}
      alt={alt}
      draggable={false}
      style={size ? { width: size.w, height: size.h } : { visibility: 'hidden' }}
      onLoad={(e) => {
        const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
        if (!w || !h) return;
        const k = fitScale(Math.max(w, h), box);
        setSize({ w: Math.round(w * k), h: Math.round(h * k) });
      }}
      onError={(e) => {
        console.error('[poketokenpet] sprite failed to load:', e.currentTarget.src);
        setFailed(true);
      }}
    />
  );
}

/**
 * How old the data on screen is: "방금" / "3분 전" / "2시간 전".
 *
 * Only ever shown alongside the staleness bar, so it does not need to be exact
 * past an hour.
 */
function agoLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 45) return '방금';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}분 전`;
  return `${Math.round(m / 60)}시간 전`;
}

/** Missed polls before the panel admits it. One blip is not news. */
const STALE_AFTER = 2;

const RARITY_LABEL: Record<string, string> = {
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
const dexKey = (d: { speciesId: number; shiny: boolean }) =>
  `${d.speciesId}-${d.shiny ? 's' : 'n'}`;

/**
 * 방어 상성 bucket labels.
 *
 * Digits rather than ×4 / ×¼: the fraction glyphs are not in Galmuri, so they
 * would fall back to a system font in the middle of a pixel row. 무효 is the
 * games' own word, and Scene.tsx already prints 효과가 없는 것 같다 for the
 * same number.
 */
const FACTOR_LABEL: Record<number, string> = {
  4: '4배',
  2: '2배',
  0.5: '0.5배',
  0.25: '0.25배',
  0: '무효',
};

type TabId = 'pet' | 'stats' | 'bag' | 'dex' | 'awards' | 'shop' | 'settings';

const TABS: { id: TabId; label: string }[] = [
  { id: 'pet', label: '파트너' },
  { id: 'stats', label: '기록' },
  { id: 'bag', label: '가방' },
  { id: 'dex', label: '도감' },
  { id: 'awards', label: '업적' },
  { id: 'shop', label: '상점' },
  { id: 'settings', label: '설정' },
];

const ENTRYPOINT_LABEL: Record<string, string> = {
  'claude-vscode': 'VS Code',
  cli: '터미널',
  'claude-desktop': '데스크톱',
  unknown: '알 수 없음',
};

/** Desktop-pet controls. Only rendered inside Electron. */
function PetSettings() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [sizes, setSizes] = useState<number[]>([]);

  useEffect(() => {
    const b = bridge();
    if (!b) return;
    void b.getPrefs().then(setPrefs);
    void b.sizes().then(setSizes);
    return b.onPrefs((p) => setPrefs(p as Prefs));
  }, []);

  if (!prefs) return null;
  const set = (patch: Partial<Prefs>) => {
    setPrefs({ ...prefs, ...patch });
    void bridge()?.setPrefs(patch);
  };

  return (
    <>
      <h2>데스크탑 펫</h2>
      <ul className="items">
        <li>
          <span className="lbl">
            화면에 표시
            <em>바탕화면 위에 항상 떠 있습니다. 드래그로 이동, 휠로 크기 조절.</em>
          </span>
          <button onClick={() => set({ petEnabled: !prefs.petEnabled })}>
            {prefs.petEnabled ? '켜짐' : '꺼짐'}
          </button>
        </li>
        <li>
          <span className="lbl">항상 위에</span>
          <button onClick={() => set({ petAlwaysOnTop: !prefs.petAlwaysOnTop })}>
            {prefs.petAlwaysOnTop ? '켜짐' : '꺼짐'}
          </button>
        </li>
        <li>
          <span className="lbl">
            클릭 통과
            <em>켜면 펫이 마우스를 받지 않아 뒤쪽 창을 그대로 클릭할 수 있습니다.</em>
          </span>
          <button onClick={() => set({ petClickThrough: !prefs.petClickThrough })}>
            {prefs.petClickThrough ? '켜짐' : '꺼짐'}
          </button>
        </li>
        <li>
          <span className="lbl">크기</span>
          <span className="sizes">
            {sizes.map((s) => (
              <button
                key={s}
                className={prefs.petSize === s ? 'on' : ''}
                onClick={() => set({ petSize: s })}
              >
                {s}
              </button>
            ))}
          </span>
        </li>
        <li>
          <span className="lbl">로그인 시 자동 실행</span>
          <button onClick={() => set({ openAtLogin: !prefs.openAtLogin })}>
            {prefs.openAtLogin ? '켜짐' : '꺼짐'}
          </button>
        </li>
        <li>
          <span className="lbl">펫 위치 초기화</span>
          <button onClick={() => set({ petX: null, petY: null })}>초기화</button>
        </li>
      </ul>
    </>
  );
}

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  /**
   * How stale the data on screen is, and how many polls have failed.
   *
   * The age is computed when a poll FAILS rather than during render — reading
   * the clock in render is impure, and it does not need to be live: every
   * failed tick re-renders anyway, so the label refreshes on its own without a
   * second timer.
   */
  const lastOkRef = useRef<number | null>(null);
  const [staleMs, setStaleMs] = useState(0);
  const [fails, setFails] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<TabId>('pet');
  /** Which shop shelf is showing. null is "전체", which draws all three with headings. */
  const [shopGroup, setShopGroup] = useState<ShopGroup | null>(null);
  /**
   * What the clerk is doing.
   *
   * The games never take money on one press: they name the thing, name the
   * price, and ask. Here that matters for more than flavour — buying an egg
   * retires the companion, and until now one stray click did it with no warning
   * at all.
   */
  const [till, setTill] = useState<Till>({ at: 'idle' });
  /** Which pocket is open. */
  const [pocket, setPocket] = useState<Pocket>('item');
  /** Which page of the machine pocket is on screen. See TM_PAGE. */
  const [tmPage, setTmPage] = useState(0);
  /**
   * The bag row being described.
   *
   * Two of them, for the same reason the shop separates hover from a click: a
   * pointed-at row and a chosen row are different things, and letting the mouse
   * wipe out a keyboard or touch selection on its way past the list is how a
   * description vanishes just as it is being read.
   */
  const [bagPin, setBagPin] = useState<string | null>(null);
  const [bagOver, setBagOver] = useState<string | null>(null);
  const prevSpecies = useRef<number | null>(null);
  /**
   * Achievement ids already announced.
   *
   * Null until the first payload arms it, exactly as `prevSpecies` is: a save
   * with thirteen backlogged unlocks must not open the app with thirteen
   * toasts. After that, anything new gets one.
   */
  const seenAwards = useRef<Set<string> | null>(null);
  /** Tab buttons, so arrow keys can move focus as well as selection. */
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const refresh = useRef<(force?: boolean) => Promise<void>>(async () => {});
  /** The TM waiting on a slot choice, once all four are full. */
  const [pendingTm, setPendingTm] = useState<number | null>(null);
  /** Non-null while the rename box is open; holds the draft. */
  const [draftName, setDraftName] = useState<string | null>(null);
  /** Whether the hunt log is expanded on the 기록 tab. */
  const [allHunts, setAllHunts] = useState(false);
  /** Dex filters. Local state — the server never sees them. */
  const [showFilters, setShowFilters] = useState(false);
  const [fRarity, setFRarity] = useState<string | null>(null);
  const [fGen, setFGen] = useState<number | null>(null);
  const [fType, setFType] = useState<string | null>(null);
  const [showUnseen, setShowUnseen] = useState(false);
  /** The legendary board, shown in place of the dex grid. */
  const [showLegends, setShowLegends] = useState(false);
  /** Which achievement category is showing. Null is all of them. */
  const [awardCat, setAwardCat] = useState<string | null>(null);
  /**
   * Fold away what is already finished.
   *
   * Repeating rows are never folded — they have no finished state, and hiding
   * the one row in a category that still has something to chase would be the
   * opposite of what the toggle is for.
   */
  const [hideDone, setHideDone] = useState(false);
  /**
   * How many achievements were unlocked when the board was last looked at.
   *
   * A count in state rather than a ref, because the tab dot is rendered from
   * it: mutating a ref never re-renders, so a dot derived from one would draw
   * from whatever the previous render happened to see. Written from the poll
   * (which arms it on the first payload, so a backlog is not news) and from
   * `goTab` (which clears it when the board is actually opened) — both event
   * contexts, never during render.
   */
  const [awardsSeen, setAwardsSeen] = useState(0);
  /**
   * The full dex, fetched once when unseen slots are first asked for.
   *
   * ~116KB and static, which is why it is not in the state payload.
   */
  const [dexIndex, setDexIndex] = useState<DexIndexEntry[] | null>(null);
  /**
   * The card the dex tab has open, held WHOLE rather than as an id pair.
   *
   * The grid row already carries the number, the name, the art, the shiny flag
   * and the types — which is the entire header of the entry screen. Holding the
   * row means that header is on screen in the same frame as the press, and only
   * the sections below it wait on the network. There is nothing to spin.
   */
  const [dexOpen, setDexOpen] = useState<DexCard | null>(null);
  const [dexDetail, setDexDetail] = useState<DexDetail | null>(null);
  const [dexErr, setDexErr] = useState<string | null>(null);
  /**
   * Entries already fetched.
   *
   * Backing out and pressing the same card again is the likeliest thing anyone
   * does here, and an entry cannot change while the panel is open. Held for the
   * same reason `dexIndex` above is held.
   */
  const dexCache = useRef(new Map<string, DexDetail>());
  /**
   * Which card to put the cursor back on. A KEY, not a node.
   *
   * The grid is unmounted while an entry is open, so a node captured on the way
   * in is detached by the time we return — and `.focus()` on a detached node
   * does nothing at all, silently, which is the worst way for this to fail.
   */
  const dexReturn = useRef<string | null>(null);
  /** The scroller, so opening an entry starts at the top of it. */
  const panelRef = useRef<HTMLDivElement | null>(null);

  /**
   * Switch tabs, forgetting whatever was selected on the old one.
   *
   * Leaving the counter ends the conversation, so coming back starts a new one
   * rather than resuming a half-asked question about a price that has since
   * moved. Done here rather than in an effect keyed on `tab`: the tab change is
   * an event, and an effect that only ever mirrors an event is a second render
   * for nothing.
   */
  const goTab = (id: TabId) => {
    setTab(id);
    setTill({ at: 'idle' });
    setBagPin(null);
    setBagOver(null);
    setTmPage(0);
    setPendingTm(null);
    setAwardCat(null);
    setHideDone(false);
    setShowLegends(false);
    // Opening the board IS reading it, so the dot goes out here.
    if (id === 'awards') setAwardsSeen(state?.awards.filter((a) => a.at !== null).length ?? 0);
    closeDex();
  };

  /**
   * Open one dex card's entry screen.
   *
   * The grid is replaced rather than covered — the panel IS a 420px popover, so
   * a dialog would be a window inside a window with no outside for a scrim to
   * cover, and the games do it this way too: shelf, entry, back. 가방's TM slot
   * picker already swaps a list for a chooser in place; this is that at screen
   * scale, not a new mechanism.
   */
  const openDex = (d: DexCard) => {
    const key = dexKey(d);
    dexReturn.current = key;
    setDexOpen(d);
    setDexErr(null);
    setDexDetail(dexCache.current.get(key) ?? null);
    // A card pressed from row eight would otherwise open an entry already
    // scrolled halfway down. Optional call: happy-dom has no scrollTo on an
    // element, and a missing method must not take the panel down.
    panelRef.current?.scrollTo?.(0, 0);
  };

  const closeDex = () => {
    setDexOpen(null);
    setDexDetail(null);
    setDexErr(null);
  };

  const act = async (action: PetActionKind, id: string, slot: number | null = null) => {
    setBusy(true);
    try {
      const out = await shopAction(action, id, slot);
      setFlash(out.message ?? (out.ok ? '완료' : '실패'));
      setTimeout(() => setFlash(null), 3000);
      refresh.current();
    } catch (e) {
      setFlash(String(e));
      setTimeout(() => setFlash(null), 3000);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Buy the thing the clerk just asked about.
   *
   * Deliberately not `act`: the reply belongs in the clerk's own box, not in
   * the toast that floats over the top of the window. Everything else about the
   * call is the same.
   */
  const buyAsked = async (id: string) => {
    setBusy(true);
    try {
      const out = await shopAction('buy', id, null);
      setTill({ at: 'said', line: out.message ?? (out.ok ? '고맙습니다!' : '죄송합니다.') });
      refresh.current();
    } catch (e) {
      setTill({ at: 'said', line: String(e) });
    } finally {
      setBusy(false);
    }
  };

  /**
   * The clerk stops talking on her own.
   *
   * `said` is the parting line, not a state anyone should have to dismiss.
   * Keyed on the line itself so two purchases in a row each get their full
   * three seconds rather than sharing one timer.
   */
  useEffect(() => {
    if (till.at !== 'said') return;
    const t = setTimeout(() => setTill({ at: 'idle' }), SAID_MS);
    return () => clearTimeout(t);
  }, [till]);

  useEffect(() => {
    let alive = true;
    const tick = async (force = false) => {
      try {
        // `force` skips the server's 20s cache. Only the retry button sets it:
        // fetchState has always supported it and nothing ever passed it.
        const data = await fetchState<State>(force);
        if (!alive) return;
        setState(data);
        setError(null);
        lastOkRef.current = Date.now();
        setFails(0);

        const id = data.companion?.speciesId ?? null;
        if (prevSpecies.current !== null && id !== null && id !== prevSpecies.current) {
          setFlash(`${data.companion!.name}${euro(data.companion!.name)} 진화!`);
          setTimeout(() => setFlash(null), 4000);
        }
        if (prevSpecies.current === null && id !== null && data.events.some((e) => e.kind === 'hatched')) {
          setFlash(`${data.companion!.name} 부화!`);
          setTimeout(() => setFlash(null), 4000);
        }
        prevSpecies.current = id;

        // Same shape as the two above, and armed the same way: the first
        // payload only records what is already unlocked.
        const unlocked = new Set(data.awards.filter((a) => a.at !== null).map((a) => a.id));
        if (seenAwards.current === null) {
          seenAwards.current = unlocked;
          setAwardsSeen(unlocked.size);
        } else {
          const fresh = data.awards.find((a) => a.at !== null && !seenAwards.current!.has(a.id));
          seenAwards.current = unlocked;
          if (fresh) {
            setFlash(`업적 달성 — ${fresh.ko}`);
            setTimeout(() => setFlash(null), 4000);
          }
        }

      } catch (e) {
        if (!alive) return;
        setError(String(e));
        setStaleMs(lastOkRef.current === null ? 0 : Date.now() - lastOkRef.current);
        // Updater form: `tick` is captured by an effect with an empty dep list.
        setFails((f) => f + 1);
      }
    };
    refresh.current = tick;

    /**
     * The popover is hidden, not destroyed, so this interval would otherwise
     * keep polling for as long as the app runs. Poll once on the way back so
     * the panel is never up to five seconds stale when it reappears.
     */
    let h: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (h !== null) return;
      void tick();
      // Wrapped rather than passed directly: no runtime this app targets hands
      // a timer callback an argument, but Firefox is documented to pass the
      // lateness, and `tick`'s first parameter is now `force`. Hygiene, not a
      // live bug — the browser build is a supported way to run this.
      h = setInterval(() => void tick(), 5000);
    };
    const stop = () => {
      if (h === null) return;
      clearInterval(h);
      h = null;
    };
    const onVisibility = () => (document.visibilityState === 'hidden' ? stop() : start());

    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive = false;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // The index is only needed for unseen slots, so it is fetched the first time
  // that is switched on and then held.
  useEffect(() => {
    if (!showUnseen || dexIndex) return;
    let alive = true;
    fetchDexIndex()
      .then((ix) => alive && setDexIndex(ix))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [showUnseen, dexIndex]);

  /**
   * Fetch the open entry, once.
   *
   * In an effect keyed on the card rather than inside the click handler, so a
   * double press, a card reopened from the cache and an incidental re-render
   * cannot each start a request. `alive` is the same guard the index fetch
   * above uses.
   */
  useEffect(() => {
    if (!dexOpen) return;
    const key = dexKey(dexOpen);
    if (dexCache.current.has(key)) return;
    let alive = true;
    fetchDexEntry(dexOpen.speciesId, dexOpen.shiny)
      .then((e) => {
        if (e) dexCache.current.set(key, e);
        if (alive && e) setDexDetail(e);
      })
      .catch((err) => alive && setDexErr(String(err)));
    return () => {
      alive = false;
    };
  }, [dexOpen]);

  /**
   * Put the cursor back on the card you came from.
   *
   * By key, not by a captured node: the grid was unmounted while the entry was
   * open, so the button that opened it is a NEW element. Focusing it also
   * scrolls it back into view, which is the scroll restoration this screen
   * would otherwise need a second mechanism for.
   */
  useEffect(() => {
    if (dexOpen !== null || dexReturn.current === null) return;
    const key = dexReturn.current;
    dexReturn.current = null;
    document.querySelector<HTMLButtonElement>(`.dex [data-key="${key}"]`)?.focus();
  }, [dexOpen]);

  /**
   * Escape goes back, the way B does in the games.
   *
   * On the window rather than on the screen: the panel scrolls, so after a
   * wheel-scroll focus is on the scroller or on nothing at all, and a handler
   * that only fired for descendants would work for the keyboard and not for
   * anyone who reached for the mouse first. The field guard is one line and the
   * difference between "works" and "works until someone adds a search box".
   */
  useEffect(() => {
    if (!dexOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA') return;
      closeDex();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dexOpen]);

  if (error && !state) return <div className="app"><p className="err">연결 실패: {error}</p></div>;
  if (!state) return <div className="app"><p className="muted">스캔 중… (첫 실행은 몇 초 걸립니다)</p></div>;

  const { tokens, companion, progress } = state;
  const pct = Math.round(progress.ratio * 100);
  const remaining = Math.max(0, progress.need - progress.have);
  /**
   * The product the clerk is asking about, read live rather than captured.
   *
   * `till` holds an id, so a payload that arrives between the question and the
   * answer cannot leave a stale price on screen. A product that vanished takes
   * the question with it.
   */
  const product = (id: string) => state.shop.products.find((p) => p.id === id) ?? null;
  const asked = till.at === 'ask' ? product(till.id) : null;
  /** The row being pointed at, if the clerk is not mid-question. */
  const picked = till.at === 'pick' ? product(till.id) : null;

  /**
   * Point at a row without committing to it.
   *
   * Hover AND focus, because a cursor is not the only way to move down a list —
   * without the focus half, the description would be invisible to the keyboard.
   * Never overrides a question or a parting line: those are the clerk mid-
   * sentence, and a stray mouse crossing the list must not cut her off.
   */
  const point = (id: string | null) =>
    setTill((t) =>
      t.at === 'ask' || t.at === 'said' ? t : id === null ? { at: 'idle' } : { at: 'pick', id },
    );
  /**
   * What the bag's description window is showing.
   *
   * Keyed by kind so the three lists cannot collide on a bare number: a TM's
   * move id and a stone's form id live in different spaces but are both ints.
   *
   * A setting explains itself where it sits; an item's description is
   * something you look up, which is the distinction the games draw too — and
   * the reason the settings that used to be at the bottom of this tab never
   * used this window, and have now gone to 설정 entirely.
   */
  /** A bag item's icon, borrowed from the shop row that sells the same id. */
  const itemIcon = (id: string) => state.shop.products.find((p) => p.id === id)?.sprite ?? null;

  const bagKey = bagOver ?? bagPin;
  const bagShown = ((): { name: string; desc: string } | null => {
    if (!bagKey) return null;
    const cut = bagKey.indexOf(':');
    const [kind, key] = [bagKey.slice(0, cut), bagKey.slice(cut + 1)];
    if (kind === 'tm') {
      const m = state.tms.find((t) => String(t.id) === key);
      return m ? { name: m.name, desc: moveSummary(m) } : null;
    }
    if (kind === 'stone') {
      const st = state.bag.stones.find((x) => String(x.id) === key);
      return st ? { name: st.ko, desc: `${st.formKo}${euro(st.formKo)} 메가진화합니다.` } : null;
    }
    const desc = ITEM_DESC[key];
    return desc ? { name: ITEM_NAMES[key] ?? key, desc } : null;
  })();

  /** Whatever the companion is actually called, for the egg warning. */
  const petName = state.companion
    ? (state.companion.nickname ?? state.companion.name)
    : '';

  const bagItems = Object.entries(state.bag.inventory).filter(([, n]) => (n ?? 0) > 0) as [
    string,
    number,
  ][];

  /**
   * The two pockets the inventory splits into.
   *
   * Same source, cut by whether there is anything to press. A passive works by
   * being owned, so 도구 holds only what a button belongs on and 중요한 물건
   * holds the rest — see POCKETS.
   */
  const usableItems = bagItems.filter(([id]) => !PASSIVE.has(id));
  const keyItems = bagItems.filter(([id]) => PASSIVE.has(id));

  /**
   * What is different about the game right now, said in the description window
   * whenever nothing is being pointed at.
   *
   * These lines used to sit in a `<p>` under the item list — the least visible
   * place on the screen, for the one thing on it that says the rules have
   * changed. Meanwhile the biggest element sat empty waiting to be hovered.
   *
   * Joined rather than concatenated with a trailing separator, which is what
   * the old line did: three conditional fragments each ending in ` · ` left
   * `다음 부화 샤이니 확률 8배 · ` dangling whenever the last one was absent.
   */
  const bagEffects = [
    state.bag.everstone && '진화 정지 중',
    state.bag.shinyCharmActive && '다음 부화 샤이니 확률 8배',
    state.bag.forcedRarity && `다음 부화 ${RARITY_LABEL[state.bag.forcedRarity]} 보장`,
  ].filter((v): v is string => typeof v === 'string');

  /**
   * What the bag's tab dot counts.
   *
   * The legendary pocket has to be in here: a signature item dropping is the
   * single most worth-a-look thing that can land in the bag, and it lit no dot
   * at all because this only ever summed `inventory`.
   */
  const bagCount =
    bagItems.reduce((a, [, n]) => a + n, 0) +
    state.legends.items.reduce((a, i) => a + i.count, 0) +
    state.legends.eggs.reduce((a, e) => a + e.count, 0) +
    state.legends.shards.filter((sh) => sh.ready).length;

  /**
   * The machine pocket's page, and the slice it shows.
   *
   * `tmAt` is CLAMPED here rather than corrected in an effect: teaching consumes
   * the machine, so the list shrinks under the page you are standing on, and the
   * last page can stop existing between one render and the next. Deriving it
   * means the render after a teach is already right — an effect would paint the
   * empty page first and fix it a frame later.
   */
  const tmPages = Math.max(1, Math.ceil(state.tms.length / TM_PAGE));
  const tmAt = Math.min(tmPage, tmPages - 1);
  const tmShown = state.tms.slice(tmAt * TM_PAGE, (tmAt + 1) * TM_PAGE);

  /** The TM waiting on a slot, named — JSX cannot declare a const inline and
   *  the particle needs the name a second time. */
  const pendingTmName =
    pendingTm === null ? null : (state.tms.find((t) => t.id === pendingTm)?.name ?? '기술');

  const activeFilters = [fRarity, fGen, fType].filter((v) => v !== null).length;
  const matches = (e: { rarity: string; generation: number; types: { id: string }[] }) =>
    (fRarity === null || e.rarity === fRarity) &&
    (fGen === null || e.generation === fGen) &&
    (fType === null || e.types.some((t) => t.id === fType));

  /**
   * What the grid renders.
   *
   * Collected entries carry their own art; unseen slots are pulled from the
   * index and show a placeholder, so switching the toggle on downloads nothing.
   */
  const dexCards = ((): DexCard[] => {
    const seen: DexCard[] = state.dex.filter(matches).map((d) => ({ ...d, seen: true }));
    const have = new Set(state.dex.map((d) => d.speciesId));
    /**
     * Every legendary still behind a gate, shown whether or not 미수집 포함 is on.
     *
     * A slot you cannot see is not a goal, and turning them into goals is the
     * whole point — so these do not wait for a toggle the way the other 1000
     * empty slots do. They carry their gate with them so the entry screen has
     * something to say without another request.
     */
    const locked: DexCard[] = state.legends.gates
      .filter((g) => !have.has(g.speciesId))
      .map((g) => ({
        speciesId: g.speciesId,
        name: g.ko,
        shiny: false,
        sprite: null,
        rarity: 'legendary',
        generation: g.gen,
        types: [],
        seen: false,
        locked: g,
      }))
      .filter(matches);

    if (!showUnseen || !dexIndex) {
      /**
       * Collected first, locked after — NOT interleaved by number.
       *
       * Sorting all of them together buries the dex: nine caught species
       * against ninety-four `?` cards puts the first real one below the fold
       * (#425 lands on row six), so the screen that is supposed to show what
       * you have shows mostly what you don't. With 미수집 포함 on the whole
       * 1025 are in numeric order anyway and a legendary belongs in its slot,
       * so that branch is left alone.
       */
      return [
        ...seen.sort((a, b) => a.speciesId - b.speciesId),
        ...locked.sort((a, b) => a.speciesId - b.speciesId),
      ];
    }
    const shown = new Set([...have, ...locked.map((l) => l.speciesId)]);
    const missing: DexCard[] = dexIndex
      .filter((e) => !shown.has(e.speciesId) && matches(e))
      .map((e) => ({ ...e, shiny: false, sprite: null, seen: false }));
    return [...seen, ...locked, ...missing].sort((a, b) => a.speciesId - b.speciesId);
  })();
  const affordable = state.shop.products.filter(
    (p) => !p.award && state.shop.wallet >= p.price,
  ).length;

  /** Generations present in the gate table, in order. */
  const legendGens = [...new Set(state.legends.gates.map((g) => g.gen))].sort((a, b) => a - b);
  const legendsOpen = state.legends.gates.filter((g) => g.open).length;
  const legendsDone = state.legends.gates.filter((g) => g.done).length;
  const legendPct = state.legends.gates.length
    ? Math.max(legendsOpen ? 1 : 0, (legendsOpen / state.legends.gates.length) * 100)
    : 0;

  const awardsDone = state.awards.filter((a) => a.at !== null).length;
  const awardPct = state.awards.length
    ? Math.max(awardsDone ? 1 : 0, (awardsDone / state.awards.length) * 100)
    : 0;
  /** The categories, in table order, deduped — so adding one needs no edit here. */
  const awardCats = state.awards.reduce<{ cat: string; catKo: string }[]>((acc, a) => {
    if (!acc.some((c) => c.cat === a.cat)) acc.push({ cat: a.cat, catKo: a.catKo });
    return acc;
  }, []);
  const shownAwards = state.awards.filter(
    (a) =>
      (awardCat === null || a.cat === awardCat) &&
      !(hideDone && a.at !== null && a.repeat === null),
  );
  /** Unlocked since the board was last opened. Written by tick and goTab. */
  const unseenAwards = Math.max(0, awardsDone - awardsSeen);
  /**
   * Hunting has earned everything its share allows.
   *
   * `Math.min(room(), ...)` in hunt() means an encounter past the cap records
   * zero, so the log fills with "—" and the bar stops — with nothing on screen
   * saying why. Both numbers are already on the payload; this is only the panel
   * noticing that they have met.
   */
  const huntCapped = state.hunt.cap !== null && state.hunt.tokens >= state.hunt.cap;

  return (
    /* The 9-slice frames need their custom properties on an ancestor. Set once
       here rather than on each window that wears one — `.scene` sets its own
       copy inline, which is how it keeps the bright frame in dark mode. */
    <div className="app" style={battleUiVars() as React.CSSProperties}>
      {flash && <div className="flash">{flash}</div>}

      {/*
        A real tablist, not just the roles.
        
        A <div>, not a <nav>: role="tablist" suppresses the landmark anyway, so
        the element was announcing navigation it did not provide. And the
        keyboard contract the roles promise is implemented below — six separate
        tab stops with inert arrow keys is the opposite of the ARIA pattern.
      */}
      <div
        className="tabs"
        role="tablist"
        aria-label="화면"
        onKeyDown={(e) => {
          const i = TABS.findIndex((t) => t.id === tab);
          const to =
            e.key === 'ArrowRight' ? (i + 1) % TABS.length
            : e.key === 'ArrowLeft' ? (i - 1 + TABS.length) % TABS.length
            : e.key === 'Home' ? 0
            : e.key === 'End' ? TABS.length - 1
            : -1;
          if (to < 0) return;
          // Without this the arrows scroll the panel underneath instead.
          e.preventDefault();
          // Selection follows focus: panels here are cheap to render, and it
          // keeps the keyboard consistent with what a click already does.
          goTab(TABS[to].id);
          tabRefs.current[to]?.focus();
        }}
      >
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            id={`tab-${t.id}`}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls="tabpanel"
            /* Roving tabindex: one stop for the whole set, arrows move within. */
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? 'on' : ''}
            onClick={() => goTab(t.id)}
          >
            {t.label}
            {/* A quiet dot beats a number badge here — it says "worth a look"
                without turning the panel into a notification centre. */}
            {t.id === 'shop' && affordable > 0 && <i className="dot" />}
            {t.id === 'bag' && bagCount > 0 && <i className="dot" />}
            {t.id === 'awards' && unseenAwards > 0 && <i className="dot" />}
          </button>
        ))}
      </div>

      {/*
        Stale, not broken. The panel keeps rendering the last good data — this
        only admits its age, which is why it is muted rather than .err red and
        a persistent bar rather than the .flash toast (that one auto-dismisses
        after 3s and would re-fire every 5s while a server is down).
      */}
      {state && fails >= STALE_AFTER && (
        <div className="stale" title={error ?? undefined}>
          <span>연결 실패 · {agoLabel(staleMs)} 정보</span>
          <button
            className="linky"
            disabled={retrying}
            onClick={async () => {
              setRetrying(true);
              try {
                await refresh.current(true);
              } finally {
                setRetrying(false);
              }
            }}
          >
            다시 시도
          </button>
        </div>
      )}

      <div ref={panelRef} className="tabpanel" role="tabpanel" id="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={0}>

      {tab === 'pet' && (
      <>
      <Scene
        companion={
          companion
            ? {
                name: companion.nickname ?? companion.name,
                sprite: companion.sprite,
                backSprite: companion.backSprite,
              }
            : null
        }
        eggSprite={state.eggSprite}
        eggRatio={progress.ratio}
        log={state.hunt.log}
        idleReason={state.hunt.idleReason}
        nextInMs={state.hunt.nextInMs}
        stop={journeyFor(state.hunt.count)}
        skylineBg={state.hunt.skylineBg}
        /*
         * Read at render rather than on a timer of its own. The payload already
         * re-renders this every few seconds, so a phase change lands within one
         * poll of the hour turning over — and nothing here is worth its own
         * interval to make that instant.
         */
        timeOfDay={timeOfDayAt(new Date())}
        fx={state.fx}
        capped={huntCapped}
      />

      {/* The portrait: a picture with a caption, so it is the one thing that
          stays centred while the rest of the panel shares a left edge. */}
      <div className="portrait">
        <h1>
          {companion ? (companion.nickname ?? companion.name) : '알'}
          {companion?.isShiny && <span className="shiny" title="색이 다른 개체">✨</span>}
          {companion && draftName === null && (
            <button
              className="namebtn"
              title="이름 바꾸기"
              aria-label="이름 바꾸기"
              onClick={() => setDraftName(companion.nickname ?? '')}
            >
              ✏️
            </button>
          )}
        </h1>

        {companion && draftName !== null && (
          <div className="rename">
            <input
              autoFocus
              aria-label="닉네임"
              value={draftName}
              maxLength={NICKNAME_MAX}
              placeholder={companion.name}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                // Enter commits, Escape abandons. An empty box clears the nickname.
                if (e.key === 'Enter') {
                  const next = draftName;
                  setDraftName(null);
                  void act('rename', next);
                } else if (e.key === 'Escape') {
                  setDraftName(null);
                }
              }}
            />
            <button
              disabled={busy}
              onClick={() => {
                const next = draftName;
                setDraftName(null);
                void act('rename', next);
              }}
            >
              확인
            </button>
          </div>
        )}

        {companion && (
          <p className="muted sub">
            {/* The species name still belongs on screen once a nickname hides it. */}
            {companion.nickname ? `${companion.name} · ` : ''}
            {companion.nameEn}
            {companion.genus && ` · ${companion.genus}`}
          </p>
        )}

        {companion && companion.types.length > 0 && (
          <ul className="types">
            {companion.types.map((t) => (
              <li key={t.id} data-type={t.id}>
                {t.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bar" role="progressbar" aria-valuenow={pct}>
        <div className="fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="muted sub">
        {progress.phase === 'egg' && `부화까지 ${compact(remaining)} 남음`}
        {progress.phase === 'growing' && `다음 진화까지 ${compact(remaining)} 남음`}
        {progress.phase === 'final' && `졸업까지 ${compact(remaining)} 남음`}
        {' · '}{pct}%
      </p>

      {companion && companion.stageCount > 1 && (
        <p className="chain">
          {companion.path.map((s, i) => (
            <span key={s.id} className={i === companion.stageIndex ? 'now' : i < companion.stageIndex ? 'done' : ''}>
              {s.name}
              {i < companion.path.length - 1 && <em> → </em>}
            </span>
          ))}
        </p>
      )}

      {companion && (
        <>
          <h2>상태</h2>
          <ul className="bars info">
            <li>
              <span className="lbl">단계</span>
              <span className="num">
                {companion.stageIndex + 1} / {companion.stageCount}
              </span>
            </li>
            <li>
              <span className="lbl">희귀도</span>
              <span className="num">{RARITY_LABEL[companion.rarity]}</span>
            </li>
            <li>
              <span className="lbl">성격</span>
              <span className="num">{companion.nature}</span>
            </li>
            <li>
              <span className="lbl">크기</span>
              <span className="num">
                {companion.heightM}m · {companion.weightKg}kg
              </span>
            </li>
            <li>
              <span className="lbl">함께한 진행도</span>
              <span className="num">{compact(companion.withYou)}</span>
            </li>
            <li>
              <span className="lbl">만난 포켓몬</span>
              <span className="num">{state.hunt.sinceBirth.count.toLocaleString()}회</span>
            </li>
            {/*
              * One row per battle form this species could reach.
              *
              * Shown whenever the species HAS one, not only once everything is
              * satisfied — the row used to appear only when nothing was left to
              * say, so the one moment it could have helped was the one moment
              * it was absent. Ordinary species still get no row at all, which
              * is why this is not a "없음" line on a thousand Pokemon.
              */}
            {companion.forms.map((f) => (
              <li key={f.id}>
                <span className="lbl">배틀에서</span>
                <span className={`num${f.ready ? '' : ' pending'}`}>
                  {f.ko}
                  {f.ready ? '' : ` · ${formNeed(f, state.bag.everstone)}`}
                </span>
              </li>
            ))}
          </ul>
          {companion.battleForm && (
            <ul className="items">
              <li>
                <span className="lbl">
                  배틀 모습으로 보기
                  <em>
                    {companion.battleForm.ko}
                    {josa(companion.battleForm.ko, '은', '는')} 배틀에서만 나타납니다. 켜면 떠 있는
                    펫과 이 화면에도 그 모습으로 보입니다 — 보이기만 할 뿐 규칙은 그대로입니다.
                  </em>
                </span>
                <button
                  disabled={busy}
                  onClick={() => act('form', state.bag.showBattleForm ? 'off' : 'on')}
                >
                  {state.bag.showBattleForm ? '켜짐' : '꺼짐'}
                </button>
              </li>
            </ul>
          )}

          <h2>기술</h2>
          {/* The moveset belongs to the partner, so it is managed here. The bag
              holds the TMs; using one is what sends you there. */}
          <ul className="items">
            {/* Four rows always, so the slot count is visible rather than implied. */}
            {Array.from({ length: state.hunt.slots }, (_, i) => {
              const m = state.moves[i];
              if (!m) {
                return (
                  <li key={`empty-${i}`} className="empty">
                    <span className="icon" />
                    <span className="lbl">
                      빈 칸
                      <em>가방의 기술머신으로 채웁니다.</em>
                    </span>
                  </li>
                );
              }
              // The server refuses this too, but a disabled button that says
              // why is a rule; a red toast after the click is an error.
              const lastAttack = isAttack(m) && state.moves.filter(isAttack).length === 1;
              return (
                <li key={m.id} data-type={m.type} className={`row${bagKey === `tm:${m.id}` ? ' on' : ''}`}>
                  {m.sprite ? (
                    <img className="icon" src={spriteUrl(m.sprite)} alt="" />
                  ) : (
                    <span className="icon" />
                  )}
                  <span className="lbl">
                    {m.name}
                    <em>{lastAttack ? `${moveSummary(m)} · 하나뿐인 공격 기술` : moveSummary(m)}</em>
                  </span>
                  <button
                    disabled={busy || lastAttack}
                    title={lastAttack ? '공격 기술은 하나 남겨두어야 합니다.' : undefined}
                    onClick={() => act('forget', String(i))}
                  >
                    잊기
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="grid">
        <div className="stat">
          <span className="k">오늘</span>
          <span className="v">{compact(tokens.today)}</span>
          <span className="k">{tokens.todayMessages.toLocaleString()} messages</span>
        </div>
        <div className="stat">
          <span className="k">펫과 함께</span>
          <span className="v">{compact(tokens.lifetime)}</span>
          <span className="k">설치 이후</span>
        </div>
        <div className="stat">
          <span className="k">전체 기록</span>
          <span className="v">{compact(tokens.total)}</span>
          <span className="k">기준선 포함</span>
        </div>
      </div>

      <h2>자동사냥</h2>
      {/* Why hunting is idle is said in the scene caption, right above — saying
          it twice on one screen is worse than saying it once, in the picture. */}
      {!state.hunt.idleReason && state.hunt.speed > 1 && (
        <p className="muted sub">기술 덕분에 사냥 속도 ×{state.hunt.speed.toFixed(2)}</p>
      )}
      {/* The one thing the two numbers below cannot say on their own: they have
          met. Encounters and TM drops carry on; only the progress stops, and
          without this the bar just sits still and reads as a bug. */}
      {huntCapped && (
        <p className="muted sub warn">
          사냥 진행도가 상한에 닿았습니다. 조우와 기술머신은 계속되지만 진행도는 오르지
          않습니다 — 상한은 번 토큰에 비례하므로 코딩을 하면 함께 올라갑니다.
        </p>
      )}
      {/* This companion's numbers, because this is its tab. The lifetime pair
          lives on the cap row below, which is the one figure that cannot be
          scoped to a companion — the ceiling weighs everything hunting has ever
          contributed against everything ever earned. */}
      <ul className="bars info">
        <li>
          <span className="lbl">사냥으로 얻은 진행도</span>
          <span className="num">{compact(state.hunt.sinceBirth.tokens)}</span>
        </li>
        <li>
          <span className="lbl">만난 포켓몬</span>
          <span className="num">{state.hunt.sinceBirth.count.toLocaleString()}회</span>
        </li>
        <li>
          {/* The share cap is the reason hunting cannot replace coding. Showing
              it keeps that honest rather than letting the bar quietly stall.
              Labelled 누적 so it is not read as a ceiling on the row above. */}
          <span className="lbl">사냥 상한 (누적)</span>
          <span className={huntCapped ? 'num warn' : 'num'}>
            {state.hunt.cap === null
              ? `${compact(state.hunt.tokens)} · 해제됨`
              : `${compact(state.hunt.tokens)} / ${compact(state.hunt.cap)}`}
          </span>
        </li>
      </ul>

      {/* The blow-by-blow lives on 기록. Eight rows of it here buried the
          partner's own information, and the scene above already plays the most
          recent encounter live. */}
      {state.hunt.log.length > 0 && (
        <p className="muted sub">
          방금 {state.hunt.log[0].trainer?.name ?? state.hunt.log[0].wildName}
          {state.hunt.log[0].tokens > 0 && ` · +${compact(state.hunt.log[0].tokens)}`}
          {' · '}
          <button className="linky" onClick={() => goTab('stats')}>
            사냥 기록 보기
          </button>
        </p>
      )}
      </>
      )}

      {tab === 'stats' && (
      <>
      <h2>사냥 기록</h2>
      {state.hunt.log.length === 0 ? (
        <p className="muted sub">아직 조우한 기록이 없습니다.</p>
      ) : (
        <>
          <ul className="hunts">
            {/* Five is enough to see what has been happening; the rest is on
                request, with the move used and any TM that dropped. */}
            {(allHunts ? state.hunt.log : state.hunt.log.slice(0, 5)).map((e) => (
              <li key={e.seq}>
                {/* Before `.who`, which is `flex: 1` — anywhere else and the
                    name column would have to give up its own width. */}
                <span className="icon">
                  {e.icon ? <img src={spriteUrl(e.icon)} alt="" /> : '·'}
                </span>
                <span className="who">
                  {e.trainer ? e.trainer.name : e.wildName}
                  {/* A legendary fight can be lost too, and the row said
                      nothing about it — the badge was gated on `trainer`. */}
                  {(e.trainer || e.legend) && (
                    <em className={`how ${(e.trainer?.won ?? e.legend?.won) ? 'win' : 'loss'}`}>
                      {' '}
                      {(e.trainer?.won ?? e.legend?.won) ? '승' : '패'}
                    </em>
                  )}
                </span>
                {allHunts && e.trainer?.item && (
                  <span className="tm">{ITEM_NAMES[e.trainer.item] ?? e.trainer.item}</span>
                )}
                {allHunts && e.moveName && <span className="tm">{e.moveName}</span>}
                {/* A stone is rarer than a TM, so it shows in the collapsed
                    list too — the five-row default is where it would be missed. */}
                {e.stoneKo && <span className="tm">{e.stoneKo}</span>}
                {allHunts && e.formKo && <span className="tm">{e.formKo}</span>}
                <span className="num">{e.tokens > 0 ? `+${compact(e.tokens)}` : '—'}</span>
              </li>
            ))}
          </ul>
          {state.hunt.log.length > 5 && (
            <p className="muted sub">
              <button className="linky" onClick={() => setAllHunts(!allHunts)}>
                {allHunts ? '접기' : `전체 ${state.hunt.log.length}건 보기`}
              </button>
            </p>
          )}
        </>
      )}

      <h2>어디서 썼나</h2>
      <ul className="bars">
        {Object.entries(tokens.byEntrypoint)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => {
            const max = Math.max(...Object.values(tokens.byEntrypoint));
            return (
              <li key={k}>
                <span className="lbl">{ENTRYPOINT_LABEL[k] ?? k}</span>
                <span className="track"><i style={{ width: `${(v / max) * 100}%` }} /></span>
                <span className="num">{compact(v)}</span>
              </li>
            );
          })}
      </ul>

      <h2>최근 14일</h2>
      <ul className="bars">
        {Object.entries(tokens.byDay)
          .sort()
          .slice(-14)
          .reverse()
          .map(([d, v], _i, arr) => {
            const max = Math.max(...arr.map(([, x]) => x));
            return (
              <li key={d}>
                <span className="lbl">{d.slice(5)}</span>
                <span className="track"><i style={{ width: `${(v / max) * 100}%` }} /></span>
                <span className="num">{compact(v)}</span>
              </li>
            );
          })}
      </ul>

      <h2>모델별</h2>
      <ul className="bars">
        {Object.entries(tokens.byModel)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v], _i, arr) => {
            const max = Math.max(...arr.map(([, x]) => x));
            return (
              <li key={k}>
                <span className="lbl" title={k}>{k.replace('claude-', '')}</span>
                <span className="track"><i style={{ width: `${(v / max) * 100}%` }} /></span>
                <span className="num">{compact(v)}</span>
              </li>
            );
          })}
      </ul>
      </>
      )}

      {tab === 'bag' && (
      <>
      <h2>가방</h2>
      {/* Pockets, which is how the games carve a bag up — five Cases in Gen 5.
          Three here, and they exist whether or not they hold anything. Without
          them fourteen TMs, the items and the stones are one endless column. */}
      <div className="chips shopchips" role="group" aria-label="가방 주머니">
        {POCKETS.map((k) => (
          <button
            key={k.id}
            className={pocket === k.id ? 'on' : ''}
            onClick={() => {
              setPocket(k.id);
              setTmPage(0);
              // A half-made "which one do I forget" belongs to the pocket it
              // was started in; carrying it to 메가스톤 and back is a question
              // hanging over a screen that cannot answer it.
              setPendingTm(null);
            }}
          >
            {k.label}
          </button>
        ))}
      </div>
      {/*
        * The same window the counter uses, in the same place, saying the same
        * kind of thing — so the two tabs read as one screen.
        *
        * Three states, not two. Pointing at a row still fills it; but with
        * nothing pointed at it now reports what is actually in effect rather
        * than waiting to be hovered. The biggest element on the screen used to
        * be the emptiest, while the fact that evolution was stopped sat in a
        * grey line under the list.
        */}
      <div className="saywin uiwin" aria-live="polite">
        {bagShown ? (
          <>
            <span className="saywin-line">
              <span>{bagShown.name}</span>
            </span>
            <span className="saywin-desc">{bagShown.desc}</span>
          </>
        ) : bagEffects.length > 0 ? (
          <>
            <span className="saywin-line">
              <span>지금 걸린 효과</span>
            </span>
            <span className="saywin-desc">{bagEffects.join(' · ')}</span>
          </>
        ) : (
          '고르면 여기에 설명이 나옵니다.'
        )}
      </div>

      {pocket === 'tm' && (
      <>
      {/* Only while a TM is waiting on a slot. The four slots live on 파트너, so
          this is a compact stand-in rather than a second copy of that list. */}
      {pendingTmName !== null && (
        <>
          <p className="pickhint">
            {pendingTmName}
            {josa(pendingTmName, '을', '를')} 배우려면 하나를 잊어야 합니다.{' '}
            <button className="linky" onClick={() => setPendingTm(null)}>
              취소
            </button>
          </p>
          <ul className="items">
            {state.moves.map((m, i) => {
              // Swapping an attack for an attack is always fine; it is only
              // trading the last one AWAY for a status move that is refused.
              const incomingHits = state.tms.find((t) => t.id === pendingTm)?.damageClass !== 'status';
              const lastAttack =
                !incomingHits && isAttack(m) && state.moves.filter(isAttack).length === 1;
              return (
                <li key={m.id} className="picking" data-type={m.type}>
                  {/* The summary is what makes 변화 visible — without it you are
                      picking what to sacrifice by name alone. */}
                  <span className="lbl">
                    {m.name}
                    <em>{lastAttack ? `${moveSummary(m)} · 하나뿐인 공격 기술` : moveSummary(m)}</em>
                  </span>
                  <button
                    disabled={busy || lastAttack}
                    title={lastAttack ? '공격 기술은 하나 남겨두어야 합니다.' : undefined}
                    onClick={() => {
                      const tm = pendingTm;
                      setPendingTm(null);
                      void act('teach', String(tm), i);
                    }}
                  >
                    이걸 잊기
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {state.tms.length === 0 ? (
        <p className="muted sub">
          {state.unusableTmCount > 0
            ? `가진 기술머신 ${state.unusableTmCount}개는 지금 포켓몬이 배울 수 없습니다.`
            : '아직 없습니다. 자동사냥 중에 가끔 떨어집니다.'}
        </p>
      ) : (
        <ul className="items">
          {tmShown.map((m) => (
            <li key={m.id} data-type={m.type} className={`row${bagKey === `tm:${m.id}` ? ' on' : ''}`}>
              {m.sprite ? (
                <img className="icon" src={spriteUrl(m.sprite)} alt="" />
              ) : (
                <span className="icon" />
              )}
              <button
                className="lbl rowbtn"
                aria-pressed={bagPin === `tm:${m.id}`}
                onMouseEnter={() => setBagOver(`tm:${m.id}`)}
                onMouseLeave={() => setBagOver(null)}
                onFocus={() => setBagOver(`tm:${m.id}`)}
                onBlur={() => setBagOver(null)}
                onClick={() => setBagPin(bagPin === `tm:${m.id}` ? null : `tm:${m.id}`)}
              >
                <span>
                  {m.name} {m.count > 1 && <b>×{m.count}</b>}
                </span>
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  // Four slots full? Ask which one to overwrite instead of
                  // silently refusing, which is what the server would do.
                  state.moves.length >= state.hunt.slots
                    ? setPendingTm(m.id)
                    : void act('teach', String(m.id))
                }
              >
                배우기
              </button>
            </li>
          ))}
        </ul>
      )}
      {/*
        * Pages rather than one long column.
        *
        * Only when there is more than one — a pager reading `1 / 1` is a control
        * that says nothing, which is the same rule that gives a species with no
        * forms no row at all.
        */}
      {tmPages > 1 && pendingTmName === null && (
        <div className="pager">
          <button
            aria-label="이전 쪽"
            disabled={tmAt === 0}
            onClick={() => setTmPage(tmAt - 1)}
          >
            ◀
          </button>
          <span className="num">
            {tmAt + 1} / {tmPages}
          </span>
          <button
            aria-label="다음 쪽"
            disabled={tmAt >= tmPages - 1}
            onClick={() => setTmPage(tmAt + 1)}
          >
            ▶
          </button>
        </div>
      )}
      {state.tms.length > 0 && state.unusableTmCount > 0 && (
        <p className="muted sub">
          이 포켓몬이 배울 수 없는 기술머신 {state.unusableTmCount}개는 숨겨져 있습니다.
        </p>
      )}
      </>
      )}

      {pocket === 'item' && (
      <>

      {usableItems.length === 0 ? (
        <p className="muted sub">아직 아이템이 없습니다.</p>
      ) : (
        <ul className="items">
          {usableItems.map(([id, n]) => {
            // The everstone is genuinely switched, which is why it is here and
            // the key stone is not: this pocket holds what a button belongs on.
            const worn = id === 'everstone' && state.bag.everstone;
            const fused = id === 'dna-splicers' && !!state.companion?.form;
            // Kyurem can fuse two ways, so the choice has to be made here rather
            // than guessed. One option needs no picker.
            const choices = id === 'dna-splicers' ? (state.companion?.fusions ?? []) : [];
            return (
              <li key={id} className={`row${bagKey === `item:${id}` ? ' on' : ''}`}>
                {/* The games put an icon immediately left of every bag line. The
                    shop already resolved one for this very id, so reuse it
                    rather than asking the payload for the same file twice. */}
                {itemIcon(id) ? (
                  <img className="icon" src={spriteUrl(itemIcon(id)!)} alt="" />
                ) : (
                  <span className="icon">💠</span>
                )}
                <button
                  className="lbl rowbtn"
                  aria-pressed={bagPin === `item:${id}`}
                  onMouseEnter={() => setBagOver(`item:${id}`)}
                  onMouseLeave={() => setBagOver(null)}
                  onFocus={() => setBagOver(`item:${id}`)}
                  onBlur={() => setBagOver(null)}
                  onClick={() => setBagPin(bagPin === `item:${id}` ? null : `item:${id}`)}
                >
                  <span>
                    {ITEM_NAMES[id] ?? id} <b>×{n}</b>
                  </span>
                </button>
                {choices.length > 1 && !fused ? (
                  <span className="picker">
                    {choices.map((f) => (
                      <button key={f.id} onClick={() => act('use', id, f.id)} disabled={busy}>
                        {f.partnerKo}
                      </button>
                    ))}
                  </span>
                ) : (
                  <button onClick={() => act('use', id)} disabled={busy}>
                    {fused ? '분리' : worn ? '해제' : '사용'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      </>
      )}

      {pocket === 'key' && (
      <>
      {/* Nothing in here has a control, and that is the point — a passive works
          by being owned. Pointing at one still says what it does, which is the
          only reason to open this pocket at all. */}
      {keyItems.length === 0 ? (
        <p className="muted sub">아직 중요한 물건이 없습니다. 상점에 있습니다.</p>
      ) : (
        <ul className="items">
          {keyItems.map(([id]) => (
            <li key={id} className={`row${bagKey === `item:${id}` ? ' on' : ''}`}>
              {itemIcon(id) ? (
                <img className="icon" src={spriteUrl(itemIcon(id)!)} alt="" />
              ) : (
                <span className="icon">💠</span>
              )}
              <button
                className="lbl rowbtn"
                aria-pressed={bagPin === `item:${id}`}
                onMouseEnter={() => setBagOver(`item:${id}`)}
                onMouseLeave={() => setBagOver(null)}
                onFocus={() => setBagOver(`item:${id}`)}
                onBlur={() => setBagOver(null)}
                onClick={() => setBagPin(bagPin === `item:${id}` ? null : `item:${id}`)}
              >
                {/* No count: an accessory is not a stack, and a ×1 beside it
                    reads as something you spend. */}
                <span>{ITEM_NAMES[id] ?? id}</span>
              </button>
              <span className="badge">보유 중</span>
            </li>
          ))}
        </ul>
      )}
      </>
      )}

      {pocket === 'stone' && (
      <>
      {/* A collection won by hunting that outlives the companion, so it gets a
          pocket of its own rather than living under the items. */}
      {state.bag.stones.length === 0 ? (
        <p className="muted sub">아직 메가스톤이 없습니다. 자동사냥 중에 가끔 떨어집니다.</p>
      ) : (
        <>
          <ul className="items">
            {/* Usable first. A hundred stones sorted by id is a wall, and the
                one that matters is the one this companion can actually use. */}
            {[...state.bag.stones]
              .sort((a, b) => Number(b.usable) - Number(a.usable) || a.id - b.id)
              .map((st) => (
                <li
                  key={st.id}
                  className={`row${st.usable ? ' usable' : ''}${bagKey === `stone:${st.id}` ? ' on' : ''}`}
                >
                  {st.sprite ? (
                    <img className="icon" src={spriteUrl(st.sprite)} alt="" />
                  ) : (
                    <span className="icon">💠</span>
                  )}
                  <button
                    className="lbl rowbtn"
                    aria-pressed={bagPin === `stone:${st.id}`}
                    onMouseEnter={() => setBagOver(`stone:${st.id}`)}
                    onMouseLeave={() => setBagOver(null)}
                    onFocus={() => setBagOver(`stone:${st.id}`)}
                    onBlur={() => setBagOver(null)}
                    onClick={() =>
                      setBagPin(bagPin === `stone:${st.id}` ? null : `stone:${st.id}`)
                    }
                  >
                    <span>
                      {st.ko} <b>×{st.count}</b>
                    </span>
                  </button>
                  {st.usable && <span className="badge">지금 쓸 수 있음</span>}
                </li>
              ))}
          </ul>
          {!(state.bag.inventory['key-stone'] ?? 0) && state.bag.stones.some((st) => st.usable) && (
            <p className="muted sub">
              키스톤이 있으면 배틀에서 메가진화합니다. 상점에 있습니다.
            </p>
          )}
        </>
      )}
      </>
      )}

      {pocket === 'legend' && (
      <>
      {/* Three things that all belong to the legendaries, in the order you meet
          them: the item that summons one, the fragments that become an item,
          and the egg a won fight leaves behind. */}
      {state.legends.waiting && (
        <p className="muted sub warn">
          {state.legends.waiting.ko}
          {josa(state.legends.waiting.ko, '을', '를')} 기다리는 중입니다. 다음 조우에 나타납니다.
        </p>
      )}

      {state.legends.items.length === 0 &&
      state.legends.shards.length === 0 &&
      state.legends.eggs.length === 0 ? (
        <p className="muted sub">
          아직 아무것도 없습니다. 전설의 조건을 채우면 전용 도구가 사냥에서 떨어지기 시작합니다.
          {' '}
          {/* It says 조건 and offered no way to see them. `goTab` clears
              showLegends, so it has to be set after the switch. */}
          <button
            className="linky"
            onClick={() => {
              goTab('dex');
              setShowLegends(true);
            }}
          >
            조건 보기
          </button>
        </p>
      ) : null}

      {state.legends.items.length > 0 && (
        <>
        <h3 className="shelf">전용 도구</h3>
        <ul className="items">
          {state.legends.items.map((it) => (
            <li key={it.slug} className="row">
              <span className="icon">
                {it.sprite ? <img src={spriteUrl(it.sprite)} alt="" /> : '🔮'}
              </span>
              <span className="lbl">
                <span>
                  {it.ko} <b>×{it.count}</b>
                </span>
                {it.forKo && <em>{it.forKo}{josa(it.forKo, '을', '를')} 부릅니다.</em>}
              </span>
              <button onClick={() => act('legend', it.slug)} disabled={busy}>
                사용
              </button>
            </li>
          ))}
        </ul>
        </>
      )}

      {state.legends.shards.length > 0 && (
        <>
        <h3 className="shelf">조각</h3>
        <ul className="items">
          {state.legends.shards.map((sh) => (
            <li key={sh.slug} className={sh.ready ? 'row' : 'row empty'}>
              <span className="icon">🧩</span>
              <span className="lbl">
                <span className="awardtop">
                  <span>{sh.ko} 조각</span>
                  <em className="num">
                    {sh.count} / {sh.need}
                  </em>
                </span>
                <span className="track" aria-hidden="true">
                  <i style={{ width: `${Math.min(100, (sh.count / sh.need) * 100)}%` }} />
                </span>
              </span>
              {sh.ready && (
                <button onClick={() => act('fuse', sh.slug)} disabled={busy}>
                  합치기
                </button>
              )}
            </li>
          ))}
        </ul>
        </>
      )}

      {state.legends.eggs.length > 0 && (
        <>
        <h3 className="shelf">전설의 알</h3>
        {/* Using one graduates whoever is out, exactly as buying a shop egg
            does — so the button says what it costs before it is pressed. */}
        <ul className="items">
          {state.legends.eggs.map((eg) => (
            <li key={eg.speciesId} className="row">
              <span className="icon">
                {eg.sprite ? <img src={spriteUrl(eg.sprite)} alt="" /> : '🥚'}
              </span>
              <span className="lbl">
                <span>
                  {eg.ko}의 알 <b>×{eg.count}</b>
                </span>
                <em>
                  {companion ? `${companion.nickname ?? companion.name}${josa(companion.nickname ?? companion.name, '은', '는')} 도감으로 떠납니다.` : '바로 품기 시작합니다.'}
                </em>
              </span>
              <button onClick={() => act('legendegg', String(eg.speciesId))} disabled={busy}>
                품기
              </button>
            </li>
          ))}
        </ul>
        </>
      )}
      </>
      )}

      </>
      )}

      {tab === 'dex' && dexOpen === null && (
      <>
      <div className="dexbar">
        <h2>도감</h2>
        {!showLegends && (
          <button className="linky" onClick={() => setShowFilters(!showFilters)}>
            {showFilters ? '필터 닫기' : '필터'}
            {activeFilters > 0 && ` (${activeFilters})`}
          </button>
        )}
      </div>
      {/* The bag's pocket chips, borrowed: two views of one collection. It was
          an underlined link in the corner next to 필터, which read as a second
          filter rather than as a second board — and went unfound.

          Named 전설 목록 rather than 전설 because the rarity filter below
          already has a chip called 전설, and two buttons of the same name in
          one screen is a coin toss for anything looking one up. */}
      <div className="chips shopchips" role="group" aria-label="도감 화면">
        <button className={showLegends ? '' : 'on'} onClick={() => setShowLegends(false)}>
          도감
        </button>
        <button className={showLegends ? 'on' : ''} onClick={() => setShowLegends(true)}>
          전설 목록
        </button>
      </div>

      {showLegends && (
      <>
      <p className="sub">
        <b>{legendsOpen}</b>
        <span className="muted">종 조우 가능 / {state.legends.gates.length}종</span>
        {legendsDone > 0 && <span className="muted"> · {legendsDone}종 도감 등록</span>}
      </p>
      <div className="bar" role="progressbar" aria-valuenow={legendPct}>
        <i className="fill" style={{ width: `${legendPct}%` }} />
      </div>
      <p className="muted sub note">
        조건을 채우면 야생에서 만날 수 있게 됩니다. 이기면 그 포켓몬의 알이 남고, 알을 품어
        키워야 도감에 들어갑니다.
      </p>
      {/* Grouped by generation, the same shelf idiom the shop and the awards
          board use. Ninety-four rows in one column is a wall; nine of ten is a
          list you can find something in. */}
      {legendGens.map((gn) => {
        const rows = state.legends.gates.filter((g) => g.gen === gn);
        if (!rows.length) return null;
        const open = rows.filter((g) => g.open).length;
        return (
        <div key={gn}>
          <h3 className="shelf awardshelf">
            {gn}세대 <span className="muted">{open} / {rows.length}</span>
          </h3>
      <ul className="items awards">
        {rows.map((g) => (
          <li key={g.speciesId} className={g.open ? '' : 'empty'}>
            <span className="icon">
              {g.done ? '📕' : g.open ? '✨' : g.ready ? '🔮' : '🔒'}
            </span>
            <span className="lbl">
              <span className="awardtop">
                <span>
                  {g.ko}
                  {g.myth && ' ✦'}
                </span>
                <em className={g.open ? 'got' : 'num'}>
                  {g.done ? '등록 완료' : g.open ? '조우 가능' : `${compact(Math.min(g.have, g.need))} / ${compact(g.need)}`}
                </em>
              </span>
              <em>
                {g.how}
                {g.itemKo && !g.held ? ` · ${g.itemKo} 필요` : ''}
              </em>
              {!g.open && (
                <span className="track" aria-hidden="true">
                  <i style={{ width: `${g.ratio * 100}%` }} />
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
        </div>
        );
      })}
      </>
      )}

      {!showLegends && (
      <>
      {/*
        Two counts in two different units, side by side.

        The dex counts SPECIES and the retirement counter counts INDIVIDUALS,
        and they diverge on purpose: a Pyroar that graduates registers Litleo
        alongside it. Without a unit on the numerator, "4" next to "2마리를
        떠나보냈습니다" reads as a counter that stopped incrementing — so the
        numerator carries 종, and the gap says out loud why it exists.
      */}
      <p className="sub">
        <b>{state.dex.length}</b>
        <span className="muted">종 / {state.dexTotal}종</span>
        {state.retiredCount > 0 && (
          <span className="muted"> · {state.retiredCount}마리를 떠나보냈습니다</span>
        )}
        {state.retiredCount > 0 && state.dex.length > state.retiredCount && (
          <span className="muted note">진화 전 단계도 함께 등록되어 종 수가 더 많습니다.</span>
        )}
      </p>
      <div className="bar">
        {/* One entry out of 1025 rounds to 0%, which reads as "nothing yet".
            Floor a non-empty dex at a visible sliver instead. */}
        <i
          className="fill"
          style={{
            width: state.dex.length
              ? `${Math.max(1, (state.dex.length / state.dexTotal) * 100)}%`
              : '0%',
          }}
        />
      </div>

      {showFilters && (
        <div className="filters">
          <section>
            <h3>등급</h3>
            <div className="chips">
              {Object.entries(RARITY_LABEL).map(([id, label]) => (
                <button
                  key={id}
                  className={fRarity === id ? 'on' : ''}
                  onClick={() => setFRarity(fRarity === id ? null : id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h3>세대</h3>
            <div className="chips">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => (
                <button
                  key={g}
                  className={fGen === g ? 'on' : ''}
                  onClick={() => setFGen(fGen === g ? null : g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h3>타입</h3>
            <div className="chips">
              {TYPE_FILTERS.map((t) => (
                <button
                  key={t.id}
                  data-type={t.id}
                  className={fType === t.id ? 'on' : ''}
                  onClick={() => setFType(fType === t.id ? null : t.id)}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </section>
          <section>
            <div className="chips">
              <button className={showUnseen ? 'on' : ''} onClick={() => setShowUnseen(!showUnseen)}>
                미수집 포함
              </button>
              {activeFilters > 0 && (
                <button
                  onClick={() => {
                    setFRarity(null);
                    setFGen(null);
                    setFType(null);
                  }}
                >
                  초기화
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {dexCards.length === 0 ? (
        <p className="muted sub">
          {state.dex.length === 0
            ? '최종 단계까지 키우면 도감에 등록되고 새 알이 나옵니다.'
            : '조건에 맞는 포켓몬이 없습니다.'}
        </p>
      ) : (
        <ul className="dex">
          {dexCards.map((d) => {
            const key = dexKey(d);
            /* One face, worn by a button or by a plain span — written once so
               the pressable and the unpressable card cannot drift apart. */
            const face = (
              <>
                <span className="art">
                  {/* alt="" now that the card is a button: its accessible name
                      comes from the text right below the picture, and an alt
                      repeating it makes every card announce itself twice. */}
                  {d.sprite ? <DexSprite name={d.sprite} alt="" /> : '?'}
                </span>
                <span className="nm">
                  {d.seen ? d.name : '???'}
                  {d.shiny && '✨'}
                </span>
                <span className="no">#{String(d.speciesId).padStart(3, '0')}</span>
              </>
            );
            return (
              <li key={key} className={d.seen ? (d.shiny ? 'shinydex' : '') : 'unseen'}>
                {d.seen || d.locked ? (
                  /* No aria-expanded and no aria-haspopup: this navigates to a
                     screen, it does not disclose a region or open a menu. No
                     aria-label either — the visible text IS the name.

                     A locked legendary is pressable too, and it is exactly the
                     exception the note below allows for: its screen is NOT
                     blank — it carries the condition — and it costs no download,
                     because the gate came down with the payload. */
                  <button
                    type="button"
                    className="card"
                    data-key={key}
                    aria-label={d.locked ? `${d.speciesId}번 전설, 획득 조건 보기` : undefined}
                    onClick={() => openDex(d)}
                  >
                    {face}
                  </button>
                ) : (
                  /* An unseen slot is not pressable, and that is the design
                     rather than an omission: `mine` is empty by definition, and
                     an entry screen for it would either be blank or would spend
                     the download the "미수집 포함" toggle promises not to. */
                  <span className="card">{face}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      </>
      )}
      </>
      )}

      {/*
        * The 도감 entry screen.
        *
        * Replaces the grid rather than covering it — see openDex for why there
        * is no dialog here. The header draws from the card that was pressed, so
        * it is on screen in the same frame; only the sections below it wait.
        */}
      {tab === 'dex' && dexOpen !== null && (
      <>
      <div className="dexbar">
        {/* autoFocus so Escape is reachable and a screen reader is told the
            screen changed. :focus-visible keeps it quiet for mouse users. */}
        <button className="linky" autoFocus onClick={closeDex}>
          ← 목록
        </button>
        <span className="no">#{String(dexOpen.speciesId).padStart(3, '0')}</span>
      </div>

      {/*
        * A locked legendary takes the whole screen over.
        *
        * Nothing below this branch would have anything to say — there is no
        * `mine`, no flavour text, no stats worth showing for something never
        * met — and every number it DOES have came down with the payload, so it
        * costs no fetch. The `← 목록` header above is shared.
        */}
      {dexOpen.locked ? (
      <>
      <div className="portrait">
        {/* `.miss` is the art-missing glyph DexSprite falls back to, and this
            is the same situation with a different cause — without it the `?`
            renders at body size in a 96px box and reads as a stray character. */}
        <span className="dexart"><span className="miss">?</span></span>
        <h1>???</h1>
        <p className="muted sub">
          {dexOpen.locked.myth ? '환상' : '전설'} · {dexOpen.locked.gen}세대
        </p>
      </div>

      <h2>획득 조건</h2>
      {dexOpen.locked.open ? (
        /* The gate is already open — the bar would read 100% and say nothing.
           What matters now is that it can turn up, so say that instead. */
        <p className="sub">
          <b className="got">조우 가능</b>
          <span className="muted"> · 야생에서 만날 수 있습니다</span>
        </p>
      ) : (
        <>
        <p className="sub">
          <b>{compact(Math.min(dexOpen.locked.have, dexOpen.locked.need))}</b>
          <span className="muted"> / {compact(dexOpen.locked.need)}</span>
        </p>
        <div className="bar" role="progressbar" aria-valuenow={Math.round(dexOpen.locked.ratio * 100)}>
          <i className="fill" style={{ width: `${dexOpen.locked.ratio * 100}%` }} />
        </div>
        </>
      )}
      <p className="muted sub note">{dexOpen.locked.how}</p>

      {dexOpen.locked.itemKo && (
        <>
        <h2>전용 도구</h2>
        <ul className="bars info">
          <li>
            <span className="lbl">{dexOpen.locked.itemKo}</span>
            <span className={dexOpen.locked.held ? 'num' : 'num pending'}>
              {dexOpen.locked.held ? '가지고 있음' : '없음'}
            </span>
          </li>
          <li>
            <span className="lbl">얻는 법</span>
            <span className="num">{LEGEND_SOURCE_KO[dexOpen.locked.source ?? ''] ?? '—'}</span>
          </li>
        </ul>
        <p className="muted sub note">
          {dexOpen.locked.ready
            ? '조건을 채웠습니다. 이제 이 도구를 얻을 수 있습니다.'
            : '위 조건을 먼저 채워야 이 도구를 얻을 수 있습니다.'}
        </p>
        </>
      )}

      <p className="muted sub note">
        조건을 채우면 야생에서 만날 수 있게 됩니다. 이기면 그 포켓몬의 알이 남고, 알을 품어
        키워야 도감에 들어갑니다.
      </p>
      </>
      ) : (
      <>
      <div className="portrait">
        <span className="dexart">
          {dexOpen.sprite ? <DexSprite name={dexOpen.sprite} alt="" box={88} /> : <span className="miss">?</span>}
        </span>
        <h1>
          {dexOpen.name}
          {dexOpen.shiny && <em className="shiny" title="색이 다른 개체">✨</em>}
        </h1>
        {/* Arrives with the fetch. No placeholder: a line of dots that turns
            into words is more movement than a line that simply appears. */}
        {dexDetail && (
          <p className="muted sub">
            {dexDetail.nameEn}
            {dexDetail.genus && ` · ${dexDetail.genus}`}
          </p>
        )}
        {dexOpen.types.length > 0 && (
          <ul className="types">
            {dexOpen.types.map((t) => (
              <li key={t.id} data-type={t.id}>
                {t.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      {dexErr !== null ? (
        <p className="muted sub">
          정보를 가져오지 못했습니다.{' '}
          <button
            className="linky"
            onClick={() => {
              setDexErr(null);
              // Re-seat the same card so the fetch effect runs again.
              setDexOpen({ ...dexOpen });
            }}
          >
            다시 시도
          </button>
        </p>
      ) : !dexDetail ? (
        <p className="muted sub">불러오는 중…</p>
      ) : (
      <>
      {/* The frame is the clerk's message box; the fixed height is not. See
          .dexflavor in App.css for why the shop's reason does not apply here.
          A species with no Korean entry gets no box at all — the same rule that
          gives a species with no forms no row. */}
      {dexDetail.flavor && <p className="dexflavor uiwin">{dexDetail.flavor}</p>}

      <h2>정보</h2>
      <ul className="bars info">
        <li>
          <span className="lbl">크기</span>
          <span className="num">
            {dexDetail.heightM}m · {dexDetail.weightKg}kg
          </span>
        </li>
        <li>
          <span className="lbl">등급</span>
          <span className="num">
            {RARITY_LABEL[dexDetail.rarity] ?? dexDetail.rarity} · {dexDetail.generation}세대
          </span>
        </li>
        {dexDetail.abilities.map((a) => (
          <li key={a.ko}>
            <span className="lbl">{a.hidden ? '숨겨진 특성' : '특성'}</span>
            <span className="num">{a.ko}</span>
          </li>
        ))}
        <li>
          <span className="lbl">배울 수 있는 기술머신</span>
          <span className="num">{dexDetail.tmCount}개</span>
        </li>
      </ul>
      {/* Said once, under the list, rather than as a description on each row:
          natures are decoration here for the same reason and the README says
          so in a sentence rather than in the UI. */}
      <p className="muted sub">특성은 이 앱의 배틀에 영향을 주지 않습니다.</p>

      {dexDetail.stages.length > 1 && (
        <>
          <h2>진화</h2>
          <p className="chain">
            {dexDetail.stages.map((col, i) => (
              <Fragment key={i}>
                {col.map((sp, j) => (
                  <Fragment key={sp.speciesId}>
                    {/* Separators sit OUTSIDE the classed span so a slash does
                        not inherit `.now`'s weight. */}
                    {j > 0 && <em> · </em>}
                    <span className={sp.here ? 'now' : sp.collected ? 'got' : ''}>{sp.name}</span>
                  </Fragment>
                ))}
                {i < dexDetail.stages.length - 1 && <em> → </em>}
              </Fragment>
            ))}
          </p>
          <p className="muted sub">
            이 계열 {dexDetail.stages.flat().length}종 중{' '}
            {dexDetail.stages.flat().filter((sp) => sp.collected).length}종 등록
          </p>
        </>
      )}

      {dexDetail.matchups.length > 0 && (
        <>
          <h2>방어 상성</h2>
          {/* Not trivia: server/hunt.ts multiplies every swing by exactly this,
              and Scene.tsx prints 효과가 굉장했다! from the same number. */}
          <ul className="bars matchups">
            {dexDetail.matchups.map((m) => (
              <li key={m.factor}>
                <span className="lbl">{FACTOR_LABEL[m.factor] ?? `${m.factor}배`}</span>
                <ul className="types wrap">
                  {m.types.map((t) => (
                    <li key={t.id} data-type={t.id}>
                      {t.name}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <p className="muted sub">1배인 타입은 적지 않았습니다. 나머지 전부입니다.</p>
        </>
      )}

      {dexDetail.stats.length > 0 && (
        <>
          <h2>종족값</h2>
          <ul className="bars">
            {dexDetail.stats.map((st) => (
              <li key={st.name}>
                <span className="lbl">{st.name}</span>
                {/* Out of 180, not 255. Almost nothing reaches 255, so dividing
                    by it leaves every bar under half full and stops the six
                    telling one species from another — which is the only thing
                    a bar is for. */}
                <span className="track">
                  <i style={{ width: `${Math.min(100, (st.value / 180) * 100)}%` }} />
                </span>
                <span className="num">{st.value}</span>
              </li>
            ))}
          </ul>
          <ul className="bars info">
            <li>
              <span className="lbl">합계</span>
              <span className="num">{dexDetail.statTotal}</span>
            </li>
          </ul>
          {/* The screen says out loud what the README refuses to fake: these are
              the originals' numbers and no fight here reads them. The one thing
              they ever did in this app is upstairs — server/forms.ts's mega
              multiplier was measured from exactly these totals. */}
          <p className="muted sub">
            원작 수치입니다. 이 앱의 배틀은 종족값을 읽지 않고 기술 위력과 타입 상성으로만
            계산합니다.
          </p>
        </>
      )}

      {dexDetail.forms.length > 0 && (
        <>
          <h2>특별한 모습</h2>
          <ul className="bars info">
            {dexDetail.forms.map((f) => (
              <li key={f.id}>
                <span className="lbl">{f.kind === 'fusion' ? '합체' : '배틀에서'}</span>
                <span className="num">
                  {f.ko}
                  {f.power !== 1 && ` · 위력 ×${f.power}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="muted sub">
            이 종에 존재하는 모습입니다. 메가·거다이맥스는 배틀에서만 나타나고 도감에는 남지
            않습니다.
          </p>
        </>
      )}

      {dexDetail.mine && (
        <>
          <h2>나와의 기록</h2>
          <ul className="bars info">
            <li>
              <span className="lbl">등록</span>
              <span className="num">
                {new Date(dexDetail.mine.firstSeenAt).toLocaleDateString('ko-KR')}
              </span>
            </li>
            {/* Only a row when there is one. "별명: 없음" on nine hundred entries
                is the row the 파트너 tab's forms comment already declined. */}
            {dexDetail.mine.nickname && (
              <li>
                <span className="lbl">별명</span>
                <span className="num">{dexDetail.mine.nickname}</span>
              </li>
            )}
            {dexDetail.mine.formKo && (
              <li>
                <span className="lbl">떠난 모습</span>
                <span className="num">{dexDetail.mine.formKo}</span>
              </li>
            )}
            {/* Costs no server field: the panel already holds the companion. */}
            {companion?.speciesId === dexOpen.speciesId && (
              <li>
                <span className="lbl">지금 파트너</span>
                <span className="num">{companion.nickname ?? companion.name}</span>
              </li>
            )}
          </ul>
        </>
      )}
      </>
      )}
      </>
      )}
      </>
      )}

      {tab === 'awards' && (
      <>
      <div className="dexbar">
        <h2>업적</h2>
        {/* Same place and same control the dex puts its filter toggle in. */}
        <button className="linky" onClick={() => setHideDone(!hideDone)}>
          {hideDone ? '전부 보기' : '달성 숨기기'}
        </button>
      </div>
      <p className="sub">
        <b>{awardsDone}</b>
        <span className="muted">개 / {state.awards.length}개 달성</span>
      </p>
      {/* Same gauge as the dex counter, floored the same way: one out of fifty
          rounds to 2%, but a board with nothing on it should read as empty
          rather than as a sliver. */}
      <div className="bar" role="progressbar" aria-valuenow={awardPct}>
        <i className="fill" style={{ width: `${awardPct}%` }} />
      </div>

      <div className="chips awardcats" role="group" aria-label="업적 분야">
        <button className={awardCat === null ? 'on' : ''} onClick={() => setAwardCat(null)}>
          전체
        </button>
        {awardCats.map((c) => (
          <button
            key={c.cat}
            className={awardCat === c.cat ? 'on' : ''}
            onClick={() => setAwardCat(c.cat)}
          >
            {c.catKo}
          </button>
        ))}
      </div>

      {/* The trainer rows are the one place the board cannot look backwards,
          and saying so is better than letting someone with a thousand hunts
          wonder why their wins read zero. */}
      {(awardCat === null || awardCat === 'trainer') &&
        (state.awards.find((a) => a.cat === 'trainer')?.have ?? 0) === 0 && (
        <p className="muted sub">트레이너 승수는 이 업데이트부터 셉니다. 이전 승부는 기록이 남아 있지 않습니다.</p>
      )}

      {/* Grouped exactly the way the shop shelves are: filter the CATEGORY
          list, not the rows, drop a group that came out empty, and hide the
          heading once a single category has been chosen — at that point the
          chip above already says which one it is. */}
      {awardCats
        .filter((c) => awardCat === null || awardCat === c.cat)
        .map((c) => {
          const rows = shownAwards.filter((a) => a.cat === c.cat);
          if (!rows.length) return null;
          const done = state.awards.filter((a) => a.cat === c.cat && a.at !== null).length;
          const total = state.awards.filter((a) => a.cat === c.cat).length;
          return (
            <div key={c.cat}>
              {/* The count rides on the heading rather than on the chip: a chip
                  carrying "3 / 7" turns ten chips into three rows of them. */}
              {awardCat === null && (
                <h3 className="shelf awardshelf">
                  {c.catKo} <span className="muted">{done} / {total}</span>
                </h3>
              )}
              {/* Deliberately not `.items li.row`: that class means "pressable"
                  and reserves the ▶ gutter to say so. This is something to read. */}
              <ul className="items awards">
                {rows.map((a) => {
                  const got = a.at !== null;
                  const times = a.repeat ? a.times : 0;
                  /* A repeating row is never done and never locked either — it
                     is always partway to its next tier — so it keeps its gauge
                     and never wears `.empty`, whatever the count says. */
                  const lit = got || a.repeat !== null;
                  return (
                    <li key={a.id} className={lit ? '' : 'empty'}>
                      <span className="icon">
                        {a.repeat ? (
                          '🔁'
                        ) : got && a.itemSprite ? (
                          <img src={spriteUrl(a.itemSprite)} alt="" />
                        ) : (
                          (got ? '🏅' : '🔒')
                        )}
                      </span>
                      <span className="lbl">
                        <span className="awardtop">
                          <span>{a.ko}</span>
                          {/* What it paid, once it has. What is left, until then. */}
                          {times > 0 ? (
                            <em className="got">
                              {times}회 · +{compact(a.money * times)}
                            </em>
                          ) : got ? (
                            <em className="got">
                              +{compact(a.money)}
                              {a.itemKo ? ` · ${a.itemKo}` : ''}
                            </em>
                          ) : (
                            <em className="num">
                              {compact(Math.min(a.have, a.need))} / {compact(a.need)}
                            </em>
                          )}
                        </span>
                        <em>
                          {a.desc}
                          {a.repeat ? ` 다음 ${compact(a.need)}` : ''}
                          {!got && !a.repeat && a.itemKo ? ` 보상: ${a.itemKo}` : ''}
                        </em>
                        {/* The gauge stays on a repeating row for ever; it is
                            measuring the tier, not the whole thing. */}
                        {(!got || a.repeat) && (
                          <span className="track" aria-hidden="true">
                            <i style={{ width: `${a.ratio * 100}%` }} />
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </>
      )}

      {tab === 'shop' && (
      <>
      <h2>프렌들리숍</h2>

      {/* The counter. The frame vars have to be set on a host element — the
          panel is outside .scene, which is the only other place they live. */}
      <div className="mart">
        <p className="mart-money uiplate">
          소지금 <b>{compact(state.shop.wallet)}</b>
        </p>
        {state.shop.clerk && (
          <img
            className="mart-clerk"
            src={spriteUrl(state.shop.clerk)}
            alt=""
            width={CLERK_PX}
            height={CLERK_PX}
          />
        )}
      </div>
      <div className="saywin uiwin" aria-live="polite">
        {asked ? (
          <>
            <span className="saywin-line">
              <span>{asked.name}</span>
              <b>{compact(asked.price)}</b>
            </span>
            {/* The line that makes this more than decoration: an egg trades the
                companion away, and one press used to do it silently. */}
            {asked.kind === 'egg' && state.companion
              ? `지금 ${petName}${josa(petName, '은', '는')} 도감으로 떠납니다. 괜찮으시겠습니까?`
              : '괜찮으시겠습니까?'}
            <span className="saywin-ask">
              <button disabled={busy} onClick={() => void buyAsked(asked.id)}>
                예
              </button>
              <button disabled={busy} onClick={() => setTill({ at: 'idle' })}>
                아니오
              </button>
            </span>
          </>
        ) : till.at === 'said' ? (
          till.line
        ) : picked ? (
          /* Pointing at something. The clerk names it, prices it, describes it —
             which is what the games put on the screen that does not scroll. */
          <>
            <span className="saywin-line">
              <span>{picked.name}</span>
              <b>{picked.owned ? '보유중' : compact(picked.price)}</b>
            </span>
            <span className="saywin-desc">{picked.desc}</span>
          </>
        ) : (
          <>
            어서 오세요! 프렌들리숍입니다.
            <br />
            무엇을 도와드릴까요?
          </>
        )}
      </div>
      {/* Ten products do not fit a 420px panel as one list. The chips are the
          dex filter's idiom reused, but they never collapse — with this few
          rows, hiding them behind a second click would be worse than scrolling. */}
      <div className="chips shopchips" role="group" aria-label="상점 분류">
        <button className={shopGroup === null ? 'on' : ''} onClick={() => setShopGroup(null)}>
          전체
        </button>
        {SHOP_GROUPS.map((g) => (
          <button
            key={g.id}
            className={shopGroup === g.id ? 'on' : ''}
            onClick={() => setShopGroup(g.id)}
          >
            {g.label}
          </button>
        ))}
      </div>
      {SHOP_GROUPS.filter((g) => shopGroup === null || shopGroup === g.id).map((g) => {
        // `award` rows ride along on the payload for the bag's sake; the shelf
        // is the one place they must not appear.
        const rows = state.shop.products.filter((p) => p.group === g.id && !p.award);
        if (!rows.length) return null;
        return (
          <div key={g.id}>
            {/* The heading is redundant once a single group is chosen. */}
            {shopGroup === null && <h3 className="shelf">{g.label}</h3>}
            <ul className="items">
              {rows.map((p) => {
                const afford = state.shop.wallet >= p.price;
                const on = till.at === 'ask' && till.id === p.id;
                return (
                  /* data-rarity colours the left edge, the same idiom the bag uses
                     for TM types — four eggs in a row are otherwise one grey list. */
                  <li
                    key={p.id}
                    className={`row${afford && !p.owned ? '' : ' poor'}${on ? ' on' : ''}`}
                    data-rarity={p.rarity ?? undefined}
                  >
                    {p.sprite ? (
                      <img className="icon" src={spriteUrl(p.sprite)} alt="" />
                    ) : (
                      /* The four eggs now carry the real egg sprite; only the
                         Dynamax Band still has no icon upstream. */
                      <span className="icon">💠</span>
                    )}
                    {/* The whole row is the button, because a row is what the
                        games let you pick. The accessible name still leads with
                        the product and ends with the price. */}
                    <button
                      className="lbl rowbtn"
                      disabled={busy}
                      aria-pressed={on}
                      onMouseEnter={() => point(p.id)}
                      onMouseLeave={() => point(null)}
                      onFocus={() => point(p.id)}
                      onBlur={() => point(null)}
                      onClick={() =>
                        // An owned one-time item has nothing to ask about. The
                        // clerk says so rather than the row going dead quiet.
                        p.owned
                          ? setTill({ at: 'said', line: `${p.name}${josa(p.name, '은', '는')} 이미 가지고 계십니다.` })
                          : setTill(on ? { at: 'idle' } : { at: 'ask', id: p.id })
                      }
                    >
                      <span>{p.name}</span>
                      {p.owned ? <span className="badge">보유중</span> : <em>{compact(p.price)}</em>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      </>
      )}

      {tab === 'settings' && (
      <>
      {/*
        * The hunt settings, which used to sit at the bottom of the bag.
        *
        * They were always settings — the comment above them said so — and a
        * control belongs where its subject is, which is the rule the battle-form
        * toggle on 파트너 and the move slots both follow. The hunt's subject is
        * not the bag.
        *
        * DELIBERATELY OUTSIDE the isElectron() branch below. These two go
        * through /api/shop to state.json and work on the web build; PetSettings
        * writes prefs.json over the Electron bridge and renders nothing without
        * it. Folding them in would make them vanish in the browser — see the
        * note on setShowBattleForm in server/game.ts for why huntEnabled lives
        * in GameState rather than in Prefs to begin with.
        */}
      <h2>자동사냥</h2>
      <ul className="items">
        <li>
          <span className="lbl">
            자동사냥
            <em>5분마다 포켓몬과 싸워 게이지를 조금씩 올립니다.</em>
          </span>
          <button disabled={busy} onClick={() => act('hunt', state.hunt.enabled ? 'off' : 'on')}>
            {state.hunt.enabled ? '켜짐' : '꺼짐'}
          </button>
        </li>
        <li>
          <span className="lbl">
            사냥 상한
            <em>
              사냥이 평생 기여할 수 있는 총량을 번 토큰의 25%로 묶습니다. 켜두기만 한 기계가
              혼자 도감을 채우지 않게 하는 장치이고, 누적이라 한 번 차면 코딩으로 번 토큰이
              늘기 전까지 풀리지 않습니다.
            </em>
          </span>
          {/* The label names the CAP's state and the id names what to do to it:
              `적용 중` sends 'off', which lifts it. Reads backwards, is right. */}
          <button disabled={busy} onClick={() => act('huntcap', state.hunt.uncapped ? 'on' : 'off')}>
            {state.hunt.uncapped ? '해제됨' : '적용 중'}
          </button>
        </li>
      </ul>

      {isElectron() ? (
        <PetSettings />
      ) : (
        <p className="muted sub">데스크탑 앱에서 열면 펫 설정이 여기 표시됩니다.</p>
      )}

      <h2>스프라이트 캐시</h2>
      <ul className="items">
        <li>
          <span className="lbl">
            {(state.sprites.bytes / 1024 / 1024).toFixed(1)}MB · {state.sprites.files}개
            <em>
              배틀 화면에 나온 포켓몬이 쌓입니다. 지워도 필요할 때 다시 받습니다.
            </em>
          </span>
          <button disabled={busy} onClick={() => act('sprites', 'clear')}>
            정리
          </button>
        </li>
      </ul>

      <h2>정보</h2>
      <ul className="bars info">
        <li><span className="lbl">부화 임계값</span><span className="num">{compact(state.hatchThreshold)}</span></li>
        <li><span className="lbl">집계 방식</span><span className="num">{tokens.mode === 'activity' ? '활동량' : '과금 근사'}</span></li>
        <li><span className="lbl">고유 메시지</span><span className="num">{tokens.messageCount.toLocaleString()}</span></li>
        <li><span className="lbl">마지막 갱신</span><span className="num">{new Date(state.generatedAt).toLocaleTimeString('ko-KR')}</span></li>
      </ul>

      {/*
        * The one thing on screen that is not about the game.
        *
        * The 라이선스 절 in README says there is no credits screen, and that
        * stays true — every committed asset is CC0 or OFL and owes no
        * attribution. This is a different obligation: the app is a fan work
        * being handed to strangers, and a non-affiliation notice is the thing
        * a fan work owes whether or not any asset asks for a credit line.
        *
        * Deliberately plain text and not a link. There is not one anchor
        * anywhere else in this app, and an <a> inside Electron opens in the
        * BrowserWindow itself unless someone remembers to intercept it — a
        * trapdoor out of a 320px panel with no back button. The filename is
        * enough for anyone who wants the full text.
        */}
      <p className="muted sub">
        비공식 팬 프로젝트입니다. 닌텐도 · 크리처스 · 게임프리크 · 주식회사 포켓몬,
        그리고 Anthropic 과 아무 제휴 관계가 없습니다. 포켓몬은 그들의 상표이자
        저작물이며, 이 앱은 포켓몬 이미지를 포함하지 않고 실행 중에 이 기기로
        내려받아 캐시할 뿐입니다.
        <span className="note">
          코드는 MIT. 전체 고지와 에셋 출처는 저장소의 NOTICE.md에 있습니다.
        </span>
      </p>
      </>
      )}

      </div>
    </div>
  );
}
