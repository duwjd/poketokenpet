import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { projectsDir } from './paths.ts';

export type TokenTotals = {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
};

export type Entrypoint = 'cli' | 'claude-vscode' | 'claude-desktop' | 'unknown';

export type UsageRecord = {
  messageId: string;
  model: string;
  /** ISO8601 UTC, e.g. 2026-08-21T07:21:37.566Z */
  timestamp: string;
  entrypoint: Entrypoint;
  cwd: string | null;
  sessionId: string | null;
  totals: TokenTotals;
};

/**
 * Which token fields count toward growth.
 *
 * Cache reads are ~90% of the total, so this choice changes the pet's growth
 * rate by roughly 10x. `activity` matches the reference app.
 */
export type CountMode = 'activity' | 'billable';

const ZERO: TokenTotals = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };

export function addTotals(a: TokenTotals, b: TokenTotals): TokenTotals {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheCreation: a.cacheCreation + b.cacheCreation,
    cacheRead: a.cacheRead + b.cacheRead,
  };
}

export function sumTotals(t: TokenTotals, mode: CountMode = 'activity'): number {
  const base = t.input + t.output + t.cacheCreation;
  return mode === 'activity' ? base + t.cacheRead : base;
}

function readUsageBlock(u: Record<string, unknown> | null | undefined): TokenTotals {
  if (!u) return { ...ZERO };
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    input: n(u.input_tokens),
    output: n(u.output_tokens),
    cacheCreation: n(u.cache_creation_input_tokens),
    cacheRead: n(u.cache_read_input_tokens),
  };
}

/**
 * Extract token totals from one `message.usage` object.
 *
 * `iterations` is normally length 1 and simply mirrors the top-level counters —
 * adding both would double-count. But when it has more than one entry the
 * top-level counters reflect only the LAST iteration, so the entries must be
 * summed instead. Rare (4 lines in a 40k-line corpus) but wrong if ignored.
 */
export function totalsFromUsage(u: Record<string, unknown> | null | undefined): TokenTotals {
  if (!u) return { ...ZERO };
  const iters = u.iterations;
  if (Array.isArray(iters) && iters.length > 1) {
    return iters.reduce<TokenTotals>(
      (acc, it) => addTotals(acc, readUsageBlock(it as Record<string, unknown>)),
      { ...ZERO },
    );
  }
  return readUsageBlock(u);
}

/**
 * Parse one JSONL line into a UsageRecord, or null if it carries no usage.
 *
 * Pure — no filesystem, no clock. This is the unit under test.
 */
export function parseLine(line: string): UsageRecord | null {
  // Cheap prefilter first: skips ~55% of lines and, more importantly, avoids
  // JSON.parse on multi-MB tool-result lines. This is what keeps a full scan
  // of a 1.1 GB corpus at a couple of seconds.
  if (!line.includes('"usage":')) return null;

  let o: any;
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  if (!o || o.type !== 'assistant') return null;

  const m = o.message;
  if (!m || !m.usage || typeof m.id !== 'string') return null;

  // Locally-generated lines (interrupts etc). requestId is null and every
  // counter is zero, so they are harmless, but skip them for cleanliness.
  if (m.model === '<synthetic>') return null;

  const ts = typeof o.timestamp === 'string' ? o.timestamp : null;
  if (!ts) return null;

  const ep = o.entrypoint;
  const entrypoint: Entrypoint =
    ep === 'cli' || ep === 'claude-vscode' || ep === 'claude-desktop' ? ep : 'unknown';

  return {
    messageId: m.id,
    model: typeof m.model === 'string' ? m.model : 'unknown',
    timestamp: ts,
    entrypoint,
    cwd: typeof o.cwd === 'string' ? o.cwd : null,
    sessionId: typeof o.sessionId === 'string' ? o.sessionId : null,
    totals: totalsFromUsage(m.usage),
  };
}

/** Every `*.jsonl` under projects/, including the nested `subagents/` ones. */
export async function listTranscripts(root = projectsDir()): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fsp.readdir(root, { recursive: true });
  } catch {
    return []; // no ~/.claude/projects — a fresh machine, not an error
  }
  return entries
    .filter((e) => e.endsWith('.jsonl'))
    .map((e) => path.join(root, e))
    .sort();
}

