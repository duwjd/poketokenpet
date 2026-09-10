import fsp from 'node:fs/promises';
import path from 'node:path';
import { appDataDir } from './paths.ts';
import { formById } from './forms.ts';
import { NAMES } from './species.ts';

const BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites';

/**
 * Battle backdrops, from Pokemon Showdown's sprite host.
 *
 * These are the Gen-5 battle backgrounds — the same generation as the animated
 * sprites above, which is the point: they are the art those sprites were drawn
 * to stand on, so they line up without any colour-matching on our part. PokeAPI
 * does not carry backgrounds, and no Creative Commons equivalent exists (see the
 * note at the top of scripts/gen-grass.ts about why the tileset stops at grass).
 *
 * Same rule as every other Game Freak asset here: fetched on demand, cached on
 * this machine, never committed and never redistributed. There are fifteen of
 * them and they average 15KB, so the whole shelf is a fifth of a megabyte and is
 * pulled at most once each, ever.
 *
 * A miss is cosmetic by construction — Scene.css keeps the old gradient
 * underneath, so a background that never arrives leaves the battle screen
 * looking exactly like it did before this existed.
 */
const BG_BASE = 'https://play.pokemonshowdown.com/fx';

/**
 * Showdown's sprite root — the trainers below and the `sdani` tier further down.
 *
 * A sibling of BG_BASE on the same host, so it adds no source this project was
 * not already reaching, and inherits the same rule: fetched on demand, cached on
 * this machine, never committed and never redistributed.
 */
const SD_BASE = 'https://play.pokemonshowdown.com/sprites';

/**
 * Trainer sprites, from the same Showdown host as the backdrops above.
 *
 * The shop counter needs a person standing behind it, and PokeAPI's sprite
 * repository has no people in it at all — which is the wall server/trainer.ts
 * already hit and worked around by carrying a trainer with a name and a team
 * instead of a picture.
 *
 * Same rule as every other Game Freak asset here, and that rule is what makes
 * this allowed: fetched on demand, cached on this machine, never committed and
 * never redistributed. The drawn-in-repo rule in scripts/gen-ui.ts applies to
 * pixels that SHIP in the repository; these do not.
 *
 * One 789-byte file, once, ever.
 */
const NPC_BASE = `${SD_BASE}/trainers`;

/** Gen-5 Black/White animated sprites stop at #649. */
export const BW_MAX_ID = 649;

/**
 * Sprite sources, tried in order.
 *
 * `bw` is the retro Gen-5 pixel art — small, crisp, and what most people picture —
 * but it stops at #649. `showdown` covers all 1025 species plus shiny in the same
 * animated spirit at a larger size, so newer Pokemon still move. `static` is the
 * 96x96 PNG that always exists.
 *
 * `sdani` is the same Showdown art, but fetched from Showdown itself instead of
 * PokeAPI's mirror of it, and it exists because the mirror has holes. Measured
 * across every id this app can draw: the 40 Legends Z-A megas (#10287-10326) and
 * 14 species (#990-995, #1006, #1008, #1010, #1017, #1022-1025) have no
 * `other/showdown` gif at all. It sits BELOW `showdown` on purpose — everything
 * the mirror already answers returns before this tier is reached, so nothing that
 * works today changes and no extra request is made for it.
 *
 * As of 2025-09 this tier fills NONE of those 54: Showdown has not drawn one of
 * them either. It is here so that the day it does, the app picks the animation up
 * on its own rather than staying on a still PNG for ever.
 *
 * The catch is that Showdown fills a gap it has not drawn yet with a ONE-FRAME
 * placeholder rather than a 404, so this tier accepts only genuinely animated
 * GIFs. See `animatedGif`.
 */
export type SpriteKind = 'bw' | 'showdown' | 'sdani' | 'static';

const CHAIN: SpriteKind[] = ['bw', 'showdown', 'sdani', 'static'];

