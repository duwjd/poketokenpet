import { describe, expect, it } from 'vitest';
import { endLines, eventLines, fieldLabel, halfLines, pages, skipLine, statLine, type Half } from '../src/battleText.ts';

const half = (over: Partial<Half> = {}): Half => ({
  moveName: '칼춤',
  skip: null,
  cured: null,
  missed: false,
  ailmentKo: null,
  selfEffect: null,
  effect: 1,
  crit: false,
  events: [],
  ...over,
});

describe('battle text', () => {
  it('words a stage change the way the games do', () => {
    expect(statLine('리자몽', 'atk', 2, 2)).toBe('리자몽의 공격이 크게 올랐다!');
    expect(statLine('리자몽', 'atk', 1, 1)).toBe('리자몽의 공격이 올랐다!');
    expect(statLine('꼬렛', 'def', -2, -2)).toBe('꼬렛의 방어가 크게 떨어졌다!');
    expect(statLine('꼬렛', 'spe', 3, 3)).toBe('꼬렛의 스피드가 매우 크게 올랐다!');
    expect(statLine('리자몽', 'atk', 0, 2)).toBe('리자몽의 공격이 더 올라가지 않는다!');
    expect(statLine('꼬렛', 'def', 0, -1)).toBe('꼬렛의 방어가 더 떨어지지 않는다!');
  });

  it('says the move, then what it did, then everything else', () => {
    const lines = halfLines('리자몽', '꼬렛', half({
      events: [{ k: 'stat', on: 'user', stat: 'atk', delta: 2, tried: 2 }],
    }));
    expect(lines).toEqual(['리자몽의 칼춤!', '리자몽의 공격이 크게 올랐다!']);
    const hit = halfLines('리자몽', '꼬렛', half({
      moveName: '씨기관총',
      effect: 2,
      crit: true,
      events: [{ k: 'hits', n: 3, crits: 1 }, { k: 'stat', on: 'target', stat: 'def', delta: -1, tried: -1 }],
    }));
    expect(hit).toEqual(['리자몽의 씨기관총!', '효과가 굉장했다!', '급소에 맞았다!', '3번 맞았다!', '꼬렛의 방어가 떨어졌다!']);
  });

  it('says every critical hit of a multi-hit move, once each', () => {
    const two = halfLines('리자몽', '꼬렛', half({
      moveName: '씨기관총',
      crit: true,
      events: [{ k: 'hits', n: 4, crits: 2 }],
    }));
    expect(two).toEqual(['리자몽의 씨기관총!', '급소에 맞았다!', '급소에 맞았다!', '4번 맞았다!']);
  });

  it('names the locks, the returns and the rest of the moves that are their own rule', () => {
    expect(eventLines('망나뇽', '꼬렛', { k: 'rampage-end' })).toEqual(['망나뇽은 지쳐서 혼란에 빠졌다!']);
    expect(eventLines('푸린', '꼬렛', { k: 'uproar', start: true })).toEqual(['푸린은 소란을 피우기 시작했다!']);
    expect(eventLines('잠만보', '꼬렛', { k: 'bide-release' })).toEqual(['잠만보가 참았던 힘을 방출했다!']);
    expect(eventLines('딱구리', '피죤투', { k: 'grounded' })).toEqual(['피죤투는 땅으로 떨어졌다!']);
    expect(eventLines('리자몽', '피카츄', { k: 'sky-drop' })).toEqual(['리자몽은 피카츄를 하늘로 데려갔다!']);
    expect(eventLines('리자몽', '피카츄', { k: 'charge', moveId: 507 })).toEqual([]);
    expect(skipLine('피카츄', 'held')).toBe('피카츄는 하늘에 붙잡혀 있어서 움직일 수 없다!');
    expect(skipLine('푸린', 'throat-chop', '하이퍼보이스')).toBe('푸린은 지옥찌르기의 효과로 하이퍼보이스를 쓸 수 없다!');
    expect(skipLine('푸린', 'torment', '하이퍼보이스')).toBe('푸린은 트집 때문에 같은 기술을 연속으로 쓸 수 없다!');
  });

  it('says only the skip when a side cannot move', () => {
    expect(halfLines('리자몽', '꼬렛', half({ skip: 'flinch' }))).toEqual(['리자몽은 풀이 죽어 움직일 수 없다!']);
    expect(halfLines('리자몽', '꼬렛', half({ skip: 'recharge' }))).toEqual(['리자몽은 공격의 반동으로 움직일 수 없다!']);
  });

  it('names the weather, the field and the screens', () => {
    expect(eventLines('a', 'b', { k: 'weather', set: 'rain' })).toEqual(['비가 내리기 시작했다!']);
    expect(eventLines('a', 'b', { k: 'terrain', set: 'grassy' })).toEqual(['발밑에 풀이 무성해졌다!']);
    expect(eventLines('a', 'b', { k: 'screen', set: 'reflect' })).toEqual(['물리 공격에 강해졌다!']);
    expect(eventLines('a', 'b', { k: 'trick-room', on: true })).toEqual(['시공이 뒤틀렸다!']);
    expect(eventLines('a', 'b', { k: 'call', moveId: 89, moveKo: '지진' })).toEqual(['잠꼬대로 지진을 썼다!']);
  });

  it('says what happens at the end of a turn', () => {
    expect(
      endLines('리자몽', '꼬렛', [
        { k: 'weather-chip', on: 'foe', weather: 'sand', hp: 5 },
        { k: 'status-chip', on: 'me', condition: 'burn', hp: 5 },
        { k: 'weather-end', weather: 'sand' },
        { k: 'screen-end', on: 'me', screen: 'reflect' },
      ]),
    ).toEqual([
      '모래바람이 꼬렛을 덮쳤다!',
      '리자몽은 화상 데미지를 입었다!',
      '모래바람이 가라앉았다!',
      '우리 편의 리플렉터가 사라졌다!',
    ]);
  });

  it('pages two lines at a time, and never hands back nothing', () => {
    expect(pages(['a', 'b', 'c'])).toEqual([['a', 'b'], ['c']]);
    expect(pages([])).toEqual([[]]);
  });

  it('labels the field only when something is on it', () => {
    const quiet = { weather: null, weatherTurns: 0, terrain: null, terrainTurns: 0, trickRoom: 0, mine: {}, theirs: {} };
    expect(fieldLabel(quiet)).toBeNull();
    expect(fieldLabel({ ...quiet, weather: 'rain', weatherTurns: 3 })).toBe('비 3');
    expect(fieldLabel({ ...quiet, weather: 'sand', weatherTurns: 2, trickRoom: 4 })).toBe('모래바람 2 · 트릭룸 4');
  });
});

