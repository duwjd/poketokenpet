import type { Dispatch, SetStateAction } from 'react';
import { spriteUrl } from '../../api.ts';
import { ENTRYPOINT_LABEL, ITEM_NAMES, compact } from '../labels.ts';
import type { State } from '../types.ts';

type StatsTabProps = {
  state: State;
  tokens: State['tokens'];
  allHunts: boolean;
  setAllHunts: Dispatch<SetStateAction<boolean>>;
};

/** 기록: the hunt log, and token use by surface, by day and by model. */
export function StatsTab({
  state,
  tokens,
  allHunts,
  setAllHunts,
}: StatsTabProps) {
  return (
    <>
    <h2>사냥 기록</h2>
    {state.hunt.log.length === 0 ? (
      <p className="muted sub">아직 조우한 기록이 없습니다.</p>
    ) : (
      <>
        <ul className="hunts">
          {/* Five is enough to see what has been happening; the rest is on
              request, with the move used and any TM that dropped. */}
          {(allHunts ? state.hunt.log : state.hunt.log.slice(0, 5)).map((e) => (
            <li key={e.seq}>
              {/* Before `.who`, which is `flex: 1` — anywhere else and the
                  name column would have to give up its own width. */}
              <span className="icon">
                {e.icon ? <img src={spriteUrl(e.icon)} alt="" /> : '·'}
              </span>
              <span className="who">
                {e.trainer ? e.trainer.name : e.wildName}
                {/* A legendary fight can be lost too, and so can a wild
                    one now. Only a LOSS is marked on a wild row: nine in ten
                    of them are wins, and a 승 on every line is noise. */}
                {!e.trainer && !e.legend && e.won === false && (
                  <em className="how loss"> 패</em>
                )}
                {(e.trainer || e.legend) && (
                  <em className={`how ${(e.trainer?.won ?? e.legend?.won) ? 'win' : 'loss'}`}>
                    {' '}
                    {(e.trainer?.won ?? e.legend?.won) ? '승' : '패'}
                  </em>
                )}
              </span>
              {allHunts && e.trainer?.item && (
                <span className="tm">{ITEM_NAMES[e.trainer.item] ?? e.trainer.item}</span>
              )}
              {allHunts && e.moveName && <span className="tm">{e.moveName}</span>}
              {/* A stone is rarer than a TM, so it shows in the collapsed
                  list too — the five-row default is where it would be missed. */}
              {e.stoneKo && <span className="tm">{e.stoneKo}</span>}
              {allHunts && e.formKo && <span className="tm">{e.formKo}</span>}
              <span className="num">{e.tokens > 0 ? `+${compact(e.tokens)}` : '—'}</span>
            </li>
          ))}
        </ul>
        {state.hunt.log.length > 5 && (
          <p className="muted sub">
            <button className="px-btn px-btn--link" onClick={() => setAllHunts(!allHunts)}>
              {allHunts ? '접기' : `전체 ${state.hunt.log.length}건 보기`}
            </button>
          </p>
        )}
      </>
    )}

    <h2>어디서 썼나</h2>
    <ul className="bars">
      {Object.entries(tokens.byEntrypoint)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => {
          const max = Math.max(...Object.values(tokens.byEntrypoint));
          return (
            <li key={k}>
              <span className="lbl">{ENTRYPOINT_LABEL[k] ?? k}</span>
              <span className="px-gauge px-gauge--thin track" style={{ '--v': (v / max) * 100 } as React.CSSProperties}><i /></span>
              <span className="num">{compact(v)}</span>
            </li>
          );
        })}
    </ul>

    <h2>최근 14일</h2>
    <ul className="bars">
      {Object.entries(tokens.byDay)
        .sort()
        .slice(-14)
        .reverse()
        .map(([d, v], _i, arr) => {
          const max = Math.max(...arr.map(([, x]) => x));
          return (
            <li key={d}>
              <span className="lbl">{d.slice(5)}</span>
              <span className="px-gauge px-gauge--thin track" style={{ '--v': (v / max) * 100 } as React.CSSProperties}><i /></span>
              <span className="num">{compact(v)}</span>
            </li>
          );
        })}
    </ul>

    <h2>모델별</h2>
    <ul className="bars">
      {Object.entries(tokens.byModel)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v], _i, arr) => {
          const max = Math.max(...arr.map(([, x]) => x));
          return (
            <li key={k}>
              <span className="lbl" title={k}>{k.replace('claude-', '')}</span>
              <span className="px-gauge px-gauge--thin track" style={{ '--v': (v / max) * 100 } as React.CSSProperties}><i /></span>
              <span className="num">{compact(v)}</span>
            </li>
          );
        })}
    </ul>
    </>
  );
}
