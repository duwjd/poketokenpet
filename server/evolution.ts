import { BASE_HAPPINESS, EVOLUTIONS, EVO_ITEM_KO, speciesName, type EvoRule } from './species.ts';
import { lineOf } from './dex.ts';
import { moveById, speciesInfo, TYPE_KO, type MoveType } from './moves.ts';
import type { Battle } from './fight.ts';

/**
 * How a companion evolves: the games' own conditions, read off
 * `EVOLUTIONS` (scripts/gen-species.ts), checked against what this app knows.
 *
 * A level is the token gauge read as 1..100 (see `levelAt` in server/game.ts).
 * Most evolutions are a level; the rest are a stone, a trade, friendship, the
 * time of day, a move, the party — and a handful of things only a real
 * cartridge can do, each given the nearest stand-in this app has. docs/DESIGN.md
 * lists every stand-in and why.
 *
 * Pure, like the rest of the growth code: the clock comes in as an argument.
 */

/**
 * What the companion has done in battle since it hatched, for the evolutions
 * that ask about it. Accumulated by server/hunt.ts as fights settle.
 *
 * - `uses`: times each move was used — 성원숭 needs 분노의주먹 twenty times.
 * - `recoil`: recoil HP taken in all — 배쓰나이.
 * - `damage`: HP lost in all — 데스마스.
 * - `crits`: the most critical hits it landed in one fight — 파오리 needs three.
 * - `defeated`: what it has beaten, by species — 절각참 needs three 절각참.
 * - `rain`: whether its latest fight was fought in the rain — 미끄네일.
 */
export type Deeds = {
  uses: Record<number, number>;
  recoil: number;
  damage: number;
  crits: number;
  defeated: Record<number, number>;
  rain: boolean;
};

export const NO_DEEDS = (): Deeds => ({ uses: {}, recoil: 0, damage: 0, crits: 0, defeated: {}, rain: false });

/**
 * Add one fight to the deeds. `foeIn` names the species a round was fought
 * against — the wild one, or the trainer's Pokemon in that slot.
 *
 * `rain` is replaced, not added to: 미끄네일 needs rain NOW, and a fight is the
 * only weather this app has, so it is whether the latest fight saw any.
 */
export function deedsAfter(d: Deeds, rounds: readonly Battle[], foeIn: (r: Battle) => number): Deeds {
  const uses = { ...d.uses };
  const defeated = { ...d.defeated };
  let { recoil, damage } = d;
  let crits = 0;
  let rain = false;
  for (const r of rounds) {
    for (const t of r.turns) {
      if (t.meActed && !t.mySkip && t.moveId !== null) uses[t.moveId] = (uses[t.moveId] ?? 0) + 1;
      for (const e of t.myEvents) {
        if (e.k === 'recoil' || e.k === 'crash' || e.k === 'half-cost') recoil += e.hp;
        if (e.k === 'hits') crits += e.crits ?? 0;
      }
      if (t.crit && !t.myEvents.some((e) => e.k === 'hits')) crits++;
      damage += t.counter + t.mySelfHit + t.myResidual;
      if (t.field.weather === 'rain') rain = true;
    }
    if (r.exit === 'foe-down' || r.exit === 'both-down') {
      const id = foeIn(r);
      defeated[id] = (defeated[id] ?? 0) + 1;
    }
  }
  return { uses, recoil, damage, crits: Math.max(d.crits, crits), defeated, rain };
}

/**
 * One encounter's worth of steps.
 *
 * 빠모트, 그푸리 and 구르데 evolve after a thousand steps walked in Let's Go
 * mode. Walking here is the journey, and an encounter is a stretch of it: ten
 * encounters is a thousand steps, which at one every five minutes is under an
 * hour — about what the thousand steps take in the games.
 */
export const STEPS_PER_ENCOUNTER = 100;

/** Friendship a level-up adds. The games add 3 to 5 at this range; this app has nothing else to raise it. */
export const FRIENDSHIP_PER_LEVEL = 5;

/**
 * Friendship at a level.
 *
 * The species' own starting friendship, and five for every level gained. A
 * Pichu (70) reaches the 160 most baby evolutions need at level 19; a Chingling
 * reaches 220 at 31. Level-ups are how the games raise it too — along with
 * walking together and items, and here the level already is the walking.
 */
export function friendshipAt(speciesId: number, level: number): number {
  const base = BASE_HAPPINESS[speciesId] ?? 50;
  return Math.min(255, base + FRIENDSHIP_PER_LEVEL * Math.max(0, level - 1));
}

/** The four times of day, on the boundaries src/timeOfDay.ts paints the scene with. */
export type Phase = 'dawn' | 'day' | 'dusk' | 'night';

/**
 * The time of day, on the same boundaries the scene uses — so what the panel
 * shows as night is night for 블래키 too. Kept here rather than imported,
 * because server code never imports the renderer; test/evolution.test.ts
 * checks the two agree hour by hour.
 */
export function phaseAt(d: Date): Phase {
  const h = d.getHours();
  if (h < 5) return 'night';
  if (h < 9) return 'dawn';
  if (h < 17) return 'day';
  if (h < 20) return 'dusk';
  return 'night';
}

