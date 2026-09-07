import { describe, expect, it } from 'vitest';
import { PET_SIZES } from '../electron/state.ts';
import {
  MAX_PET_WINDOW,
  PET_GRASS_H,
  ZOOM_LADDER,
  contentBox,
  fitScale,
  petWindow,
} from '../src/pixelFit.ts';

/**
 * Real canvas sizes sampled across the dex with the app's own fallback chain.
 * 61% of them are larger than 64px and the widest is 178px, which is why a
 * fixed square window clipped so much of the roster.
 */
const REAL_SPRITES: [string, number, number][] = [
  ['egg (padded png)', 96, 96],
  ['25 pikachu', 50, 46],
  ['667 litleo', 51, 61],
  ['668 pyroar', 79, 99],
  ['700 sylveon', 59, 86],
  ['900 kleavor', 130, 122],
  ['959 tinkaton', 178, 95],
  ['840 appletun', 128, 128],
  ['812 rillaboom', 101, 122],
  ['903 sneasler', 54, 113],
  ['1000 gholdengo', 63, 82],
  ['smallest seen', 38, 38],
];

describe('fitScale', () => {
  it('only ever returns a ladder step', () => {
    for (const [, w, h] of REAL_SPRITES) {
      for (const size of PET_SIZES) {
        expect(ZOOM_LADDER).toContain(fitScale(Math.max(w, h), size));
      }
    }
  });

  it('goes below 1x so an oversized sprite can still shrink', () => {
    // Pyroar is 99 tall. At the smallest step the old code floored at 1x and
    // rendered 99px of sprite into a 64px window.
    expect(fitScale(99, 64)).toBeLessThan(1);
    expect(fitScale(178, 64)).toBeLessThan(1);
  });

  it('upscales small sprites instead of leaving them tiny', () => {
    expect(fitScale(38, 256)).toBeGreaterThan(1);
    expect(fitScale(46, 128)).toBeGreaterThan(1);
  });

  it('lands within one ladder step of the requested size', () => {
    for (const [name, w, h] of REAL_SPRITES) {
      for (const size of PET_SIZES) {
        const max = Math.max(w, h);
        const got = fitScale(max, size) * max;
        // The nearest step can never be worse than half the gap to the next one.
        expect(got, `${name} @ ${size}`).toBeGreaterThan(size / 3);
        expect(got, `${name} @ ${size}`).toBeLessThan(size * 2.2);
      }
    }
  });

  it('a bigger requested size never yields a smaller sprite', () => {
    for (const [name, w, h] of REAL_SPRITES) {
      const max = Math.max(w, h);
      let prev = 0;
      for (const size of PET_SIZES) {
        const shown = max * fitScale(max, size);
        expect(shown, `${name} @ ${size}`).toBeGreaterThanOrEqual(prev);
        prev = shown;
      }
    }
  });

  it('survives degenerate input', () => {
    expect(fitScale(0, 128)).toBe(1);
    expect(fitScale(-5, 128)).toBe(1);
    expect(fitScale(64, 0)).toBe(1);
    expect(fitScale(Number.NaN, 128)).toBe(1);
  });
});

