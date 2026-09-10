import path from 'node:path';
import fsp from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createScanner, FP_BYTES, readLinesFrom, scanAll } from '../server/usage.ts';
import { append, appendRaw, bytesOf, line, mkRoot, rmRoot, write } from './transcript.ts';

let root: string;
let file: string;

beforeEach(async () => {
  root = await mkRoot();
  file = path.join(root, 'proj', 's-1.jsonl');
});
afterEach(async () => {
  await rmRoot(root);
});

/** Collect every line the reader emits, plus where it stopped. */
async function read(from = 0) {
  const lines: string[] = [];
  const stop = await readLinesFrom(file, from, (l) => lines.push(l));
  return { lines, ...stop };
}

/**
 * The byte reader under the incremental cursor.
 *
 * These are the tests that would fail if the offset came from a string length
 * rather than from bytes — which is the single decision the whole incremental
 * design rests on. See the "Why not readline" note in server/usage.ts.
 */
describe('readLinesFrom', () => {
  it('stops at the end of the last COMPLETE line', async () => {
    const whole = [line({ uuid: 'a' }), line({ uuid: 'b' })];
    await write(file, whole);
    // Half of a third line, still being written.
    await appendRaw(file, line({ uuid: 'c' }).slice(0, 40));

    const { lines, offset } = await read();
    expect(lines).toHaveLength(2);
    // The offset must land on the newline boundary, NOT at end-of-file — the
    // difference is exactly the partial line, and using the file size here is
    // how you lose it.
    expect(offset).toBe(bytesOf(whole));
    expect(offset).toBeLessThan((await fsp.stat(file)).size);
  });

  it('never hands a partial line to the caller', async () => {
    await write(file, [line({ uuid: 'a' })]);
    await appendRaw(file, '{"type":"assistant","message":{"usage":{"input_tok');
    const { lines } = await read();
    // The fragment would parse as nothing, but it must not even be offered:
    // that is what makes the truncated-line trap structural rather than
    // something parseLine has to defend against.
    expect(lines).toHaveLength(1);
    expect(lines.every((l) => l.endsWith('}'))).toBe(true);
  });

  it('picks the completed line up on the next read', async () => {
    const first = [line({ uuid: 'a' })];
    await write(file, first);
    const tail = line({ uuid: 'b' });
    await appendRaw(file, tail.slice(0, 30));

    const a = await read();
    expect(a.lines).toHaveLength(1);
    expect(a.offset).toBe(bytesOf(first));

    // The rest of that same line arrives.
    await appendRaw(file, `${tail.slice(30)}\n`);
    const b = await read(a.offset);
    expect(b.lines).toEqual([tail]);
    expect(b.offset).toBe((await fsp.stat(file)).size);
  });

  it('counts bytes, not characters', async () => {
    // 56 of 60 sampled real transcripts contain multibyte UTF-8, so a
    // String.length offset is not a theoretical hazard — it is certain damage.
    const ko = [line({ uuid: '가', cwd: '/Users/x/프로젝트/한글' })];
    await write(file, ko);
    const { lines, offset } = await read();
    expect(lines).toHaveLength(1);
    expect(offset).toBe(bytesOf(ko));
    // The whole point: the byte offset is larger than the character count.
    expect(offset).toBeGreaterThan(ko[0].length);
  });

  it('resumes correctly after a multibyte line', async () => {
    const first = [line({ uuid: 'a', cwd: '/한글/경로' })];
    await write(file, first);
    const a = await read();
    await append(file, [line({ uuid: 'b' })]);
    const b = await read(a.offset);
    // A drifted offset would slice into the middle of the second line and
    // yield garbage rather than a clean JSON line.
    expect(b.lines).toHaveLength(1);
    expect(() => JSON.parse(b.lines[0])).not.toThrow();
  });

  it('handles CRLF without losing a byte', async () => {
    const a = line({ uuid: 'a' });
    const b = line({ uuid: 'b' });
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, `${a}\r\n${b}\r\n`);
    const r = await read();
    // The \r is stripped from the line but still counted in the offset. This is
    // the case `Buffer.byteLength(line) + 1` gets wrong, one byte per line.
    expect(r.lines).toEqual([a, b]);
    expect(r.offset).toBe((await fsp.stat(file)).size);
  });

  it('reassembles a line longer than one read chunk', async () => {
    // Well over the 64 KB highWaterMark, with multibyte placed so that chunk
    // boundaries land inside characters.
    const big = line({ uuid: 'big', cwd: `/${'한'.repeat(120_000)}` });
    await write(file, [big]);
    const { lines, offset } = await read();
    expect(lines).toEqual([big]);
    expect(offset).toBe(bytesOf([big]));
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });

  it('reports a fingerprint of the bytes behind the offset', async () => {
    const lines = [line({ uuid: 'a' }), line({ uuid: 'b' })];
    await write(file, lines);
    const { offset, fp } = await read();
    expect(fp).toHaveLength(FP_BYTES);
    const raw = await fsp.readFile(file);
    expect(fp.equals(raw.subarray(offset - FP_BYTES, offset))).toBe(true);
  });

  it('copes with degenerate files', async () => {
    await fsp.mkdir(path.dirname(file), { recursive: true });

    await fsp.writeFile(file, '');
    expect(await read()).toMatchObject({ lines: [], offset: 0 });

    await fsp.writeFile(file, '\n');
    expect(await read()).toMatchObject({ lines: [''], offset: 1 });

    // A file that is nothing but an unfinished line: no lines, no progress.
    await fsp.writeFile(file, '{"partial":');
    expect(await read()).toMatchObject({ lines: [], offset: 0 });

    // No trailing newline at all — the last line is not complete, so it waits.
    const one = line({ uuid: 'a' });
    await fsp.writeFile(file, `${one}\n${line({ uuid: 'b' })}`);
    const r = await read();
    expect(r.lines).toEqual([one]);
    expect(r.offset).toBe(bytesOf([one]));
  });
});

