import { useState } from 'react';
import { bridge, type ShopReply } from '../api.ts';

/**
 * Taking a save to another machine, and getting one back.
 *
 * Electron only — both ends are native file dialogs in the main process, and
 * the settings tab only mounts this inside its isElectron() branch. The
 * answer is said here, under the two buttons, rather than in the panel's
 * flash toast: the dialogs take focus away and back, and a line that faded
 * while the person was still in Finder would never have been seen.
 *
 * Cancelling either dialog says nothing. It is not an outcome.
 */
export function SaveSettings() {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<ShopReply | null>(null);

  const run = async (which: 'exportSave' | 'importSave') => {
    const b = bridge();
    if (!b || busy) return;
    setBusy(true);
    setSaid(null);
    try {
      const out = await b[which]();
      if (out) setSaid(out);
    } catch {
      setSaid({ ok: false, message: '파일을 다루지 못했습니다.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2>저장 파일</h2>
      <ul className="items">
        <li>
          <span className="lbl">
            내보내기
            <em>포켓몬·도감·배지·가방을 파일 하나로 저장합니다. 다른 컴퓨터로 옮기거나 따로 보관할 때 씁니다.</em>
          </span>
          <button className="px-btn" disabled={busy} onClick={() => void run('exportSave')}>
            내보내기
          </button>
        </li>
        <li>
          <span className="lbl">
            불러오기
            <em>
              내보낸 파일이나 자동 백업으로 지금 상태를 바꿉니다. 업데이트와 불러오기 직전 상태는
              자동으로 백업됩니다.
            </em>
          </span>
          <button className="px-btn" disabled={busy} onClick={() => void run('importSave')}>
            불러오기
          </button>
        </li>
      </ul>
      {said && (
        <p className={said.ok ? 'muted sub' : 'err'} role="status">
          {said.message}
        </p>
      )}
    </>
  );
}
