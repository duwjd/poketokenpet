import { describe, expect, it } from 'vitest';
import {
  battleFormOf,
  displayIdOf,
  formChances,
  fusionsAvailable,
  initialState,
  setShowBattleForm,
  speciesIdOf,
  type Companion,
  type DexEntry,
  type GameState,
} from '../server/game.ts';
import { retireInto } from '../server/dex.ts';
import { PRODUCTS, buy, consumeItem } from '../server/shop.ts';

const KYUREM = 646;
const ZEKROM = 644;
const RESHIRAM = 643;
const BLACK = 10022;
const WHITE = 10023;
/** Charizard: two megas and a gigantamax, so it exercises every branch. */
const CHARIZARD = 6;
const MEGA_X = 10034;
const GMAX_ZARD = 10196;

const mon = (over: Partial<Companion> = {}): Companion => ({
  pathIds: [KYUREM],
  stageIndex: 0,
  isShiny: false,
  rarity: 'legendary',
  nature: 'hardy',
  bornAt: 0,
  tokensAtStageStart: 0,
  moves: [],
  ...over,
});

const seen = (speciesId: number): DexEntry => ({ speciesId, shiny: false, firstSeenAt: 0 });

const base = (over: Partial<GameState> = {}): GameState => ({
  ...initialState(),
  active: mon(),
  ...over,
});

describe('displayIdOf / speciesIdOf', () => {
  it('agree until the companion is fused', () => {
    const a = mon({ pathIds: [4, 5, 6], stageIndex: 2, rarity: 'rare' });
    expect(speciesIdOf(a)).toBe(6);
    expect(displayIdOf(a)).toBe(6);
  });

  it('part ways once it is, and only for what is drawn', () => {
    const a = mon({ formId: BLACK });
    // The dex, the rarity ladder and the learnset all key on this one.
    expect(speciesIdOf(a)).toBe(KYUREM);
    // The sprite, the name and the types follow this one.
    expect(displayIdOf(a)).toBe(BLACK);
  });
});

describe('fusionsAvailable', () => {
  it('offers nothing while the partner has never been raised', () => {
    expect(fusionsAvailable(base({ dex: [] }))).toEqual([]);
  });

  it('offers the one whose partner is in the dex', () => {
    const got = fusionsAvailable(base({ dex: [seen(ZEKROM)] }));
    expect(got.map((f) => f.id)).toEqual([BLACK]);
  });

  it('offers both when both have been raised', () => {
    const got = fusionsAvailable(base({ dex: [seen(ZEKROM), seen(RESHIRAM)] }));
    expect(got.map((f) => f.id)).toEqual([BLACK, WHITE]);
  });

  it('does not care whether the partner was shiny', () => {
    // The dex keys on (species, shiny). Demanding a shiny Zekrom would put the
    // fusion out of reach roughly forever.
    const got = fusionsAvailable(
      base({ dex: [{ speciesId: ZEKROM, shiny: true, firstSeenAt: 0 }] }),
    );
    expect(got.map((f) => f.id)).toEqual([BLACK]);
  });

  it('offers nothing to an already-fused companion', () => {
    const s = base({ active: mon({ formId: BLACK }), dex: [seen(ZEKROM), seen(RESHIRAM)] });
    expect(fusionsAvailable(s)).toEqual([]);
  });
});

