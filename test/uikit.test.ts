import { describe, expect, it } from 'vitest';
import { HP_BAR_PX, gaugeValue, hpLevel } from '../src/uikit.ts';

describe('the HP bar colour', () => {
  it('is green above half, yellow above a fifth, red below', () => {
    expect(hpLevel(100, 100)).toBe('hi');
    expect(hpLevel(53, 100)).toBe('hi');
    // 51% fills 24.48 pixels — 24, which is not past half. The pixels decide.
    expect(hpLevel(51, 100)).toBe('mid');
    expect(hpLevel(50, 100)).toBe('mid');
    expect(hpLevel(21, 100)).toBe('mid');
    expect(hpLevel(20, 100)).toBe('lo');
    expect(hpLevel(1, 100)).toBe('lo');
    expect(hpLevel(0, 100)).toBe('lo');
  });

  /**
   * Emerald decides on the pixels the bar fills, not the ratio. 25 of 48 is
   * past half, 24 is not; 10 is past a fifth (9.6 → 9 pixels is the line), 9 is not.
   */
  it('changes exactly when a pixel of the 48 does', () => {
    const at = (px: number) => hpLevel(px, HP_BAR_PX);
    expect(at(25)).toBe('hi');
    expect(at(24)).toBe('mid');
    expect(at(10)).toBe('mid');
    expect(at(9)).toBe('lo');
  });

  it('never calls a living Pokemon empty', () => {
    // 1 HP of 999 is less than a pixel, and the bar still shows one.
    expect(hpLevel(1, 999)).toBe('lo');
  });
});

describe('a gauge fill', () => {
  it('stays inside the bar', () => {
    expect(gaugeValue(5, 10)).toBe(50);
    expect(gaugeValue(-3, 10)).toBe(0);
    expect(gaugeValue(30, 10)).toBe(100);
    expect(gaugeValue(1, 0)).toBe(0);
  });
});
