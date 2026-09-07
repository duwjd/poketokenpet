import { describe, expect, it } from 'vitest';
import { MEGA_STONE_DROP_CHANCE, encounterAt, stoneAt } from '../server/hunt.ts';
import { formById, formsFrom } from '../server/forms.ts';

const THRESHOLD = 5_000_000;

describe('stoneAt', () => {
  it('is a pure function of (seq, wildId)', () => {
    for (let k = 0; k < 200; k++) {
      const e = encounterAt(k, 25, THRESHOLD);
      expect(stoneAt(k, e.wildId)).toBe(stoneAt(k, e.wildId));
    }
  });

  it('never drops anything for a species with no mega', () => {
    // Rattata, Caterpie, Magikarp — none of them has one.
    for (const id of [19, 10, 129]) {
      expect(formsFrom(id).some((f) => f.kind === 'mega')).toBe(false);
      for (let k = 0; k < 500; k++) expect(stoneAt(k, id)).toBeNull();
    }
  });

  it('only ever drops a stone the species it came from can use', () => {
    for (let k = 0; k < 5_000; k++) {
      const e = encounterAt(k, 25, THRESHOLD);
      const got = stoneAt(k, e.wildId);
      if (got === null) continue;
      const form = formById(got);
      expect(form?.kind).toBe('mega');
      expect(form!.from).toContain(e.wildId);
      // And it has a stone to hand over. Ultra Burst has none, and it is not
      // reachable from any wild species — which is what this pins.
      expect(form!.stone).toBeDefined();
    }
  });

  it('respects the conditional chance', () => {
    // Given a species that HAS a mega, the rate is the constant itself.
    let met = 0;
    let dropped = 0;
    for (let k = 0; k < 20_000; k++) {
      if (!formsFrom(3).length) break;
      met += 1;
      if (stoneAt(k, 3) !== null) dropped += 1;
    }
    expect(dropped / met).toBeCloseTo(MEGA_STONE_DROP_CHANCE, 1);
  });

  /**
   * The number the constant's comment claims, measured rather than asserted.
   *
   * The real rarity is not the chance above — it is how rarely a mega-capable
   * species turns up at all. Roughly 5% of encounters, so about one stone per
   * eighty, which at one encounter per five minutes is most of a working day.
   * Wide bounds: this is a guard against the balance moving by an order of
   * magnitude, not a pin on the exact figure.
   */
  it('works out to roughly one stone per several hours of hunting', () => {
    let dropped = 0;
    const N = 40_000;
    for (let k = 0; k < N; k++) {
      if (stoneAt(k, encounterAt(k, 25, THRESHOLD).wildId) !== null) dropped += 1;
    }
    const perEncounter = dropped / N;
    expect(perEncounter).toBeGreaterThan(0.004); // not so rare it never happens
    expect(perEncounter).toBeLessThan(0.03); // not so common it is a giveaway
  });
});

describe('the encounter stream', () => {
  /**
   * The reason `stoneAt` has a salt of its own.
   *
   * Asking whether a stone dropped must not change which Pokemon was met. This
   * pins the two halves of that: the encounter is stable across the call, and
   * the stone roll consumes nothing from the encounter's own stream.
   */
  it('is untouched by asking about stones', () => {
    for (let k = 0; k < 300; k++) {
      const before = encounterAt(k, 25, THRESHOLD);
      stoneAt(k, before.wildId);
      expect(encounterAt(k, 25, THRESHOLD)).toEqual(before);
    }
  });
});
