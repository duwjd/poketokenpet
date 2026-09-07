import fsp from 'node:fs/promises';
import path from 'node:path';
import { appDataDir } from './paths.ts';

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
const NPC_BASE = 'https://play.pokemonshowdown.com/sprites/trainers';

/** Gen-5 Black/White animated sprites stop at #649. */
export const BW_MAX_ID = 649;

/**
 * Sprite sources, tried in order.
 *
 * `bw` is the retro Gen-5 pixel art — small, crisp, and what most people picture —
 * but it stops at #649. `showdown` covers all 1025 species plus shiny in the same
 * animated spirit at a larger size, so newer Pokemon still move. `static` is the
 * 96x96 PNG that always exists.
 */
export type SpriteKind = 'bw' | 'showdown' | 'static';

const CHAIN: SpriteKind[] = ['bw', 'showdown', 'static'];

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
function spriteUrl(id: number, kind: SpriteKind, shiny: boolean, back: boolean): string {
  const dir = `${back ? 'back/' : ''}${shiny ? 'shiny/' : ''}`;
  switch (kind) {
    case 'bw':
      return `${BASE}/pokemon/versions/generation-v/black-white/animated/${dir}${id}.gif`;
    case 'showdown':
      return `${BASE}/pokemon/other/showdown/${dir}${id}.gif`;
    default:
      return `${BASE}/pokemon/${dir}${id}.png`;
  }
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
    default:
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

function recentlyMissed(name: string): boolean {
  const at = misses.get(name);
  if (at === undefined) return false;
  if (Date.now() - at < MISS_TTL_MS) return true;
  misses.delete(name);
  return false;
}

/**
 * Return a cached asset, downloading it once if missing.
 *
 * Sprites are Nintendo/Game Freak assets served by PokeAPI; they are fetched at
 * runtime and cached on this machine, never committed or redistributed.
 * Re-fetching on every render would also get us rate-limited by GitHub.
 */
async function cacheAsset(name: string, url: string): Promise<string | null> {
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
  const p = download(name, dest, url).finally(() => inflight.delete(name));
  inflight.set(name, p);
  return p;
}

async function download(name: string, dest: string, url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      misses.set(name, Date.now());
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await fsp.mkdir(spritesDir(), { recursive: true });
    // Same temp-then-rename rule as the state file: a half-written GIF that
    // survives on disk would never be retried. The counter keeps two writers in
    // one process off each other's temp file.
    const tmp = `${dest}.${process.pid}.${tmpSeq++}.tmp`;
    await fsp.writeFile(tmp, buf);
    await fsp.rename(tmp, dest);
    return name;
  } catch {
    misses.set(name, Date.now());
    return null;
  }
}

function fetchOne(
  id: number,
  kind: SpriteKind,
  shiny: boolean,
  back = false,
): Promise<string | null> {
  return cacheAsset(cacheName(id, kind, shiny, back), spriteUrl(id, kind, shiny, back));
}

/**
 * Return a cached sprite, walking the source chain until one works.
 *
 * #1-649 get the retro Gen-5 art; everything above falls through to Showdown so
 * it still animates; static PNG catches whatever is left. A species that has no
 * shiny variant at one tier also falls through rather than showing nothing.
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
 * Shop/bag item icons, e.g. 'rare-candy' -> item-rare-candy.png
 *
 * Also serves TM icons, which are per-type: 'tm-fire', 'tm-psychic', ... All
 * eighteen exist upstream; 'tm-unknown' does not, so never ask for it.
 */
export function ensureItemSprite(slug: string): Promise<string | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return Promise.resolve(null);
  return cacheAsset(`item-${slug}.png`, `${BASE}/items/${slug}.png`);
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
  return { removed, bytes };
}