/**
 * The real Pokémon egg sprite, same asset the reference app uses (verified by
 * md5 against its cache). 96x96 canvas, but the egg itself only occupies about
 * 28x30 in the middle — the UI scales it up harder than a Pokémon for that reason.
 */
const EGG_URL = `${BASE}/pokemon/egg.png`;
const EGG_CACHE = 'egg.png';

/**
 * Back views exist at every tier, with the same #649 cutoff as the fronts.
 *
 * The battle scene shows the companion from behind and the wild Pokemon from
 * the front, exactly as the games do.
 */
function spriteUrl(id: number, kind: SpriteKind, shiny: boolean, back: boolean): string | null {
  const dir = `${back ? 'back/' : ''}${shiny ? 'shiny/' : ''}`;
  switch (kind) {
    case 'bw':
      return `${BASE}/pokemon/versions/generation-v/black-white/animated/${dir}${id}.gif`;
    case 'showdown':
      return `${BASE}/pokemon/other/showdown/${dir}${id}.gif`;
    case 'sdani': {
      const slug = showdownSlug(id);
      if (!slug) return null;
      // Showdown flattens the four variants into four sibling directories
      // rather than nesting them: ani, ani-back, ani-shiny, ani-back-shiny.
      const kinds = `ani${back ? '-back' : ''}${shiny ? '-shiny' : ''}`;
      return `${SD_BASE}/${kinds}/${slug}.gif`;
    }
    default:
      return `${BASE}/pokemon/${dir}${id}.png`;
  }
}

/**
 * The name Pokemon Showdown files a sprite under, or null if we cannot say.
 *
 * Forms carry their slug in the generated table, because only the generator has
 * PokeAPI's `form_name` and the species name cannot be split back out of
 * `charizard-mega-x` without guessing. A plain species needs no table: Showdown
 * is its English name with everything but letters and digits removed, and
 * `NAMES` has already been holding [Korean, English] pairs all along.
 *
 * Null below #650 on purpose. Every hole this tier exists to fill is above that
 * line, and stopping here means never having to decide what Showdown calls
 * Nidoran-female or Flabebe.
 */
export function showdownSlug(id: number): string | null {
  if (id <= BW_MAX_ID) return null;
  const form = formById(id);
  if (form) return form.slug;
  const en = NAMES[id]?.[1];
  return en ? en.toLowerCase().replace(/[^a-z0-9]/g, '') : null;
}

/**
 * Whether a GIF has more than one frame.
 *
 * Showdown answers 200 for a sprite it has not animated yet, handing back a
 * single-frame placeholder — 3KB against the 250KB of a real one. Taking that
 * would be strictly worse than the static PNG we already have: same stillness,
 * wrong palette, and no back view.
 *
 * A frame is announced by a Graphic Control Extension, the three bytes 21 F9 04.
 * Counting those needs no decoder and no dependency. Measured: the excadrill-mega
 * placeholder has 1, venusaur-mega has 71, gougingfire has 100.
 */
export function animatedGif(buf: Buffer): boolean {
  let frames = 0;
  for (let i = 0; i + 2 < buf.length; i += 1) {
    if (buf[i] === 0x21 && buf[i + 1] === 0xf9 && buf[i + 2] === 0x04) {
      frames += 1;
      if (frames > 1) return true;
    }
  }
  return false;
}

/**
 * Cache naming echoes the reference app's: 19-a.gif / 19-ash.gif / 19-s.png
 *
 * Back views get a trailing `b` so they cannot overwrite the front of the same
 * species: 667-wb.gif, 25-ashb.gif.
 */
function cacheName(id: number, kind: SpriteKind, shiny: boolean, back: boolean): string {
  const suffix = `${shiny ? 'sh' : ''}${back ? 'b' : ''}`;
  switch (kind) {
    case 'bw':
      return `${id}-a${suffix}.gif`;
    case 'showdown':
      return `${id}-w${suffix}.gif`;
    case 'sdani':
      return `${id}-z${suffix}.gif`;
    default:
      // `src/spriteName.ts` reads this shape to decide which sprites need an idle
      // animation drawn over them, and test/payload-shape.test.ts pins it.
      return `${id}-s${suffix}.png`;
  }
}

