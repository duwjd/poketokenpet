import type { Dispatch, SetStateAction } from 'react';
import Scene from '../../Scene.tsx';
import { timeOfDayAt } from '../../timeOfDay.ts';
import { josa } from '../../josa.ts';
import { spriteUrl, type PetActionKind } from '../../api.ts';
import { DexSprite } from '../DexSprite.tsx';
import { Toggle } from '../Toggle.tsx';
import { NICKNAME_MAX, RARITY_LABEL, compact, formNeed, isAttack, moveSummary } from '../labels.ts';
import type { Companion, Progress, State, TabId } from '../types.ts';

type PetTabProps = {
  state: State;
  tokens: State['tokens'];
  companion: Companion | null;
  progress: Progress;
  busy: boolean;
  playing: boolean;
  awaiting: boolean;
  pendingRelearn: number | null;
  setPendingRelearn: Dispatch<SetStateAction<number | null>>;
  draftName: string | null;
  setDraftName: Dispatch<SetStateAction<string | null>>;
  bagKey: string | null;
  goTab: (id: TabId) => void;
  onPlaying: (on: boolean) => void;
  act: (action: PetActionKind, id: string, slot?: number | null) => Promise<void>;
};

/** 파트너: the scene, the companion, its moves, and the hunt in numbers. */
export function PetTab({
  state,
  tokens,
  companion,
  progress,
  busy,
  playing,
  awaiting,
  pendingRelearn,
  setPendingRelearn,
  draftName,
  setDraftName,
  bagKey,
  goTab,
  onPlaying,
  act,
}: PetTabProps) {
  const pct = Math.round(progress.ratio * 100);
  const remaining = Math.max(0, progress.need - progress.have);
  /**
   * Hunting has earned everything its share allows.
   *
   * `Math.min(room(), ...)` in hunt() means an encounter past the cap records
   * zero, so the log fills with "—" and the bar stops — with nothing on screen
   * saying why. Both numbers are already on the payload; this is only the panel
   * noticing that they have met.
   */
  const huntCapped = state.hunt.cap !== null && state.hunt.tokens >= state.hunt.cap;

  return (
    <>
    <Scene
      companion={
        companion
          ? {
              name: companion.nickname ?? companion.name,
              sprite: companion.sprite,
              backSprite: companion.backSprite,
            }
          : null
      }
      eggSprite={state.eggSprite}
      eggRatio={progress.ratio}
      log={state.hunt.log}
      idleReason={state.hunt.idleReason}
      nextInMs={state.hunt.nextInMs}
      stop={state.hunt.stop}
      skylineBg={state.hunt.skylineBg}
      /*
       * Read at render rather than on a timer of its own. The payload already
       * re-renders this every few seconds, so a phase change lands within one
       * poll of the hour turning over — and nothing here is worth its own
       * interval to make that instant.
       */
      timeOfDay={timeOfDayAt(new Date())}
      fx={state.fx}
      capped={huntCapped}
      onPlaying={onPlaying}
    />

    {/* The challenge on offer.

        Directly under <Scene> ON PURPOSE: <Scene> is mounted only on this
        tab, so pressing 도전 anywhere else would resolve the fight with
        nothing on screen to show it — which is the entire problem this
        feature exists to fix. The button has to live where the battle will
        appear. */}
    {/* Hidden while a fight is on screen or about to be: the card vanishing
        the moment a badge is won would say so before the battle has. */}
    {state.hunt.challenge && !awaiting && !playing && (
      <div className="offer">
        <span className="art">
          {state.hunt.challenge.sprite ? (
            <DexSprite name={state.hunt.challenge.sprite} alt="" />
          ) : (
            '!'
          )}
        </span>
        <span className="lbl">
          <b>{state.hunt.challenge.ko}</b>
          <em>
            {state.hunt.challenge.kind === 'gym'
              ? `${state.hunt.challenge.cityKo} · ${state.hunt.challenge.size}마리${
                  state.hunt.challenge.badgeKo ? ` · ${state.hunt.challenge.badgeKo}` : ''
                }`
              : `${state.hunt.challenge.cityKo} · ${state.hunt.challenge.size}명 연속`}
          </em>
          <em className="muted">기회 {state.hunt.challenge.left}번 남음</em>
        </span>
        <span className="acts">
          <button className="px-btn px-btn--primary"
            onClick={() => act('challenge', `accept:${state.hunt.challenge!.id}`)}
            disabled={busy}
          >
            도전
          </button>
          <button className="px-btn px-btn--link" onClick={() => act('challenge', 'decline')} disabled={busy}>
            나중에
          </button>
        </span>
      </div>
    )}

    {/* The portrait: a picture with a caption, so it is the one thing that
        stays centred while the rest of the panel shares a left edge. */}
    <div className="portrait">
      <h1>
        {companion ? (companion.nickname ?? companion.name) : '알'}
        {companion?.isShiny && <span className="shiny" title="색이 다른 개체">✨</span>}
        {companion && draftName === null && (
          <button
            className="namebtn"
            title="이름 바꾸기"
            aria-label="이름 바꾸기"
            onClick={() => setDraftName(companion.nickname ?? '')}
          >
            ✏️
          </button>
        )}
      </h1>

      {companion && draftName !== null && (
        <div className="rename">
          <input
            autoFocus
            aria-label="닉네임"
            value={draftName}
            maxLength={NICKNAME_MAX}
            placeholder={companion.name}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              // Enter commits, Escape abandons. An empty box clears the nickname.
              if (e.key === 'Enter') {
                const next = draftName;
                setDraftName(null);
                void act('rename', next);
              } else if (e.key === 'Escape') {
                setDraftName(null);
              }
            }}
          />
          <button className="px-btn"
            disabled={busy}
            onClick={() => {
              const next = draftName;
              setDraftName(null);
              void act('rename', next);
            }}
          >
            확인
          </button>
        </div>
      )}

      {companion && (
        <p className="muted sub">
          {/* The species name still belongs on screen once a nickname hides it. */}
          {companion.nickname ? `${companion.name} · ` : ''}
          {companion.nameEn}
          {companion.genus && ` · ${companion.genus}`}
        </p>
      )}

      {companion && companion.types.length > 0 && (
        <ul className="types">
          {companion.types.map((t) => (
            <li key={t.id} data-type={t.id}>
              {t.name}
            </li>
          ))}
        </ul>
      )}
    </div>

    <div className="px-gauge" role="progressbar" aria-valuenow={pct} aria-valuemax={100} style={{ '--v': pct } as React.CSSProperties}>
      <i />
    </div>
    <p className="muted sub">
      {progress.phase === 'egg' && `부화까지 ${compact(remaining)} 남음 · ${pct}%`}
      {progress.phase !== 'egg' &&
        (progress.level >= 100
          ? 'Lv.100 · 졸업을 기다립니다'
          : `Lv.${progress.level} · 다음 레벨까지 ${compact(remaining)} 남음 · 졸업까지 ${Math.round(progress.total * 100)}%`)}
    </p>

    {companion && companion.stageCount > 1 && (
      <p className="chain">
        {companion.path.map((s, i) => (
          <span key={s.id} className={i === companion.stageIndex ? 'now' : i < companion.stageIndex ? 'done' : ''}>
            {s.name}
            {i < companion.path.length - 1 && <em> → </em>}
          </span>
        ))}
      </p>
    )}

    {companion && (
      <>
        <h2>상태</h2>
        <ul className="bars info">
          <li>
            <span className="lbl">레벨</span>
            <span className="num">Lv.{companion.level}</span>
          </li>
          <li>
            <span className="lbl">단계</span>
            <span className="num">
              {companion.stageIndex + 1} / {companion.stageCount}
            </span>
          </li>
          {/*
            * What each next evolution needs. One row per branch, each way
            * separated — "Lv.36", "천둥의돌", "친밀도 160 · 밤". A stone is
            * used from the bag; the shop sells the ones this companion can use.
            */}
          {companion.evolves.map((e) => (
            <li key={e.to}>
              <span className="lbl">{e.name}{josa(e.name, '으로', '로')}</span>
              <span className="num pending">{e.ways.join(' 또는 ')}</span>
            </li>
          ))}
          <li>
            <span className="lbl">친밀도</span>
            <span className="num">{companion.friendship}</span>
          </li>
          {companion.ability && (
            <li>
              <span className="lbl">{companion.ability.hidden ? '숨겨진 특성' : '특성'}</span>
              <span className="num">{companion.ability.ko}</span>
            </li>
          )}
          <li>
            <span className="lbl">희귀도</span>
            <span className="num">{RARITY_LABEL[companion.rarity]}</span>
          </li>
          <li>
            <span className="lbl">성격</span>
            <span className="num">{companion.nature}</span>
          </li>
          <li>
            <span className="lbl">크기</span>
            <span className="num">
              {companion.heightM}m · {companion.weightKg}kg
            </span>
          </li>
          <li>
            <span className="lbl">함께한 진행도</span>
            <span className="num">{compact(companion.withYou)}</span>
          </li>
          <li>
            <span className="lbl">만난 포켓몬</span>
            <span className="num">{state.hunt.sinceBirth.count.toLocaleString()}회</span>
          </li>
          {/*
            * One row per battle form this species could reach.
            *
            * Shown whenever the species HAS one, not only once everything is
            * satisfied — the row used to appear only when nothing was left to
            * say, so the one moment it could have helped was the one moment
            * it was absent. Ordinary species still get no row at all, which
            * is why this is not a "없음" line on a thousand Pokemon.
            */}
          {companion.forms.map((f) => (
            <li key={f.id}>
              <span className="lbl">배틀에서</span>
              <span className={`num${f.ready ? '' : ' pending'}`}>
                {f.ko}
                {f.ready ? '' : ` · ${formNeed(f, state.bag.everstone)}`}
              </span>
            </li>
          ))}
        </ul>
        {companion.flip && (
          <ul className="items">
            <li>
              <span className="lbl">
                거꾸로 들기
                <em>다음 레벨업 때 거꾸로 들고 있으면 진화합니다. 레벨업이 지나면 다시 바로 듭니다.</em>
              </span>
              <Toggle
                label="거꾸로 들기"
                on={companion.flip.on}
                word={companion.flip.on ? '거꾸로' : '바로'}
                disabled={busy}
                onClick={() => act('flip', companion.flip!.on ? 'off' : 'on')}
              />
            </li>
          </ul>
        )}
        {companion.battleForm && (
          <ul className="items">
            <li>
              <span className="lbl">
                배틀 모습으로 보기
                <em>
                  {companion.battleForm.ko}
                  {josa(companion.battleForm.ko, '은', '는')} 배틀에서만 나타납니다. 켜면 떠 있는
                  펫과 이 화면에도 그 모습으로 보입니다 — 보이기만 할 뿐 규칙은 그대로입니다.
                </em>
              </span>
              <Toggle
                label="배틀 모습으로 보기"
                on={state.bag.showBattleForm}
                word={state.bag.showBattleForm ? '켜짐' : '꺼짐'}
                disabled={busy}
                onClick={() => act('form', state.bag.showBattleForm ? 'off' : 'on')}
              />
            </li>
          </ul>
        )}

        <h2>기술</h2>
        {/* The moveset belongs to the partner, so it is managed here. The bag
            holds the TMs; using one is what sends you there. */}
        <ul className="items">
          {/* Four rows always, so the slot count is visible rather than implied. */}
          {Array.from({ length: state.hunt.slots }, (_, i) => {
            const m = state.moves[i];
            if (!m) {
              return (
                <li key={`empty-${i}`} className="empty">
                  <span className="icon" />
                  <span className="lbl">
                    빈 칸
                    <em>가방의 기술머신으로 채웁니다.</em>
                  </span>
                </li>
              );
            }
            // The server refuses this too, but a disabled button that says
            // why is a rule; a red toast after the click is an error.
            const lastAttack = isAttack(m) && state.moves.filter(isAttack).length === 1;
            const incoming = pendingRelearn === null ? null : state.relearnable.find((r) => r.id === pendingRelearn);
            // Swapping in another attack is always fine; a status move may not push out the last one.
            const blocked = lastAttack && (!incoming || !isAttack(incoming));
            return (
              <li key={m.id} data-type={m.type} className={`row${bagKey === `tm:${m.id}` ? ' on' : ''}`}>
                {m.sprite ? (
                  <img className="icon" src={spriteUrl(m.sprite)} alt="" />
                ) : (
                  <span className="icon" />
                )}
                <span className="lbl">
                  {m.name}
                  <em>{lastAttack ? `${moveSummary(m)} · 하나뿐인 공격 기술` : moveSummary(m)}</em>
                </span>
                {incoming ? (
                  <button className="px-btn"
                    disabled={busy || blocked}
                    onClick={() => {
                      setPendingRelearn(null);
                      void act('relearn', String(incoming.id), i);
                    }}
                  >
                    교체
                  </button>
                ) : (
                  <button className="px-btn"
                    disabled={busy || lastAttack}
                    title={lastAttack ? '공격 기술은 하나 남겨두어야 합니다.' : undefined}
                    onClick={() => act('forget', String(i))}
                  >
                    잊기
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        {/*
          * The games' move reminder: level-up moves it has learned and is not
          * using. Free — they were never TMs. With four already known, the
          * row asks which one to replace, and the four rows above answer.
          */}
        {state.relearnable.length > 0 && (
          <>
            <h2>
              떠올릴 수 있는 기술 <em className="muted">{state.relearnable.length}</em>
            </h2>
            <ul className="items">
              {state.relearnable.map((m) => (
                <li key={m.id} data-type={m.type} className={`row${pendingRelearn === m.id ? ' on' : ''}`}>
                  {m.sprite ? <img className="icon" src={spriteUrl(m.sprite)} alt="" /> : <span className="icon" />}
                  <span className="lbl">
                    {m.name}
                    <em>
                      {pendingRelearn === m.id ? '위에서 잊을 기술을 고르세요' : moveSummary(m)}
                    </em>
                  </span>
                  <button className="px-btn"
                    disabled={busy}
                    onClick={() => {
                      if (pendingRelearn === m.id) return setPendingRelearn(null);
                      if (state.moves.length < state.hunt.slots) void act('relearn', String(m.id));
                      else setPendingRelearn(m.id);
                    }}
                  >
                    {pendingRelearn === m.id ? '취소' : '떠올리기'}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </>
    )}

    <div className="grid">
      <div className="stat">
        <span className="k">오늘</span>
        <span className="v">{compact(tokens.today)}</span>
        <span className="k">{tokens.todayMessages.toLocaleString()} messages</span>
      </div>
      <div className="stat">
        <span className="k">펫과 함께</span>
        <span className="v">{compact(tokens.lifetime)}</span>
        <span className="k">설치 이후</span>
      </div>
      <div className="stat">
        <span className="k">전체 기록</span>
        <span className="v">{compact(tokens.total)}</span>
        <span className="k">기준선 포함</span>
      </div>
    </div>

    <h2>자동사냥</h2>
    {/* Why hunting is idle is said in the scene caption, right above — saying
        it twice on one screen is worse than saying it once, in the picture. */}
    {!state.hunt.idleReason && state.hunt.speed > 1 && (
      <p className="muted sub">기술 덕분에 사냥 속도 ×{state.hunt.speed.toFixed(2)}</p>
    )}
    {/* The one thing the two numbers below cannot say on their own: they have
        met. Encounters and TM drops carry on; only the progress stops, and
        without this the bar just sits still and reads as a bug. */}
    {huntCapped && (
      <p className="muted sub warn">
        사냥 진행도가 상한에 닿았습니다. 조우와 기술머신은 계속되지만 진행도는 오르지
        않습니다 — 상한은 번 토큰에 비례하므로 코딩을 하면 함께 올라갑니다.
      </p>
    )}
    {/* This companion's numbers, because this is its tab. The lifetime pair
        lives on the cap row below, which is the one figure that cannot be
        scoped to a companion — the ceiling weighs everything hunting has ever
        contributed against everything ever earned. */}
    <ul className="bars info">
      <li>
        <span className="lbl">사냥으로 얻은 진행도</span>
        <span className="num">{compact(state.hunt.sinceBirth.tokens)}</span>
      </li>
      <li>
        <span className="lbl">만난 포켓몬</span>
        <span className="num">{state.hunt.sinceBirth.count.toLocaleString()}회</span>
      </li>
      <li>
        {/* The share cap is the reason hunting cannot replace coding. Showing
            it keeps that honest rather than letting the bar quietly stall.
            Labelled 누적 so it is not read as a ceiling on the row above. */}
        <span className="lbl">사냥 상한 (누적)</span>
        <span className={huntCapped ? 'num warn' : 'num'}>
          {state.hunt.cap === null
            ? `${compact(state.hunt.tokens)} · 해제됨`
            : `${compact(state.hunt.tokens)} / ${compact(state.hunt.cap)}`}
        </span>
      </li>
    </ul>

    {/* The blow-by-blow lives on 기록. Eight rows of it here buried the
        partner's own information, and the scene above already plays the most
        recent encounter live. */}
    {state.hunt.log.length > 0 && (
      <p className="muted sub">
        방금 {state.hunt.log[0].trainer?.name ?? state.hunt.log[0].wildName}
        {state.hunt.log[0].tokens > 0 && ` · +${compact(state.hunt.log[0].tokens)}`}
        {' · '}
        <button className="px-btn px-btn--link" onClick={() => goTab('stats')}>
          사냥 기록 보기
        </button>
      </p>
    )}
    </>
  );
}