describe('battleFormOf', () => {
  const zard = (over: Partial<GameState> = {}) =>
    base({ active: mon({ pathIds: [4, 5, CHARIZARD], stageIndex: 2, rarity: 'rare' }), ...over });

  it('is nothing without the key stone', () => {
    expect(battleFormOf(zard({ stones: { [MEGA_X]: 1 } }))).toBeNull();
  });

  it('is nothing with the key stone but no stone for this species', () => {
    expect(battleFormOf(zard({ inventory: { 'key-stone': 1 } }))).toBeNull();
  });

  /** Holding it is the whole condition — there is no wearing step. */
  it('needs both items held, and nothing else', () => {
    const s = zard({ inventory: { 'key-stone': 1 }, stones: { [MEGA_X]: 1 } });
    expect(battleFormOf(s)?.id).toBe(MEGA_X);
  });

  /**
   * Mega beats gigantamax, which is the opposite of what it was.
   *
   * With both items passive there is no band to take off, so the loser of this
   * comparison is unreachable forever — and four species can do both. The mega
   * wins because it had to be earned: the band is one purchase, the stone had
   * to turn up in the grass under that very species.
   */
  it('prefers the mega once its stone is found', () => {
    const both = { 'key-stone': 1, 'dynamax-band': 1 };
    // No stone yet, so the gigantamax is what happens.
    expect(battleFormOf(zard({ inventory: both }))?.id).toBe(GMAX_ZARD);
    // Stone in hand, so the earned shape takes over.
    expect(battleFormOf(zard({ inventory: both, stones: { [MEGA_X]: 1 } }))?.id).toBe(MEGA_X);
  });

  it('is nothing at all while an everstone is on', () => {
    // "Hold this shape" has to outrank both, or the item lies.
    const s = zard({ inventory: { 'key-stone': 1 }, stones: { [MEGA_X]: 1 }, everstone: true });
    expect(battleFormOf(s)).toBeNull();
  });

  it('offers Ultra Burst only to a fused Necrozma', () => {
    const key = { 'key-stone': 1 };
    const plain = base({ active: mon({ pathIds: [800] }), inventory: key });
    expect(battleFormOf(plain)).toBeNull();
    const fused = base({ active: mon({ pathIds: [800], formId: 10155 }), inventory: key });
    // No stone held, and none needed — see NO_ITEM in scripts/gen-forms.ts.
    expect(battleFormOf(fused)?.id).toBe(10157);
  });

  it('is deterministic when a species has two megas', () => {
    const s = zard({ inventory: { 'key-stone': 1 }, stones: { 10034: 1, 10035: 1 } });
    expect(battleFormOf(s)?.id).toBe(battleFormOf(s)?.id);
    expect(battleFormOf(s)?.id).toBe(10034);
  });
});

describe('formChances', () => {
  const zard = (over: Partial<GameState> = {}) =>
    base({ active: mon({ pathIds: [4, 5, CHARIZARD], stageIndex: 2, rarity: 'rare' }), ...over });

  /**
   * The panel used to show a row only once every condition was met, so the one
   * moment it had something useful to say was the one moment it said nothing.
   */
  it('names what is missing, not just what is ready', () => {
    const bare = formChances(zard());
    const mega = bare.find((c) => c.form.id === MEGA_X)!;
    expect(mega.item).toBe(false);
    expect(mega.stone).toEqual({ ko: '리자몽나이트X', have: false });
    expect(mega.ready).toBe(false);
  });

  it('reports a held stone and a held item separately', () => {
    const [c] = formChances(zard({ stones: { [MEGA_X]: 1 } })).filter((x) => x.form.id === MEGA_X);
    expect(c.stone?.have).toBe(true);
    expect(c.item).toBe(false); // no key stone yet
    expect(c.ready).toBe(false);
  });

  it('is not ready while an everstone is on', () => {
    const s = zard({ inventory: { 'key-stone': 1 }, stones: { [MEGA_X]: 1 }, everstone: true });
    expect(formChances(s).find((c) => c.form.id === MEGA_X)?.ready).toBe(false);
  });

  it('says nothing for a species with no form at all', () => {
    expect(formChances(base({ active: mon({ pathIds: [19], rarity: 'common' }) }))).toEqual([]);
  });

  it('leaves fusions out — they are not battle forms', () => {
    const s = base({ active: mon({ pathIds: [646] }), dex: [seen(644)] });
    expect(formChances(s)).toEqual([]);
  });
});

