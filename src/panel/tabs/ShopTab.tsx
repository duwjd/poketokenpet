import type { Dispatch, SetStateAction } from 'react';
import { spriteUrl } from '../../api.ts';
import { josa } from '../../josa.ts';
import { CLERK_PX, SHOP_GROUPS, compact, type ShopGroup } from '../labels.ts';
import type { State, Till } from '../types.ts';

type ShopTabProps = {
  state: State;
  busy: boolean;
  shopGroup: ShopGroup | null;
  setShopGroup: Dispatch<SetStateAction<ShopGroup | null>>;
  till: Till;
  setTill: Dispatch<SetStateAction<Till>>;
  buyAsked: (id: string) => Promise<void>;
};

/** 상점: the counter, the clerk, and the shelves. */
export function ShopTab({
  state,
  busy,
  shopGroup,
  setShopGroup,
  till,
  setTill,
  buyAsked,
}: ShopTabProps) {
  /**
   * The product the clerk is asking about, read live rather than captured.
   *
   * `till` holds an id, so a payload that arrives between the question and the
   * answer cannot leave a stale price on screen. A product that vanished takes
   * the question with it.
   */
  const product = (id: string) => state.shop.products.find((p) => p.id === id) ?? null;
  const asked = till.at === 'ask' ? product(till.id) : null;
  /** The row being pointed at, if the clerk is not mid-question. */
  const picked = till.at === 'pick' ? product(till.id) : null;

  /**
   * Point at a row without committing to it.
   *
   * Hover AND focus, because a cursor is not the only way to move down a list —
   * without the focus half, the description would be invisible to the keyboard.
   * Never overrides a question or a parting line: those are the clerk mid-
   * sentence, and a stray mouse crossing the list must not cut her off.
   */
  const point = (id: string | null) =>
    setTill((t) =>
      t.at === 'ask' || t.at === 'said' ? t : id === null ? { at: 'idle' } : { at: 'pick', id },
    );

  /** Whatever the companion is actually called, for the egg warning. */
  const petName = state.companion
    ? (state.companion.nickname ?? state.companion.name)
    : '';

  return (
    <>
    <h2>프렌들리숍</h2>

    {/* The counter, the clerk's window and the shelf chips stay pinned while
        the products scroll under them — the games keep the description on
        the screen that does not scroll, and with forty-odd evolution items
        the window used to scroll away from the row it was describing. */}
    <div className="shophead">
    {/* The frame vars have to be set on a host element — the panel is
        outside .scene, which is the only other place they live. */}
    <div className="mart">
      <p className="mart-money uiplate">
        소지금 <b>{compact(state.shop.wallet)}</b>
      </p>
      {state.shop.clerk && (
        <img
          className="mart-clerk"
          src={spriteUrl(state.shop.clerk)}
          alt=""
          width={CLERK_PX}
          height={CLERK_PX}
        />
      )}
    </div>
    <div className="saywin uiwin" aria-live="polite">
      {asked ? (
        <>
          <span className="saywin-line">
            <span>{asked.name}</span>
            <b>{compact(asked.price)}</b>
          </span>
          {/* The line that makes this more than decoration: an egg trades the
              companion away, and one press used to do it silently. */}
          {asked.kind === 'egg' && state.companion
            ? `지금 ${petName}${josa(petName, '은', '는')} 도감으로 떠납니다. 괜찮으시겠습니까?`
            : '괜찮으시겠습니까?'}
          <span className="saywin-ask">
            <button className="px-btn px-btn--primary" disabled={busy} onClick={() => void buyAsked(asked.id)}>
              예
            </button>
            <button className="px-btn" disabled={busy} onClick={() => setTill({ at: 'idle' })}>
              아니오
            </button>
          </span>
        </>
      ) : till.at === 'said' ? (
        till.line
      ) : picked ? (
        /* Pointing at something. The clerk names it, prices it, describes it —
           which is what the games put on the screen that does not scroll. */
        <>
          <span className="saywin-line">
            <span>{picked.name}</span>
            <b>{picked.owned ? '보유중' : compact(picked.price)}</b>
          </span>
          <span className="saywin-desc">{picked.desc}</span>
        </>
      ) : (
        <>
          어서 오세요! 프렌들리숍입니다.
          <br />
          무엇을 도와드릴까요?
        </>
      )}
    </div>
    {/* Ten products do not fit a 420px panel as one list. The chips are the
        dex filter's idiom reused, but they never collapse — with this few
        rows, hiding them behind a second click would be worse than scrolling. */}
    <div className="px-chips chips shopchips" role="group" aria-label="상점 분류">
      <button className="px-chip px-chip--sm" aria-pressed={shopGroup === null} onClick={() => setShopGroup(null)}>
        전체
      </button>
      {SHOP_GROUPS.map((g) => (
        <button
          key={g.id}
          className="px-chip px-chip--sm" aria-pressed={shopGroup === g.id}
          onClick={() => setShopGroup(g.id)}
        >
          {g.label}
        </button>
      ))}
    </div>
    </div>
    {SHOP_GROUPS.filter((g) => shopGroup === null || shopGroup === g.id).map((g) => {
      // `award` rows ride along on the payload for the bag's sake; the shelf
      // is the one place they must not appear.
      const rows = state.shop.products.filter((p) => p.group === g.id && p.shelved);
      // This companion's own evolution items first; the rest keep their order.
      // Array.prototype.sort is stable, so ties stay where the server put them.
      rows.sort((a, b) => Number(b.usable) - Number(a.usable));
      if (!rows.length) return null;
      return (
        <div key={g.id}>
          {/* The heading is redundant once a single group is chosen. */}
          {shopGroup === null && <h3 className="shelf">{g.label}</h3>}
          <ul className="items">
            {rows.map((p) => {
              const afford = state.shop.wallet >= p.price;
              const on = till.at === 'ask' && till.id === p.id;
              return (
                /* data-rarity colours the left edge, the same idiom the bag uses
                   for TM types — four eggs in a row are otherwise one grey list. */
                <li
                  key={p.id}
                  className={`row${afford && !p.owned ? '' : ' poor'}${on ? ' on' : ''}`}
                  data-rarity={p.rarity ?? undefined}
                >
                  {p.sprite ? (
                    <img className="icon" src={spriteUrl(p.sprite)} alt="" />
                  ) : (
                    /* The four eggs now carry the real egg sprite; only the
                       Dynamax Band still has no icon upstream. */
                    <span className="icon">💠</span>
                  )}
                  {/* The whole row is the button, because a row is what the
                      games let you pick. The accessible name still leads with
                      the product and ends with the price. */}
                  <button
                    className="lbl rowbtn"
                    disabled={busy}
                    aria-pressed={on}
                    onMouseEnter={() => point(p.id)}
                    onMouseLeave={() => point(null)}
                    onFocus={() => point(p.id)}
                    onBlur={() => point(null)}
                    onClick={() =>
                      // An owned one-time item has nothing to ask about. The
                      // clerk says so rather than the row going dead quiet.
                      p.owned
                        ? setTill({ at: 'said', line: `${p.name}${josa(p.name, '은', '는')} 이미 가지고 계십니다.` })
                        : setTill(on ? { at: 'idle' } : { at: 'ask', id: p.id })
                    }
                  >
                    <span>{p.name}</span>
                    {p.usable && <span className="px-badge px-badge--accent">지금 쓸 수 있음</span>}
                    {p.owned ? <span className="badge">보유중</span> : <em>{compact(p.price)}</em>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      );
    })}

    </>
  );
}
