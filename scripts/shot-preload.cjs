/**
 * Preload for the screenshot runner. Not shipped — see scripts/gen-shots.ts.
 *
 * Runs before any document script, which is the whole reason this is a preload
 * and not an injected <script>: src/main.tsx reads the hash and mounts on
 * import, so anything that needs to be in place first has to be here.
 *
 * Three jobs, all of them about making the picture the SAME picture every time.
 */
const fs = require('node:fs');

const arg = process.argv.find((a) => a.startsWith('--shot-data='));
if (!arg) throw new Error('shot-preload: no --shot-data= argument');
const DATA = JSON.parse(fs.readFileSync(arg.slice('--shot-data='.length), 'utf8'));

/** Which of the two states to serve. shot-app.mjs flips this to fire the battle. */
window.__shot = { state: 'A' };

const json = (body) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const realFetch = window.fetch.bind(window);

window.fetch = async (input, init) => {
  const url = String(input && input.url ? input.url : input);
  const path = url.startsWith('http') ? new URL(url).pathname + new URL(url).search : url;

  if (path.startsWith('/api/state')) {
    return json(window.__shot.state === 'B' ? DATA.stateB : DATA.stateA);
  }
  /*
   * Order matters and is not a style choice: '/api/dex/6' also satisfies
   * startsWith('/api/dex'). server/plugin.ts:173 guards the same trap in the
   * real middleware and test/ui/tabs.test.tsx:22 documents it. Get this
   * backwards and the entry screen receives an array where it expects a
   * DexDetail — which renders wrong but plausible, the worst kind of wrong.
   */
  if (path.startsWith('/api/dex/')) return json(DATA.entry);
  if (path === '/api/dex' || path.startsWith('/api/dex?')) return json(DATA.index);
  if (path.startsWith('/api/shop')) return json({ ok: true, message: '' });
  if (path.startsWith('/api/')) throw new Error('shot-preload: unstubbed API route ' + path);

  /*
   * Everything else falls through, and /sprites/* MUST.
   *
   * src/spriteBox.ts:31 fetches the sprite, reads it as a blob and calls
   * createImageBitmap to size the window. Swallow that and measureSprite never
   * resolves, so every sprite stays visibility:hidden and the pet window is an
   * empty div — a blank PNG with no error anywhere.
   */
  return realFetch(input, init);
};

/**
 * Freeze the clock.
 *
 * src/App.tsx passes timeOfDayAt(new Date()) to the Scene and src/timeOfDay.ts
 * buckets on getHours(), so the scene's entire colour grade depends on what
 * time of day the generator happened to run. 13:24 KST lands in 'day'.
 * toLocaleDateString/toLocaleTimeString on the dex and settings tabs are
 * timezone-sensitive for the same reason; the runner also pins TZ.
 *
 * React 19's scheduler uses performance.now(), not Date.now(), so this does not
 * stall rendering.
 */
const FIXED = Date.parse('2026-08-21T13:24:00+09:00');
const RealDate = Date;
const FakeDate = new Proxy(RealDate, {
  construct: (Target, args) => (args.length ? new Target(...args) : new Target(FIXED)),
});
FakeDate.now = () => FIXED;
window.Date = FakeDate;

/**
 * Neutralise reduced motion.
 *
 * src/Scene.tsx:266 jumps the reducer straight to the reward beat when this
 * matches, so on a machine with "Reduce motion" on there is no battle to
 * photograph at all. The CSS half of it (Scene.css / PetApp.css media blocks)
 * cannot be overridden from JS — gen-shots.ts warns when the real value is on.
 */
const realMatchMedia = window.matchMedia.bind(window);
window.matchMedia = (q) =>
  /prefers-reduced-motion/.test(q)
    ? { matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }
    : realMatchMedia(q);
