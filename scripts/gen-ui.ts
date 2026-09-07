/**
 * One-time generator: builds src/battleui.png.
 *
 * Run: npm run gen:ui
 *
 * ## Why this is drawn rather than downloaded
 *
 * There is no Creative Commons version of the real battle UI, and there cannot
 * be — it would be a derivative of Nintendo's design. Everything that looks
 * exactly like it (spriters-resource, Pokemon Essentials, the decomp UI mods)
 * is a rip. server/sprites.ts already draws the line this project works to:
 * Nintendo assets are fetched at runtime and never committed. So the frames are
 * drawn here instead.
 *
 * That loses less than it sounds. What makes a screen read as a Pokemon battle
 * is the ARRANGEMENT — plates on opposing diagonals, a wide message box pinned
 * to the bottom, two elliptical pads, a green/amber/red bar. The frames
 * themselves are a heavy outline, a light inner line and a fill, which is a
 * dozen lines of drawing code.
 *
 ## What it emits
 *
 *   src/ui-window.png       18x18  message box frame, 6px slices
 *   src/ui-plate.png        12x12  HP name plate frame, 4px slices
 *   src/ui-bang.png         16x20  the "!" balloon
 *   src/ui-sign.png         16x16  the location plaque, 5px slices
 *   src/ui-panel.png        10x10  list rows and cards, 3px slices
 *   src/ui-btn.png          10x10  a raised button
 *   src/ui-btn-down.png     10x10  the same button, pressed
 *   ...and a *-dark.png beside each of those, for a dark panel
 *
 * Three files rather than one sheet because `border-image-source` slices the
 * WHOLE image — there is no way to point it at a sub-rectangle. Each is a few
 * hundred bytes and Vite inlines them.
 *
 * ## Why the two frames are different sizes
 *
 * A border-image slice is drawn at 1:1 into a border of the same width, so the
 * slice IS the frame's line weight. The battle screen is ~378x218 CSS px —
 * about 1.5x a DS screen — where the games' plate frame works out to three or
 * four pixels. An 8px frame around a 36px-tall plate is most of the plate, so
 * the small frame is drawn small. The message box is a much bigger box and
 * carries a slightly heavier line, exactly as the games draw it.
 *
 * Everything is pixel-exact at 1x and meant to be scaled by whole numbers with
 * image-rendering: pixelated.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

type RGBA = [number, number, number, number];

const CLEAR: RGBA = [0, 0, 0, 0];

/**
 * A near-black outline and a warm off-white fill.
 *
 * Deliberately NOT the panel's CSS tokens: this is a bitmap, so it cannot read
 * a CSS variable. Which is exactly why there are two of these — see below.
 */
const LIGHT = {
  ink: [40, 44, 48, 255] as RGBA,
  shade: [150, 158, 164, 255] as RGBA,
  fill: [248, 248, 244, 255] as RGBA,
  /** The raised edge on a button. One step off the fill, never a fifth colour. */
  hilite: [255, 255, 255, 255] as RGBA,
};

/**
 * The same window at night.
 *
 * A bitmap cannot follow `prefers-color-scheme`, so the only way to have one is
 * to draw it twice and let CSS pick. This became necessary when the frame moved
 * out of the battle scene and into the panel: the scene is a bright diorama and
 * a warm white box sits on it happily, but the panel flips to #181a19 and the
 * same box turns into a torch.
 *
 * The relationship inverts rather than merely darkening. On a dark page an
 * almost-black outline disappears, so the outer rim becomes the LIGHT part and
 * the fill becomes the dark one — which is how a game window reads at night.
 */
const DARK = {
  ink: [200, 210, 214, 255] as RGBA,
  shade: [74, 82, 87, 255] as RGBA,
  fill: [37, 42, 45, 255] as RGBA,
  hilite: [58, 66, 71, 255] as RGBA,
};

/** The palette being drawn with. Swapped per output file, the way `canvas()` swaps the raster. */
let INK: RGBA = LIGHT.ink;
let SHADE: RGBA = LIGHT.shade;
let FILL: RGBA = LIGHT.fill;
let HILITE: RGBA = LIGHT.hilite;

function palette(p: typeof LIGHT) {
  INK = p.ink;
  SHADE = p.shade;
  FILL = p.fill;
  HILITE = p.hilite;
}

