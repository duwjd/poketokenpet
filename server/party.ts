import { josa } from '../src/josa.ts';
import type { DexEntry, GameState, PartyMember } from './game.ts';
import { MOVE_SLOTS } from './hunt.ts';
import { canLearn, moveById } from './moves.ts';
import type { ShopResult } from './shop.ts';
import { speciesName } from './species.ts';

/**
 * The Pokemon League party.
 *
 * ── What this is for ──────────────────────────────────────────────────────
 * The dex has never done anything. It is a record of what graduated, it fills
 * up, and nothing in the game reads it. The league party is the first thing
 * that does: six of the Pokemon you actually raised, armed out of the bag, and
 * they are what walks into 석영고원.
 *
 * The companion is untouched by all of this. It still hunts, it still fights
 * the gyms, and it is still what the progress bar measures — raising ONE
 * Pokemon at a time is the shape of this app, and a party that hunted would
 * quietly make it a different game.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * ## Two rules, and they are the whole file
 *
 * 1. **You may only field what you raised.** Membership is checked against the
 *    dex on the way in, on (species, shiny), the key the dex itself uses.
 * 2. **Arming a member spends the TM.** Exactly what `teach` does to the
 *    companion, and for the same reason: a machine that could arm six members
 *    and be handed back is not a collection any more. So building a party is a
 *    row of irreversible choices, which is what makes 24 slots mean something.
 *
 * The one thing that is free is a move the dex already records for that
 * species — it has been taught to one before, so teaching it again costs the
 * bag nothing. That is what `DexEntry.moves` is for.
 *
 * Every function here follows the `ShopResult` contract: never throws, returns
 * the state unchanged on a refusal, and the message is what the user reads.
 */

/** Six. The league will not open with fewer. */
export const PARTY_SIZE = 6;

/** The party as stored, padded to nothing — absent and empty mean the same. */
export function partyOf(state: GameState): PartyMember[] {
  return state.party ?? [];
}

const sameAs = (m: PartyMember, d: { speciesId: number; shiny: boolean }) =>
  m.speciesId === d.speciesId && m.shiny === d.shiny;

/** Is this dex entry in the party already? */
export function inParty(state: GameState, d: DexEntry): boolean {
  return partyOf(state).some((m) => sameAs(m, d));
}

/**
 * Dex entries that could still be added.
 *
 * The whole dex minus what is already fielded. Deliberately NOT filtered by
 * "can learn anything" — an unarmed member is a legal bad choice, and hiding
 * 메타몽 would be the screen making a decision that belongs to the player.
 */
export function partyCandidates(state: GameState): DexEntry[] {
  return state.dex.filter((d) => !inParty(state, d));
}

export type Assignable = {
  moveId: number;
  /** `dex` costs nothing; `bag` spends one machine from `state.tms`. */
  from: 'dex' | 'bag';
};

/**
 * What could go on this member right now, and what it would cost.
 *
 * A move already on the member is excluded — `teach` refuses a duplicate and
 * so does this — and so is anything the species cannot be taught. Sorted so
 * the free ones come first: a player scanning the list should see what the
 * Pokemon already knows before what it would have to spend a machine on.
 */
export function assignable(state: GameState, index: number): Assignable[] {
  const m = partyOf(state)[index];
  if (!m) return [];
  const known = state.dex.find((d) => sameAs(m, d))?.moves ?? [];
  const bag = Object.entries(state.tms)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([id]) => Number(id));
  const out = new Map<number, Assignable>();
  for (const moveId of bag) {
    if (m.moves.includes(moveId) || !canLearn(m.speciesId, moveId)) continue;
    out.set(moveId, { moveId, from: 'bag' });
  }
  // Second, so a move that is both known and held is recorded as free.
  for (const moveId of known) {
    if (m.moves.includes(moveId) || !canLearn(m.speciesId, moveId)) continue;
    out.set(moveId, { moveId, from: 'dex' });
  }
  return [...out.values()].sort(
    (a, b) => (a.from === b.from ? a.moveId - b.moveId : a.from === 'dex' ? -1 : 1),
  );
}

/** Put a dex entry into a slot, or into the first free one when `index` is null. */
export function setMember(state: GameState, index: number | null, d: DexEntry): ShopResult {
  const party = [...partyOf(state)];
  const name = speciesName(d.speciesId);
  if (!state.dex.some((x) => x.speciesId === d.speciesId && x.shiny === d.shiny)) {
    return { state, ok: false, message: `${name}${josa(name, '은', '는')} 도감에 없습니다.` };
  }
  if (party.some((m) => sameAs(m, d))) {
    return { state, ok: false, message: `${name}${josa(name, '은', '는')} 이미 파티에 있습니다.` };
  }
  const at = index ?? party.findIndex((_, i) => party[i] === undefined);
  const slot = at >= 0 && at < PARTY_SIZE ? at : party.length;
  if (slot >= PARTY_SIZE) {
    return { state, ok: false, message: `파티는 ${PARTY_SIZE}마리까지입니다.` };
  }
  party[slot] = { speciesId: d.speciesId, shiny: d.shiny, ...(d.formId !== undefined ? { formId: d.formId } : {}), moves: [] };
  return {
    state: { ...state, party: party.filter(Boolean) },
    ok: true,
    message: `${name}${josa(name, '을', '를')} 파티에 넣었습니다.`,
  };
}