function spritesDir(): string {
  return path.join(appDataDir(), 'sprites');
}

/**
 * How long to wait on one asset before giving up.
 *
 * Without this a hung connection never settles, so buildState never resolves,
 * so the `inflight` promise it is stored in never clears — and the entire 20s
 * refresh loop stops for good. A missing sprite is a cosmetic problem; a frozen
 * app is not.
 */
const FETCH_TIMEOUT_MS = 8_000;

/**
 * Remember misses for a while.
 *
 * Plenty of species have no shiny variant at a given tier, and the chain walks
 * through those every build. Without a negative cache each one is a fresh round
 * trip on every refresh, forever, which is also the fastest way to get rate
 * limited by GitHub.
 */
const MISS_TTL_MS = 10 * 60_000;
const misses = new Map<string, number>();

/**
 * Remember REJECTED bodies for much longer than misses.
 *
 * A 404 is worth re-asking in ten minutes; upstream adds files. But a Showdown
 * placeholder becoming a real animation is a months-apart event, and re-asking
 * every ten minutes means pulling the same 3KB nothing down twenty-two times an
 * hour for the Z-A megas alone. Twelve hours still picks the change up on the
 * same day the app is open.
 */
const REJECT_TTL_MS = 12 * 60 * 60_000;
const rejects = new Map<string, number>();

/**
 * Downloads already running, keyed by cache name.
 *
 * Two callers wanting the same asset at the same time is the normal case now
 * that TM icons are per-type: a bag holding four Normal-type TMs asks for
 * tm-normal four times inside one Promise.all. Without this they raced on the
 * same temp path — one rename won, the rest threw and returned null, so a TM
 * would show up iconless for no visible reason.
 */
const inflight = new Map<string, Promise<string | null>>();

let tmpSeq = 0;

function stale(store: Map<string, number>, name: string, ttl: number): boolean {
  const at = store.get(name);
  if (at === undefined) return false;
  if (Date.now() - at < ttl) return true;
  store.delete(name);
  return false;
}

function recentlyMissed(name: string): boolean {
  return stale(misses, name, MISS_TTL_MS) || stale(rejects, name, REJECT_TTL_MS);
}

/**
 * Return a cached asset, downloading it once if missing.
 *
 * Sprites are Nintendo/Game Freak assets served by PokeAPI; they are fetched at
 * runtime and cached on this machine, never committed or redistributed.
 * Re-fetching on every render would also get us rate-limited by GitHub.
 */
async function cacheAsset(
  name: string,
  /**
   * Where to look, in order. One file, so the FIRST hit wins and the rest are
   * never asked for.
   *
   * A list rather than one URL because upstream files the same kind of art in
   * more than one place: PokeAPI keeps most item icons flat under `items/` but
   * put the Generation 8 and 9 ones in `items/gen8/` and `items/gen9/`
   * subfolders. The miss is recorded once, under the cache name, only after
   * every candidate has failed — recording it per URL would let the first 404
   * short-circuit the two that would have worked.
   */
  urls: string | string[],
  /**
   * Last say over a body that arrived with a 200.
   *
   * Only the `sdani` tier passes one, and only because Showdown answers 200 with
   * a placeholder for art it has not drawn. A rejected body is never written, so
   * the chain falls through exactly as it would have on a 404.
   */
  accept?: (buf: Buffer) => boolean,
): Promise<string | null> {
  const dest = path.join(spritesDir(), name);
  try {
    await fsp.access(dest);
    return name;
  } catch {
    // not cached yet
  }
  if (recentlyMissed(name)) return null;

  const running = inflight.get(name);
  if (running) return running;
  const p = download(name, dest, typeof urls === 'string' ? [urls] : urls, accept).finally(() =>
    inflight.delete(name),
  );
  inflight.set(name, p);
  return p;
}

