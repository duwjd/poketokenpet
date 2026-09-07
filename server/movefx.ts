import type { MoveType } from './moves.ts';

/**
 * Which impact art a move of each type throws.
 *
 * The sibling of server/biome.ts: that one maps a type to the ground a fight
 * happens on, this one maps it to what lands on the opponent. Both resolve to a
 * slug that gets interpolated into a URL and a cache filename, so both have to
 * be total and pure.
 *
 * ## Where the art comes from
 *
 * The same directory as the backdrops — Pokemon Showdown's `fx/`, which is the
 * particle set a faithful battle simulator draws with. See ensureEffect in
 * server/sprites.ts: fetched on demand, cached on this machine, never committed.
 * Eighteen files averaging 4KB.
 *
 * PokeAPI carries no move art at all (its sprite repo is badges, items, pokemon
 * and type icons), and the packs that do — the Gen-3 animation sets, the
 * Essentials libraries — are rips of Nintendo's own frames. There is a genuinely
 * CC0 option (OpenGameArt's "Pixel Art Spells"), but it is generic 16x16 fantasy
 * art that reads nothing like a Gen-5 battle, which is the whole point here.
 *
 * ## Why these particular files
 *
 * One per type, chosen for what reads fastest at 48px against a busy backdrop
 * rather than for which move it was drawn for. Some are obvious (`flareball` for
 * fire, `lightning` for electric); the awkward ones are the types the games
 * never gave a signature particle — dragon takes the plain `wisp` so it can be
 * tinted, and normal takes `impact`, which is the hit itself rather than a
 * projectile, and is exactly right for a Tackle.
 */
const BY_TYPE: Record<MoveType, string> = {
  normal: 'impact',
  fighting: 'fist',
  flying: 'feather',
  poison: 'purplewisp',
  ground: 'mudwisp',
  rock: 'rocks',
  bug: 'web',
  ghost: 'shadowball',
  steel: 'gear',
  fire: 'flareball',
  water: 'waterwisp',
  grass: 'leaf1',
  electric: 'lightning',
  psychic: 'mistball',
  ice: 'iceball',
  dragon: 'wisp',
  dark: 'blackwisp',
  fairy: 'shine',
};

/** The one an unknown type falls back to — a plain hit, like a Tackle. */
export const DEFAULT_FX = BY_TYPE.normal;

/**
 * The effect slug for a move type.
 *
 * Takes a bare string rather than a MoveType because the renderer's payload
 * carries the type as a plain string, and a generated table that grows a
 * nineteenth type should degrade to a plain hit rather than to nothing.
 */
export function effectFor(type: string): string {
  return BY_TYPE[type as MoveType] ?? DEFAULT_FX;
}

/** Every slug this module can ask for. Exported so a test can pin the set. */
export const FX_SLUGS: string[] = [...new Set(Object.values(BY_TYPE))];
