/**
 * The self-updater's I/O: ask GitHub, download, verify, unpack, hand over.
 *
 * One button does all of it. The person presses 업데이트 and the next thing
 * they see is the new version starting — no dialog, no dmg to drag, no zip to
 * unpack. The only way they are asked to do anything again is a failed
 * download or a checksum mismatch, which leaves a 다시 시도 button.
 *
 * The decisions live in electron/updatecore.ts and are tested there.
 */
import { app, net, shell } from 'electron';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  LATEST_SUMS_URL,
  RELEASES_URL,
  downloadUrl,
  fallbackTarget,
  installTarget,
  isNewer,
  latestFromSums,
  macScript,
  parseSums,
  tagUrl,
  updatedFrom,
  winScript,
  type SwapPlan,
  type UpdateStatus,
} from './updatecore.ts';

/** First look a little after launch, so it never competes with the first scan. */
const FIRST_CHECK_MS = 15_000;
/** Then every six hours, for a tray app that stays up for weeks. */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * The version this copy claims to be.
 *
 * POKETOKENPET_FAKE_VERSION lets a packaged build pretend to be older, which
 * is the only way to exercise a real update against a real release without
 * cutting one — see docs/DEVELOPMENT.md.
 */
export const currentVersion = () => process.env.POKETOKENPET_FAKE_VERSION || app.getVersion();

let status: UpdateStatus = {
  phase: 'idle',
  current: currentVersion(),
  version: null,
  url: null,
  received: 0,
  total: 0,
  message: null,
  canInstall: false,
};
/** What the last check found: the version, and this machine's zip and its hash. */
let latest: { version: string; asset: string | null; sha256: string | null } | null = null;
let timer: NodeJS.Timeout | null = null;
let listener: (s: UpdateStatus) => void = () => {};
/** Versions already announced by a system notification, so each is announced once. */
const announced = new Set<string>();
let announce: (version: string) => void = () => {};

function set(patch: Partial<UpdateStatus>) {
  status = { ...status, ...patch };
  listener(status);
}

export const getUpdate = () => status;

/**
 * Wire the updater to the app. Called once from main.ts after the windows exist.
 *
 * `onChange` pushes the status to every window and rebuilds the tray menu;
 * `onFound` shows the system notification.
 */
export function initUpdater(opts: {
  onChange: (s: UpdateStatus) => void;
  onFound: (version: string) => void;
  enabled: () => boolean;
}) {
  listener = opts.onChange;
  announce = opts.onFound;
  // Launched by the swap script: say so, once.
  const from = updatedFrom(process.argv);
  if (from && isNewer(currentVersion(), from)) {
    set({ phase: 'done', version: currentVersion() });
  }
  schedule(opts.enabled);
}

function schedule(enabled: () => boolean) {
  if (timer) clearTimeout(timer);
  const run = async () => {
    if (enabled()) await checkNow();
    timer = setTimeout(run, CHECK_EVERY_MS);
  };
  timer = setTimeout(run, FIRST_CHECK_MS);
}

export function stopUpdater() {
  if (timer) clearTimeout(timer);
  timer = null;
}

/**
 * Ask GitHub what the newest PUBLISHED release is.
 *
 * One small file — see LATEST_SUMS_URL for why it is the checksum list and not
 * the REST API. Draft releases never resolve there, which is what makes
 * pressing Publish on the release page the moment an update goes out: the CI
 * leaves every release a draft until a person has looked at it.
 *
 * Failure is silent on purpose: no network, GitHub down — none of that is the
 * person's problem, and the next check is six hours away.
 */
export async function checkNow(): Promise<void> {
  if (status.phase === 'downloading' || status.phase === 'installing') return;
  if (!app.isPackaged && !process.env.POKETOKENPET_FAKE_VERSION) return;
  try {
    const res = await net.fetch(LATEST_SUMS_URL, { headers: { 'User-Agent': 'PokeTokenPet' } });
    if (!res.ok) return;
    const found = latestFromSums(parseSums(await res.text()), process.platform, process.arch);
    if (!found || !isNewer(found.version, currentVersion())) return;
    latest = found;
    if (status.phase === 'available' && status.version === found.version) return;
    set({
      phase: 'available',
      version: found.version,
      url: tagUrl(found.version),
      received: 0,
      total: 0,
      message: null,
      canInstall: found.asset !== null,
    });
    if (!announced.has(found.version)) {
      announced.add(found.version);
      announce(found.version);
    }
  } catch {
    // Offline. Try again next round.
  }
}