/**
 * The reader is what `scanAll` now runs on, so the full scan has to be
 * unchanged by it — including the nested `subagents/` directories, which are
 * roughly half of a real corpus.
 */
describe('scanAll over the byte reader', () => {
  it('still reads nested transcripts and applies last-wins', async () => {
    await write(path.join(root, 'proj', 'a.jsonl'), [
      line({ uuid: '1' }, { output_tokens: 5 }),
      line({ uuid: '2' }, { output_tokens: 5 }),
    ]);
    await write(path.join(root, 'proj', 'subagents', 'b.jsonl'), [
      line({ uuid: '3', message: undefined, sessionId: 's-2' }),
    ]);
    // The final line for msg_1 carries the real output_tokens.
    await append(path.join(root, 'proj', 'a.jsonl'), [line({ uuid: '4' }, { output_tokens: 2289 })]);

    const map = await scanAll(root);
    expect(map.get('msg_1')!.totals.output).toBe(2289);
  });
});

/**
 * The incremental scanner.
 *
 * Every case ends on the same assertion: the scanner's map must equal a full
 * `scanAll()` of the same tree. `scanAll` is an independent oracle, so one line
 * covers far more surface than any hand-written expectation and cannot drift.
 */
describe('createScanner', () => {
  const a = () => path.join(root, 'proj', 'a.jsonl');
  const b = () => path.join(root, 'proj', 'subagents', 'b.jsonl');

  /** The invariant, asserted after every mutation. */
  async function parity(s: ReturnType<typeof createScanner>) {
    expect(await s.scan()).toEqual(await scanAll(root));
  }

  it('a cold scan equals a full scan, nested dirs included', async () => {
    await write(a(), [line({ uuid: '1' }, {}, 'msg_a')]);
    await write(b(), [line({ uuid: '2', sessionId: 's-2' }, { output_tokens: 7 }, 'msg_b')]);
    const s = createScanner(root);
    await parity(s);
    expect(s.stats.scanned).toBe(2);
  });

  it('reads only the file that grew', async () => {
    await write(a(), [line({ uuid: '1' }, {}, 'msg_a')]);
    await write(b(), [line({ uuid: '2', sessionId: 's-2' }, {}, 'msg_b')]);
    const s = createScanner(root);
    await s.scan();

    await append(a(), [line({ uuid: '3', sessionId: 's-3' }, {}, 'msg_c')]);
    await parity(s);
    expect(s.stats.scanned).toBe(1);
    expect(s.stats.skipped).toBe(1);
  });

  it('does no work at all when nothing changed', async () => {
    await write(a(), [line({ uuid: '1' })]);
    const s = createScanner(root);
    await s.scan();
    await parity(s);
    expect(s.stats.bytes).toBe(0);
    expect(s.stats.scanned).toBe(0);
    expect(s.stats.skipped).toBe(1);
  });

  it('takes the real output_tokens from a later tick', async () => {
    // The placeholder lines land first; only the final line for an id carries
    // the true value. A "skip ids we have already seen" design fails here.
    await write(a(), [
      line({ uuid: '1' }, { output_tokens: 5 }),
      line({ uuid: '2' }, { output_tokens: 5 }),
    ]);
    const s = createScanner(root);
    let map = await s.scan();
    expect(map.get('msg_1')!.totals.output).toBe(5);

    await append(a(), [line({ uuid: '3' }, { output_tokens: 2289 })]);
    map = await s.scan();
    expect(map.get('msg_1')!.totals.output).toBe(2289);
    await parity(s);
  });

  it('waits for a half-written line and picks it up when it completes', async () => {
    await write(a(), [line({ uuid: '1' })]);
    const s = createScanner(root);
    await s.scan();

    const tail = line({ uuid: '2', sessionId: 's-2' }, { output_tokens: 99 });
    await appendRaw(a(), tail.slice(0, 25));
    let map = await s.scan();
    expect(map.size).toBe(1); // the fragment contributed nothing
    await parity(s);

    await appendRaw(a(), `${tail.slice(25)}\n`);
    map = await s.scan();
    expect(map.get('msg_1')!.totals.output).toBe(99);
    await parity(s);
  });

  it('re-reads a file that shrank', async () => {
    await write(a(), [line({ uuid: '1' }), line({ uuid: '2' })]);
    const s = createScanner(root);
    await s.scan();

    await write(a(), [line({ uuid: '9' }, { output_tokens: 3 }, 'msg_9')]);
    await parity(s);
    expect(s.stats.reread).toBe(1);
  });

  it('re-reads a file rewritten in place at the same length', async () => {
    await write(a(), [line({}, { output_tokens: 11 }, 'msg_a')]);
    const s = createScanner(root);
    await s.scan();
    const size = (await fsp.stat(a())).size;

    // Same byte length, different content, distinct mtime.
    await write(a(), [line({}, { output_tokens: 22 }, 'msg_b')]);
    expect((await fsp.stat(a())).size).toBe(size);
    await fsp.utimes(a(), new Date(), new Date(Date.now() + 5_000));
    await parity(s);
    expect(s.stats.reread).toBe(1);
  });

  it('re-reads a file truncated and rewritten LONGER within one tick', async () => {
    // Same inode, newer mtime, bigger size — indistinguishable from an append
    // by stat alone. Only the fingerprint behind the offset catches it.
    // The differing bytes must fall in the TAIL of the line: the fingerprint is
    // the 64 bytes behind the old offset, and these fixtures are identical from
    // "usage" onwards unless the counters differ.
    await write(a(), [line({}, { output_tokens: 11 }, 'msg_a'), line({}, { output_tokens: 22 }, 'msg_b')]);
    const s = createScanner(root);
    await s.scan();

    await fsp.writeFile(
      a(),
      [
        line({}, { output_tokens: 3333 }, 'msg_c'),
        line({}, { output_tokens: 4444 }, 'msg_d'),
        line({}, { output_tokens: 5555 }, 'msg_e'),
      ]
        .map((l) => `${l}\n`)
        .join(''),
    );
    await parity(s);
    expect(s.stats.reread).toBe(1);
  });

  it('forgets a deleted transcript, so the total can go DOWN', async () => {
    await write(a(), [line({ uuid: '1' })]);
    await write(b(), [line({ uuid: '2', sessionId: 's-2' }, { output_tokens: 11 }, 'msg_2')]);
    const s = createScanner(root);
    const before = await s.scan();
    expect(before.size).toBe(2);

    await fsp.rm(b());
    const after = await s.scan();
    expect(after.size).toBe(1);
    expect(after.has('msg_2')).toBe(false);
    await parity(s);
  });

  it('notices a file that appears in a new nested directory', async () => {
    await write(a(), [line({ uuid: '1' })]);
    const s = createScanner(root);
    await s.scan();
    await write(path.join(root, 'proj2', 'subagents', 'c.jsonl'), [
      line({ uuid: '2', sessionId: 's-2' }, { output_tokens: 4 }, 'msg_2'),
    ]);
    await parity(s);
  });

  it('survives two concurrent scans', async () => {
    await write(a(), [line({ uuid: '1' })]);
    const s = createScanner(root);
    const [x, y] = await Promise.all([s.scan(), s.scan()]);
    expect(x).toEqual(y);
    await parity(s);
  });
});

