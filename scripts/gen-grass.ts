/**
 * One-time generator: builds src/scenes/*.png from a CC0 tileset.
 *
 * Run: npm run gen:grass
 *
 * ## Where the art comes from
 *
 * "Overworld - Grass Biome" by Beast, released CC0 (public domain):
 *   https://opengameart.org/content/overworld-grass-biome
 *   https://opengameart.org/sites/default/files/overworld_tileset_grass.png
 *
 * CC0 requires no attribution and imposes no share-alike, which is why this one
 * gets COMMITTED rather than fetched at runtime. That is the opposite of the
 * rule in server/sprites.ts: Pokemon sprites are Nintendo/Game Freak assets, so
 * they are downloaded on demand and never redistributed. This is original art
 * its author put in the public domain. The provenance is recorded here anyway so
 * a later reader can verify it.
 *
 * ## Which tiles, and why these
 *
 * The sheet is a 16x16 grid. Every tile was scored for how visible the seam is
 * when repeated horizontally (summed RGB distance between its last and first
 * column). Widening the crop lengthens the repeat and hides the seam, but only
 * up to a point — past three tiles the score jumps threefold, because the
 * tileset was never drawn to tile at that width:
 *
 *   dark tall grass   1 tile: 30   2: 40   3: 60   4: 191
 *   light tall grass  1 tile: 28   2: 43   3: 66   4: 137
 *
 * So three tiles it is: long enough to read as organic, short enough to stay
 * seamless.
 *
 * ## Why several sheets
 *
 * The pet used to walk one patch of grass forever. It now travels: src/region.ts
 * picks a region from how much hunting has happened, and each region is one of
 * these sheets. Every sheet has the SAME geometry — 48x48, three 16px strips in
 * the order far/near/ground — because the scroll keyframes translate by exactly
 * one strip width, and a sheet that disagreed would jump every cycle. The
 * assertions in main() are what keep that true.
 *
 * The grass tileset alone cannot carry every place the journey visits — its
 * author says so plainly ("we decided to only focus on one biome, as such this
 * doesn't contain any snow, mountains, deserts or beaches"). That used to end
 * the argument, and the caption printed 달맞이산 over a patch of lawn. It no
 * longer does: see the packs below, and SOURCES for all four.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

/**
 * Two tilesets now, and the second one is a reversal worth explaining.
 *
 * The header above says all regions come from one tileset because mixing a
 * second artist's would show. That was — and is — true of the WILD regions:
 * they sit next to each other in one loop and a palette break between two
 * patches of grass reads as a mistake.
 *
 * A town does not. It is supposed to look unlike the countryside, it never
 * appears beside another region on screen, and the alternative was showing a
 * city as a stretch of cobble with nothing built on it. The two greens really
 * are different — ansimuz's is lighter and yellower than Beast's — and that was
 * checked by rendering the sheets side by side before this was accepted.
 *
 * "RPG Town Pixel Art Assets" by Luis Zuno (@ansimuz), CC0, 16x16:
 *   https://opengameart.org/content/rpg-town-pixel-art-assets
 *   https://opengameart.org/sites/default/files/town_rpg_pack.zip
 * The pack ships its own license.txt saying CC0 in as many words.
 *
 * Only the zip is published — there is no direct PNG — so this file reads one
 * entry out of it. Same reasoning as the PNG codec below: it runs once, and a
 * dependency for forty lines of header parsing is not worth the supply chain.
 *
 * ## The rock and the shore
 *
 * Five more regions the grass tileset cannot draw at all — 동굴, 산길, 유적,
 * 바닷가, 사막 — and between them they are 87 of the journey's 240 stops. Caves
 * and mountains alone are 43, and every one of them used to walk on lawn-edged
 * cobble.
 *
 * "Tiny RPG Mountain Tileset" by Luis Zuno (@ansimuz), 16x16, top-down:
 *   https://opengameart.org/content/tiny-rpg-mountain-tileset
 *   https://opengameart.org/sites/default/files/tiny_rpg_mountain_files.zip
 *
 * Three of the five come from this one pack, and that it is ANSIMUZ AGAIN is
 * why it was taken over better-stocked alternatives. The palette-clash
 * objection above is an argument about mixing BRUSHES, and the town band has
 * already accepted this brush — so 동굴 · 산길 · 유적 introduce no new one. The
 * pack happens to carry a cave mouth, cut masonry and mossy cliff faces in one
 * palette, which is exactly those three.
 *
 * "16x16 Overworld Tiles" by ARoachIFoundOnMyPillow, CC0, 16x16:
 *   https://opengameart.org/content/16x16-overworld-tiles-0
 *   https://opengameart.org/sites/default/files/tilemap_7.png
 *
 * 바닷가 and 사막 need open water and dry sand, which no rock pack has. This one
 * is a small auto-tile blob set — sand, sage grass, and navy sea with a foam
 * edge — and its muted palette sits closer to the mountain pack than to Beast's
 * saturated greens, so the two newcomers at least agree with each other.
 *
 * ## A licensing footnote worth not losing
 *
 * OpenGameArt records BOTH ansimuz packs as CC0, and ansimuz is the author and
 * the submitter, so that is the author's own declaration. But unlike the town
 * pack, the public-license.txt bundled inside these two does not use the word
 * CC0. It says, in full:
 *
 *   "You may use these assets in personal or commercial projects. You can
 *    modify these assets to suit your needs. You can re-distribute the file.
 *    Credit no required but appreciated it."
 *
 * Written down verbatim because the two properties this repository actually
 * leans on are the ones to check, and both statements grant both: it may be
 * REDISTRIBUTED (so it can be committed rather than fetched) and it needs NO
 * CREDIT (so there is still no attribution owed on screen — see NOTICE.md's
 * 라이선스 절, which is why that section can say what it says).
 *
 * ## Packs looked at and turned down
 *
 * Kenney's "Roguelike/RPG pack" is CC0 in as many words and is the only pack
 * looked at that has SNOW. It is flat, thickly outlined and saturated, and
 * beside Beast and ansimuz it reads as a different medium — the same objection
 * docs/INTERNALS.md already records against Kenney's Pixel UI Pack. So there is no 설원
 * sheet and no 설원 terrain: 얼음길 and 프로스트케이브 walk on cave rock, which
 * they are, and the skyline layer is what makes them read as ICE caves. 사막
 * nearly went the same way and was saved by the shore pack's sand.
 *
 * ansimuz's own "Warped: Super Grotto Escape Pack" was the first candidate for
 * 동굴 — same artist, cave subject, so it should have been the easy answer. Its
 * sheet turns out to be a blue temple gateway with rope bridges and a pillar:
 * decorative props rather than a repeating rock palette, and a blue nothing
 * like a Kanto cave.
 *
 * TajamSoft's "(16x16) Cave tileset" is OGA-BY 3.0. Attribution is mandatory
 * there, and owing a credit line is exactly what this project has arranged not
 * to owe.
 */
