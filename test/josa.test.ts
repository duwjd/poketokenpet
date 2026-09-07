import { describe, expect, it } from 'vitest';
import { euro, josa } from '../src/josa.ts';

describe('josa', () => {
  it('picks by final consonant', () => {
    expect(josa('잉어킹', '을', '를')).toBe('을'); // ㅇ
    expect(josa('피카츄', '을', '를')).toBe('를'); // none
    expect(josa('파괴광선', '은', '는')).toBe('은'); // ㄴ, a real move name
    expect(josa('화염방사', '은', '는')).toBe('는'); // none, likewise
    expect(josa('잉어킹', '이', '가')).toBe('이');
    expect(josa('피카츄', '이', '가')).toBe('가');
  });

  it('falls back to the no-final form outside the syllable block', () => {
    // 폴리곤Z is read 제트; every other such name in the dex ends in a vowel.
    expect(josa('폴리곤Z', '을', '를')).toBe('를');
    expect(josa('8', '을', '를')).toBe('를');
    expect(josa('ㄱ', '을', '를')).toBe('를'); // U+3131, just below the block
    expect(josa('', '을', '를')).toBe('를'); // must not throw on charCodeAt(-1)
  });

  it('ignores a trailing space', () => {
    expect(josa('잉어킹 ', '을', '를')).toBe('을');
    expect(josa('귀한 알', '을', '를')).toBe('을'); // a product name with a space
  });

  it('holds at the edges of the syllable block', () => {
    expect(josa('가', '을', '를')).toBe('를'); // U+AC00, jongseong 0
    expect(josa('각', '을', '를')).toBe('을'); // U+AC01, jongseong 1
    expect(josa('힣', '을', '를')).toBe('을'); // U+D7A3, jongseong 27
  });

  it('only ever returns one of its two arguments', () => {
    // Pins the modulo against an independently derived jongseong count, across
    // all 11,172 syllables rather than the handful spot-checked above.
    for (let c = 0xac00; c <= 0xd7a3; c++) {
      const got = josa(String.fromCharCode(c), 'A', 'B');
      const want = (c - 0xac00) % 28 === 0 ? 'B' : 'A';
      if (got !== want) throw new Error(`U+${c.toString(16)} gave ${got}, wanted ${want}`);
    }
    expect(true).toBe(true);
  });
});

describe('euro', () => {
  it('treats ㄹ like no final at all', () => {
    // The reason this cannot be expressed with josa(). 이상해풀으로 is wrong.
    expect(euro('이상해풀')).toBe('로');
    expect(euro('레오꼬')).toBe('로');
    expect(euro('이브이')).toBe('로');
  });

  it('uses 으로 after any other final consonant', () => {
    expect(euro('리자몽')).toBe('으로'); // ㅇ
    expect(euro('골덕')).toBe('으로'); // ㄱ
    expect(euro('팬텀')).toBe('으로'); // ㅁ
  });

  it('falls back for non-Hangul tails', () => {
    expect(euro('폴리곤Z')).toBe('로');
    expect(euro('')).toBe('로');
  });
});