/**
 * Periodic reconciliation.
 *
 * The net under every incremental hazard: whatever the cursors got wrong, a
 * rebuild from nothing puts right. Driven by an injected interval so the test
 * does not need a clock.
 */
describe('reconciliation', () => {
  it('rebuilds from nothing once the interval has passed', async () => {
    const f = path.join(root, 'proj', 'a.jsonl');
    await write(f, [line({}, {}, 'msg_a')]);
    // reconcileMs = 0 means every scan is a rebuild.
    const s = createScanner(root, 0);
    await s.scan();
    expect(s.stats.reconciled).toBe(true);
    await s.scan();
    expect(s.stats.reconciled).toBe(true);
    expect(s.stats.scanned).toBe(1); // read again, not skipped
  });

  it('does not rebuild inside the interval', async () => {
    const f = path.join(root, 'proj', 'a.jsonl');
    await write(f, [line({}, {}, 'msg_a')]);
    const s = createScanner(root, 60_000);
    await s.scan();
    await s.scan();
    expect(s.stats.reconciled).toBe(false);
    expect(s.stats.skipped).toBe(1);
  });

  it('repairs a map that incremental tracking got wrong', async () => {
    const f = path.join(root, 'proj', 'a.jsonl');
    await write(f, [line({}, { output_tokens: 11 }, 'msg_a')]);
    const s = createScanner(root, 0);
    await s.scan();
    // Whatever happened in between, a reconciling scan agrees with a full one.
    await fsp.writeFile(f, `${line({}, { output_tokens: 77 }, 'msg_z')}\n`);
    expect(await s.scan()).toEqual(await scanAll(root));
  });
});

