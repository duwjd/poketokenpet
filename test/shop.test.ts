import { describe, expect, it } from 'vitest';
import {
  RARITY_ORDER,
  advance,
  hasDamaging,
  initialState,
  lifetimeOf,
  mulberry32,
  progress,
  rarityOf,
  starterMove,
  type GameState,
  type Rarity,
} from '../server/game.ts';
import {
  GROUPS, GROUP_KO, PASSIVE, PRODUCTS, UNIQUE, buy, consumeItem, currentRequirement, priceOf, wallet,
} from '../server/shop.ts';
import { migrate } from '../server/store.ts';

const H = 10_000_000;
const base = (over: Partial<GameState> = {}): GameState => ({
  ...initialState(),
  hatchThreshold: H,
  ...over,
});

/**
 * The price against a given state — the Rare Candy's basis is the current
 * milestone, so it is not a function of the threshold alone. Defaults to a
 * plain `base()`, i.e. no companion, where `currentRequirement` is the
 * threshold and every product prices off the same number.
 */
const price = (id: string, state: GameState = base()) =>
  priceOf(PRODUCTS.find((p) => p.id === id)!, state);

describe('wallet', () => {
  it('is earned minus spent, never negative', () => {
    expect(wallet(base({ spentTokens: 0 }), 100)).toBe(100);
    expect(wallet(base({ spentTokens: 40 }), 100)).toBe(60);
    expect(wallet(base({ spentTokens: 999 }), 100)).toBe(0);
  });
});

describe('buy', () => {
  it('refuses when the wallet is short and takes nothing', () => {
    const s = base();
    const r = buy(s, 'rare-candy', 0);
    expect(r.ok).toBe(false);
    expect(r.state.spentTokens).toBe(0);
    expect(r.state.inventory['rare-candy']).toBeUndefined();
  });

  it('adds the item and debits exactly the price', () => {
    const r = buy(base(), 'rare-candy', 100_000_000);
    expect(r.ok).toBe(true);
    expect(r.state.inventory['rare-candy']).toBe(1);
    expect(r.state.spentTokens).toBe(price('rare-candy'));
  });

  it('never touches progression — spending must not un-evolve anything', () => {
    const hatched = advance(base(), H, mulberry32(9)).state;
    const before = hatched.active!;
    const r = buy(hatched, 'rare-candy', 1_000_000_000);
    expect(r.state.active!.stageIndex).toBe(before.stageIndex);
    expect(r.state.active!.tokensAtStageStart).toBe(before.tokensAtStageStart);
    expect(r.state.bonusTokens).toBe(hatched.bonusTokens);
  });

  it('an egg retires the current companion into the dex and forces the tier', () => {
    const hatched = advance(base(), H, mulberry32(11)).state;
    expect(hatched.active).not.toBeNull();
    const r = buy(hatched, 'egg-legendary', 1_000_000_000);
    expect(r.ok).toBe(true);
    expect(r.state.active).toBeNull();
    expect(r.state.forcedRarity).toBe('legendary');
    expect(r.state.dex.length).toBe(hatched.dex.length + 1);
    expect(r.state.retiredCount).toBe(hatched.retiredCount + 1);
  });

  it('a forced-legendary egg really hatches a legendary', () => {
    const bought = buy(base(), 'egg-legendary', 1_000_000_000).state;
    for (const seed of [1, 2, 3, 4, 5]) {
      const after = advance(bought, bought.eggStartedAt + H, mulberry32(seed)).state;
      expect(after.active).not.toBeNull();
      expect(after.active!.rarity).toBe('legendary');
    }
  });

  it('a rare egg guarantees rare or better', () => {
    const bought = buy(base(), 'egg-rare', 1_000_000_000).state;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const after = advance(bought, bought.eggStartedAt + H, mulberry32(seed)).state;
      expect(['rare', 'legendary']).toContain(after.active!.rarity);
    }
  });

  it('sells exactly one egg per rarity, priced in ladder order', () => {
    const eggs = PRODUCTS.filter((p) => p.kind === 'egg');
    expect(eggs.map((e) => e.rarity)).toEqual([...RARITY_ORDER]);
    // Paying more must never buy a worse floor, or the shop is lying.
    const mults = eggs.map((e) => e.priceMult);
    expect([...mults].sort((a, b) => a - b)).toEqual(mults);
  });

  it('guarantees each egg its tier as a floor, never worse', () => {
    // The floor is the whole contract: `advance` may roll better than you paid
    // for, but never below it.
    for (const egg of PRODUCTS.filter((p) => p.kind === 'egg')) {
      const bought = buy(base(), egg.id, 1_000_000_000).state;
      expect(bought.forcedRarity, egg.id).toBe(egg.rarity);
      const floor = RARITY_ORDER.indexOf(egg.rarity as Rarity);
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const after = advance(bought, bought.eggStartedAt + H, mulberry32(seed)).state;
        const got = RARITY_ORDER.indexOf(after.active!.rarity);
        expect(got, `${egg.id} seed ${seed}`).toBeGreaterThanOrEqual(floor);
      }
    }
  });

  it('lets the cheapest egg roll anything — it buys a swap, not a tier', () => {
    // 'common' as a floor constrains nothing, which is exactly what the copy
    // promises. If this ever starts pinning the roll to common, the description
    // has become a lie.
    const bought = buy(base(), 'egg-common', 1_000_000_000).state;
    const rolled = new Set<Rarity>();
    for (let seed = 1; seed <= 60; seed++) {
      rolled.add(advance(bought, bought.eggStartedAt + H, mulberry32(seed)).state.active!.rarity);
    }
    expect(rolled.size).toBeGreaterThan(1);
  });

  it('still retires the companion even for the cheapest egg', () => {
    const hatched = advance(base(), H, mulberry32(11)).state;
    const r = buy(hatched, 'egg-common', 1_000_000_000);
    expect(r.ok).toBe(true);
    expect(r.state.active).toBeNull();
    expect(r.state.dex.length).toBe(hatched.dex.length + 1);
  });

  it('clears forcedRarity after the hatch so the next egg is normal', () => {
    const bought = buy(base(), 'egg-legendary', 1_000_000_000).state;
    const after = advance(bought, bought.eggStartedAt + H, mulberry32(3)).state;
    expect(after.forcedRarity).toBeNull();
  });
});

