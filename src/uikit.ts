/**
 * The few rules of the design system that are logic rather than CSS.
 * See docs/DESIGN-SYSTEM.md.
 */

/** The games' HP bar is 48 pixels long, and its colour is decided in pixels. */
export const HP_BAR_PX = 48;

export type HpLevel = 'hi' | 'mid' | 'lo';

/**
 * Which colour an HP bar is: green above half, yellow above a fifth, red.
 *
 * Counted the way Emerald counts it (pokeemerald `GetHPBarLevel`): on the
 * pixels the bar would fill, not on the raw ratio, and a living Pokemon always
 * fills at least one. So the colour changes exactly when a pixel does, never
 * between two frames of the same bar.
 */
export function hpLevel(hp: number, max: number): HpLevel {
  if (max <= 0 || hp <= 0) return 'lo';
  const filled = Math.max(1, Math.floor((hp * HP_BAR_PX) / max));
  if (filled > (HP_BAR_PX * 50) / 100) return 'hi';
  if (filled > Math.floor((HP_BAR_PX * 20) / 100)) return 'mid';
  return 'lo';
}

/** A 0–100 fill for `--v` on a `.px-gauge`, never outside the bar. */
export function gaugeValue(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}
