/**
 * Sizing maths for the floating pet, and for the two sides of a battle.
 *
 * Sprite canvases vary far more than they look: a survey across the dex found
 * 38x38 up to 178x95, with 61% wider or taller than 64px. The window used to be
 * a fixed square and the sprite was scaled to fit inside it at a whole-number
 * factor floored at 1x, so anything bigger than the window was simply clipped.
 *
 * The fix is to invert the relationship — the window follows the sprite — and to
 * let the ladder go below 1x. Both pieces live here so they can be tested
 * without a DOM.
 */

export type Box = { w: number; h: number };

/**
 * Whole-number zoom steps, plus unit fractions going down.
 *
 * Pixel art must not be scaled by an arbitrary factor or the pixel grid turns
 * uneven. Integer multiples map one source pixel to an NxN block; unit
 * fractions map an NxN block back to one pixel. Anything between those is what
 * produces the mushy, unevenly-sized pixels this ladder exists to avoid.
 */
export const ZOOM_LADDER: number[] = [1 / 4, 1 / 3, 1 / 2, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/**
 * Pick the ladder step that lands closest to `target` px on the sprite's long
 * edge. Ties go to the larger step, because at equal error the bigger pet is
 * the one the user was asking for.
 */
export function fitScale(contentMax: number, target: number): number {
  if (!Number.isFinite(contentMax) || contentMax <= 0) return 1;
  if (!Number.isFinite(target) || target <= 0) return 1;
  let best = 1;
  let bestErr = Infinity;
  for (const k of ZOOM_LADDER) {
    const err = Math.abs(k * contentMax - target);
    if (err <= bestErr) {
      best = k;
      bestErr = err;
    }
  }
  return best;
}

/**
 * Where one side of the battle stands: the scale it draws at, and the box the
 * art must stay inside.
 */
export type BattleSlot = { k: number; maxW: number; maxH: number };

/**
 * How much smaller Showdown's art is drawn to sit beside the Gen-5 sprites.
 *
 * The two tiers are not drawn to one scale. Measured over 72 species that have
 * both, Showdown's canvas is 1.26x the Gen-5 one at the median (p10 1.00, p90
 * 1.49), fronts and backs alike. Everything from #650 on is Showdown art, so
 * without this a Gen-6 Pokemon stood a quarter taller than a Gen-1 one its own
 * size.
 */
export const SHOWDOWN_ART = 0.8;

/**
 * The scale a combatant is drawn at.
 *
 * ONE scale for every Pokemon, not one size each. The scene used to fit every
 * sprite to 72px on its own through `fitScale`, and the ladder has nothing
 * between 1/2, 1 and 2 — so a 48px canvas doubled to 96 while a 49px one stayed
 * 49, and the result ran backwards: Caterpie (36px) drew at 72 while Wailord
 * (103px) drew at 52, and Charizard's back (100px) was halved to 50 beside a
 * 74px Gengar. The Gen-5 canvases already carry the games' own size ratios —
 * the artists compressed Wailord to 103px and Caterpie to 36 — so drawing them
 * all at the same scale is what makes the two sides agree.
 *
 * The box only ever shrinks: a sprite that would leave the stage or slide under
 * a name plate is drawn smaller, never anything else.
 */
export function battleScale(canvas: Box, slot: BattleSlot, showdown: boolean): number {
  const k = slot.k * (showdown ? SHOWDOWN_ART : 1);
  if (!(canvas.w > 0) || !(canvas.h > 0)) return k;
  return Math.min(k, slot.maxW / canvas.w, slot.maxH / canvas.h);
}

/** Window size for a sprite: the scaled art, plus room for shadow and the HUD. */
export function petWindow(
  content: Box,
  scale: number,
  opts?: { pad?: number; minW?: number; minH?: number; padBottom?: number },
): Box {
  const pad = opts?.pad ?? 8;
  /**
   * Extra height below the art.
   *
   * Height only — a band under the sprite spans the window width, so widening
   * would just add transparent margin. Defaults to zero, so callers that do not
   * ask for it and the "never bigger than MAX_PET_WINDOW" invariant are both
   * untouched.
   *
   * No production caller passes it today: the floating pet used to stand in a
   * grass band and no longer does. Kept because the arithmetic is the awkward
   * part and re-deriving it for the next band would be the actual work.
   */
  const padBottom = opts?.padBottom ?? 0;
  // The hover HUD is a fixed-width pill; a narrow sprite would clip it, and the
  // extra width is transparent so it costs nothing on screen.
  const minW = opts?.minW ?? 96;
  const minH = opts?.minH ?? 48;
  return {
    w: Math.max(minW, Math.round(content.w * scale) + pad * 2),
    h: Math.max(minH, Math.round(content.h * scale) + pad * 2 + padBottom),
  };
}

/**
 * Height a decorative band under the floating pet would need.
 *
 * Measured against the worst real case (Pyroar at 256px, a 304x313 window)
 * there is 71px of headroom under MAX_PET_WINDOW, so a band of this size needs
 * no change to that constant. Nothing draws one right now — the pet shows only
 * the Pokemon — but the headroom claim is what test/pixelFit.test.ts pins.
 */
export const PET_GRASS_H = 22;

/**
 * Tightest rectangle containing pixels above `alphaMin`, in RGBA order.
 *
 * Returns the full canvas when everything is transparent, so a decode failure
 * degrades to "show the whole thing" rather than a zero-sized sprite.
 */
export function contentBox(
  rgba: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  alphaMin = 8,
): { x: number; y: number; w: number; h: number } {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y += 1) {
    const row = y * w * 4;
    for (let x = 0; x < w; x += 1) {
      if (rgba[row + x * 4 + 3] > alphaMin) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w, h };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Largest window petWindow() can ask for, over every sprite and zoom step.
 *
 * The pet window is created at this size so that a full sprite is displayable
 * even if the later tightening resize never lands. That matters on Windows,
 * where Electron ignores setBounds on a non-resizable window — and the window
 * must stay non-resizable there or transparency breaks. Extra area is
 * transparent and stays click-through, so over-sizing costs nothing.
 */
export const MAX_PET_WINDOW = 384;
