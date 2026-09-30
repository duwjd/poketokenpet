/**
 * The self-updater's decisions, with no Electron and no I/O in them.
 *
 * ## Why not electron-updater
 *
 * It cannot update this app. On macOS it drives Squirrel.Mac, which refuses to
 * swap in a bundle that is not signed with a Developer ID — and this one is
 * unsigned on purpose (electron-builder.yml, `identity: null`). On Windows it
 * only knows the NSIS installer, and this app ships a portable zip because
 * SmartScreen treats a zip far more kindly.
 *
 * So the app does it itself, with files every release already carries: the
 * per-arch `.zip` (electron-builder.yml `artifactName`) and `SHA256SUMS.txt`
 * (.github/workflows/release.yml). Renaming either breaks every installed
 * copy's updater — docs/DEVELOPMENT.md says so where the release is cut.
 *
 * A file the app downloads itself carries no quarantine attribute and no
 * Mark-of-the-Web, so the replaced app starts without the Gatekeeper or
 * SmartScreen warning the first download had to click through.
 *
 * Everything here is pure so test/update.test.ts can pin it; electron/update.ts
 * does the fetching, the unpacking and the spawning.
 */
import path from 'node:path';

export const REPO = 'duwjd/poketokenpet';
export const SUMS_NAME = 'SHA256SUMS.txt';
export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
/**
 * The one request a check makes.
 *
 * Not the REST API: `/releases/latest` there is capped at 60 unauthenticated
 * calls an hour PER IP, so everyone behind one office NAT shares that budget —
 * the first run of the end-to-end test found it already spent and the app
 * silently never saw an update. `releases/latest/download/<file>` is the
 * plain download redirect, which has no such cap, and it resolves only to the
 * newest PUBLISHED release, never a draft or a prerelease.
 *
 * The checksum list is the whole answer: its file names carry the version,
 * and it holds the hash the download will be checked against.
 */
export const LATEST_SUMS_URL = `${RELEASES_URL}/download/${SUMS_NAME}`;
export const tagUrl = (version: string) => `https://github.com/${REPO}/releases/tag/v${version}`;
export const downloadUrl = (version: string, name: string) =>
  `https://github.com/${REPO}/releases/download/v${version}/${name}`;

/** `v0.10.2` or `0.10.2` → [0, 10, 2]; anything else → null. */
export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Strictly newer. A tag that does not parse is never an update. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/**
 * The zip this machine should take, or null where there is none to swap in.
 *
 * The zip, never the dmg: a zip unpacks with no mounting and no admin, and
 * `ditto` keeps the framework symlinks a .app cannot run without.
 */
export function assetFor(version: string, platform: string, arch: string): string | null {
  const v = version.replace(/^v/, '');
  if (arch !== 'x64' && arch !== 'arm64') return null;
  if (platform === 'darwin') return `PokeTokenPet-${v}-${arch}-mac.zip`;
  if (platform === 'win32') return `PokeTokenPet-${v}-${arch}-win.zip`;
  return null;
}

/** `shasum -a 256 *` output → file name → lowercase hex digest. */
export function parseSums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    // Binary mode prefixes the name with '*'; the release job uses text mode,
    // but accepting both costs one character.
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (m) out.set(m[2], m[1].toLowerCase());
  }
  return out;
}

/**
 * Read the newest release off its checksum list.
 *
 * The version comes from the file names (`PokeTokenPet-0.5.0-…`), and `asset`
 * and `sha256` are this machine's zip — or null where there is none, which
 * still announces the version but sends the button to the release page.
 */
export function latestFromSums(
  sums: Map<string, string>,
  platform: string,
  arch: string,
): { version: string; asset: string | null; sha256: string | null } | null {
  let version: string | null = null;
  for (const name of sums.keys()) {
    const m = /^PokeTokenPet-(\d+\.\d+\.\d+)-/.exec(name);
    if (m && (!version || isNewer(m[1], version))) version = m[1];
  }
  if (!version) return null;
  const asset = assetFor(version, platform, arch);
  const sha256 = asset ? (sums.get(asset) ?? null) : null;
  return { version, asset: sha256 ? asset : null, sha256 };
}

/**
 * Where the running copy lives, or null when that cannot be trusted.
 *
 * macOS: the .app bundle three levels above the binary. A copy run straight
 * out of Downloads without being moved is launched from a randomised,
 * read-only App Translocation mount, and replacing THAT would change nothing
 * the next launch sees — so it counts as unknown.
 *
 * Windows: the folder the portable zip was unpacked into.
 */
export function installTarget(execPath: string, platform: string): string | null {
  if (platform === 'darwin') {
    if (execPath.includes('/AppTranslocation/')) return null;
    const bundle = path.posix.resolve(execPath, '../../..');
    if (!bundle.endsWith('.app')) return null;
    if (path.posix.basename(path.posix.dirname(execPath)) !== 'MacOS') return null;
    return bundle;
  }
  if (platform === 'win32') return path.win32.dirname(execPath);
  return null;
}

