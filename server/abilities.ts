import { ABILITY_KO, FORM_ABILITIES, SPECIES_ABILITIES } from './abilitydata.ts';

/**
 * Abilities: who has which, and which of them do nothing here.
 *
 * What each ability DOES lives in server/fight.ts, at the point in a fight
 * where it acts — a switch-in, a stat about to drop, a move about to land.
 * This file is the rest: dealing one out to an individual, naming it, and the
 * written-down list of the abilities that have no effect in this app, each with
 * its reason (`NO_EFFECT`). test/abilities.test.ts holds every ability any
 * species here can have to one side of that line or the other.
 */

/**
 * Which of a species' abilities an individual has: its first or second
 * ordinary one, or its hidden one.
 *
 * A slot rather than a name, as the games store it — a 파이리 with 선파워
 * evolves into a 리자몽 with 선파워 because both have it in the same slot.
 */
export type AbilitySlot = 0 | 1 | 2;

/**
 * How often an individual turns out with its hidden ability: one in twenty.
 * The games make it rarer in the wild and give it away through special
 * encounters; one in twenty keeps it a find without making it unreachable.
 */
export const HIDDEN_ODDS = 1 / 20;

/**
 * A number in [0, 1) from a seed, without touching any RNG stream.
 *
 * The hatch roll and every battle roll are single streams whose draws must not
 * shift — a new draw would re-deal every shiny and nature after it — so the
 * slot is hashed from what already identifies the individual instead.
 */
function hash01(seed: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/**
 * The slot for an individual, from a seed that identifies it: the hidden
 * ability one time in twenty, otherwise one of the ordinary ones evenly.
 */
export function abilitySlotFor(seed: number, speciesId: number): AbilitySlot {
  const r = hash01(Math.imul(seed + 1, 0x27d4eb2d) ^ speciesId);
  const [normal, hidden] = SPECIES_ABILITIES[speciesId] ?? [[], null];
  if (hidden && r < HIDDEN_ODDS) return 2;
  const rest = hidden ? (r - HIDDEN_ODDS) / (1 - HIDDEN_ODDS) : r;
  return normal.length > 1 && rest >= 0.5 ? 1 : 0;
}

/**
 * The ability in a slot, for a species — or for a form, which has its own.
 *
 * A mega has exactly one ability whatever the base had. A slot the species does
 * not have falls back to its first: a 피카츄 with slot 1 is a 피카츄 with 정전기.
 */
export function abilityOf(speciesId: number, slot: AbilitySlot = 0, formId?: number): string | null {
  if (formId !== undefined) {
    const f = FORM_ABILITIES[formId];
    if (f?.length) return f[Math.min(slot === 2 ? f.length - 1 : slot, f.length - 1)];
  }
  const e = SPECIES_ABILITIES[speciesId];
  if (!e) return null;
  const [normal, hidden] = e;
  if (slot === 2 && hidden) return hidden;
  return normal[slot === 1 && normal.length > 1 ? 1 : 0] ?? null;
}

/** An ability's Korean name; the English one, titled, for the three PokeAPI has not named yet. */
export function abilityKo(slug: string): string {
  const ko = ABILITY_KO[slug];
  if (ko) return ko;
  return slug
    .split('-')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/** Every ability any species or form here can have. */
export const ALL_ABILITIES = Object.keys(ABILITY_KO);

/**
 * Abilities that have no effect in this app, and why.
 *
 * Four reasons, each the same one the games would give in the same place:
 * nothing here holds an item or a berry; every fight is one on one, so there is
 * no ally to help and no partner to copy; there is no overworld to walk; and
 * there is no gender. Everything not on this list does what it does in the
 * games — see server/fight.ts.
 */
export const NO_EFFECT: Record<string, string> = {
  // Items and berries.
  pickup: '도구', 'sticky-hold': '도구', gluttony: '나무열매', unburden: '도구', klutz: '도구',
  frisk: '도구', 'honey-gather': '도구', pickpocket: '도구', harvest: '나무열매', 'cheek-pouch': '나무열매',
  magician: '도구', symbiosis: '도구', ripen: '나무열매', 'ball-fetch': '도구', unnerve: '나무열매',
  'cud-chew': '나무열매', multitype: '도구(플레이트)', 'rks-system': '도구(메모리)',
  // Doubles: no ally to help, no partner to copy, nobody to draw moves away.
  plus: '동료', minus: '동료', healer: '동료', 'friend-guard': '동료', telepathy: '동료',
  battery: '동료', 'power-spot': '동료', receiver: '동료', 'power-of-alchemy': '동료', commander: '동료',
  costar: '동료', 'curious-medicine': '동료', hospitality: '동료', 'propeller-tail': '끌어당김',
  stalwart: '끌어당김',
  // Walking about.
  illuminate: '필드',
  // Gender.
  rivalry: '성별',
  // Cosmetic in a one-on-one fight: it changes what the other side sees, not what happens.
  illusion: '겉모습',
};
