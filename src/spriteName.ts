/**
 * What a sprite's cache file name tells the renderer.
 *
 * Deliberately free of anything DOM-shaped: the naming rule is shared with the
 * server and pinned by test/payload-shape.test.ts, which runs in the Node
 * project where `document` does not exist.
 */

/**
 * Whether this sprite is a Pokemon that cannot animate itself.
 *
 * Almost every Pokemon on screen arrives as a GIF that already breathes. A few
 * do not: PokeAPI has no animated art for the Legends Z-A megas or for a handful
 * of Generation IX species, so they come down as the flat 96x96 PNG. Standing
 * next to a companion that moves, a frozen one reads as broken rather than calm,
 * which is what `.still` in App.css and PetApp.css is for.
 *
 * The cache name is the whole signal, and `server/sprites.ts` writes it:
 * `{id}-a*.gif` for Gen-5, `{id}-w*.gif` and `{id}-z*.gif` for Showdown, and
 * `{id}-s*.png` for the flat one. Matching on `.png` alone would be wrong — the
 * shop clerk (`npc-*.png`), the badges (`badge-*.png`) and the egg (`egg.png`)
 * are all PNGs, and a breathing shopkeeper is worse than a still Pokemon. Only
 * a leading id is a Pokemon. test/payload-shape.test.ts pins the naming rule
 * this rests on.
 */
export const stillPokemon = (name: string): boolean => /^\d+-s(sh)?b?\.png$/.test(name);