/**
 * Where to install when the running copy's own place cannot be written to.
 *
 * Both are per-user and need no administrator: ~/Applications is the folder
 * macOS itself offers for exactly this, and %LOCALAPPDATA%\Programs is where
 * per-user Windows installers put themselves.
 */
export function fallbackTarget(platform: string, home: string, localAppData: string | undefined): string | null {
  if (platform === 'darwin') return path.posix.join(home, 'Applications', 'PokeTokenPet.app');
  if (platform === 'win32') {
    const base = localAppData ?? path.win32.join(home, 'AppData', 'Local');
    return path.win32.join(base, 'Programs', 'PokeTokenPet');
  }
  return null;
}

/** POSIX single quotes: everything literal, a quote closes-escapes-reopens. */
export const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** PowerShell single quotes: literal, with a quote written twice. */
export const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

export type SwapPlan = {
  /** The process to wait out before touching its files. */
  pid: number;
  /** The unpacked new version: a .app (macOS) or the folder holding the exe (Windows). */
  source: string;
  /** What to replace — an existing install, or a fresh fallback location. */
  target: string;
  /** Deleted at the end: the download and the unpacked copy. */
  workDir: string;
  /** Handed to the new copy so it can say what just happened. */
  fromVersion: string;
  /** Windows only: the exe to start, relative to the target folder. */
  exeName?: string;
};

/**
 * The macOS swap, as a shell script run detached after the app quits.
 *
 * The old bundle is moved aside rather than deleted, so a failed copy puts it
 * back and whatever happens, SOMETHING starts at the end — the new version or
 * the old one. `open` is what makes the whole thing need no second click.
 */
export function macScript(p: SwapPlan): string {
  const T = shQuote(p.target);
  const OLD = shQuote(`${p.target}.old`);
  return [
    '#!/bin/sh',
    `while kill -0 ${p.pid} 2>/dev/null; do sleep 0.2; done`,
    `mkdir -p ${shQuote(path.posix.dirname(p.target))}`,
    `rm -rf ${OLD}`,
    `if [ -e ${T} ]; then mv ${T} ${OLD} || { open ${T}; exit 1; }; fi`,
    `if ditto ${shQuote(p.source)} ${T}; then`,
    `  rm -rf ${OLD}`,
    'else',
    `  rm -rf ${T}`,
    `  [ -e ${OLD} ] && mv ${OLD} ${T}`,
    'fi',
    `open ${T} --args ${shQuote(`--updated-from=${p.fromVersion}`)}`,
    `rm -rf ${shQuote(p.workDir)}`,
    '',
  ].join('\n');
}

/**
 * The Windows swap, as a PowerShell script run hidden after the app quits.
 *
 * robocopy rather than Copy-Item: it merges into an existing folder without
 * PowerShell's nest-the-directory quirk, and its /R retries ride out the
 * second or two Windows keeps an exited process's DLLs locked. No /MIR —
 * someone may have unpacked the zip into a folder that holds other things,
 * and a mirror would delete them. Exit codes under 8 are success.
 */
export function winScript(p: SwapPlan): string {
  const exe = p.exeName ?? 'PokeTokenPet.exe';
  return [
    `try { Wait-Process -Id ${p.pid} -Timeout 60 -ErrorAction Stop } catch {}`,
    `$src = ${psQuote(p.source)}`,
    `$dst = ${psQuote(p.target)}`,
    'New-Item -ItemType Directory -Force -Path $dst | Out-Null',
    'robocopy $src $dst /E /R:20 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null',
    `$exe = Join-Path $dst ${psQuote(exe)}`,
    `if (Test-Path -LiteralPath $exe) { Start-Process -FilePath $exe -ArgumentList ${psQuote(`--updated-from=${p.fromVersion}`)} }`,
    `Remove-Item -LiteralPath ${psQuote(p.workDir)} -Recurse -Force -ErrorAction SilentlyContinue`,
    '',
  ].join('\r\n');
}

/** `--updated-from=0.4.0` among argv → '0.4.0', else null. */
export function updatedFrom(argv: readonly string[]): string | null {
  for (const a of argv) {
    const m = /^--updated-from=(.+)$/.exec(a);
    if (m && parseVersion(m[1])) return m[1];
  }
  return null;
}

/** The state the panel draws. One object, sent whole on every change. */
export type UpdateStatus = {
  phase: 'idle' | 'available' | 'downloading' | 'installing' | 'error' | 'done';
  /** The running version. */
  current: string;
  /** The version on offer ('available' onward), or the one just installed ('done'). */
  version: string | null;
  /** The release page, for its notes. */
  url: string | null;
  received: number;
  total: number;
  /** What went wrong, in Korean, for 'error'. */
  message: string | null;
  /** False where there is no zip for this machine — the button opens the page instead. */
  canInstall: boolean;
};
