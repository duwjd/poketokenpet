import { describe, expect, it } from 'vitest';
import { TIMES_OF_DAY, timeOfDayAt } from '../src/timeOfDay.ts';

/** Local time on purpose — the scene is meant to agree with the user's window. */
const at = (hour: number) => timeOfDayAt(new Date(2026, 0, 15, hour, 30));

describe('timeOfDayAt', () => {
  it('walks dawn → day → dusk → night across a whole day', () => {
    expect([at(0), at(4)]).toEqual(['night', 'night']);
    expect([at(5), at(8)]).toEqual(['dawn', 'dawn']);
    expect([at(9), at(16)]).toEqual(['day', 'day']);
    expect([at(17), at(19)]).toEqual(['dusk', 'dusk']);
    expect([at(20), at(23)]).toEqual(['night', 'night']);
  });

  it('puts each boundary on the hour it belongs to', () => {
    const on = (h: number) => timeOfDayAt(new Date(2026, 0, 15, h, 0, 0));
    expect(on(5)).toBe('dawn');
    expect(on(9)).toBe('day');
    expect(on(17)).toBe('dusk');
    expect(on(20)).toBe('night');
    // The minute before each one still belongs to the phase it is leaving.
    expect(timeOfDayAt(new Date(2026, 0, 15, 4, 59))).toBe('night');
    expect(timeOfDayAt(new Date(2026, 0, 15, 16, 59))).toBe('day');
  });

  it('covers every hour with a phase the stylesheet defines', () => {
    for (let h = 0; h < 24; h++) {
      expect(TIMES_OF_DAY, String(h)).toContain(at(h));
    }
  });
});
