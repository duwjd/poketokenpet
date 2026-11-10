import { Fragment, type Dispatch, type SetStateAction } from 'react';
import type { DexDetail } from '../../api.ts';
import { josa } from '../../josa.ts';
import { DexSprite } from '../DexSprite.tsx';
import { FACTOR_LABEL, LEGEND_SOURCE_KO, RARITY_LABEL, compact } from '../labels.ts';
import type { Companion, DexCard } from '../types.ts';

type DexEntryProps = {
  dexOpen: DexCard;
  setDexOpen: Dispatch<SetStateAction<DexCard | null>>;
  dexDetail: DexDetail | null;
  dexErr: string | null;
  setDexErr: Dispatch<SetStateAction<string | null>>;
  closeDex: () => void;
  companion: Companion | null;
};

/** 도감 with a card open: that one entry. See the note where App mounts it. */
export function DexEntry({
  dexOpen,
  setDexOpen,
  dexDetail,
  dexErr,
  setDexErr,
  closeDex,
  companion,
}: DexEntryProps) {
  return (
    <>
    <div className="dexbar">
      {/* autoFocus so Escape is reachable and a screen reader is told the
          screen changed. :focus-visible keeps it quiet for mouse users. */}
      <button className="px-btn px-btn--link" autoFocus onClick={closeDex}>
        ← 목록
      </button>
      <span className="no">#{String(dexOpen.speciesId).padStart(3, '0')}</span>
    </div>

    {/*
      * A locked legendary takes the whole screen over.
      *
      * Nothing below this branch would have anything to say — there is no
      * `mine`, no flavour text, no stats worth showing for something never
      * met — and every number it DOES have came down with the payload, so it
      * costs no fetch. The `← 목록` header above is shared.
      */}
    {dexOpen.locked ? (
    <>
    <div className="portrait">
      {/* `.miss` is the art-missing glyph DexSprite falls back to, and this
          is the same situation with a different cause — without it the `?`
          renders at body size in a 96px box and reads as a stray character. */}
      <span className="dexart"><span className="miss">?</span></span>
      <h1>???</h1>
      <p className="muted sub">
        {dexOpen.locked.myth ? '환상' : '전설'} · {dexOpen.locked.gen}세대
      </p>
    </div>

    <h2>획득 조건</h2>
    {dexOpen.locked.open ? (
      /* The gate is already open — the bar would read 100% and say nothing.
         What matters now is that it can turn up, so say that instead. */
      <p className="sub">
        <b className="got">조우 가능</b>
        <span className="muted"> · 야생에서 만날 수 있습니다</span>
      </p>
    ) : (
      <>
      <p className="sub">
        <b>{compact(Math.min(dexOpen.locked.have, dexOpen.locked.need))}</b>
        <span className="muted"> / {compact(dexOpen.locked.need)}</span>
      </p>
      <div
        className="px-gauge"
        role="progressbar"
        aria-valuenow={Math.round(dexOpen.locked.ratio * 100)}
        aria-valuemax={100}
        style={{ '--v': dexOpen.locked.ratio * 100 } as React.CSSProperties}
      >
        <i />
      </div>
      </>
    )}
    <p className="muted sub note">{dexOpen.locked.how}</p>

    {dexOpen.locked.itemKo && (
      <>
      <h2>전용 도구</h2>
      <ul className="bars info">
        <li>
          <span className="lbl">{dexOpen.locked.itemKo}</span>
          <span className={dexOpen.locked.held ? 'num' : 'num pending'}>
            {dexOpen.locked.held ? '가지고 있음' : '없음'}
          </span>
        </li>
        <li>
          <span className="lbl">얻는 법</span>
          <span className="num">{LEGEND_SOURCE_KO[dexOpen.locked.source ?? ''] ?? '—'}</span>
        </li>
      </ul>
      <p className="muted sub note">
        {dexOpen.locked.ready
          ? '조건을 채웠습니다. 이제 이 도구를 얻을 수 있습니다.'
          : '위 조건을 먼저 채워야 이 도구를 얻을 수 있습니다.'}
      </p>
      </>
    )}

    <p className="muted sub note">
      조건을 채우면 야생에서 만날 수 있게 됩니다. 이기면 그 포켓몬의 알이 남고, 알을 품어
      키워야 도감에 들어갑니다.
    </p>
    </>
    ) : (
    <>
    <div className="portrait">
      <span className="dexart">
        {dexOpen.sprite ? <DexSprite name={dexOpen.sprite} alt="" box={88} /> : <span className="miss">?</span>}
      </span>
      <h1>
        {dexOpen.name}
        {dexOpen.shiny && <em className="shiny" title="색이 다른 개체">✨</em>}
      </h1>
      {/* Arrives with the fetch. No placeholder: a line of dots that turns
          into words is more movement than a line that simply appears. */}
      {dexDetail && (
        <p className="muted sub">
          {dexDetail.nameEn}
          {dexDetail.genus && ` · ${dexDetail.genus}`}
        </p>
      )}
      {dexOpen.types.length > 0 && (
        <ul className="types">
          {dexOpen.types.map((t) => (
            <li key={t.id} data-type={t.id}>
              {t.name}
            </li>
          ))}
        </ul>
      )}
    </div>

    {dexErr !== null ? (
      <p className="muted sub">
        정보를 가져오지 못했습니다.{' '}
        <button
          className="px-btn px-btn--link"
          onClick={() => {
            setDexErr(null);
            // Re-seat the same card so the fetch effect runs again.
            setDexOpen({ ...dexOpen });
          }}
        >
          다시 시도
        </button>
      </p>
    ) : !dexDetail ? (
      <p className="muted sub">불러오는 중…</p>
    ) : (
    <>
    {/* The frame is the clerk's message box; the fixed height is not. See
        .dexflavor in App.css for why the shop's reason does not apply here.
        A species with no Korean entry gets no box at all — the same rule that
        gives a species with no forms no row. */}
    {dexDetail.flavor && <p className="dexflavor uiwin">{dexDetail.flavor}</p>}

    <h2>정보</h2>
    <ul className="bars info">
      <li>
        <span className="lbl">크기</span>
        <span className="num">
          {dexDetail.heightM}m · {dexDetail.weightKg}kg
        </span>
      </li>
      <li>
        <span className="lbl">등급</span>
        <span className="num">
          {RARITY_LABEL[dexDetail.rarity] ?? dexDetail.rarity} · {dexDetail.generation}세대
        </span>
      </li>
      {dexDetail.abilities.map((a) => (
        <li key={a.ko}>
          <span className="lbl">{a.hidden ? '숨겨진 특성' : '특성'}</span>
          <span className="num">{a.ko}</span>
        </li>
      ))}
      <li>
        <span className="lbl">배울 수 있는 기술머신</span>
        <span className="num">{dexDetail.tmCount}개</span>
      </li>
    </ul>
    {/* Which one this species actually graduated with, when the dex knows. */}
    <p className="muted sub">
      {dexOpen?.abilityKo
        ? `이 도감의 ${dexDetail.name}${josa(dexDetail.name, '은', '는')} ${dexOpen.abilityKo} 특성으로 졸업했습니다. 특성은 배틀에서 원작대로 작동합니다.`
        : '특성은 배틀에서 원작대로 작동합니다. 개체마다 하나가 정해집니다.'}
    </p>

    {dexDetail.stages.length > 1 && (
      <>
        <h2>진화</h2>
        <p className="chain">
          {dexDetail.stages.map((col, i) => (
            <Fragment key={i}>
              {col.map((sp, j) => (
                <Fragment key={sp.speciesId}>
                  {/* Separators sit OUTSIDE the classed span so a slash does
                      not inherit `.now`'s weight. */}
                  {j > 0 && <em> · </em>}
                  <span className={sp.here ? 'now' : sp.collected ? 'got' : ''}>{sp.name}</span>
                </Fragment>
              ))}
              {i < dexDetail.stages.length - 1 && <em> → </em>}
            </Fragment>
          ))}
        </p>
        <p className="muted sub">
          이 계열 {dexDetail.stages.flat().length}종 중{' '}
          {dexDetail.stages.flat().filter((sp) => sp.collected).length}종 등록
        </p>
      </>
    )}

    {dexDetail.matchups.length > 0 && (
      <>
        <h2>방어 상성</h2>
        {/* Not trivia: server/hunt.ts multiplies every swing by exactly this,
            and Scene.tsx prints 효과가 굉장했다! from the same number. */}
        <ul className="bars matchups">
          {dexDetail.matchups.map((m) => (
            <li key={m.factor}>
              <span className="lbl">{FACTOR_LABEL[m.factor] ?? `${m.factor}배`}</span>
              <ul className="types wrap">
                {m.types.map((t) => (
                  <li key={t.id} data-type={t.id}>
                    {t.name}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <p className="muted sub">1배인 타입은 적지 않았습니다. 나머지 전부입니다.</p>
      </>
    )}

    {dexDetail.stats.length > 0 && (
      <>
        <h2>종족값</h2>
        <ul className="bars">
          {dexDetail.stats.map((st) => (
            <li key={st.name}>
              <span className="lbl">{st.name}</span>
              {/* Out of 180, not 255. Almost nothing reaches 255, so dividing
                  by it leaves every bar under half full and stops the six
                  telling one species from another — which is the only thing
                  a bar is for. */}
              <span className="px-gauge px-gauge--thin track" style={{ '--v': Math.min(100, (st.value / 180) * 100) } as React.CSSProperties}>
                <i />
              </span>
              <span className="num">{st.value}</span>
            </li>
          ))}
        </ul>
        <ul className="bars info">
          <li>
            <span className="lbl">합계</span>
            <span className="num">{dexDetail.statTotal}</span>
          </li>
        </ul>
        {/* The screen says out loud how these numbers are used, so nobody has
            to guess: every fight computes stats from exactly these, the
            level and the IVs. See `battleStats` in server/fight.ts. */}
        <p className="muted sub">
          원작 수치입니다. 이 앱의 배틀은 이 종족값에 레벨과 개체값을 더해 원작 공식대로
          능력치를 계산합니다.
        </p>
      </>
    )}

    {dexDetail.forms.length > 0 && (
      <>
        <h2>특별한 모습</h2>
        <ul className="bars info">
          {dexDetail.forms.map((f) => (
            <li key={f.id}>
              <span className="lbl">{f.kind === 'fusion' ? '합체' : '배틀에서'}</span>
              <span className="num">
                {f.ko}
                {f.power !== 1 && ` · 위력 ×${f.power}`}
              </span>
            </li>
          ))}
        </ul>
        <p className="muted sub">
          이 종에 존재하는 모습입니다. 메가·거다이맥스는 배틀에서만 나타나고 도감에는 남지
          않습니다.
        </p>
      </>
    )}

    {dexDetail.mine && (
      <>
        <h2>나와의 기록</h2>
        <ul className="bars info">
          <li>
            <span className="lbl">등록</span>
            <span className="num">
              {new Date(dexDetail.mine.firstSeenAt).toLocaleDateString('ko-KR')}
            </span>
          </li>
          {/* Only a row when there is one. "별명: 없음" on nine hundred entries
              is the row the 파트너 tab's forms comment already declined. */}
          {dexDetail.mine.nickname && (
            <li>
              <span className="lbl">별명</span>
              <span className="num">{dexDetail.mine.nickname}</span>
            </li>
          )}
          {dexDetail.mine.formKo && (
            <li>
              <span className="lbl">떠난 모습</span>
              <span className="num">{dexDetail.mine.formKo}</span>
            </li>
          )}
          {/* Costs no server field: the panel already holds the companion. */}
          {companion?.speciesId === dexOpen.speciesId && (
            <li>
              <span className="lbl">지금 파트너</span>
              <span className="num">{companion.nickname ?? companion.name}</span>
            </li>
          )}
        </ul>
      </>
    )}
    </>
    )}
    </>
    )}
    </>
  );
}