/** The games' "day" is morning and day; "night" is night; "dusk" is the evening hour. */
function timeHolds(want: NonNullable<EvoRule['time']>, d: Date): boolean {
  const p = phaseAt(d);
  switch (want) {
    case 'day':
      return p === 'dawn' || p === 'day';
    case 'night':
      return p === 'night';
    case 'dusk':
      return p === 'dusk';
    case 'full-moon':
      return p === 'night' && fullMoonAt(d);
  }
}

/** A reference new moon, 2000-01-06 18:14 UTC, and the synodic month. */
const NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);
const SYNODIC_DAYS = 29.530588853;

/**
 * Whether the moon is full tonight — 링곰 becomes 다투곰 with a 피트블록 only
 * then, as in 레전드 아르세우스. Within a day either side of the true full moon.
 */
export function fullMoonAt(d: Date): boolean {
  const age = (((d.getTime() - NEW_MOON_MS) / 86_400_000) % SYNODIC_DAYS + SYNODIC_DAYS) % SYNODIC_DAYS;
  return Math.abs(age - SYNODIC_DAYS / 2) <= 1;
}

/** Everything a rule can be checked against. */
export type EvoContext = {
  /** The level reached — at a level-up, the new one. */
  level: number;
  friendship: number;
  /** Moves it knows right now. */
  moves: readonly number[];
  now: Date;
  /** Species in the league party. */
  party: readonly number[];
  deeds: Deeds;
  /** Encounters since it hatched. */
  encounters: number;
  /** Held upside down for this level-up — 오케이징. */
  upsideDown: boolean;
};

/**
 * What sets an evolution off: a level-up, or an item used from the bag.
 *
 * A rule with an item only ever fires on that item. A rule without one fires
 * on a level-up, as every friendship, time and move evolution does in the games.
 */
export type Trigger = { kind: 'level' } | { kind: 'item'; item: string; have: number };

/** Whether one rule holds. `onPath` is whether this target is the branch drawn at hatch. */
export function ruleHolds(rule: EvoRule, ctx: EvoContext, trigger: Trigger, onPath: boolean): boolean {
  if (rule.item) {
    if (trigger.kind !== 'item' || trigger.item !== rule.item || trigger.have < (rule.count ?? 1)) return false;
  } else if (trigger.kind !== 'level') {
    return false;
  }
  if (rule.byPath && !onPath) return false;
  if (rule.level !== undefined && ctx.level < rule.level) return false;
  if (rule.happiness !== undefined && ctx.friendship < rule.happiness) return false;
  if (rule.time && !timeHolds(rule.time, ctx.now)) return false;
  if (rule.move !== undefined && !ctx.moves.includes(rule.move)) return false;
  if (rule.moveType && !ctx.moves.some((id) => moveById(id)?.type === rule.moveType)) return false;
  if (rule.partySpecies !== undefined && !ctx.party.includes(rule.partySpecies)) return false;
  if (rule.partyType && !ctx.party.some((id) => (speciesInfo(id)?.types ?? []).includes(rule.partyType as MoveType))) return false;
  if (rule.rain && !ctx.deeds.rain) return false;
  if (rule.upsideDown && !ctx.upsideDown) return false;
  if (rule.steps !== undefined && ctx.encounters * STEPS_PER_ENCOUNTER < rule.steps) return false;
  if (rule.encounters !== undefined && ctx.encounters < rule.encounters) return false;
  if (rule.uses && (ctx.deeds.uses[rule.uses[0]] ?? 0) < rule.uses[1]) return false;
  if (rule.recoil !== undefined && ctx.deeds.recoil < rule.recoil) return false;
  if (rule.damage !== undefined && ctx.deeds.damage < rule.damage) return false;
  if (rule.crits !== undefined && ctx.deeds.crits < rule.crits) return false;
  if (rule.defeat && (ctx.deeds.defeated[rule.defeat[0]] ?? 0) < rule.defeat[1]) return false;
  return true;
}

/**
 * What a companion at `stageIndex` of `pathIds` can evolve into next, the branch
 * it was drawn at hatch first.
 *
 * Every child in the line, not only the drawn one: an 이브이 becomes whatever
 * stone it is handed, and a 킬리아 on the 가디안 branch still becomes a 가디안
 * at 30 whatever it was drawn as. The drawn branch only settles what the app
 * cannot otherwise tell — gender, personality, stat balance (`byPath`).
 */
export function childrenOf(pathIds: readonly number[], stageIndex: number): number[] {
  const line = lineOf(pathIds[0]);
  if (!line) return [];
  const prefix = pathIds.slice(0, stageIndex + 1);
  const out: number[] = [];
  const drawn = pathIds[stageIndex + 1];
  if (drawn !== undefined) out.push(drawn);
  for (const p of line.paths) {
    if (p.length <= stageIndex + 1) continue;
    if (!prefix.every((id, i) => p[i] === id)) continue;
    const next = p[stageIndex + 1];
    if (!out.includes(next)) out.push(next);
  }
  return out;
}