/**
 * Bytes of resume fingerprint kept behind a cursor. See `readLinesFrom`.
 */
export const FP_BYTES = 64;

/** What `readLinesFrom` knows when it stops. */
export type ReadStop = {
  /**
   * Absolute byte offset of the end of the last COMPLETE line.
   *
   * Never points into a partial line, which is the whole reason this returns a
   * byte count rather than a line count.
   */
  offset: number;
  /** The `FP_BYTES` bytes immediately before `offset`, or fewer at the start. */
  fp: Buffer;
};

/**
 * Stream a file from a byte offset, handing complete lines to `onLine`.
 *
 * ## Why not `readline`
 *
 * `readline` over a utf8 stream hands you strings, and a byte offset cannot be
 * recovered from a string:
 *
 *   - `Buffer.byteLength(line) + 1` is wrong by one byte on every CRLF line,
 *     because `crlfDelay: Infinity` swallows the `\r`. One transcript written on
 *     Windows and the offset lands mid-line; from then on every line fails
 *     JSON.parse and that file's total is frozen for good.
 *   - `readline` emits a trailing partial line as an ordinary line, so it gives
 *     you no way to tell a complete last line from a truncated one — which is
 *     exactly the distinction the incremental cursor rests on.
 *
 * So: no encoding, split on 0x0A over Buffers, and decode only complete line
 * ranges. A multibyte character split across a chunk boundary is reassembled by
 * `pending` before anything is decoded, which matters because 56 of 60 sampled
 * transcripts contain multibyte UTF-8.
 *
 * ## The partial line is NOT carried across calls
 *
 * `offset` means "consumed AND newline-terminated". A truncated tail is simply
 * re-read from its own start next time, so `parseLine` never sees an incomplete
 * line at all. docs/INTERNALS.md calls that the number-one bug of this class of parser;
 * this removes it structurally rather than defending against it. The cost is
 * re-reading one in-flight line per tick, bounded by the longest line.
 */
export async function readLinesFrom(
  file: string,
  start: number,
  onLine: (line: string) => void,
): Promise<ReadStop> {
  const stream = fs.createReadStream(file, { start });
  /**
   * Pieces of a line that began in an earlier chunk, and their total length.
   *
   * An array rather than a running `Buffer.concat`: this corpus has lines over
   * 2 MB, and concatenating on every chunk recopies the whole partial line each
   * time, which is quadratic in the line length. Measured against the real
   * corpus that cost 8.3s where readline took 3.4s. Held as pieces, a long line
   * is joined exactly once — when its newline finally arrives — and any line
   * that fits inside one chunk is decoded straight out of it with no copy.
   */
  let pending: Buffer[] = [];
  let pendingLen = 0;
  /** Every byte the stream handed us. */
  let seen = 0;
  /** Where the last complete line ended, for the resume fingerprint. */
  let fpSrc: Buffer | null = null;
  let fpEnd = 0;

  /** Decode one complete line, dropping a trailing CR. */
  const decode = (b: Buffer, from: number, end: number) =>
    b.toString('utf8', from, end > from && b[end - 1] === 0x0d ? end - 1 : end);

  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      seen += chunk.length;
      let from = 0;
      for (;;) {
        const nl = chunk.indexOf(0x0a, from);
        if (nl === -1) break;
        if (pendingLen > 0) {
          pending.push(chunk.subarray(from, nl));
          const whole = Buffer.concat(pending, pendingLen + (nl - from));
          onLine(decode(whole, 0, whole.length));
          pending = [];
          pendingLen = 0;
        } else {
          onLine(decode(chunk, from, nl));
        }
        fpSrc = chunk;
        fpEnd = nl + 1;
        from = nl + 1;
      }
      if (from < chunk.length) {
        pending.push(chunk.subarray(from));
        pendingLen += chunk.length - from;
      }
    }
  } finally {
    stream.destroy();
  }

  // Counting raw chunk lengths and subtracting the unconsumed tail is exact by
  // construction. Adding up per-iteration `from` positions double-counts every
  // byte carried into the next chunk.
  const fp = fpSrc
    ? Buffer.from(fpSrc.subarray(Math.max(0, fpEnd - FP_BYTES), fpEnd))
    : Buffer.alloc(0);
  return { offset: start + seen - pendingLen, fp };
}

