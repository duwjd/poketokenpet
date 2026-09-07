import { describe, expect, it } from 'vitest';
import {
  NICKNAME_MAX,
  accrue,
  advance,
  calibrateHatchThreshold,
  hasDamaging,
  initialState,
  mulberry32,
  progress,
  rarityOf,
  rename,
  starterMove,
  tokensForRetirement,
  tokensForStage,
} from '../server/game.ts';
import { canLearn, moveById } from '../server/moves.ts';
import { NATURES, NATURE_KO } from '../server/species.ts';

describe('rarityOf', () => {
  it('maps real capture rates to buckets', () => {
    expect(rarityOf(255)).toBe('common'); // rattata
    expect(rarityOf(190)).toBe('common'); // pichu
    expect(rarityOf(180)).toBe('uncommon'); // machop
    expect(rarityOf(45)).toBe('rare'); // bulbasaur
    expect(rarityOf(3)).toBe('legendary'); // mewtwo
  });
});

describe('calibrateHatchThreshold', () => {
  it('averages the chronologically latest active days', () => {
    // Deliberately out of order: byDay is built in file-scan order, so relying
    // on object insertion order picks arbitrary days. This is a regression test
    // for exactly that bug.
    const byDay = {
      '2026-08-21': 300_000_000,
      '2026-07-01': 1_000,
      '2026-08-20': 300_000_000,
      '2026-07-02': 1_000,
      '2026-08-19': 300_000_000,
      '2026-07-03': 1_000,
      '2026-08-18': 300_000_000,
      '2026-07-04': 1_000,
      '2026-08-17': 300_000_000,
      '2026-07-05': 1_000,
      '2026-08-16': 300_000_000,
      '2026-07-06': 1_000,
      '2026-08-15': 300_000_000,
    };
    // Latest 7 are all 300M → 300M * 0.15 = 45M.
    expect(calibrateHatchThreshold(byDay)).toBe(45_000_000);
  });

  it('clamps to the 2M..50M range', () => {
    expect(calibrateHatchThreshold({ '2026-08-21': 1_000_000_000 })).toBe(50_000_000);
    expect(calibrateHatchThreshold({ '2026-08-21': 1_000 })).toBe(2_000_000);
  });

  it('ignores idle days so long gaps do not deflate the average', () => {
    expect(calibrateHatchThreshold({ a: 0, b: 0, '2026-08-21': 100_000_000 })).toBe(15_000_000);
  });

  it('falls back when there is no history at all', () => {
    expect(calibrateHatchThreshold({})).toBe(5_000_000);
  });
});

describe('accrue', () => {
  const roll = (state: ReturnType<typeof initialState>, ...totals: number[]) =>
    totals.reduce((s, t) => accrue(s, t).state, state);

  it('anchors on the corpus it first sees instead of banking it', () => {
    const { state, changed } = accrue(initialState(), 1_688_712_177);
    expect(changed).toBe(true);
    expect(state.lifetimeEarned).toBe(0);
    expect(state.lastTotal.activity).toBe(1_688_712_177);
  });

  it('banks only what arrives after the anchor', () => {
    const s = roll(initialState(), 1_000_000_000, 1_000_000_500, 1_000_002_000);
    expect(s.lifetimeEarned).toBe(2_000);
  });

  it('keeps counting after Claude Code prunes old transcripts', () => {
    // The bug this replaced: totals fell ~288M below the install baseline, so
    // `max(0, total - baseline)` pinned earned at 0 and the pet froze forever
    // while the tray — which never consults the baseline — looked fine.
    const anchored = roll(initialState(), 1_800_000_000, 1_850_000_000);
    expect(anchored.lifetimeEarned).toBe(50_000_000);

    const pruned = accrue(anchored, 1_518_336_155).state;
    expect(pruned.lifetimeEarned).toBe(50_000_000); // never walks backwards
    expect(pruned.lastTotal.activity).toBe(1_518_336_155); // re-anchored, not stuck

    // The very next token counts, rather than 288M of catching up first.
    expect(accrue(pruned, 1_518_337_155).state.lifetimeEarned).toBe(50_001_000);
  });

  it('is a no-op when nothing was burned since the last poll', () => {
    const s = accrue(initialState(), 500).state;
    const again = accrue(s, 500);
    expect(again.changed).toBe(false);
    expect(again.state).toBe(s); // same object: nothing to persist
  });

  it('keeps a separate anchor per count mode', () => {
    // billable is ~5% of activity. One shared anchor would book the whole
    // difference as earnings the first time someone switched back.
    let s = accrue(initialState(), 1_000_000_000, 'activity').state;
    s = accrue(s, 50_000_000, 'billable').state;
    expect(s.lifetimeEarned).toBe(0);
    s = accrue(s, 1_000_100_000, 'activity').state;
    expect(s.lifetimeEarned).toBe(100_000);
  });
});

