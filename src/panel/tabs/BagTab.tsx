import type { Dispatch, SetStateAction } from 'react';
import { spriteUrl, type PetActionKind } from '../../api.ts';
import { euro, josa } from '../../josa.ts';
import {
  ITEM_DESC,
  ITEM_NAMES,
  PASSIVE,
  POCKETS,
  RARITY_LABEL,
  TM_PAGE,
  isAttack,
  moveSummary,
  type Pocket,
} from '../labels.ts';
import type { Companion, State, TabId } from '../types.ts';

type BagTabProps = {
  state: State;
  companion: Companion | null;
  busy: boolean;
  pocket: Pocket;
  setPocket: Dispatch<SetStateAction<Pocket>>;
  tmPage: number;
  setTmPage: Dispatch<SetStateAction<number>>;
  bagKey: string | null;
  bagPin: string | null;
  setBagPin: Dispatch<SetStateAction<string | null>>;
  setBagOver: Dispatch<SetStateAction<string | null>>;
  bagItems: [string, number][];
  pendingTm: number | null;
  setPendingTm: Dispatch<SetStateAction<number | null>>;
  setDexView: Dispatch<SetStateAction<'dex' | 'legends' | 'party'>>;
  goTab: (id: TabId) => void;
  act: (action: PetActionKind, id: string, slot?: number | null) => Promise<void>;
};

