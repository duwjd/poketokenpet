/**
 * What time it looks like in the scene.
 *
 * The art carries a baked palette — it is cropped photographic-ish pixel art,
 * not a mask over a token colour — so the scene cannot be recoloured the way
 * the rest of the panel is. Instead each phase is a CSS filter over the same
 * art, which is how the stylesheet already handled dark mode before this
 * existed. See the [data-tod] blocks in Scene.css.
 *
 * Four phases rather than a continuous ramp: the games do it this way, a filter
 * that crept a fraction of a degree every minute would only ever be noticed as
 * flicker, and four is enough for "it is evening" to register at a glance.
 *
 * Boundaries follow HGSS/BW's day cycle. Local time on purpose — this is meant
 * to agree with the window the user is sitting in front of.
 */
export const TIMES_OF_DAY = ['dawn', 'day', 'dusk', 'night'] as const;

export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

export function timeOfDayAt(d: Date): TimeOfDay {
  const h = d.getHours();
  if (h < 5) return 'night';
  if (h < 9) return 'dawn';
  if (h < 17) return 'day';
  if (h < 20) return 'dusk';
  return 'night';
}