const SOURCES = {
  grass: {
    url: 'https://opengameart.org/sites/default/files/overworld_tileset_grass.png',
    entry: null,
  },
  town: {
    url: 'https://opengameart.org/sites/default/files/town_rpg_pack.zip',
    entry: 'town_rpg_pack/graphics/tiles-map.png',
  },
  mountain: {
    url: 'https://opengameart.org/sites/default/files/tiny_rpg_mountain_files.zip',
    entry: 'Tiny RPG Mountain Files/png/tileset.png',
  },
  shore: {
    url: 'https://opengameart.org/sites/default/files/tilemap_7.png',
    entry: null,
  },
} as const;

type SourceId = keyof typeof SOURCES;

const TILE = 16;
/** Tiles per strip. See the seam table above. */
const RUN = 3;

/** Where each strip sits in the sheet, in strip order. */
const ROWS = ['far', 'near', 'ground'] as const;
type Row = (typeof ROWS)[number];

/**
 * Source tile coordinates, in tiles.
 *
 * `src` is per-strip rather than per-region on purpose: the town takes only its
 * FAR band from the other tileset. Two of its three bands are the same grass
 * and cobble every other region walks on, so the palette break is confined to
 * the distant row — which is the row a difference reads as distance in anyway.
 */
type Crop = {
  tx: number;
  ty: number;
  src?: SourceId;
  /**
   * How many source tiles the strip reads before repeating.
   *
   * `ground` has always been one tile stamped RUN times — it is flat footing
   * and a three-tile run would draw the eye. `far` and `near` default to RUN.
   *
   * Naming it here rather than deriving it from the row is what lets a cliff
   * face be a `far` band: the mountain pack draws its rock walls as columns one
   * or two tiles wide with transparent gutters between them, so no three-wide
   * slab of one exists to crop. One column stamped three times does.
   */
  tiles?: 1 | typeof RUN;
};

