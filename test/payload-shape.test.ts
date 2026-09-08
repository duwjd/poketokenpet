import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NAMES } from '../server/species.ts';
import { TYPES } from '../server/moves.ts';
import { DEFAULT_FX, effectFor } from '../server/movefx.ts';
import { BG_SLUGS } from '../server/biome.ts';
import { STOPS } from '../src/journey.ts';

/**
 * The dev server and the packaged Electron app serve the same /api/state shape.
 * They once held two hand-copied builders, and adding `dexTotal` to only one of
 * them shipped an app that rendered "12 / undefined종". These tests pin the
 * single-builder invariant so that cannot come back.
 */
describe('state payload', () => {
  const surfaces = ['server/plugin.ts', 'electron/main.ts'];

  it('is built in exactly one place', () => {
    const definitions = surfaces.filter((f) =>
      /(^|\n)\s*(export\s+)?async function buildState\b/.test(readFileSync(f, 'utf8')),
    );
    expect(definitions).toEqual([]);
  });

  it('is imported by every surface that serves it', () => {
    for (const f of surfaces) {
      expect(readFileSync(f, 'utf8')).toMatch(/import \{[^}]*\bbuildState\b[^}]*\} from '\.[./]*\/?(server\/)?state\.ts'/);
    }
  });

  it('reports a dex denominator that matches the species table', () => {
    const src = readFileSync('server/state.ts', 'utf8');
    // Derived, not a literal — a hardcoded 1025 would silently rot.
    expect(src).toMatch(/dexTotal:\s*Object\.keys\(NAMES\)\.length/);
    expect(Object.keys(NAMES)).toHaveLength(1025);
  });

  /**
   * The dex used to store a fused companion's form and then never look at it —
   * `retireInto` wrote `formId`, the comment promised the card would show it,
   * and the payload resolved neither the name nor the sprite from it.
   */
  it('resolves a dex entry through its form, not only its species', () => {
    const src = readFileSync('server/state.ts', 'utf8');
    const block = src.slice(src.indexOf('    dex: await Promise.all('), src.indexOf('    dexTotal:'));
    expect(block).toContain('formById(d.formId)');
    expect(block).toContain('form?.ko ?? speciesName(d.speciesId)');
    expect(block).toContain('ensureSprite(form?.id ?? d.speciesId');
    // ...but the things every filter rests on stay on the base species.
    expect(block).toContain('rarityOfSpecies(d.speciesId)');
    expect(block).toContain('generationOf(d.speciesId)');
  });

  /**
   * `keepSprites` pins what is on screen. It maps `d.sprite`, which is now the
   * FORM's art, so a cache purge cannot delete the picture the card is drawing.
   */
  it('pins whatever art the dex actually drew', () => {
    const src = readFileSync('server/state.ts', 'utf8');
    expect(src).toContain('...payload.dex.map((d) => d.sprite)');
  });

  it('offers the same actions on both surfaces', () => {
    // Teaching only in Electron, or buying only on the web, is exactly the
    // drift this file exists to catch.
    const actions = (file: string) =>
      new Set([...readFileSync(file, 'utf8').matchAll(/action === '(\w+)'/g)].map((m) => m[1]));
    expect([...actions('server/plugin.ts')].sort()).toEqual([...actions('electron/main.ts')].sort());
    expect(actions('server/plugin.ts')).toContain('teach');
    expect(actions('server/plugin.ts')).toContain('rename');
  });
});

/**
 * The progression sum used to be spelled out in three places that agreed only
 * by accident. Adding a term to one of them corrupts `eggStartedAt`, which
 * turns the most expensive product in the shop into a free instant hatch.
 */
/**
 * The tray app used to rescan the whole transcript corpus every 20 seconds —
 * 1.2 GB and ~3s, for as long as it ran. buildState must go through the
 * incremental scanner, or that cost comes straight back.
 */
