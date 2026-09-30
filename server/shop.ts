import {
  MAX_LEVEL,
  displayIdOf,
  evolveBy,
  fusionsAvailable,
  growthBudget,
  levelOf,
  lifetimeOf,
  type GameState,
  type Rarity,
} from './game.ts';
import { formsFrom } from './forms.ts';
import { EVO_ITEM_KO, speciesName } from './species.ts';
import { evolvesWithKo, itemsFor } from './evolution.ts';
import { josa } from '../src/josa.ts';
import { retireInto } from './dex.ts';

export type ItemId =
  | 'rare-candy'
  | 'shiny-charm'
  | 'everstone'
  | 'key-stone'
  | 'dynamax-band'
  | 'dna-splicers';
export type EggId = 'egg-common' | 'egg-uncommon' | 'egg-rare' | 'egg-legendary';
/**
 * An evolution item, by PokeAPI slug: '천둥의돌' is 'thunder-stone'. The set is
 * whatever server/species.ts's EVO_ITEM_KO lists — generated, so it is a string
 * here and `isEvoItem` is the check.
 */
export type EvoItemId = string;
export type ProductId = ItemId | EggId | EvoItemId;

/** Whether an id names an evolution item. */
export function isEvoItem(id: string): boolean {
  return Object.hasOwn(EVO_ITEM_KO, id);
}

/**
 * Which shelf a product sits on.
 *
 * The shop was a flat list of seven, which fits. Ten does not — the panel is
 * 420px wide and the last row falls off the bottom. Grouping is cheaper than
 * scrolling, and the order below is the order the shelves are drawn in.
 */
/**
 * Items that work by being owned, not by being pressed.
 *
 * The Key Stone is a bracelet and the Dynamax Band is a band — a trainer wears
 * them and that is the end of it. They were built as worn toggles copied from
 * the everstone, which was a mistake: an everstone is genuinely switched, these
 * two never were.
 *
 * Two consequences ride on this set: the bag draws no button for them, and the
 * shop refuses to sell a second one.
 */
export const PASSIVE = new Set<ItemId>(['key-stone', 'dynamax-band']);

/**
 * Items the shop sells at most one of.
 *
 * A superset of PASSIVE, because "nothing to press in the bag" and "a second
 * one would do nothing" are two different claims and the Everstone splits them:
 * it is a TOGGLE, so the bag must keep its button, but `consumeItem` decrements
 * nothing when you switch it on or off (see the everstone branch below). One is
 * therefore permanent and a second is dead weight — a save here had bought
 * fifteen. At 1.5 thresholds that was a quiet waste; at 8 it is a day of coding
 * thrown away, which is what makes it this change's problem to fix.
 */
export const UNIQUE = new Set<ItemId>([...PASSIVE, 'everstone']);

/** Whether the bag already holds this product. Only meaningful for UNIQUE ones. */
export function owns(state: GameState, id: ProductId): boolean {
  return (state.inventory[id as ItemId] ?? 0) > 0;
}

export const GROUPS = ['egg', 'growth', 'evolution'] as const;
export type Group = (typeof GROUPS)[number];

export const GROUP_KO: Record<Group, string> = {
  egg: '알',
  growth: '성장',
  evolution: '진화',
};

type Listing = {
  name: string;
  desc: string;
  /** Price as a multiple of whatever `basis` names. */
  priceMult: number;
  /**
   * What the price is a multiple of. Absent means the hatch threshold, which is
   * what makes the shop cost the same to a heavy user and a light one.
   *
   * 'candy' means what one Rare Candy gives right now instead — the same
   * number the item's own effect is measured in. Only the Rare Candy uses it,
   * and it has to: a level of a legendary's growth is five times a level of a
   * common one's, so a flat price would be a loss on one and a windfall on the
   * other.
   */
  basis?: 'candy';
  group: Group;
  /**
   * Earned, not bought.
   *
   * The row STAYS in PRODUCTS — the bag resolves every item's name, description
   * and icon out of this table (see `product()` and `itemIcon()` in App.tsx), so
   * deleting the row would leave a nameless square in the bag of anyone who
   * already owns one. It is the shelf and `buy` that turn it away.
   *
   * `priceMult` is not a price for these three — it is what the item would be
   * worth if it were sold. Nothing reads it (`buy` refuses before `priceOf` and
   * the shelf filters the row out), but it is kept in step with its neighbours
   * anyway: a "what it would cost" that is eight times off the scale everything
   * around it uses stops meaning anything at all.
   */
  award?: true;
};