describe('consumeItem', () => {
  it('refuses when the bag is empty', () => {
    const r = consumeItem(base(), 'rare-candy', 0);
    expect(r.ok).toBe(false);
    expect(r.state.bonusTokens).toBe(0);
  });

  it('rare candy consumes one and grants progress', () => {
    const s = base({ inventory: { 'rare-candy': 2 } });
    const r = consumeItem(s, 'rare-candy', 0);
    expect(r.ok).toBe(true);
    expect(r.state.inventory['rare-candy']).toBe(1);
    expect(r.state.bonusTokens).toBeGreaterThan(0);
  });

  it('rare candy always grants 25% of the CURRENT requirement', () => {
    // A fixed multiple would under-deliver badly on rare/late-stage companions.
    for (const seed of [1, 7, 21, 33]) {
      const hatched = advance(base(), H, mulberry32(seed)).state;
      const withCandy = { ...hatched, inventory: { 'rare-candy': 1 } };
      const before = progress(withCandy, H).ratio;
      const after = consumeItem(withCandy, 'rare-candy', H).state;
      const gained = progress(after, H + (after.bonusTokens - withCandy.bonusTokens)).ratio - before;
      expect(gained).toBeCloseTo(0.25, 5);
    }
  });

  it('shiny charm arms the next hatch and is consumed by it', () => {
    const s = consumeItem(base({ inventory: { 'shiny-charm': 1 } }), 'shiny-charm', 0).state;
    expect(s.shinyCharmActive).toBe(true);
    const after = advance(s, H, mulberry32(1)).state;
    expect(after.shinyCharmActive).toBe(false);
  });

  it('shiny charm actually raises the odds', () => {
    let plain = 0;
    let charmed = 0;
    for (let seed = 0; seed < 4000; seed++) {
      if (advance(base(), H, mulberry32(seed)).state.active?.isShiny) plain++;
      const s = base({ shinyCharmActive: true });
      if (advance(s, H, mulberry32(seed)).state.active?.isShiny) charmed++;
    }
    expect(charmed).toBeGreaterThan(plain);
  });

  it('everstone toggles on and off, and off is free', () => {
    const on = consumeItem(base({ inventory: { everstone: 1 } }), 'everstone', 0);
    expect(on.state.everstone).toBe(true);
    const off = consumeItem(on.state, 'everstone', 0);
    expect(off.ok).toBe(true);
    expect(off.state.everstone).toBe(false);
  });

  it('everstone stops evolution but not the egg', () => {
    const hatched = advance(base(), H, mulberry32(21)).state;
    const stone = { ...hatched, everstone: true };
    const later = advance(stone, 5_000_000_000, mulberry32(21)).state;
    expect(later.active!.stageIndex).toBe(hatched.active!.stageIndex);
    expect(later.retiredCount).toBe(hatched.retiredCount);
  });
});

