/**
 * Korean particles, picked from the word rather than printed as a placeholder.
 *
 * "잉어킹이(가) 나타났다" is a form the games never show, and neither should a
 * panel that already knows the word. Which particle a word takes depends only on
 * whether its last syllable has a final consonant (종성), and Hangul syllables
 * are laid out contiguously from U+AC00 with 28 jongseong slots each — slot 0
 * meaning none — so the choice is one modulo.
 *
 * ## Where this lives, and why
 *
 * `src/` rather than `server/`: src/App.tsx documents a one-way boundary — the
 * renderer must not import from server/ — and this is needed on both sides. The
 * reverse direction is already the convention (electron/main.ts imports
 * MAX_PET_WINDOW from src/pixelFit.ts), and pixelFit.ts is exactly this shape:
 * pure, no I/O, no DOM, no React.
 *
 * ## Constraint
 *
 * This file is type-checked by BOTH tsconfig.app.json (lib includes DOM) and
 * tsconfig.node.json (it does not), because server/ imports it. So it must touch
 * nothing DOM- or Node-specific. `charCodeAt` and `trimEnd` are ES-level and
 * safe; reaching for `Intl` later would break `tsc -b` on the node project only.
 */

/** Jongseong index of the last syllable, or -1 if it is not a Hangul syllable. */
function finalOf(word: string): number {
  const trimmed = word.trimEnd();
  const code = trimmed.charCodeAt(trimmed.length - 1);
  if (!(code >= 0xac00 && code <= 0xd7a3)) return -1;
  return (code - 0xac00) % 28;
}

/**
 * 을/를, 은/는, 이/가 — the two-way particles.
 *
 * A word that does not end in a Hangul syllable gets the no-final form:
 * 폴리곤Z is read 제트, and every other such name in the dex ends in a vowel too.
 */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const f = finalOf(word);
  return f === 0 || f === -1 ? withoutFinal : withFinal;
}

/**
 * (으)로 — the three-way one.
 *
 * ㄹ (jongseong 8) behaves like no final at all here, which is why this cannot
 * be expressed with `josa`: 이상해풀로, not 이상해풀으로. Getting that wrong is
 * the exact reason the placeholder was left in the source in the first place.
 */
export function euro(word: string): string {
  const f = finalOf(word);
  return f === 0 || f === 8 || f === -1 ? '로' : '으로';
}