/**
 * Read one transcript, upserting into `out` keyed by message.id.
 *
 * LAST WINS, deliberately. Claude Code appends one line per content block and
 * repeats the whole `usage` object on each, so a single response can appear up
 * to 27 times. The intermediate lines carry a placeholder `output_tokens`
 * (5, 5, 5, ..., 2289) — only the final line holds the real value. Skipping
 * ids already seen would therefore undercount output; overwriting is correct.
 */
async function scanFile(file: string, out: Map<string, UsageRecord>): Promise<void> {
  await readLinesFrom(file, 0, (line) => {
    const rec = parseLine(line);
    if (rec) out.set(rec.messageId, rec);
  });
}

/**
 * Full scan of every transcript.
 *
 * Measured at ~3s over 1.2 GB warm. Kept exported and behaviourally unchanged
 * even though the app no longer runs it every tick: it is the oracle the
 * incremental scanner is tested against, and the escape hatch it falls back to.
 */
export async function scanAll(root = projectsDir()): Promise<Map<string, UsageRecord>> {
  const files = await listTranscripts(root);
  const out = new Map<string, UsageRecord>();
  for (const f of files) {
    try {
      await scanFile(f, out);
    } catch {
      // A transcript being rotated mid-scan should not take the whole run down.
    }
  }
  return out;
}

/**
 * Where one transcript was left off.
 *
 * `ids` is what makes deletion and rotation correct. The record map is keyed by
 * `message.id` and has no idea which file a record came from, so without a
 * per-file id set a deleted transcript's records linger for ever, the total
 * stops matching a full scan, and "누적 토큰은 줄어들 수 있다" (INTERNALS trap 4)
 * quietly stops being true.
 */
type Cursor = {
  size: number;
  mtimeMs: number;
  /** 0 when the platform does not report one; then it is simply not used. */
  ino: number;
  /** Consumed AND newline-terminated. Always <= size. */
  offset: number;
  /** The bytes just before `offset`, to prove a resume lands where we left. */
  fp: Buffer;
  ids: Set<string>;
};

/** What the last `scan()` actually did. Lets a caller assert the fast path. */
export type ScanStats = {
  files: number;
  scanned: number;
  skipped: number;
  reread: number;
  dropped: number;
  bytes: number;
  ms: number;
  /** True when this scan rebuilt the map from nothing. See RECONCILE_MS. */
  reconciled: boolean;
};

/**
 * How long the map may be built up incrementally before it is rebuilt whole.
 *
 * The safety net for every incremental hazard at once: a drifted offset, a
 * rotation the fingerprint missed, a record left behind by a file we stopped
 * seeing. Rebuilding costs one full scan — about 2s per half hour, a 0.1% duty
 * cycle, against the 16% this replaced — and it turns any such bug from
 * permanent into at-most-this-long.
 *
 * It cannot undo an overcount `accrue()` has already banked into
 * `lifetimeEarned`, which is why the structural defences (per-file id sets, the
 * resume fingerprint) matter more than this does.
 */
export const RECONCILE_MS = 30 * 60_000;

export type Scanner = {
  /** Drop-in for `scanAll()`. Returns the same map, built incrementally. */
  scan(): Promise<Map<string, UsageRecord>>;
  readonly stats: ScanStats;
  /** Forget everything; the next scan is a cold one. */
  reset(): void;
};