describe('buying an egg', () => {
  const hatched = (over: Partial<GameState> = {}) => ({
    ...advance(base(), H, mulberry32(3)).state,
    ...over,
  });

  it('starts the new egg from the full progression total, not part of it', () => {
    // The trap: `eggStartedAt` used to be spelled out as `earned + bonusTokens`
    // while buildState summed `earned + bonusTokens + huntTokens`. The gap is
    // huntTokens, which is cumulative — so within a day of hunting the new egg
    // would already be past its hatch threshold and pop on the next tick,
    // turning the 80x-priced legendary egg into a free instant hatch.
    const s = hatched({
      lifetimeEarned: 100 * H, // has to clear the legendary egg's 80x price
      bonusTokens: 2 * H,
      huntTokens: 3 * H, // more than a whole hatch threshold on its own
    });
    const bought = buy(s, 'egg-legendary', s.lifetimeEarned);
    expect(bought.ok).toBe(true);
    expect(bought.state.active).toBeNull();
    expect(bought.state.eggStartedAt).toBe(lifetimeOf(s));

    const p = progress(bought.state, lifetimeOf(bought.state));
    expect(p.phase).toBe('egg');
    expect(p.have).toBe(0);
    expect(p.ratio).toBe(0);
  });

  it('does not hatch the new egg on the very next pass', () => {
    const s = hatched({ lifetimeEarned: 40 * H, bonusTokens: H, huntTokens: 8 * H });
    const bought = buy(s, 'egg-rare', s.lifetimeEarned).state;
    const { state, events } = advance(bought, lifetimeOf(bought), mulberry32(1));
    expect(events).toEqual([]);
    expect(state.active).toBeNull();
  });

  it('charges the wallet, which hunting and items never fund', () => {
    const s = hatched({ lifetimeEarned: 79 * H, bonusTokens: 50 * H, huntTokens: 50 * H });
    // Wallet sees lifetimeEarned only. One threshold short of the 80x egg, with
    // a hundred thresholds of granted progress sitting right there, still buys
    // nothing — and one more threshold of EARNED tokens does.
    expect(buy(s, 'egg-legendary', s.lifetimeEarned).ok).toBe(false);
    expect(buy(s, 'egg-legendary', 80 * H).ok).toBe(true);
  });
});

