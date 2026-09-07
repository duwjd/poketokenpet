import { describe, expect, it } from 'vitest';
import { advance, initialState, mulberry32, type GameState } from '../server/game.ts';
import { LEGENDS, legendOf } from '../server/legenddata.ts';
import {
  LEGEND_GATES,
  SHARDS_PER_ITEM,
  droppableItems,
  fuseShards,
  hatchLegendEgg,
  openLegends,
  shardableItems,
  spendLegendItem,
} from '../server/legends.ts';
import { encounterAt, hunt, legendDropAt, shardDropAt, substituteAt } from '../server/hunt.ts';
import { trainerAt } from '../server/trainer.ts';
import { legendItem } from '../server/legenddata.ts';

const H = 10_000_000;
const base = (over: Partial<GameState> = {}): GameState => ({
  ...initialState(),
  hatchThreshold: H,
  ...over,
});

/** A companion that exists, so hunting is not idle. */
const ALIVE = {
  pathIds: [667, 668],
  stageIndex: 1,
  isShiny: false,
  rarity: 'common' as const,
  nature: 'hardy',
  bornAt: 0,
  tokensAtStageStart: 0,
  moves: [53],
};

const hunting = (over: Partial<GameState> = {}) =>
  base({
    active: ALIVE,
    huntEnabled: true,
    huntedAt: 0,
    lifetimeEarned: H * 100,
    ...over,
  });

describe('the gate table', () => {
  it('covers every legendary and mythical, and nothing else', () => {
    const gated = LEGEND_GATES.map((g) => g.speciesId);
    expect(new Set(gated).size).toBe(gated.length);
    expect([...gated].sort((a, b) => a - b)).toEqual(LEGENDS.map((l) => l.id).sort((a, b) => a - b));
  });

  it('names an item that actually exists', () => {
    for (const g of LEGEND_GATES) {
      if (g.item) expect(legendItem(g.item), g.item).not.toBeNull();
      // An item row must say where the item comes from, or nothing delivers it.
      expect(!!g.item === !!g.source, `${g.speciesId}`).toBe(true);
    }
  });

  it('asks for something', () => {
    const s = base();
    for (const g of LEGEND_GATES) {
      expect(g.metric(s).need, `${g.speciesId}`).toBeGreaterThan(0);
      expect(g.how.length, `${g.speciesId}`).toBeGreaterThan(0);
    }
  });

  /**
   * The one that keeps a build from shipping an unreachable species.
   *
   * A gate whose item is only ever handed over by an achievement is
   * unobtainable if that achievement row is dropped — the species behind it
   * would be locked for ever with nothing on screen to say why. Same failure
   * the shop's award-only items already have a test for.
   */
  it('has an achievement for every award-source item', async () => {
    const { ACHIEVEMENTS } = await import('../server/achievements.ts');
    const granted = new Set(ACHIEVEMENTS.map((a) => a.legendItem).filter(Boolean));
    for (const g of LEGEND_GATES) {
      if (g.source === 'award') expect(granted, `${g.speciesId} ${g.item}`).toContain(g.item);
    }
  });

  it('opens nothing on a fresh save', () => {
    expect(openLegends(base()).size).toBe(0);
  });

  it('opens a species once its bar is cleared', () => {
    // 삼신조 want 관동 도감 40종.
    const dex = Array.from({ length: 40 }, (_, i) => ({
      speciesId: i + 1,
      shiny: false,
      firstSeenAt: 0,
    }));
    const open = openLegends(base({ dex }));
    expect(open.has(144)).toBe(true);
    expect(open.has(145)).toBe(true);
    // ...and only that group. 뮤츠 wants 300 species and 80 wins.
    expect(open.has(150)).toBe(false);
  });

  it('opens an item row by HOLDING the item, not by clearing its bar', () => {
    // 은빛깃털 is 루기아's, and its bar is 성도 도감 50종.
    const dex = Array.from({ length: 60 }, (_, i) => ({
      speciesId: 152 + i,
      shiny: false,
      firstSeenAt: 0,
    }));
    const cleared = base({ dex });
    expect(openLegends(cleared).has(249)).toBe(false);
    // The bar being met is what lets the item start dropping.
    expect(droppableItems(cleared)).toContain('silver-wing');
    // Holding it is what opens the species.
    expect(openLegends(base({ dex, legendItems: { 'silver-wing': 1 } })).has(249)).toBe(true);
  });

  it('offers each item on exactly one road', () => {
    // A slug that both dropped and fused would make three sources into one.
    const rich = base({
      dex: Array.from({ length: 700 }, (_, i) => ({ speciesId: i + 1, shiny: false, firstSeenAt: 0 })),
      trainerWins: 500,
      huntCount: 20_000,
      retiredCount: 300,
      stones: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [10_000 + i, 1])),
    });
    const drop = new Set(droppableItems(rich));
    for (const s of shardableItems(rich)) expect(drop.has(s), s).toBe(false);
  });
});