async function download(
  name: string,
  dest: string,
  urls: string[],
  accept?: (buf: Buffer) => boolean,
): Promise<string | null> {
  // A body that arrived but was refused is remembered differently from one that
  // was never there — see REJECT_TTL_MS — so which of the two happened has to
  // survive the loop.
  let refused = false;
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (accept && !accept(buf)) {
        refused = true;
        continue;
      }
      await fsp.mkdir(spritesDir(), { recursive: true });
      // Same temp-then-rename rule as the state file: a half-written GIF that
      // survives on disk would never be retried. The counter keeps two writers in
      // one process off each other's temp file.
      const tmp = `${dest}.${process.pid}.${tmpSeq++}.tmp`;
      await fsp.writeFile(tmp, buf);
      await fsp.rename(tmp, dest);
      return name;
    } catch {
      // Timed out or the connection died. Try the next place; if there is none,
      // this falls out of the loop into the miss below, as it always did.
    }
  }
  (refused ? rejects : misses).set(name, Date.now());
  return null;
}

function fetchOne(
  id: number,
  kind: SpriteKind,
  shiny: boolean,
  back = false,
): Promise<string | null> {
  const url = spriteUrl(id, kind, shiny, back);
  // No slug means this tier cannot be asked at all — an absent tier, not a miss,
  // so nothing is recorded and the chain simply moves on.
  if (url === null) return Promise.resolve(null);
  return cacheAsset(
    cacheName(id, kind, shiny, back),
    url,
    kind === 'sdani' ? animatedGif : undefined,
  );
}

/**
 * Return a cached sprite, walking the source chain until one works.
 *
 * #1-649 get the retro Gen-5 art; everything above falls through to PokeAPI's
 * Showdown mirror, then to Showdown itself where the mirror has a hole, and a
 * static PNG catches whatever is left. A species that has no shiny variant at one
 * tier also falls through rather than showing nothing.
 */
/**
 * The flat 96x96 PNG, specifically.
 *
 * The tray needs a still frame at a predictable canvas size: nativeImage cannot
 * animate a GIF, and the layered chain would hand back a Showdown sprite whose
 * size varies wildly.
 */
export async function ensureStaticSprite(id: number, shiny = false): Promise<string | null> {
  return (await fetchOne(id, 'static', shiny)) ?? (shiny ? fetchOne(id, 'static', false) : null);
}

export function spritePath(name: string): string {
  return path.join(spritesDir(), name);
}

export async function ensureSprite(
  id: number,
  shiny = false,
  back = false,
): Promise<string | null> {
  const start = id <= BW_MAX_ID ? 0 : 1; // skip BW entirely above #649
  for (const kind of CHAIN.slice(start)) {
    const name = await fetchOne(id, kind, shiny, back);
    if (name) return name;
  }
  // Shiny may be missing where the plain form exists. `back` MUST be carried
  // through: dropping it here hands back a front sprite, which in the battle
  // scene means the companion turns around and faces the camera.
  return shiny ? ensureSprite(id, false, back) : null;
}

/** Fetch-and-cache the egg sprite. Same runtime-fetch rule as every other asset. */
export function ensureEggSprite(): Promise<string | null> {
  return cacheAsset(EGG_CACHE, EGG_URL);
}

/**
 * Where PokeAPI files item icons. Flat first, because that is where 905 of the
 * 969 live and where every TM icon is.
 *
 * The two subfolders are not a fallback in the sense the sprite chain uses the
 * word — they hold DIFFERENT items, not lesser copies of the same one. Measured:
 * the three directories share no filename at all. Generation 8 put eight items
 * in `gen8/`, and Generation 9 put fifty-six in `gen9/` — including every one of
 * the forty-five Legends Z-A Mega Stones, the three Ogerpon masks and the clear
 * amulet, all of which this app drew a placeholder glyph for until it learned to
 * look here.
 */
const ITEM_DIRS = ['', 'gen9/', 'gen8/'];