describe('the rare candy is priced off what it grants', () => {
  /*
   * The bug this replaced: price was a flat 0.4 thresholds while the effect is
   * 25% of the CURRENT milestone, which runs from 4x to 100x. So the same
   * button was a 0.6x loss during the egg phase and a 62.5x windfall on a
   * legendary about to graduate.
   */
  const candyOn = (over: Partial<GameState>) => {
    const s = base(over);
    return { paid: price('rare-candy', s), got: Math.round(currentRequirement(s) * 0.25) };
  };

  it('costs a fixed share of the milestone, whatever the milestone is', () => {
    const eggPhase = candyOn({ active: null });
    const grown = advance(base(), H, mulberry32(3)).state;
    const partner = candyOn({ active: grown.active });

    // Wildly different absolute prices...
    expect(partner.paid).not.toBe(eggPhase.paid);
    // ...but the same deal. 0.3 out for 0.25 in, everywhere.
    for (const c of [eggPhase, partner]) {
      expect(c.paid / c.got).toBeCloseTo(0.3 / 0.25, 5);
    }
  });

  it('never returns more progress than it costs', () => {
    // The whole point: no state can make candy a money printer. Sweep every
    // rarity at every stage a companion can be on.
    const grown = advance(base(), H, mulberry32(3)).state.active!;
    for (const rarity of RARITY_ORDER) {
      for (const stageIndex of [0, 1, grown.pathIds.length - 1]) {
        const c = candyOn({ active: { ...grown, rarity, stageIndex } });
        expect(c.got).toBeLessThan(c.paid);
      }
    }
  });
});

describe('the shop sells only one of a unique item', () => {
  it('refuses a second everstone, which would do nothing', () => {
    // It is a toggle and `consumeItem` decrements nothing, so one is permanent.
    const s = base({ inventory: { everstone: 1 } });
    const r = buy(s, 'everstone', 1_000_000_000);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('이미 가지고');
    expect(r.state.spentTokens).toBe(0);
  });

  it('still leaves the everstone a button in the bag', () => {
    // UNIQUE is not PASSIVE: the shop stops selling it, the bag keeps toggling
    // it. Collapsing the two sets would silently remove the toggle.
    expect(PASSIVE.has('everstone')).toBe(false);
    expect(UNIQUE.has('everstone')).toBe(true);
    for (const id of PASSIVE) expect(UNIQUE.has(id)).toBe(true);
  });
});

describe('shop shelves', () => {
  it('puts every product on one', () => {
    for (const p of PRODUCTS) expect(GROUPS).toContain(p.group);
  });

  it('leaves no shelf empty', () => {
    // An empty shelf draws a heading with nothing under it, and a chip that
    // filters to a blank list.
    for (const g of GROUPS) expect(PRODUCTS.some((p) => p.group === g)).toBe(true);
  });

  it('names every shelf in Korean', () => {
    for (const g of GROUPS) expect(GROUP_KO[g]).toBeTruthy();
  });

  it('keeps all four eggs together', () => {
    const eggs = PRODUCTS.filter((p) => p.kind === 'egg');
    expect(eggs.length).toBe(4);
    for (const p of eggs) expect(p.group).toBe('egg');
  });
});

describe('rarity buckets used by the shop', () => {
  it('agree with the game rules', () => {
    expect(rarityOf(255)).toBe('common');
    expect(rarityOf(3)).toBe('legendary');
  });
});

