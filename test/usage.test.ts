import { describe, expect, it } from 'vitest';
import { localDay, parseLine, rollup, sumTotals, totalsFromUsage, type UsageRecord } from '../server/usage.ts';

/** A realistic assistant line, trimmed of content. */
function line(over: Record<string, unknown> = {}, usage: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: 'assistant',
    uuid: 'u-1',
    sessionId: 's-1',
    timestamp: '2026-08-21T02:24:24.539Z',
    cwd: '/Users/x/proj',
    entrypoint: 'claude-vscode',
    requestId: 'req_1',
    message: {
      id: 'msg_1',
      model: 'claude-opus-5',
      role: 'assistant',
      usage: {
        input_tokens: 2,
        output_tokens: 5,
        cache_creation_input_tokens: 5146,
        cache_read_input_tokens: 11147,
        ...usage,
      },
    },
    ...over,
  });
}

describe('parseLine', () => {
  it('extracts the four counters', () => {
    const r = parseLine(line())!;
    expect(r.messageId).toBe('msg_1');
    expect(r.totals).toEqual({ input: 2, output: 5, cacheCreation: 5146, cacheRead: 11147 });
    expect(r.entrypoint).toBe('claude-vscode');
  });

  it('ignores lines without usage', () => {
    expect(parseLine(JSON.stringify({ type: 'user', message: { role: 'user' } }))).toBeNull();
    expect(parseLine(JSON.stringify({ type: 'ai-title', aiTitle: 'x' }))).toBeNull();
    expect(parseLine('not json at all')).toBeNull();
  });

  it('tolerates bookkeeping lines that have no timestamp/cwd/version', () => {
    // ai-title, last-prompt, atis-latch, mode and friends omit these entirely.
    for (const t of ['ai-title', 'last-prompt', 'atis-latch', 'mode', 'permission-mode']) {
      expect(() => parseLine(JSON.stringify({ type: t, sessionId: 's' }))).not.toThrow();
    }
  });

  it('skips <synthetic> lines', () => {
    expect(parseLine(line({}, {}).replace('claude-opus-5', '<synthetic>'))).toBeNull();
  });

  it('maps an unrecognised entrypoint to unknown', () => {
    expect(parseLine(line({ entrypoint: 'something-new' }))!.entrypoint).toBe('unknown');
    expect(parseLine(line({ entrypoint: undefined }))!.entrypoint).toBe('unknown');
  });
});

describe('totalsFromUsage — iterations', () => {
  it('uses top-level when iterations has one entry (adding both would double-count)', () => {
    const t = totalsFromUsage({
      input_tokens: 2,
      output_tokens: 1939,
      cache_creation_input_tokens: 22035,
      cache_read_input_tokens: 20423,
      iterations: [
        { input_tokens: 2, output_tokens: 1939, cache_creation_input_tokens: 22035, cache_read_input_tokens: 20423 },
      ],
    });
    expect(t).toEqual({ input: 2, output: 1939, cacheCreation: 22035, cacheRead: 20423 });
  });

  it('sums iterations when there is more than one — top-level only holds the last', () => {
    // Real shape observed in the corpus: top_out 3097 but the true sum is 3794.
    const t = totalsFromUsage({
      input_tokens: 2,
      output_tokens: 3097,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 103850,
      iterations: [
        { input_tokens: 2, output_tokens: 697, cache_creation_input_tokens: 471, cache_read_input_tokens: 123327 },
        { input_tokens: 2, output_tokens: 3097, cache_creation_input_tokens: 0, cache_read_input_tokens: 103850 },
      ],
    });
    expect(t.output).toBe(3794);
    expect(t.cacheCreation).toBe(471);
  });
});

describe('deduplication', () => {
  // Claude Code appends one line per content block, repeating the whole usage
  // object each time. output_tokens is a placeholder until the final line.
  const group = [
    line({ uuid: 'a' }, { output_tokens: 5 }),
    line({ uuid: 'b' }, { output_tokens: 5 }),
    line({ uuid: 'c' }, { output_tokens: 5 }),
    line({ uuid: 'd' }, { output_tokens: 2289 }), // the real total, last in file order
  ];

  it('last-wins keeps the final output_tokens', () => {
    const m = new Map<string, UsageRecord>();
    for (const l of group) {
      const r = parseLine(l)!;
      m.set(r.messageId, r);
    }
    expect(m.size).toBe(1);
    expect([...m.values()][0].totals.output).toBe(2289);
  });

  it('first-wins would undercount output — this is why we upsert', () => {
    const m = new Map<string, UsageRecord>();
    for (const l of group) {
      const r = parseLine(l)!;
      if (!m.has(r.messageId)) m.set(r.messageId, r); // the wrong approach
    }
    expect([...m.values()][0].totals.output).toBe(5);
  });

  it('naive summing overcounts by roughly the line-count factor', () => {
    const recs = group.map((l) => parseLine(l)!);
    const naive = recs.reduce((a, r) => a + sumTotals(r.totals), 0);
    const m = new Map(recs.map((r) => [r.messageId, r]));
    const deduped = sumTotals([...m.values()][0].totals);
    // Cache counters repeat identically on all 4 lines, so this is ~4x.
    expect(naive / deduped).toBeGreaterThan(2);
  });
});

describe('localDay', () => {
  it('buckets by local date, not UTC', () => {
    // 2026-08-21T02:00Z is already the 21st in KST (UTC+9) and still the 20th
    // in New York. Getting this wrong is a ~30% error on daily totals.
    const iso = '2026-08-21T02:00:00.000Z';
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const got = localDay(iso);
    expect(got).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    if (tz === 'Asia/Seoul') expect(got).toBe('2026-08-21');
  });
});

describe('rollup', () => {
  it('splits by entrypoint — the thing the reference app cannot do', () => {
    const mk = (id: string, ep: string, out: number): UsageRecord => ({
      messageId: id,
      model: 'claude-opus-5',
      timestamp: '2026-08-21T02:00:00.000Z',
      entrypoint: ep as UsageRecord['entrypoint'],
      cwd: null,
      sessionId: null,
      totals: { input: 0, output: out, cacheCreation: 0, cacheRead: 0 },
    });
    const r = rollup([mk('1', 'cli', 10), mk('2', 'claude-vscode', 90)]);
    expect(r.byEntrypoint).toEqual({ cli: 10, 'claude-vscode': 90 });
    expect(r.totalTokens).toBe(100);
  });

  it('billable mode drops cache reads', () => {
    const rec: UsageRecord = {
      messageId: 'm',
      model: 'x',
      timestamp: '2026-08-21T02:00:00.000Z',
      entrypoint: 'cli',
      cwd: null,
      sessionId: null,
      totals: { input: 1, output: 2, cacheCreation: 4, cacheRead: 1000 },
    };
    expect(rollup([rec], 'activity').totalTokens).toBe(1007);
    expect(rollup([rec], 'billable').totalTokens).toBe(7);
  });
});