describe('the DNA splicers', () => {
  const held = (over: Partial<GameState> = {}) =>
    base({ inventory: { 'dna-splicers': 1 }, ...over });

  it('says which partner is missing rather than just refusing', () => {
    const out = consumeItem(held({ dex: [] }), 'dna-splicers', 0);
    expect(out.ok).toBe(false);
    expect(out.message).toContain('제크로무');
    expect(out.message).toContain('레시라무');
  });

  it('refuses a species that cannot fuse at all', () => {
    const s = held({ active: mon({ pathIds: [25], rarity: 'common' }) });
    expect(consumeItem(s, 'dna-splicers', 0).message).toBe('이 포켓몬은 합체할 수 없습니다.');
  });

  it('fuses into the chosen form and spends the item', () => {
    const s = held({ dex: [seen(ZEKROM), seen(RESHIRAM)] });
    const out = consumeItem(s, 'dna-splicers', 0, WHITE);
    expect(out.ok).toBe(true);
    expect(out.state.active!.formId).toBe(WHITE);
    expect(out.state.inventory['dna-splicers']).toBe(0);
  });

  it('leaves the partner in the dex', () => {
    // The dex is a record of what was raised. Charging an item against history
    // would break the one promise it makes.
    const s = held({ dex: [seen(ZEKROM)] });
    const out = consumeItem(s, 'dna-splicers', 0);
    expect(out.state.dex.map((d) => d.speciesId)).toEqual([ZEKROM]);
  });

  it('splits for free', () => {
    const s = base({ active: mon({ formId: BLACK }), inventory: {} });
    const out = consumeItem(s, 'dna-splicers', 0);
    expect(out.ok).toBe(true);
    expect(out.state.active!.formId).toBeUndefined();
  });
});

describe('the passive items', () => {
  for (const [id, name] of [
    ['key-stone', '키스톤'],
    ['dynamax-band', '다이맥스밴드'],
  ] as const) {
    it(`${name} cannot be used from the bag`, () => {
      // There is nothing to press: holding it IS the effect. Refusing out loud
      // beats a button that silently changes no state, which is what this was.
      const out = consumeItem(base({ inventory: { [id]: 1 } }), id, 0);
      expect(out.ok).toBe(false);
      expect(out.message).toContain('가지고 있는 것만으로');
      expect(out.state).toEqual(base({ inventory: { [id]: 1 } }));
    });

    it(`${name} is not for sale at any price`, () => {
      // It used to be a shop row. It is an achievement reward now, and the
      // refusal must not read as "you are short" — someone with every token in
      // the world still cannot buy one.
      const rich = base();
      const out = buy(rich, id, 1e12);
      expect(out.ok).toBe(false);
      expect(out.message).toContain('파는 물건이 아닙니다');
      expect(out.state.spentTokens).toBe(rich.spentTokens);
      expect(out.state.inventory[id]).toBeUndefined();
    });

    it(`${name} still names itself in the bag`, () => {
      // The row stays in PRODUCTS precisely so this keeps working: the bag
      // resolves names, descriptions and icons out of that table, and dropping
      // the row would leave a nameless square for anyone who owns one.
      const row = PRODUCTS.find((p) => p.id === id);
      expect(row?.name).toBe(name);
      expect(row?.desc).toBeTruthy();
      expect(row?.award).toBe(true);
    });
  }

  it('does not let the display switch touch any rule', () => {
    const on = setShowBattleForm(base(), true);
    expect(on.state.showBattleForm).toBe(true);
    const { showBattleForm: _a, ...restOn } = on.state;
    const { showBattleForm: _b, ...restBase } = base();
    void _a;
    void _b;
    expect(restOn).toEqual(restBase);
  });
});

describe('retiring a fused companion', () => {
  it('files it under the base species, with the form as decoration', () => {
    const out = retireInto([], mon({ formId: BLACK, nickname: '검둥이' }), 0);
    expect(out).toEqual([
      { speciesId: KYUREM, shiny: false, firstSeenAt: 0, nickname: '검둥이', formId: BLACK },
    ]);
  });

  it('leaves an unfused entry exactly as it was', () => {
    const out = retireInto([], mon(), 0);
    expect(out[0].formId).toBeUndefined();
  });
});