/**
 * An incremental scanner over a transcript root.
 *
 * ## Why this exists
 *
 * The tray app rescanned the whole corpus every 20 seconds for as long as it
 * ran. Measured on a real machine: 184 files, 1.23 GB, 3.2 s per scan — about a
 * 16% duty cycle on a core, for ever, growing with a corpus that only grows.
 * But only 8 of those 184 files had been touched in the last 24 hours, and
 * `readdir` + `stat` over all of them costs 23 ms. That ratio is the whole
 * design: find the 4% that moved, read only that.
 *
 * ## Why a factory and not module state
 *
 * Matches the injectable style the rest of the server uses (`hunt(now)`,
 * `advance(rng)`, `listTranscripts(root)`), and lets tests hold an isolated
 * scanner over a temp directory.
 *
 * ## Why nothing is persisted to disk
 *
 * The cursors are not the state — the map is. Saving cursors without the
 * records would skip past bytes whose records we no longer hold, which is a
 * permanent undercount that never self-heals. So "persist the cursor" really
 * means "persist 7,000 records", with a schema and a migration, and the cost of
 * getting it wrong is severe: `accrue()` banks forward deltas into
 * `lifetimeEarned` permanently, so one over-reported snapshot hands out free
 * evolutions that cannot be taken back. The entire benefit would be 3.2 s once
 * per launch, and this process runs for days.
 *
 * ## Two places this is not identical to a full scan
 *
 * Both are accepted, and both were found by the parity tests rather than
 * reasoned about in advance.
 *
 *  1. If the same `message.id` appears in two different transcripts, last-wins
 *     becomes order-dependent: a full scan visits files in sorted order, this
 *     one visits only what changed, and the two can pick different winners. A
 *     real message id belongs to exactly one transcript, so it does not arise
 *     in practice — but a fixture that reuses one will fail parity, which is
 *     how this was found.
 *  2. `fp` is a heuristic, not a proof. A file truncated and rewritten LONGER
 *     inside a single tick is caught only if the 64 bytes behind the previous
 *     offset actually differ; identical tails there would be read as an append.
 *     Periodic full reconciliation is what bounds that.
 */
export function createScanner(root = projectsDir(), reconcileMs = RECONCILE_MS): Scanner {
  const cursors = new Map<string, Cursor>();
  const records = new Map<string, UsageRecord>();
  /** When the map was last built from nothing. 0 = never. */
  let lastFull = 0;
  let stats: ScanStats = {
    files: 0,
    scanned: 0,
    skipped: 0,
    reread: 0,
    dropped: 0,
    bytes: 0,
    ms: 0,
    reconciled: false,
  };
  /** Two concurrent scans would interleave reads and double-advance a cursor. */
  let inflight: Promise<Map<string, UsageRecord>> | null = null;

  /** Forget a file's records and its cursor. */
  const drop = (file: string) => {
    const c = cursors.get(file);
    if (!c) return;
    for (const id of c.ids) records.delete(id);
    cursors.delete(file);
  };

  /** Read `file` from `from`, recording what it contributes. */
  const ingest = async (file: string, from: number, st: { size: number; mtimeMs: number; ino: number }) => {
    const ids = from === 0 ? new Set<string>() : (cursors.get(file)?.ids ?? new Set<string>());
    const { offset, fp } = await readLinesFrom(file, from, (l) => {
      const rec = parseLine(l);
      if (!rec) return;
      // Last wins, exactly as a full scan does — and it must hold ACROSS scans,
      // because the line carrying a message's real output_tokens often arrives
      // in a later tick than the placeholder ones.
      records.set(rec.messageId, rec);
      ids.add(rec.messageId);
    });
    stats.bytes += offset - from;
    // Keep the fingerprint we already had if this read produced none (a read
    // that consumed no complete line must not blank it).
    const prev = cursors.get(file);
    cursors.set(file, {
      size: st.size,
      mtimeMs: st.mtimeMs,
      ino: st.ino,
      offset,
      fp: fp.length > 0 ? fp : (prev?.fp ?? fp),
      ids,
    });
  };

  /** Does the tail behind `offset` still look like what we read last time? */
  const fpMatches = async (file: string, c: Cursor): Promise<boolean> => {
    if (c.fp.length === 0 || c.offset === 0) return true;
    const want = c.fp;
    const at = c.offset - want.length;
    const fh = await fsp.open(file, 'r');
    try {
      const got = Buffer.alloc(want.length);
      const { bytesRead } = await fh.read(got, 0, want.length, at);
      return bytesRead === want.length && got.equals(want);
    } finally {
      await fh.close();
    }
  };

  const runScan = async (): Promise<Map<string, UsageRecord>> => {
    const t0 = Date.now();
    stats = { files: 0, scanned: 0, skipped: 0, reread: 0, dropped: 0, bytes: 0, ms: 0, reconciled: false };

    // A cold scan IS a reconciliation, so periodic repair is just "forget
    // everything first" rather than a second code path that could itself drift.
    const reconciled = t0 - lastFull >= reconcileMs;
    if (reconciled) {
      cursors.clear();
      records.clear();
      lastFull = t0;
    }

    // Never cached: a new session creates a new file, and a new subagent run
    // creates a whole new nested directory. 22 ms buys that correctness.
    const files = await listTranscripts(root);
    stats.files = files.length;
    const live = new Set(files);

    for (const file of [...cursors.keys()]) {
      if (!live.has(file)) {
        drop(file);
        stats.dropped++;
      }
    }

    for (const file of files) {
      let st: Awaited<ReturnType<typeof fsp.stat>>;
      try {
        st = await fsp.stat(file);
      } catch {
        drop(file); // vanished between listing and stat
        stats.dropped++;
        continue;
      }
      const meta = { size: st.size, mtimeMs: st.mtimeMs, ino: Number(st.ino) || 0 };
      const c = cursors.get(file);

      try {
        if (!c) {
          await ingest(file, 0, meta);
          stats.scanned++;
        } else if ((c.ino && meta.ino && c.ino !== meta.ino) || meta.size < c.size) {
          // Replaced, or truncated. Either way the old records are wrong.
          drop(file);
          await ingest(file, 0, meta);
          stats.reread++;
        } else if (meta.size === c.size) {
          // mtime is compared for EQUALITY only, never ordinally — no `>`
          // anywhere here — so NTP steps, DST and VM restores cannot mislead
          // it. The worst a skewed clock does is cost one wasted re-read.
          if (meta.mtimeMs === c.mtimeMs) {
            stats.skipped++;
          } else {
            drop(file); // rewritten in place at the same length
            await ingest(file, 0, meta);
            stats.reread++;
          }
        } else if (await fpMatches(file, c)) {
          // Resume from `offset`, NOT from `size`: the difference between them
          // is exactly the partial line we deliberately did not consume.
          await ingest(file, c.offset, meta);
          stats.scanned++;
        } else {
          // Same inode, longer, but the bytes behind our offset changed: the
          // file was truncated and rewritten within one tick. `stat` alone
          // cannot see this, which is what the fingerprint is for.
          drop(file);
          await ingest(file, 0, meta);
          stats.reread++;
        }
      } catch {
        // A transcript being rotated mid-scan should not take the run down.
      }
    }

    stats.ms = Date.now() - t0;
    stats.reconciled = reconciled;
    return new Map(records);
  };

  return {
    scan() {
      if (inflight) return inflight;
      inflight = runScan().finally(() => {
        inflight = null;
      });
      return inflight;
    },
    get stats() {
      return stats;
    },
    reset() {
      cursors.clear();
      records.clear();
      lastFull = 0;
    },
  };
}

