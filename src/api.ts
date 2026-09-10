/**
 * One data layer for two hosts.
 *
 * In the browser the Vite middleware answers over HTTP; inside Electron the
 * same functions run in the main process and arrive over IPC. The components
 * never need to know which.
 */

/** Every mutating action the panel can send. Both hosts accept all of them. */
export type PetActionKind =
  | 'buy'
  | 'use'
  | 'teach'
  | 'forget'
  | 'hunt'
  /** Toggle the share ceiling on hunting. 'off' lifts it. */
  | 'huntcap'
  | 'rename'
  /** Draw the battle form outside battle. 'on' shows it. */
  | 'form'
  /** Use a signature item: reserve the next encounter for its legendary. */
  | 'legend'
  /** Use a legendary egg: the current companion graduates and it takes over. */
  | 'legendegg'
  /** Fuse a full set of fragments into its signature item. */
  | 'fuse'
  /**
   * The league party. Two numbers ride in `id`, colon-separated — see
   * `partyAction` in server/party.ts, which owns the parsing for both surfaces.
   */
  | 'partyset'
  | 'partyclear'
  | 'partyassign'
  | 'sprites';
export type ShopReply = { ok: boolean; message: string };

/** One row of the full-dex index. Only what the filters need — no sprites. */
export type DexIndexEntry = {
  speciesId: number;
  name: string;
  rarity: string;
  generation: number;
  types: { id: string; name: string }[];
};

/**
 * One 도감 entry, as the detail screen needs it.
 *
 * Spelled out here rather than imported from server/dexentry.ts for the same
 * reason DexIndexEntry is: the renderer may not reach into server/, and every
 * id is already resolved to Korean text on the way out — which is why `mine`
 * carries `formKo` and not a form id it could never look up.
 */
export type DexDetail = {
  speciesId: number;
  name: string;
  nameEn: string;
  /** Korean genus, e.g. "화염포켓몬". */
  genus: string;
  types: { id: string; name: string }[];
  heightM: number;
  weightKg: number;
  rarity: string;
  generation: number;
  sprite: string | null;
  /** null for the species PokeAPI has no Korean dex entry for. */
  flavor: string | null;
  stats: { name: string; value: number }[];
  statTotal: number;
  abilities: { ko: string; desc: string | null; hidden: boolean }[];
  /** Only the multipliers that are not 1x, strongest first. */
  matchups: { factor: number; types: { id: string; name: string }[] }[];
  /** Stage columns. A branching line puts every alternative in one column. */
  stages: { speciesId: number; name: string; collected: boolean; here: boolean }[][];
  forms: { id: number; kind: 'mega' | 'gmax' | 'fusion'; ko: string; power: number }[];
  tmCount: number;
  mine: { firstSeenAt: number; nickname: string | null; shiny: boolean; formKo: string | null } | null;
};

export type Prefs = {
  petEnabled: boolean;
  petSize: number;
  petX: number | null;
  petY: number | null;
  petClickThrough: boolean;
  petAlwaysOnTop: boolean;
  openAtLogin: boolean;
  showTokensInTray: boolean;
};

type Bridge = {
  getState(force?: boolean): Promise<unknown>;
  shop(action: PetActionKind, id: string, slot?: number | null): Promise<ShopReply>;
  dexIndex(): Promise<DexIndexEntry[]>;
  dexEntry(speciesId: number, shiny: boolean): Promise<DexDetail | null>;
  getPrefs(): Promise<Prefs>;
  setPrefs(patch: Partial<Prefs>): Promise<void>;
  sizes(): Promise<number[]>;
  stepSize(delta: number): Promise<void>;
  /** Resize the pet window to the measured sprite; see pixelFit.petWindow(). */
  fitTo(w: number, h: number): void;
  openPopover(): Promise<void>;
  drag(dx: number, dy: number): void;
  dragEnd(): void;
  setInteractive(v: boolean): void;
  onState(cb: (s: unknown) => void): () => void;
  onPrefs(cb: (p: unknown) => void): () => void;
  /** True while the machine is asleep or the screen is locked. */
  isIdle(): Promise<boolean>;
  onIdle(cb: (v: boolean) => void): () => void;
};

declare global {
  interface Window {
    pet?: Bridge;
  }
}

export const bridge = (): Bridge | undefined =>
  typeof window !== 'undefined' ? window.pet : undefined;

export const isElectron = () => bridge() !== undefined;

/** Sprites come from the dev server on the web and a custom scheme in Electron. */
export function spriteUrl(name: string): string {
  return isElectron() ? `petsprite://s/${encodeURIComponent(name)}` : `/sprites/${name}`;
}

export async function fetchState<T>(force = false): Promise<T> {
  const b = bridge();
  if (b) return (await b.getState(force)) as T;
  const res = await fetch(`/api/state${force ? '?force=1' : ''}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * The whole dex, for the "include unseen" view.
 *
 * ~116KB and completely static, so it is deliberately not part of the state
 * payload — callers should fetch it once and hold onto it.
 */
export async function fetchDexIndex(): Promise<DexIndexEntry[]> {
  const b = bridge();
  if (b) return b.dexIndex();
  const res = await fetch('/api/dex');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as DexIndexEntry[];
}

/**
 * One species, fetched when a card is pressed.
 *
 * Not folded into the index above: that one is static and cached for an hour,
 * while half of this is the player's own record. Per (species, shiny) because
 * that pair is what a card is — the grid files a shiny and a plain individual
 * as two rows with different dates and different nicknames.
 */
export async function fetchDexEntry(speciesId: number, shiny: boolean): Promise<DexDetail | null> {
  const b = bridge();
  if (b) return b.dexEntry(speciesId, shiny);
  const res = await fetch(`/api/dex/${speciesId}${shiny ? '?shiny=1' : ''}`);
  // 404 is "no such species", which is an answer rather than a failure — both
  // surfaces say it the same way so the caller never has to know which it used.
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as DexDetail;
}

export async function shopAction(
  action: PetActionKind,
  id: string,
  slot: number | null = null,
): Promise<ShopReply> {
  const b = bridge();
  if (b) return b.shop(action, id, slot);
  const res = await fetch('/api/shop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, id, slot }),
  });
  return (await res.json()) as ShopReply;
}