describe('advance', () => {
  const base = () => ({ ...initialState(), hatchThreshold: 1_000_000 });

  /**
   * The partner tab shows "what has THIS one brought in", and neither hunt
   * counter can answer that alone — both are lifetime totals that graduation
   * does not reset. So a hatch snapshots them.
   */
  it('snapshots the hunt counters at hatch, so a new companion starts at zero', () => {
    const s = { ...base(), huntTokens: 5_000_000, huntCount: 300 };
    const { state } = advance(s, 1_000_000, mulberry32(1));
    expect(state.active).not.toBeNull();
    expect(state.active!.huntTokensAtBirth).toBe(5_000_000);
    expect(state.active!.huntCountAtBirth).toBe(300);
    // The counters themselves are untouched — only a baseline was recorded.
    expect(state.huntTokens).toBe(5_000_000);
    expect(state.huntCount).toBe(300);
  });

  it('carries the baseline through an evolution', () => {
    // The evolve branch spreads the companion, so this is really a guard
    // against someone rebuilding it as a literal later.
    const s = { ...base(), huntTokens: 7, huntCount: 9 };
    const hatched = advance(s, 1_000_000, mulberry32(1)).state;
    const grown = advance(hatched, 500_000_000, mulberry32(2)).state;
    if (grown.active && grown.active.stageIndex > 0) {
      expect(grown.active.huntCountAtBirth).toBe(9);
    }
  });

  it('stays an egg below the threshold', () => {
    const { state, events } = advance(base(), 999_999, mulberry32(1));
    expect(state.active).toBeNull();
    expect(events).toEqual([]);
  });

  it('hatches at the threshold', () => {
    const { state, events } = advance(base(), 1_000_000, mulberry32(1));
    expect(state.active).not.toBeNull();
    expect(events[0].kind).toBe('hatched');
    expect(state.active!.stageIndex).toBe(0);
  });

  it('is deterministic for a given seed', () => {
    const a = advance(base(), 1_000_000, mulberry32(42));
    const b = advance(base(), 1_000_000, mulberry32(42));
    expect(a.state.active!.pathIds).toEqual(b.state.active!.pathIds);
    expect(a.state.active!.isShiny).toBe(b.state.active!.isShiny);
  });

  it('commits to a single branch of a branching line', () => {
    const { state } = advance(base(), 1_000_000, mulberry32(7));
    const p = state.active!.pathIds;
    expect(p.length).toBeGreaterThanOrEqual(1);
    expect(p.length).toBeLessThanOrEqual(3);
    expect(new Set(p).size).toBe(p.length); // no repeats
  });

  it('crosses several thresholds at once after a long gap', () => {
    // App closed for a week: one call must catch the companion all the way up.
    const { events } = advance(base(), 500_000_000, mulberry32(3));
    expect(events.length).toBeGreaterThan(1);
    expect(events.some((e) => e.kind === 'hatched')).toBe(true);
  });

  it('retires into the dex and lays a fresh egg', () => {
    const { state, events } = advance(base(), 2_000_000_000, mulberry32(5));
    expect(events.some((e) => e.kind === 'retired')).toBe(true);
    expect(state.dex.length).toBeGreaterThan(0);
    expect(state.retiredCount).toBeGreaterThan(0);
  });

  it('never spins forever on a degenerate threshold', () => {
    const s = { ...base(), hatchThreshold: 0 };
    const t0 = Date.now();
    advance(s, 1_000_000, mulberry32(1));
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('natures', () => {
  const H = 1_000_000;

  it('carries all twenty-five, each with a Korean name', () => {
    expect(NATURES).toHaveLength(25);
    expect(new Set(NATURES).size).toBe(25);
    for (const n of NATURES) {
      // Generated from PokeAPI, so a missing one means the table rotted rather
      // than that someone forgot to type it in.
      expect(NATURE_KO[n], n).toMatch(/^[가-힣]+$/);
    }
  });

  it('keeps every nature an older save might be holding', () => {
    // The hand-written list this replaced. A save carrying one of these must
    // still resolve, which is why no migration was needed.
    const before = [
      'hardy', 'brave', 'relaxed', 'timid', 'jolly', 'calm',
      'bold', 'gentle', 'quirky', 'naughty', 'modest', 'sassy',
    ];
    for (const n of before) expect(NATURES, n).toContain(n);
  });

  it('deals a spread of them rather than the same one every time', () => {
    // The report that started this was "every Pokemon is sassy". The roll was
    // fine; the list was half missing. This is the guard for both.
    const seen = new Map<string, number>();
    for (let k = 0; k < 1200; k++) {
      const { state } = advance({ ...initialState(), hatchThreshold: H }, H, mulberry32(k));
      const n = state.active!.nature;
      seen.set(n, (seen.get(n) ?? 0) + 1);
    }
    expect(seen.size).toBe(NATURES.length);
    // Nothing runs away with it: a uniform draw over 1200 puts each near 48.
    expect(Math.max(...seen.values())).toBeLessThan(1200 / NATURES.length * 2);
  });
});

describe('starterMove', () => {
  const H = 1_000_000;

  it('is always something the species could actually be taught', () => {
    for (let id = 1; id <= 1025; id++) {
      const m = starterMove(id);
      if (m === null) continue;
      expect(canLearn(id, m), `${id}`).toBe(true);
      expect(moveById(m)!.damageClass, `${id}`).not.toBe('status');
      expect(moveById(m)!.power).toBeGreaterThan(0);
    }
  });

  it('prefers the species own type, and the gentlest one at that', () => {
    // Bulbasaur, Charmander, Squirtle — the weakest STAB attack each can learn.
    expect(moveById(starterMove(1)!)!.type).toBe('grass');
    expect(moveById(starterMove(4)!)!.type).toBe('fire');
    expect(moveById(starterMove(7)!)!.type).toBe('water');
    // Nothing starts with a finisher.
    let heavy = 0;
    for (let id = 1; id <= 1025; id++) {
      const m = starterMove(id);
      if (m !== null && moveById(m)!.power > 80) heavy++;
    }
    // Magikarp and four others whose whole machine pool is heavy. See the docs.
    expect(heavy).toBeLessThanOrEqual(5);
  });

  it('gives up on the species that genuinely cannot learn an attack', () => {
    // Ditto learns nothing; Wobbuffet learns only status moves.
    expect(starterMove(132)).toBeNull();
    expect(starterMove(202)).toBeNull();
    let none = 0;
    for (let id = 1; id <= 1025; id++) if (starterMove(id) === null) none++;
    expect(none).toBe(13);
  });

  it('hatches every companion with something that hits', () => {
    for (let seed = 0; seed < 200; seed++) {
      const { state } = advance({ ...initialState(), hatchThreshold: H }, H, mulberry32(seed));
      const a = state.active!;
      // Only the thirteen may come out unarmed, and the battle covers those.
      if (starterMove(a.pathIds[0]) === null) continue;
      expect(hasDamaging(a.moves), `seed ${seed}`).toBe(true);
      expect(a.moves).toHaveLength(1);
    }
  });
});

describe('rename', () => {
  const H = 1_000_000;
  const hatched = () => advance({ ...initialState(), hatchThreshold: H }, H, mulberry32(3)).state;

  it('sets a nickname and leaves the source state alone', () => {
    const s = hatched();
    const r = rename(s, 'REO');
    expect(r.ok).toBe(true);
    expect(r.state.active!.nickname).toBe('REO');
    expect(s.active!.nickname).toBeUndefined();
  });

  it('trims surrounding whitespace', () => {
    expect(rename(hatched(), '  REO  ').state.active!.nickname).toBe('REO');
  });

  it('truncates to the twelve characters the games allow', () => {
    const long = 'abcdefghijklmnopqrstuvwxyz';
    const got = rename(hatched(), long).state.active!.nickname!;
    expect(got).toHaveLength(NICKNAME_MAX);
    expect(got).toBe(long.slice(0, NICKNAME_MAX));
  });

  it('counts an emoji as one character, not two surrogate halves', () => {
    const fire = String.fromCodePoint(0x1f525);
    const got = rename(hatched(), fire.repeat(20)).state.active!.nickname!;
    expect([...got]).toHaveLength(NICKNAME_MAX);
  });

  it('strips control characters instead of refusing the whole name', () => {
    const dirty = `a${String.fromCharCode(7)}b${String.fromCharCode(0)} c`;
    expect(rename(hatched(), dirty).state.active!.nickname).toBe('ab c');
  });

  it('clears the nickname on an empty string', () => {
    const named = rename(hatched(), 'REO').state;
    const cleared = rename(named, '   ');
    expect(cleared.ok).toBe(true);
    expect(cleared.state.active!.nickname).toBeUndefined();
    // Clearing something that was never set is a no-op, not a success.
    expect(rename(cleared.state, '').ok).toBe(false);
  });

  it('refuses the same name and takes nothing', () => {
    const named = rename(hatched(), 'REO').state;
    const again = rename(named, 'REO');
    expect(again.ok).toBe(false);
    expect(again.state).toBe(named);
  });

  it('refuses while there is no companion', () => {
    const r = rename(initialState(), 'REO');
    expect(r.ok).toBe(false);
    expect(r.state.active).toBeNull();
  });

  it('follows the companion into the dex on graduation', () => {
    // The name it had when it left is part of the memento.
    let s = rename(hatched(), 'REO').state;
    const need = tokensForRetirement(s.active!.rarity, s.hatchThreshold);
    const far = s.active!.tokensAtStageStart + need + tokensForStage(0, s.active!.rarity, s.hatchThreshold) * 4;
    s = advance(s, far, mulberry32(9)).state;
    expect(s.dex.some((d) => d.nickname === 'REO')).toBe(true);
  });
});

describe('progress', () => {
  it('reports egg progress before hatching', () => {
    const p = progress({ ...initialState(), hatchThreshold: 1_000_000 }, 250_000);
    expect(p.phase).toBe('egg');
    expect(p.ratio).toBeCloseTo(0.25);
  });

  it('never exceeds 1', () => {
    const p = progress({ ...initialState(), hatchThreshold: 1_000 }, 10_000_000);
    expect(p.ratio).toBe(1);
  });
});

describe('tokensForStage', () => {
  it('gets longer each stage and scales with rarity', () => {
    expect(tokensForStage(1, 'common', 1_000_000)).toBeGreaterThan(
      tokensForStage(0, 'common', 1_000_000),
    );
    expect(tokensForStage(0, 'legendary', 1_000_000)).toBeGreaterThan(
      tokensForStage(0, 'common', 1_000_000),
    );
  });
});
