import type { CSSProperties, ReactNode } from 'react';
import { battleUiVars } from '../battleui.ts';
import { gaugeValue, hpLevel } from '../uikit.ts';

/**
 * The design system on one page: every token, and every component in every
 * state, at the panel's real width. States that need a pointer or a keyboard
 * (hover, pressed, focus) are pinned with `is-*` classes so a screenshot can
 * show them side by side.
 *
 * No Pokemon art: sprites are fetched at runtime and never bundled, so a card
 * here holds a grey placeholder.
 */

const COLORS = [
  ['--ground', '패널 바닥'],
  ['--surface', '창 안쪽'],
  ['--fg', '본문 글자'],
  ['--muted', '보조 글자'],
  ['--line', '구분선'],
  ['--track', '빈 칸·호버'],
  ['--accent', '강조(청록)'],
  ['--on-accent', '강조 위 글자'],
  ['--ink', '틀 잉크'],
  ['--ink-sh', '글자 그림자'],
  ['--gold', '수치 강조'],
  ['--ok', '성공'],
  ['--warn', '주의'],
  ['--err', '오류'],
] as const;

const PAIRS = [
  ['--ok', '--ok-sh'],
  ['--warn', '--warn-sh'],
  ['--err', '--err-sh'],
] as const;

const HP = ['--hp-hi', '--hp-mid', '--hp-lo'] as const;
const RARITY = ['common', 'uncommon', 'rare', 'legendary'] as const;
const RARITY_KO = { common: '흔함', uncommon: '조금 귀함', rare: '귀함', legendary: '전설' } as const;

const TYPES = [
  ['normal', '노말'], ['fire', '불꽃'], ['water', '물'], ['electric', '전기'], ['grass', '풀'], ['ice', '얼음'],
  ['fighting', '격투'], ['poison', '독'], ['ground', '땅'], ['flying', '비행'], ['psychic', '에스퍼'], ['bug', '벌레'],
  ['rock', '바위'], ['ghost', '고스트'], ['dragon', '드래곤'], ['dark', '악'], ['steel', '강철'], ['fairy', '페어리'],
] as const;

const SPACING = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6'] as const;

