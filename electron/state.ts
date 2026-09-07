import fsp from 'node:fs/promises';
import path from 'node:path';
import { appDataDir } from '../server/paths.ts';
import { writeJsonAtomic } from '../server/store.ts';

/**
 * Window/app preferences, separate from game state.
 *
 * Kept in the same dotfolder so "back up your pet" is one directory on both
 * platforms — no App Support vs %APPDATA% branch.
 */
export type Prefs = {
  petEnabled: boolean;
  /** Rendered size of the floating pet in logical px. */
  petSize: number;
  petX: number | null;
  petY: number | null;
  /** Click-through: the pet ignores the mouse entirely. */
  petClickThrough: boolean;
  petAlwaysOnTop: boolean;
  openAtLogin: boolean;
  showTokensInTray: boolean;
};

export const PET_SIZES = [64, 96, 128, 160, 200, 256] as const;

export const DEFAULT_PREFS: Prefs = {
  petEnabled: true,
  petSize: 128,
  petX: null,
  petY: null,
  petClickThrough: false,
  petAlwaysOnTop: true,
  openAtLogin: false,
  showTokensInTray: true,
};

const file = () => path.join(appDataDir(), 'prefs.json');

export async function loadPrefs(): Promise<Prefs> {
  try {
    const raw = await fsp.readFile(file(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    const merged = { ...DEFAULT_PREFS, ...parsed };
    // A stale or hand-edited size must not produce an unusable window.
    if (!PET_SIZES.includes(merged.petSize as (typeof PET_SIZES)[number])) {
      merged.petSize = nearestSize(merged.petSize);
    }
    return merged;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  await fsp.mkdir(appDataDir(), { recursive: true });
  await writeJsonAtomic(file(), prefs);
}

export function nearestSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_PREFS.petSize;
  return PET_SIZES.reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best), PET_SIZES[0]);
}

/** Step through the size list, clamped at both ends. */
export function stepSize(current: number, delta: number): number {
  const i = PET_SIZES.indexOf(nearestSize(current) as (typeof PET_SIZES)[number]);
  const next = Math.min(PET_SIZES.length - 1, Math.max(0, i + delta));
  return PET_SIZES[next];
}