/**
 * The species this companion evolves into now, or null.
 *
 * The first child, drawn branch first, with a rule that holds for this trigger.
 * 코스모움 has two with the same rule (they are version exclusives), and the
 * drawn branch is what settles it.
 */
export function evolveTarget(
  pathIds: readonly number[],
  stageIndex: number,
  ctx: EvoContext,
  trigger: Trigger,
): number | null {
  const drawn = pathIds[stageIndex + 1];
  for (const to of childrenOf(pathIds, stageIndex)) {
    const rules = EVOLUTIONS[to] ?? [];
    if (rules.some((r) => ruleHolds(r, ctx, trigger, to === drawn))) return to;
  }
  return null;
}

/**
 * The path to follow once it has evolved into `to`: the drawn one if it still
 * fits, otherwise the first of the line's paths that runs through `to`.
 */
export function pathThrough(pathIds: readonly number[], stageIndex: number, to: number): number[] {
  if (pathIds[stageIndex + 1] === to) return [...pathIds];
  const line = lineOf(pathIds[0]);
  const prefix = pathIds.slice(0, stageIndex + 1);
  const p = line?.paths.find((q) => q[stageIndex + 1] === to && prefix.every((id, i) => q[i] === id));
  return p ? [...p] : [...prefix, to];
}

/** Whether a next evolution asks to be held upside down — 오케이징. */
export function needsFlip(a: { pathIds: readonly number[]; stageIndex: number }): boolean {
  return childrenOf(a.pathIds, a.stageIndex).some((to) => (EVOLUTIONS[to] ?? []).some((r) => r.upsideDown));
}

/** The items any child's rules ask for, deduplicated — what the shop offers this companion. */
export function itemsFor(pathIds: readonly number[], stageIndex: number): string[] {
  const drawn = pathIds[stageIndex + 1];
  const out: string[] = [];
  for (const to of childrenOf(pathIds, stageIndex)) {
    for (const r of EVOLUTIONS[to] ?? []) {
      if (r.item && (!r.byPath || to === drawn) && !out.includes(r.item)) out.push(r.item);
    }
  }
  return out;
}

/** An item's Korean name. */
export function itemKo(slug: string): string {
  return EVO_ITEM_KO[slug] ?? slug;
}

const TIME_KO: Record<NonNullable<EvoRule['time']>, string> = {
  day: '낮',
  night: '밤',
  dusk: '저녁',
  'full-moon': '보름달 밤',
};

/**
 * One rule, as the few words the panel shows under the gauge.
 *
 * "Lv.36", "천둥의돌", "친밀도 160 · 밤", "연결의끈 · 금속코트"… Written for
 * the reader who wants to know what to do, not for completeness: `byPath` is
 * never said, because it was settled at hatch and nothing can change it.
 */
export function ruleKo(rule: EvoRule): string {
  const parts: string[] = [];
  if (rule.level !== undefined) parts.push(`Lv.${rule.level}`);
  if (rule.item) parts.push(rule.count && rule.count > 1 ? `${itemKo(rule.item)} ${rule.count}개` : itemKo(rule.item));
  if (rule.happiness !== undefined) parts.push(`친밀도 ${rule.happiness}`);
  if (rule.time) parts.push(TIME_KO[rule.time]);
  if (rule.move !== undefined) parts.push(`${moveById(rule.move)?.ko ?? '기술'}을 앎`);
  if (rule.moveType) parts.push(`${TYPE_KO[rule.moveType as MoveType] ?? rule.moveType} 기술을 앎`);
  if (rule.partySpecies !== undefined) parts.push(`파티에 ${speciesName(rule.partySpecies)}`);
  if (rule.partyType) parts.push(`파티에 ${TYPE_KO[rule.partyType as MoveType] ?? rule.partyType} 타입`);
  if (rule.rain) parts.push('비 오는 배틀 뒤');
  if (rule.upsideDown) parts.push('거꾸로 들고');
  if (rule.steps !== undefined) parts.push(`${rule.steps}걸음`);
  if (rule.encounters !== undefined) parts.push(`조우 ${rule.encounters}번`);
  if (rule.uses) parts.push(`${moveById(rule.uses[0])?.ko ?? '기술'} ${rule.uses[1]}번 사용`);
  if (rule.recoil !== undefined) parts.push(`반동 ${rule.recoil} 누적`);
  if (rule.damage !== undefined) parts.push(`피해 ${rule.damage} 누적`);
  if (rule.crits !== undefined) parts.push(`한 배틀 급소 ${rule.crits}번`);
  if (rule.defeat) parts.push(`${speciesName(rule.defeat[0])} ${rule.defeat[1]}마리 쓰러뜨리기`);
  return parts.join(' · ') || '레벨업';
}

/** What each next evolution needs, for the panel: one entry per child, each rule in words. */
export function nextEvolutions(pathIds: readonly number[], stageIndex: number): { to: number; ways: string[] }[] {
  const drawn = pathIds[stageIndex + 1];
  return childrenOf(pathIds, stageIndex)
    .map((to) => ({
      to,
      ways: (EVOLUTIONS[to] ?? []).filter((r) => !r.byPath || to === drawn).map(ruleKo),
    }))
    .filter((e) => e.ways.length);
}