/**
 * pokesprite, for the two items PokeAPI has in none of the three directories.
 *
 * The same host as everything else — a second repository on raw.githubusercontent,
 * not a new place to reach — filed by item category rather than flat, which is
 * why these two are written down instead of derived. Both were checked by hand;
 * so were the four that are NOT here, and they stay on the glyph: the two
 * Generation 9 armours and the two scrolls exist in no icon set this project can
 * reach.
 *
 * PokeAPI is still asked first, so the day it picks either of these up, upstream
 * wins and this table quietly stops mattering.
 */
const POKESPRITE = 'https://raw.githubusercontent.com/msikma/pokesprite/master/items';

const ITEM_ELSEWHERE: Record<string, string> = {
  'dynamax-band': `${POKESPRITE}/key-item/dynamax-band.png`,
  'reins-of-unity': `${POKESPRITE}/key-item/reins-of-unity.png`,
};

/**
 * Every place an item icon might be, in the order they are asked for.
 *
 * Exported because `scripts/gen-legends.ts` records whether an icon EXISTS, and
 * the two answers have to be the same list: an icon the generator says is there
 * but the app never looks for is a permanent blank in the bag.
 */
export function itemSpriteUrls(slug: string): string[] {
  const here = ITEM_ELSEWHERE[slug];
  return [...ITEM_DIRS.map((dir) => `${BASE}/items/${dir}${slug}.png`), ...(here ? [here] : [])];
}

/**
 * Shop/bag item icons, e.g. 'rare-candy' -> item-rare-candy.png
 *
 * Also serves TM icons, which are per-type: 'tm-fire', 'tm-psychic', ... All
 * eighteen exist upstream; 'tm-unknown' does not, so never ask for it.
 *
 * One cache name across all the candidates, which is safe precisely because the
 * three directories share no filename: the slug alone still identifies the file.
 */
export function ensureItemSprite(slug: string): Promise<string | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return Promise.resolve(null);
  return cacheAsset(`item-${slug}.png`, itemSpriteUrls(slug));
}

/**
 * A battle backdrop, e.g. 'volcanocave' -> bg-volcanocave.png
 *
 * Cached into the same directory as the sprites on purpose: readSprite,
 * cacheStats, pruneCache and the petsprite:// scheme then cover it with no new
 * plumbing, and `bg-` cannot collide with the `{id}-{kind}` sprite names.
 */
export function ensureBackground(slug: string | null): Promise<string | null> {
  // Null is an ordinary answer, not a miss: the journey leaves `sky` null for
  // anywhere with no obvious backdrop, and the scene keeps its flat sky colour.
  if (slug === null || !/^[a-z0-9]+$/.test(slug)) return Promise.resolve(null);
  return cacheAsset(`bg-${slug}.png`, `${BG_BASE}/bg-${slug}.png`);
}

/**
 * A move's impact art — the particle sprites that sit on top of a battle.
 *
 * Siblings of the backdrops above, in the same directory on the same host, so
 * this adds no new source and inherits the same rule: fetched on demand, cached
 * on this machine, never committed. Eighteen of them, one per type, averaging
 * 4KB — a fifth of what the backdrops cost.
 *
 * A miss is cosmetic here too, and more cheaply so than for a backdrop: the
 * scene simply plays the beat without an effect, which is exactly what it did
 * before this existed.
 *
 * The `fx-` prefix keeps the flat cache namespace readSprite insists on, and
 * cannot collide with `bg-` or with the `{id}-{kind}` sprite names. Hyphens are
 * allowed where ensureBackground forbids them — some of the upstream filenames
 * carry one.
 */
export function ensureEffect(slug: string): Promise<string | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return Promise.resolve(null);
  return cacheAsset(`fx-${slug}.png`, `${BG_BASE}/${slug}.png`);
}

