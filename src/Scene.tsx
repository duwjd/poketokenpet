import { Fragment, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { spriteUrl } from './api.ts';
import { battleUiVars } from './battleui.ts';
import type { Stop } from './journey.ts';
import { sceneVars } from './scenes.ts';
import type { TimeOfDay } from './timeOfDay.ts';
import { euro, josa } from './josa.ts';
import { fitScale } from './pixelFit.ts';
import './Scene.css';

export type SceneTurn = {
  moveName: string;
  moveType: string;
  damage: number;
  crit: boolean;
  missed: boolean;
  /** Type matchup multiplier: 0, 0.25, 0.5, 1, 2 or 4. */
  effect: number;
  foeHpAfter: number;
  /** Whether the opponent answered. False only on the exchange it goes down on. */
  foeActed: boolean;
  foeMoveName: string;
  foeMoveType: string;
  /** The foe's move against MY types, same scale as `effect`. */
  foeEffect: number;
  /** Physical lands on the target, special travels to it, status stays home. */
  moveClass: string;
  foeMoveClass: string;
  /** A whole Korean clause, already assembled server-side, or null. */
  ailmentKo: string | null;
  foeAilmentKo: string | null;
  /** What a status move did for me when it inflicted nothing. */
  selfEffect: 'boost' | 'heal' | 'guard' | 'failed' | null;
  /**
   * What is STILL on each side after this turn, as a badge label, or null.
   *
   * A short token — 독, 마비, 화상 — not the sentence `ailmentKo` carries. Null
   * for the volatile conditions, which the games deliberately show no icon for.
   */
  foeStatusKo: string | null;
  myStatusKo: string | null;
  counter: number;
  myHpAfter: number;
};

export type SceneBattle = {
  foeMaxHp: number;
  myMaxHp: number;
  turns: SceneTurn[];
};

export type SceneTrainerFight = {
  name: string;
  won: boolean;
  lostAt: number | null;
  /** The class portrait, for the 'meet' beat. Null while it is still downloading. */
  sprite: string | null;
  team: { speciesId: number; name: string; sprite: string | null }[];
  /** One per team member fought. Shorter than the team if the companion fell. */
  rounds: SceneBattle[];
};

export type SceneEncounter = {
  seq: number;
  wildName: string;
  wildSprite: string | null;
  tokens: number;
  /** The TM that dropped, already named, or null. */
  moveName: string | null;
  /** The blow-by-blow. Only the newest encounter carries one. */
  battle: SceneBattle | null;
  /** Set instead of `battle` when this encounter was a trainer. */
  trainerFight: SceneTrainerFight | null;
  /**
   * The battle form worn for this encounter, if any.
   *
   * Read off the log entry rather than off the live companion: a key stone
   * taken off since must not change what the replay shows.
   */
  formKo: string | null;
  formKind: 'mega' | 'gmax' | null;
  formBackSprite: string | null;
  /**
   * Cached filename of the Gen-5 backdrop this fight happens on, or null while
   * it is still downloading — Scene.css falls back to the flat gradient.
   */
  battleBg: string | null;
};

/** Impact art, keyed by move type. Resolved server-side; a miss is just null. */
export type SceneFx = Record<string, string | null>;

export type SceneProps = {
  /** Null during the egg phase. */
  companion: { name: string; sprite: string | null; backSprite: string | null } | null;
  eggSprite: string | null;
  /** Drives the egg wobble, exactly as the old portrait did. */
  eggRatio: number;
  /** Newest first, straight from the payload. */
  log: SceneEncounter[];
  idleReason: 'off' | 'everstone' | 'egg' | null;
  nextInMs: number | null;
  /** Where the pet is on its journey. Derived from hunt.count by journeyFor. */
  stop: Stop;
  /**
   * Cached filename of the Gen-5 backdrop for where the pet is, or null.
   *
   * Resolved server-side from `stop.sky`; null both when the stop names no
   * backdrop and when the download has not landed, because the scene draws the
   * same flat sky for either.
   */
  skylineBg: string | null;
  /** Tints the art, nothing else. See src/timeOfDay.ts. */
  timeOfDay: TimeOfDay;
  /** Impact art for the types swung this encounter. Empty is fine. */
  fx?: SceneFx;
  /**
   * Hunting has earned everything its share cap allows.
   *
   * Not the same as idle: the pet still walks, still meets things, still picks
   * up TMs. Only the progress stops, which is otherwise invisible — every log
   * line just reads "—" and the bar sits still, which reads as a bug.
   */
  capped?: boolean;
};

/**
 * The battle chrome never changes, so it is built once; the region sheet does,
 * so it is merged in per render. Keeping the two apart is the only reason this
 * is not one constant any more.
 */
const UI_VARS = battleUiVars();

/** Target long-edge size, in px, for each thing the scene draws. */
const WALK_TARGET = 88;
/** egg.png is a 96x96 canvas holding a ~28x30 egg, so it needs a bigger target. */
const EGG_TARGET = 240;
const BATTLE_TARGET = 72;
/**
 * The trainer standing there before the fight.
 *
 * Every Showdown trainer sprite is an 80x80 canvas — checked across all
 * twenty-four this app can ask for — so a target of 80 lands exactly on the
 * ladder's 1x step and the art is drawn pixel for pixel. Slightly taller than a
 * Pokemon at 72, which is the proportion the games use.
 */
const TRAINER_TARGET = 80;
/**
 * How much bigger a transformed companion is drawn.
 *
 * Megas are barely larger than their base and gigantamax sprites are drawn at
 * roughly the same canvas size as everything else, so without this the beat
 * that says "거다이맥스했다!" shows a Pokemon exactly the size it just was.
 */
const FORM_SCALE = 1.35;
/** Turns a gigantamax lasts. Mirrors GMAX_TURNS in server/hunt.ts. */
const GMAX_TURNS = 3;

type Phase =
  | 'travel'
  | 'alert'
  | 'wipe'
  /**
   * The trainer, before anyone's Pokemon is out.
   *
   * Trainers only. This is the beat the games open a trainer battle on, and
   * until it existed the challenge line had to share `intro` with the first
   * send-out — so the sentence that announced a person arrived over a picture
   * of a Pokemon.
   */
  | 'meet'
  | 'enter'
  | 'intro'
  /** The transformation beat. Skipped entirely when nothing transforms. */
  | 'form'
  /** My half of an exchange. */
  | 'turn'
  /** Theirs. Skipped on the exchange that fells them. */
  | 'counter'
  | 'faint'
  | 'send'
  | 'reward';

/**
 * How long each phase holds.
 *
 * An exchange is now two beats, mine then theirs, so both are shorter than the
 * single 1150ms beat they replaced: an eight-turn legendary runs 8x750 + 7x700
 * = 10.9s against the old 9.2s. Roughly where it was, for twice the reading.
 * Any click skips it.
 */
const HOLD: Record<Exclude<Phase, 'travel'>, number> = {
  alert: 700,
  wipe: 600,
  /** A whole sentence and a sprite arriving. A shade longer than 'intro'. */
  meet: 1400,
  enter: 500,
  intro: 1200,
  /** A beat of its own: the sprite swap is the whole point of the feature. */
  form: 1400,
  turn: 750,
  /** Their answer. A shade shorter than mine — it is the reply, not the setup. */
  counter: 700,
  faint: 1100,
  /** The beat where a trainer reaches for the next Pokemon. */
  send: 900,
  reward: 1600,
};

const ORDER: Phase[] = ['alert', 'wipe', 'meet', 'enter', 'intro', 'form', 'turn', 'faint', 'reward'];

/**
 * Beats the ORDER walk steps straight over.
 *
 * Both of these are stages that only some fights have, and holding a second on
 * an empty one is a stall rather than a pause. `form` was handled with an ad-hoc
 * `skipForm` that looked one step ahead; a second skippable beat immediately
 * before it would have needed that trick to look two steps ahead, so it is a
 * predicate and a walk now instead.
 *
 * Both are also skipped for every team member after the first. `formKind` is per
 * ENCOUNTER rather than per round, so on the way back round through 'send' a
 * trainer's second Pokemon used to replay "거다이맥스했다!" for 1.4s — and would
 * now re-introduce a trainer who has been standing there the whole time. The
 * companion transforms once, and the trainer arrives once, at the top of the
 * fight.
 */
function skippable(p: Phase, s: State): boolean {
  if (s.round > 0) return p === 'meet' || p === 'form';
  if (p === 'meet') return !s.enc?.trainerFight;
  if (p === 'form') return !s.enc?.formKind;
  return false;
}

type Snapshot = SceneEncounter & {
  petName: string;
  petBack: string | null;
  /** Encounters that settled in the same batch — an offline catch-up. */
  batch: number;
};

type State = {
  phase: Phase;
  enc: Snapshot | null;
  /** Which team member is out. Always 0 for a wild encounter. */
  round: number;
  /** Which exchange is on screen while phase === 'turn'. */
  turn: number;
  /** Which page of the payout is on screen while phase === 'reward'. */
  page: number;
  /** Bumped on every transition so the timer effect always re-fires. */
  step: number;
};

type Action =
  | { type: 'encounter'; enc: Snapshot; reduced: boolean }
  | { type: 'next' }
  | { type: 'skip' };

const IDLE: State = { phase: 'travel', enc: null, round: 0, turn: 0, page: 0, step: 0 };

function reduce(s: State, a: Action): State {
  switch (a.type) {
    case 'encounter':
      // Reduced motion skips the theatre and just states the outcome.
      return {
        phase: a.reduced ? 'reward' : 'alert',
        enc: a.enc,
        round: 0,
        turn: 0,
        page: 0,
        step: s.step + 1,
      };
    case 'next': {
      const rounds = s.enc?.trainerFight?.rounds;
      const turns = rounds ? (rounds[s.round]?.turns ?? []) : (s.enc?.battle?.turns ?? []);

      // An exchange is two beats: my swing, then their answer. The answer is
      // skipped on the exchange that fells them, which is what keeps an N-turn
      // fight at 2N-1 beats rather than a limp 2N with a dead one at the end.
      if (s.phase === 'turn' && turns[s.turn]?.foeActed) {
        return { ...s, phase: 'counter', step: s.step + 1 };
      }
      // Both halves land here. 'counter' is deliberately absent from ORDER — it
      // is not a stage of the fight, it is the back half of one — so it MUST be
      // handled before the ORDER walk below, exactly as 'send' is.
      if (s.phase === 'turn' || s.phase === 'counter') {
        if (s.turn < turns.length - 1) {
          return { ...s, phase: 'turn', turn: s.turn + 1, step: s.step + 1 };
        }
        return { ...s, phase: 'faint', turn: 0, step: s.step + 1 };
      }
      // A trainer with more Pokemon reaches for the next one instead of paying out.
      if (s.phase === 'faint' && rounds && s.round < rounds.length - 1) {
        return { ...s, phase: 'send', round: s.round + 1, turn: 0, step: s.step + 1 };
      }
      if (s.phase === 'send') return { ...s, phase: 'enter', turn: 0, step: s.step + 1 };

      // The payout can be five lines and the box holds two, so it pages —
      // which is what the blinking marker has always been promising.
      if (s.phase === 'reward' && s.page < rewardPages(s.enc).length - 1) {
        return { ...s, page: s.page + 1, step: s.step + 1 };
      }

      const i = ORDER.indexOf(s.phase);
      if (i < 0 || i === ORDER.length - 1) return { ...IDLE, step: s.step + 1 };
      let j = i + 1;
      while (j < ORDER.length && skippable(ORDER[j], s)) j++;
      return {
        phase: ORDER[j],
        enc: s.enc,
        round: s.round,
        turn: 0,
        page: 0,
        step: s.step + 1,
      };
    }
    case 'skip':
      return { ...IDLE, step: s.step + 1 };
  }
}

const motionQuery = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

function usePrefersReducedMotion(): boolean {
  // Read during initialisation rather than in the effect: setting state
  // synchronously from an effect just triggers a second render for a value that
  // was already knowable.
  const [reduced, setReduced] = useState(() => motionQuery()?.matches ?? false);
  useEffect(() => {
    const q = motionQuery();
    if (!q) return;
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    q.addEventListener('change', onChange);
    return () => q.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * A sprite scaled by a whole-number ladder step.
 *
 * Deliberately measured from `<img onLoad>` rather than spriteBox's
 * `measureSprite`: that one fetches a blob and reads a canvas, neither of which
 * exists under happy-dom, and the panel's tests render this component for real.
 * A zero natural size just leaves the image hidden, same as PixelSprite.
 */
function SceneSprite({
  name,
  target,
  alt = '',
}: {
  name: string;
  target: number;
  alt?: string;
}) {
  /**
   * Measurement, and whether the fetch failed, keyed by the sprite it is for.
   *
   * One object rather than two states because both have to be dropped together
   * the moment `name` changes. Neither used to be, and the walker below is not
   * keyed either: on evolution the new species kept the old one's measured size
   * until onLoad corrected it, and — once `failed` exists — a sprite that broke
   * once would stay a silhouette for ever. `key={sprite}` at the call site is
   * the codebase's other way of saying this (see DexSprite's caller in
   * App.tsx), but there are four call sites here and resetting internally
   * cannot be forgotten at one of them.
   */
  const [m, setM] = useState<{ name: string; size: { w: number; h: number } | null; failed: boolean }>(
    { name, size: null, failed: false },
  );
  if (m.name !== name) setM({ name, size: null, failed: false });

  // A 404 leaves onLoad unfired for ever, so without this the image stays at
  // zero size with `visibility: hidden` — invisible, and the alt text never
  // reaches anyone either, because it is hidden rather than unrendered.
  if (m.failed) return <span className="scene-silhouette" role="img" aria-label={alt || undefined} />;

  return (
    <img
      className="scene-sprite"
      src={spriteUrl(name)}
      alt={alt}
      draggable={false}
      style={m.size ? { width: m.size.w, height: m.size.h } : { visibility: 'hidden' }}
      onLoad={(e) => {
        const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
        if (!w || !h) return;
        const k = fitScale(Math.max(w, h), target);
        setM({ name, size: { w: Math.round(w * k), h: Math.round(h * k) }, failed: false });
      }}
      onError={(e) => {
        // Same prefix PetApp.tsx uses; the README documents it as the way to
        // debug a broken petsprite:// in a packaged app, where there is no
        // console to watch.
        console.error('[poketokenpet] sprite failed to load:', e.currentTarget.src);
        setM({ name, size: null, failed: true });
      }}
    />
  );
}

const compact = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n.toLocaleString();

/** Lines the message box shows at once. It is a window frame, not a container. */
const PAGE_LINES = 2;

/**
 * The after-battle message, one entry per line, split into pages.
 *
 * Data rather than inline JSX because two places need it: the render, and the
 * reducer, which has to count the pages. A won trainer fight that dropped a TM
 * during an offline catch-up is four lines — the box used to grow to fit them
 * and rode up over both sprites, which is the one thing a game text box never
 * does.
 *
 * Every line is short enough to sit on one row at the box's width: a nickname
 * is capped at NICKNAME_MAX, the longest Korean move name is seven characters
 * and the longest trainer name eleven.
 */
function rewardPages(enc: Snapshot | null): React.ReactNode[][] {
  if (!enc) return [];
  const fight = enc.trainerFight;
  const lines: React.ReactNode[] =
    fight && !fight.won
      ? [`${fight.name}에게 지고 말았다…`, '다음엔 이기겠어!']
      : [
          ...(fight ? [`${fight.name}${josa(fight.name, '을', '를')} 이겼다!`] : []),
          <>
            진행도 <b>+{compact(enc.tokens)}</b>
          </>,
          ...(enc.moveName
            ? [`기술머신 ${enc.moveName}${josa(enc.moveName, '을', '를')} 주웠다!`]
            : []),
          ...(enc.batch > 1 ? [`자리를 비운 동안 ${enc.batch}번 싸웠다.`] : []),
        ];
  const pages: React.ReactNode[][] = [];
  for (let i = 0; i < lines.length; i += PAGE_LINES) pages.push(lines.slice(i, i + PAGE_LINES));
  return pages;
}

const IDLE_CAPTION: Record<string, string> = {
  off: '자동사냥이 꺼져 있다',
  everstone: '변함없는돌을 차고 쉬고 있다',
  egg: '알을 품고 있다',
};

function untilCaption(ms: number | null): string {
  if (ms === null) return '곧 출발한다';
  if (ms < 60_000) return '무언가 다가온다…';
  return `다음 조우까지 ${Math.ceil(ms / 60_000)}분`;
}

export default function Scene({
  companion,
  eggSprite,
  eggRatio,
  log,
  idleReason,
  nextInMs,
  stop,
  timeOfDay,
  fx,
  capped,
  skylineBg,
}: SceneProps) {
  const reduced = usePrefersReducedMotion();
  const [eggFailed, setEggFailed] = useState(false);
  const [st, dispatch] = useReducer(reduce, IDLE);
  /**
   * Swapping the sheet is the whole of changing terrain; the CSS is untouched.
   *
   * The skyline rides along as a second URL rather than a second element's
   * inline style, so the whole look of a place is one object set on one root.
   * Undefined rather than 'none' when there is no backdrop: the property then
   * never lands and the stylesheet's own `var(--skyline, none)` default is what
   * answers, which keeps the fallback written down in exactly one place.
   */
  const vars = useMemo(
    () => ({
      ...sceneVars(stop.terrain),
      ...UI_VARS,
      ...(skylineBg ? { '--skyline': `url("${spriteUrl(skylineBg)}")` } : {}),
    }) as React.CSSProperties,
    [stop.terrain, skylineBg],
  );
  /**
   * Newest encounter already played.
   *
   * Starts null and the first payload only ARMS it — otherwise every launch
   * would replay whatever battle happened last, which reads as a bug.
   */
  const played = useRef<number | null>(null);
  const newestSeq = log[0]?.seq ?? null;

  useEffect(() => {
    if (newestSeq === null) return;
    if (played.current === null) {
      played.current = newestSeq; // arm only
      return;
    }
    if (newestSeq <= played.current) return;
    const batch = newestSeq - played.current;
    played.current = newestSeq;
    const e = log[0];
    if (!companion) return; // an egg cannot have fought
    // Snapshot everything now. Reading live state during the animation would
    // blank the sprite the moment the companion graduates, or swap it mid-fight
    // when it evolves.
    dispatch({
      type: 'encounter',
      reduced,
      enc: {
        ...e,
        petName: companion.name,
        petBack: companion.backSprite,
        batch,
      },
    });
    // `log`/`companion`/`reduced` are read for the snapshot, but only a change
    // in newestSeq may start an animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestSeq]);

  // One timer for the whole sequence. A per-phase setTimeout chain leaks
  // differently on skip, on unmount, and when a second encounter lands.
  useEffect(() => {
    if (st.phase === 'travel') return;
    const ms = reduced ? 2200 : HOLD[st.phase];
    const t = setTimeout(() => dispatch({ type: 'next' }), ms);
    return () => clearTimeout(t);
  }, [st.step, st.phase, reduced]);

  const playing = st.phase !== 'travel';
  const enc = st.enc;
  const cls = ['scene', playing && 'playing', playing && 'frozen'].filter(Boolean).join(' ');
  const inBattle =
    enc &&
    (st.phase === 'meet' ||
      st.phase === 'enter' ||
      st.phase === 'intro' ||
      st.phase === 'form' ||
      st.phase === 'turn' ||
      st.phase === 'counter' ||
      st.phase === 'faint' ||
      st.phase === 'send' ||
      st.phase === 'reward');
  /** Either half of an exchange — someone is swinging. */
  const acting = st.phase === 'turn' || st.phase === 'counter';

  /**
   * Whether the transformed sprite is on screen.
   *
   * True from the `form` beat onward — and for a gigantamax, only until turn
   * GMAX_TURNS, because that is how long it lasts in the games and the fight
   * itself stops halving damage at the same index.
   */
  const transformed =
    !!enc?.formBackSprite &&
    st.phase !== 'travel' &&
    st.phase !== 'alert' &&
    st.phase !== 'wipe' &&
    st.phase !== 'enter' &&
    st.phase !== 'intro' &&
    !(enc.formKind === 'gmax' && acting && st.turn >= GMAX_TURNS);
  const myBack = transformed ? enc!.formBackSprite : (enc?.petBack ?? null);

  // The exchange on screen, and the one before it — the bars animate from the
  // previous turn's HP to this one's, which is what makes the drain visible.
  // A trainer fights one round per team member; a wild encounter is one round
  // that happens to be the only one. Everything below reads the current round.
  const fight = enc?.trainerFight ?? null;
  const bout = fight ? (fight.rounds[st.round] ?? null) : (enc?.battle ?? null);
  const turns = bout?.turns ?? [];
  const now = acting ? turns[st.turn] : undefined;
  /**
   * How far each bar has drained.
   *
   * The two sides settle on different beats, which is the whole point of
   * splitting the exchange: my swing lands on 'turn', so the opponent's bar
   * moves there, and their answer lands on 'counter', so mine moves there. One
   * shared index would drain my bar before I had been hit.
   */
  const framing =
    st.phase === 'enter' || st.phase === 'intro' || st.phase === 'form' || st.phase === 'send';
  const foeSettled = acting ? st.turn : framing ? -1 : turns.length - 1;
  const mySettled =
    st.phase === 'counter'
      ? st.turn
      : st.phase === 'turn'
        ? st.turn - 1
        : framing
          ? -1
          : turns.length - 1;
  const foePct =
    !bout || foeSettled < 0
      ? 100
      : Math.round(((turns[foeSettled]?.foeHpAfter ?? 0) / bout.foeMaxHp) * 100);
  /**
   * What my bar reads before their first answer of the round.
   *
   * Not a full bar: a trainer's team is fought without healing, so round two
   * opens on whatever round one left. Backing it out of the first exchange
   * (`myHpAfter + counter`) keeps that honest without SceneBattle having to
   * carry a starting HP the server would then have to send.
   */
  const myRoundStart = turns[0] ? turns[0].myHpAfter + turns[0].counter : (bout?.myMaxHp ?? 100);
  const myPct = !bout
    ? 100
    : Math.round(((mySettled < 0 ? myRoundStart : (turns[mySettled]?.myHpAfter ?? myRoundStart)) / bout.myMaxHp) * 100);
  const hpClass = (pct: number) => (pct <= 20 ? 'crit' : pct <= 50 ? 'low' : '');

  /**
   * The standing status on each plate.
   *
   * Read through the SAME settled index as the HP bar rather than through
   * `now`, so a badge can never appear before the blow that caused it: mine
   * lands on the 'counter' beat, theirs on 'turn', which is the whole reason
   * those two indices are separate.
   */
  const foeStatus = foeSettled < 0 ? null : (turns[foeSettled]?.foeStatusKo ?? null);
  const myStatus = mySettled < 0 ? null : (turns[mySettled]?.myStatusKo ?? null);

  /**
   * The impact art for this beat, or null.
   *
   * Everything it needs is already on the turn — `moveType` and `foeMoveType`
   * have been on SceneTurn since the two-beat rewrite and were, until now, the
   * only fields nothing read.
   *
   * Suppressed where the fight itself says nothing landed: a miss, and an
   * immune matchup. Both already have a line in the message box, and art on top
   * of "효과가 없는 것 같다" would contradict it.
   */
  const blow = (() => {
    if (!now || !fx) return null;
    const mine = st.phase === 'turn';
    if (mine ? now.missed : !now.foeActed) return null;
    const eff = mine ? now.effect : now.foeEffect;
    if (eff === 0) return null;
    const sprite = fx[mine ? now.moveType : now.foeMoveType];
    if (!sprite) return null;
    return {
      sprite,
      mine,
      type: mine ? now.moveType : now.foeMoveType,
      kind: mine ? now.moveClass : now.foeMoveClass,
      /** Super-effective hits land bigger; a crit flashes twice. */
      strong: eff > 1,
      crit: mine ? now.crit : false,
    };
  })();

  /** Who is out right now, and what to draw for them. */
  const foeName = fight ? (fight.team[st.round]?.name ?? '') : (enc?.wildName ?? '');
  const foeSprite = fight ? (fight.team[st.round]?.sprite ?? null) : (enc?.wildSprite ?? null);
  /** The companion went down rather than the opponent. */
  const wiped = !!fight && !fight.won && st.round === fight.rounds.length - 1;

  /**
   * When each name plate is on screen.
   *
   * The games take a plate away with the Pokemon it belongs to: the foe's goes
   * as it faints and comes back with the next one, and yours stays through the
   * payout unless you are the one that fell.
   */
  const showFoePlate =
    st.phase === 'enter' || st.phase === 'intro' || st.phase === 'form' || acting;
  const over = st.phase === 'faint' || st.phase === 'reward';
  const showMyPlate = (showFoePlate || over || st.phase === 'send') && !(wiped && over);

  return (
    <div
      className={cls}
      style={vars}
      data-tod={timeOfDay}
      onClick={() => playing && dispatch({ type: 'skip' })}
      role={playing ? 'button' : undefined}
      aria-label={playing ? '연출 넘기기' : undefined}
      /* Focusable only while it really is a button, matching how role and
         aria-label are already conditional. */
      tabIndex={playing ? 0 : undefined}
      onKeyDown={(e) => {
        // A role="button" div gets no Enter/Space activation from the browser
        // the way a real <button> does, so this is what makes the control it
        // advertises to assistive tech actually operable.
        if (!playing || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        dispatch({ type: 'skip' });
      }}
    >
      {/* The horizon. Behind everything, including the sky colour it covers —
          and only a background, so a missing download shows the colour. */}
      <div className="scene-sky" />
      <div className="scene-ground" />
      <div className="scene-grass far" />

      {/* Travelling. Kept mounted under the battle so the GIF does not restart
          every time an encounter ends. */}
      <div className="scene-walker">
        {companion?.sprite ? (
          <SceneSprite name={companion.sprite} target={WALK_TARGET} alt={companion.name} />
        ) : eggSprite && !eggFailed ? (
          <img
            className={`scene-sprite${eggRatio > 0.85 ? ' cracking' : eggRatio > 0.6 ? ' wobble' : ''}`}
            src={spriteUrl(eggSprite)}
            alt="알"
            draggable={false}
            style={{ width: EGG_TARGET, height: EGG_TARGET }}
            onError={(e) => {
              console.error('[poketokenpet] sprite failed to load:', e.currentTarget.src);
              setEggFailed(true);
            }}
          />
        ) : eggSprite ? (
          // Not a SceneSprite — it has a fixed size and the wobble classes — so
          // it carries its own failure state.
          <span className="scene-silhouette egg" role="img" aria-label="알" />
        ) : null}
        <span className="scene-shadow" />
      </div>

      <div className="scene-grass near" />

      {st.phase === 'alert' && <span className="scene-bang">!</span>}
      {st.phase === 'wipe' && <div className="scene-wipe" />}

      {inBattle && enc && (
        <div
          className="scene-battle"
          style={
            enc.battleBg
              ? ({ '--battle-bg': `url("${spriteUrl(enc.battleBg)}")` } as React.CSSProperties)
              : undefined
          }
        >
          <span className="scene-pad foe" />
          <span className="scene-pad mine" />

          {/* The impact, over both Pokemon and under the message box.

              Keyed on st.step so every beat restarts the animation — the same
              trick the entering class needs, for the same reason: React keeps
              the element and CSS never replays a finished animation.

              A status move plays on its OWN side, because that is where it
              happened; everything else plays on the target. */}
          {blow && (
            <span
              key={st.step}
              className={[
                'scene-fx',
                blow.kind === 'status' ? (blow.mine ? 'at-mine' : 'at-foe') : blow.mine ? 'at-foe' : 'at-mine',
                `as-${blow.kind}`,
                blow.strong ? 'strong' : '',
                blow.crit ? 'crit' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-fx={blow.type}
              style={{ backgroundImage: `url("${spriteUrl(blow.sprite)}")` }}
              aria-hidden="true"
            />
          )}

          {/* The challenger, on the opponent's platform before their first
              Pokemon is on it.

              Mounted only for this one beat rather than hidden through the
              fight, so the slide-in plays from zero on a freshly inserted
              element — the same reason `.entering` is a class on the combatants
              rather than a rule on them.

              A miss is cosmetic, as with every other Showdown asset: the
              silhouette stands in, and the sentence beside it is unchanged. */}
          {fight && st.phase === 'meet' && (
            <div className="scene-trainer entering">
              {fight.sprite ? (
                <SceneSprite name={fight.sprite} target={TRAINER_TARGET} alt={fight.name} />
              ) : (
                <span className="scene-silhouette" role="img" aria-label={fight.name} />
              )}
            </div>
          )}

          {/* Name over gauge, the way the games draw a plate.

              This used to be a bare gauge on the grounds that the message box
              says who is who anyway. It does not: the box narrates whichever
              side is acting this beat, so through a trainer's team the foe on
              screen could go unnamed for seconds at a time. The plate is the
              one place a name is on screen for both sides continuously.

              The group label keeps the name for assistive tech regardless. */}
          <div
            className="scene-plate uiplate foe"
            role="group"
            /* The status is on the label too — a colour alone is not a reading. */
            aria-label={foeStatus ? `${foeName} 체력, ${foeStatus}` : `${foeName} 체력`}
            hidden={!showFoePlate}
          >
            <span className="scene-who">
              <span className="scene-nm">{foeName}</span>
              {fight && (
                <span className="scene-balls" aria-label={`남은 ${fight.team.length - st.round}마리`}>
                  {fight.team.map((_, i) => (
                    <i key={i} className={i < st.round ? 'out' : ''} />
                  ))}
                </span>
              )}
            </span>
            <span className="scene-gauge">
              <span className="lbl">HP</span>
              <span className="scene-hp">
                <i className={hpClass(foePct)} style={{ width: `${foePct}%` }} />
              </span>
              {/* On the HP row, after the bar — where the games put it, and the
                  same order Showdown builds its own panel in. */}
              {foeStatus && <span className={`scene-st st-${foeStatus}`}>{foeStatus}</span>}
            </span>
          </div>

          {/* Keyed per ROUND, not per exchange. Keying per exchange tore the
              <img> down and rebuilt it every turn, and a fresh <img> restarts an
              animated GIF from frame one — so the Pokemon visibly re-entered on
              every single action.

              Hidden during 'send' because the next Pokemon is not out yet —
              without that the remount plays the faint animation on a sprite
              that just arrived, so it appears only to drop back out of frame. */}
          <div
            className={`scene-foe${st.phase === 'enter' ? ' entering' : ''}${
              !wiped && (st.phase === 'faint' || st.phase === 'send' || st.phase === 'reward')
                ? ' fainted'
                : ''
            }`}
            hidden={st.phase === 'send' || st.phase === 'meet'}
            key={`foe-${st.round}`}
          >
            {foeSprite ? (
              <SceneSprite name={foeSprite} target={BATTLE_TARGET} alt={foeName} />
            ) : (
              <span className="scene-silhouette" />
            )}
          </div>

          {/* It does take hits — hunting just never loses, so the bar has a
              floor. What it shows is that a legendary cost more than a Rattata
              did. */}
          <div
            className="scene-plate uiplate mine"
            role="group"
            aria-label={myStatus ? `${enc.petName} 체력, ${myStatus}` : `${enc.petName} 체력`}
            hidden={!showMyPlate}
          >
            {/* petName is already the nickname when one is set — buildState
                resolves `nickname ?? name` — so the plate calls the companion
                whatever the rest of the app calls it. */}
            <span className="scene-who">
              <span className="scene-nm">{enc.petName}</span>
            </span>
            <span className="scene-gauge">
              <span className="lbl">HP</span>
              <span className="scene-hp">
                <i className={hpClass(myPct)} style={{ width: `${myPct}%` }} />
              </span>
              {myStatus && <span className={`scene-st st-${myStatus}`}>{myStatus}</span>}
            </span>
          </div>

          {/* Only the first send-out slides in: a trainer reaching for their
              next Pokemon does not re-throw yours. */}
          <div
            className={`scene-mine${st.phase === 'enter' && st.round === 0 ? ' entering' : ''}${
              wiped && !acting ? ' fainted' : ''
            }`}
            /* Nobody is out yet while the trainer is being introduced — the
               companion is thrown on the 'enter' that follows. */
            hidden={st.phase === 'meet'}
            key={`mine-${st.round}`}
          >
            {myBack ? (
              <SceneSprite
                name={myBack}
                target={transformed ? BATTLE_TARGET * FORM_SCALE : BATTLE_TARGET}
                alt={enc.petName}
              />
            ) : (
              <span className="scene-silhouette" />
            )}
          </div>

          <div className="scene-text uiwin">
            {/* The challenge, over the trainer and nothing else. It used to
                share 'intro' with the first send-out, which meant the sentence
                announcing a person went up over a picture of a Pokemon. */}
            {st.phase === 'meet' ? (
              <>
                {fight!.name}
                {josa(fight!.name, '이', '가')} 승부를 걸어왔다!
              </>
            ) : /* The send-out line HOLDS through the entry beats that follow
                   it. 'send' hands back to 'enter' (see the reducer), so
                   testing the phase alone would drop the sentence the moment
                   the Pokemon started arriving. The games leave it up while it
                   does. Now that the challenge has a beat of its own, EVERY
                   trainer round says this — the first one included, which is
                   both what the games do and one condition fewer here. */
            st.phase === 'send' || (fight && (st.phase === 'enter' || st.phase === 'intro')) ? (
              <>
                {fight!.name}
                {josa(fight!.name, '은', '는')} {foeName}
                {josa(foeName, '을', '를')} 내보냈다!
              </>
            ) : st.phase === 'enter' || st.phase === 'intro' ? (
              /* Wild only: every trainer path is taken by the branch above. */
              <>
                앗! 야생 {foeName}
                {josa(foeName, '이', '가')} 나타났다!
              </>
            ) : st.phase === 'form' ? (
              <>
                {enc.petName}
                {josa(enc.petName, '은', '는')} {enc.formKo}
                {euro(enc.formKo ?? '')} 변했다!
                <br />
                {enc.formKind === 'gmax'
                  ? `${GMAX_TURNS}턴 동안 받는 피해가 절반이 된다!`
                  : '힘이 넘쳐흐른다!'}
              </>
            ) : st.phase === 'turn' && now ? (
              <>
                {enc.petName}의 {now.moveName}!
                <br />
                {/* One follow-up line, in the order the games say them. A
                    status move deals nothing, so its line is the effect. */}
                {now.missed
                  ? '공격은 빗나갔다!'
                  : now.ailmentKo
                    ? `${foeName}${josa(foeName, '은', '는')} ${now.ailmentKo}`
                    : now.selfEffect === 'boost'
                      ? `${enc.petName}의 기세가 올랐다!`
                      : now.selfEffect === 'heal'
                        ? `${enc.petName}의 체력이 회복됐다!`
                        : now.selfEffect === 'guard'
                          ? `${foeName}의 기세가 꺾였다!`
                          : now.selfEffect === 'failed'
                            ? '하지만 실패했다!'
                          : now.effect === 0
                            ? '효과가 없는 것 같다…'
                            : now.effect > 1
                              ? '효과가 굉장했다!'
                              : now.effect < 1
                                ? '효과가 별로인 것 같다…'
                                : now.crit
                                  ? '급소에 맞았다!'
                                  : ''}
              </>
            ) : st.phase === 'counter' && now ? (
              /* Their half. This used to be a "반격" tacked onto the end of my
                 line, because the opponent genuinely had no move to name. */
              <>
                {foeName}의 {now.foeMoveName}!
                <br />
                {now.foeAilmentKo
                  ? `${enc.petName}${josa(enc.petName, '은', '는')} ${now.foeAilmentKo}`
                  : now.foeEffect === 0
                    ? '효과가 없는 것 같다…'
                    : now.foeEffect > 1
                      ? '효과가 굉장했다!'
                      : now.foeEffect < 1
                        ? '효과가 별로인 것 같다…'
                        : ''}
              </>
            ) : st.phase === 'faint' ? (
              wiped ? (
                <>
                  {enc.petName}
                  {josa(enc.petName, '은', '는')} 눈앞이 캄캄해졌다…
                </>
              ) : (
                <>
                  {foeName}
                  {josa(foeName, '을', '를')} 쓰러뜨렸다!
                </>
              )
            ) : (
              (rewardPages(enc)[st.page] ?? []).map((line, i) => (
                <Fragment key={i}>
                  {i > 0 && <br />}
                  {line}
                </Fragment>
              ))
            )}
          </div>
        </div>
      )}

      {/* Where the pet is, on the plaque the games slide in at the top-left
          when you walk into a new area.

          Keyed on the place, which is the whole animation: React inserts a
          fresh element whenever the key changes and a CSS animation on a fresh
          element starts from zero, so arriving somewhere replays the slide with
          no state machine at all. (Same mechanic as `.scene-mine.entering` —
          see the note above `slide-in-left` in Scene.css.) `journey.test.ts`
          guarantees two consecutive stops are never the same place, so a key
          change always means a genuinely new sign. */}
      {!playing && (
        <span className="scene-sign uisign" key={`${stop.region}/${stop.ko}`}>
          <em>{stop.region}</em>
          {stop.ko}
        </span>
      )}

      {/* The place name moved to the sign, so this is down to the one thing it
          was always really saying: when the next encounter lands, or why it
          will not. */}
      {!playing && (
        <span className="scene-caption">
          {idleReason
            ? IDLE_CAPTION[idleReason]
            : /* Still walking, still fighting — only the payout stopped, so the
                 countdown gives way to the reason the bar is not moving. */
              capped
              ? '사냥 진행도가 상한에 닿았다'
              : untilCaption(nextInMs)}
        </span>
      )}
    </div>
  );
}
