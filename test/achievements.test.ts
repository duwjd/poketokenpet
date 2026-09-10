import { describe, expect, it } from 'vitest';
import { initialState, lifetimeOf, type GameState } from '../server/game.ts';
import { ACHIEVEMENTS, AWARD_ONLY_ITEMS, CAT_KO, settleAchievements } from '../server/achievements.ts';
import { PRODUCTS, wallet, type ItemId } from '../server/shop.ts';
import { migrate } from '../server/store.ts';

const H = 10_000_000;
/** A companion that exists, for the rows that read the active moveset. */
const ALIVE = {
  pathIds: [25],
  stageIndex: 0,
  isShiny: false,
  rarity: 'common' as const,
  nature: 'hardy',
  bornAt: 0,
  tokensAtStageStart: 0,
  moves: [] as number[],
};

const base = (over: Partial<GameState> = {}): GameState => ({
  ...initialState(),
  hatchThreshold: H,
  ...over,
});

/** A state that has cleared every one-shot, for the "all of them" cases. */
const maxed = () =>
  base({
    lifetimeEarned: H * 5000,
    spentTokens: H * 500,
    // Past a full lap of the route, which is what `travel-lap` measures. It
    // was 10_000 and the route grew to 10_920 encounters, so the top rung of
    // the 여행 ladder quietly stopped being reachable by this fixture.
    huntCount: 20_000,
    // Spans all nine generations, and carries a shiny, a fusion and a nickname.
    dex: Array.from({ length: 1024 }, (_, i) => ({
      speciesId: i + 1,
      shiny: i < 12,
      firstSeenAt: 0,
      ...(i === 1 ? { formId: 10_000 } : {}),
      ...(i === 2 ? { nickname: '코코리' } : {}),
    })),
    active: { ...ALIVE, moves: [1, 2, 3, 4] },
    retiredCount: 200,
    trainerWins: 500,
    // Every Kanto badge, and enough gym wins for the rematch row to have paid.
    badges: [1, 2, 3, 4, 5, 6, 7, 8],
    gymWins: 40,
    // The league cleared, so its one-shots and its repeat have both paid.
    leagueBest: 5,
    leagueWins: 3,
    // Twenty legendaries met — the counter the shrine rooms and the 조우
    // rungs both read. Distinct from having RAISED any of them.
    metLegends: [144, 145, 146, 150, 151, 243, 244, 245, 249, 250, 380, 381, 382, 383, 384, 480, 481, 482, 483, 484],
    tmsFound: 500,
    tms: Object.fromEntries(Array.from({ length: 70 }, (_, i) => [i + 1, 1])),
    stones: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [10_000 + i, 1])),
  });

const oneShots = () => ACHIEVEMENTS.filter((a) => !a.repeat);
const repeaters = () => ACHIEVEMENTS.filter((a) => a.repeat);

describe('the achievement table', () => {
  it('gives every id exactly once', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names an item that actually exists', () => {
    const known = new Set(PRODUCTS.filter((p) => p.kind === 'item').map((p) => p.id));
    for (const a of ACHIEVEMENTS) {
      if (a.item) expect(known, a.id).toContain(a.item);
    }
  });

  /**
   * The one that keeps a build from shipping an unreachable item.
   *
   * These three left the shop when achievements arrived. If a later edit drops
   * the achievement that hands one over and nobody notices, mega evolution
   * becomes permanently unobtainable on a fresh save — and nothing on screen
   * would say why.
   */
  it('hands over everything the shop stopped selling', () => {
    const granted = new Set(ACHIEVEMENTS.map((a) => a.item).filter(Boolean));
    for (const id of AWARD_ONLY_ITEMS) expect(granted, id).toContain(id);
  });

  it('marks exactly those items unbuyable', () => {
    const unbuyable = PRODUCTS.filter((p) => p.award).map((p) => p.id);
    expect([...unbuyable].sort()).toEqual([...AWARD_ONLY_ITEMS].sort());
  });

  it('keeps every category populated and named', () => {
    expect(Object.keys(CAT_KO)).toHaveLength(10);
    // A `cat` with no rows is a chip that filters to an empty screen.
    for (const cat of Object.keys(CAT_KO)) {
      expect(ACHIEVEMENTS.some((a) => a.cat === cat), cat).toBe(true);
    }
    for (const a of ACHIEVEMENTS) expect(CAT_KO[a.cat], a.id).toBeTruthy();
  });

  it('runs each ladder upwards', () => {
    // Grouped by id prefix rather than by category, because a category can hold
    // more than one ladder: 수집 counts mega stones AND TMs, and those two do
    // not interleave into one sequence.
    //
    // Only the numbered ids are ladders. `raise-shiny` and `raise-fusion` are
    // one-off conditions expressed as a metric out of 1, and they share 육성
    // with a counting ladder without belonging to it.
    const s = maxed();
    const ladders = new Map<string, number[]>();
    for (const a of ACHIEVEMENTS.filter((x) => !x.repeat && /-\d+$/.test(x.id))) {
      // Everything before the trailing number IS the ladder's name. Splitting
      // on the first hyphen instead lumped `legend-raise-5` in with
      // `legend-wins-100`, which measure different things and never interleave.
      const key = a.id.replace(/-\d+$/, '');
      ladders.set(key, [...(ladders.get(key) ?? []), a.metric(s).need]);
    }
    for (const [key, needs] of ladders) {
      expect(needs, key).toEqual([...needs].sort((x, y) => x - y));
    }
  });

  it('asks for something', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.metric(base()).need, a.id).toBeGreaterThan(0);
      expect(a.money, a.id).toBeGreaterThan(0);
      expect(a.ko.length, a.id).toBeGreaterThan(0);
      expect(a.desc.length, a.id).toBeGreaterThan(0);
    }
  });
});