describe('transcript scanning', () => {
  it('builds state from the incremental scanner, not a full rescan', () => {
    const src = readFileSync('server/state.ts', 'utf8');
    expect(src).toMatch(/createScanner/);
    // scanAll survives as the oracle and the escape hatch, so it may be
    // mentioned — but only behind the FULL_SCAN switch.
    expect(src).toMatch(/FULL_SCAN\s*\?\s*await scanAll\(\)\s*:\s*await scanner\.scan\(\)/);
  });

  it('declares the cache TTL exactly once', () => {
    // It lived as a literal in both surfaces, which is precisely the kind of
    // silent drift this file exists to prevent.
    for (const f of ['server/plugin.ts', 'electron/main.ts']) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/REFRESH_MS\s*=/);
    }
    expect(readFileSync('server/state.ts', 'utf8')).toMatch(/export const REFRESH_MS\s*=/);
  });

  it('keeps a rollback that works from a packaged app', () => {
    // A GUI app launched from Finder inherits no shell environment (see
    // server/paths.ts), so an env var alone would be unreachable there.
    expect(readFileSync('server/state.ts', 'utf8')).toMatch(/full-scan/);
  });
});

/**
 * Korean particles are chosen, never printed as a placeholder.
 *
 * "잉어킹이(가) 나타났다" is a form the games never show. src/josa.ts is
 * deliberately absent from this list: its doc comment quotes that very string as
 * the counter-example, and the comment is the most useful thing in the file. An
 * explicit list rather than a directory walk is what keeps that exception honest.
 */
describe('korean particles', () => {
  it('never ships a placeholder form', () => {
    const files = [
      'src/App.tsx',
      'src/Scene.tsx',
      'src/PetApp.tsx',
      'server/shop.ts',
      'server/hunt.ts',
      'server/game.ts',
      'server/trainer.ts',
      'server/state.ts',
    ];
    for (const f of files) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(
        /을\(를\)|를\(을\)|은\(는\)|는\(은\)|이\(가\)|가\(이\)|와\(과\)|과\(와\)|\(으\)로/,
      );
    }
  });
});

describe('progression currency', () => {
  it('is summed in exactly one place', () => {
    const files = ['server/game.ts', 'server/state.ts', 'server/shop.ts', 'server/hunt.ts'];
    const spelledOut = files.filter((f) =>
      /lifetimeEarned\s*\+\s*\w*\.?bonusTokens/.test(readFileSync(f, 'utf8')),
    );
    expect(spelledOut).toEqual(['server/game.ts']);
  });

  it('is what the egg anchor uses', () => {
    expect(readFileSync('server/shop.ts', 'utf8')).toMatch(/eggStartedAt = lifetimeOf\(state\)/);
  });
});

/**
 * A cache purge must be derived from the payload, not from a hand-written list
 * that drifts the moment a new sprite kind is added.
 */