describe('the encounter gate', () => {
  /**
   * The property everything else rests on.
   *
   * The gate is applied to `encounterAt`'s OUTPUT, never inside it, so the
   * encounter stream is byte-for-byte what it always was. If this ever fails, a
   * draw leaked into `encounterAt` and every encounter the app ever produced
   * just changed.
   */
  it('does not disturb the wild encounter stream', () => {
    for (let k = 0; k < 20_000; k++) {
      const before = encounterAt(k, 668, H);
      substituteAt(k);
      legendDropAt(k, ['adamant-orb']);
      shardDropAt(k, ['azure-flute']);
      expect(encounterAt(k, 668, H), `seq ${k}`).toEqual(before);
    }
  });

  it('never substitutes in another gated species', () => {
    // Which is what lets the caller skip a retry loop.
    for (let k = 0; k < 20_000; k++) {
      expect(legendOf(substituteAt(k)), `seq ${k}`).toBeNull();
    }
  });

  it('shows no legendary at all while every gate is shut', () => {
    let met = 0;
    let seen = 0;
    let s = hunting();
    for (let tick = 0; tick < 40; tick++) {
      // Stop as soon as anything opens: hunting long enough drops mega stones,
      // and fifteen of those legitimately open the Regi trio. The claim under
      // test is "shut means unseen", not "nothing ever opens".
      if (openLegends(s).size > 0) break;
      const out = hunt({ ...s, huntedAt: 0 }, 300_000 * 96);
      for (const e of out.state.huntLog) {
        seen += 1;
        if (legendOf(e.wildId)) met += 1;
      }
      s = { ...out.state, huntedAt: 0 };
    }
    expect(seen).toBeGreaterThan(100);
    expect(met).toBe(0);
  });

  it('keeps legendaries off a route trainer team', () => {
    // A 등산가 fielding Arceus would undo the whole feature in one line.
    let bad = 0;
    for (let k = 0; k < 40_000; k++) {
      const t = trainerAt(k);
      if (!t) continue;
      for (const id of t.team) if (legendOf(id)) bad += 1;
    }
    expect(bad).toBe(0);
  });

  it('lets one through once its gate opens', () => {
    // Give 삼신조 their bar and hunt far enough to roll one.
    const dex = Array.from({ length: 40 }, (_, i) => ({
      speciesId: i + 1,
      shiny: false,
      firstSeenAt: 0,
    }));
    const open = openLegends(base({ dex }));
    expect(open.size).toBeGreaterThan(0);
    // The substitution only fires for species NOT in the open set, so an open
    // one survives the roll untouched.
    let survived = 0;
    for (let k = 0; k < 40_000; k++) {
      const w = encounterAt(k, 668, H).wildId;
      if (open.has(w)) survived += 1;
    }
    expect(survived).toBeGreaterThan(0);
  });
});

describe('a reserved encounter', () => {
  it('pins the very next encounter and spends the item', () => {
    const s = hunting({ legendItems: { 'adamant-orb': 1 }, huntCount: 500 });
    const r = spendLegendItem(s, 'adamant-orb');
    expect(r.ok).toBe(true);
    // Stamped with an absolute index, not "the next one" — two writers replay
    // the same range and have to agree about which encounter was claimed.
    expect(r.state.forcedNext).toEqual({ seq: 500, speciesId: 483 });
    expect(r.state.legendItems!['adamant-orb']).toBe(0);

    const out = hunt({ ...r.state, huntedAt: 0 }, 300_000 * 2);
    const first = out.state.huntLog.find((e) => e.seq === 500);
    expect(first?.wildId).toBe(483);
    expect(first?.legend?.speciesId).toBe(483);
    // The reservation is consumed by the encounter it named.
    expect(out.state.forcedNext).toBeNull();
  });

  it('refuses without the item, and refuses to double-book', () => {
    expect(spendLegendItem(hunting(), 'adamant-orb').ok).toBe(false);
    const armed = hunting({ legendItems: { 'adamant-orb': 2 } });
    const once = spendLegendItem(armed, 'adamant-orb');
    expect(spendLegendItem(once.state, 'adamant-orb').ok).toBe(false);
  });
});