/**
 * Take a member out.
 *
 * The machines it was armed with are NOT returned. They were spent the moment
 * they were assigned, exactly as teaching the companion spends one — and a
 * party that could be built and dismantled to launder TMs back would undo the
 * only thing that makes 24 slots a decision.
 */
export function clearMember(state: GameState, index: number): ShopResult {
  const party = partyOf(state);
  const m = party[index];
  if (!m) return { state, ok: false, message: '빈 자리입니다.' };
  const name = speciesName(m.speciesId);
  return {
    state: { ...state, party: party.filter((_, i) => i !== index) },
    ok: true,
    message: `${name}${josa(name, '을', '를')} 파티에서 뺐습니다.`,
  };
}

/**
 * Arm one member with one move.
 *
 * `slot` picks which move to overwrite and is required once all four are full
 * — the same contract `teach` has, and the panel asks the same question.
 */
export function assign(
  state: GameState,
  index: number,
  moveId: number,
  slot: number | null,
): ShopResult {
  const party = [...partyOf(state)];
  const m = party[index];
  if (!m) return { state, ok: false, message: '빈 자리입니다.' };

  const move = moveById(moveId);
  if (!move) return { state, ok: false, message: '없는 기술입니다.' };
  const who = speciesName(m.speciesId);
  if (!canLearn(m.speciesId, moveId)) {
    return { state, ok: false, message: `${who}${josa(who, '은', '는')} ${move.ko}${josa(move.ko, '을', '를')} 배울 수 없습니다.` };
  }
  if (m.moves.includes(moveId)) {
    return { state, ok: false, message: `이미 ${move.ko}${josa(move.ko, '을', '를')} 배웠습니다.` };
  }

  const free = (state.dex.find((d) => sameAs(m, d))?.moves ?? []).includes(moveId);
  const held = state.tms[moveId] ?? 0;
  if (!free && held < 1) {
    return { state, ok: false, message: '그 기술머신이 없습니다.' };
  }

  const moves = [...m.moves];
  if (moves.length < MOVE_SLOTS) {
    moves.push(moveId);
  } else {
    if (slot == null || !Number.isInteger(slot) || slot < 0 || slot >= MOVE_SLOTS) {
      return { state, ok: false, message: `기술이 ${MOVE_SLOTS}개라 하나를 잊어야 합니다.` };
    }
    moves[slot] = moveId;
  }

  const tms = { ...state.tms };
  if (!free) {
    // Spent, not lent. See the header.
    if (held <= 1) delete tms[moveId];
    else tms[moveId] = held - 1;
  }
  party[index] = { ...m, moves };
  return {
    state: { ...state, party, tms },
    ok: true,
    message:
      `${who}${josa(who, '이', '가')} ${move.ko}${josa(move.ko, '을', '를')} 배웠습니다.` +
      (free ? '' : ' 기술머신은 가방에서 사라졌습니다.'),
  };
}

/** Is the party ready to walk into 석영고원? */
export function partyReady(state: GameState): boolean {
  return partyOf(state).length === PARTY_SIZE;
}

/**
 * The three party actions, dispatched from one string id.
 *
 * Both surfaces send `{ action, id, slot }` and nothing else — the envelope is
 * spelled out in four files (plugin.ts, electron/main.ts, preload.ts, api.ts)
 * and widening it for this would be four edits to carry one number. So the
 * ids that need two numbers carry them separated by a colon, parsed here so
 * the two surfaces stay one line each and cannot drift apart.
 *
 *   partyset    "<speciesId>:<0|1 shiny>"   slot = target seat, or null to append
 *   partyclear  "<seat>"
 *   partyassign "<seat>:<moveId>"           slot = which move to overwrite
 *
 * Returns null for an action this file does not own, so the caller can fall
 * through to the rest of its chain.
 */
export function partyAction(
  state: GameState,
  action: string,
  id: string,
  slot: number | null,
): ShopResult | null {
  const [a, b] = id.split(':').map(Number);
  if (action === 'partyset') {
    const d = state.dex.find((x) => x.speciesId === a && x.shiny === (b === 1));
    if (!d) return { state, ok: false, message: '도감에 없는 포켓몬입니다.' };
    return setMember(state, slot, d);
  }
  if (action === 'partyclear') return clearMember(state, a);
  if (action === 'partyassign') return assign(state, a, b, slot);
  return null;
}
