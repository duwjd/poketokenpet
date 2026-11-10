import { isElectron, type PetActionKind } from '../../api.ts';
import { PetSettings } from '../PetSettings.tsx';
import { Toggle } from '../Toggle.tsx';
import { compact } from '../labels.ts';
import type { State } from '../types.ts';

type SettingsTabProps = {
  state: State;
  tokens: State['tokens'];
  busy: boolean;
  act: (action: PetActionKind, id: string, slot?: number | null) => Promise<void>;
};

/** 설정: the hunt switches, the desktop pet, the sprite cache and the notice. */
export function SettingsTab({
  state,
  tokens,
  busy,
  act,
}: SettingsTabProps) {
  return (
    <>
    {/*
      * The hunt settings, which used to sit at the bottom of the bag.
      *
      * They were always settings — the comment above them said so — and a
      * control belongs where its subject is, which is the rule the battle-form
      * toggle on 파트너 and the move slots both follow. The hunt's subject is
      * not the bag.
      *
      * DELIBERATELY OUTSIDE the isElectron() branch below. These two go
      * through /api/shop to state.json and work on the web build; PetSettings
      * writes prefs.json over the Electron bridge and renders nothing without
      * it. Folding them in would make them vanish in the browser — see the
      * note on setShowBattleForm in server/game.ts for why huntEnabled lives
      * in GameState rather than in Prefs to begin with.
      */}
    <h2>자동사냥</h2>
    <ul className="items">
      <li>
        <span className="lbl">
          자동사냥
          <em>5분마다 포켓몬과 싸워 게이지를 조금씩 올립니다.</em>
        </span>
        <Toggle
          label="자동사냥"
          on={state.hunt.enabled}
          word={state.hunt.enabled ? '켜짐' : '꺼짐'}
          disabled={busy}
          onClick={() => act('hunt', state.hunt.enabled ? 'off' : 'on')}
        />
      </li>
      <li>
        <span className="lbl">
          사냥 상한
          <em>
            사냥이 평생 기여할 수 있는 총량을 번 토큰의 25%로 묶습니다. 켜두기만 한 기계가
            혼자 도감을 채우지 않게 하는 장치이고, 누적이라 한 번 차면 코딩으로 번 토큰이
            늘기 전까지 풀리지 않습니다.
          </em>
        </span>
        {/* The label names the CAP's state and the id names what to do to it:
            `적용 중` sends 'off', which lifts it. Reads backwards, is right. */}
        <Toggle
          label="사냥 상한"
          on={!state.hunt.uncapped}
          word={state.hunt.uncapped ? '해제됨' : '적용 중'}
          disabled={busy}
          onClick={() => act('huntcap', state.hunt.uncapped ? 'on' : 'off')}
        />
      </li>
      <li>
        <span className="lbl">
          승부 확인
          <em>
            관장과 포켓몬리그는 물어본 뒤에 싸웁니다. 끄면 자리를 비운 동안에도 알아서
            싸우는데, 그러면 배지가 걸린 승부를 볼 수 없습니다. 재대결은 어느 쪽이든 알아서
            합니다.
          </em>
        </span>
        <Toggle
          label="승부 확인"
          on={state.hunt.asking}
          word={state.hunt.asking ? '물어봄' : '자동'}
          disabled={busy}
          onClick={() => act('askchallenge', state.hunt.asking ? 'off' : 'on')}
        />
      </li>
    </ul>

    {isElectron() ? (
      <PetSettings />
    ) : (
      <p className="muted sub">데스크탑 앱에서 열면 펫 설정이 여기 표시됩니다.</p>
    )}

    <h2>스프라이트 캐시</h2>
    <ul className="items">
      <li>
        <span className="lbl">
          {(state.sprites.bytes / 1024 / 1024).toFixed(1)}MB · {state.sprites.files}개
          <em>
            배틀 화면에 나온 포켓몬이 쌓입니다. 지워도 필요할 때 다시 받습니다.
          </em>
        </span>
        <button className="px-btn" disabled={busy} onClick={() => act('sprites', 'clear')}>
          정리
        </button>
      </li>
    </ul>

    <h2>정보</h2>
    <ul className="bars info">
      <li><span className="lbl">부화 임계값</span><span className="num">{compact(state.hatchThreshold)}</span></li>
      <li><span className="lbl">집계 방식</span><span className="num">{tokens.mode === 'activity' ? '활동량' : '과금 근사'}</span></li>
      <li><span className="lbl">고유 메시지</span><span className="num">{tokens.messageCount.toLocaleString()}</span></li>
      <li><span className="lbl">마지막 갱신</span><span className="num">{new Date(state.generatedAt).toLocaleTimeString('ko-KR')}</span></li>
    </ul>

    {/*
      * The one thing on screen that is not about the game.
      *
      * The attribution table in NOTICE.md says there is no credits screen, and that
      * stays true — every committed asset is CC0 or OFL and owes no
      * attribution. This is a different obligation: the app is a fan work
      * being handed to strangers, and a non-affiliation notice is the thing
      * a fan work owes whether or not any asset asks for a credit line.
      *
      * Deliberately plain text and not a link. There is not one anchor
      * anywhere else in this app, and an <a> inside Electron opens in the
      * BrowserWindow itself unless someone remembers to intercept it — a
      * trapdoor out of a 320px panel with no back button. The filename is
      * enough for anyone who wants the full text.
      */}
    <p className="muted sub">
      비공식 팬 프로젝트입니다. 닌텐도 · 크리처스 · 게임프리크 · 주식회사 포켓몬,
      그리고 Anthropic 과 아무 제휴 관계가 없습니다. 포켓몬은 그들의 상표이자
      저작물이며, 이 앱은 포켓몬 이미지를 포함하지 않고 실행 중에 이 기기로
      내려받아 캐시할 뿐입니다.
      <span className="note">
        코드는 MIT. 전체 고지와 에셋 출처는 저장소의 NOTICE.md에 있습니다.
      </span>
    </p>
    </>
  );
}