/** 가방: the pockets, and the window that describes what is in them. */
export function BagTab({
  state,
  companion,
  busy,
  pocket,
  setPocket,
  tmPage,
  setTmPage,
  bagKey,
  bagPin,
  setBagPin,
  setBagOver,
  bagItems,
  pendingTm,
  setPendingTm,
  setDexView,
  goTab,
  act,
}: BagTabProps) {
  /**
   * What the bag's description window is showing.
   *
   * Keyed by kind so the three lists cannot collide on a bare number: a TM's
   * move id and a stone's form id live in different spaces but are both ints.
   *
   * A setting explains itself where it sits; an item's description is
   * something you look up, which is the distinction the games draw too — and
   * the reason the settings that used to be at the bottom of this tab never
   * used this window, and have now gone to 설정 entirely.
   */
  /** A bag item's icon, borrowed from the shop row that sells the same id. */
  const itemIcon = (id: string) => state.shop.products.find((p) => p.id === id)?.sprite ?? null;
  /** The six shop items by their fixed names; an evolution item by its shop row's. */
  const itemName = (id: string) => ITEM_NAMES[id] ?? state.shop.products.find((p) => p.id === id)?.name ?? id;

  const bagShown = ((): { name: string; desc: string } | null => {
    if (!bagKey) return null;
    const cut = bagKey.indexOf(':');
    const [kind, key] = [bagKey.slice(0, cut), bagKey.slice(cut + 1)];
    if (kind === 'tm') {
      const m = state.tms.find((t) => String(t.id) === key);
      return m ? { name: m.name, desc: moveSummary(m) } : null;
    }
    if (kind === 'stone') {
      const st = state.bag.stones.find((x) => String(x.id) === key);
      return st ? { name: st.ko, desc: `${st.formKo}${euro(st.formKo)} 메가진화합니다.` } : null;
    }
    // An evolution item names and describes itself through its shop row.
    const row = state.shop.products.find((p) => p.id === key);
    const desc = ITEM_DESC[key] ?? row?.desc;
    return desc ? { name: itemName(key), desc } : null;
  })();

  /**
   * The two pockets the inventory splits into.
   *
   * Same source, cut by whether there is anything to press. A passive works by
   * being owned, so 도구 holds only what a button belongs on and 중요한 물건
   * holds the rest — see POCKETS.
   */
  const usableItems = bagItems.filter(([id]) => !PASSIVE.has(id));
  const keyItems = bagItems.filter(([id]) => PASSIVE.has(id));

  /**
   * What is different about the game right now, said in the description window
   * whenever nothing is being pointed at.
   *
   * These lines used to sit in a `<p>` under the item list — the least visible
   * place on the screen, for the one thing on it that says the rules have
   * changed. Meanwhile the biggest element sat empty waiting to be hovered.
   *
   * Joined rather than concatenated with a trailing separator, which is what
   * the old line did: three conditional fragments each ending in ` · ` left
   * `다음 부화 샤이니 확률 8배 · ` dangling whenever the last one was absent.
   */
  const bagEffects = [
    state.bag.everstone && '진화 정지 중',
    state.bag.shinyCharmActive && '다음 부화 샤이니 확률 8배',
    state.bag.forcedRarity && `다음 부화 ${RARITY_LABEL[state.bag.forcedRarity]} 보장`,
  ].filter((v): v is string => typeof v === 'string');

  /**
   * The machine pocket's page, and the slice it shows.
   *
   * `tmAt` is CLAMPED here rather than corrected in an effect: teaching consumes
   * the machine, so the list shrinks under the page you are standing on, and the
   * last page can stop existing between one render and the next. Deriving it
   * means the render after a teach is already right — an effect would paint the
   * empty page first and fix it a frame later.
   */
  const tmPages = Math.max(1, Math.ceil(state.tms.length / TM_PAGE));
  const tmAt = Math.min(tmPage, tmPages - 1);
  const tmShown = state.tms.slice(tmAt * TM_PAGE, (tmAt + 1) * TM_PAGE);

  /** The TM waiting on a slot, named — JSX cannot declare a const inline and
   *  the particle needs the name a second time. */
  const pendingTmName =
    pendingTm === null ? null : (state.tms.find((t) => t.id === pendingTm)?.name ?? '기술');

  return (
    <>
    <h2>가방</h2>
    {/* Pockets, which is how the games carve a bag up — five Cases in Gen 5.
        Three here, and they exist whether or not they hold anything. Without
        them fourteen TMs, the items and the stones are one endless column. */}
    <div className="px-chips chips shopchips" role="group" aria-label="가방 주머니">
      {POCKETS.map((k) => (
        <button
          key={k.id}
          className="px-chip px-chip--sm" aria-pressed={pocket === k.id}
          onClick={() => {
            setPocket(k.id);
            setTmPage(0);
            // A half-made "which one do I forget" belongs to the pocket it
            // was started in; carrying it to 메가스톤 and back is a question
            // hanging over a screen that cannot answer it.
            setPendingTm(null);
          }}
        >
          {k.label}
        </button>
      ))}
    </div>
    {/*
      * The same window the counter uses, in the same place, saying the same
      * kind of thing — so the two tabs read as one screen.
      *
      * Three states, not two. Pointing at a row still fills it; but with
      * nothing pointed at it now reports what is actually in effect rather
      * than waiting to be hovered. The biggest element on the screen used to
      * be the emptiest, while the fact that evolution was stopped sat in a
      * grey line under the list.
      */}
    <div className="saywin uiwin" aria-live="polite">
      {bagShown ? (
        <>
          <span className="saywin-line">
            <span>{bagShown.name}</span>
          </span>
          <span className="saywin-desc">{bagShown.desc}</span>
        </>
      ) : bagEffects.length > 0 ? (
        <>
          <span className="saywin-line">
            <span>지금 걸린 효과</span>
          </span>
          <span className="saywin-desc">{bagEffects.join(' · ')}</span>
        </>
      ) : (
        '고르면 여기에 설명이 나옵니다.'
      )}
    </div>

    {pocket === 'tm' && (
    <>
    {/* Only while a TM is waiting on a slot. The four slots live on 파트너, so
        this is a compact stand-in rather than a second copy of that list. */}
    {pendingTmName !== null && (
      <>
        <p className="pickhint">
          {pendingTmName}
          {josa(pendingTmName, '을', '를')} 배우려면 하나를 잊어야 합니다.{' '}
          <button className="px-btn px-btn--link" onClick={() => setPendingTm(null)}>
            취소
          </button>
        </p>
        <ul className="items">
          {state.moves.map((m, i) => {
            // Swapping an attack for an attack is always fine; it is only
            // trading the last one AWAY for a status move that is refused.
            const incomingHits = state.tms.find((t) => t.id === pendingTm)?.damageClass !== 'status';
            const lastAttack =
              !incomingHits && isAttack(m) && state.moves.filter(isAttack).length === 1;
            return (
              <li key={m.id} className="picking" data-type={m.type}>
                {/* The summary is what makes 변화 visible — without it you are
                    picking what to sacrifice by name alone. */}
                <span className="lbl">
                  {m.name}
                  <em>{lastAttack ? `${moveSummary(m)} · 하나뿐인 공격 기술` : moveSummary(m)}</em>
                </span>
                <button className="px-btn"
                  disabled={busy || lastAttack}
                  title={lastAttack ? '공격 기술은 하나 남겨두어야 합니다.' : undefined}
                  onClick={() => {
                    const tm = pendingTm;
                    setPendingTm(null);
                    void act('teach', String(tm), i);
                  }}
                >
                  이걸 잊기
                </button>
              </li>
            );
          })}
        </ul>
      </>
    )}
    {state.tms.length === 0 ? (
      <p className="muted sub">
        {state.unusableTmCount > 0
          ? `가진 기술머신 ${state.unusableTmCount}개는 지금 포켓몬이 배울 수 없습니다.`
          : '아직 없습니다. 자동사냥 중에 가끔 떨어집니다.'}
      </p>
    ) : (
      <ul className="items">
        {tmShown.map((m) => (
          <li key={m.id} data-type={m.type} className={`row${bagKey === `tm:${m.id}` ? ' on' : ''}`}>
            {m.sprite ? (
              <img className="icon" src={spriteUrl(m.sprite)} alt="" />
            ) : (
              <span className="icon" />
            )}
            <button
              className="lbl rowbtn"
              aria-pressed={bagPin === `tm:${m.id}`}
              onMouseEnter={() => setBagOver(`tm:${m.id}`)}
              onMouseLeave={() => setBagOver(null)}
              onFocus={() => setBagOver(`tm:${m.id}`)}
              onBlur={() => setBagOver(null)}
              onClick={() => setBagPin(bagPin === `tm:${m.id}` ? null : `tm:${m.id}`)}
            >
              <span>
                {m.name} {m.count > 1 && <b>×{m.count}</b>}
              </span>
            </button>
            <button className="px-btn"
              disabled={busy}
              onClick={() =>
                // Four slots full? Ask which one to overwrite instead of
                // silently refusing, which is what the server would do.
                state.moves.length >= state.hunt.slots
                  ? setPendingTm(m.id)
                  : void act('teach', String(m.id))
              }
            >
              배우기
            </button>
          </li>
        ))}
      </ul>
    )}
    {/*
      * Pages rather than one long column.
      *
      * Only when there is more than one — a pager reading `1 / 1` is a control
      * that says nothing, which is the same rule that gives a species with no
      * forms no row at all.
      */}
    {tmPages > 1 && pendingTmName === null && (
      <div className="pager">
        <button className="px-btn"
          aria-label="이전 쪽"
          disabled={tmAt === 0}
          onClick={() => setTmPage(tmAt - 1)}
        >
          ◀
        </button>
        <span className="num">
          {tmAt + 1} / {tmPages}
        </span>
        <button className="px-btn"
          aria-label="다음 쪽"
          disabled={tmAt >= tmPages - 1}
          onClick={() => setTmPage(tmAt + 1)}
        >
          ▶
        </button>
      </div>
    )}
    {state.tms.length > 0 && state.unusableTmCount > 0 && (
      <p className="muted sub">
        이 포켓몬이 배울 수 없는 기술머신 {state.unusableTmCount}개는 숨겨져 있습니다.
      </p>
    )}
    </>
    )}

    {pocket === 'item' && (
    <>

    {usableItems.length === 0 ? (
      <p className="muted sub">아직 아이템이 없습니다.</p>
    ) : (
      <ul className="items">
        {usableItems.map(([id, n]) => {
          // The everstone is genuinely switched, which is why it is here and
          // the key stone is not: this pocket holds what a button belongs on.
          const worn = id === 'everstone' && state.bag.everstone;
          const fused = id === 'dna-splicers' && !!state.companion?.form;
          // Kyurem can fuse two ways, so the choice has to be made here rather
          // than guessed. One option needs no picker.
          const choices = id === 'dna-splicers' ? (state.companion?.fusions ?? []) : [];
          return (
            <li key={id} className={`row${bagKey === `item:${id}` ? ' on' : ''}`}>
              {/* The games put an icon immediately left of every bag line. The
                  shop already resolved one for this very id, so reuse it
                  rather than asking the payload for the same file twice. */}
              {itemIcon(id) ? (
                <img className="icon" src={spriteUrl(itemIcon(id)!)} alt="" />
              ) : (
                <span className="icon">💠</span>
              )}
              <button
                className="lbl rowbtn"
                aria-pressed={bagPin === `item:${id}`}
                onMouseEnter={() => setBagOver(`item:${id}`)}
                onMouseLeave={() => setBagOver(null)}
                onFocus={() => setBagOver(`item:${id}`)}
                onBlur={() => setBagOver(null)}
                onClick={() => setBagPin(bagPin === `item:${id}` ? null : `item:${id}`)}
              >
                <span>
                  {itemName(id)} <b>×{n}</b>
                </span>
              </button>
              {choices.length > 1 && !fused ? (
                <span className="picker">
                  {choices.map((f) => (
                    <button className="px-btn" key={f.id} onClick={() => act('use', id, f.id)} disabled={busy}>
                      {f.partnerKo}
                    </button>
                  ))}
                </span>
              ) : (
                <button className="px-btn" onClick={() => act('use', id)} disabled={busy}>
                  {fused ? '분리' : worn ? '해제' : '사용'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    )}
    </>
    )}

    {pocket === 'key' && (
    <>
    {/* Nothing in here has a control, and that is the point — a passive works
        by being owned. Pointing at one still says what it does, which is the
        only reason to open this pocket at all. */}
    {keyItems.length === 0 ? (
      <p className="muted sub">아직 중요한 물건이 없습니다. 상점에 있습니다.</p>
    ) : (
      <ul className="items">
        {keyItems.map(([id]) => (
          <li key={id} className={`row${bagKey === `item:${id}` ? ' on' : ''}`}>
            {itemIcon(id) ? (
              <img className="icon" src={spriteUrl(itemIcon(id)!)} alt="" />
            ) : (
              <span className="icon">💠</span>
            )}
            <button
              className="lbl rowbtn"
              aria-pressed={bagPin === `item:${id}`}
              onMouseEnter={() => setBagOver(`item:${id}`)}
              onMouseLeave={() => setBagOver(null)}
              onFocus={() => setBagOver(`item:${id}`)}
              onBlur={() => setBagOver(null)}
              onClick={() => setBagPin(bagPin === `item:${id}` ? null : `item:${id}`)}
            >
              {/* No count: an accessory is not a stack, and a ×1 beside it
                  reads as something you spend. */}
              <span>{itemName(id)}</span>
            </button>
            <span className="badge">보유 중</span>
          </li>
        ))}
      </ul>
    )}
    </>
    )}

    {pocket === 'stone' && (
    <>
    {/* A collection won by hunting that outlives the companion, so it gets a
        pocket of its own rather than living under the items. */}
    {state.bag.stones.length === 0 ? (
      <p className="muted sub">아직 메가스톤이 없습니다. 자동사냥 중에 가끔 떨어집니다.</p>
    ) : (
      <>
        <ul className="items">
          {/* Usable first. A hundred stones sorted by id is a wall, and the
              one that matters is the one this companion can actually use. */}
          {[...state.bag.stones]
            .sort((a, b) => Number(b.usable) - Number(a.usable) || a.id - b.id)
            .map((st) => (
              <li
                key={st.id}
                className={`row${st.usable ? ' usable' : ''}${bagKey === `stone:${st.id}` ? ' on' : ''}`}
              >
                {st.sprite ? (
                  <img className="icon" src={spriteUrl(st.sprite)} alt="" />
                ) : (
                  <span className="icon">💠</span>
                )}
                <button
                  className="lbl rowbtn"
                  aria-pressed={bagPin === `stone:${st.id}`}
                  onMouseEnter={() => setBagOver(`stone:${st.id}`)}
                  onMouseLeave={() => setBagOver(null)}
                  onFocus={() => setBagOver(`stone:${st.id}`)}
                  onBlur={() => setBagOver(null)}
                  onClick={() =>
                    setBagPin(bagPin === `stone:${st.id}` ? null : `stone:${st.id}`)
                  }
                >
                  <span>
                    {st.ko} <b>×{st.count}</b>
                  </span>
                </button>
                {st.usable && <span className="badge">지금 쓸 수 있음</span>}
              </li>
            ))}
        </ul>
        {!(state.bag.inventory['key-stone'] ?? 0) && state.bag.stones.some((st) => st.usable) && (
          <p className="muted sub">
            키스톤이 있으면 배틀에서 메가진화합니다. 상점에 있습니다.
          </p>
        )}
      </>
    )}
    </>
    )}

    {pocket === 'legend' && (
    <>
    {/* Three things that all belong to the legendaries, in the order you meet
        them: the item that summons one, the fragments that become an item,
        and the egg a won fight leaves behind. */}
    {state.legends.waiting && (
      <p className="muted sub warn">
        {state.legends.waiting.ko}
        {josa(state.legends.waiting.ko, '을', '를')} 기다리는 중입니다. 다음 조우에 나타납니다.
      </p>
    )}

    {state.legends.items.length === 0 &&
    state.legends.shards.length === 0 &&
    state.legends.eggs.length === 0 ? (
      <p className="muted sub">
        아직 아무것도 없습니다. 전설의 조건을 채우면 전용 도구가 사냥에서 떨어지기 시작합니다.
        {' '}
        {/* It says 조건 and offered no way to see them. `goTab` resets the
            dex view, so it has to be set after the switch. */}
        <button
          className="px-btn px-btn--link"
          onClick={() => {
            goTab('dex');
            setDexView('legends');
          }}
        >
          조건 보기
        </button>
      </p>
    ) : null}

    {state.legends.items.length > 0 && (
      <>
      <h3 className="shelf">전용 도구</h3>
      <ul className="items">
        {state.legends.items.map((it) => (
          <li key={it.slug} className="row">
            <span className="icon">
              {it.sprite ? <img src={spriteUrl(it.sprite)} alt="" /> : '🔮'}
            </span>
            <span className="lbl">
              <span>
                {it.ko} <b>×{it.count}</b>
              </span>
              {it.forKo && <em>{it.forKo}{josa(it.forKo, '을', '를')} 부릅니다.</em>}
            </span>
            <button className="px-btn" onClick={() => act('legend', it.slug)} disabled={busy}>
              사용
            </button>
          </li>
        ))}
      </ul>
      </>
    )}

    {state.legends.shards.length > 0 && (
      <>
      <h3 className="shelf">조각</h3>
      <ul className="items">
        {state.legends.shards.map((sh) => (
          <li key={sh.slug} className={sh.ready ? 'row' : 'row empty'}>
            <span className="icon">🧩</span>
            <span className="lbl">
              <span className="awardtop">
                <span>{sh.ko} 조각</span>
                <em className="num">
                  {sh.count} / {sh.need}
                </em>
              </span>
              <span className="px-gauge px-gauge--thin track" aria-hidden="true" style={{ '--v': Math.min(100, (sh.count / sh.need) * 100) } as React.CSSProperties}>
                <i />
              </span>
            </span>
            {sh.ready && (
              <button className="px-btn" onClick={() => act('fuse', sh.slug)} disabled={busy}>
                합치기
              </button>
            )}
          </li>
        ))}
      </ul>
      </>
    )}

    {state.legends.eggs.length > 0 && (
      <>
      <h3 className="shelf">전설의 알</h3>
      {/* Using one graduates whoever is out, exactly as buying a shop egg
          does — so the button says what it costs before it is pressed. */}
      <ul className="items">
        {state.legends.eggs.map((eg) => (
          <li key={eg.speciesId} className="row">
            <span className="icon">
              {eg.sprite ? <img src={spriteUrl(eg.sprite)} alt="" /> : '🥚'}
            </span>
            <span className="lbl">
              <span>
                {eg.ko}의 알 <b>×{eg.count}</b>
              </span>
              <em>
                {companion ? `${companion.nickname ?? companion.name}${josa(companion.nickname ?? companion.name, '은', '는')} 도감으로 떠납니다.` : '바로 품기 시작합니다.'}
              </em>
            </span>
            <button className="px-btn" onClick={() => act('legendegg', String(eg.speciesId))} disabled={busy}>
              품기
            </button>
          </li>
        ))}
      </ul>
      </>
    )}
    </>
    )}

    </>
  );
}
