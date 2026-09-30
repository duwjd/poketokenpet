import { describe, expect, it } from 'vitest';
import { advance, initialState, mulberry32, type GameState } from '../server/game.ts';
import { HUNT_INTERVAL_MS, MAX_TURNS, encounterAt, hunt } from '../server/hunt.ts';
import { speciesInfo } from '../server/moves.ts';
import {
  TRAINER_CHANCE,
  trainerAt,
  trainerBattleAt,
  trainerReward,
  type Trainer,
} from '../server/trainer.ts';
import { gymAt } from '../server/gyms.ts';

const H = 10_000_000;
const T0 = 1_700_000_000_000;
/** Four real machine moves: Hyper Beam, Flamethrower, Earthquake, Thunder. */
const TAUGHT = [63, 53, 89, 87];

const base = (over: Partial<GameState> = {}): GameState => ({
  ...initialState(),
  hatchThreshold: H,
  ...over,
});

const hunting = (over: Partial<GameState> = {}): GameState => {
  const hatched = advance(base({ lifetimeEarned: H }), H, mulberry32(1)).state;
  return { ...hatched, lifetimeEarned: 1_000_000_000, huntedAt: T0, ...over };
};

/** The first encounter index at or after `from` that is a trainer. */
const findTrainer = (from = 0) => {
  for (let k = from; k < from + 5000; k++) if (trainerAt(k)) return k;
  throw new Error('no trainer found');
};