describe('settleAchievements', () => {
  it('unlocks nothing on a fresh install', () => {
    const s = base();
    expect(settleAchievements(s, 1)).toBe(s); // identity: the caller reads this
    expect(s.achievements ?? {}).toEqual({});
  });

  /**
   * The property the whole design rests on.
   *
   * In electron:dev two processes run this pipeline against one state.json and
   * safety comes from both computing identical bytes. A second pass must be a
   * no-op — not "roughly the same", but the same object back.
   */
  it('is idempotent, so two writers cannot double-pay', () => {
    const s = base({ retiredCount: 3, huntCount: 600 });
    const once = settleAchievements(s, 111);
    const twice = settleAchievements(once, 222);
    expect(twice).toBe(once);
    expect(twice.awardTokens).toBe(once.awardTokens);
    expect(Object.keys(twice.achievements!)).toEqual(Object.keys(once.achievements!));
  });

  it('unlocks exactly the rung that was crossed', () => {
    const just = settleAchievements(base({ retiredCount: 1 }), 1);
    expect(Object.keys(just.achievements!)).toContain('raise-1');
    expect(Object.keys(just.achievements!)).not.toContain('raise-10');

    const under = settleAchievements(base({ retiredCount: 9 }), 1);
    expect(Object.keys(under.achievements!)).not.toContain('raise-10');
    const on = settleAchievements(base({ retiredCount: 10 }), 1);
    expect(Object.keys(on.achievements!)).toContain('raise-10');
  });

  /**
   * The contract that keeps an achievement from being progress.
   *
   * Paying into any of these three would move the egg along, and `bonusTokens`
   * specifically would walk around `huntCap` — the hole trainer.ts already
   * refuses to open.
   */
  it('pays the wallet and never the egg', () => {
    const s = base({ retiredCount: 50, huntCount: 5000, tmsFound: 100 });
    const out = settleAchievements(s, 1);
    expect(out.awardTokens).toBeGreaterThan(0);
    expect(out.lifetimeEarned).toBe(s.lifetimeEarned);
    expect(out.bonusTokens).toBe(s.bonusTokens);
    expect(out.huntTokens).toBe(s.huntTokens);
    expect(lifetimeOf(out)).toBe(lifetimeOf(s));
    // ...and the money is real: the wallet sees it.
    expect(wallet(out, 0)).toBe(out.awardTokens);
  });

  it('scales the payout with the hatch threshold', () => {
    const small = settleAchievements(base({ hatchThreshold: 1_000_000, retiredCount: 1 }), 1);
    const big = settleAchievements(base({ hatchThreshold: 4_000_000, retiredCount: 1 }), 1);
    expect(big.awardTokens).toBe(small.awardTokens! * 4);
  });

  it('hands the items over exactly once each', () => {
    const out = settleAchievements(maxed(), 1);
    // Every one-shot lands in `achievements`; the repeaters live in `repeats`.
    expect(Object.keys(out.achievements!)).toHaveLength(oneShots().length);
    expect(Object.keys(out.repeats!)).toHaveLength(repeaters().length);
    const counts: Partial<Record<ItemId, number>> = {};
    for (const a of ACHIEVEMENTS) if (a.item) counts[a.item] = (counts[a.item] ?? 0) + 1;
    for (const [id, n] of Object.entries(counts)) {
      expect(out.inventory[id as ItemId], id).toBe(n);
    }
    // A passive is worth nothing twice, so it must be granted by one row only.
    expect(out.inventory['key-stone']).toBe(1);
    expect(out.inventory['dynamax-band']).toBe(1);
  });

  it('adds to an inventory rather than replacing it', () => {
    const out = settleAchievements(base({ retiredCount: 1, inventory: { 'rare-candy': 4 } }), 1);
    expect(out.inventory['rare-candy']).toBe(4);
  });

  it('stamps when, and keeps a stamp it already had', () => {
    const first = settleAchievements(base({ retiredCount: 1 }), 5000);
    expect(first.achievements!['raise-1']).toBe(5000);
    const later = settleAchievements({ ...first, retiredCount: 10 }, 9000);
    expect(later.achievements!['raise-1']).toBe(5000);
    expect(later.achievements!['raise-10']).toBe(9000);
  });

  /**
   * Lowering a bar is allowed; taking a finished thing back is not.
   *
   * Unlocks are keyed by id and an id already present is skipped, so a row
   * whose threshold later moves out of reach stays cleared.
   */
  it('never revokes an unlock when the bar moves', () => {
    const cleared = settleAchievements(base({ retiredCount: 10 }), 1);
    const shrunk = settleAchievements({ ...cleared, retiredCount: 0 }, 2);
    expect(shrunk.achievements!['raise-10']).toBeDefined();
  });
});