// ---------------------------------------------------------------- raster

/** The canvas being drawn into. Swapped per output file by `canvas()`. */
let W = 0;
let H = 0;
let px = new Uint8Array(0);

function canvas(w: number, h: number) {
  W = w;
  H = h;
  px = new Uint8Array(w * h * 4);
}

function set(x: number, y: number, c: RGBA) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 4;
  px[o] = c[0];
  px[o + 1] = c[1];
  px[o + 2] = c[2];
  px[o + 3] = c[3];
}

function rect(x: number, y: number, w: number, h: number, c: RGBA) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c);
}

/**
 * One SxS frame tile, drawn so its S/3 slices tile correctly.
 *
 * Built from an inside/outside predicate and two erosions rather than by
 * stroking rectangles: the corners are clipped diagonally, so the ink has to
 * follow the actual silhouette. Stroking got the straight runs right and left
 * gaps where the diagonal met them.
 *
 * border-image repeats the middle of each edge, so every edge pixel between the
 * corners must be identical — which falls out of this automatically, since away
 * from the corners the predicate is just "inside the square".
 *
 * S must be at least 2*slice+1, or the two slices taken off opposite edges
 * overlap and the middle the browser stretches is empty.
 */
function frame(S: number, radius: number) {
  const ox = 0;
  const oy = 0;
  const inside = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return false;
    // Clip each corner along a diagonal.
    const cx = Math.min(x, S - 1 - x);
    const cy = Math.min(y, S - 1 - y);
    return cx + cy >= radius;
  };
  /** How many erosion steps a pixel survives: 0 = on the edge. */
  const depth = (x: number, y: number) => {
    if (!inside(x, y)) return -1;
    let d = 0;
    for (;; d++) {
      const r = d + 1;
      if (!inside(x - r, y) || !inside(x + r, y) || !inside(x, y - r) || !inside(x, y + r)) return d;
      if (d > S) return d;
    }
  };

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = depth(x, y);
      // Ink outline, a gap, then the inner shade line — the doubled edge is
      // what makes it read as a game window rather than a CSS box.
      set(ox + x, oy + y, d < 0 ? CLEAR : d === 0 ? INK : d === 2 ? SHADE : FILL);
    }
  }
}

/**
 * The location signpost: a frame with a coloured post down its left edge.
 *
 * The games slide a plaque into the top-left corner when you walk into a new
 * area. Theirs is rounded and ours cannot be — a pixel grid has no rounded
 * corners, which is the rule `test/panel-css.test.ts` enforces on every sheet —
 * so this borrows the shape it CAN have and keeps the one detail that actually
 * says "signpost": a solid bar down the left side, like the post it hangs on.
 *
 * The bar has to live inside the LEFT SLICE, because border-image stretches the
 * middle and would smear it across the whole plaque otherwise. At S=16 with a
 * 5px slice the left slice is columns 0-4, so columns 2-3 are safely inside it
 * however wide the sign gets.
 *
 * Drawn rather than downloaded, same as everything else here — every ripped
 * version of the real thing is a Game Freak asset.
 */
const POST: RGBA = [44, 122, 111, 255];

function sign(S: number, radius: number, bar: [number, number]) {
  frame(S, radius);
  for (let y = 2; y < S - 2; y++) {
    for (let x = bar[0]; x <= bar[1]; x++) set(x, y, POST);
  }
}

/**
 * A plainer frame: outline, then fill. No inner line.
 *
 * `frame` doubles its edge — outline, gap, shade — which is what makes a
 * message WINDOW read as one. A button or a list row wants to be quieter than
 * that at a quarter the size, so this is the same corner geometry with the
 * middle left alone.
 *
 * `lift` paints the top and left edges one step brighter, which is the whole
 * trick behind a pixel button looking raised. Pass false for the pressed state
 * and it reads as pushed in without moving anything.
 */
function plain(S: number, radius: number, lift: boolean) {
  const inside = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return false;
    const cx = Math.min(x, S - 1 - x);
    const cy = Math.min(y, S - 1 - y);
    return cx + cy >= radius;
  };
  const edge = (x: number, y: number) =>
    !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!inside(x, y)) {
        set(x, y, CLEAR);
        continue;
      }
      if (edge(x, y)) {
        set(x, y, INK);
        continue;
      }
      // One highlight ring, on the side the light comes from.
      const near = lift ? !inside(x - 2, y) || !inside(x, y - 2) : !inside(x + 2, y) || !inside(x, y + 2);
      set(x, y, near ? HILITE : FILL);
    }
  }
}

