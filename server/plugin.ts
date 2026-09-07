import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type { CountMode } from './usage.ts';
import { loadState, saveState } from './store.ts';
import { fuseShards, hatchLegendEgg, spendLegendItem } from './legends.ts';
import { buy, consumeItem, type ItemId, type ProductId } from './shop.ts';
import { forget, setHuntEnabled, setHuntUncapped, teach } from './hunt.ts';
import { rename, setShowBattleForm } from './game.ts';
import { contentTypeFor, pruneCache, readSprite } from './sprites.ts';
import { REFRESH_MS, buildState, dexIndex } from './state.ts';
import { dexEntry } from './dexentry.ts';


let cache: { at: number; payload: unknown } | null = null;
let inflight: Promise<unknown> | null = null;


/**
 * The one request shape both surfaces speak.
 *
 * `slot` exists because teaching a fifth move has to say WHICH of the four it
 * replaces. Encoding that into `id` as "teach:15:2" was the alternative; a
 * field is cheaper to keep honest across HTTP and IPC.
 */
export type PetAction = {
  action?: string;
  id?: string;
  slot?: number | null;
};

function readBody(req: IncomingMessage): Promise<PetAction> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 4096) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('bad JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Buy or use, then persist.
 *
 * The wallet is computed from EARNED tokens (excluding item-granted bonus), so
 * Rare Candy cannot be used to fund more Rare Candy.
 *
 * Reads the accrued counter rather than rescanning: accrual happens in exactly
 * one place (`buildState`), so a purchase charges against the same wallet the
 * user was looking at, and does not pay a few seconds of scan to say "no".
 */
async function runShopAction(body: PetAction) {
  const state = await loadState();
  const earned = state.lifetimeEarned;
  const slot = typeof body.slot === 'number' ? body.slot : null;

  let result;
  if (body.action === 'buy') {
    result = buy(state, body.id as ProductId, earned);
  } else if (body.action === 'use') {
    result = consumeItem(state, body.id as ItemId, earned, slot);
  } else if (body.action === 'teach') {
    result = teach(state, Number(body.id), slot);
  } else if (body.action === 'forget') {
    result = forget(state, Number(body.id));
  } else if (body.action === 'hunt') {
    result = setHuntEnabled(state, body.id === 'on');
  } else if (body.action === 'huntcap') {
    result = setHuntUncapped(state, body.id === 'off');
  } else if (body.action === 'rename') {
    result = rename(state, body.id ?? '');
  } else if (body.action === 'form') {
    result = setShowBattleForm(state, body.id === 'on');
  } else if (body.action === 'legend') {
    result = spendLegendItem(state, body.id ?? '');
  } else if (body.action === 'legendegg') {
    result = hatchLegendEgg(state, Number(body.id));
  } else if (body.action === 'fuse') {
    result = fuseShards(state, body.id ?? '');
  } else if (body.action === 'sprites') {
    return clearSprites();
  } else {
    return { ok: false, message: '알 수 없는 요청입니다.' };
  }

  if (result.ok) {
    await saveState(result.state);
    // Force the next poll to reflect it immediately. Without this a move you
    // just taught stays invisible for a full refresh interval.
    cache = null;
  }
  return { ok: result.ok, message: result.message };
}

/**
 * Drop the sprite cache, keeping whatever is on screen.
 *
 * The battle scene shows whichever wild Pokemon turned up, so the cache creeps
 * toward the whole dex. Wiping everything would blank the panel until the next
 * refresh re-downloaded it, which reads as breakage rather than housekeeping.
 */
async function clearSprites() {
  const payload = cache?.payload as { keepSprites?: string[] } | undefined;
  const { removed, bytes } = await pruneCache(payload?.keepSprites ?? []);
  cache = null;
  const mb = (bytes / 1024 / 1024).toFixed(1);
  return {
    ok: true,
    message: removed ? `${removed}개 · ${mb}MB를 지웠습니다.` : '지울 것이 없습니다.',
  };
}

/** De-duplicate concurrent refreshes so a slow scan can't stack up. */
async function getState(mode: CountMode, force = false) {
  const fresh = cache && Date.now() - cache.at < REFRESH_MS;
  if (fresh && !force) return cache!.payload;
  if (inflight) return inflight;
  inflight = buildState(mode)
    .then((payload) => {
      cache = { at: Date.now(), payload };
      return payload;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function petApi(): Plugin {
  const middleware = () =>
    async function petApiMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
        const url = req.url ?? '';

        if (url.startsWith('/api/state')) {
          try {
            const q = new URL(url, 'http://localhost');
            const mode: CountMode = q.searchParams.get('mode') === 'billable' ? 'billable' : 'activity';
            const payload = await getState(mode, q.searchParams.get('force') === '1');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: String(err) }));
          }
          return;
        }

        if (url.startsWith('/api/shop') && req.method === 'POST') {
          try {
            const body = await readBody(req);
            const result = await runShopAction(body);
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(result));
          } catch (err) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, message: String(err) }));
          }
          return;
        }

        /*
         * One species, for the card you just pressed.
         *
         * MUST come before the index below: '/api/dex/25' also satisfies
         * startsWith('/api/dex'), so with the order reversed every detail
         * request would be answered with the whole 116KB index and no error
         * anywhere. The index's own test is narrowed to an exact match for the
         * same reason — order should not be the only thing keeping this right.
         */
        if (url.startsWith('/api/dex/')) {
          const q = new URL(url, 'http://localhost');
          const id = Number(q.pathname.slice('/api/dex/'.length));
          const detail = await dexEntry(id, q.searchParams.get('shiny') === '1');
          if (!detail) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'unknown species' }));
            return;
          }
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          // Never cached the way the index is: half of this is the player's
          // own record, so a graduation has to show on the next open rather
          // than in an hour.
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(detail));
          return;
        }

        // Static and ~116KB, so it is fetched once rather than riding along on
        // every /api/state poll.
        if (url === '/api/dex' || url.startsWith('/api/dex?')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=3600');
          res.end(JSON.stringify(dexIndex()));
          return;
        }

        if (url.startsWith('/sprites/')) {
          const name = decodeURIComponent(url.slice('/sprites/'.length).split('?')[0]);
          const buf = await readSprite(name);
          if (!buf) {
            res.statusCode = 404;
            res.end('not found');
            return;
          }
          res.setHeader('Content-Type', contentTypeFor(name));
          res.setHeader('Cache-Control', 'public, max-age=86400');
          res.end(buf);
          return;
        }

      next();
    };

  return {
    name: 'poketokenpet-api',
    // Mounted on both so `npm run preview` — the mode you'd actually install as
    // a PWA — serves the API too, not just `npm run dev`.
    configureServer(server) {
      server.middlewares.use(middleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware());
    },
  };
}