describe('the new counters survive a reload', () => {
  /**
   * `migrate` is an allow-list, not a spread. A field missing from it is wiped
   * on the next load — which for an unlock table means re-granting every reward
   * every twenty seconds.
   */
  it('keeps the achievement fields', () => {
    const saved = settleAchievements(base({ retiredCount: 3, trainerWins: 7, tmsFound: 9 }), 4242);
    const back = migrate(JSON.parse(JSON.stringify(saved)));
    expect(back.achievements).toEqual(saved.achievements);
    expect(back.awardTokens).toBe(saved.awardTokens);
    expect(back.trainerWins).toBe(7);
    expect(back.tmsFound).toBe(9);
  });

  it('floors tmsFound at what is actually in the bag', () => {
    // An old save has no counter but does have TMs, and those were certainly
    // found. Same self-healing trick retiredCount gets from departedCount.
    const back = migrate({ tms: { 1: 2, 5: 3 } });
    expect(back.tmsFound).toBe(5);
    // ...and a real count that already exceeds the holding is left alone.
    expect(migrate({ tms: { 1: 2 }, tmsFound: 40 }).tmsFound).toBe(40);
  });

  it('starts a save that predates all this at zero, not at undefined', () => {
    const back = migrate({});
    expect(back.trainerWins).toBe(0);
    expect(back.awardTokens).toBe(0);
    expect(back.achievements).toEqual({});
  });
});

describe('repeating achievements', () => {
  /** `raise-repeat` pays every 10 graduations, at 2x the hatch threshold. */
  const STEP = 10;
  const PAY = 2 * H;
  const only = (n: number) => base({ retiredCount: n });

  it('pays nothing until the first step is crossed', () => {
    expect(settleAchievements(only(9), 1).repeats?.['raise-repeat']).toBeUndefined();
    expect(settleAchievements(only(STEP), 1).repeats!['raise-repeat']).toBe(1);
  });

  it('pays once per step, and a backlog all at once', () => {
    // Compared above 100, where every one-shot rung in 육성 is already cleared
    // in both states — so the whole difference is the repeat, and nothing else.
    const ten = settleAchievements(only(100), 1);
    const thirteen = settleAchievements(only(130), 1);
    expect(ten.repeats!['raise-repeat']).toBe(10);
    expect(thirteen.repeats!['raise-repeat']).toBe(13);
    // Three steps crossed while the app was closed is three payments, the same
    // way an offline hunting backlog settles in one tick.
    expect(thirteen.awardTokens! - ten.awardTokens!).toBe(3 * PAY);
  });

  /**
   * The property that makes an uncapped reward safe to run twice.
   *
   * Tiers are `floor(have / step)` read fresh, never `+= 1`, so a second pass —
   * or a second process against the same file — pays nothing.
   */
  it('is idempotent across passes', () => {
    const once = settleAchievements(only(STEP * 4), 1);
    const twice = settleAchievements(once, 2);
    expect(twice).toBe(once);
    expect(twice.repeats!['raise-repeat']).toBe(4);
  });

  it('picks up where it left off rather than re-paying the backlog', () => {
    // Again above 100 so no one-shot fires in between and muddies the delta.
    const at100 = settleAchievements(only(100), 1);
    const at120 = settleAchievements({ ...at100, retiredCount: 120 }, 2);
    expect(at120.repeats!['raise-repeat']).toBe(12);
    // Two more steps, not twelve.
    expect(at120.awardTokens! - at100.awardTokens!).toBe(2 * PAY);
  });

  it('keeps the two maps apart', () => {
    const out = settleAchievements(maxed(), 1);
    for (const a of repeaters()) {
      expect(out.achievements![a.id], a.id).toBeUndefined();
      expect(out.repeats![a.id], a.id).toBeGreaterThan(0);
    }
    for (const a of oneShots()) {
      expect(out.achievements![a.id], a.id).toBeDefined();
      expect(out.repeats![a.id], a.id).toBeUndefined();
    }
  });

  it('never hands an item to a repeating row', () => {
    // An item is a one-time thing by nature; a passive would pile up for ever.
    for (const a of repeaters()) expect(a.item, a.id).toBeUndefined();
  });

  it('stays cheaper than the ladder it sits beside', () => {
    // A repeat that out-paid the finite top rung would make the ladder pointless.
    for (const a of repeaters()) {
      const top = Math.max(
        ...ACHIEVEMENTS.filter((x) => x.cat === a.cat && !x.repeat).map((x) => x.money),
      );
      expect(a.money, a.id).toBeLessThan(top);
    }
  });

  it('survives a reload', () => {
    const saved = settleAchievements(only(40), 1);
    const back = migrate(JSON.parse(JSON.stringify(saved)));
    expect(back.repeats).toEqual(saved.repeats);
    // ...and coming back does not re-pay it.
    expect(settleAchievements(back, 2)).toBe(back);
  });
});
