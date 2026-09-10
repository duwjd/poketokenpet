import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BW_MAX_ID, animatedGif, itemSpriteUrls, showdownSlug } from '../server/sprites.ts';
import { FORMS } from '../server/forms.ts';
import { LEGEND_ITEMS } from '../server/legenddata.ts';
import { NAMES } from '../server/species.ts';

/**
 * A structurally real GIF with `frames` Graphic Control Extensions.
 *
 * `animatedGif` counts those blocks rather than decoding, so the test feeds it
 * the real block layout — header, screen descriptor, global colour table, then
 * one GCE + image descriptor + one-pixel LZW payload per frame — instead of a
 * buffer that merely contains the magic bytes somewhere.
 */
function gif(frames: number): Buffer {
  const out: number[] = [
    ...Buffer.from('GIF89a'),
    1, 0, 1, 0, // 1x1 logical screen
    0x80, 0, 0, // global colour table, 2 entries
    0, 0, 0, 255, 255, 255, // the two colours
  ];
  for (let i = 0; i < frames; i += 1) {
    out.push(0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00); // graphic control
    out.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x00); // image descriptor
    out.push(0x02, 0x02, 0x44, 0x01, 0x00); // LZW: min code size, one sub-block
  }
  out.push(0x3b);
  return Buffer.from(out);
}

describe('animatedGif', () => {
  /**
   * The whole reason the Showdown tier exists in this shape.
   *
   * Showdown answers 200 for a sprite it has not animated yet and hands back a
   * single frame — measured at 3,253 bytes for excadrill-mega against 224,692
   * for venusaur-mega. Taking the placeholder would be strictly worse than the
   * flat PNG already on disk: same stillness, wrong palette, no back view.
   */
  it('rejects a one-frame placeholder and accepts a real animation', () => {
    expect(animatedGif(gif(1))).toBe(false);
    expect(animatedGif(gif(2))).toBe(true);
    expect(animatedGif(gif(71))).toBe(true);
  });

  it('rejects anything that is not a GIF at all', () => {
    expect(animatedGif(Buffer.alloc(0))).toBe(false);
    expect(animatedGif(Buffer.from('<!DOCTYPE html><title>404</title>'))).toBe(false);
  });
});

describe('showdownSlug', () => {
  /**
   * Verified against the live host rather than reasoned about. Showdown strips
   * every non-alphanumeric character out of the English species name and hangs
   * the form on with one hyphen — which is NOT how PokeAPI spells it, so
   * `charizard-mega-x` would 404 where `charizard-megax` resolves.
   */
  it('spells a form the way Showdown does, not the way PokeAPI does', () => {
    expect(showdownSlug(10287)).toBe('excadrill-mega'); // 메가몰드류
    expect(showdownSlug(10034)).toBe('charizard-megax');
    expect(showdownSlug(10022)).toBe('kyurem-black');
    expect(showdownSlug(10199)).toBe('pikachu-gmax');
  });

  it('spells a plain species from its English name', () => {
    expect(showdownSlug(1006)).toBe('ironvaliant'); // 무쇠무인
    expect(showdownSlug(1020)).toBe('gougingfire');
  });

  /**
   * Below the Gen-5 cutoff there is no hole to fill — every one of #1-649 has
   * animated art already — and stopping here is what keeps Nidoran-female and
   * Flabebe from ever needing an answer.
   */
  it('has nothing to say below the Gen-5 cutoff', () => {
    expect(showdownSlug(BW_MAX_ID)).toBeNull();
    expect(showdownSlug(530)).toBeNull(); // 몰드류
    expect(showdownSlug(29)).toBeNull(); // 니드런♀
  });

  it('answers for every species above the cutoff and every form', () => {
    for (const id of Object.keys(NAMES).map(Number)) {
      if (id <= BW_MAX_ID) continue;
      expect(showdownSlug(id)).toMatch(/^[a-z0-9]+$/);
    }
    for (const f of FORMS) expect(showdownSlug(f.id)).toBe(f.slug);
  });
});