describe('sprite cache purge', () => {
  it('spares whatever the payload references', () => {
    const src = readFileSync('server/state.ts', 'utf8');
    expect(src).toMatch(/const keepSprites = \[/);
    // Every sprite-bearing branch of the payload has to be in the keep list.
    for (const field of [
      'companion?.sprite',
      'companion?.backSprite',
      'eggSprite',
      'wildSprite',
      // The hunt log's row thumbnails — a purge would blank an open 기록 tab.
      'log.map((e) => e.icon)',
      // A purge that deletes these empties an open Pokedex.
      'payload.dex.map',
      // A trainer's whole team is on screen one after another.
      'trainerFight?.team',
    ]) {
      expect(src.slice(src.indexOf('const keepSprites')), field).toContain(field);
    }
  });

  it('is offered by both surfaces and clears the cached payload', () => {
    for (const f of ['server/plugin.ts', 'electron/main.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).toMatch(/async function clearSprites/);
      // Without this the readout keeps showing the pre-purge size.
      expect(src.slice(src.indexOf('async function clearSprites')), f).toMatch(/cache = null/);
    }
  });
});

/**
 * A trainer's reward must not reach the wallet, and must not hand over anything
 * that credits bonusTokens — huntCap only caps huntTokens.
 */
describe('trainer rewards', () => {
  it('never grant a Rare Candy', () => {
    const src = readFileSync('server/trainer.ts', 'utf8');
    expect(src).toMatch(/'shiny-charm' \| 'everstone'/);
    expect(src).not.toMatch(/'rare-candy'/);
  });

  it('never touch the wallet', () => {
    // lifetimeEarned is the wallet; hunting may only credit huntTokens.
    for (const f of ['server/trainer.ts', 'server/hunt.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/lifetimeEarned\s*[:+]?=/);
      expect(src, f).not.toMatch(/spentTokens\s*[:+-]?=/);
    }
  });
});

/**
 * The full dex index is ~116KB and completely static. It must not ride along on
 * the state payload, which goes over the wire every twenty seconds.
 */
describe('dex index', () => {
  it('is served by both surfaces, and separately from the state payload', () => {
    expect(readFileSync('server/plugin.ts', 'utf8')).toMatch(/\/api\/dex/);
    expect(readFileSync('electron/main.ts', 'utf8')).toMatch(/pet:dexIndex/);
    // Not a payload field.
    const state = readFileSync('server/state.ts', 'utf8');
    const payload = state.slice(state.indexOf('const payload = {'), state.indexOf('const keepSprites'));
    expect(payload).not.toMatch(/dexIndex\(\)/);
  });
});

describe('dex entry', () => {
  const plugin = () => readFileSync('server/plugin.ts', 'utf8');

  it('is built in exactly one place, and both surfaces import it', () => {
    for (const f of ['server/plugin.ts', 'electron/main.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/(^|\n)\s*(export\s+)?async function dexEntry\b/);
      expect(src, f).toMatch(/dexEntry.*from '.*dexentry\.ts'/s);
    }
  });

  /**
   * '/api/dex/25' also satisfies startsWith('/api/dex').
   *
   * With the two routes the other way round every detail request is answered
   * with the whole 116KB index and no error is raised anywhere — the response
   * is a perfectly valid JSON array, just of the wrong thing.
   */
  it('answers a species before it answers the index', () => {
    const src = plugin();
    const entry = src.indexOf("startsWith('/api/dex/')");
    const index = src.indexOf("url === '/api/dex'");
    expect(entry).toBeGreaterThan(-1);
    expect(index).toBeGreaterThan(-1);
    expect(entry).toBeLessThan(index);
  });

  it('matches the index exactly, so order is not the only thing keeping it right', () => {
    expect(plugin()).toMatch(/url === '\/api\/dex' \|\| url\.startsWith\('\/api\/dex\?'\)/);
  });

  it('never caches an entry — half of it is the player\'s own record', () => {
    const src = plugin();
    const block = src.slice(src.indexOf("startsWith('/api/dex/')"), src.indexOf("url === '/api/dex'"));
    expect(block).toMatch(/no-store/);
    expect(block).not.toMatch(/max-age/);
  });

  /**
   * 183KB of dex prose, of which buildState reads not one word.
   *
   * Keeping server/dexdata.ts out of state.ts's import graph is the entire
   * reason the entry is served separately rather than folded into the payload.
   */
  it('keeps the dex prose out of the twenty-second payload', () => {
    expect(readFileSync('server/state.ts', 'utf8')).not.toMatch(/dexdata\.ts/);
  });

  /**
   * The one rule the base-stat table must never break.
   *
   * Baking 종족값 for a screen is one keystroke away from "and the battle could
   * use them too", and that keystroke moves every number in test/hunt.ts's
   * GOLDEN tables. docs/DESIGN.md `### 전투 보정을 지어내지 않았습니다` is the promise;
   * this is the lock on it.
   */
  it('never lets a base stat into a fight', () => {
    for (const f of ['server/hunt.ts', 'server/game.ts', 'server/state.ts']) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/dexdata\.ts/);
    }
  });

  /** The renderer cannot resolve a form id, so it must never be sent one. */
  it('sends the form as Korean text, never as an id', () => {
    const src = readFileSync('server/dexentry.ts', 'utf8');
    expect(src).toMatch(/formKo/);
    expect(src).not.toMatch(/formId:/);
  });
});

/**
 * server/moves.ts is 91KB of generated table and server/hunt.ts pulls it in.
 * Neither belongs in the renderer bundle — buildState resolves move names into
 * the payload instead, the same way it resolves species names.
 */
describe('renderer bundle', () => {
  it('never reaches for the generated tables', () => {
    const sources = [
      'src/App.tsx',
      'src/PetApp.tsx',
      'src/Scene.tsx',
      'src/scenes.ts',
      'src/terrain.ts',
      'src/timeOfDay.ts',
      'src/battleui.ts',
      'src/api.ts',
      'src/main.tsx',
    ];
    for (const f of sources) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/from '.*server\/(moves|hunt|species|game)\.ts'/);
    }
  });
});

