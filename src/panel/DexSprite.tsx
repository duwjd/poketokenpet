import { useState } from 'react';
import { spriteUrl } from '../api.ts';
import { fitScale } from '../pixelFit.ts';

/**
 * A dex thumbnail, scaled by a whole-number ladder step.
 *
 * Measured from `<img onLoad>` rather than spriteBox's `measureSprite`, which
 * needs a canvas that happy-dom does not provide — and the panel's tests render
 * this for real.
 */
export function DexSprite({ name, alt, box = 44 }: { name: string; alt: string; box?: number }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);

  // Deliberately NOT Scene.css's `.scene-silhouette`: that class belongs to the
  // battle screen, and reaching for it here would tie the dex grid's rendering
  // to the battle stylesheet. The dex already has its own word for this — the
  // same '?' an entry with no sprite name shows — and the card keeps its solid
  // border and real name, so it reads as "art missing" rather than as the
  // dashed `.unseen` "not collected yet".
  if (failed) return <span className="miss">?</span>;

  return (
    <img
      src={spriteUrl(name)}
      alt={alt}
      draggable={false}
      style={size ? { width: size.w, height: size.h } : { visibility: 'hidden' }}
      onLoad={(e) => {
        const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
        if (!w || !h) return;
        const k = fitScale(Math.max(w, h), box);
        setSize({ w: Math.round(w * k), h: Math.round(h * k) });
      }}
      onError={(e) => {
        console.error('[poketokenpet] sprite failed to load:', e.currentTarget.src);
        setFailed(true);
      }}
    />
  );
}
