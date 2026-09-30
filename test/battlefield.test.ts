import { describe, expect, it } from 'vitest';
import {
  COMPANION_FRIENDSHIP,
  DEFAULT_FRIENDSHIP,
  fieldBlocks,
  grounded,
  powerOf,
  terrainPowerMult,
  weatherAccuracy,
  weatherBallType,
  weatherChips,
  weatherDefenceMult,
  weatherHealShare,
  weatherPowerMult,
  type PowerContext,
  type PowerSide,
} from '../server/battlefield.ts';
import { moveById } from '../server/moves.ts';

const side = (over: Partial<PowerSide> = {}): PowerSide => ({
  hp: 100,
  maxHp: 100,
  speed: 100,
  weightKg: 50,
  status: null,
  boosts: 0,
  friendship: DEFAULT_FRIENDSHIP,
  ...over,
});

const ctx = (over: Partial<PowerContext> = {}): PowerContext => ({
  user: side(),
  target: side(),
  weather: null,
  targetMovedFirst: false,
  userWasHit: false,
  streak: 1,
  ...over,
});

const power = (id: number, over: Partial<PowerContext> = {}) => powerOf(moveById(id)!, ctx(over), 50, 40);

describe('weather', () => {
  it('boosts and cuts fire and water, and nothing else', () => {
    expect(weatherPowerMult('rain', 'water')).toBe(1.5);
    expect(weatherPowerMult('rain', 'fire')).toBe(0.5);
    expect(weatherPowerMult('sun', 'fire')).toBe(1.5);
    expect(weatherPowerMult('sun', 'water')).toBe(0.5);
    expect(weatherPowerMult('sand', 'rock')).toBe(1);
    expect(weatherPowerMult(null, 'water')).toBe(1);
  });

  it('makes 번개 and 폭풍 sure in rain and shaky in sun, and 눈보라 sure in hail or snow', () => {
    expect(weatherAccuracy('rain', 87)).toBe(0);
    expect(weatherAccuracy('sun', 87)).toBe(50);
    expect(weatherAccuracy('rain', 542)).toBe(0);
    expect(weatherAccuracy('hail', 59)).toBe(0);
    expect(weatherAccuracy('snow', 59)).toBe(0);
    expect(weatherAccuracy('rain', 59)).toBeNull();
    expect(weatherAccuracy(null, 87)).toBeNull();
  });

  it('chips everything but the types the weather spares', () => {
    expect(weatherChips('sand', ['normal'])).toBe(true);
    expect(weatherChips('sand', ['rock'])).toBe(false);
    expect(weatherChips('sand', ['ground', 'flying'])).toBe(false);
    expect(weatherChips('sand', ['steel'])).toBe(false);
    expect(weatherChips('hail', ['water'])).toBe(true);
    expect(weatherChips('hail', ['ice', 'water'])).toBe(false);
    // Rain, sun and snow hurt nobody.
    expect(weatherChips('rain', ['fire'])).toBe(false);
    expect(weatherChips('snow', ['fire'])).toBe(false);
  });

  it('hardens a Rock type in sand and an Ice type in snow', () => {
    expect(weatherDefenceMult('sand', ['rock'], false)).toBe(1.5);
    expect(weatherDefenceMult('sand', ['rock'], true)).toBe(1);
    expect(weatherDefenceMult('snow', ['ice'], true)).toBe(1.5);
    expect(weatherDefenceMult('snow', ['ice'], false)).toBe(1);
    expect(weatherDefenceMult('hail', ['ice'], true)).toBe(1);
  });

  it('turns 웨더볼 into the weather', () => {
    expect(weatherBallType('rain')).toBe('water');
    expect(weatherBallType('sun')).toBe('fire');
    expect(weatherBallType('sand')).toBe('rock');
    expect(weatherBallType('snow')).toBe('ice');
    expect(power(311, { weather: 'rain' })).toEqual({ power: 100, fixed: null, type: 'water' });
    expect(power(311)).toEqual({ power: 50, fixed: null, type: 'normal' });
  });

  it('halves 솔라빔 under any weather but sun', () => {
    expect(power(76).power).toBe(120);
    expect(power(76, { weather: 'sun' }).power).toBe(120);
    expect(power(76, { weather: 'rain' }).power).toBe(60);
    expect(power(76, { weather: 'sand' }).power).toBe(60);
  });

  it('lets the weather decide what 광합성 heals', () => {
    const synthesis = moveById(235);
    if (!synthesis) return; // not a machine move in every data set
    expect(weatherHealShare(synthesis, 'sun')).toBeCloseTo(2 / 3);
    expect(weatherHealShare(synthesis, 'rain')).toBe(1 / 4);
    expect(weatherHealShare(synthesis, null)).toBe(1 / 2);
  });
});