/**
 * A shop row.
 *
 * Discriminated on `kind` so an egg cannot be written without the tier it
 * guarantees, and so the item branch of `buy` needs no cast to narrow the id.
 */
export type Product =
  | (Listing & {
      kind: 'item';
      id: ItemId;
      /**
       * Item sprite slug, or null where no icon set this app reaches has one.
       *
       * Nothing is null any more. The Dynamax Band was, for as long as only
       * PokeAPI's flat `items/` folder was searched — it is a Generation 8 key
       * item that upstream never filed there. `ensureItemSprite` now also asks
       * pokesprite, which has it. The type stays nullable because the next
       * generation's key item will be in exactly the same position.
       */
      sprite: string | null;
      rarity: null;
    })
  | (Listing & {
      /**
       * An evolution item. All forty-one are on the shelf; the ones this
       * companion's next evolution can use are listed first. See `usableNow`.
       */
      kind: 'evo';
      id: EvoItemId;
      sprite: string;
      rarity: null;
    })
  | (Listing & {
      kind: 'egg';
      id: EggId;
      /** Eggs share one drawn icon rather than a fetched sprite. */
      sprite: null;
      /**
       * The tier this egg guarantees, as a FLOOR — see rollSpecies. 'common' is
       * therefore no guarantee at all, which is what makes it the cheap one.
       */
      rarity: Rarity;
    });

/** 모으령 becomes 타부자고 with 999 coins; the shop sells the lot as one purchase. */
const GIMMIGHOUL_COIN = 'gimmighoul-coin';
const PER_BUY: Record<string, number> = { [GIMMIGHOUL_COIN]: 999 };

/** A line of what each kind of evolution item is, for the shelf. */
const EVO_ITEM_DESC: Record<string, string> = {
  'linking-cord': '통신교환으로 진화하는 포켓몬이 교환 없이 진화합니다.',
  [GIMMIGHOUL_COIN]: '999개 묶음. 모으령이 모으는 코인입니다.',
};

export const PRODUCTS: Product[] = [
  {
    id: 'rare-candy',
    group: 'growth',
    name: '이상한사탕',
    desc: '레벨이 1 오릅니다. 알일 때는 부화까지를 25% 채웁니다.',
    priceMult: 1.2,
    basis: 'candy',
    sprite: 'rare-candy',
    rarity: null,
    kind: 'item',
  },
  {
    id: 'shiny-charm',
    group: 'growth',
    award: true,
    name: '반짝반짝부적',
    desc: '다음 부화 한 번만 샤이니 확률이 8배 (1/512 → 1/64).',
    priceMult: 30,
    sprite: 'shiny-charm',
    rarity: null,
    kind: 'item',
  },
  {
    id: 'everstone',
    group: 'evolution',
    name: '변함없는돌',
    desc: '진화를 멈춰 지금 모습을 유지합니다. 가방에서 다시 끄면 재개.',
    priceMult: 8,
    sprite: 'everstone',
    rarity: null,
    kind: 'item',
  },
  {
    id: 'key-stone',
    group: 'evolution',
    award: true,
    name: '키스톤',
    desc: '가지고만 있으면 됩니다. 그 종의 메가스톤도 있어야 하고, 메가스톤은 사냥으로만 나옵니다.',
    priceMult: 20,
    sprite: 'key-stone',
    rarity: null,
    kind: 'item',
  },
  {
    id: 'dynamax-band',
    group: 'evolution',
    award: true,
    name: '다이맥스밴드',
    desc: '가지고만 있으면 됩니다. 거다이맥스할 수 있는 종이 배틀 3턴 동안 받는 피해가 절반이 됩니다.',
    priceMult: 24,
    sprite: 'dynamax-band',
    rarity: null,
    kind: 'item',
  },
  {
    id: 'dna-splicers',
    group: 'evolution',
    name: 'DNA쐐기',
    desc: '도감에 있는 상대와 합체합니다. 큐레무·네크로즈마·버드렉스. 분리는 무료입니다.',
    priceMult: 35,
    sprite: 'dna-splicers',
    rarity: null,
    kind: 'item',
  },
  {
    id: 'egg-common',
    group: 'egg',
    name: '흔한 알',
    desc: '가장 싼 알. 등급 보장은 없고 그저 새로 시작합니다. 지금 포켓몬은 도감에 넣고 떠나보냅니다.',
    priceMult: 5,
    sprite: null,
    rarity: 'common',
    kind: 'egg',
  },
  {
    id: 'egg-uncommon',
    group: 'egg',
    name: '조금 귀한 알',
    desc: '"조금 귀함" 이상이 보장된 알 — 흔한 포켓몬은 나오지 않습니다. 지금 포켓몬은 도감에 넣고 떠나보냅니다.',
    priceMult: 12,
    sprite: null,
    rarity: 'uncommon',
    kind: 'egg',
  },
  {
    id: 'egg-rare',
    group: 'egg',
    name: '귀한 알',
    desc: '"귀함" 이상이 보장된 알. 지금 포켓몬은 도감에 넣고 떠나보냅니다.',
    priceMult: 25,
    sprite: null,
    rarity: 'rare',
    kind: 'egg',
  },
  {
    id: 'egg-legendary',
    group: 'egg',
    name: '전설의 알',
    desc: '"전설"이 보장된 알. 지금 포켓몬은 도감에 넣고 떠나보냅니다.',
    priceMult: 80,
    sprite: null,
    rarity: 'legendary',
    kind: 'egg',
  },
  ...Object.entries(EVO_ITEM_KO).map(
    ([id, name]): Product => ({
      id,
      group: 'evolution',
      name,
      // Every one is on the shelf now, so the line says who it is for — the
      // generic "an evolution item" left 41 rows nobody could tell apart.
      desc: EVO_ITEM_DESC[id] ?? evolvesWithKo(id) ?? '진화에 쓰는 도구입니다. 가방에서 쓰면 조건이 맞을 때 진화합니다.',
      // 모으령의코인 is sold as the whole 999 at once, so it costs like ten.
      priceMult: id === GIMMIGHOUL_COIN ? 30 : 3,
      sprite: id,
      rarity: null,
      kind: 'evo',
    }),
  ),
];