describe('battle text for the moves that are their own rule', () => {
  it('names what each one did', () => {
    const say = (e: Parameters<typeof eventLines>[2]) => eventLines('리자몽', '꼬렛', e);
    expect(say({ k: 'substitute' })).toEqual(['리자몽의 대타가 나타났다!']);
    expect(say({ k: 'sub-hit' })).toEqual(['대타가 꼬렛 대신 공격을 받았다!']);
    expect(say({ k: 'taunt' })).toEqual(['꼬렛은 도발에 넘어가 버렸다!']);
    expect(say({ k: 'spite', moveId: 34, moveKo: '몸통박치기', n: 4 })).toEqual(['꼬렛의 몸통박치기 PP가 4 줄었다!']);
    expect(say({ k: 'hazard', set: 'stealthRock', layers: 1 })).toEqual(['꼬렛 쪽 주위에 뾰족한 바위가 떠다니기 시작했다!']);
    expect(say({ k: 'forced-out' })).toEqual(['꼬렛은 날려가 버렸다!']);
    expect(say({ k: 'fled', who: 'user' })).toEqual(['리자몽은 도망쳤다!']);
    expect(say({ k: 'call', by: 'metronome', moveId: 89, moveKo: '지진' })).toEqual(['지진이 나왔다!']);
    expect(say({ k: 'charge', moveId: 19 })).toEqual(['리자몽은 하늘 높이 날아올랐다!']);
  });

  it('says why a barred move did not happen', () => {
    expect(halfLines('리자몽', '꼬렛', half({ moveName: '칼춤', skip: 'taunt' }))).toEqual([
      '리자몽은 도발당해서 칼춤을 쓸 수 없다!',
    ]);
  });

  it('says what the hazards did to a newcomer', () => {
    expect(
      endLines('리자몽', '꼬렛', [
        { k: 'hazard-hit', on: 'foe', hazard: 'stealthRock', hp: 10 },
        { k: 'hazard-hit', on: 'foe', hazard: 'spikes', hp: 10 },
        { k: 'toxic-spikes', on: 'foe', condition: 'toxic' },
        { k: 'wore-off', on: 'foe', what: 'taunt' },
      ]),
    ).toEqual([
      '뾰족한 바위가 꼬렛에게 박혔다!',
      '꼬렛은 압정뿌리기의 데미지를 입었다!',
      '꼬렛은 독압정 때문에 맹독에 걸렸다!',
      '꼬렛은 도발의 효과가 풀렸다!',
    ]);
  });
});