/**
 * A person, e.g. 'waitress' -> npc-waitress.png
 *
 * The `npc-` prefix keeps the flat cache namespace readSprite insists on and
 * cannot collide with `item-`, `bg-`, `fx-` or the `{id}-{kind}` sprite names.
 *
 * A miss is cosmetic by construction: the shop draws its counter in CSS, so a
 * clerk that never arrives leaves a counter with nobody behind it and every
 * word and price still on screen.
 */
export function ensureNpcSprite(slug: string): Promise<string | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return Promise.resolve(null);
  return cacheAsset(`npc-${slug}.png`, `${NPC_BASE}/${slug}.png`);
}

/**
 * A gym badge, e.g. 3 -> badge-3.png
 *
 * PokeAPI's sprite repository carries no people, which is the wall
 * `ensureNpcSprite` above works around — but it does carry the badges, filed
 * as bare numbers under `badges/`. Seventy-seven of them, ordered by region and
 * then by gym, so **1..8 are Kanto's eight in gym order** and server/gyms.ts can
 * key on the badge number and needs no slug at all. About 85x85 each, 2-7KB;
 * eight files, once, ever.
 *
 * The `badge-` prefix keeps the flat cache namespace readSprite insists on and
 * cannot collide with `item-`, `npc-`, `bg-`, `fx-` or the `{id}-{kind}` names.
 *
 * Same rule as every other Game Freak asset here, and the rule this whole
 * project rests on: fetched on demand, cached on this machine, never committed.
 * `test/payload-shape.test.ts` fails if a `badge-*` file appears in the repo.
 *
 * A miss is cosmetic: the case draws an empty slot, which is what it draws for
 * a badge not yet earned anyway.
 */
export function ensureBadgeSprite(n: number): Promise<string | null> {
  if (!Number.isInteger(n) || n < 1 || n > 77) return Promise.resolve(null);
  return cacheAsset(`badge-${n}.png`, `${BASE}/badges/${n}.png`);
}

export async function readSprite(name: string): Promise<Buffer | null> {
  // Defend the static file route against traversal.
  if (!/^[\w.-]+$/.test(name)) return null;
  try {
    return await fsp.readFile(path.join(spritesDir(), name));
  } catch {
    return null;
  }
}

export function contentTypeFor(name: string): string {
  return name.endsWith('.gif') ? 'image/gif' : 'image/png';
}

/**
 * How much disk the cache is using.
 *
 * The battle scene shows whichever wild Pokemon turned up, so over months of
 * hunting this converges on the whole dex — roughly 36MB. Small, but the user
 * should be able to see it rather than discover it.
 */
export async function cacheStats(): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  try {
    for (const name of await fsp.readdir(spritesDir())) {
      if (name.endsWith('.tmp')) continue;
      try {
        bytes += (await fsp.stat(path.join(spritesDir(), name))).size;
        files += 1;
      } catch {
        // vanished mid-scan; nothing to count
      }
    }
  } catch {
    return { bytes: 0, files: 0 };
  }
  return { bytes, files };
}

/**
 * Delete cached sprites, keeping the ones currently on screen.
 *
 * Wiping everything would leave the panel blank until the next refresh
 * re-downloads them, which reads as breakage rather than housekeeping.
 * Also drops the negative cache so a cleared miss can be retried at once.
 */
export async function pruneCache(keep: Iterable<string>): Promise<{ removed: number; bytes: number }> {
  const spared = new Set(keep);
  let removed = 0;
  let bytes = 0;
  let names: string[];
  try {
    names = await fsp.readdir(spritesDir());
  } catch {
    return { removed: 0, bytes: 0 };
  }
  for (const name of names) {
    if (spared.has(name)) continue;
    const file = path.join(spritesDir(), name);
    try {
      bytes += (await fsp.stat(file)).size;
      await fsp.rm(file, { force: true });
      removed += 1;
    } catch {
      // already gone, or held open — skip it
    }
  }
  misses.clear();
  // Clearing the cache by hand is a request to look again, and a rejection
  // outlives a miss by twelve hours otherwise.
  rejects.clear();
  return { removed, bytes };
}
