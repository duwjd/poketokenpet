import { useEffect, useRef, useState } from 'react';
import { bridge, fetchState, spriteUrl, type Prefs } from './api.ts';
import { battleUiVars } from './battleui.ts';
import { fitScale, petWindow } from './pixelFit.ts';
import { measureSprite } from './spriteBox.ts';
import './PetApp.css';

type PetState = {
  companion: { name: string; sprite: string | null; isShiny: boolean } | null;
  eggSprite: string | null;
  progress: { ratio: number; phase: string };
  tokens: { today: number };
  hunt: {
    idleReason: 'off' | 'everstone' | 'egg' | null;
    log: { seq: number; wildName: string }[];
  };
};

const compact = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : String(n);

/** How long the "!" and the startle shake stay up after a new encounter. */
const STARTLE_MS = 2200;

/**
 * The always-on-top desktop pet.
 *
 * The window itself is transparent and non-resizable — Windows breaks
 * transparency on resizable windows — so size changes go through the main
 * process, and dragging is reported as deltas rather than using
 * -webkit-app-region, which misbehaves alongside setIgnoreMouseEvents.
 */
export default function PetApp() {
  const [state, setState] = useState<PetState | null>(null);
  const [size, setSize] = useState(128);
  const [hover, setHover] = useState(false);
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const b = bridge();
    let alive = true;
    fetchState<PetState>().then((s) => alive && setState(s)).catch(() => {});
    const off = b?.onState((s) => alive && setState(s as PetState));
    // Electron pushes state over IPC; only the browser build has to poll. The
    // pet window is never hidden, so there is nothing to pause here.
    const h = b ? null : setInterval(() => fetchState<PetState>().then(setState).catch(() => {}), 5000);
    return () => {
      alive = false;
      off?.();
      if (h) clearInterval(h);
    };
  }, []);

  // The requested size drives the zoom step, so the sprite has to re-fit when
  // it changes — the window size is derived from the art, not set directly.
  useEffect(() => {
    const b = bridge();
    if (!b) return;
    let alive = true;
    b.getPrefs()
      .then((p) => alive && setSize(p.petSize))
      .catch(() => {});
    return b.onPrefs((p) => alive && setSize((p as Prefs).petSize));
  }, []);

  /**
   * Newest encounter already reacted to.
   *
   * Armed silently on the first payload, like the panel's scene does — a launch
   * should not open with a startle over a battle that happened hours ago.
   */
  const seenSeq = useRef<number | null>(null);
  const [startled, setStartled] = useState<string | null>(null);
  const newest = state?.hunt?.log?.[0] ?? null;
  const newestSeq = newest?.seq ?? null;
  const newestName = newest?.wildName ?? null;

  useEffect(() => {
    if (newestSeq === null) return;
    if (seenSeq.current === null) {
      seenSeq.current = newestSeq; // arm only
      return;
    }
    if (newestSeq <= seenSeq.current) return;
    seenSeq.current = newestSeq;
    setStartled(newestName);
    const t = setTimeout(() => setStartled(null), STARTLE_MS);
    return () => clearTimeout(t);
  }, [newestSeq, newestName]);

  // Tell main when the cursor is over the sprite so the window can take the
  // pointer back while staying click-through everywhere else.
  useEffect(() => {
    bridge()?.setInteractive(hover || dragging.current);
  }, [hover]);

  const onDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragging.current = true;
    last.current = { x: e.screenX, y: e.screenY };
    e.preventDefault();
  };

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = e.screenX - last.current.x;
      const dy = e.screenY - last.current.y;
      if (dx || dy) {
        last.current = { x: e.screenX, y: e.screenY };
        bridge()?.drag(dx, dy);
      }
    };
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      bridge()?.dragEnd();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  // Wheel over the pet resizes it, which is the gesture people reach for first.
  const onWheel = (e: React.WheelEvent) => {
    bridge()?.stepSize(e.deltaY < 0 ? 1 : -1);
  };

  if (!state) return <div className="pet-root" />;

  const sprite = state.companion?.sprite ?? state.eggSprite;
  const isEgg = !state.companion;
  const pct = Math.round(state.progress.ratio * 100);

  return (
    <div className="pet-root" style={battleUiVars() as React.CSSProperties}>
      {/* The mouse target is the sprite, not the window. The window is created
          larger than any sprite needs (see MAX_PET_WINDOW) and only shrinks if
          the platform honours the resize, so binding these to the window would
          leave a big invisible area that swallows clicks meant for the desktop. */}
      <div
        className={`pet-anchor${startled ? ' startled' : ''}`}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onMouseDown={onDown}
        onWheel={onWheel}
        onDoubleClick={() => bridge()?.openPopover()}
        title="드래그해서 이동 · 휠로 크기 조절 · 더블클릭으로 창 열기"
      >
        {/* key: a new species has a different canvas, so start measuring afresh. */}
        {startled && <span className="pet-bang" aria-label={`${startled} 조우`} />}
        {sprite && (
          <Sprite key={sprite} name={sprite} isEgg={isEgg} ratio={state.progress.ratio} size={size} />
        )}
        {hover && (
          <div className="pet-hud">
            <b>{state.companion?.name ?? '알'}</b>
            <span>
              {pct}% · {compact(state.tokens.today)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function Sprite({ name, isEgg, ratio, size }: { name: string; isEgg: boolean; ratio: number; size: number }) {
  const [fit, setFit] = useState<{ scale: number; x: number; y: number; w: number; h: number; cw: number; ch: number } | null>(
    null,
  );

  // Measure once per sprite, then re-fit whenever the requested size changes.
  // The window is resized to match the art instead of the art being squeezed
  // into a fixed square, which is what used to clip every sprite over 64px.
  useEffect(() => {
    let alive = true;
    const url = spriteUrl(name);
    measureSprite(url)
      .then((box) => {
        if (!alive) return;
        const scale = fitScale(Math.max(box.w, box.h), size);
        setFit({ scale, x: box.x, y: box.y, w: box.w, h: box.h, cw: box.cw, ch: box.ch });
        const win = petWindow({ w: box.w, h: box.h }, scale);
        bridge()?.fitTo(win.w, win.h);
      })
      .catch((err) => {
        // Falling back to the raw canvas is better than showing nothing; the
        // window keeps its previous size and the sprite may be a little off.
        console.error('[poketokenpet] could not measure sprite', name, err);
        if (alive) setFit(null);
      });
    return () => {
      alive = false;
    };
  }, [name, size]);

  if (!fit) return <div className="pet-stage" />;

  const stageW = Math.round(fit.w * fit.scale);
  const stageH = Math.round(fit.h * fit.scale);

  return (
    <div className="pet-stage" style={{ width: stageW, height: stageH }}>
      <img
        className={`pet-sprite${isEgg && ratio > 0.6 ? ' wobble' : ''}`}
        src={spriteUrl(name)}
        alt=""
        draggable={false}
        style={{
          width: Math.round(fit.cw * fit.scale),
          height: Math.round(fit.ch * fit.scale),
          // Pull the canvas so its opaque box, not its padding, sits in the stage.
          left: -Math.round(fit.x * fit.scale),
          top: -Math.round(fit.y * fit.scale),
        }}
        onError={(e) => {
          // A silent broken sprite is the hardest thing to notice in a tiny
          // transparent window, so say so loudly.
          console.error('[poketokenpet] sprite failed to load:', e.currentTarget.src);
        }}
      />
    </div>
  );
}