function Part({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="px-section" id={id}>
      <h2 className="px-section-title">{title}</h2>
      {children}
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className="sp-label">{children}</p>;
}

function Hp({ hp, max }: { hp: number; max: number }) {
  return (
    <div className="px-meter">
      <span className="px-meter-label">HP</span>
      <span className="px-meter-value">
        {hp} / {max}
      </span>
      <div
        className="px-gauge px-gauge--hp"
        data-level={hpLevel(hp, max)}
        role="progressbar"
        aria-valuenow={hp}
        aria-valuemax={max}
        style={{ '--v': gaugeValue(hp, max) } as CSSProperties}
      >
        <i />
      </div>
    </div>
  );
}

export default function Specimen() {
  return (
    <main className="sp" style={battleUiVars() as CSSProperties}>
      <header className="sp-head">
        <h1>디자인 시스템 견본</h1>
        <p>토큰과 컴포넌트의 모든 상태. 규격은 docs/DESIGN-SYSTEM.md.</p>
      </header>

      <Part id="color" title="색">
        <ul className="sp-swatches">
          {COLORS.map(([v, ko]) => (
            <li key={v}>
              <i style={{ background: `var(${v})` }} />
              <code>{v}</code>
              <span>{ko}</span>
            </li>
          ))}
        </ul>
        <Label>의미 색은 본색 + 그림자색 쌍</Label>
        <div className="sp-row">
          {PAIRS.map(([a, b]) => (
            <span key={a} className="sp-pair" style={{ color: `var(${a})`, background: `var(${b})` }}>
              {a.slice(2)}
            </span>
          ))}
        </div>
        <Label>HP · 희귀도</Label>
        <div className="sp-row">
          {HP.map((v) => (
            <i key={v} className="sp-chip" style={{ background: `var(${v})` }} title={v} />
          ))}
          <span className="sp-gap" />
          {RARITY.map((r) => (
            <i key={r} className="sp-chip" style={{ background: `var(--rar-${r})` }} title={r} />
          ))}
        </div>
      </Part>

      <Part id="type" title="글자">
        <p className="sp-type" style={{ font: 'var(--fs-xl) / var(--lh-xl) var(--face-md)' }}>24 갈무리11 ×2</p>
        <p className="sp-type" style={{ font: 'var(--fs-xl) / var(--lh-xl) var(--face-md)', fontWeight: 'var(--font-bold)' as never }}>
          24 굵게
        </p>
        <p className="sp-type" style={{ font: 'var(--fs-md) / var(--lh-md) var(--face-md)' }}>12 갈무리11 — 본문, 목록, 버튼</p>
        <p className="sp-type" style={{ font: 'var(--fs-md) / var(--lh-md) var(--face-md)', fontWeight: 'var(--font-bold)' as never }}>
          12 굵게 — 제목, 이름
        </p>
        <p className="sp-type" style={{ font: 'var(--fs-sm) / var(--lh-sm) var(--face-sm)' }}>10 갈무리9 — 설명, 캡션, 보조 수치</p>
        <p className="sp-type" style={{ font: 'var(--fs-xs) / var(--lh-xs) var(--face-xs)' }}>8 갈무리7 — 고정 라벨 전용 HP Lv</p>
        <p className="px-window sp-inline">글자·그림자·바탕 — 게임 창의 3색 글자</p>
      </Part>

      <Part id="space" title="간격 · 틀">
        <ul className="sp-space">
          {SPACING.map((v) => (
            <li key={v}>
              <code>{v}</code>
              <i style={{ width: `var(${v})` }} />
            </li>
          ))}
        </ul>
        <div className="sp-frames">
          {['panel', 'panel-on', 'btn', 'btn-down', 'btn-primary'].map((f) => (
            <span key={f} className={`sp-frame sp-frame--${f}`}>
              {f}
            </span>
          ))}
          <span className="sp-frame sp-frame--well">gauge</span>
        </div>
      </Part>

      <Part id="button" title="버튼">
        <Label>기본 — 평소 · 호버 · 눌림 · 포커스 · 비활성</Label>
        <div className="sp-row">
          <button className="px-btn">사용</button>
          <button className="px-btn is-hover">사용</button>
          <button className="px-btn is-active">사용</button>
          <button className="px-btn is-focus">사용</button>
          <button className="px-btn" disabled>사용</button>
        </div>
        <Label>주 버튼 — 화면에 하나</Label>
        <div className="sp-row">
          <button className="px-btn px-btn--primary">배우기</button>
          <button className="px-btn px-btn--primary is-hover">배우기</button>
          <button className="px-btn px-btn--primary is-active">배우기</button>
          <button className="px-btn px-btn--primary is-focus">배우기</button>
          <button className="px-btn px-btn--primary" disabled>배우기</button>
        </div>
        <Label>큰 버튼 · 링크</Label>
        <div className="sp-row">
          <button className="px-btn px-btn--lg px-btn--primary">알을 품는다</button>
          <button className="px-btn px-btn--lg">취소</button>
          <button className="px-btn px-btn--link">필터</button>
          <button className="px-btn px-btn--link is-focus">필터</button>
        </div>
      </Part>

      <Part id="chip" title="칩 · 토글 · 탭">
        <div className="px-chips">
          <button className="px-chip" aria-pressed="true">전체</button>
          <button className="px-chip" aria-pressed="false">알</button>
          <button className="px-chip is-hover" aria-pressed="false">성장</button>
          <button className="px-chip is-focus" aria-pressed="false">진화</button>
          <button className="px-chip" aria-pressed="false" disabled>전설</button>
        </div>
        <div className="sp-row sp-mt">
          <button className="px-toggle" role="switch" aria-checked="true">
            <span className="px-toggle-track" />
            켜짐
          </button>
          <button className="px-toggle" role="switch" aria-checked="false">
            <span className="px-toggle-track" />
            꺼짐
          </button>
          <button className="px-toggle is-focus" role="switch" aria-checked="true">
            <span className="px-toggle-track" />
            켜짐
          </button>
        </div>
        <div className="px-tabs sp-mt" role="tablist">
          <button className="px-tab" role="tab" aria-selected="true">파트너</button>
          <button className="px-tab" role="tab" aria-selected="false">기록</button>
          <button className="px-tab" role="tab" aria-selected="false">
            가방<span className="px-dot" />
          </button>
          <button className="px-tab is-hover" role="tab" aria-selected="false">도감</button>
          <button className="px-tab is-focus" role="tab" aria-selected="false">업적</button>
        </div>
      </Part>

      <Part id="row" title="목록 행">
        <ul className="px-list">
          <li>
            <button className="px-row" data-rarity="common">
              <span className="px-row-main">평소 — 흔한 알</span>
              <span className="px-row-side">53.4M</span>
            </button>
          </li>
          <li>
            <button className="px-row is-hover" data-rarity="uncommon">
              <span className="px-row-main">호버 — ▶ 커서가 따라옴</span>
              <span className="px-row-side">106.8M</span>
            </button>
          </li>
          <li>
            <button className="px-row is-selected" data-rarity="rare" aria-current="true">
              <span className="px-row-main">선택 — ▶ + 칠한 틀</span>
              <span className="px-row-side">267.0M</span>
            </button>
          </li>
          <li>
            <button className="px-row is-focus" data-rarity="legendary">
              <span className="px-row-main">포커스 — 안쪽 점선</span>
              <span className="px-row-side">2.14B</span>
            </button>
          </li>
          <li>
            <button className="px-row" disabled>
              <span className="px-row-main">비활성 — 음각 글자</span>
              <span className="px-row-side">400.5M</span>
            </button>
          </li>
          <li>
            <div className="px-row">
              <span className="px-row-main">
                화염방사
                <span className="px-row-sub">불꽃 · 특수 · 위력 90 · PP 15</span>
              </span>
              <button className="px-btn">잊기</button>
            </div>
          </li>
        </ul>
      </Part>

      <Part id="card" title="카드">
        <ul className="px-grid">
          {[
            ['', '평소', '#001'],
            ['is-hover', '호버', '#004'],
            ['is-selected', '선택', '#025'],
            ['is-focus', '포커스', '#133'],
          ].map(([cls, name, num]) => (
            <li key={num}>
              <button className={`px-card ${cls}`}>
                <i className="px-card-art sp-art" />
                <span>{name}</span>
                <span className="px-card-num">{num}</span>
              </button>
            </li>
          ))}
          <li>
            <span className="px-card is-unseen">
              <i className="px-card-art" />
              <span>???</span>
              <span className="px-card-num">#150</span>
            </span>
          </li>
        </ul>
      </Part>

      <Part id="gauge" title="게이지">
        <div className="px-meter">
          <span className="px-meter-label">다음 진화까지</span>
          <span className="px-meter-value">62%</span>
          <div className="px-gauge" role="progressbar" aria-valuenow={62} aria-valuemax={100} style={{ '--v': 62 } as CSSProperties}>
            <i />
          </div>
        </div>
        <div className="sp-stack">
          <Hp hp={120} max={135} />
          <Hp hp={50} max={135} />
          <Hp hp={16} max={135} />
        </div>
      </Part>

      <Part id="window" title="메시지 창">
        <div className="px-window" aria-live="polite">
          어서 오세요! 프렌들리숍입니다.
          <br />
          무엇을 도와드릴까요?
          <span className="px-window-more" aria-hidden="true">▼</span>
        </div>
        <div className="sp-lit px-lit sp-mt">
          <div className="px-window">
            불꽃이의 화염방사!
            <br />
            효과가 굉장했다!
          </div>
        </div>
        <Label>배틀·상점처럼 밝은 그림 위(.px-lit)는 밤에도 낮의 틀</Label>
      </Part>

      <Part id="badge" title="배지 · 타입">
        <div className="sp-row">
          <span className="px-badge">기본</span>
          <span className="px-badge px-badge--accent">NEW</span>
          <span className="px-badge px-badge--ok">달성</span>
          <span className="px-badge px-badge--warn">주의</span>
          <span className="px-badge px-badge--err">실패</span>
        </div>
        <div className="sp-row sp-mt sp-wrap">
          {TYPES.map(([t, ko]) => (
            <span key={t} className="px-type" data-type={t}>
              {ko}
            </span>
          ))}
        </div>
      </Part>

      <Part id="form" title="입력 · 스탯">
        <div className="sp-stack">
          <input className="px-field" placeholder="별명을 지어 주세요" />
          <input className="px-field is-focus" defaultValue="불꽃이" />
          <input className="px-field" defaultValue="바꿀 수 없음" disabled />
        </div>
        <dl className="px-stats sp-mt">
          <dt>단계</dt>
          <dd>3 / 3</dd>
          <dt>희귀도</dt>
          <dd>{RARITY_KO.rare}</dd>
          <dt>함께한 진행도</dt>
          <dd>612.4M</dd>
        </dl>
      </Part>

      <Part id="feedback" title="알림 · 빈 상태">
        <div className="sp-stack">
          <div className="px-banner">토큰 기록을 다시 읽는 중입니다.</div>
          <div className="px-banner px-banner--ok">업적 달성 — 반환점</div>
          <div className="px-banner px-banner--warn">자동사냥이 꺼져 있습니다.</div>
          <div className="px-banner px-banner--err">기록을 읽지 못했습니다.</div>
          <div className="px-toast sp-static">이상한사탕을 썼습니다. Lv.24!</div>
          <div className="px-empty">
            <b>아직 아무것도 없습니다</b>
            사냥을 켜 두면 여기에 기록이 쌓입니다.
          </div>
        </div>
      </Part>
    </main>
  );
}