/** Local YYYY-MM-DD. Bucketing by UTC instead is a ~31% error at KST. */
export function localDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA');
}

export type Rollup = {
  totalTokens: number;
  messageCount: number;
  byDay: Record<string, number>;
  byEntrypoint: Record<string, number>;
  byModel: Record<string, number>;
  today: number;
  todayMessages: number;
};

export function rollup(
  records: Iterable<UsageRecord>,
  mode: CountMode = 'activity',
  now: Date = new Date(),
): Rollup {
  const byDay: Record<string, number> = {};
  const byEntrypoint: Record<string, number> = {};
  const byModel: Record<string, number> = {};
  let totalTokens = 0;
  let messageCount = 0;
  let todayMessages = 0;

  const todayKey = now.toLocaleDateString('en-CA');

  for (const r of records) {
    const t = sumTotals(r.totals, mode);
    totalTokens += t;
    messageCount++;
    const day = localDay(r.timestamp);
    byDay[day] = (byDay[day] ?? 0) + t;
    byEntrypoint[r.entrypoint] = (byEntrypoint[r.entrypoint] ?? 0) + t;
    byModel[r.model] = (byModel[r.model] ?? 0) + t;
    if (day === todayKey) todayMessages++;
  }

  return {
    totalTokens,
    messageCount,
    byDay,
    byEntrypoint,
    byModel,
    today: byDay[todayKey] ?? 0,
    todayMessages,
  };
}
