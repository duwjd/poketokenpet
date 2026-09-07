/**
 * Transcript fixtures on a real filesystem.
 *
 * Every other test in this repo is pure — see the note at server/usage.ts's
 * `parseLine`. These helpers exist because the incremental scanner's unit under
 * test IS filesystem behaviour: byte offsets, appends, truncation, rotation.
 * There is no honest way to check a resume offset without a file to resume in.
 *
 * `line()` is lifted from test/usage.test.ts, which had it privately. Two copies
 * could drift into disagreeing about what a realistic line looks like, and the
 * incremental tests compare against the full scanner — so both sides have to be
 * reading the same shape.
 */
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * A realistic assistant line, trimmed of content.
 *
 * `id` is the message id, and it is a separate parameter because it matters:
 * in a real corpus every message id belongs to exactly one transcript. Reusing
 * one across files makes last-wins depend on the order files are visited, which
 * a full scan and an incremental scan have no reason to agree on.
 */
export function line(
  over: Record<string, unknown> = {},
  usage: Record<string, unknown> = {},
  id = 'msg_1',
): string {
  return JSON.stringify({
    type: 'assistant',
    uuid: 'u-1',
    sessionId: 's-1',
    timestamp: '2026-08-21T02:24:24.539Z',
    cwd: '/Users/x/proj',
    entrypoint: 'claude-vscode',
    requestId: 'req_1',
    message: {
      id,
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

/** A disposable projects/ root. Caller removes it with `rmRoot`. */
export async function mkRoot(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'ptp-'));
}

export async function rmRoot(root: string): Promise<void> {
  await fsp.rm(root, { recursive: true, force: true });
}

/** Write whole lines (each newline-terminated), creating parent dirs. */
export async function write(file: string, lines: string[]): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, lines.map((l) => `${l}\n`).join(''));
}

/** Append whole lines. */
export async function append(file: string, lines: string[]): Promise<void> {
  await fsp.appendFile(file, lines.map((l) => `${l}\n`).join(''));
}

/**
 * Append raw bytes with no trailing newline.
 *
 * This is how a half-written line is simulated — the case the README calls the
 * number-one bug of this class of parser.
 */
export async function appendRaw(file: string, raw: string): Promise<void> {
  await fsp.appendFile(file, raw);
}

/** Byte length of `lines` as `write`/`append` would lay them down. */
export function bytesOf(lines: string[]): number {
  return Buffer.byteLength(lines.map((l) => `${l}\n`).join(''));
}
