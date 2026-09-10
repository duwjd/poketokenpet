import { describe, expect, it } from 'vitest';
import { LEG_LENGTH, STOPS, journeyFor } from '../src/journey.ts';
import { TERRAIN_ORDER } from '../src/terrain.ts';

describe('journeyFor', () => {
  it('opens where the games open', () => {
    expect(journeyFor(0).ko).toBe('태초마을');
    expect(journeyFor(0).region).toBe('관동');
  });

  it('walks the Kanto story line first, then the rest of the region', () => {
    // PokeAPI stores Gen 1 alphabetically, so leaning on its ids would open the
    // journey in Celadon. The generator writes the line down instead — Pallet
    // out to the Plateau — and appends everything else Kanto has after it. So
    // the Plateau is the END OF THE LINE, not the end of the region: the Sevii
    // Islands come after it, which is where the games put them too.
    const kanto = STOPS.filter((s) => s.region === '관동').map((s) => s.ko);
    expect(kanto.slice(0, 5)).toEqual(['태초마을', '상록시티', '상록숲', '회색시티', '달맞이산']);
    expect(kanto.indexOf('석영고원')).toBe(19);
    expect(kanto.length).toBeGreaterThan(20);
  });

  it('stays put for a whole leg, then moves on', () => {
    expect(journeyFor(LEG_LENGTH - 1)).toEqual(STOPS[0]);
    expect(journeyFor(LEG_LENGTH)).toEqual(STOPS[1]);
  });

  it('loops rather than ending, so a long-lived pet keeps travelling', () => {
    const lap = LEG_LENGTH * STOPS.length;
    expect(journeyFor(lap)).toEqual(STOPS[0]);
    expect(journeyFor(lap * 13 + LEG_LENGTH * 2)).toEqual(STOPS[2]);
  });

  it('never indexes off the end, whatever the payload hands it', () => {
    for (const n of [-1, -1000, Number.NaN, Number.POSITIVE_INFINITY, 0.5, 1e12]) {
      expect(STOPS, String(n)).toContain(journeyFor(n));
    }
    expect(journeyFor(Number.NaN)).toEqual(STOPS[0]);
  });

  it('never prints an English slug', () => {
    // The whole reason unverified places are dropped: `celadon-city` on a
    // Korean caption is worse than a shorter journey.
    //
    // "Contains no Latin letter" was too strong once the route reached Unova:
    // N's Castle is N의 성 and P2 Laboratory is P2연구소 in the Korean games,
    // and both are correct. So the rule is stated as what it actually means —
    // every caption is Korean, and no three Latin letters run together, which
    // is what a leaked slug looks like.
    for (const s of STOPS) {
      expect(s.ko, s.ko).toMatch(/[가-힣]/);
      expect(s.ko, s.ko).not.toMatch(/[a-z]{3}/i);
      expect(s.region, s.region).not.toMatch(/[a-z]/i);
    }
  });

  it('gives every stop a sheet that exists', () => {
    // A terrain with no sheet renders an empty band rather than failing loudly.
    for (const s of STOPS) expect(TERRAIN_ORDER, s.ko).toContain(s.terrain);
  });

  it('never names a place the player cannot be', () => {
    // Hoenn ships a location whose Korean name is literally "???" — the games'
    // out-of-bounds mystery zone. It has a real localised name, so the
    // not-a-place filter never caught it, and the caption read "???를 지나는 중".
    for (const s of STOPS) expect(s.ko, s.ko).not.toMatch(/^\?+$/);
  });

  it('never says the same place twice in a row', () => {
    // Alola splits one place into sub-areas that share a Korean name, so
    // 하우올리시티 arrived three times and 텐캐럿힐 twice. Two hours of the same
    // caption, a move, and the same caption again reads as a stuck app.
    const seen = new Set<string>();
    for (const s of STOPS) {
      const key = `${s.region}/${s.ko}`;
      expect(seen, key).not.toContain(key);
      seen.add(key);
    }
  });

  it('gives the places with no sheet a backdrop instead', () => {
    // The whole reason `sky` is classified separately from `terrain`. There is
    // no CC0 desert or snow tileset, so 하이나사막 walks on plain field and
    // 얼음길 on cobble — but neither should LOOK like an ordinary meadow.
    const by = (ko: string) => STOPS.find((s) => s.ko === ko);
    expect(by('하이나사막')?.sky).toBe('desert');
    expect(by('얼음샛길')?.sky).toBe('icecave');
    // And the ones that did get a sheet still get the matching horizon.
    expect(by('디그다의 굴')?.terrain).toBe('cave');
    expect(by('디그다의 굴')?.sky).toBe('dampcave');
  });

  it('visits the regions in the order they were released', () => {
    const seen: string[] = [];
    for (const s of STOPS) if (seen.at(-1) !== s.region) seen.push(s.region);
    // Each region is one contiguous run — the journey never doubles back.
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen[0]).toBe('관동');
    expect(seen[1]).toBe('성도');
  });

  it('is long enough to be a journey rather than a lap', () => {
    // 25 encounters a stop, 12 an hour: this should be weeks, not an evening.
    const days = (STOPS.length * LEG_LENGTH) / 12 / 24;
    expect(days).toBeGreaterThan(7);
  });
});
