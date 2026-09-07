import { describe, expect, it } from 'vitest';
import { dexStatic } from '../server/dexentry.ts';
import { NAMES } from '../server/species.ts';

const IDS = Object.keys(NAMES).map(Number);
const factors = (id: number) => Object.fromEntries(
  dexStatic(id)!.matchups.map((m) => [m.factor, m.types.map((t) => t.name)]),
);

/**
 * The pure half of the entry builder.
 *
 * `dexStatic` reads no save and touches no network, which is what lets this
 * sweep all 1025 species — the same reason server/dex.ts keeps itself pure.
 */
describe('a dex entry', () => {
  /**
   * The direction of the matchup table.
   *
   * `effectiveness` has only ever been called the other way round, so the
   * arguments are easy to swap — and a swapped table looks completely
   * plausible. 땅 at 0 is the canary: reversed, fire-attacks-ground reads 1
   * and 리자몽 quietly loses its immunity with nothing else looking wrong.
   */
  it('reads the type chart from the defender\'s side', () => {
    const f = factors(6); // 리자몽, 불꽃/비행
    expect(f[4]).toEqual(['바위']);
    expect(f[2]).toEqual(['물', '전기']);
    expect(f[0.5]).toEqual(['격투', '강철', '불꽃', '페어리']);
    expect(f[0.25]).toEqual(['벌레', '풀']);
    expect(f[0]).toEqual(['땅']);
  });

  it('leaves out the 1x types, and any bucket that would be empty', () => {
    const c = dexStatic(6)!;
    expect(c.matchups.some((m) => m.factor === 1)).toBe(false);
    // Strongest first, so the 4x is never buried under ten rows of "보통".
    expect(c.matchups.map((m) => m.factor)).toEqual([4, 2, 0.5, 0.25, 0]);
    // 이상해꽃 has neither a 4x nor an immunity — three buckets, not five empty ones.
    expect(dexStatic(3)!.matchups.map((m) => m.factor)).toEqual([2, 0.5, 0.25]);
    expect(dexStatic(3)!.matchups.every((m) => m.types.length > 0)).toBe(true);
  });

  /**
   * 이브이's line has EIGHT root-to-leaf paths. One row per path is eight rows
   * whose first cell is 이브이 every time, on a 420px panel.
   */
  it('folds a branching line into stage columns', () => {
    const e = dexStatic(133)!;
    expect(e.stages).toHaveLength(2);
    expect(e.stages[0].map((s) => s.name)).toEqual(['이브이']);
    expect(e.stages[1]).toHaveLength(8);
    // A line with no branches comes through unchanged.
    expect(dexStatic(6)!.stages.map((c) => c.map((s) => s.name))).toEqual([
      ['파이리'],
      ['리자드'],
      ['리자몽'],
    ]);
  });

  /**
   * `formsFrom(800)` answers the battle's question — what the shape on the
   * field can become next — and misses 울트라네크로즈마, which is reachable
   * only from an already-fused Necrozma. The dex asks a different question.
   */
  it('lists every form the species has, not only the ones reachable from it', () => {
    expect(dexStatic(800)!.forms.map((f) => f.ko)).toContain('울트라네크로즈마');
  });

  /**
   * Rarity comes from the LINE ROOT so a whole line shares one badge, which is
   * what keeps the rarity filter coherent. 버터플's own capture rate is 45 —
   * rare — while 캐터피's 255 makes the line common. The entry screen must not
   * contradict the card, and must not print the raw rate beside it.
   */
  it('keeps the line-root rarity, and prints no capture rate next to it', () => {
    expect(dexStatic(12)!.rarity).toBe('common');
    expect(dexStatic(12)).not.toHaveProperty('captureRate');
  });

  it('answers null outside the dex, the way speciesInfo does', () => {
    for (const id of [0, -1, 9999]) expect(dexStatic(id)).toBeNull();
  });

  it('builds every species without throwing, and says everything in Korean', () => {
    const bad: string[] = [];
    for (const id of IDS) {
      const d = dexStatic(id);
      if (!d) { bad.push(`${id}: null`); continue; }
      if (d.stats.length !== 6) bad.push(`${id}: stats ${d.stats.length}`);
      if (d.types.length < 1 || d.types.length > 2) bad.push(`${id}: types ${d.types.length}`);
      if (!d.abilities.length) bad.push(`${id}: no abilities`);
      // A blank where a Korean word belongs is how an English slug gets noticed
      // too late; the generator throws on those, and this is the second gate.
      if (!d.name || !d.nameEn || !d.genus) bad.push(`${id}: blank name`);
      if (d.abilities.some((a) => !a.ko)) bad.push(`${id}: blank ability`);
      if (d.types.some((t) => !t.name)) bad.push(`${id}: blank type`);
    }
    expect(bad).toEqual([]);
  });
});
