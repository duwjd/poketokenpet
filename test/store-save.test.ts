import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The store reads and writes under appDataDir(); point it at a scratch folder
// so nothing here can touch a real ~/.poketokenpet.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poketokenpet-store-'));
vi.mock('../server/paths.ts', async (orig) => ({
  ...(await orig<typeof import('../server/paths.ts')>()),
  appDataDir: () => root,
}));

const { backupState, backupsDir, loadState, parseSave, pruneBackups, saveState } = await import(
  '../server/store.ts'
);
const { initialState } = await import('../server/game.ts');

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

beforeEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.mkdir(root, { recursive: true });
});

const backups = async () => (await fsp.readdir(backupsDir()).catch(() => [] as string[])).sort();

describe('parseSave', () => {
  const save = { ...initialState(), dex: [{ speciesId: 25, shiny: false, firstSeenAt: 1 }], lifetimeEarned: 9e6 };

  it('takes a save this app wrote, and clears the token anchor', () => {
    const out = parseSave(JSON.stringify({ ...save, lastTotal: { activity: 123_456_789 } }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state.dex.map((d) => d.speciesId)).toContain(25);
    expect(out.state.lifetimeEarned).toBe(9e6);
    // Another machine's corpus total would otherwise pay out as earned tokens.
    expect(out.state.lastTotal).toEqual({});
  });

  it('brings an older save forward through migrate', () => {
    const old = { schemaVersion: 3, dex: [], spentTokens: 100 };
    const out = parseSave(JSON.stringify(old));
    expect(out.ok && out.state.schemaVersion).toBe(initialState().schemaVersion);
  });

  it('refuses what is not a save, rather than migrating it into an empty one', () => {
    for (const text of ['not json', '[]', 'null', '42', '{"name":"package"}', '{"dex":{}}', '{"dex":[],"schemaVersion":"4"}']) {
      expect(parseSave(text).ok).toBe(false);
    }
  });

  it('refuses a save from a newer app, whose fields migrate would drop', () => {
    const out = parseSave(JSON.stringify({ ...save, schemaVersion: initialState().schemaVersion + 1 }));
    expect(out).toEqual({ ok: false, message: expect.stringContaining('업데이트') });
  });
});

describe('backups', () => {
  it('prunes by age, not by name', async () => {
    const dir = backupsDir();
    await fsp.mkdir(dir, { recursive: true });
    // 'v3' sorts after 'before-…' by name; by age it is the oldest.
    const names = ['state.v3.json', 'state.before-v0.7.0.json', 'state.before-import-1.json'];
    for (const [i, n] of names.entries()) {
      await fsp.writeFile(path.join(dir, n), '{}');
      const t = new Date(Date.UTC(2026, 0, 1 + i));
      await fsp.utimes(path.join(dir, n), t, t);
    }
    await pruneBackups(dir, 2);
    expect(await backups()).toEqual(['state.before-import-1.json', 'state.before-v0.7.0.json']);
  });

  it('copies the current save under its tag, and nothing when there is none', async () => {
    expect(await backupState('before-v9.9.9')).toBeNull();
    await saveState(initialState());
    const dest = await backupState('before-v9.9.9');
    expect(dest && path.basename(dest)).toBe('state.before-v9.9.9.json');
    // Stamped with when it was taken, so pruning keeps it over older copies.
    expect(Date.now() - (await fsp.stat(dest!)).mtimeMs).toBeLessThan(60_000);
  });
});

describe('an unreadable save', () => {
  it('is set aside once before the fresh state that replaces it is written', async () => {
    await fsp.writeFile(path.join(root, 'state.json'), '{"dex": [ broken');
    for (let i = 0; i < 3; i++) {
      // Every poll re-reads it; only the first may copy it.
      expect((await loadState()).dex).toEqual([]);
    }
    const kept = (await backups()).filter((f) => f.startsWith('state.unreadable-'));
    expect(kept).toHaveLength(1);
    expect(await fsp.readFile(path.join(backupsDir(), kept[0]), 'utf8')).toBe('{"dex": [ broken');
  });

  it('is not confused with a missing one', async () => {
    expect((await loadState()).dex).toEqual([]);
    expect(await backups()).toEqual([]);
  });
});
