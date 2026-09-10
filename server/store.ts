import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { appDataDir } from './paths.ts';
import { hasDamaging, initialState, starterMove, type GameState } from './game.ts';
import { LEGENDS } from './legenddata.ts';
import { MOVE_SLOTS } from './hunt.ts';
import { backfillPreEvolutions, departedCount } from './dex.ts';

const STATE_FILE = () => path.join(appDataDir(), 'state.json');

export async function ensureDataDir(): Promise<void> {
  await fsp.mkdir(appDataDir(), { recursive: true });
  await fsp.mkdir(path.join(appDataDir(), 'sprites'), { recursive: true });
}

/**
 * Write via a temp file and rename.
 *
 * A plain overwrite that dies mid-write leaves a truncated file, and
 * "my Pokémon disappeared" is the one bug that ends the project.
 */
export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

/** A save as it may exist on disk: any schema version, any field missing. */
type StoredState = Partial<GameState> & { baselineTokens?: number | null };

/**
 * Bring an older save forward.
 *
 * Missing fields take their defaults, so an old save keeps its egg, companion
 * and dex and simply starts with an empty bag rather than being reset.
 *
 * v2 -> v3 retires `baselineTokens`. Its earned figure cannot be recovered — it
 * was `liveTotal - baseline`, and a pruned corpus is exactly why that number is
 * untrustworthy. So rebuild the counter from what the save can PROVE was
 * earned: the wallet has already spent `spentTokens`, and the companion is
 * already standing on `tokensAtStageStart`. Taking the larger keeps the wallet
 * out of the red and the progress bar off zero, without gifting progress.
 *
 * v3 -> v4 adds hunting. Two details are load-bearing:
 *
 * - A v3 companion has no `moves`, and every hunt calculation reads it. Left
 *   undefined it throws inside buildState, /api/state answers 500, and the
 *   panel shows "연결 실패" — for every existing user, on first launch.
 * - `huntedAt` starts null, never `Date.now()` and never 0. A clock here would
 *   make `migrate` non-deterministic for the tests that call it directly, and 0
 *   reads as an epoch-sized gap that pays out the offline cap on every tick.
 */
