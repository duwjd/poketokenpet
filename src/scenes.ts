import type { TerrainId } from './terrain.ts';
import cave from './scenes/cave.png';
import desert from './scenes/desert.png';
import field from './scenes/field.png';
import flowers from './scenes/flowers.png';
import forest from './scenes/forest.png';
import lakeside from './scenes/lakeside.png';
import mountain from './scenes/mountain.png';
import ruins from './scenes/ruins.png';
import seaside from './scenes/seaside.png';
import stonepath from './scenes/stonepath.png';
import town from './scenes/town.png';

/**
 * The ground the pet walks on, one sheet per region.
 *
 * Real pixel art, not something drawn in SVG: three strips cropped from a CC0
 * tileset by scripts/gen-grass.ts. See that file for provenance, for why the
 * strips are exactly three tiles wide, and for why every region comes from the
 * same tileset.
 *
 * Shared by the panel's scene and the floating pet, which are separate windows
 * with separate stylesheets — hence a module rather than a custom property
 * defined in one of them.
 *
 * Painted as a `background-image`, NOT a mask. The earlier SVG version was a
 * mask over a token-coloured box so it followed light/dark for free; real art
 * carries its own palette, so the time of day tints it with a filter instead.
 *
 * Imported one by one rather than through a glob so the bundler sees a fixed
 * set: each sheet is about a kilobyte and inlines as a data URI, which is what
 * keeps the packaged file:// build from having to resolve anything.
 */
const SHEETS: Record<TerrainId, string> = {
  field, flowers, forest, lakeside, stonepath, town, cave, mountain, ruins, seaside, desert,
};

/** Strip height in every sheet, and the source tile size. */
export const SCENE_TILE = 16;

/**
 * Strip geometry: where each band sits in a sheet, and how wide it repeats.
 *
 * `w` is what the scroll keyframes must translate by. Defining it here and
 * deriving the CSS from it is what keeps the loop seamless — a keyframe that
 * moves by anything other than exactly one strip width shows a jump every cycle.
 *
 * One table for every region, not one per sheet: the generator asserts each
 * sheet is 48x48 with the strips in this order precisely so that switching
 * regions is a change of URL and nothing else. A sheet that disagreed would
 * make the band stutter the moment the pet moved on.
 */
export const SCENE_STRIP = {
  /** The band behind the pet — the darker or more distant of the pair. */
  far: { y: 0, w: 48 },
  /** The band the pet wades through. */
  near: { y: 16, w: 48 },
  /** Flat footing between them. */
  ground: { y: 32, w: 48 },
} as const;

export type SceneStrip = keyof typeof SCENE_STRIP;

/**
 * CSS custom properties for one host element.
 *
 * The sheet URL and every strip offset in one object, so a component sets them
 * once on its root and the stylesheet reads them by name.
 */
export const sceneVars = (region: TerrainId): Record<string, string> => {
  const out: Record<string, string> = { '--grass-sheet': `url("${SHEETS[region]}")` };
  for (const [name, s] of Object.entries(SCENE_STRIP)) {
    out[`--grass-${name}-y`] = `-${s.y}px`;
    out[`--grass-${name}-w`] = `${s.w}px`;
  }
  return out;
};
