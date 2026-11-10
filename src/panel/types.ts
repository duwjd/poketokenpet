import type { SceneBattle, SceneTrainerFight } from '../Scene.tsx';
import type { Stop } from '../journey.ts';

/**
 * The gauge. An egg counts toward hatching; a companion toward its next level —
 * `level` is where it stands, and `total` the whole way from hatch to 100.
 */
export type Progress = {
  phase: 'egg' | 'growing' | 'final';
  have: number;
  need: number;
  ratio: number;
  level: number;
  total: number;
};

export type Companion = {
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
  /** 1..100. Hatching is 1, graduating into the dex is 100. */
  level: number;
  friendship: number;
  /** What each next evolution needs, in words. Empty at the last stage. */
  evolves: { to: number; name: string; ways: string[] }[];
  /** 오케이징: its next evolution needs holding it upside down, and whether it is. */
  flip: { on: boolean } | null;
  /** Its ability — the games' own, working in battle — and whether it is the hidden one. */
  ability: { ko: string; hidden: boolean } | null;
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
export type DexCard = State['dex'][number] & {
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
export type MoveCard = {
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

/**
 * A move on a party member.
 *
 * `MoveCard` without the icon: the bag fetches a per-type TM sprite for every
 * machine it lists, and doing that again for twenty-four party slots would add
 * six copies of the same eighteen files to a payload that already carries them.
 * The party rows print text.
 */
export type PartyMove = Omit<MoveCard, 'sprite'>;

/** One region's ladder. Named because the payload hands it over twice. */
export type League = {
  region: string;
  cityKo: string;
  /** 사천왕 or 챔피언컵 — what this region calls its ladder. */
  kindKo: string;
  open: boolean;
  /** Members already down in the run under way, or null when none is. */
  at: number | null;
  size: number;
  best: number;
  wins: number;
  clearedAt: number | null;
  until: number;
  members: { id: string; ko: string; down: boolean; sprite: string | null }[];
};

export type HuntLogEntry = {
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
  /** A wild fight's outcome. Absent on older entries and on every named fight. */
  won?: boolean;
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

export type State = {
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
    /** The ability this species graduated with, or null for an entry from before abilities. */
    abilityKo?: string | null;
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
      kind: 'item' | 'egg' | 'evo';
      /** Null for items; the tier an egg guarantees. */
      rarity: 'common' | 'uncommon' | 'rare' | 'legendary' | null;
      price: number;
      sprite: string | null;
      /** Which shelf it sits on. Drives the category chips. */
      group: 'egg' | 'growth' | 'evolution';
      /** On the shelf: everything but the achievement rewards. */
      shelved: boolean;
      /** An evolution item this companion's next evolution asks for — listed first, badged. */
      usable: boolean;
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
    /**
     * Where the pet is.
     *
     * Resolved server-side rather than derived here from `count`: a legendary
     * room that has not been met yet is passed over, and that depends on the
     * save. See server/shrines.ts.
     */
    stop: Stop;
    /** How many legendary rooms this save has opened. */
    shrines: { open: number; total: number };
    /** Gen-5 backdrop for where the pet is walking. Null is the flat sky. */
    skylineBg: string | null;
    intervalMs: number;
    slots: number;
    nextInMs: number | null;
    speed: number;
    /** Whether a named battle is asked about rather than settled unattended. */
    asking: boolean;
    /** The named battle waiting for an answer. Derived server-side every build. */
    challenge: {
      kind: 'gym' | 'league';
      id: string;
      ko: string;
      /** Attempts left in this leg. */
      left: number;
      cityKo: string | null;
      size: number;
      sprite: string | null;
      badgeKo: string | null;
      badgeSprite: string | null;
      prizeKo: string | null;
    } | null;
    idleReason: 'off' | 'everstone' | 'egg' | null;
    log: HuntLogEntry[];
  };
  moves: MoveCard[];
  /** Level-up moves it has learned and is not using — free to put back. */
  relearnable: MoveCard[];
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
  /** The league party, and what each member could still be taught. */
  party: {
    size: number;
    ready: boolean;
    cityKo: string;
    members: {
      speciesId: number;
      name: string;
      shiny: boolean;
      sprite: string | null;
      moves: PartyMove[];
      /** Machine ids in the bag this one can learn. Join against `tms`. */
      canTake: number[];
      /** Already known by the species, so free — and named, since the bag may not hold it. */
      free: PartyMove[];
    }[];
  };
  /**
   * The badge case, every region's, region-tagged.
   *
   * `count`/`total` are the LIVE region's, not the sum — the party board's
   * "배지 N개를 모으면…" sentence needs a region or it is false. The sum is in
   * `regions`, where it reads as a sum.
   */
  badges: {
    count: number;
    total: number;
    /** The region the tab opens on. A `regions[].key`. */
    now: string;
    /** One row per region with a gym table. Drives the chip row. */
    regions: {
      key: string;
      ko: string;
      count: number;
      total: number;
      clearedAt: number | null;
      until: number;
      /** Where the ladder stands, or null for a region that has none at all. */
      leagueCity: string | null;
    }[];
    /** The live region's ladder. The same object as `leagues.find(now)`. */
    league: League;
    /** One per region with a ladder. A region without one has no entry. */
    leagues: League[];
    cases: {
      /** Which region's case this slot belongs to. */
      region: string;
      no: number;
      ko: string;
      leaderKo: string;
      cityKo: string;
      have: boolean;
      /** Shut until the rest of that region is done. 상록시티, and its like. */
      locked: boolean;
      /** Encounters until the pet stands in that city. 0 means it is there. */
      until: number;
      prizeKo: string | null;
      sprite: string | null;
    }[];
  };
  events: { kind: string; speciesId?: number; shiny?: boolean }[];
  sprites: { bytes: number; files: number };
  /** Impact art for the move types swung this encounter, by type. */
  fx?: Record<string, string | null>;
  generatedAt: string;
};

/**
 * What the clerk is doing.
 *
 * Three beats, which is what the games' counter is: a greeting, a question, and
 * an answer. `ask` holds only the product id — the row it names is looked up
 * from the live payload, so a price that moves between the question and the
 * answer cannot be quoted stale.
 */
export type Till =
  | { at: 'idle' }
  /** Pointing at a row. Reached by hover or focus, and costs nothing. */
  | { at: 'pick'; id: string }
  | { at: 'ask'; id: string }
  | { at: 'said'; line: string };

export type TabId = 'pet' | 'stats' | 'bag' | 'dex' | 'awards' | 'shop' | 'settings';
