import type { Dispatch, SetStateAction } from 'react';
import type { DexIndexEntry, PetActionKind } from '../../api.ts';
import { DexSprite } from '../DexSprite.tsx';
import { RARITY_LABEL, TYPE_FILTERS, compact, dexKey } from '../labels.ts';
import type { DexCard, State } from '../types.ts';

type DexTabProps = {
  state: State;
  busy: boolean;
  dexView: 'dex' | 'legends' | 'party';
  setDexView: Dispatch<SetStateAction<'dex' | 'legends' | 'party'>>;
  showFilters: boolean;
  setShowFilters: Dispatch<SetStateAction<boolean>>;
  fRarity: string | null;
  setFRarity: Dispatch<SetStateAction<string | null>>;
  fGen: number | null;
  setFGen: Dispatch<SetStateAction<number | null>>;
  fType: string | null;
  setFType: Dispatch<SetStateAction<string | null>>;
  showUnseen: boolean;
  setShowUnseen: Dispatch<SetStateAction<boolean>>;
  dexIndex: DexIndexEntry[] | null;
  partySeat: number | null;
  setPartySeat: Dispatch<SetStateAction<number | null>>;
  openDex: (d: DexCard) => void;
  act: (action: PetActionKind, id: string, slot?: number | null) => Promise<void>;
};

