import { describe, expect, it } from 'vitest';
import { LEGEND_MOVES } from '../server/legendmoves.ts';
import { LEGEND_GATES } from '../server/legends.ts';
import { learnableMoves, levelUpMoves, moveById } from '../server/moves.ts';
import { legendBattleAt } from '../server/hunt.ts';

const LEGENDS = [...new Set(LEGEND_GATES.map((g) => g.speciesId))];

/** Who can learn each move at all, by level or by machine. */
const learners = new Map<number, Set<number>>();
for (let id = 1; id <= 1025; id++) {
  for (const m of [...levelUpMoves(id).map(([, m]) => m), ...learnableMoves(id)]) {
    if (!learners.has(m)) learners.set(m, new Set());
    learners.get(m)!.add(id);
  }
}

describe('what a legendary carries', () => {
  it('is written down for every legendary, four at most, every one a move the battle knows', () => {
    for (const id of LEGENDS) {
      const row = LEGEND_MOVES[id];
      expect(row, `#${id}`).toBeDefined();
      expect(row.length).toBeGreaterThan(0);
      expect(row.length).toBeLessThanOrEqual(4);
      expect(new Set(row).size).toBe(row.length);
      for (const m of row) expect(moveById(m), `#${id} move ${m}`).not.toBeNull();
    }
  });

  /**
   * A move its species learns by level and almost nobody else does — 마그마스톰,
   * 에어로블라스트, 시간의포효. Where a species has one, meeting it means meeting
   * that move.
   */
  it('includes the signature move, wherever the species has one', () => {
    for (const id of LEGENDS) {
      const own = levelUpMoves(id)
        .map(([, m]) => m)
        .filter((m) => (learners.get(m)?.size ?? 0) <= 3);
      if (!own.length) continue;
      expect(
        LEGEND_MOVES[id].some((m) => own.includes(m)),
        `#${id} carries none of ${own.map((m) => moveById(m)?.ko).join(', ')}`,
      ).toBe(true);
    }
  });

  it('fights with those moves and no others', () => {
    for (const id of [485, 483, 249, 150]) {
      const used = new Set<number>();
      for (let k = 0; k < 20; k++) {
        const b = legendBattleAt(k, id, [33], { mySpeciesId: 143, myAbility: null });
        for (const t of b.turns) if (t.foeActed && !t.foeSkip && t.foeMoveId != null) used.add(t.foeMoveId);
      }
      expect(used.size).toBeGreaterThan(0);
      for (const m of used) expect(LEGEND_MOVES[id]).toContain(m);
    }
  });

  it('lets 히드런 bring out 마그마스톰', () => {
    let stormed = false;
    for (let k = 0; k < 40 && !stormed; k++) {
      const b = legendBattleAt(k, 485, [33], { mySpeciesId: 143, myAbility: null });
      stormed = b.turns.some((t) => t.foeActed && t.foeMoveId === 463);
    }
    expect(stormed).toBe(true);
  });
});
