import { describe, expect, it } from 'vitest';
import {
  MAX_LEVEL,
  advance,
  flipUpsideDown,
  growthBudget,
  initialState,
  levelAt,
  mulberry32,
  progress,
  tokensForLevel,
  tokensForRetirement,
  tokensForStage,
  type Companion,
  type GameState,
} from '../server/game.ts';
import { consumeItem, PRODUCTS, shelved, usableNow } from '../server/shop.ts';
import { evolvesWith, evolvesWithKo, friendshipAt, fullMoonAt, nextEvolutions, phaseAt, ruleKo } from '../server/evolution.ts';
import { EVOLUTIONS } from '../server/species.ts';
import { timeOfDayAt } from '../src/timeOfDay.ts';
import { migrate } from '../server/store.ts';

const H = 1000;
/** Noon and midnight, local time — the evolutions that read the clock see these. */
const NOON = new Date(2024, 5, 1, 12);
const MIDNIGHT = new Date(2024, 5, 1, 23);

const companion = (pathIds: number[], over: Partial<Companion> = {}): Companion => ({
  pathIds,
  stageIndex: 0,
  isShiny: false,
  rarity: 'common',
  nature: 'hardy',
  bornAt: 0,
  tokensAtStageStart: 0,
  level: 1,
  moves: [],
  ...over,
});
const withCompanion = (a: Companion, over: Partial<GameState> = {}): GameState => ({
  ...initialState(),
  hatchThreshold: H,
  eggStartedAt: -H,
  active: a,
  ...over,
});
/** Lifetime tokens at which this companion stands at `level`. */
const at = (s: GameState, level: number) => tokensForLevel(level, growthBudget(s.active!.pathIds, s.active!.rarity, H));
const grow = (s: GameState, level: number, now = NOON) => advance(s, at(s, level), mulberry32(1), now).state;

describe('levels', () => {
  it('run from 1 at hatch to 100 at graduation, over what raising one always cost', () => {
    const budget = growthBudget([4, 5, 6], 'common', H);
    expect(budget).toBe(tokensForStage(0, 'common', H) + tokensForStage(1, 'common', H) + tokensForRetirement('common', H));
    expect(levelAt(0, budget)).toBe(1);
    expect(levelAt(budget - 1, budget)).toBe(MAX_LEVEL - 1);
    expect(levelAt(budget, budget)).toBe(MAX_LEVEL);
    for (let lv = 1; lv <= MAX_LEVEL; lv++) expect(levelAt(tokensForLevel(lv, budget), budget)).toBe(lv);
  });

  it('shows the bar as the way to the next level', () => {
    const s = withCompanion(companion([4, 5, 6]));
    const p = progress(s, at(s, 10) + 1);
    expect(p.level).toBe(10);
    expect(p.ratio).toBeGreaterThan(0);
    expect(p.ratio).toBeLessThan(1);
  });

  it('graduates at 100 and carries the overflow into the next egg', () => {
    const s = withCompanion(companion([4, 5, 6], { stageIndex: 2, pathIds: [4, 5, 6], level: 99 }));
    const budget = growthBudget([4, 5, 6], 'common', H);
    const r = advance(s, budget + 5, mulberry32(1)).state;
    expect(r.active).toBeNull();
    expect(r.eggStartedAt).toBe(budget);
    expect(r.dex.map((d) => d.speciesId).sort()).toEqual([4, 5, 6]);
  });

  it('raises friendship five a level from the species\' own', () => {
    expect(friendshipAt(172, 1)).toBe(70);
    expect(friendshipAt(172, 19)).toBe(160);
    expect(friendshipAt(172, 100)).toBe(255);
  });
});

