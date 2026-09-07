/**
 * What the ground under the pet looks like.
 *
 * TERRAIN, not a Pokemon region — src/journey.ts answers "which region and
 * which town". This one only names which sheet is painted, and the journey
 * decides which terrain each stop calls for. It was called `region` back when
 * the walk had no world map to sit in, and the two meanings collided the moment
 * there was one.
 *
 * Deliberately NOT the art: this module stays free of asset imports so it can
 * be reasoned about (and tested) as a plain vocabulary. src/scenes.ts maps these
 * ids onto the sheets, and scripts/gen-grass.ts cuts them.
 *
 * ## Why exactly these eleven
 *
 * The list is bounded by what CC0 pixel art exists, not by what places exist.
 * Every id here has a committed 48x48 sheet behind it, so an id can only be
 * added by finding art for it. There is no `snow`, for instance, even though
 * the journey visits 얼음길 and 프로스트케이브 — no CC0 snow tileset survived
 * the look test, so those walk on `cave` rock (which they are) and the SKY
 * table in scripts/gen-journey.ts is what makes them read as ice. See that
 * file's header for which packs were taken and which were turned down.
 */

/** Every sheet that exists. The journey names one of these per stop. */
export const TERRAIN_ORDER = [
  'field',
  'flowers',
  'forest',
  'lakeside',
  'stonepath',
  'town',
  'cave',
  'mountain',
  'ruins',
  'seaside',
  'desert',
] as const;

export type TerrainId = (typeof TERRAIN_ORDER)[number];

/**
 * A place name for each, so an id never has to be printed as a slug.
 *
 * Nothing renders these today — the caption names the STOP (달맞이산), which is
 * the more specific of the two and the one worth reading. They are kept because
 * "every terrain has a Korean name" is the invariant that stops a future caption
 * from leaking `stonepath` onto a Korean screen, and a test holds it.
 */
export const TERRAIN_KO: Record<TerrainId, string> = {
  field: '풀숲',
  flowers: '들꽃 초원',
  forest: '깊은 숲',
  lakeside: '호숫가',
  stonepath: '돌길',
  town: '마을',
  cave: '동굴',
  mountain: '산길',
  ruins: '유적',
  seaside: '바닷가',
  desert: '사막',
};