describe('terrain', () => {
  const eq = moveById(89)!;
  it('boosts the grounded attacker only', () => {
    expect(terrainPowerMult('electric', null, 'electric', true, true)).toBe(1.3);
    expect(terrainPowerMult('electric', null, 'electric', false, true)).toBe(1);
    expect(terrainPowerMult('grassy', null, 'grass', true, true)).toBe(1.3);
    expect(terrainPowerMult('psychic', null, 'psychic', true, false)).toBe(1.3);
  });

  it('cuts dragon moves and Earthquake on a grounded target', () => {
    expect(terrainPowerMult('misty', null, 'dragon', true, true)).toBe(0.5);
    expect(terrainPowerMult('misty', null, 'dragon', true, false)).toBe(1);
    expect(terrainPowerMult('grassy', eq, 'ground', true, true)).toBe(0.5);
  });

  it('keeps conditions off the grounded, and sun keeps freeze off everyone', () => {
    expect(fieldBlocks('sun', null, 'freeze', false, true)).toBe(true);
    expect(fieldBlocks(null, 'electric', 'sleep', true, true)).toBe(true);
    expect(fieldBlocks(null, 'electric', 'sleep', false, true)).toBe(false);
    expect(fieldBlocks(null, 'misty', 'burn', true, true)).toBe(true);
    expect(fieldBlocks(null, 'misty', 'confusion', true, false)).toBe(true);
    expect(fieldBlocks(null, 'misty', 'burn', false, true)).toBe(false);
    expect(fieldBlocks(null, null, 'burn', true, true)).toBe(false);
  });

  it('treats only Flying types as off the ground', () => {
    expect(grounded(['normal'])).toBe(true);
    expect(grounded(['water', 'flying'])).toBe(false);
  });
});

describe('powerOf', () => {
  it('deals level-sized damage for 지구던지기 and 나이트헤드', () => {
    expect(power(69)).toEqual({ power: 0, fixed: 50, type: 'fighting' });
    expect(power(101).fixed).toBe(50);
  });

  it('halves the target for 분노의앞니 and evens it out for 죽기살기', () => {
    expect(power(162, { target: side({ hp: 90 }) }).fixed).toBe(45);
    expect(power(283, { user: side({ hp: 20 }), target: side({ hp: 90 }) }).fixed).toBe(70);
    expect(power(283, { user: side({ hp: 95 }), target: side({ hp: 90 }) }).fixed).toBe(0);
  });

  it('weighs the target for 안다리걸기 and the pair for 헤비봄버', () => {
    expect(power(67, { target: side({ weightKg: 6 }) }).power).toBe(20);
    expect(power(67, { target: side({ weightKg: 460 }) }).power).toBe(120);
    expect(power(484, { user: side({ weightKg: 400 }), target: side({ weightKg: 50 }) }).power).toBe(120);
    expect(power(484, { user: side({ weightKg: 50 }), target: side({ weightKg: 50 }) }).power).toBe(40);
  });

  it('rewards the slower side with 자이로볼 and the faster with 일렉트릭볼', () => {
    expect(power(360, { user: side({ speed: 35 }), target: side({ speed: 135 }) }).power).toBe(97);
    expect(power(360, { user: side({ speed: 10 }), target: side({ speed: 200 }) }).power).toBe(150);
    expect(power(486, { user: side({ speed: 200 }), target: side({ speed: 50 }) }).power).toBe(150);
    expect(power(486, { user: side({ speed: 40 }), target: side({ speed: 50 }) }).power).toBe(40);
  });

  it('grows 기사회생 as HP runs out', () => {
    expect(power(179, { user: side({ hp: 100 }) }).power).toBe(20);
    expect(power(179, { user: side({ hp: 1 }) }).power).toBe(200);
  });

  it('doubles the conditional moves on their condition only', () => {
    expect(power(263).power).toBe(70);
    expect(power(263, { user: side({ status: 'burn' }) }).power).toBe(140);
    expect(power(506, { target: side({ status: 'paralysis' }) }).power).toBe(130);
    expect(power(474, { target: side({ status: 'toxic' }) }).power).toBe(130);
    expect(power(474, { target: side({ status: 'burn' }) }).power).toBe(65);
    expect(power(362, { target: side({ hp: 50 }) }).power).toBe(130);
    expect(power(371, { targetMovedFirst: true }).power).toBe(100);
    expect(power(419, { userWasHit: true }).power).toBe(120);
    expect(power(512).power).toBe(110);
  });

  it('counts stages for 어시스트파워 and streaks for 연속자르기', () => {
    expect(power(500, { user: side({ boosts: 3 }) }).power).toBe(80);
    expect(power(210, { streak: 1 }).power).toBe(40);
    expect(power(210, { streak: 3 }).power).toBe(160);
    expect(power(210, { streak: 5 }).power).toBe(160);
  });

  it('reads friendship for 은혜갚기 and 화풀이', () => {
    const loved = side({ friendship: COMPANION_FRIENDSHIP });
    expect(power(216, { user: loved }).power).toBe(102);
    expect(power(218, { user: loved }).power).toBe(1);
    expect(power(216).power).toBe(28);
    expect(power(218).power).toBe(74);
  });

  it('leaves every other move at its listed power', () => {
    expect(power(89)).toEqual({ power: 100, fixed: null, type: 'ground' });
  });
});