describe('the egg', () => {
  it('is what a won fight leaves behind, and the dex stays untouched', () => {
    const s = hunting({ legendItems: { 'adamant-orb': 1 }, huntCount: 700, active: { ...ALIVE, moves: [53, 63, 89, 87] } });
    const armed = spendLegendItem(s, 'adamant-orb').state;
    const out = hunt({ ...armed, huntedAt: 0 }, 300_000 * 2);
    const fight = out.state.huntLog.find((e) => e.legend);
    expect(fight).toBeDefined();
    // Win or lose, nothing is registered — the dex still means "raised".
    expect(out.state.dex).toEqual([]);
    if (fight!.legend!.won) expect(out.state.legendEggs!['483']).toBe(1);
    else expect(out.state.legendEggs?.['483'] ?? 0).toBe(0);
  });

  it('hatches the species it names', () => {
    const s = base({ legendEggs: { 144: 1 }, lifetimeEarned: H * 4 });
    const r = hatchLegendEgg(s, 144);
    expect(r.ok).toBe(true);
    expect(r.state.forcedSpecies).toBe(144);
    expect(r.state.legendEggs![144]).toBe(0);

    const grown = advance(r.state, r.state.eggStartedAt + H, mulberry32(7));
    expect(grown.state.active).not.toBeNull();
    expect(grown.state.active!.pathIds).toContain(144);
    // Consumed by the hatch, exactly as forcedRarity is.
    expect(grown.state.forcedSpecies).toBeNull();
  });

  it('graduates whoever was out, the way a shop egg does', () => {
    const s = base({ legendEggs: { 144: 1 }, active: ALIVE, lifetimeEarned: H * 4 });
    const r = hatchLegendEgg(s, 144);
    expect(r.state.active).toBeNull();
    expect(r.state.retiredCount).toBe(1);
    expect(r.state.dex.length).toBeGreaterThan(0);
  });

  it('refuses when there is no egg', () => {
    expect(hatchLegendEgg(base(), 144).ok).toBe(false);
  });
});

describe('fragments', () => {
  it('fuse into the item at a full set, and not before', () => {
    const short = base({ shards: { 'azure-flute': SHARDS_PER_ITEM - 1 } });
    expect(fuseShards(short, 'azure-flute').ok).toBe(false);

    const full = base({ shards: { 'azure-flute': SHARDS_PER_ITEM } });
    const r = fuseShards(full, 'azure-flute');
    expect(r.ok).toBe(true);
    expect(r.state.shards!['azure-flute']).toBe(0);
    expect(r.state.legendItems!['azure-flute']).toBe(1);
  });

  it('keeps the remainder when more than a set is held', () => {
    const r = fuseShards(base({ shards: { 'azure-flute': SHARDS_PER_ITEM + 3 } }), 'azure-flute');
    expect(r.state.shards!['azure-flute']).toBe(3);
  });
});

describe('idempotence', () => {
  /**
   * Two processes settle the same range against one state.json. They can only
   * agree because the legendary picture is resolved once, from the state they
   * both loaded, and never re-read inside the loop.
   */
  it('settles the same range to the same bytes twice', () => {
    const s = hunting({
      huntCount: 1200,
      legendItems: { 'adamant-orb': 1 },
      dex: Array.from({ length: 40 }, (_, i) => ({ speciesId: i + 1, shiny: false, firstSeenAt: 0 })),
    });
    const a = hunt({ ...s, huntedAt: 0 }, 300_000 * 20);
    const b = hunt({ ...s, huntedAt: 0 }, 300_000 * 20);
    expect(a.state).toEqual(b.state);
  });

  it('gives the same open set for the same state', () => {
    const s = base({ dex: Array.from({ length: 40 }, (_, i) => ({ speciesId: i + 1, shiny: false, firstSeenAt: 0 })) });
    expect([...openLegends(s)].sort()).toEqual([...openLegends(s)].sort());
  });
});

describe('the new fields survive a reload', () => {
  it('keeps every one of them', async () => {
    const { migrate } = await import('../server/store.ts');
    const saved = base({
      legendItems: { 'adamant-orb': 2 },
      shards: { 'azure-flute': 5 },
      legendEggs: { 144: 1 },
      forcedSpecies: 150,
      forcedNext: { seq: 42, speciesId: 483 },
    });
    const back = migrate(JSON.parse(JSON.stringify(saved)));
    expect(back.legendItems).toEqual(saved.legendItems);
    expect(back.shards).toEqual(saved.shards);
    expect(back.legendEggs).toEqual(saved.legendEggs);
    expect(back.forcedSpecies).toBe(150);
    expect(back.forcedNext).toEqual({ seq: 42, speciesId: 483 });
  });
});
