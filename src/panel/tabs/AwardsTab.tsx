import type { Dispatch, SetStateAction } from 'react';
import { spriteUrl } from '../../api.ts';
import { DexSprite } from '../DexSprite.tsx';
import { REGION_VIEW, compact } from '../labels.ts';
import type { State } from '../types.ts';

type AwardsTabProps = {
  state: State;
  awardCat: string | null;
  setAwardCat: Dispatch<SetStateAction<string | null>>;
  badgeRegion: string | null;
  setBadgeRegion: Dispatch<SetStateAction<string | null>>;
  hideDone: boolean;
  setHideDone: Dispatch<SetStateAction<boolean>>;
  showAwardCats: boolean;
  setShowAwardCats: Dispatch<SetStateAction<boolean>>;
  showAwards: (cat: string | null) => void;
  awardsDone: number;
};

/** 업적: the campaign by region, or the achievement list. */
export function AwardsTab({
  state,
  awardCat,
  setAwardCat,
  badgeRegion,
  setBadgeRegion,
  hideDone,
  setHideDone,
  showAwardCats,
  setShowAwardCats,
  showAwards,
  awardsDone,
}: AwardsTabProps) {
  /**
   * The region whose case is on screen, and its ladder.
   *
   * Falls back to `badges.now` when nothing has been picked, and to the first
   * row if a stale selection names a region the payload no longer carries —
   * which happens exactly once, when a region's table is added and the ids
   * shift under a tab left open.
   */
  const badgeReg =
    state.badges.regions.find((r) => r.key === (badgeRegion ?? state.badges.now)) ??
    state.badges.regions[0];
  const badgeCases = state.badges.cases.filter((b) => b.region === badgeReg?.key);
  const badgeLeague =
    state.badges.leagues.find((l) => l.region === badgeReg?.key) ?? null;

  /** True while the campaign is on screen instead of the achievement list. */
  const regionView = awardCat === REGION_VIEW;
  /**
   * The campaign's own totals, for the summary line.
   *
   * Every region's badges rather than the selected one's, and the count of
   * regions whose Hall of Fame carries a date — which is the record this tab
   * had no way to show. `clearedAt` has been in the payload since the ladder
   * went region-keyed; nothing read it.
   */
  const badgesHeld = state.badges.regions.reduce((n, r) => n + r.count, 0);
  const badgesAll = state.badges.regions.reduce((n, r) => n + r.total, 0);
  const regionsCleared = state.badges.regions.filter((r) => r.clearedAt !== null).length;

  const awardPct = state.awards.length
    ? Math.max(awardsDone ? 1 : 0, (awardsDone / state.awards.length) * 100)
    : 0;
  /** The categories, in table order, deduped — so adding one needs no edit here. */
  const awardCats = state.awards.reduce<{ cat: string; catKo: string }[]>((acc, a) => {
    if (!acc.some((c) => c.cat === a.cat)) acc.push({ cat: a.cat, catKo: a.catKo });
    return acc;
  }, []);
  const shownAwards = state.awards.filter(
    (a) =>
      (awardCat === null || a.cat === awardCat) &&
      !(hideDone && a.at !== null && a.repeat === null),
  );

  return (
    <>
    <div className="dexbar">
      <h2>업적</h2>
      {/* Two links, in the place and the control the dex puts its filter
          toggle in — and in `.dexlinks`, which was written for exactly "two
          links in one header bar" and then went unused when the dex's legend
          board moved to the chips row.

          Both are off on the campaign. Neither does anything there: it has
          no finished rows to fold and no categories to pick, and a control
          that changes nothing on screen is worse than an absent one. */}
      {!regionView && (
        <div className="dexlinks">
          {/* The category picker, folded. The suffix carries the CHOSEN
              category rather than a count: the dex writes `필터 (2)` because
              three axes can be active at once, and here exactly one can, so
              a "1" would say nothing. Dropped while the panel is open,
              because the lit chip two lines below already says it. */}
          {awardCats.length > 1 && (
            <button className="px-btn px-btn--link" onClick={() => setShowAwardCats(!showAwardCats)}>
              {showAwardCats ? '분야 닫기' : '분야'}
              {!showAwardCats &&
                awardCat !== null &&
                ` (${awardCats.find((c) => c.cat === awardCat)?.catKo})`}
            </button>
          )}
          <button className="px-btn px-btn--link" onClick={() => setHideDone(!hideDone)}>
            {hideDone ? '전부 보기' : '달성 숨기기'}
          </button>
        </div>
      )}
    </div>
    {/* The summary follows the VIEW, not the tab.
 
        One line and one gauge either way, in the same place. The alternative
        — a fixed achievement count above a campaign board — has the header
        and the body describing different things, which is how a reader ends
        up trusting neither. */}
    <p className="sub">
      {regionView ? (
        <>
          <b>{badgesHeld}</b>
          <span className="muted">개 / {badgesAll}개 배지</span>
          <span className="muted"> · 명예의 전당 </span>
          <b>{regionsCleared}</b>
          <span className="muted"> / {state.badges.regions.length}</span>
        </>
      ) : (
        <>
          <b>{awardsDone}</b>
          <span className="muted">개 / {state.awards.length}개 달성</span>
        </>
      )}
    </p>
    {/* Same gauge as the dex counter, floored the same way: one out of fifty
        rounds to 2%, but a board with nothing on it should read as empty
        rather than as a sliver.

        Off on the campaign, where the region list below carries nine gauges
        of its own and this would be a tenth saying the sum of them. The
        count stays, because the sum is the one thing the list does not
        show. */}
    {!regionView && (
      <div className="px-gauge" role="progressbar" aria-valuenow={awardPct} aria-valuemax={100} style={{ '--v': awardPct } as React.CSSProperties}>
        <i />
      </div>
    )}

    {/* The view switch — two buttons, and the tab's whole shape.
 
        It was twelve: 지방, 전체 and ten categories, wrapping to three lines
        at 420px, with nine region chips under it. That is a MODE and a FILTER
        sharing one row, which is why it read as clutter rather than as a
        control. Apple's guidance puts a segmented control at five to seven;
        Material's puts chips at one row and calls two "harder to scan".
 
        So the mode is here, in the same `.chips shopchips` row the dex, the
        bag and the shop already use for "which board am I looking at", and
        the categories moved behind a fold. Two buttons, one line, never
        wraps, and it does not grow when a category or a region lands.
 
        지방 is first and is the default. `업적` must call `showAwards`, not
        `setAwardCat`: that is the path that puts the tab's dot out, and
        pressing it IS reading the list. */}
    <div className="px-chips chips shopchips" role="group" aria-label="업적 화면">
      <button className="px-chip px-chip--sm" aria-pressed={regionView} onClick={() => setAwardCat(REGION_VIEW)}>
        지방
      </button>
      <button className="px-chip px-chip--sm" aria-pressed={!regionView} onClick={() => showAwards(null)}>
        업적
      </button>
    </div>

    {/* The categories, folded — the dex's filter panel, verbatim.
 
        No `<section><h3>분야</h3>` inside it, which is where this departs
        from the dex: that panel holds three groups and names each one, and a
        lone heading repeating the toggle's own word is a stutter. The group's
        `aria-label` carries the name instead. */}
    {!regionView && showAwardCats && (
      <div className="filters">
        <div className="px-chips chips awardcats" role="group" aria-label="업적 분야">
          <button className="px-chip px-chip--sm" aria-pressed={awardCat === null} onClick={() => showAwards(null)}>
            전체
          </button>
          {awardCats.map((c) => (
            <button
              key={c.cat}
              className="px-chip px-chip--sm" aria-pressed={awardCat === c.cat}
              onClick={() => showAwards(c.cat)}
            >
              {c.catKo}
            </button>
          ))}
        </div>
      </div>
    )}

    {/* The campaign, shown when 지방 is the lit chip.

        It was the top of the tab and is now one of two halves. Nothing
        inside changed shape: the case is still one region at a time, the
        ladder still appears only once it is reachable, and the tab's height
        still does not grow with the roster. What changed is that the reader
        arrives here by choosing it, and the seven screens of achievements
        are not underneath. */}
    {regionView && (
      <>
      {/* The badge case.

          Above the category chips rather than below the board, so the tab
          reads "here is what you hold, here is what you are working toward".
          Borrowed wholesale from the dex grid — four across, two down, the
          same card, the same dashed edge for a slot not yet filled — because
          that is already what a badge case looks like in the games, and a
          second grid idiom in one panel would be one too many. */}
      {/* The region board — nine lines, not nine chips.

          It WAS nine chips, and at 420px they wrapped to two rows where the
          only thing each could carry was three characters of state. Two
          wrapped rows of chips is the shape Material calls "harder to scan",
          and a chip is a filter's shape anyway: this is a list of nine
          comparable things, and a list is what it should look like.

          So it borrows `.bars` — the label, gauge and figure line the 기록
          tab's token bars use — and the whole line is the target, which is
          the argument `.items .rowbtn` already makes: the games let you pick
          a LINE, not a control at the end of one.

          What the shape buys: nine gauges in a column can be compared at a
          glance, where nine chips in two ragged rows cannot, and the star no
          longer has to REPLACE the count. On a chip `8/8 ★` did not fit and
          the star stood in for the eight; on a line both fit and both are
          true. This is still the only place the tab shows the campaign
          across regions — `clearedAt` has been in the payload since the
          ladder went region-keyed.

          Rendered ONLY when there is more than one region, so a save with one
          gym table sees exactly the tab it saw before. Same rule `awardCats`
          follows: adding a region needs no edit here.

          `aria-label` says 지방 선택 rather than 지방, because the view chip
          above is already called 지방 and hearing "지방, 버튼" then "지방,
          그룹" is a coin toss. */}
      {state.badges.regions.length > 1 && (
        <ul className="bars regionlist" aria-label="지방 선택">
          {state.badges.regions.map((r) => (
            <li key={r.key} className={r.key === badgeReg?.key ? 'on' : ''}>
              <button
                className="rowbtn"
                aria-current={r.key === badgeReg?.key ? true : undefined}
                /* The spoken form says what the star means, because a lone ★
                   read aloud is "black star" and nothing else. */
                aria-label={
                  r.clearedAt !== null
                    ? `${r.ko} 제패`
                    : `${r.ko} 배지 ${r.count} / ${r.total}`
                }
                onClick={() => setBadgeRegion(r.key)}
              >
                <span className="lbl">{r.ko}</span>
                <span className="px-gauge px-gauge--thin track" style={{ '--v': (r.count / r.total) * 100 } as React.CSSProperties}>
                  <i />
                </span>
                <span className="num">
                  {r.count}/{r.total}
                  {r.clearedAt !== null && <i className="mark">★</i>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* `badgeshelf`, not `awardshelf`: the board's group headings come and
          go with the category chips and this one never does, so sharing a
          class would make "the headings are gone" untestable. */}
      <h3 className="shelf badgeshelf">
        {state.badges.regions.length > 1 ? `${badgeReg?.ko ?? ''} 배지` : '배지'}{' '}
        <span className="muted">{badgeReg?.count ?? 0} / {badgeReg?.total ?? 0}</span>
      </h3>
      <ul className="dex badgecase">
        {badgeCases.map((b) => (
          <li key={b.no} className={b.have ? '' : 'unseen'}>
            <span className="card">
              <span className="art">
                {b.sprite ? <img src={spriteUrl(b.sprite)} alt="" /> : '🔒'}
              </span>
              <span className="nm">{b.have ? b.ko : b.cityKo}</span>
              {/* One line that changes with the state, so a locked slot is
                  never a blank that leaves the reader guessing. */}
              <span className="no">
                {b.have
                  ? (b.prizeKo ?? b.leaderKo)
                  : b.locked
                    ? `배지 ${Math.max(0, (badgeReg?.total ?? 1) - 1)}개 필요`
                    : b.until === 0
                      ? '지금 여기'
                      : `${compact(b.until)}조우`}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {(badgeReg?.count ?? 0) === 0 && (
        <p className="muted sub note">
          여정이 {badgeReg?.ko}의 체육관 도시를 지날 때 관장이 승부를 걸어옵니다. 도전을 받아
          이기면 배지와 그 관장의 기술머신을 받습니다.
        </p>
      )}

      {/* The summit.
 
          The HEADING and the sentence are unconditional, because a badge
          requirement nobody can see is a requirement nobody works toward. The
          PORTRAITS are not: five faces tell a player with two badges nothing
          they can act on, and at nine regions they would be the largest block
          on the tab. They arrive once the ladder is reachable, or once it has
          been walked even part of the way. */}
      {badgeLeague ? (
        <>
          <h3 className="shelf badgeshelf">
            {badgeLeague.kindKo === '챔피언컵' ? '챔피언컵' : '포켓몬리그'}
            {badgeLeague.wins > 0 && (
              <span className="muted"> {badgeLeague.wins}회 제패</span>
            )}
          </h3>
          {(badgeLeague.open || badgeLeague.best > 0 || badgeLeague.wins > 0) && (
            <ul className="dex leagueline">
              {badgeLeague.members.map((m, i) => (
                <li key={m.id} className={m.down || badgeLeague.wins > 0 ? '' : 'unseen'}>
                  <span className="card">
                    <span className="art">
                      {m.sprite ? <DexSprite name={m.sprite} alt="" /> : '?'}
                    </span>
                    <span className="nm">
                      {m.ko.replace('사천왕 ', '').replace('챔피언 ', '')}
                    </span>
                    {/* Positional on the LAST row, not on index 4: 가라르's
                        Champion Cup and 알로라's ladder are not four-plus-one,
                        and `RegionRow.league`'s contract is that the champion
                        is last. */}
                    <span className="no">
                      {i === badgeLeague.members.length - 1
                        ? '챔피언'
                        : `${badgeLeague.kindKo} ${i + 1}`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="muted sub note">
            {!badgeLeague.open
              ? `배지 ${badgeReg?.total ?? 0}개를 모으면 ${badgeLeague.cityKo}에서 도전할 수 있습니다.`
              : !state.party.ready
                ? `도감에서 파티 ${state.party.size}마리를 짜야 도전할 수 있습니다.`
                : badgeLeague.at !== null
                  ? `도전 중 — ${badgeLeague.at} / ${badgeLeague.size}명 격파.`
                  : badgeLeague.until === 0
                    ? `${badgeLeague.cityKo}에 있습니다. 도전을 받으면 시작됩니다.`
                    : `${badgeLeague.cityKo}까지 ${compact(badgeLeague.until)}조우.`}
            {badgeLeague.best > 0 && badgeLeague.wins === 0 && (
              <> 최고 기록 {badgeLeague.best} / {badgeLeague.size}명.</>
            )}
          </p>
        </>
      ) : (
        <p className="muted sub note">
          {/* Two different facts, and saying the wrong one would be a lie. The
              payload lists a region's ladder only once it has rows, so a region
              that HAS a league whose roster is not transcribed yet has to say
              so rather than claim there is none. `leagueCity` is what tells
              them apart, which keeps this line from ever naming a region. */}
          {badgeReg?.leagueCity
            ? `${badgeReg.ko}의 ${badgeReg.leagueCity} 명단은 아직 들어오지 않았습니다.`
            : `${badgeReg?.ko}에는 포켓몬리그가 없습니다.`}
        </p>
      )}
      </>
    )}

    {/* The trainer rows are the one place the board cannot look backwards,
        and saying so is better than letting someone with a thousand hunts
        wonder why their wins read zero. */}
    {(awardCat === null || awardCat === 'trainer') &&
      (state.awards.find((a) => a.cat === 'trainer')?.have ?? 0) === 0 && (
      <p className="muted sub">트레이너 승수는 이 업데이트부터 셉니다. 이전 승부는 기록이 남아 있지 않습니다.</p>
    )}

    {/* Grouped exactly the way the shop shelves are: filter the CATEGORY
        list, not the rows, drop a group that came out empty, and hide the
        heading once a single category has been chosen — at that point the
        chip above already says which one it is. */}
    {awardCats
      .filter((c) => awardCat === null || awardCat === c.cat)
      .map((c) => {
        const rows = shownAwards.filter((a) => a.cat === c.cat);
        if (!rows.length) return null;
        const done = state.awards.filter((a) => a.cat === c.cat && a.at !== null).length;
        const total = state.awards.filter((a) => a.cat === c.cat).length;
        return (
          <div key={c.cat}>
            {/* The count rides on the heading rather than on the chip: a chip
                carrying "3 / 7" turns ten chips into three rows of them. */}
            {awardCat === null && (
              <h3 className="shelf awardshelf">
                {c.catKo} <span className="muted">{done} / {total}</span>
              </h3>
            )}
            {/* Deliberately not `.items li.row`: that class means "pressable"
                and reserves the ▶ gutter to say so. This is something to read. */}
            <ul className="items awards">
              {rows.map((a) => {
                const got = a.at !== null;
                const times = a.repeat ? a.times : 0;
                /* A repeating row is never done and never locked either — it
                   is always partway to its next tier — so it keeps its gauge
                   and never wears `.empty`, whatever the count says. */
                const lit = got || a.repeat !== null;
                return (
                  <li key={a.id} className={lit ? '' : 'empty'}>
                    <span className="icon">
                      {a.repeat ? (
                        '🔁'
                      ) : got && a.itemSprite ? (
                        <img src={spriteUrl(a.itemSprite)} alt="" />
                      ) : (
                        (got ? '🏅' : '🔒')
                      )}
                    </span>
                    <span className="lbl">
                      <span className="awardtop">
                        <span>{a.ko}</span>
                        {/* What it paid, once it has. What is left, until then. */}
                        {times > 0 ? (
                          <em className="got">
                            {times}회 · +{compact(a.money * times)}
                          </em>
                        ) : got ? (
                          <em className="got">
                            +{compact(a.money)}
                            {a.itemKo ? ` · ${a.itemKo}` : ''}
                          </em>
                        ) : (
                          <em className="num">
                            {compact(Math.min(a.have, a.need))} / {compact(a.need)}
                          </em>
                        )}
                      </span>
                      <em>
                        {a.desc}
                        {a.repeat ? ` 다음 ${compact(a.need)}` : ''}
                        {!got && !a.repeat && a.itemKo ? ` 보상: ${a.itemKo}` : ''}
                      </em>
                      {/* The gauge stays on a repeating row for ever; it is
                          measuring the tier, not the whole thing. */}
                      {(!got || a.repeat) && (
                        <span className="px-gauge px-gauge--thin track" aria-hidden="true" style={{ '--v': a.ratio * 100 } as React.CSSProperties}>
                          <i />
                        </span>
                      )}
                    </span>
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