describe('petWindow', () => {
  it('is always big enough for the scaled art — no sprite is ever clipped', () => {
    for (const [name, w, h] of REAL_SPRITES) {
      for (const size of PET_SIZES) {
        const scale = fitScale(Math.max(w, h), size);
        const win = petWindow({ w, h }, scale);
        expect(win.w, `${name} @ ${size} width`).toBeGreaterThanOrEqual(Math.round(w * scale));
        expect(win.h, `${name} @ ${size} height`).toBeGreaterThanOrEqual(Math.round(h * scale));
      }
    }
  });

  it('reserves room for the hover HUD on narrow sprites', () => {
    expect(petWindow({ w: 20, h: 60 }, 1).w).toBeGreaterThanOrEqual(96);
  });

  it('never needs more room than the window is created with', () => {
    // The pet window starts at MAX_PET_WINDOW and only shrinks. If any sprite
    // could need more than that, a platform that ignores the resize would clip.
    for (const [name, w, h] of REAL_SPRITES) {
      for (const size of PET_SIZES) {
        const win = petWindow({ w, h }, fitScale(Math.max(w, h), size));
        expect(win.w, `${name} @ ${size}`).toBeLessThanOrEqual(MAX_PET_WINDOW);
        expect(win.h, `${name} @ ${size}`).toBeLessThanOrEqual(MAX_PET_WINDOW);
      }
    }
  });

  it('leaves headroom for a sprite larger than any yet seen', () => {
    // 178x95 is the widest found in a 143-sprite sample, not a proven ceiling.
    const win = petWindow({ w: 240, h: 240 }, fitScale(240, Math.max(...PET_SIZES)));
    expect(win.w).toBeLessThanOrEqual(MAX_PET_WINDOW);
    expect(win.h).toBeLessThanOrEqual(MAX_PET_WINDOW);
  });

  it('adds the grass band to height only, and never by default', () => {
    const plain = petWindow({ w: 100, h: 100 }, 1);
    const grassy = petWindow({ w: 100, h: 100 }, 1, { padBottom: PET_GRASS_H });
    expect(grassy.w).toBe(plain.w);
    expect(grassy.h).toBe(plain.h + PET_GRASS_H);
  });

  it('still fits inside the created window once the grass is added', () => {
    // The floating pet stands in a grass band, so the window has to carry it.
    // Measured worst case is Pyroar at 256px: 335px against a 384px window.
    for (const [name, w, h] of REAL_SPRITES) {
      for (const size of PET_SIZES) {
        const win = petWindow({ w, h }, fitScale(Math.max(w, h), size), {
          padBottom: PET_GRASS_H,
        });
        expect(win.h, `${name} @ ${size}`).toBeLessThanOrEqual(MAX_PET_WINDOW);
        expect(win.w, `${name} @ ${size}`).toBeLessThanOrEqual(MAX_PET_WINDOW);
      }
    }
  });

  it('follows the sprite aspect instead of forcing a square', () => {
    const wide = petWindow({ w: 178, h: 95 }, 1);
    const tall = petWindow({ w: 54, h: 113 }, 1);
    expect(wide.w).toBeGreaterThan(wide.h);
    expect(tall.h).toBeGreaterThan(tall.w);
  });
});

describe('contentBox', () => {
  const rgba = (w: number, h: number, opaque: [number, number, number, number]) => {
    const d = new Uint8ClampedArray(w * h * 4);
    const [x0, y0, bw, bh] = opaque;
    for (let y = y0; y < y0 + bh; y += 1)
      for (let x = x0; x < x0 + bw; x += 1) d[(y * w + x) * 4 + 3] = 255;
    return d;
  };

  it('finds art inside a padded canvas', () => {
    // The egg is the motivating case: ~28x30 of art on a 96x96 canvas.
    expect(contentBox(rgba(96, 96, [34, 33, 28, 30]), 96, 96)).toEqual({ x: 34, y: 33, w: 28, h: 30 });
  });

  it('returns the whole canvas when art fills it', () => {
    expect(contentBox(rgba(51, 61, [0, 0, 51, 61]), 51, 61)).toEqual({ x: 0, y: 0, w: 51, h: 61 });
  });

  it('falls back to the full canvas rather than nothing when fully transparent', () => {
    expect(contentBox(new Uint8ClampedArray(64 * 64 * 4), 64, 64)).toEqual({ x: 0, y: 0, w: 64, h: 64 });
  });

  it('ignores near-transparent antialiasing fringe', () => {
    const d = rgba(32, 32, [10, 10, 12, 12]);
    d[(2 * 32 + 2) * 4 + 3] = 5; // a faint stray pixel outside the art
    expect(contentBox(d, 32, 32)).toEqual({ x: 10, y: 10, w: 12, h: 12 });
  });
});