export function migrate(parsed: StoredState | null): GameState {
  if (!parsed || typeof parsed !== 'object') return initialState();
  const base = initialState();
  const bonusTokens = parsed.bonusTokens ?? 0;
  const spentTokens = parsed.spentTokens ?? 0;
  const huntTokens = parsed.huntTokens ?? 0;
  // Normalise the companion rather than passing it through: a v3 save has no
  // moveset and everything downstream reads it.
  const active = parsed.active ? { ...parsed.active, moves: parsed.active.moves ?? [] } : null;
  // Everything alive gets the attack it should have hatched with. Only into a
  // free slot: a companion whose four slots are full made those choices, and
  // silently discarding one to enforce a rule added later is worse than leaving
  // it to the battle's plain-swing fallback.
  //
  // Idempotent, so this runs on every load without a schemaVersion bump —
  // once the move is in, hasDamaging is true and nothing happens again.
  if (active && active.moves.length < MOVE_SLOTS && !hasDamaging(active.moves)) {
    const starter = starterMove(active.pathIds[active.stageIndex]);
    if (starter !== null && !active.moves.includes(starter)) active.moves = [...active.moves, starter];
  }
  // A companion that hatched before these existed gets today's counters as its
  // baseline, so it reads zero from here and counts forward honestly. There is
  // no way to recover the real figure — nothing in the save records the hunt
  // counters as of the last hatch — and inventing one would be worse than
  // starting the clock now. Same answer `trainerWins` gave for the same reason.
  //
  // Idempotent, like the starter-move backfill above: once set, never re-set.
  if (active && active.huntTokensAtBirth === undefined) {
    active.huntTokensAtBirth = parsed.huntTokens ?? 0;
  }
  if (active && active.huntCountAtBirth === undefined) {
    active.huntCountAtBirth = parsed.huntCount ?? 0;
  }
  // What lifetimeTokens must already have reached, minus the parts items and
  // hunting gave. Subtracting huntTokens is a no-op on a v3 save, but leaving
  // it out would rot the moment there is a v5.
  const reached =
    (active ? active.tokensAtStageStart : (parsed.eggStartedAt ?? 0)) - bonusTokens - huntTokens;
  const dex = backfillPreEvolutions(parsed.dex ?? base.dex, 0);

  return {
    schemaVersion: base.schemaVersion,
    // Deliberately empty on an upgrade: the next scan re-anchors on the corpus
    // as it stands now, so whatever was pruned never counts against the user.
    lastTotal:
      parsed.lastTotal && typeof parsed.lastTotal === 'object' ? { ...parsed.lastTotal } : {},
    lifetimeEarned: parsed.lifetimeEarned ?? Math.max(0, spentTokens, reached),
    hatchThreshold: parsed.hatchThreshold ?? base.hatchThreshold,
    eggStartedAt: parsed.eggStartedAt ?? base.eggStartedAt,
    active,
    // Entries recorded before pre-evolutions were registered get them now.
    // No version bump: dex is already an array and a longer one needs nothing.
    dex,
    /**
     * The only counter in the save nothing can re-derive, so a write lost to a
     * crash or a restored backup would leave it below the truth forever — and
     * a dex that grew while "n마리를 떠나보냈습니다" stood still is exactly what
     * that looks like on screen. The dex still PROVES a minimum, so floor it
     * there. `departedCount` under-reads rather than over-reads, so this can
     * only ever raise the number, never invent a departure.
     */
    retiredCount: Math.max(parsed.retiredCount ?? base.retiredCount, departedCount(dex)),
    spentTokens,
    bonusTokens,
    inventory: { ...base.inventory, ...(parsed.inventory ?? {}) },
    shinyCharmActive: parsed.shinyCharmActive ?? false,
    forcedRarity: parsed.forcedRarity ?? null,
    everstone: parsed.everstone ?? false,
    huntTokens,
    huntedAt: parsed.huntedAt ?? null,
    huntCount: parsed.huntCount ?? 0,
    tms: { ...(parsed.tms ?? {}) },
    huntLog: parsed.huntLog ?? [],
    huntEnabled: parsed.huntEnabled ?? base.huntEnabled,
    // Optional, so no schema bump: an older save simply has the cap on, which
    // is the default anyway.
    huntUncapped: parsed.huntUncapped ?? base.huntUncapped,
    /**
     * The form fields, also optional and also no schema bump.
     *
     * They MUST be listed here even though they are optional, because this
     * function is an allow-list, not a spread: anything it does not name is
     * dropped on the next load. A stone collection that empties every twenty
     * seconds is what leaving them out looks like — and nothing would have
     * said so.
     *
     * `keyStone` and `dynamaxBand` used to be here too, as worn toggles. They
     * are gone on purpose: holding the item IS the condition now, and dropping
     * them costs nobody anything, because the toggle could only ever be on for
     * someone who owned one and `inventory` is kept.
     */
    stones: { ...(parsed.stones ?? {}) },
    showBattleForm: parsed.showBattleForm ?? false,
    /**
     * The achievement fields. Optional, no schema bump, same allow-list rule as
     * the block above — and the same failure mode if forgotten, except louder:
     * an unlock table that empties every twenty seconds re-grants every reward
     * on every tick.
     */
    achievements: { ...(parsed.achievements ?? {}) },
    repeats: { ...(parsed.repeats ?? {}) },
    /**
     * The legendary fields. Same allow-list rule, same failure mode — a
     * signature item collection that empties every twenty seconds would lock
     * every gate it opened, silently.
     */
    legendItems: { ...(parsed.legendItems ?? {}) },
    shards: { ...(parsed.shards ?? {}) },
    legendEggs: { ...(parsed.legendEggs ?? {}) },
    forcedSpecies: parsed.forcedSpecies ?? null,
    forcedNext: parsed.forcedNext ?? null,
    awardTokens: parsed.awardTokens ?? 0,
    trainerWins: parsed.trainerWins ?? 0,
    /**
     * The badge fields. Same allow-list rule as the blocks above, and the
     * loudest failure yet if forgotten: a badge case that empties every twenty
     * seconds re-opens every gym, re-awards every badge achievement and its TM
     * on every tick, and locks the league.
     *
     * Deduped, sorted and clamped rather than passed through. Nothing else in
     * the save can re-derive a badge, so a corrupt array has no second source
     * to heal from — which is the opposite of `retiredCount` below and exactly
     * why this one has to defend itself here.
     */
    badges: [...new Set(parsed.badges ?? [])]
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 8)
      .sort((a, b) => a - b),
    /**
     * Floored at the number of badges held, the same self-healing trick
     * `tmsFound` gets from the bag: a badge is proof of a gym win, so a save
     * from before this counter existed starts from a true number rather than
     * from zero. Rematches are lost, which under-reads rather than over-reads.
     */
    /**
     * The party and the run in progress. Same allow-list rule, and the party
     * is the one field with no second source at all — nothing else in the save
     * knows which six were picked, so losing it costs the picking. The machines
     * that armed it were spent and are not refunded by a lost write either,
     * which is unfortunate and honest.
     *
     * `leagueRun` is normalised rather than trusted: a bar count that no longer
     * matches the party would index off the end of `hp` on the next round, and
     * a run that survived a party edit is not the run that was started.
     */
    party: Array.isArray(parsed.party)
      ? parsed.party
          .filter((m) => m && Number.isInteger(m.speciesId))
          .slice(0, 6)
          .map((m) => ({
            speciesId: m.speciesId,
            shiny: !!m.shiny,
            ...(m.formId !== undefined ? { formId: m.formId } : {}),
            moves: Array.isArray(m.moves) ? m.moves.filter(Number.isInteger).slice(0, 4) : [],
          }))
      : [],
    leagueRun:
      parsed.leagueRun &&
      Number.isInteger(parsed.leagueRun.at) &&
      Array.isArray(parsed.leagueRun.hp) &&
      parsed.leagueRun.hp.length === (parsed.party?.length ?? 0)
        ? { at: parsed.leagueRun.at, hp: parsed.leagueRun.hp.map((n) => Math.max(0, Number(n) || 0)) }
        : null,
    /**
     * Floored at everything the save can already prove was met.
     *
     * The same self-healing `retiredCount` gets from `departedCount(dex)`: a
     * save that predates this field still holds the evidence — a legendary in
     * the dex was raised, an egg was won, the companion out right now may be
     * one — and all three required meeting it. Under-reads rather than
     * over-reads, because a legendary that beat you leaves nothing behind.
     */
    metLegends: [
      ...new Set([
        ...(Array.isArray(parsed.metLegends) ? parsed.metLegends.filter(Number.isInteger) : []),
        ...(parsed.dex ?? []).map((d) => d.speciesId).filter((id) => LEGENDS.some((l) => l.id === id)),
        ...Object.entries(parsed.legendEggs ?? {})
          .filter(([, n]) => (n ?? 0) > 0)
          .map(([id]) => Number(id)),
        ...(parsed.active ? [parsed.active.pathIds[parsed.active.stageIndex]] : []).filter((id) =>
          LEGENDS.some((l) => l.id === id),
        ),
      ]),
    ].sort((a, b) => a - b),
    leagues: { ...(parsed.leagues ?? {}) },
    leagueWins: parsed.leagueWins ?? 0,
    /** Floored at "cleared once" — a Hall of Fame entry proves the full run. */
    leagueBest: Math.max(parsed.leagueBest ?? 0, (parsed.leagueWins ?? 0) > 0 ? 5 : 0),
    gymWins: Math.max(
      parsed.gymWins ?? 0,
      new Set((parsed.badges ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= 8)).size,
    ),
    /**
     * Floored at what is currently held, the way `retiredCount` is floored at
     * `departedCount(dex)`: TMs in the bag are TMs that were certainly found,
     * so a save from before this counter existed starts from a true number
     * rather than from zero.
     */
    tmsFound: Math.max(
      parsed.tmsFound ?? 0,
      Object.values(parsed.tms ?? {}).reduce((a, n) => a + (n ?? 0), 0),
    ),
  };
}