/**
 * The regions are real pixel art cropped from a CC0 tileset. Their provenance
 * has to survive in the repo — CC0 needs no attribution, but a later reader must
 * be able to check where a committed binary came from.
 */
describe('scene art', () => {
  const sheets = readdirSync('src/scenes').filter((f) => f.endsWith('.png'));

  it('records where the art came from', () => {
    const gen = readFileSync('scripts/gen-grass.ts', 'utf8');
    expect(gen).toMatch(/opengameart\.org\/content\/overworld-grass-biome/);
    // The town band comes from a second CC0 pack — a deliberate reversal of the
    // one-tileset rule, so its provenance has to be recorded just as loudly.
    expect(gen).toMatch(/opengameart\.org\/content\/rpg-town-pixel-art-assets/);
    // 동굴 · 산길 · 유적, and 바닷가. Same obligation.
    expect(gen).toMatch(/opengameart\.org\/content\/tiny-rpg-mountain-tileset/);
    expect(gen).toMatch(/opengameart\.org\/content\/16x16-overworld-tiles-0/);
    expect(gen).toMatch(/CC0/);
  });

  it('accounts for every tileset it actually downloads', () => {
    // The rule that keeps the two above honest as sources are added: a pack may
    // not be fetched unless the header says where it came from. Reads the URLs
    // out of SOURCES rather than listing them here, so adding a fifth pack and
    // forgetting to document it fails rather than passing quietly.
    const gen = readFileSync('scripts/gen-grass.ts', 'utf8');
    const sources = gen.slice(gen.indexOf('const SOURCES = {'), gen.indexOf('type SourceId'));
    const urls = [...sources.matchAll(/url: '([^']+)'/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThanOrEqual(4);
    const header = gen.slice(0, gen.indexOf('const SOURCES = {'));
    for (const url of urls) expect(header, url).toContain(url);
  });

  it('keeps the no-attribution property it is relying on', () => {
    // NOTICE.md's attribution table says there is no credits screen because nothing here
    // requires one. Two of the four packs declare CC0 on OpenGameArt but ship a
    // license.txt that never says the word, so the generator quotes it instead —
    // and the clause that matters is the one granting that no credit is owed.
    expect(readFileSync('scripts/gen-grass.ts', 'utf8')).toMatch(
      /Credit no required but appreciated it\./,
    );
  });

  it('keeps the journey free of unverified names', () => {
    // A place with no checked Korean name is dropped rather than printed as a
    // slug. The generator says so; this is what stops that decaying.
    const gen = readFileSync('scripts/gen-journey.ts', 'utf8');
    expect(gen).toMatch(/pokeapi/i);
    expect(readFileSync('src/journey.ts', 'utf8')).not.toMatch(/'[a-z-]+-city'/);
  });

  it('ships a sheet for every region and nothing else', () => {
    // A region with no sheet renders an empty band rather than failing loudly,
    // and a sheet with no region is a committed binary nothing accounts for.
    const gen = readFileSync('scripts/gen-grass.ts', 'utf8');
    expect(sheets.length).toBeGreaterThan(1);
    for (const f of sheets) {
      const id = f.replace(/\.png$/, '');
      expect(readFileSync('src/terrain.ts', 'utf8'), id).toMatch(new RegExp(`'${id}'`));
      expect(gen, id).toMatch(new RegExp(`\\b${id}: \\{`));
    }
  });

  it('stays small enough for Vite to inline it', () => {
    // Over 4096 bytes Vite emits a separate file, which the packaged app then
    // has to resolve over file:// — the exact class of bug `base: './'` exists
    // to avoid. Keeping it inline sidesteps the question entirely.
    for (const f of sheets) {
      expect(statSync(`src/scenes/${f}`).size, f).toBeLessThan(4096);
    }
  });

  it('asks only for backdrops that exist upstream', () => {
    // src/journey.ts declares its own SkyId union rather than importing one:
    // it is renderer-side and server/biome.ts is not. That leaves two lists to
    // drift apart, and the value is interpolated into a URL and a cache
    // filename, so a slug that is not really there 404s on every payload.
    const src = readFileSync('src/journey.ts', 'utf8');
    const union = src.slice(src.indexOf('export type SkyId ='));
    const declared = [...union.slice(0, union.indexOf(';')).matchAll(/'([a-z0-9]+)'/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);
    for (const id of declared) expect(BG_SLUGS as readonly string[], id).toContain(id);
    // And every stop's sky must be one of the ones declared, or null.
    for (const stop of STOPS) {
      if (stop.sky !== null) expect(declared, stop.ko).toContain(stop.sky);
    }
  });

  it('never commits a battle backdrop or a move effect', () => {
    // The opposite rule to the one above, and the reason both exist. The Gen-5
    // backdrops and the impact art are Game Freak's; server/sprites.ts fetches
    // them at runtime into ~/.poketokenpet and nothing may check one in beside
    // the CC0 art. Both prefixes, because both come off the same host.
    for (const dir of ['src', 'src/scenes', 'public']) {
      const files = readdirSync(dir);
      expect(files.filter((f) => f.startsWith('bg-')), dir).toEqual([]);
      expect(files.filter((f) => f.startsWith('fx-')), dir).toEqual([]);
    }
    expect(readFileSync('server/sprites.ts', 'utf8')).toMatch(/never committed/);
  });

  it('sends the nature in Korean, not as a slug', () => {
    // App.tsx prints companion.nature straight out, so whatever the payload
    // says is what a Korean reader sees. It used to say "sassy".
    const src = readFileSync('server/state.ts', 'utf8');
    expect(src).toMatch(/nature: NATURE_KO\[active\.nature\]/);
    // And the renderer must not have grown its own copy of the table.
    expect(readFileSync('src/App.tsx', 'utf8')).not.toMatch(/NATURE_KO/);
  });

  it('has impact art for every type, and keeps it off the purge list', () => {
    // A slug is interpolated into a URL and a cache filename, so the table has
    // to be total and every entry has to survive ensureEffect's guard.
    expect(TYPES).toHaveLength(18);
    for (const t of TYPES) {
      expect(effectFor(t), t).toMatch(/^[a-z0-9-]+$/);
    }
    // An unknown nineteenth type degrades to a plain hit rather than to nothing.
    expect(effectFor('brandnew')).toBe(DEFAULT_FX);
    // Without this a cache purge deletes an effect mid-animation.
    const src = readFileSync('server/state.ts', 'utf8');
    expect(src.slice(src.indexOf('const keepSprites'))).toContain('Object.values(fx)');
  });

  it('defines each scroll distance once, from the strip width', () => {
    // A keyframe that moves by anything other than one strip width shows a jump
    // every cycle, so the number must not be typed out a second time in CSS.
    // Only the panel scrolls grass now; the floating pet shows the Pokemon alone.
    const css = readFileSync('src/Scene.css', 'utf8');
    const keyframes = css.slice(css.indexOf('@keyframes grass'));
    expect(keyframes).toMatch(/var\(--grass-\w+-w\)/);
    expect(readFileSync('src/PetApp.css', 'utf8')).not.toMatch(/pet-grass/);
  });

  it('keeps index.html a source entry point, not a build artifact', () => {
    // A built index.html has been copied over this file before, which breaks
    // `vite build` with a confusing "Failed to resolve ./assets/index-<hash>.js"
    // and is easy to miss on sight: `base: './'` (vite.config.ts) makes the
    // built HTML use RELATIVE asset paths, which read like plausible source
    // paths, unlike Vite's default absolute '/assets/...'.
    //
    // Nothing else catches it. electron-builder's `files` is an allowlist that
    // never packages this file, so `app:pack` keeps succeeding while the build
    // is broken.
    const html = readFileSync('index.html', 'utf8');
    expect(html).toMatch(/src="\/src\/main\.tsx"/);
    expect(html).not.toMatch(/\.\/assets\/index-/);
  });

  it('draws its own battle chrome rather than shipping a rip', () => {
    // There is no Creative Commons version of the real battle UI and there
    // cannot be, so the frames are a reproduction. The generator has to say so.
    const gen = readFileSync('scripts/gen-ui.ts', 'utf8');
    expect(gen).toMatch(/never committed/);
    for (const f of ['src/ui-window.png', 'src/ui-plate.png', 'src/ui-bang.png', 'src/ui-sign.png']) {
      expect(statSync(f).size, f).toBeLessThan(4096);
    }
  });
});
