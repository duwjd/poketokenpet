import { describe, expect, it } from 'vitest';
import { FORMS, formById, formsFrom } from '../server/forms.ts';
import { lineOf } from '../server/dex.ts';
import { NAMES } from '../server/species.ts';
import { TYPES } from '../server/moves.ts';

const MAX_SPECIES = 1025;
const megas = FORMS.filter((f) => f.kind === 'mega');
const gmax = FORMS.filter((f) => f.kind === 'gmax');
const fusions = FORMS.filter((f) => f.kind === 'fusion');

describe('the generated form table', () => {
  /**
   * Counts, so an upstream change is loud rather than silent.
   *
   * PokeAPI adds forms; when it does, this fails and the number is updated on
   * purpose. Without it a regenerate could quietly halve the table.
   */
  it('covers every mega, gigantamax and fusion', () => {
    expect(megas.length).toBe(100); // 97 mega + 2 primal + ultra burst
    expect(gmax.length).toBe(34);
    expect(fusions.length).toBe(6);
  });

  it('gives every form a Korean name, official or composed', () => {
    // The whole point of the composition rules in gen-forms.ts. A slug leaking
    // onto a Korean screen is the bug they exist to prevent.
    const leaked = FORMS.filter((f) => !f.ko || /[a-z]/.test(f.ko));
    expect(leaked.map((f) => `${f.id} ${f.ko}`)).toEqual([]);
  });

  it('never gives two forms the same Korean name', () => {
    // Charizard has two megas and Tatsugiri three; a name that does not tell
    // them apart makes the bag unusable.
    expect(new Set(FORMS.map((f) => f.ko)).size).toBe(FORMS.length);
  });

  it('names every gigantamax the way the games do', () => {
    for (const f of gmax) expect(f.ko.startsWith('거다이맥스 ')).toBe(true);
  });

  it('names every mega stone consistently', () => {
    // Every localised stone upstream ends in 나이트, so every composed one must
    // too. The orbs and Ultra Burst are the documented exceptions.
    const named = megas.filter((f) => f.stone).map((f) => f.stone!.ko);
    const odd = named.filter((ko) => !/나이트/.test(ko) && !/구슬$/.test(ko));
    expect(odd).toEqual([]);
  });

  /**
   * The slug is what `ensureSprite` hands to Pokemon Showdown when PokeAPI has
   * no animated art, so two forms sharing one would quietly fetch each other's
   * picture. Three Tatsugiri megas and both Toxtricity gigantamaxes really did
   * collide until the variety qualifier was folded in.
   */
  it('gives every form its own Showdown slug', () => {
    for (const f of FORMS) expect(f.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(new Set(FORMS.map((f) => f.slug)).size).toBe(FORMS.length);
  });

  it('builds the slug out of the base species, not the Korean name', () => {
    // The rule Showdown actually uses, checked against the live host: English
    // species name with everything but letters and digits removed, then the
    // form. PokeAPI's own spelling (`charizard-mega-x`) is not it.
    const slug = (id: number) => FORMS.find((f) => f.id === id)?.slug;
    expect(slug(10287)).toBe('excadrill-mega');
    expect(slug(10034)).toBe('charizard-megax');
    // The DEFAULT variety's token is one Showdown never writes down.
    expect(slug(10219)).toBe('toxtricity-gmax');
    expect(slug(10228)).toBe('toxtricity-lowkey-gmax');
  });

  it('keeps every base inside the dex', () => {
    for (const f of FORMS) {
      expect(f.base).toBeGreaterThanOrEqual(1);
      expect(f.base).toBeLessThanOrEqual(MAX_SPECIES);
      expect(NAMES[f.base]).toBeTruthy();
    }
  });

  it('only ever comes from a real display id', () => {
    const formIds = new Set(FORMS.map((f) => f.id));
    for (const f of FORMS) {
      expect(f.from.length).toBeGreaterThan(0);
      for (const src of f.from) {
        expect(src <= MAX_SPECIES ? !!NAMES[src] : formIds.has(src)).toBe(true);
      }
    }
  });

  it('carries real types', () => {
    for (const f of FORMS) {
      expect(f.types.length).toBeGreaterThan(0);
      for (const t of f.types) expect(TYPES).toContain(t);
    }
  });

  /**
   * The measurement the battle boost rests on.
   *
   * Every mega is a flat +100 base stats; every gigantamax is +0, because
   * Gigantamax changes no stat in the games. If a regenerate ever moved these,
   * `formOpts` would be handing out an invented number instead of a measured one.
   */
  it('boosts a mega and never a gigantamax', () => {
    for (const f of megas) expect(f.power).toBeGreaterThan(1);
    for (const f of gmax) expect(f.power).toBe(1);
  });
});

describe('fusions', () => {
  it('names a partner that is a real species', () => {
    for (const f of fusions) {
      expect(f.partner).toBeDefined();
      expect(NAMES[f.partner!]).toBeTruthy();
    }
  });

  /**
   * Why `advance` does not have to clear `formId` on evolution.
   *
   * A fused companion that then evolved would keep a stale form. Rather than
   * defend against it at runtime, the table is kept in a shape where it cannot
   * happen: every fusable species is a one-stage legendary, so the evolve
   * branch is unreachable for all six. Add a fusion whose base evolves and this
   * fails — which is the moment to write that runtime code, not before.
   */
  it('only fuses species that never evolve', () => {
    for (const f of fusions) {
      const line = lineOf(f.base);
      expect(line).toBeTruthy();
      for (const path of line!.paths) expect(path.length).toBe(1);
    }
  });

  it('puts a bare form label back under its species', () => {
    // 황혼의 갈기 on its own reads as a different Pokemon.
    expect(formById(10155)?.ko).toBe('네크로즈마(황혼의 갈기)');
    expect(formById(10022)?.ko).toBe('블랙큐레무'); // already a whole name
  });
});

describe('Ultra Burst', () => {
  /**
   * The two-step, which is the one rule in here that is not a straight lookup:
   * fuse first (permanent), then burst in battle (temporary).
   */
  it('is reachable only from an already-fused Necrozma', () => {
    expect(formById(10157)?.from).toEqual([10155, 10156]);
    expect(formsFrom(800).map((f) => f.id)).toEqual([10155, 10156]);
    expect(formsFrom(10155).map((f) => f.id)).toEqual([10157]);
  });

  /**
   * It has no stone, and cannot have one: stones drop from the wild Pokemon
   * that use them, and a fused Necrozma never appears in the grass.
   */
  it('needs no stone', () => {
    expect(formById(10157)?.stone).toBeUndefined();
  });
});