export async function loadState(): Promise<GameState> {
  await ensureDataDir();
  let parsed: StoredState;
  try {
    parsed = JSON.parse(await fsp.readFile(STATE_FILE(), 'utf8')) as StoredState;
  } catch {
    return initialState();
  }
  const migrated = migrate(parsed);
  // Snapshot before the first write in a new schema, so a bad migration is
  // recoverable rather than a silently vanished Pokemon.
  if (parsed.schemaVersion !== migrated.schemaVersion) {
    await backupState(`v${parsed.schemaVersion ?? 0}`).catch(() => {});
  }
  return migrated;
}

export async function saveState(state: GameState): Promise<void> {
  await ensureDataDir();
  await writeJsonAtomic(STATE_FILE(), state);
}

/** Keep a few rolling backups so a bad migration is survivable. */
export async function backupState(tag: string): Promise<void> {
  const file = STATE_FILE();
  if (!fs.existsSync(file)) return;
  const dir = path.join(appDataDir(), 'backups');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.copyFile(file, path.join(dir, `state.${tag}.json`));
  const entries = (await fsp.readdir(dir)).filter((f) => f.startsWith('state.')).sort();
  for (const old of entries.slice(0, Math.max(0, entries.length - 5))) {
    await fsp.rm(path.join(dir, old), { force: true });
  }
}
