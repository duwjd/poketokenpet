import { describe, expect, it } from 'vitest';
import { KO_FLAVOR_THROUGH, STAT_KO, abilitiesOf, flavorOf, statsOf } from '../server/dexdata.ts';
import { NAMES } from '../server/species.ts';

const IDS = Object.keys(NAMES).map(Number);
const MAX = Math.max(...IDS);

/**
 * The generated dex table.
 *
 * Mirrors moves.test.ts's suite over the species table: the point is not that
 * the numbers are pretty but that a request which came back half-empty cannot
 * ship as though it were the truth.
 */
describe('the generated dex table', () => {
  it('has six base stats for every species', () => {
    const bad = IDS.filter((id) => (statsOf(id)?.length ?? 0) !== 6);
    expect(bad).toEqual([]);
  });

  it('keeps every stat in range', () => {
    const bad = IDS.filter((id) => statsOf(id)!.some((v) => !Number.isInteger(v) || v < 1 || v > 255));
    expect(bad).toEqual([]);
  });

  /**
   * Hand-checked totals.
   *
   * The one failure mode a shape check cannot see is a transposed `stat_id` —
   * 공격 and 방어 swapping places looks entirely reasonable on screen and is
   * wrong forever. A known total pins the mapping, not just the count.
   */
  it('matches the totals everyone knows', () => {
    const total = (id: number) => statsOf(id)!.reduce((a, b) => a + b, 0);
    expect(total(1)).toBe(318); // 이상해씨
    expect(total(6)).toBe(534); // 리자몽
    expect(total(150)).toBe(680); // 뮤츠
    // And the mapping itself, not only its sum.
    expect(statsOf(25)).toEqual([35, 55, 40, 50, 50, 90]);
    expect(STAT_KO[1]).toBe('공격');
  });

  it('gives every species at least one ability, always with a Korean name', () => {
    const bad = IDS.filter((id) => {
      const a = abilitiesOf(id);
      return !a.length || a.some((x) => !x.ko);
    });
    expect(bad).toEqual([]);
  });

  it('marks hidden abilities apart from ordinary ones', () => {
    const pika = abilitiesOf(25);
    expect(pika.map((a) => a.ko)).toEqual(['정전기', '피뢰침']);
    expect(pika.map((a) => a.hidden)).toEqual([false, true]);
  });

  /**
   * A BOUNDARY, not a count.
   *
   * 127 missing entries is what the number happens to be today; "everything
   * through #898 and nothing above it" is the claim. Written this way a chunk
   * that silently returned nothing shows up here rather than as a quietly
   * emptier dex.
   */
  it('has a Korean entry for every species up to the boundary, and none above it', () => {
    const missingBelow = IDS.filter((id) => id <= KO_FLAVOR_THROUGH && !flavorOf(id));
    expect(missingBelow).toEqual([]);
    const presentAbove = IDS.filter((id) => id > KO_FLAVOR_THROUGH && flavorOf(id));
    expect(presentAbove).toEqual([]);
  });

  it('strips the game text-box line breaks', () => {
    // Upstream carries the original wrapping, which wraps a second time at 420px.
    const wrapped = IDS.filter((id) => /[\n\f\r]/.test(flavorOf(id) ?? ''));
    expect(wrapped).toEqual([]);
  });

  it('answers null outside the dex rather than throwing', () => {
    // speciesInfo's contract, so a caller needs only one shape of guard.
    for (const id of [0, -1, MAX + 1, 9999]) {
      expect(statsOf(id)).toBeNull();
      expect(flavorOf(id)).toBeNull();
      expect(abilitiesOf(id)).toEqual([]);
    }
  });
});