/**
 * Whether a product is on the shelf.
 *
 * Everything but the achievement rewards. The evolution items used to be
 * shelved only while the companion's next evolution could use them, which hid
 * thirty-odd of the forty-one on any given day and made it impossible to buy
 * a stone ahead for the NEXT partner. They are all shelved now; `usableNow`
 * is what puts this companion's own at the top.
 */
export function shelved(p: Product, _state: GameState): boolean {
  return !p.award;
}

/** An evolution item the companion's next evolution asks for. The shop lists these first. */
export function usableNow(p: Product, state: GameState): boolean {
  if (p.kind !== 'evo') return false;
  const a = state.active;
  return !!a && itemsFor(a.pathIds, a.stageIndex).includes(p.id);
}

export function priceOf(p: Product, state: GameState): number {
  const unit = p.basis === 'candy' ? candyGrant(state) : state.hatchThreshold;
  return Math.round(p.priceMult * unit);
}

/**
 * Spendable balance.
 *
 * Deliberately separate from growth: buying things must never un-evolve your
 * companion, so `spentTokens` reduces the wallet only, never the progression.
 */
export function wallet(state: GameState, earnedTokens: number): number {
  // `awardTokens` is the achievements' contribution. It is here and nowhere
  // else — deliberately not in `lifetimeOf`, so an award is money and never
  // progress. See the field comment in game.ts.
  return Math.max(0, earnedTokens + (state.awardTokens ?? 0) - state.spentTokens);
}

/**
 * Tokens one Rare Candy gives right now: a level's worth — a ninety-ninth of the
 * whole way from hatch to 100 — or, to an egg, a quarter of the hatch.
 */
export function candyGrant(state: GameState): number {
  const a = state.active;
  if (!a) return Math.round(state.hatchThreshold * 0.25);
  // Rounded up, so a candy is never a token short of the level it promises.
  return Math.ceil(growthBudget(a.pathIds, a.rarity, state.hatchThreshold) / (MAX_LEVEL - 1));
}

export type ShopResult = { state: GameState; ok: boolean; message: string };

/**
 * `earnedTokens` is the WALLET balance (state.lifetimeEarned), not the
 * progression total — item-granted and hunted progress deliberately cannot be
 * spent. Progression is read from `lifetimeOf(state)` where it is needed.
 */
