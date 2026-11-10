import { useEffect, useState } from 'react';
import { bridge, type UpdateStatus } from '../api.ts';

/**
 * The self-updater's one control, above the tabs.
 *
 * One press does everything — download, check, swap, restart — so after
 * 업데이트 the banner only reports; there is nothing left to click. The one
 * exception is a failure, which offers 다시 시도. Electron only: the web build
 * has no bridge, and nothing to update.
 */
export function UpdateBanner() {
  const [u, setU] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    const b = bridge();
    if (!b) return;
    void b.getUpdate().then(setU);
    return b.onUpdate(setU);
  }, []);

  if (!u || u.phase === 'idle') return null;
  const b = bridge();
  const pct = u.total > 0 ? Math.min(100, Math.floor((u.received / u.total) * 100)) : 0;

  return (
    <div className="px-window updatebar" role="status">
      {u.phase === 'available' && (
        <>
          <span className="updatebar-msg">새 버전 v{u.version}이 나왔습니다.</span>
          <span className="updatebar-acts">
            <button className="px-btn" onClick={() => void b?.dismissUpdate()}>
              나중에
            </button>
            <button className="px-btn px-btn--primary" onClick={() => void b?.startUpdate()}>
              {u.canInstall ? '업데이트' : '받으러 가기'}
            </button>
          </span>
        </>
      )}
      {u.phase === 'downloading' && (
        <div className="px-meter updatebar-meter">
          <span className="px-meter-label">v{u.version} 받는 중</span>
          <span className="px-meter-value">{pct}%</span>
          <span className="px-gauge px-gauge--thin" style={{ '--v': pct } as React.CSSProperties}>
            <i />
          </span>
        </div>
      )}
      {u.phase === 'installing' && (
        <span className="updatebar-msg">v{u.version}으로 바꾸고 다시 시작합니다…</span>
      )}
      {u.phase === 'error' && (
        <>
          <span className="updatebar-msg">업데이트하지 못했습니다. {u.message}</span>
          <span className="updatebar-acts">
            <button className="px-btn" onClick={() => void b?.dismissUpdate()}>
              닫기
            </button>
            <button className="px-btn px-btn--primary" onClick={() => void b?.startUpdate()}>
              다시 시도
            </button>
          </span>
        </>
      )}
      {u.phase === 'done' && (
        <>
          <span className="updatebar-msg">v{u.version}으로 업데이트했습니다.</span>
          <span className="updatebar-acts">
            <button className="px-btn" onClick={() => void b?.dismissUpdate()}>
              확인
            </button>
          </span>
        </>
      )}
    </div>
  );
}