describe('evolving at the games\' own levels', () => {
  it('turns a 파이리 into 리자드 at 16 and 리자몽 at 36', () => {
    let s = withCompanion(companion([4, 5, 6]));
    s = grow(s, 15);
    expect(s.active!.stageIndex).toBe(0);
    s = grow(s, 16);
    expect(s.active!.pathIds[s.active!.stageIndex]).toBe(5);
    s = grow(s, 35);
    expect(s.active!.stageIndex).toBe(1);
    s = grow(s, 36);
    expect(s.active!.pathIds[s.active!.stageIndex]).toBe(6);
  });

  it('crosses both evolutions in one long tick', () => {
    const s = grow(withCompanion(companion([4, 5, 6])), 50);
    expect(s.active!.pathIds[s.active!.stageIndex]).toBe(6);
    expect(s.active!.level).toBe(50);
  });

  it('holds a companion with an everstone: it levels, but neither evolves nor graduates', () => {
    let s = withCompanion(companion([4, 5, 6]), { everstone: true });
    s = grow(s, 40);
    expect(s.active!.stageIndex).toBe(0);
    expect(s.active!.level).toBe(40);
    s = advance(s, growthBudget([4, 5, 6], 'common', H) * 2, mulberry32(1)).state;
    expect(s.active).not.toBeNull();
  });

  it('evolves a save from before levels on its first tick', () => {
    // A 파이리 whose tokens are already worth Lv.40, saved without a level.
    const old = withCompanion(companion([4, 5, 6], { level: undefined }));
    const s = migrate(JSON.parse(JSON.stringify(old)));
    expect(s.active!.level).toBeUndefined();
    const r = advance(s, at(s, 40), mulberry32(1), NOON).state;
    expect(r.active!.pathIds[r.active!.stageIndex]).toBe(6);
  });

  it('never evolves a 피카츄 by level — it takes a 천둥의돌', () => {
    let s = withCompanion(companion([25, 26]));
    s = grow(s, 90);
    expect(s.active!.stageIndex).toBe(0);
    const wrong = consumeItem({ ...s, inventory: { 'fire-stone': 1 } }, 'fire-stone', 0, null, NOON);
    expect(wrong.ok).toBe(false);
    const right = consumeItem({ ...s, inventory: { 'thunder-stone': 1 } }, 'thunder-stone', 0, null, NOON);
    expect(right.ok).toBe(true);
    expect(right.state.active!.pathIds[1]).toBe(26);
    expect(right.state.active!.stageIndex).toBe(1);
    expect(right.state.inventory['thunder-stone']).toBe(0);
  });
});

describe('branches', () => {
  it('lets the stone pick an 이브이\'s branch, whatever branch was drawn', () => {
    const s = withCompanion(companion([133, 135]), { inventory: { 'water-stone': 1 } });
    const r = consumeItem(s, 'water-stone', 0, null, NOON);
    expect(r.ok).toBe(true);
    expect(r.state.active!.pathIds).toEqual([133, 134]);
  });

  it('makes an 이브이 에브이 by day and 블래키 by night once friendship is high', () => {
    const day = grow(withCompanion(companion([133, 134])), 25, NOON);
    expect(day.active!.pathIds[day.active!.stageIndex]).toBe(196);
    const night = grow(withCompanion(companion([133, 134])), 25, MIDNIGHT);
    expect(night.active!.pathIds[night.active!.stageIndex]).toBe(197);
  });

  it('keeps what was settled at hatch: only a 킬리아 drawn toward 엘레이드 takes the 각성의돌', () => {
    const toGallade = withCompanion(companion([280, 281, 475], { stageIndex: 1, level: 20 }), { inventory: { 'dawn-stone': 1 } });
    expect(consumeItem(toGallade, 'dawn-stone', 0, null, NOON).ok).toBe(true);
    const toGardevoir = withCompanion(companion([280, 281, 282], { stageIndex: 1, level: 20 }), { inventory: { 'dawn-stone': 1 } });
    expect(consumeItem(toGardevoir, 'dawn-stone', 0, null, NOON).ok).toBe(false);
  });

  it('needs the party for 타만타: a 총어 in it', () => {
    const alone = grow(withCompanion(companion([458, 226])), 30);
    expect(alone.active!.stageIndex).toBe(0);
    const withRemoraid = grow(
      withCompanion(companion([458, 226]), { party: [{ speciesId: 223, shiny: false, moves: [] }] }),
      30,
    );
    expect(withRemoraid.active!.stageIndex).toBe(1);
  });

  it('turns an 오케이징 only while it is held upside down', () => {
    const plain = grow(withCompanion(companion([686, 687])), 31);
    expect(plain.active!.stageIndex).toBe(0);
    const flipped = flipUpsideDown(withCompanion(companion([686, 687], { level: 30 })), true);
    expect(flipped.ok).toBe(true);
    const r = grow(flipped.state, 31);
    expect(r.active!.stageIndex).toBe(1);
    expect(r.active!.upsideDown).toBe(false);
    // Nothing else asks for it.
    expect(flipUpsideDown(withCompanion(companion([4, 5, 6])), true).ok).toBe(false);
  });
});

