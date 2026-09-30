import { canLearn, learnsByLevel, levelUpMoves } from './moves.ts';

/**
 * What a Pokemon can know, by the two ways this app teaches: machines
 * (`canLearn`, the bag's TMs) and levelling up (`levelUpMoves`, the games'
 * newest learnset for the species — see scripts/gen-moves.ts).
 *
 * A move learned by level is free. It was never a TM, so there is nothing to
 * spend — the companion simply knows it once it is old enough, and can put it
 * back in a slot whenever it likes, the way the games' move reminder works.
 */

/** Whether this species can know this move at all, by machine or by level. */
export function canKnow(speciesId: number, moveId: number): boolean {
  return canLearn(speciesId, moveId) || learnsByLevel(speciesId, moveId);
}

/**
 * The moves a companion born of this species hatches knowing: the games'
 * level-1 moves, the last four of them. Level 0 is "on evolution", which a
 * hatchling has not done.
 */
export function startingMoves(speciesId: number): number[] {
  const at1 = levelUpMoves(speciesId)
    .filter(([lv]) => lv === 1)
    .map(([, id]) => id);
  return [...new Set(at1)].slice(-4);
}

/**
 * Everything a companion on this path has learned by this level — what the
 * games' move reminder would offer it.
 *
 * Every species it has been so far, not only the current one: a 리자몽 still
 * remembers the 불꽃세례 it learned as a 파이리. A stage it has passed
 * through counts up to the level it is now, which over-counts a little (a
 * 파이리 evolved at 16 never saw its Lv.19 move) and never under-counts.
 * Level 0, the evolution moves, count for every stage it has evolved INTO.
 */
export function unlockedMoves(pathIds: readonly number[], stageIndex: number, level: number): number[] {
  const out: number[] = [];
  pathIds.slice(0, stageIndex + 1).forEach((speciesId, i) => {
    for (const [lv, id] of levelUpMoves(speciesId)) {
      if (lv === 0 && i === 0) continue;
      if (lv <= level && !out.includes(id)) out.push(id);
    }
  });
  return out;
}

/**
 * The moves a level-up teaches: every move of `speciesId` at a level above
 * `from` and up to `to`, and its evolution moves if it has just `evolved` into
 * it. In the games' order — level, then the order the learnset lists them.
 */
export function movesLearnedBetween(speciesId: number, from: number, to: number, evolved: boolean): number[] {
  const out: number[] = [];
  for (const [lv, id] of levelUpMoves(speciesId)) {
    if (((lv > from && lv <= to) || (evolved && lv === 0)) && !out.includes(id)) out.push(id);
  }
  return out;
}
