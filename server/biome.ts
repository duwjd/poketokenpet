import type { MoveType } from './moves.ts';

/**
 * Which battle background a wild Pokemon fights on.
 *
 * The battle screen used to be two flat colours in a gradient. It now shows the
 * real Gen-5 battle backdrops, which are the art the animated sprites were drawn
 * to stand on — see ensureBackground in server/sprites.ts for where they come
 * from and why they are fetched rather than committed.
 *
 * Chosen from the foe's type rather than from where the pet is walking. The
 * travelling scene already answers "where am I"; this answers "what did I just
 * run into", which is the part that changes every encounter and is the reason
 * to look at the screen at all.
 *
 * The travelling scene now hangs one of these same backdrops at its horizon
 * (`skylineBg` in server/state.ts), so the two can disagree — a cave walk that
 * cuts to a meadow battle. They are never on screen together, .scene-battle
 * being opaque, and the split above is still the right one: keeping this on the
 * foe is what makes the battle screen change every encounter instead of once
 * every two hours. The travel side picks its own from the stop, in
 * scripts/gen-journey.ts's SKY table.
 *
 * Pure and total: same types in, same slug out, always one of BG_SLUGS. It has
 * to be, because the name is interpolated into a URL and into a cache filename.
 */

/**
 * Every backdrop that exists upstream.
 *
 * `deepsea` is real and reachable but nothing maps to it yet — it is listed so
 * the next person adding a rule can see the whole shelf rather than
 * rediscovering it. `beachshore` was in the same position until the journey's
 * SKY table gave the beaches somewhere to point.
 */
export const BG_SLUGS = [
  'beach',
  'beachshore',
  'city',
  'dampcave',
  'deepsea',
  'desert',
  'earthycave',
  'forest',
  'icecave',
  'meadow',
  'mountain',
  'river',
  'route',
  'thunderplains',
  'volcanocave',
] as const;

export type BgSlug = (typeof BG_SLUGS)[number];

/**
 * Type to backdrop, most scene-defining type first.
 *
 * The order is the whole design. A dual type picks the first of its two that
 * appears here, so grass ahead of poison puts Bulbasaur in a meadow instead of
 * a cave, water ahead of ice puts Lapras on a river instead of in an ice cave,
 * and rock ahead of ground puts Onix on a mountain instead of in a desert.
 * Reordering this list is how you change those calls — there is no second
 * mechanism.
 */
const BY_TYPE: [MoveType, BgSlug][] = [
  ['fire', 'volcanocave'],
  ['electric', 'thunderplains'],
  ['water', 'river'],
  ['ice', 'icecave'],
  ['grass', 'meadow'],
  ['bug', 'forest'],
  ['rock', 'mountain'],
  ['ground', 'desert'],
  ['dragon', 'mountain'],
  ['steel', 'city'],
  ['ghost', 'dampcave'],
  ['dark', 'dampcave'],
  ['poison', 'earthycave'],
  ['psychic', 'city'],
  ['fighting', 'city'],
  ['fairy', 'meadow'],
  ['flying', 'beach'],
  ['normal', 'route'],
];

/** The one every unknown falls back to — a plain route, like the games. */
export const DEFAULT_BG: BgSlug = 'route';

export function biomeFor(types: readonly MoveType[]): BgSlug {
  for (const [type, slug] of BY_TYPE) {
    if (types.includes(type)) return slug;
  }
  return DEFAULT_BG;
}