/** The button. Downloads, verifies, unpacks and swaps — or opens the page where it cannot. */
export async function startUpdate(): Promise<void> {
  if (status.phase === 'downloading' || status.phase === 'installing') return;
  if (!latest?.asset || !latest.sha256) {
    await shell.openExternal(status.url ?? RELEASES_URL);
    return;
  }
  const { version, asset, sha256 } = latest;
  const work = path.join(app.getPath('temp'), `poketokenpet-update-${Date.now()}`);
  try {
    set({ phase: 'downloading', received: 0, total: 0, message: null });
    await fsp.mkdir(work, { recursive: true });

    const zip = path.join(work, asset);
    const digest = await download(downloadUrl(version, asset), zip);
    if (digest !== sha256) throw new Error('받은 파일이 손상되었습니다');

    set({ phase: 'installing' });
    const unpacked = path.join(work, 'new');
    await fsp.mkdir(unpacked);
    await unzip(zip, unpacked);
    await fsp.rm(zip, { force: true });

    const plan = await swapPlan(unpacked, work);
    await handOver(plan);
  } catch (err) {
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    set({
      phase: 'error',
      message: err instanceof Error ? err.message : '업데이트하지 못했습니다',
    });
  }
}

/** Stream to disk, hashing as it goes and reporting progress every quarter second. */
async function download(url: string, file: string): Promise<string> {
  const res = await net.fetch(url);
  if (!res.ok || !res.body) throw new Error(`파일을 받지 못했습니다 (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const hash = createHash('sha256');
  const out = fs.createWriteStream(file);
  const reader = res.body.getReader();
  let received = 0;
  let last = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      received += value.byteLength;
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
      const now = Date.now();
      if (now - last > 250) {
        last = now;
        set({ received, total });
      }
    }
  } finally {
    await new Promise<void>((r) => out.end(() => r()));
  }
  set({ received, total });
  return hash.digest('hex');
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'ignore', windowsHide: true });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`압축을 풀지 못했습니다 (${code})`))));
  });
}

/**
 * `ditto` on macOS because it keeps the symlinks inside Electron's frameworks;
 * a plain unzip flattens them and the app will not start. Windows 10 and later
 * ship bsdtar as tar.exe, which reads zip.
 */
function unzip(zip: string, dest: string): Promise<void> {
  if (process.platform === 'darwin') return run('/usr/bin/ditto', ['-x', '-k', zip, dest]);
  const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  return run(tar, ['-xf', zip, '-C', dest]);
}

/** Can this folder take a rename and a copy? */
async function writable(dir: string): Promise<boolean> {
  try {
    await fsp.access(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * What to copy, and where.
 *
 * In place when the running copy's folder can be written to. Otherwise the
 * per-user fallback (updatecore.fallbackTarget) — the person is never asked
 * for an administrator password, and the new version simply starts from there.
 */
async function swapPlan(unpacked: string, work: string): Promise<SwapPlan> {
  const exeName = path.basename(process.execPath);
  let source: string;
  if (process.platform === 'darwin') {
    const app = (await fsp.readdir(unpacked)).find((n) => n.endsWith('.app'));
    if (!app) throw new Error('받은 파일에 앱이 없습니다');
    source = path.join(unpacked, app);
  } else {
    // The zip holds the files at its root; tolerate one wrapping folder anyway.
    const entries = await fsp.readdir(unpacked, { withFileTypes: true });
    source = entries.some((e) => e.name === exeName)
      ? unpacked
      : entries.length === 1 && entries[0].isDirectory()
        ? path.join(unpacked, entries[0].name)
        : unpacked;
    if (!fs.existsSync(path.join(source, exeName))) throw new Error('받은 파일에 앱이 없습니다');
  }

  const here = installTarget(process.execPath, process.platform);
  const target =
    here && (await writable(path.dirname(here))) && (await writable(here))
      ? here
      : fallbackTarget(process.platform, os.homedir(), process.env.LOCALAPPDATA);
  if (!target) throw new Error('설치할 곳을 찾지 못했습니다');

  return { pid: process.pid, source, target, workDir: work, fromVersion: currentVersion(), exeName };
}

/** Write the swap script, start it detached, and get out of its way. */
async function handOver(plan: SwapPlan): Promise<void> {
  if (process.platform === 'darwin') {
    const file = path.join(plan.workDir, 'swap.sh');
    await fsp.writeFile(file, macScript(plan), { mode: 0o755 });
    spawn('/bin/sh', [file], { detached: true, stdio: 'ignore' }).unref();
  } else {
    const file = path.join(plan.workDir, 'swap.ps1');
    // BOM: Windows PowerShell 5 reads a BOM-less script as the ANSI code page,
    // which would mangle a Korean user name in the path.
    await fsp.writeFile(file, '\ufeff' + winScript(plan), 'utf8');
    spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', file],
      { detached: true, stdio: 'ignore', windowsHide: true },
    ).unref();
  }
  // The script waits on this pid; the sooner it exits the sooner the new one starts.
  app.quit();
}

/** 나중에 / 닫기: back to quiet until the next check finds something. */
export function dismissUpdate() {
  if (status.phase === 'downloading' || status.phase === 'installing') return;
  set({ phase: 'idle', message: null });
}