describe('the sprite cache namespace', () => {
  const src = readFileSync('server/sprites.ts', 'utf8');

  /**
   * Four tiers, four letters, one flat directory. A repeat would let one tier
   * serve another's art from cache — and `readSprite` only allows [\w.-], so a
   * name has to stay inside that too.
   */
  it('gives every tier its own letter', () => {
    const letters = [...src.matchAll(/`\$\{id\}-(\w)\$\{suffix\}\.(gif|png)`/g)].map((m) => m[1]);
    expect(letters).toEqual(['a', 'w', 'z', 's']);
    expect(new Set(letters).size).toBe(letters.length);
  });

  /**
   * Showdown's own host is only ever reached with the animated-only predicate.
   * Without it the tier would cache 3KB placeholders over art that is already
   * better, and `REJECT_TTL_MS` would never be consulted.
   */
  it('only ever asks Showdown itself for something it will check', () => {
    expect(src).toContain("kind === 'sdani' ? animatedGif : undefined");
    // ...and the mirror stays ABOVE it, so nothing that works today changes.
    expect(src).toContain("const CHAIN: SpriteKind[] = ['bw', 'showdown', 'sdani', 'static'];");
  });
});

describe('itemSpriteUrls', () => {
  /**
   * PokeAPI keeps most item icons flat but filed the Generation 8 and 9 ones in
   * subfolders — including all 45 Legends Z-A Mega Stones, the Ogerpon masks and
   * the Clear Amulet. Looking only at the flat folder is why 63 items drew a
   * placeholder glyph while their icons sat upstream the whole time.
   */
  it('looks in all three PokeAPI folders, flat first', () => {
    expect(itemSpriteUrls('rare-candy')).toEqual([
      'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/rare-candy.png',
      'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/gen9/rare-candy.png',
      'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/gen8/rare-candy.png',
    ]);
  });

  /** ...and at pokesprite for the two upstream has in none of them. */
  it('falls through to pokesprite, but only after PokeAPI', () => {
    const urls = itemSpriteUrls('dynamax-band');
    expect(urls).toHaveLength(4);
    expect(urls.slice(0, 3).every((u) => u.includes('/PokeAPI/'))).toBe(true);
    expect(urls[3]).toBe(
      'https://raw.githubusercontent.com/msikma/pokesprite/master/items/key-item/dynamax-band.png',
    );
  });

  it('asks a rejected slug for nothing at all', () => {
    // The cache namespace is flat, so a slug with a slash in it would escape it.
    expect(itemSpriteUrls('../secret').every((u) => u.includes('../secret'))).toBe(true);
  });
});

describe('item icons after the folder fix', () => {
  /**
   * A count, so a regenerate that loses icons is loud. Only Rayquaza is left,
   * and correctly: it is the one Mega Evolution with no stone in the games at
   * all — it needs Dragon Ascent — so the name this app composes for it is not
   * a real item and no icon set anywhere has one.
   */
  it('leaves exactly one Mega Evolution without a stone icon', () => {
    const megas = FORMS.filter((f) => f.kind === 'mega' && f.stone);
    const blank = megas.filter((f) => !f.stone!.sprite);
    expect(blank.map((f) => f.ko)).toEqual(['메가레쿠쟈']);
    expect(megas.length - blank.length).toBe(98);
  });

  /**
   * Found from the species rather than from a Korean name we composed. Alakazite
   * is 후디나이트 upstream and the composed rule makes 후딘나이트, so matching on the
   * Korean string showed a made-up name beside a glyph for an icon that existed.
   */
  it('takes the stone name upstream gives, not the one it composes', () => {
    expect(FORMS.find((f) => f.id === 10037)!.stone).toEqual({
      ko: '후디나이트',
      sprite: 'alakazite',
    });
  });

  /** The four that genuinely exist in no icon set this project can reach. */
  it('leaves four legendary items on the glyph, and names them', () => {
    expect(LEGEND_ITEMS.filter((i) => !i.sprite).map((i) => i.ko)).toEqual([
      '축복받은갑옷',
      '저주받은갑옷',
      '악의 족자',
      '물의 족자',
    ]);
  });
});