/** 도감 with no entry open: the grid, the legendary conditions and the party. */
export function DexTab({
  state,
  busy,
  dexView,
  setDexView,
  showFilters,
  setShowFilters,
  fRarity,
  setFRarity,
  fGen,
  setFGen,
  fType,
  setFType,
  showUnseen,
  setShowUnseen,
  dexIndex,
  partySeat,
  setPartySeat,
  openDex,
  act,
}: DexTabProps) {
  const activeFilters = [fRarity, fGen, fType].filter((v) => v !== null).length;
  const matches = (e: { rarity: string; generation: number; types: { id: string }[] }) =>
    (fRarity === null || e.rarity === fRarity) &&
    (fGen === null || e.generation === fGen) &&
    (fType === null || e.types.some((t) => t.id === fType));

  /**
   * What the grid renders.
   *
   * Collected entries carry their own art; unseen slots are pulled from the
   * index and show a placeholder, so switching the toggle on downloads nothing.
   */
  /**
   * Party membership, by the key the dex itself uses.
   *
   * (species, shiny) — the same pair `record` in server/dex.ts keys on, so a
   * shiny and a plain 리자몽 are two entries here exactly as they are there.
   */
  const partyIndexOf = (d: { speciesId: number; shiny: boolean }) =>
    state?.party.members.findIndex((m) => m.speciesId === d.speciesId && m.shiny === d.shiny) ?? -1;
  const inParty = (d: { speciesId: number; shiny: boolean }) => partyIndexOf(d) >= 0;

  const dexCards = ((): DexCard[] => {
    const seen: DexCard[] = state.dex.filter(matches).map((d) => ({ ...d, seen: true }));
    const have = new Set(state.dex.map((d) => d.speciesId));
    /**
     * Every legendary still behind a gate, shown whether or not 미수집 포함 is on.
     *
     * A slot you cannot see is not a goal, and turning them into goals is the
     * whole point — so these do not wait for a toggle the way the other 1000
     * empty slots do. They carry their gate with them so the entry screen has
     * something to say without another request.
     */
    const locked: DexCard[] = state.legends.gates
      .filter((g) => !have.has(g.speciesId))
      .map((g) => ({
        speciesId: g.speciesId,
        name: g.ko,
        shiny: false,
        sprite: null,
        rarity: 'legendary',
        generation: g.gen,
        types: [],
        seen: false,
        locked: g,
      }))
      .filter(matches);

    if (!showUnseen || !dexIndex) {
      /**
       * Collected first, locked after — NOT interleaved by number.
       *
       * Sorting all of them together buries the dex: nine caught species
       * against ninety-four `?` cards puts the first real one below the fold
       * (#425 lands on row six), so the screen that is supposed to show what
       * you have shows mostly what you don't. With 미수집 포함 on the whole
       * 1025 are in numeric order anyway and a legendary belongs in its slot,
       * so that branch is left alone.
       */
      return [
        ...seen.sort((a, b) => a.speciesId - b.speciesId),
        ...locked.sort((a, b) => a.speciesId - b.speciesId),
      ];
    }
    const shown = new Set([...have, ...locked.map((l) => l.speciesId)]);
    const missing: DexCard[] = dexIndex
      .filter((e) => !shown.has(e.speciesId) && matches(e))
      .map((e) => ({ ...e, shiny: false, sprite: null, seen: false }));
    return [...seen, ...locked, ...missing].sort((a, b) => a.speciesId - b.speciesId);
  })();

  /** Generations present in the gate table, in order. */
  const legendGens = [...new Set(state.legends.gates.map((g) => g.gen))].sort((a, b) => a - b);
  const legendsOpen = state.legends.gates.filter((g) => g.open).length;
  const legendsDone = state.legends.gates.filter((g) => g.done).length;
  const legendPct = state.legends.gates.length
    ? Math.max(legendsOpen ? 1 : 0, (legendsOpen / state.legends.gates.length) * 100)
    : 0;

  return (
    <>
    <div className="dexbar">
      <h2>도감</h2>
      {dexView === 'dex' && (
        <button className="px-btn px-btn--link" onClick={() => setShowFilters(!showFilters)}>
          {showFilters ? '필터 닫기' : '필터'}
          {activeFilters > 0 && ` (${activeFilters})`}
        </button>
      )}
    </div>
    {/* The bag's pocket chips, borrowed: two views of one collection. It was
        an underlined link in the corner next to 필터, which read as a second
        filter rather than as a second board — and went unfound.

        Named 전설 목록 rather than 전설 because the rarity filter below
        already has a chip called 전설, and two buttons of the same name in
        one screen is a coin toss for anything looking one up. */}
    <div className="px-chips chips shopchips" role="group" aria-label="도감 화면">
      <button className="px-chip px-chip--sm" aria-pressed={dexView === 'dex'} onClick={() => setDexView('dex')}>
        도감
      </button>
      <button className="px-chip px-chip--sm" aria-pressed={dexView === 'legends'} onClick={() => setDexView('legends')}>
        전설 목록
      </button>
      <button className="px-chip px-chip--sm" aria-pressed={dexView === 'party'} onClick={() => setDexView('party')}>
        파티 {state.party.members.length} / {state.party.size}
      </button>
    </div>

    {dexView === 'party' && (
    <>
    {/* The party board.

        Six seats above the grid, so picking and reviewing are one screen.
        The seats are `.items` rows rather than `.dex` cards because each one
        carries four move names, and four lines do not fit in a 95px cell. */}
    <p className="sub">
      <b>{state.party.members.length}</b>
      <span className="muted">마리 / {state.party.size}마리</span>
      {state.badges.league.wins > 0 && (
        <span className="muted"> · {state.badges.league.wins}회 제패</span>
      )}
    </p>
    <p className="muted sub note">
      {state.badges.count < state.badges.total
        ? `배지 ${state.badges.total}개를 모으면 ${state.badges.league.cityKo}에서 사천왕에게 도전합니다. 지금 ${state.badges.count}개.`
        : state.party.ready
          ? `${state.badges.league.cityKo}에 도착하면 도전이 시작됩니다.`
          : `${state.party.size}마리를 채워야 도전할 수 있습니다. 아래 도감에서 고르세요.`}
    </p>
    <ul className="items partyseats">
      {Array.from({ length: state.party.size }, (_, i) => {
        const m = state.party.members[i];
        if (!m) {
          return (
            <li key={`empty-${i}`} className="empty">
              <span className="icon">➕</span>
              <span className="lbl">
                <span>비었음</span>
                <em>아래 도감에서 고르세요.</em>
              </span>
            </li>
          );
        }
        return (
          <li key={`${m.speciesId}-${m.shiny}`}>
            <span className="icon">
              {m.sprite ? <DexSprite name={m.sprite} alt="" /> : '?'}
            </span>
            <span className="lbl">
              <span className="awardtop">
                <span>
                  {m.name}
                  {m.shiny && '✨'}
                </span>
                <em className="num">
                  {m.moves.length} / {state.hunt.slots}
                </em>
              </span>
              <em>
                {m.moves.length ? m.moves.map((x) => x.name).join(' · ') : '기술이 없습니다.'}
              </em>
            </span>
            <button className="px-btn" onClick={() => setPartySeat(partySeat === i ? null : i)}>
              {partySeat === i ? '닫기' : '기술'}
            </button>
            <button className="px-btn" onClick={() => void act('partyclear', String(i))} disabled={busy}>
              빼기
            </button>
          </li>
        );
      })}
    </ul>

    {partySeat !== null && state.party.members[partySeat] && (
      <>
        <h3 className="shelf">
          {state.party.members[partySeat].name} 기술
          <span className="muted"> {state.party.members[partySeat].moves.length} / {state.hunt.slots}</span>
        </h3>
        {/* Already on it. Overwriting one is what the sheet below does, so
            these are shown to be read rather than pressed. */}
        {state.party.members[partySeat].moves.length > 0 && (
          <ul className="items">
            {state.party.members[partySeat].moves.map((mv) => (
              <li key={mv.id} data-type={mv.type}>
                <span className="icon">•</span>
                <span className="lbl">
                  <span>{mv.name}</span>
                  <em>
                    {mv.typeName} · {mv.damageClass === 'status' ? '변화' : `위력 ${mv.power}`}
                  </em>
                </span>
              </li>
            ))}
          </ul>
        )}
        <h3 className="shelf">배울 수 있는 기술</h3>
        <p className="muted sub note">
          도감에 남은 기술은 그냥 배웁니다. 가방의 기술머신은 <b>쓰면 사라집니다</b> —
          파트너에게 가르치는 것과 같습니다.
        </p>
        <ul className="items">
          {(() => {
            const seat = state.party.members[partySeat];
            const bag = seat.canTake
              .map((id) => state.tms.find((t) => t.id === id))
              .filter((t): t is (typeof state.tms)[number] => !!t);
            const rows = [
              ...seat.free.map((mv) => ({ mv, free: true })),
              ...bag.map((t) => ({ mv: t, free: false })),
            ];
            if (!rows.length) {
              return (
                <li className="empty">
                  <span className="icon">🔒</span>
                  <span className="lbl">
                    <span>배울 수 있는 기술이 없습니다</span>
                    <em>이 포켓몬이 배울 수 있는 기술머신을 아직 모으지 못했습니다.</em>
                  </span>
                </li>
              );
            }
            return rows.map(({ mv, free }) => (
              <li key={`${free ? 'f' : 'b'}-${mv.id}`} data-type={mv.type}>
                <span className="icon">{free ? '↩︎' : '💿'}</span>
                <span className="lbl">
                  <span className="awardtop">
                    <span>{mv.name}</span>
                    <em className={free ? 'got' : 'num'}>{free ? '이미 배운 기술' : '기술머신 소비'}</em>
                  </span>
                  <em>
                    {mv.typeName} · {mv.damageClass === 'status' ? '변화' : `위력 ${mv.power}`}
                  </em>
                </span>
                <button className="px-btn"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      'partyassign',
                      `${partySeat}:${mv.id}`,
                      seat.moves.length >= state.hunt.slots ? 0 : null,
                    )
                  }
                >
                  {seat.moves.length >= state.hunt.slots ? '1번과 교체' : '배우기'}
                </button>
              </li>
            ));
          })()}
        </ul>
      </>
    )}
    </>
    )}

    {dexView === 'legends' && (
    <>
    <p className="sub">
      <b>{legendsOpen}</b>
      <span className="muted">종 조우 가능 / {state.legends.gates.length}종</span>
      {legendsDone > 0 && <span className="muted"> · {legendsDone}종 도감 등록</span>}
    </p>
    <div className="px-gauge" role="progressbar" aria-valuenow={legendPct} aria-valuemax={100} style={{ '--v': legendPct } as React.CSSProperties}>
      <i />
    </div>
    <p className="muted sub note">
      조건을 채우면 야생에서 만날 수 있게 됩니다. 이기면 그 포켓몬의 알이 남고, 알을 품어
      키워야 도감에 들어갑니다.
    </p>
    {/* The rooms. Counted here rather than on the journey caption because
        this is the screen about legendaries, and a place you have not opened
        is not somewhere the caption can mention. */}
    <p className="muted sub note">
      전용 공간 <b>{state.hunt.shrines.open}</b> / {state.hunt.shrines.total}곳 —
      시작의 방·창기둥 같은 곳은 그 포켓몬을 만나기 전까지 여정에 나오지 않습니다.
    </p>
    {/* Grouped by generation, the same shelf idiom the shop and the awards
        board use. Ninety-four rows in one column is a wall; nine of ten is a
        list you can find something in. */}
    {legendGens.map((gn) => {
      const rows = state.legends.gates.filter((g) => g.gen === gn);
      if (!rows.length) return null;
      const open = rows.filter((g) => g.open).length;
      return (
      <div key={gn}>
        <h3 className="shelf awardshelf">
          {gn}세대 <span className="muted">{open} / {rows.length}</span>
        </h3>
    <ul className="items awards">
      {rows.map((g) => (
        <li key={g.speciesId} className={g.open ? '' : 'empty'}>
          <span className="icon">
            {g.done ? '📕' : g.open ? '✨' : g.ready ? '🔮' : '🔒'}
          </span>
          <span className="lbl">
            <span className="awardtop">
              <span>
                {g.ko}
                {g.myth && ' ✦'}
              </span>
              <em className={g.open ? 'got' : 'num'}>
                {g.done ? '등록 완료' : g.open ? '조우 가능' : `${compact(Math.min(g.have, g.need))} / ${compact(g.need)}`}
              </em>
            </span>
            <em>
              {g.how}
              {g.itemKo && !g.held ? ` · ${g.itemKo} 필요` : ''}
            </em>
            {!g.open && (
              <span className="px-gauge px-gauge--thin track" aria-hidden="true" style={{ '--v': g.ratio * 100 } as React.CSSProperties}>
                <i />
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
      </div>
      );
    })}
    </>
    )}

    {dexView !== 'legends' && (
    <>
    {/*
      Two counts in two different units, side by side.

      The dex counts SPECIES and the retirement counter counts INDIVIDUALS,
      and they diverge on purpose: a Pyroar that graduates registers Litleo
      alongside it. Without a unit on the numerator, "4" next to "2마리를
      떠나보냈습니다" reads as a counter that stopped incrementing — so the
      numerator carries 종, and the gap says out loud why it exists.
    */}
    <p className="sub">
      <b>{state.dex.length}</b>
      <span className="muted">종 / {state.dexTotal}종</span>
      {state.retiredCount > 0 && (
        <span className="muted"> · {state.retiredCount}마리를 떠나보냈습니다</span>
      )}
      {state.retiredCount > 0 && state.dex.length > state.retiredCount && (
        <span className="muted note">진화 전 단계도 함께 등록되어 종 수가 더 많습니다.</span>
      )}
    </p>
    {/* One entry out of 1025 rounds to 0%, which reads as "nothing yet".
        Floor a non-empty dex at a visible sliver instead. */}
    <div
      className="px-gauge"
      role="progressbar"
      aria-valuenow={state.dex.length}
      aria-valuemax={state.dexTotal}
      style={{ '--v': state.dex.length ? Math.max(1, (state.dex.length / state.dexTotal) * 100) : 0 } as React.CSSProperties}
    >
      <i />
    </div>

    {showFilters && (
      <div className="filters">
        <section>
          <h3>등급</h3>
          <div className="px-chips chips">
            {Object.entries(RARITY_LABEL).map(([id, label]) => (
              <button
                key={id}
                className="px-chip px-chip--sm" aria-pressed={fRarity === id}
                onClick={() => setFRarity(fRarity === id ? null : id)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3>세대</h3>
          <div className="px-chips chips">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => (
              <button
                key={g}
                className="px-chip px-chip--sm" aria-pressed={fGen === g}
                onClick={() => setFGen(fGen === g ? null : g)}
              >
                {g}
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3>타입</h3>
          <div className="px-chips chips">
            {TYPE_FILTERS.map((t) => (
              <button
                key={t.id}
                data-type={t.id}
                className="px-chip px-chip--sm" aria-pressed={fType === t.id}
                onClick={() => setFType(fType === t.id ? null : t.id)}
              >
                {t.name}
              </button>
            ))}
          </div>
        </section>
        <section>
          <div className="px-chips chips">
            <button className="px-chip px-chip--sm" aria-pressed={showUnseen} onClick={() => setShowUnseen(!showUnseen)}>
              미수집 포함
            </button>
            {activeFilters > 0 && (
              <button
                className="px-chip px-chip--sm"
                onClick={() => {
                  setFRarity(null);
                  setFGen(null);
                  setFType(null);
                }}
              >
                초기화
              </button>
            )}
          </div>
        </section>
      </div>
    )}

    {dexCards.length === 0 ? (
      <p className="muted sub">
        {state.dex.length === 0
          ? '최종 단계까지 키우면 도감에 등록되고 새 알이 나옵니다.'
          : '조건에 맞는 포켓몬이 없습니다.'}
      </p>
    ) : (
      <ul className="dex">
        {dexCards.map((d) => {
          const key = dexKey(d);
          /* One face, worn by a button or by a plain span — written once so
             the pressable and the unpressable card cannot drift apart. */
          const face = (
            <>
              <span className="art">
                {/* alt="" now that the card is a button: its accessible name
                    comes from the text right below the picture, and an alt
                    repeating it makes every card announce itself twice. */}
                {d.sprite ? <DexSprite name={d.sprite} alt="" /> : '?'}
              </span>
              <span className="nm">
                {d.seen ? d.name : '???'}
                {d.shiny && '✨'}
              </span>
              <span className="no">#{String(d.speciesId).padStart(3, '0')}</span>
            </>
          );
          return (
            <li
              key={key}
              className={[
                d.seen ? (d.shiny ? 'shinydex' : '') : 'unseen',
                dexView === 'party' && inParty(d) ? 'inparty' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {d.seen || d.locked ? (
                /* No aria-expanded and no aria-haspopup: this navigates to a
                   screen, it does not disclose a region or open a menu. No
                   aria-label either — the visible text IS the name.

                   A locked legendary is pressable too, and it is exactly the
                   exception the note below allows for: its screen is NOT
                   blank — it carries the condition — and it costs no download,
                   because the gate came down with the payload. */
                <button
                  type="button"
                  className="card"
                  data-key={key}
                  aria-label={
                    dexView === 'party'
                      ? `${d.name}${inParty(d) ? ' 파티에서 빼기' : ' 파티에 넣기'}`
                      : d.locked
                        ? `${d.speciesId}번 전설, 획득 조건 보기`
                        : undefined
                  }
                  /* In 파티 mode the same card does a different job: it puts
                     the entry into the party instead of opening its screen.
                     One grid, two verbs — which is why the mode chip sits
                     directly above it rather than on another tab. */
                  onClick={() =>
                    dexView === 'party'
                      ? d.locked
                        ? undefined
                        : inParty(d)
                          ? act('partyclear', String(partyIndexOf(d)))
                          : act('partyset', `${d.speciesId}:${d.shiny ? 1 : 0}`)
                      : openDex(d)
                  }
                >
                  {face}
                </button>
              ) : (
                /* An unseen slot is not pressable, and that is the design
                   rather than an omission: `mine` is empty by definition, and
                   an entry screen for it would either be blank or would spend
                   the download the "미수집 포함" toggle promises not to. */
                <span className="card">{face}</span>
              )}
            </li>
          );
        })}
      </ul>
    )}
    </>
    )}
    </>
  );
}