/**
 * Waiting for a quiet machine.
 *
 * A rebuild re-reads the whole corpus, so the point of the gate is to land that
 * cost while nobody is using the machine — never to skip it. Every test here is
 * really asking one of two questions: does a `false` gate actually defer, and
 * can a gate that never says yes stall the repair for ever.
 */
describe('canReconcile', () => {
  it('runs the first scan whatever the gate says', async () => {
    const f = path.join(root, 'proj', 'a.jsonl');
    await write(f, [line({}, {}, 'msg_a')]);
    const s = createScanner(root, 0, { canReconcile: () => false });
    await s.scan();
    // The maps start empty, so there is nothing to defer and nothing to save.
    expect(s.stats.reconciled).toBe(true);
  });

  it('defers a due rebuild while the gate is closed', async () => {
    const f = path.join(root, 'proj', 'a.jsonl');
    await write(f, [line({}, {}, 'msg_a')]);
    const s = createScanner(root, 0, { canReconcile: () => false });
    await s.scan(); // the unconditional first one
    await s.scan();
    expect(s.stats.reconciled).toBe(false);
    expect(s.stats.skipped).toBe(1); // still tracked incrementally, just not rebuilt
  });

  it('rebuilds as soon as the gate opens', async () => {
    const f = path.join(root, 'proj', 'a.jsonl');
    await write(f, [line({}, {}, 'msg_a')]);
    let quiet = false;
    const s = createScanner(root, 0, { canReconcile: () => quiet });
    await s.scan();
    await s.scan();
    expect(s.stats.reconciled).toBe(false);
    quiet = true;
    await s.scan();
    expect(s.stats.reconciled).toBe(true);
  });

  it('stops asking once maxDeferMs has passed', async () => {
    const f = path.join(root, 'proj', 'a.jsonl');
    await write(f, [line({}, {}, 'msg_a')]);
    // Both windows zero: due immediately, and overdue immediately too, so a
    // permanently busy machine still gets repaired.
    const s = createScanner(root, 0, { canReconcile: () => false, maxDeferMs: 0 });
    await s.scan();
    await s.scan();
    expect(s.stats.reconciled).toBe(true);
  });

  it('still agrees with a full scan across a deferred rebuild', async () => {
    const f = path.join(root, 'proj', 'a.jsonl');
    await write(f, [line({}, { output_tokens: 11 }, 'msg_a')]);
    const s = createScanner(root, 0, { canReconcile: () => false });
    await s.scan();
    await append(f, [line({}, { output_tokens: 77 }, 'msg_b')]);
    // Deferring only skips the rebuild. The incremental path still has to be
    // right, which is the whole reason deferring is safe.
    expect(await s.scan()).toEqual(await scanAll(root));
    expect(s.stats.reconciled).toBe(false);
  });
});