export function buy(
  state: GameState,
  productId: ProductId,
  earnedTokens: number,
): ShopResult {
  const product = PRODUCTS.find((p) => p.id === productId);
  if (!product) return { state, ok: false, message: '없는 상품입니다.' };

  // Checked before anything else, including the wallet: these are not for sale
  // at any price, and "not enough tokens" would be a lie that implies they are.
  if (product.award) {
    return { state, ok: false, message: `${product.name}${josa(product.name, '은', '는')} 파는 물건이 아닙니다. 업적으로 얻으세요.` };
  }

  // A unique item does nothing twice, so selling a second one is only a way to
  // take tokens for nothing. Checked before the wallet: "already have one" is
  // the more useful answer than "not enough tokens".
  if (product.kind === 'item' && UNIQUE.has(product.id) && owns(state, product.id)) {
    return { state, ok: false, message: `${product.name}${josa(product.name, '은', '는')} 이미 가지고 계십니다.` };
  }

  const price = priceOf(product, state);
  if (wallet(state, earnedTokens) < price) {
    return { state, ok: false, message: '토큰이 부족합니다.' };
  }

  const s: GameState = {
    ...state,
    spentTokens: state.spentTokens + price,
    inventory: { ...state.inventory },
    dex: [...state.dex],
  };

  if (product.kind === 'item' || product.kind === 'evo') {
    s.inventory[product.id] = (s.inventory[product.id] ?? 0) + (PER_BUY[product.id] ?? 1);
    return { state: s, ok: true, message: `${product.name}${josa(product.name, '을', '를')} 샀습니다.` };
  }

  // Egg: the current companion graduates to the dex and a guaranteed-rarity
  // egg replaces it. Progress toward the new egg starts from here.
  const rarity: Rarity = product.rarity;
  const active = s.active;
  if (active) {
    // Same helper as graduation. Two copies of this is how the two paths drift.
    s.dex = retireInto(s.dex, active, Date.now());
    s.retiredCount += 1;
  }
  s.active = null;
  s.forcedRarity = rarity;
  // The new egg starts from wherever progression stands right now. This MUST
  // go through lifetimeOf: an egg anchored to a smaller sum hatches instantly,
  // which would make the 80x-priced legendary egg a free hatch button.
  s.eggStartedAt = lifetimeOf(state);
  return {
    state: s,
    ok: true,
    message: active
      ? `${product.name}${josa(product.name, '과', '와')} 맞바꿨습니다.`
      : `${product.name}${josa(product.name, '을', '를')} 샀습니다.`,
  };
}

/**
 * Fuse the companion with something out of the dex, or split it again.
 *
 * The dex is the box: there is one companion at a time, so "you must own both"
 * becomes "you must have RAISED the other one", which is the only sense of
 * ownership this app has. The partner is NOT removed from the dex — that list
 * is a record of what was raised, and editing history to pay for an item would
 * break the one promise it makes.
 *
 * Splitting is free, exactly as taking an everstone off is.
 */
function splice(state: GameState, have: number, pick: number | null): ShopResult {
  const active = state.active;
  if (!active) return { state, ok: false, message: '아직 포켓몬이 없습니다.' };

  if (active.formId !== undefined) {
    const { formId: _drop, ...rest } = active;
    void _drop;
    return { state: { ...state, active: rest }, ok: true, message: '분리했습니다.' };
  }

  if (have < 1) return { state, ok: false, message: 'DNA쐐기가 없습니다.' };

  const options = fusionsAvailable(state);
  if (!options.length) {
    // Say what is missing rather than "cannot": every one of these is a species
    // the user could go and raise, and the message is the only place that says so.
    const wanted = formsFrom(displayIdOf(active)).filter((f) => f.kind === 'fusion');
    if (!wanted.length) return { state, ok: false, message: '이 포켓몬은 합체할 수 없습니다.' };
    const names = wanted.map((f) => speciesName(f.partner!)).join(' 또는 ');
    return { state, ok: false, message: `도감에 ${names}${josa(names, '이', '가')} 없습니다.` };
  }

  const chosen = pick !== null ? options.find((f) => f.id === pick) : options[0];
  if (!chosen) return { state, ok: false, message: '고른 합체를 할 수 없습니다.' };

  const s: GameState = { ...state, inventory: { ...state.inventory } };
  s.inventory['dna-splicers'] = have - 1;
  s.active = { ...active, formId: chosen.id };
  return { state: s, ok: true, message: `${chosen.ko}${josa(chosen.ko, '이', '가')} 되었습니다.` };
}

