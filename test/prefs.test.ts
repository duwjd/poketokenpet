import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, PET_SIZES, nearestSize, stepSize } from '../electron/state.ts';

describe('nearestSize', () => {
  it('keeps a valid size untouched', () => {
    for (const s of PET_SIZES) expect(nearestSize(s)).toBe(s);
  });

  it('snaps an arbitrary size to the closest step', () => {
    expect(nearestSize(100)).toBe(96);
    expect(nearestSize(150)).toBe(160);
    expect(nearestSize(1)).toBe(64);
    expect(nearestSize(9999)).toBe(256);
  });

  it('survives a hand-edited or corrupt prefs file', () => {
    expect(nearestSize(NaN)).toBe(DEFAULT_PREFS.petSize);
    expect(nearestSize(Infinity)).toBe(DEFAULT_PREFS.petSize);
    expect(PET_SIZES).toContain(nearestSize(-40));
  });
});

describe('stepSize', () => {
  it('moves one step per notch', () => {
    expect(stepSize(96, 1)).toBe(128);
    expect(stepSize(128, -1)).toBe(96);
  });

  it('clamps at both ends instead of wrapping', () => {
    const min = PET_SIZES[0];
    const max = PET_SIZES[PET_SIZES.length - 1];
    expect(stepSize(min, -1)).toBe(min);
    expect(stepSize(max, 1)).toBe(max);
    expect(stepSize(max, 5)).toBe(max);
  });

  it('always lands on a real step, even from a bogus current value', () => {
    for (const start of [0, 37, 101, 1e6, NaN]) {
      expect(PET_SIZES).toContain(stepSize(start, 1));
      expect(PET_SIZES).toContain(stepSize(start, -1));
    }
  });

  it('a full sweep up then down returns to the same size', () => {
    let s: number = PET_SIZES[0];
    for (let i = 0; i < PET_SIZES.length + 3; i++) s = stepSize(s, 1);
    expect(s).toBe(PET_SIZES[PET_SIZES.length - 1]);
    for (let i = 0; i < PET_SIZES.length + 3; i++) s = stepSize(s, -1);
    expect(s).toBe(PET_SIZES[0]);
  });
});

describe('PET_SIZES', () => {
  it('is ascending and starts small enough to be unobtrusive', () => {
    const sorted = [...PET_SIZES].sort((a, b) => a - b);
    expect([...PET_SIZES]).toEqual(sorted);
    expect(PET_SIZES[0]).toBeLessThanOrEqual(64);
  });
});