/**
 * One entry out of a zip, by name.
 *
 * Walks the central directory rather than the local headers: a local header may
 * carry zeroed sizes with the real ones in a trailing data descriptor, and the
 * central directory always has them.
 */
function unzip(buf: Uint8Array, want: string): Uint8Array {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // End of central directory: scan back for its signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66_000; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: 중앙 디렉터리를 찾지 못했습니다');

  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();

  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip: 손상된 항목');
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));

    if (name === want) {
      // The local header repeats the name and extra with its OWN lengths.
      const lnLen = dv.getUint16(local + 26, true);
      const leLen = dv.getUint16(local + 28, true);
      const start = local + 30 + lnLen + leLen;
      const raw = buf.subarray(start, start + compSize);
      if (method === 0) return raw;
      if (method === 8) return new Uint8Array(zlib.inflateRawSync(raw));
      throw new Error(`zip: 모르는 압축 방식 ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`zip: ${want} 를 찾지 못했습니다`);
}

/**
 * The regions the pet walks through, in travel order.
 *
 * `far` is the band behind the pet and `near` the one it wades through, so far
 * wants to be the darker or more distant of the pair — that contrast is what
 * reads as depth. `ground` is a single tile repeated across the strip, so it
 * has to be flat enough to tile without drawing the eye.
 */
const REGIONS: Record<string, { ko: string; crops: Record<Row, Crop> }> = {
  /** The original patch. Unchanged, so the art nobody asked to lose stays put. */
  field: {
    ko: '풀숲',
    crops: { far: { tx: 3, ty: 9 }, near: { tx: 3, ty: 11 }, ground: { tx: 3, ty: 1 } },
  },
  flowers: {
    ko: '들꽃 초원',
    crops: { far: { tx: 3, ty: 10 }, near: { tx: 0, ty: 3 }, ground: { tx: 1, ty: 1 } },
  },
  forest: {
    ko: '깊은 숲',
    crops: { far: { tx: 9, ty: 5 }, near: { tx: 3, ty: 8 }, ground: { tx: 5, ty: 7 } },
  },
  lakeside: {
    ko: '호숫가',
    crops: { far: { tx: 0, ty: 5 }, near: { tx: 3, ty: 9 }, ground: { tx: 6, ty: 2 } },
  },
  stonepath: {
    ko: '돌길',
    crops: { far: { tx: 9, ty: 1 }, near: { tx: 3, ty: 11 }, ground: { tx: 10, ty: 2 } },
  },
  /**
   * The only one from the town pack. Rooftops behind, a picket fence to wade
   * past, cobble underfoot — a street read from three bands.
   *
   * Chosen by rendering the candidates beside the five above: a facade of doors
   * and windows does not read as distance, and a roof over grass does not read
   * as a town at all.
   */
  town: {
    ko: '마을',
    crops: {
      /**
       * A row of shopfronts, and the only thing here from the town pack.
       *
       * Picked by seam score like everything else: the roof reads better in
       * isolation but tiles at 118 against this row's 23, and the pack is a
       * finished map rather than a palette, so most of it does not repeat. The
       * picket fence scores 157-202 and had to go, which is why the near band
       * below is the same tall grass the wild regions use.
       */
      far: { tx: 11, ty: 3, src: 'town' },
      near: { tx: 3, ty: 11 },
      /** The same cobble as 돌길 — a town street IS the stone road, with buildings. */
      ground: { tx: 10, ty: 2 },
    },
  },

  /**
   * A dark rock face, a shelf of cut stone to squeeze past, packed earth.
   *
   * The far band is one tile stamped three times rather than a three-tile slab:
   * the mountain pack draws its rock as columns one or two tiles wide with
   * transparent gutters between them, so no three-wide crop of one exists. That
   * is what `tiles` is for.
   *
   * The floor is left the pack's plain brown rather than its near-black stone
   * (밝기 36 against this one's 93). Both are seamless, but with a dark band
   * behind AND under it the companion sprite stopped reading at all.
   */
  cave: {
    ko: '동굴',
    crops: {
      far: { tx: 16, ty: 4, src: 'mountain', tiles: 1 },
      near: { tx: 1, ty: 4, src: 'mountain' },
      ground: { tx: 3, ty: 1, src: 'mountain' },
    },
  },
  /**
   * A mossy cliff at the horizon, boulders and scrub to walk past, packed earth.
   *
   * The far band is LIGHTER than the near one here, which inverts the rule the
   * REGIONS header states. It is right for this one: distance washes a cliff
   * out, and the darker scrub in front is what gives the band its depth.
   */
  mountain: {
    ko: '산길',
    crops: {
      far: { tx: 10, ty: 2, src: 'mountain', tiles: 1 },
      near: { tx: 3, ty: 6, src: 'mountain' },
      ground: { tx: 3, ty: 1, src: 'mountain' },
    },
  },
  /**
   * Cut masonry, weeds growing through it, and the same paving as 돌길.
   *
   * Shares its near band with 산길 — both are the mountain pack's scrub — so the
   * masonry and the paving are what separate them. Taking the ground from the
   * ORIGINAL grass tileset is deliberate: a ruin is a built place gone over, so
   * it should stand on the same stones a road does, not on a mountain's dirt.
   */
  ruins: {
    ko: '유적',
    crops: {
      far: { tx: 1, ty: 5, src: 'mountain' },
      near: { tx: 3, ty: 6, src: 'mountain' },
      ground: { tx: 10, ty: 2 },
    },
  },
  /**
   * Flat sand to the horizon, boulders half-buried in it, dry sand underfoot.
   *
   * The only region whose far band is the SAME tile as its ground, and the only
   * one where that is right: a desert floor is flat to the horizon, so a band
   * that stood out there would read as a ridge that is not in the backdrop.
   * The scroll still shows — it is carried by the near band alone.
   *
   * The first attempt put the mountain pack's bare dirt in far and near. Its
   * dirt is a grey brown, which is fine under grey rock and reads as wet asphalt
   * under the Gen-5 dunes; only the boulders survived that, and they sit in the
   * foreground where a darker band is what depth looks like anyway.
   *
   * Two stops (하이나사막, 사막유적), which is nearly not worth a sheet. It earns
   * one because the alternative was lush green tall grass under the Gen-5 dunes,
   * and that mismatch is more visible than a plain band is dull.
   */
  desert: {
    ko: '사막',
    crops: {
      far: { tx: 1, ty: 4, src: 'shore', tiles: 1 },
      near: { tx: 1, ty: 1, src: 'mountain' },
      ground: { tx: 1, ty: 4, src: 'shore' },
    },
  },
  /**
   * Open sea at the horizon, dune grass in front, dry sand underfoot.
   *
   * The only region whose three bands all come from one NON-grass pack, and the
   * only one where that is forced: sea and sand have to agree with each other
   * or the waterline reads as a mistake, and Beast's saturated green beside this
   * pack's cream sand was the first thing tried and the first thing dropped.
   *
   * The far crop is the blob set's water tile with its foam edge along the
   * BOTTOM, so the surf lands where the sea meets the sand rather than floating
   * in open water. It is also the ONLY band with anything in it: the pack is an
   * auto-tile blob set, and its scalloped edges tiled horizontally read as
   * corrugation rather than as coastline, so the dune grass that was in `near`
   * came back out. Sand in front, sand underfoot, and the surf line is the one
   * thing that moves — which on a beach is the only thing that should.
   */
  seaside: {
    ko: '바닷가',
    crops: {
      far: { tx: 3, ty: 2, src: 'shore' },
      near: { tx: 1, ty: 4, src: 'shore', tiles: 1 },
      ground: { tx: 1, ty: 4, src: 'shore' },
    },
  },
};
// ---------------------------------------------------------------- PNG codec
//
// Hand-rolled rather than pulled from npm: this runs once, the project has no
// image dependency, and adding one for a 48x48 crop is not worth the supply
// chain.

type Raster = { w: number; h: number; px: Uint8Array }; // RGBA

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunks(png: Uint8Array): { type: string; data: Uint8Array }[] {
  const out: { type: string; data: Uint8Array }[] = [];
  let p = 8; // skip the signature
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  while (p < png.length) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7]);
    out.push({ type, data: png.subarray(p + 8, p + 8 + len) });
    p += 12 + len; // length + type + data + crc
  }
  return out;
}

/** Undo the per-scanline filter PNG applies before deflating. */
function unfilter(raw: Uint8Array, w: number, h: number, bpp: number): Uint8Array {
  const stride = w * bpp;
  const out = new Uint8Array(stride * h);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride);
    p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        // Paeth
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return out;
}

function decode(png: Uint8Array): Raster {
  const cs = chunks(png);
  const ihdr = cs.find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error('PNG에 IHDR이 없습니다');
  const dv = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
  const w = dv.getUint32(0);
  const h = dv.getUint32(4);
  const depth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];
  if (depth !== 8 || interlace !== 0) {
    throw new Error(`지원하지 않는 PNG: depth=${depth} interlace=${interlace}`);
  }

  const idat = Buffer.concat(cs.filter((c) => c.type === 'IDAT').map((c) => Buffer.from(c.data)));
  const raw = new Uint8Array(zlib.inflateSync(idat));

  // 3 = palette, 2 = truecolour, 6 = truecolour+alpha. The upstream sheet is 6,
  // but a palette source is cheap to support and this generator may be re-aimed.
  const px = new Uint8Array(w * h * 4);
  if (colorType === 6 || colorType === 2) {
    const bpp = colorType === 6 ? 4 : 3;
    const flat = unfilter(raw, w, h, bpp);
    for (let i = 0, o = 0; i < w * h; i++, o += bpp) {
      px[i * 4] = flat[o];
      px[i * 4 + 1] = flat[o + 1];
      px[i * 4 + 2] = flat[o + 2];
      px[i * 4 + 3] = bpp === 4 ? flat[o + 3] : 255;
    }
  } else if (colorType === 3) {
    const plte = cs.find((c) => c.type === 'PLTE');
    const trns = cs.find((c) => c.type === 'tRNS');
    if (!plte) throw new Error('팔레트 PNG인데 PLTE가 없습니다');
    const flat = unfilter(raw, w, h, 1);
    for (let i = 0; i < w * h; i++) {
      const idx = flat[i];
      px[i * 4] = plte.data[idx * 3];
      px[i * 4 + 1] = plte.data[idx * 3 + 1];
      px[i * 4 + 2] = plte.data[idx * 3 + 2];
      px[i * 4 + 3] = trns && idx < trns.data.length ? trns.data[idx] : 255;
    }
  } else {
    throw new Error(`지원하지 않는 colorType=${colorType}`);
  }
  return { w, h, px };
}

function encode({ w, h, px }: Raster): Uint8Array {
  const stride = w * 4;
  // Filter 0 everywhere. The image is 48x48; deflate does the real work.
  const raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(px.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const chunk = (type: string, data: Uint8Array) => {
    const body = new Uint8Array(4 + data.length);
    for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
    body.set(data, 4);
    const out = new Uint8Array(8 + data.length + 4);
    new DataView(out.buffer).setUint32(0, data.length);
    out.set(body, 4);
    new DataView(out.buffer).setUint32(8 + data.length, crc32(body));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(chunk('IHDR', ihdr)),
    Buffer.from(chunk('IDAT', new Uint8Array(zlib.deflateSync(raw, { level: 9 })))),
    Buffer.from(chunk('IEND', new Uint8Array(0))),
  ]);
}

// ---------------------------------------------------------------- build

function blit(dst: Raster, src: Raster, sx: number, sy: number, w: number, h: number, dx: number, dy: number) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((sy + y) * src.w + (sx + x)) * 4;
      const d = ((dy + y) * dst.w + (dx + x)) * 4;
      for (let c = 0; c < 4; c++) dst.px[d + c] = src.px[s + c];
    }
  }
}

/** Average per-row RGB distance between a strip's last and first column. */
function seam(r: Raster, y0: number, w: number, h: number): number {
  let total = 0;
  for (let y = 0; y < h; y++) {
    const a = ((y0 + y) * r.w + (w - 1)) * 4;
    const b = ((y0 + y) * r.w) * 4;
    total += Math.abs(r.px[a] - r.px[b]) + Math.abs(r.px[a + 1] - r.px[b + 1]) + Math.abs(r.px[a + 2] - r.px[b + 2]);
  }
  return Math.round(total / h);
}
/**
 * Every source tileset, fetched once and shared by the regions that use one.
 *
 * Cached under the OS temp dir because --survey is meant to be run repeatedly
 * while crops are being chosen, and re-downloading five packs for each pass is
 * the whole wait. The cache is keyed by URL and is pure speed: deleting it
 * changes nothing but the time this takes.
 */
async function load(): Promise<Partial<Record<SourceId, Raster>>> {
  const cacheDir = path.join(os.tmpdir(), 'poketokenpet-tilesets');
  await fs.mkdir(cacheDir, { recursive: true });

  const sheets: Partial<Record<SourceId, Raster>> = {};
  for (const [id, s] of Object.entries(SOURCES) as [SourceId, (typeof SOURCES)[SourceId]][]) {
    const cached = path.join(cacheDir, `${id}-${path.basename(new URL(s.url).pathname)}`);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await fs.readFile(cached));
      process.stdout.write(`CC0 타일셋 캐시 (${id})... `);
    } catch {
      process.stdout.write(`CC0 타일셋 받는 중 (${id})... `);
      const res = await fetch(s.url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bytes = new Uint8Array(await res.arrayBuffer());
      await fs.writeFile(cached, bytes);
    }
    // Copy rather than alias: unzip hands back a subarray view of the zip.
    if (s.entry) bytes = new Uint8Array(unzip(bytes, s.entry));
    sheets[id] = decode(bytes);
    console.log(`${sheets[id]!.w}x${sheets[id]!.h}`);
  }
  return sheets;
}

/**
 * Score every candidate strip in one tileset, and render the good ones.
 *
 * The header's seam table was produced by hand for the grass sheet. This is
 * that survey written down: for a source, every (tx, ty) whose RUN-wide slab is
 * fully opaque gets scored the way the finished sheets are, and the best are
 * both listed and drawn — each one repeated four times so the seam it would
 * show at runtime is visible rather than inferred.
 *
 * `--run 1` is how a `ground` tile is picked: that strip is one tile repeated,
 * so it is scored against itself rather than as a three-tile slab.
 *
 * The contact sheet goes wherever `--out` says and never to src/scenes — that
 * directory is checked file-by-file by test/payload-shape.test.ts, and a stray
 * survey render there is a committed binary nothing accounts for.
 */
async function survey(id: SourceId, run: number, top: number, out: string) {
  const sheets = await load();
  const src = sheets[id]!;
  const W = TILE * run;
  const cols = Math.floor(src.w / TILE);
  const rows = Math.floor(src.h / TILE);

  // Mean luminance rides along because the bands have roles: `far` wants to be
  // the darker of the pair, and reading that off a list beats squinting at 87
  // candidate strips to find the one dark tile that also tiles.
  const cand: { tx: number; ty: number; score: number; lum: number }[] = [];
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx + run <= cols; tx++) {
      const slab: Raster = { w: W, h: TILE, px: new Uint8Array(W * TILE * 4) };
      if (run === 1) blit(slab, src, tx * TILE, ty * TILE, TILE, TILE, 0, 0);
      else blit(slab, src, tx * TILE, ty * TILE, W, TILE, 0, 0);
      // A transparent pixel would punch a hole in the band and show sky through
      // it, so a slab containing one is not a candidate at all.
      let opaque = true;
      for (let i = 3; i < slab.px.length; i += 4) if (slab.px[i] !== 255) { opaque = false; break; }
      if (!opaque) continue;
      let lum = 0;
      for (let i = 0; i < slab.px.length; i += 4) lum += (slab.px[i] * 299 + slab.px[i + 1] * 587 + slab.px[i + 2] * 114) / 1000;
      cand.push({ tx, ty, score: seam(slab, 0, W, TILE), lum: Math.round(lum / (slab.px.length / 4)) });
    }
  }
  cand.sort((a, b) => a.score - b.score);
  const best = cand.slice(0, top);

  console.log(`
${id} ${src.w}x${src.h} · ${cols}x${rows}타일 · run=${run}`);
  console.log(`불투명 후보 ${cand.length}개 중 상위 ${best.length}개 (이음선 낮은 순):`);
  best.forEach((c, i) => console.log(`  ${String(i).padStart(2)}  tx ${String(c.tx).padStart(2)} ty ${String(c.ty).padStart(2)}  이음선 ${String(c.score).padStart(3)}  밝기 ${c.lum}`));

  // One row per candidate: the slab four times over, so the repeat is visible,
  // scaled up because 16px tall is not something an eye can judge.
  const SCALE = 3;
  const REPEAT = 4;
  const GUTTER = 2;
  const rowH = TILE + GUTTER;
  const sheet: Raster = {
    w: W * REPEAT * SCALE,
    h: rowH * best.length * SCALE,
    px: new Uint8Array(W * REPEAT * SCALE * rowH * best.length * SCALE * 4),
  };
  best.forEach((c, i) => {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < W * REPEAT; x++) {
        const sx = (run === 1 ? 0 : x % W) + c.tx * TILE;
        const s = ((c.ty * TILE + y) * src.w + sx) * 4;
        for (let dy = 0; dy < SCALE; dy++) {
          for (let dx = 0; dx < SCALE; dx++) {
            const d = (((i * rowH + y) * SCALE + dy) * sheet.w + x * SCALE + dx) * 4;
            for (let ch = 0; ch < 4; ch++) sheet.px[d + ch] = src.px[s + ch];
          }
        }
      }
    }
  });
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, encode(sheet));
  console.log(`
→ ${out}  (${sheet.w}x${sheet.h}, 위에서부터 0번)`);
}

/**
 * Build one region's 48x48 sheet, and refuse to build a broken one.
 *
 * Both assertions are load-bearing rather than defensive. A transparent pixel
 * would punch a hole in the band and show the sky through the grass, and the
 * scroll keyframes translate by exactly one strip width — a sheet that
 * disagreed on either would fail silently at runtime, every cycle.
 */
function compose(id: string, region: (typeof REGIONS)[string], sheets: Partial<Record<SourceId, Raster>>): Raster {
  const W = TILE * RUN;
  const sheet: Raster = { w: W, h: TILE * ROWS.length, px: new Uint8Array(W * TILE * ROWS.length * 4) };

  ROWS.forEach((key, row) => {
    const { tx, ty, src: srcId, tiles } = region.crops[key];
    const src = sheets[srcId ?? 'grass']!;
    const need = tiles ?? (key === 'ground' ? 1 : RUN);
    if (tx + need > src.w / TILE || ty >= src.h / TILE) {
      throw new Error(`${id}.${key}: 타일 (${tx},${ty})이 시트 밖입니다`);
    }
    if (need === 1) {
      // One tile, stamped across the strip.
      for (let r = 0; r < RUN; r++) {
        blit(sheet, src, tx * TILE, ty * TILE, TILE, TILE, r * TILE, row * TILE);
      }
    } else {
      blit(sheet, src, tx * TILE, ty * TILE, W, TILE, 0, row * TILE);
    }
  });

  for (let i = 3; i < sheet.px.length; i += 4) {
    if (sheet.px[i] !== 255) throw new Error(`${id}: 잘라낸 영역에 투명 픽셀이 있습니다`);
  }
  if (sheet.w !== 48 || sheet.h !== 48) throw new Error(`${id}: 48x48이 아닙니다`);
  return sheet;
}

/**
 * Render every finished sheet side by side, scaled up and repeated.
 *
 * The other half of how a crop gets accepted. --survey scores a candidate; this
 * is the look that decides it, and it is the step docs/INTERNALS.md records for the town
 * pack ("채택 전에 여섯 시트를 나란히 렌더해 눈으로 확인했고"). Written down so
 * the next person adding a region does not have to rebuild it.
 *
 * Sheets are stacked in REGIONS order, each repeated so the horizontal loop is
 * visible rather than inferred.
 */
async function preview(out: string) {
  const sheets = await load();
  const built = Object.entries(REGIONS).map(([id, region]) => ({ id, ko: region.ko, raster: compose(id, region, sheets) }));

  const SCALE = 4;
  const REPEAT = 4;
  const GUTTER = 4;
  const W = TILE * RUN;
  const H = TILE * ROWS.length;
  const rowH = H + GUTTER;
  const sheet: Raster = {
    w: W * REPEAT * SCALE,
    h: rowH * built.length * SCALE,
    px: new Uint8Array(W * REPEAT * SCALE * rowH * built.length * SCALE * 4),
  };
  built.forEach((b, i) => {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W * REPEAT; x++) {
        const s = (y * W + (x % W)) * 4;
        for (let dy = 0; dy < SCALE; dy++) {
          for (let dx = 0; dx < SCALE; dx++) {
            const d = (((i * rowH + y) * SCALE + dy) * sheet.w + x * SCALE + dx) * 4;
            for (let ch = 0; ch < 4; ch++) sheet.px[d + ch] = b.raster.px[s + ch];
          }
        }
      }
    }
  });
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, encode(sheet));
  console.log(`\n→ ${out}  (위에서부터 ${built.map((b) => b.ko).join(' · ')})`);
}

async function main() {
  const sheets = await load();

  const here = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.join(here, '..', 'src', 'scenes');
  await fs.mkdir(outDir, { recursive: true });

  const W = TILE * RUN;
  let worst = 0;

  for (const [id, region] of Object.entries(REGIONS)) {
    const sheet = compose(id, region, sheets);

    const out = path.join(outDir, `${id}.png`);
    const png = encode(sheet);
    await fs.writeFile(out, png);
    worst = Math.max(worst, png.length);

    const seams = ROWS.map((key, row) => `${key} ${seam(sheet, row * TILE, W, TILE)}`).join('  ');
    console.log(`→ src/scenes/${id}.png  ${region.ko}`);
    console.log(`   ${png.length}바이트 · 이음선 ${seams}`);
    if (png.length >= 4096) {
      console.log('   ⚠ 4096바이트를 넘어 Vite가 별도 파일로 내보냅니다 (인라인 안 됨)');
    }
  }

  console.log(`\n${Object.keys(REGIONS).length}개 지역 · 최대 ${worst}바이트`);
}

const argv = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? '') : null;
};
const surveyId = flag('survey') as SourceId | null;
const previewOut = flag('preview');

(previewOut !== null
  ? preview(previewOut || path.join(os.tmpdir(), 'scenes-preview.png'))
  : surveyId
  ? survey(
      surveyId,
      Number(flag('run') ?? RUN),
      Number(flag('top') ?? 24),
      flag('out') ?? path.join(os.tmpdir(), `survey-${surveyId}.png`),
    )
  : main()
).catch((e) => {
  console.error(e);
  process.exit(1);
});