/**
 * The exclamation balloon.
 *
 * The games' emote is a small white balloon with a heavy dark outline, a bold
 * "!" and a tail pointing down at whoever is surprised. 16x20 at 1x, drawn to
 * be scaled 2x or 3x.
 */
function balloon(ox: number, oy: number) {
  const bw = 16;
  const bh = 15;
  const r = 3;
  const inside = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= bw || y >= bh) return false;
    const cx = Math.min(x, bw - 1 - x);
    const cy = Math.min(y, bh - 1 - y);
    return cx + cy >= r;
  };

  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      if (!inside(x, y)) continue;
      const edge =
        !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      set(ox + x, oy + y, edge ? INK : FILL);
    }
  }

  // A solid triangular tail under the body, pointing down at the sprite.
  const tailX = 5;
  for (let j = 0; j < 5; j++) {
    const w = 5 - j;
    const y = oy + bh + j;
    rect(ox + tailX, y, w, 1, INK);
    if (w > 2) rect(ox + tailX, y, w - 2, 1, FILL);
  }
  // Heal the seam where the tail meets the body.
  rect(ox + tailX, oy + bh - 1, 3, 1, FILL);

  // The mark itself: a stem and a dot.
  rect(ox + 7, oy + 3, 2, 6, INK);
  rect(ox + 7, oy + 11, 2, 2, INK);
}

// ---------------------------------------------------------------- PNG out
//
// Same hand-rolled encoder as scripts/gen-grass.ts — one image, run once, not
// worth an image dependency.

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function encode(): Uint8Array {
  const stride = W * 4;
  const raw = new Uint8Array((stride + 1) * H);
  for (let y = 0; y < H; y++) {
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
  dv.setUint32(0, W);
  dv.setUint32(4, H);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(chunk('IHDR', ihdr)),
    Buffer.from(chunk('IDAT', new Uint8Array(zlib.deflateSync(raw, { level: 9 })))),
    Buffer.from(chunk('IEND', new Uint8Array(0))),
  ]);
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const write = async (name: string, w: number, h: number, draw: () => void) => {
    canvas(w, h);
    draw();
    const png = encode();
    await fs.writeFile(path.join(here, '..', 'src', name), png);
    const warn = png.length >= 4096 ? '  ⚠ Vite 인라인 한계 초과' : '';
    console.log(`→ src/${name}  ${w}x${h} · ${png.length}바이트${warn}`);
  };

  // A rounder corner on the message box, tighter on the plates — the games
  // draw the big window softer than the little ones.
  await write('ui-window.png', 18, 18, () => frame(18, 3));
  await write('ui-plate.png', 12, 12, () => frame(12, 2));
  await write('ui-bang.png', 16, 20, () => balloon(0, 0));

  // The travelling scene's location plaque. No dark twin: it only ever appears
  // over the battle diorama, which App.css keeps on the light frame at every
  // hour — the same reason the "!" balloon has none.
  await write('ui-sign.png', 16, 16, () => sign(16, 2, [2, 3]));

  // Rows and buttons. Smaller radius than the window: a 26px button with the
  // message box's corner would be mostly corner.
  await write('ui-panel.png', 10, 10, () => plain(10, 2, false));
  await write('ui-btn.png', 10, 10, () => plain(10, 2, true));
  await write('ui-btn-down.png', 10, 10, () => plain(10, 2, false));

  // The dark pair, for the panel. No dark balloon: the "!" only ever appears
  // over the battle diorama, which is bright at every hour.
  const dark = (draw: () => void) => () => {
    palette(DARK);
    draw();
    palette(LIGHT);
  };
  await write('ui-window-dark.png', 18, 18, dark(() => frame(18, 3)));
  await write('ui-plate-dark.png', 12, 12, dark(() => frame(12, 2)));
  await write('ui-panel-dark.png', 10, 10, dark(() => plain(10, 2, false)));
  await write('ui-btn-dark.png', 10, 10, dark(() => plain(10, 2, true)));
  await write('ui-btn-down-dark.png', 10, 10, dark(() => plain(10, 2, false)));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