describe('the shop and the panel', () => {
  it('shelves every evolution item, so one can be bought ahead for the next partner', () => {
    const stone = PRODUCTS.find((p) => p.id === 'thunder-stone')!;
    expect(shelved(stone, withCompanion(companion([25, 26])))).toBe(true);
    expect(shelved(stone, withCompanion(companion([4, 5, 6])))).toBe(true);
    expect(shelved(stone, { ...initialState(), active: null })).toBe(true);
  });

  it('marks as usable only what this companion\'s next evolution asks for', () => {
    const stone = PRODUCTS.find((p) => p.id === 'thunder-stone')!;
    expect(usableNow(stone, withCompanion(companion([25, 26])))).toBe(true);
    expect(usableNow(stone, withCompanion(companion([4, 5, 6])))).toBe(false);
    expect(usableNow(stone, { ...initialState(), active: null })).toBe(false);
    // Only evolution items are ever "usable now"; a candy is just for sale.
    const candy = PRODUCTS.find((p) => p.id === 'rare-candy')!;
    expect(usableNow(candy, withCompanion(companion([25, 26])))).toBe(false);
  });

  it('says who each evolution item is for', () => {
    expect(evolvesWith('thunder-stone')).toContain(26);
    expect(evolvesWithKo('peat-block')).toBe('다투곰이 이걸로 진화합니다.');
    expect(evolvesWithKo('thunder-stone')).toMatch(/^라이츄·.+ 등 \d+종이 이걸로 진화합니다\.$/);
    // With all forty-one on one shelf, a row nobody is for would be a dead row.
    for (const p of PRODUCTS.filter((x) => x.kind === 'evo')) {
      expect(evolvesWith(p.id).length, p.id).toBeGreaterThan(0);
    }
  });

  it('says what each next evolution needs', () => {
    expect(nextEvolutions([4, 5, 6], 0)).toEqual([{ to: 5, ways: ['Lv.16'] }]);
    expect(nextEvolutions([25, 26], 0)).toEqual([{ to: 26, ways: ['천둥의돌'] }]);
    expect(nextEvolutions([4, 5, 6], 2)).toEqual([]);
    expect(ruleKo({ happiness: 160, time: 'night' })).toBe('친밀도 160 · 밤');
  });

  it('has a rule, in words, for every step of every path', () => {
    for (const rules of Object.values(EVOLUTIONS)) {
      expect(rules.length).toBeGreaterThan(0);
      for (const r of rules) expect(ruleKo(r)).not.toBe('');
    }
  });
});

describe('the clock', () => {
  it('reads the time of day on the scene\'s own boundaries', () => {
    for (let h = 0; h < 24; h++) {
      const d = new Date(2024, 0, 1, h, 30);
      expect(phaseAt(d)).toBe(timeOfDayAt(d));
    }
  });

  it('knows a full moon', () => {
    expect(fullMoonAt(new Date(Date.UTC(2024, 0, 25, 18)))).toBe(true);
    expect(fullMoonAt(new Date(Date.UTC(2024, 0, 11, 12)))).toBe(false);
  });
});