describe('trainerAt', () => {
  it('is a pure function of the encounter index', () => {
    for (const k of [0, 7, 41, 5000]) expect(trainerAt(k)).toEqual(trainerAt(k));
  });

  it('does not disturb the wild encounter stream', () => {
    // The single most important test here. A trainer roll drawn from the
    // encounter's own RNG would shift every later draw, silently rewriting
    // which Pokemon every past encounter met.
    for (let k = 0; k < 20_000; k++) {
      const before = encounterAt(k, 668, H);
      trainerAt(k);
      trainerReward(k, { className: 'x', name: 'x', gender: 'm', sprite: 'x', team: [1], grit: 1 });
      expect(encounterAt(k, 668, H), `seq ${k}`).toEqual(before);
    }
  });

  it('turns up about as often as advertised', () => {
    let hits = 0;
    const N = 50_000;
    for (let k = 0; k < N; k++) if (trainerAt(k)) hits++;
    expect(hits / N).toBeGreaterThan(TRAINER_CHANCE * 0.85);
    expect(hits / N).toBeLessThan(TRAINER_CHANCE * 1.15);
  });

  it('fields a team of the size its class calls for', () => {
    const sizes = new Set<number>();
    for (let k = 0; k < 20_000; k++) {
      const t = trainerAt(k);
      if (!t) continue;
      expect(t.team.length, t.name).toBeGreaterThanOrEqual(1);
      expect(t.team.length, t.name).toBeLessThanOrEqual(3);
      sizes.add(t.team.length);
      for (const id of t.team) expect(speciesInfo(id), `${t.name} #${id}`).not.toBeNull();
    }
    expect([...sizes].sort()).toEqual([1, 2, 3]);
  });

  it('leans on the types its class is named for', () => {
    // A Fisherman fielding Water is what makes the type chart bite. It is a
    // lean, not a guarantee — the roll settles after a dozen tries.
    let water = 0;
    let total = 0;
    for (let k = 0; k < 40_000; k++) {
      const t = trainerAt(k);
      if (t?.className !== '낚시꾼') continue;
      for (const id of t.team) {
        total++;
        if ((speciesInfo(id)?.types ?? []).includes('water')) water++;
      }
    }
    expect(total).toBeGreaterThan(50);
    expect(water / total).toBeGreaterThan(0.5);
  });

  it('names a sprite ensureNpcSprite will actually accept', () => {
    // The slug goes into a URL and into a cache filename, and sprites.ts drops
    // anything outside this shape on the floor — silently, as a cosmetic miss.
    // A typo in the class table would cost the portrait and say nothing.
    const seen = new Set<string>();
    for (let k = 0; k < 40_000; k++) {
      const t = trainerAt(k);
      if (!t) continue;
      expect(t.sprite, t.name).toMatch(/^[a-z0-9-]+$/);
      seen.add(t.sprite);
    }
    // Twenty classes, five of which field both genders.
    expect(seen.size).toBe(25);
  });

  it('fields both men and women, and never mixes up whose name is whose', () => {
    // The pools used to be one mixed list, which is how `미니스커트 도현`
    // happened. Checked without importing the pools: if a given name ever turns
    // up under both genders, they are not split.
    const byGender = { m: new Set<string>(), f: new Set<string>() };
    const classGenders = new Map<string, Set<string>>();
    for (let k = 0; k < 40_000; k++) {
      const t = trainerAt(k);
      if (!t) continue;
      byGender[t.gender].add(t.name.slice(t.className.length + 1));
      if (!classGenders.has(t.className)) classGenders.set(t.className, new Set());
      classGenders.get(t.className)!.add(t.gender);
    }
    expect(byGender.m.size).toBeGreaterThan(20);
    expect(byGender.f.size).toBeGreaterThan(20);
    for (const given of byGender.m) expect(byGender.f.has(given), given).toBe(false);

    // A class whose name is gendered gets one gender; one that is not gets both.
    expect([...(classGenders.get('미니스커트') ?? [])]).toEqual(['f']);
    expect([...(classGenders.get('짧은바지 꼬마') ?? [])]).toEqual(['m']);
    expect([...(classGenders.get('엘리트 트레이너') ?? [])].sort()).toEqual(['f', 'm']);
  });

  it('keeps every name inside the message box', () => {
    // Scene.tsx builds its reward lines on "the longest trainer name is eleven
    // characters" — past that the payout folds onto a second row. It is the
    // reason every given name in the pools is two syllables.
    for (let k = 0; k < 40_000; k++) {
      const t = trainerAt(k);
      if (!t) continue;
      expect(t.name.length, t.name).toBeLessThanOrEqual(11);
    }
  });

  it('still fills a team for a class with no type preference', () => {
    let checked = 0;
    for (let k = 0; k < 20_000 && checked < 20; k++) {
      const t = trainerAt(k);
      if (t?.className !== '베테랑') continue;
      checked++;
      expect(t.team).toHaveLength(3);
      expect(new Set(t.team).size).toBeGreaterThan(0);
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('trainerBattleAt', () => {
  it('fells every one of the team when it wins', () => {
    for (let k = 0; k < 3000; k++) {
      const t = trainerAt(k);
      if (!t) continue;
      const b = trainerBattleAt(k, t, TAUGHT);
      if (!b.won) continue;
      expect(b.lostAt).toBeNull();
      // Every one of the team goes down, each exactly once. A 유턴 can add a
      // round without anybody falling, so rounds can outnumber the team.
      const downs = b.rounds.filter((r) => r.exit === 'foe-down').map((r) => r.foeSlot);
      expect(downs.sort(), t.name).toEqual(t.team.map((_, i) => i));
      expect(b.rounds.length).toBeGreaterThanOrEqual(t.team.length);
    }
  });

  it('carries HP from one round into the next', () => {
    const k = findTrainer();
    const t = trainerAt(k)!;
    if (t.team.length < 2) return;
    const b = trainerBattleAt(k, t, TAUGHT, 6);
    for (let i = 1; i < b.rounds.length; i++) {
      const prev = b.rounds[i - 1];
      // The round opens exactly where the last ended — never a fresh bar —
      // and so does whatever condition the companion was carrying.
      expect(b.rounds[i].myStartHp).toBe(prev.turns.at(-1)!.myHpAfter);
      // Sleep and freeze can lift on their own; the other three never do.
      const carried = prev.myStatusAfter;
      if (carried && carried !== 'sleep' && carried !== 'freeze') {
        expect(b.rounds[i].turns[0].myStatus).toBe(carried);
      }
    }
  });

  it('can actually be lost', () => {
    let lost = 0;
    let fought = 0;
    for (let k = 0; k < 20_000; k++) {
      const t = trainerAt(k);
      if (!t) continue;
      fought++;
      // Nothing taught: the companion swings for TACKLE and takes the full ride.
      if (!trainerBattleAt(k, t, []).won) lost++;
    }
    expect(fought).toBeGreaterThan(100);
    expect(lost).toBeGreaterThan(0);
  });

  it('rewards a taught moveset with wins a bare one does not get', () => {
    // This is the whole point of the feature: TMs have to matter.
    const rate = (moves: number[]) => {
      let won = 0;
      let n = 0;
      for (let k = 0; k < 20_000; k++) {
        const t = trainerAt(k);
        if (!t || t.team.length < 3) continue;
        n++;
        if (trainerBattleAt(k, t, moves).won) won++;
      }
      return won / n;
    };
    expect(rate(TAUGHT)).toBeGreaterThan(rate([]) + 0.3);
  });

  it('stops as soon as the companion goes down', () => {
    for (let k = 0; k < 20_000; k++) {
      const t = trainerAt(k);
      if (!t) continue;
      const b = trainerBattleAt(k, t, []);
      if (b.won) continue;
      expect(b.lostAt).not.toBeNull();
      const last = b.rounds.at(-1)!;
      expect(b.lostAt).toBe(last.foeSlot);
      // Nothing after the round it went down in.
      expect(['me-down', 'both-down', 'stall']).toContain(last.exit);
    }
  });

  it('keeps each round inside the turn cap', () => {
    for (let k = 0; k < 5000; k++) {
      const t = trainerAt(k);
      if (!t) continue;
      for (const r of trainerBattleAt(k, t, TAUGHT, 6).rounds) {
        expect(r.turns.length).toBeGreaterThan(0);
        expect(r.turns.length).toBeLessThanOrEqual(MAX_TURNS);
      }
    }
  });
});

describe('trainerReward', () => {
  it('never hands over a Rare Candy', () => {
    // A free candy credits bonusTokens, and huntCap only caps huntTokens — it
    // would walk straight around the hunting ceiling.
    for (let k = 0; k < 20_000; k++) {
      const t = trainerAt(k);
      if (!t) continue;
      const item = trainerReward(k, t).item;
      expect(item === null || item === 'shiny-charm' || item === 'everstone').toBe(true);
    }
  });

  it('pays more for a bigger team', () => {
    const t1: Trainer = { className: 'a', name: 'a', gender: 'm', sprite: 'a', team: [1], grit: 1 };
    const t3: Trainer = { ...t1, team: [1, 2, 3] };
    expect(trainerReward(5, t3).payout).toBeGreaterThan(trainerReward(5, t1).payout);
  });

  it('hands over an item now and then, not every time', () => {
    let items = 0;
    let n = 0;
    for (let k = 0; k < 20_000; k++) {
      const t = trainerAt(k);
      if (!t) continue;
      n++;
      if (trainerReward(k, t).item) items++;
    }
    expect(items / n).toBeGreaterThan(0.15);
    expect(items / n).toBeLessThan(0.6);
  });
});

describe('trainers inside hunt()', () => {
  /** Settle enough encounters to be sure of catching a trainer. */
  const settle = (s: GameState, n: number) => hunt(s, T0 + n * HUNT_INTERVAL_MS).state;

  it('records the trainer on the log entry', () => {
    const start = findTrainer(0);
    const s = settle(hunting({ huntCount: start }), 1);
    const entry = s.huntLog[0];
    expect(entry.trainer).toBeTruthy();
    expect(entry.trainer!.name).toBeTruthy();
    expect(entry.trainer!.team.length).toBeGreaterThan(0);
    // The first team member stands in as the entry's headline species.
    expect(entry.wildId).toBe(entry.trainer!.team[0]);
  });

  it('consumes the encounter whether it was won or lost', () => {
    const start = findTrainer(0);
    const s = settle(hunting({ huntCount: start }), 1);
    expect(s.huntCount).toBe(start + 1);
  });

  it('pays nothing for a loss', () => {
    let checked = 0;
    for (let k = 0; k < 4000 && checked < 5; k++) {
      const t = trainerAt(k);
      if (!t) continue;
      // A bare companion loses often; find one it actually lost.
      const s = hunting({ huntCount: k });
      s.active!.moves = [];
      const after = settle(s, 1);
      const entry = after.huntLog[0];
      if (entry.trainer?.won !== false) continue;
      checked++;
      expect(entry.tokens).toBe(0);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('puts a won item straight into the bag', () => {
    let checked = 0;
    for (let k = 0; k < 6000 && checked < 3; k++) {
      const t = trainerAt(k);
      if (!t || !trainerReward(k, t).item) continue;
      // A gym leader standing at the same encounter takes it, and hands over a
      // badge rather than a route trainer's prize. Rare, but it happens — and
      // it happened here the first time the route was regenerated.
      if (gymAt(k, new Set())) continue;
      const s = hunting({ huntCount: k });
      s.active!.moves = [...TAUGHT];
      const after = settle(s, 1);
      const entry = after.huntLog[0];
      if (!entry.trainer?.won) continue;
      checked++;
      const item = entry.trainer.item!;
      expect(after.inventory[item]).toBe(1);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('respects the hunting cap', () => {
    // Items sit outside the cap because they are not progress, but tokens do not.
    const start = findTrainer(0);
    const poor = hunting({ huntCount: start, lifetimeEarned: 0 });
    let s = poor;
    for (let i = 1; i <= 200; i++) s = hunt(s, T0 + i * 96 * HUNT_INTERVAL_MS).state;
    expect(s.huntTokens).toBeLessThanOrEqual(H * 3);
   }, 30_000);

  it('stays idempotent, trainers included', () => {
    // Two processes settling the same range must agree, or the replay the whole
    // hunt design rests on is broken.
    const s = hunting({ huntCount: findTrainer(0) });
    const at = T0 + 30 * HUNT_INTERVAL_MS;
    expect(hunt(s, at).state).toEqual(hunt(s, at).state);
  });
});