/**
 * `pick` is which of several outcomes the caller chose, and only the DNA
 * Splicers read it — as the form id to fuse into. Kyurem can become either
 * Black or White, so the bag has to say which, and the action already carries a
 * spare number for exactly this kind of choice (the TM slot picker uses it).
 */
export function consumeItem(
  state: GameState,
  itemId: ItemId | EvoItemId,
  earnedTokens: number,
  pick: number | null = null,
  now: Date = new Date(),
): ShopResult {
  const have = state.inventory[itemId] ?? 0;

  if (isEvoItem(itemId)) return evolveWith(state, itemId, have, now);

  // Everstone is a toggle, not a consumable — turning it off costs nothing.
  if (itemId === 'everstone') {
    if (state.everstone) {
      return { state: { ...state, everstone: false }, ok: true, message: '진화를 다시 시작합니다.' };
    }
    if (have < 1) return { state, ok: false, message: '변함없는돌이 없습니다.' };
    return { state: { ...state, everstone: true }, ok: true, message: '진화를 멈췄습니다.' };
  }

  // The Key Stone and the Dynamax Band do their work by being owned, so there
  // is nothing to press. Saying so beats doing nothing quietly — a button that
  // silently changes no state is the shape this used to have.
  if (PASSIVE.has(itemId as ItemId)) {
    const name = PRODUCTS.find((p) => p.id === itemId)?.name ?? itemId;
    return { state, ok: false, message: `${name}${josa(name, '은', '는')} 가지고 있는 것만으로 효과가 있습니다.` };
  }

  if (itemId === 'dna-splicers') return splice(state, have, pick);

  if (have < 1) return { state, ok: false, message: '아이템이 없습니다.' };
  const s: GameState = { ...state, inventory: { ...state.inventory } };
  s.inventory[itemId] = have - 1;

  if (itemId === 'shiny-charm') {
    s.shinyCharmActive = true;
    return { state: s, ok: true, message: '다음 부화에 샤이니 확률이 올라갑니다.' };
  }

  // rare-candy: credit bonus progress. bonusTokens feeds progression only, so
  // the wallet is untouched. A level's worth, measured on THIS companion — a
  // level of a legendary is five times a level of a common one.
  s.bonusTokens = state.bonusTokens + candyGrant(state);
  void earnedTokens;
  return { state: s, ok: true, message: state.active ? '레벨이 올랐습니다.' : '부화가 가까워졌습니다.' };
}

/**
 * Use an evolution item on the companion.
 *
 * The item goes only if something happens, as in the games: a Thunder Stone
 * handed to a Charmander stays in the bag. A rule with a time on it (예리한이빨
 * at night) is checked against `now`.
 */
function evolveWith(state: GameState, item: EvoItemId, have: number, now: Date): ShopResult {
  const name = EVO_ITEM_KO[item] ?? item;
  if (have < 1) return { state, ok: false, message: `${name}${josa(name, '이', '가')} 없습니다.` };
  const a = state.active;
  if (!a) return { state, ok: false, message: '아직 포켓몬이 없습니다.' };
  if (state.everstone) return { state, ok: false, message: '변함없는돌 때문에 진화하지 않습니다.' };
  const at = lifetimeOf(state);
  const level = levelOf(a, at, state.hatchThreshold);
  const evolved = evolveBy(state, a, level, now, { kind: 'item', item, have }, at);
  if (!evolved) return { state, ok: false, message: `${name}${josa(name, '을', '를')} 써도 아무 일도 일어나지 않았다.` };
  const spent = PER_BUY[item] ?? 1;
  const to = speciesName(evolved.to);
  return {
    state: {
      ...state,
      active: evolved.active,
      inventory: { ...state.inventory, [item]: have - spent },
      itemEvolutions: (state.itemEvolutions ?? 0) + 1,
    },
    ok: true,
    message: `${speciesName(evolved.from)}${josa(speciesName(evolved.from), '은', '는')} ${to}${josa(to, '으로', '로')} 진화했다!`,
  };
}
