import { useEffect, useState } from 'react';
import { bridge, type Prefs } from '../api.ts';
import { Toggle } from './Toggle.tsx';

/** Desktop-pet controls. Only rendered inside Electron. */
export function PetSettings() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [sizes, setSizes] = useState<number[]>([]);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    const b = bridge();
    if (!b) return;
    void b.getPrefs().then(setPrefs);
    void b.sizes().then(setSizes);
    void b.version().then(setVersion);
    return b.onPrefs((p) => setPrefs(p as Prefs));
  }, []);

  if (!prefs) return null;
  const set = (patch: Partial<Prefs>) => {
    setPrefs({ ...prefs, ...patch });
    void bridge()?.setPrefs(patch);
  };

  return (
    <>
      <h2>데스크탑 펫</h2>
      <ul className="items">
        <li>
          <span className="lbl">
            화면에 표시
            <em>바탕화면 위에 항상 떠 있습니다. 드래그로 이동, 휠로 크기 조절.</em>
          </span>
          <Toggle
            label="화면에 표시"
            on={prefs.petEnabled}
            word={prefs.petEnabled ? '켜짐' : '꺼짐'}
            onClick={() => set({ petEnabled: !prefs.petEnabled })}
          />
        </li>
        <li>
          <span className="lbl">항상 위에</span>
          <Toggle
            label="항상 위에"
            on={prefs.petAlwaysOnTop}
            word={prefs.petAlwaysOnTop ? '켜짐' : '꺼짐'}
            onClick={() => set({ petAlwaysOnTop: !prefs.petAlwaysOnTop })}
          />
        </li>
        <li>
          <span className="lbl">
            클릭 통과
            <em>켜면 펫이 마우스를 받지 않아 뒤쪽 창을 그대로 클릭할 수 있습니다.</em>
          </span>
          <Toggle
            label="클릭 통과"
            on={prefs.petClickThrough}
            word={prefs.petClickThrough ? '켜짐' : '꺼짐'}
            onClick={() => set({ petClickThrough: !prefs.petClickThrough })}
          />
        </li>
        <li>
          <span className="lbl">크기</span>
          <span className="sizes">
            {sizes.map((s) => (
              <button
                key={s}
                className="px-chip"
                aria-pressed={prefs.petSize === s}
                onClick={() => set({ petSize: s })}
              >
                {s}
              </button>
            ))}
          </span>
        </li>
        <li>
          <span className="lbl">로그인 시 자동 실행</span>
          <Toggle
            label="로그인 시 자동 실행"
            on={prefs.openAtLogin}
            word={prefs.openAtLogin ? '켜짐' : '꺼짐'}
            onClick={() => set({ openAtLogin: !prefs.openAtLogin })}
          />
        </li>
        <li>
          <span className="lbl">펫 위치 초기화</span>
          <button className="px-btn" onClick={() => set({ petX: null, petY: null })}>초기화</button>
        </li>
      </ul>

      <h2>업데이트</h2>
      <ul className="items">
        <li>
          <span className="lbl">
            새 버전 확인
            <em>
              켜 두면 GitHub에 새 버전이 있는지 가끔 물어보고, 있으면 위에 업데이트 버튼을
              띄웁니다. 보내는 것은 없고 묻기만 합니다.
            </em>
          </span>
          <Toggle
            label="새 버전 확인"
            on={prefs.checkUpdates}
            word={prefs.checkUpdates ? '켜짐' : '꺼짐'}
            onClick={() => set({ checkUpdates: !prefs.checkUpdates })}
          />
        </li>
        {version && (
          <li>
            <span className="lbl">지금 버전</span>
            <span className="num">v{version}</span>
          </li>
        )}
      </ul>
    </>
  );
}