describe('migrate', () => {
  /**
   * The one that catches the next field, not just the last one.
   *
   * `migrate` rebuilds the state object field by field rather than spreading
   * it, so anything added to GameState and not added here is silently dropped
   * on the very next load. That happened: the key stone unequipped itself every
   * twenty seconds and the stone collection emptied, with nothing on screen to
   * say why. Comparing a fully-populated save against its own round trip is the
   * cheapest way to make that loud.
   */
  it('loses nothing from a save that already has every field', () => {
    const full: GameState = {
      ...initialState(),
      lifetimeEarned: 12_345,
      spentTokens: 100,
      bonusTokens: 200,
      huntTokens: 300,
      inventory: { 'rare-candy': 1, 'key-stone': 1, 'dynamax-band': 1, 'dna-splicers': 1 },
      stones: { 10034: 2, 10195: 1 },
      showBattleForm: true,
      everstone: true,
      shinyCharmActive: true,
      forcedRarity: 'rare',
      huntCount: 7,
      huntUncapped: true,
      tms: { 53: 1 },
    };
    const back = migrate(full);
    for (const key of Object.keys(full) as (keyof GameState)[]) {
      expect(back[key], key).toEqual(full[key]);
    }
  });

  it('carries a v1 save forward instead of wiping it', () => {
    const v1 = {
      schemaVersion: 1,
      baselineTokens: 1_688_190_298,
      hatchThreshold: 26_701_053,
      eggStartedAt: 0,
      active: null,
      dex: [{ speciesId: 25, shiny: false, firstSeenAt: 1 }],
      retiredCount: 3,
    };
    const s = migrate(v1 as never);
    expect(s.schemaVersion).toBe(4);
    expect(s.hatchThreshold).toBe(26_701_053);
    // Pikachu's line brings Pichu with it now — an entry recorded before
    // pre-evolutions were registered gets them on the way forward.
    expect(s.dex.map((d) => d.speciesId).sort((a, b) => a - b)).toEqual([25, 172]);
    expect(s.retiredCount).toBe(3);
    // new fields get defaults rather than undefined
    expect(s.spentTokens).toBe(0);
    expect(s.bonusTokens).toBe(0);
    expect(s.inventory).toEqual({});
    expect(s.everstone).toBe(false);
  });

  it('drops the old baseline so a pruned corpus is not held against the user', () => {
    const v2 = {
      schemaVersion: 2,
      // The trap: the live corpus is now BELOW this, so v2 computed earned = 0.
      baselineTokens: 1_688_712_177,
      hatchThreshold: 26_701_053,
      eggStartedAt: 0,
      active: {
        pathIds: [667, 668],
        stageIndex: 1,
        isShiny: false,
        rarity: 'common',
        nature: 'hardy',
        bornAt: 26_701_053,
        tokensAtStageStart: 133_505_265,
      },
      dex: [],
      retiredCount: 0,
      spentTokens: 117_484_633,
      bonusTokens: 26_701_053,
      inventory: {},
      shinyCharmActive: true,
      forcedRarity: null,
      everstone: false,
    };
    const s = migrate(v2 as never);
    expect(s).not.toHaveProperty('baselineTokens');
    // Empty anchor: the next scan re-anchors on the corpus as it stands.
    expect(s.lastTotal).toEqual({});
    // Rebuilt from what the save proves was earned — enough to cover the
    // wallet AND to keep the companion standing where it already stands.
    expect(s.lifetimeEarned).toBe(117_484_633);
    expect(wallet(s, s.lifetimeEarned)).toBe(0);
    expect(progress(s, s.lifetimeEarned + s.bonusTokens).have).toBeGreaterThanOrEqual(0);
    expect(s.active!.stageIndex).toBe(1);
  });

  it('gives a v3 companion a moveset, and an attack to put in it', () => {
    // Left undefined this throws the first time anything reads it, /api/state
    // answers 500, and the panel shows 연결 실패 — for every existing user.
    //
    // It also gets the attack it should have hatched with: a companion with
    // nothing that hits cannot fight, and one that predates the rule has no
    // other way to acquire it.
    const v3 = {
      schemaVersion: 3,
      lastTotal: { activity: 1_529_470_944 },
      lifetimeEarned: 117_484_633,
      hatchThreshold: 26_701_053,
      eggStartedAt: 0,
      active: {
        pathIds: [667, 668],
        stageIndex: 1,
        isShiny: false,
        rarity: 'common',
        nature: 'hardy',
        bornAt: 26_701_053,
        tokensAtStageStart: 133_505_265,
      },
      dex: [],
      retiredCount: 0,
      spentTokens: 117_484_633,
      bonusTokens: 26_701_053,
      inventory: {},
      shinyCharmActive: true,
      forcedRarity: null,
      everstone: false,
    };
    const s = migrate(v3 as never);
    expect(s.schemaVersion).toBe(4);
    // Pyroar is fire/normal; the weakest fire attack it can be taught.
    expect(s.active!.moves).toEqual([starterMove(668)]);
    expect(hasDamaging(s.active!.moves)).toBe(true);
    // Idempotent: loading twice must not hand out a second one.
    expect(migrate(s as never).active!.moves).toEqual(s.active!.moves);
    // A v3 companion predates the hunt baselines and the save has no hunting,
    // so it starts from zero — which is also what it should read on screen.
    expect(s.active!.huntTokensAtBirth).toBe(0);
    expect(s.active!.huntCountAtBirth).toBe(0);
    // Hunting starts un-anchored. `0` would read as a 56-year gap and pay out
    // the offline cap on every single tick; a clock here would make migrate
    // non-deterministic for these very tests.
    expect(s.huntedAt).toBeNull();
    expect(s.huntTokens).toBe(0);
    expect(s.huntCount).toBe(0);
    expect(s.tms).toEqual({});
    expect(s.huntLog).toEqual([]);
    expect(s.huntEnabled).toBe(true);
  });

  it('does not move the progress bar when it upgrades a save', () => {
    // The whole point of a migration nobody notices.
    const v3 = {
      schemaVersion: 3,
      lastTotal: { activity: 1_529_470_944 },
      lifetimeEarned: 400_000_000,
      hatchThreshold: 10_000_000,
      eggStartedAt: 0,
      active: {
        pathIds: [4, 5, 6],
        stageIndex: 1,
        isShiny: false,
        rarity: 'rare',
        nature: 'brave',
        bornAt: 10_000_000,
        tokensAtStageStart: 110_000_000,
      },
      dex: [],
      retiredCount: 0,
      spentTokens: 0,
      bonusTokens: 5_000_000,
      inventory: {},
      shinyCharmActive: false,
      forcedRarity: null,
      everstone: false,
    };
    const before = 405_000_000; // lifetimeEarned + bonusTokens, as v3 computed it
    const s = migrate(v3 as never);
    expect(lifetimeOf(s)).toBe(before);
    expect(progress(s, lifetimeOf(s))).toEqual(progress(v3 as never, before));
  });

  /**
   * A save whose retirement counter fell behind its own dex — a lost write, a
   * restored backup — used to keep that gap forever, and the dex tab showed it
   * as "4종 ... 1마리를 떠나보냈습니다": a counter that looks stuck.
   */
  it('floors the retirement counter at what the dex proves', () => {
    const behind = {
      schemaVersion: 4,
      dex: [
        { speciesId: 668, shiny: false, firstSeenAt: 1 },
        { speciesId: 667, shiny: false, firstSeenAt: 1 },
        { speciesId: 460, shiny: false, firstSeenAt: 2 },
        { speciesId: 459, shiny: false, firstSeenAt: 2 },
      ],
      retiredCount: 1,
    };
    expect(migrate(behind as never).retiredCount).toBe(2);
  });

  it('never lowers a counter the dex cannot account for', () => {
    // Two Pyroars leave one entry between them. The counter knows better than
    // the dex does, so it wins.
    const twice = {
      schemaVersion: 4,
      dex: [{ speciesId: 668, shiny: false, firstSeenAt: 1 }],
      retiredCount: 2,
    };
    expect(migrate(twice as never).retiredCount).toBe(2);
  });

  it('falls back to a fresh state on garbage', () => {
    const s = migrate(null);
    expect(s.lastTotal).toEqual({});
    expect(s.lifetimeEarned).toBe(0);
    expect(s.huntedAt).toBeNull();
    expect(s.tms).toEqual({});
  });
  it('baselines a live companion at whatever hunting has already done', () => {
    // No honest backfill exists — nothing records the counters as of the last
    // hatch — so the companion that is out starts counting from now.
    const save = {
      schemaVersion: 4,
      huntTokens: 342_187_618,
      huntCount: 2898,
      active: {
        pathIds: [667, 668],
        stageIndex: 1,
        isShiny: false,
        rarity: 'common' as const,
        nature: 'hardy',
        bornAt: 26_701_053,
        tokensAtStageStart: 133_505_265,
        moves: [53],
      },
    };
    const s = migrate(save as never);
    expect(s.active!.huntTokensAtBirth).toBe(342_187_618);
    expect(s.active!.huntCountAtBirth).toBe(2898);
    // Idempotent: a later load must not re-baseline to a newer count, or the
    // figure would reset to zero on every launch.
    const later = migrate({ ...s, huntCount: 3000 } as never);
    expect(later.active!.huntCountAtBirth).toBe(2898);
  });

});
