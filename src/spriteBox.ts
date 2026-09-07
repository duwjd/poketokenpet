import { contentBox } from './pixelFit.ts';

export type SpriteBox = {
  /** Canvas size as decoded. */
  cw: number;
  ch: number;
  /** Opaque content within that canvas. */
  x: number;
  y: number;
  w: number;
  h: number;
};

const cache = new Map<string, SpriteBox>();

/**
 * Measure a sprite's canvas and the opaque art inside it.
 *
 * Fetched as a blob and decoded with createImageBitmap rather than pointed at
 * with an <img>, so the canvas is never tainted by the petsprite:// origin and
 * getImageData stays legal.
 *
 * Animated GIFs are reported as their full canvas on purpose. A GIF's logical
 * screen is the union of every frame, so cropping to the opaque box of frame
 * one would clip the sprite the moment it moved.
 */
export async function measureSprite(url: string): Promise<SpriteBox> {
  const hit = cache.get(url);
  if (hit) return hit;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`sprite ${res.status}`);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const cw = bmp.width;
  const ch = bmp.height;

  let box: SpriteBox;
  const animated = blob.type === 'image/gif' || /\.gif($|\?)/i.test(url);
  if (animated) {
    box = { cw, ch, x: 0, y: 0, w: cw, h: ch };
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      box = { cw, ch, x: 0, y: 0, w: cw, h: ch };
    } else {
      ctx.drawImage(bmp, 0, 0);
      const { data } = ctx.getImageData(0, 0, cw, ch);
      const b = contentBox(data, cw, ch);
      box = { cw, ch, ...b };
    }
  }
  bmp.close?.();
  cache.set(url, box);
  return box;
}
