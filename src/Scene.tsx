import { Fragment, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { spriteUrl } from './api.ts';
import { battleUiVars } from './battleui.ts';
import type { Stop } from './journey.ts';
import { sceneVars } from './scenes.ts';
import type { TimeOfDay } from './timeOfDay.ts';
import { euro, josa } from './josa.ts';
import { fitScale } from './pixelFit.ts';
import { stillPokemon } from './spriteName.ts';
import './Scene.css';
import { hpLevel } from './uikit.ts';

import {
  endLines,
  fieldLabel,
  halfLines,
  pages,
  type Half,
  type SceneCured,
  type SceneEndEvent,
  type SceneEvent,
  type SceneField,
  type SceneSelf,
  type SceneSkip,
} from './battleText.ts';

export type { SceneCured, SceneEndEvent, SceneEvent, SceneField, SceneSkip } from './battleText.ts';

export type SceneTurn = {
  /** The opponent moved first this turn — speed decided. */
  foeFirst: boolean;
  /** Whether I got a turn at all. False when I went down before my slot. */
  meActed: boolean;
  mySkip: SceneSkip | null;
  myCured: SceneCured | null;
  foeSkip: SceneSkip | null;
  foeCured: SceneCured | null;
  foeMissed: boolean;
  foeCrit: boolean;
  foeSelfEffect: SceneSelf;
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
  selfEffect: SceneSelf;
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
  /** Everything else each half did — stages, weather, hits, recoil. See battleText.ts. */
  myEvents: SceneEvent[];
  foeEvents: SceneEvent[];
  /** What happened once both had moved: weather and status chip, things wearing off. */
  endEvents: SceneEndEvent[];
  /** The field once this turn is over. Absent on fixtures that predate it. */
  field?: SceneField;
};

export type SceneBattle = {
  foeMaxHp: number;
  myMaxHp: number;
  /** The HP I came in with — below max in a trainer's later rounds. */
  myStartHp: number;
  /** The same for the opponent — below max when one comes back after being dragged out. */
  foeStartHp?: number;
  /** Which of each team is out this round. Absent means round order. */
  mySlot?: number;
  foeSlot?: number;
  /** Hazards that struck the newcomers as this round began. */
  entry?: SceneEndEvent[];
  /** How the round ended. See RoundExit in server/fight.ts. */
  exit?: SceneExit;
  turns: SceneTurn[];
  /** Opponent down and me still standing. */
  won: boolean;
};

/** How a round ended. */
export type SceneExit =
  | 'foe-down'
  | 'me-down'
  | 'both-down'
  | 'foe-forced'
  | 'foe-retreat'
  | 'me-forced'
  | 'me-retreat'
  | 'fled'
  | 'stall';

export type SceneTrainerFight = {
  /**
   * What kind of fight this was.
   *
   * The scene could not tell a gym rematch from a route trainer: both are a
   * portrait, a name and a team, and the only signals were `badgeKo` (a gym's
   * FIRST win only) and `mine` (the league). The staging decisions — who gets
   * the stare-down, which backdrop — need the distinction directly.
   *
   * `e.gym` and `e.league` already ride in the payload, spread from the log
   * entry; they were simply never declared. This names the fact instead of
   * making every reader re-derive it.
   */
  kind: 'route' | 'gym' | 'league';
  name: string;
  won: boolean;
  lostAt: number | null;
  /** The class portrait, for the 'meet' beat. Null while it is still downloading. */
  sprite: string | null;
  team: { speciesId: number; name: string; sprite: string | null }[];
  /** One per team member fought. Shorter than the team if the companion fell. */
  rounds: SceneBattle[];
  /**
   * The badge this fight handed over, or null.
   *
   * Set only when a gym leader was beaten for the first time — a rematch and a
   * loss both leave it null, so the reward box needs no rule of its own. All
   * three come resolved from the server, the way every other name here does.
   */
  badgeKo?: string | null;
  badgeSprite?: string | null;
  /** The TM that came with the badge. */
  prizeKo?: string | null;
  /**
   * Which of MY six stood for each round. Null for every fight but the league.
   *
   * A route trainer and a gym leader are both fought by the one companion, so
   * the scene's usual back sprite is right for the whole battle. The league is
   * the only fight where my side changes mid-fight, and this is per ROUND
   * rather than per member — one of the six can hold two of theirs.
   */
  mine?: { speciesId: number; name: string; sprite: string | null }[] | null;
};

export type SceneEncounter = {
  seq: number;
  wildName: string;
  wildSprite: string | null;
  tokens: number;
  /** The TM that dropped, already named, or null. */
  moveName: string | null;
  /** A wild fight's outcome, from the record. Absent on older entries, which were wins. */
  won?: boolean;
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
  /**
   * Called when a fight starts and stops being on screen.
   *
   * The panel holds its toasts and the challenge card for the length of it,
   * so nothing outside the scene announces the result before the scene does.
   */
  onPlaying?: (playing: boolean) => void;
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
/** Turns a gigantamax lasts. Mirrors GMAX_TURNS in server/fight.ts. */
const GMAX_TURNS = 3;

type Phase =
  | 'travel'
  | 'alert'
  | 'wipe'
  /**
   * The stare-down, before the challenge is even spoken.
   *
   * NAMED battles only — a gym leader, a kahuna, an Elite Four member, a
   * champion. A route trainer keeps the old opening: those happen several times
   * a lap and a full-screen portrait for each would make the rare ones ordinary.
   *
   * This is the beat the portraits were always worth. Every Showdown trainer
   * canvas is 80x80 and there is no larger art anywhere — the `-masters`
   * variants are the same size — so the only way to make a person look like an
   * event is to give them the whole stage at 2x for a moment, with what is at
   * stake written beside them.
   */
  | 'vs'
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
  /**
   * The end of a turn: weather and status chip, and things wearing off.
   * Only on a turn that has something to say there.
   */
  | 'field'
  /** Hazards on the field, striking whoever has just come in. */
  | 'arrive'
  | 'faint'
  | 'send'
  /**
   * The badge, handed over.
   *
   * Only when something actually changes hands — a first gym win, or a league
   * cleared. The badge art is 85x85 and used to be scaled DOWN to 17px and sat
   * on a text baseline for 1.6 seconds, which is the one place in this scene
   * that shrank art. Eight of these exist per region and they are what the road
   * is for, so they get a beat.
   *
   * Kept under reduced motion, unlike every other beat: this is information
   * rather than motion, and the outcome text alone never showed the badge.
   */
  | 'badge'
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
  /** Long enough to read two names and a stake, short enough not to be a wall. */
  vs: 1800,
  /** A whole sentence and a sprite arriving. A shade longer than 'intro'. */
  meet: 1400,
  enter: 500,
  intro: 1200,
  /** A beat of its own: the sprite swap is the whole point of the feature. */
  form: 1400,
  turn: 750,
  /** Their answer. A shade shorter than mine — it is the reply, not the setup. */
  counter: 700,
  /** The weather's say, after both have moved. */
  field: 900,
  arrive: 900,
  faint: 1100,
  /** The beat where a trainer reaches for the next Pokemon. */
  send: 900,
  /** The one thing on the road worth stopping for. */
  badge: 2000,
  reward: 1600,
};

const ORDER: Phase[] = [
  'alert',
  'wipe',
  'vs',
  'meet',
  'enter',
  'intro',
  'form',
  'arrive',
  'turn',
  'faint',
  'badge',
  'reward',
];

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
  // The badge is the one beat that belongs at the END of the last round, so it
  // is asked about before the round check below — that check exists to stop
  // openings replaying, and this is not an opening.
  if (p === 'badge') return !s.enc?.trainerFight?.badgeKo;
  if (p === 'arrive') return !(boutOf(s)?.entry?.length ?? 0);
  if (s.round > 0) return p === 'vs' || p === 'meet' || p === 'form';
  // Named battles only. `kind` is what separates 관장 웅 from 낚시꾼 동현, which
  // `trainerFight` alone cannot: both are trainers with a portrait and a team.
  if (p === 'vs') return s.enc?.trainerFight?.kind !== 'gym' && s.enc?.trainerFight?.kind !== 'league';
  if (p === 'meet') return !s.enc?.trainerFight;
  if (p === 'form') return !s.enc?.formKind;
  return false;
}

/** The round on screen, for a trainer or a wild encounter alike. */
function boutOf(s: State): SceneBattle | null {
  const rounds = s.enc?.trainerFight?.rounds;
  return rounds ? (rounds[s.round] ?? null) : (s.enc?.battle ?? null);
}

/** The two halves of an exchange: mine is 'turn', theirs is 'counter'. */
type Beat = 'turn' | 'counter';

/**
 * The beat a turn opens on — whoever moved first — or null when nothing in it
 * is worth a beat.
 *
 * A turn cut by a switch can have one half, or none: the halves before the
 * switch belong to the round that ended, the rest to the one that began. A
 * record with no half left may still carry the end of the turn.
 */
function turnStart(t: SceneTurn | undefined): Phase | null {
  if (!t) return null;
  const first: Beat = t.foeFirst ? 'counter' : 'turn';
  const second: Beat = t.foeFirst ? 'turn' : 'counter';
  const acted = (b: Beat) => (b === 'turn' ? t.meActed : t.foeActed);
  if (acted(first)) return first;
  if (acted(second)) return second;
  return (t.endEvents?.length ?? 0) > 0 ? 'field' : null;
}

/** The first turn from `i` on that has a beat, and that beat. */
function nextTurn(turns: SceneTurn[], i: number): { turn: number; phase: Phase } | null {
  for (let j = i; j < turns.length; j++) {
    const phase = turnStart(turns[j]);
    if (phase) return { turn: j, phase };
  }
  return null;
}

/** The half a turn opens on, for the field chip. */
function firstBeat(t: SceneTurn | undefined): Beat {
  const p = turnStart(t);
  return p === 'counter' ? 'counter' : 'turn';
}

/** The half that follows `b` inside the same turn, or null when the turn is done. */
function secondBeat(t: SceneTurn, b: Beat): Beat | null {
  if (b === 'counter' && t.foeFirst && t.meActed) return 'turn';
  if (b === 'turn' && !t.foeFirst && t.foeActed) return 'counter';
  return null;
}

/** My half of a turn, for battleText.ts. */
function myHalf(t: SceneTurn): Half {
  return {
    moveName: t.moveName,
    skip: t.mySkip,
    cured: t.myCured,
    missed: t.missed,
    ailmentKo: t.ailmentKo,
    selfEffect: t.selfEffect,
    effect: t.effect,
    crit: t.crit,
    events: t.myEvents ?? [],
  };
}

/** Theirs. */
function foeHalf(t: SceneTurn): Half {
  return {
    moveName: t.foeMoveName,
    skip: t.foeSkip,
    cured: t.foeCured,
    missed: t.foeMissed,
    ailmentKo: t.foeAilmentKo,
    selfEffect: t.foeSelfEffect,
    effect: t.foeEffect,
    crit: t.foeCrit,
    events: t.foeEvents ?? [],
  };
}

/**
 * What a beat of the fight says, as lines.
 *
 * One function for the render and the reducer: the render needs the words, the
 * reducer only how many pages they fill, and the count cannot drift from the
 * words if both come from here.
 */
function beatLines(t: SceneTurn, phase: Phase, me: string, foe: string): string[] {
  if (phase === 'turn') return halfLines(me, foe, myHalf(t));
  if (phase === 'counter') return halfLines(foe, me, foeHalf(t));
  if (phase === 'field') return endLines(me, foe, t.endEvents ?? []);
  return [];
}

/** What the arrival beat says: the hazards, as they strike. */
function arriveLines(b: SceneBattle | null, me: string, foe: string): string[] {
  return endLines(me, foe, b?.entry ?? []);
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
      /**
       * Reduced motion skips the theatre and just states the outcome — except
       * for the badge, which is not theatre. It is the only art in the payout
       * the text does not otherwise carry, and someone who turned motion off
       * did not ask to stop being told what they won.
       */
      return {
        phase: a.reduced
          ? a.enc?.trainerFight?.badgeKo
            ? 'badge'
            : 'reward'
          : 'alert',
        enc: a.enc,
        round: 0,
        turn: 0,
        page: 0,
        step: s.step + 1,
      };
    case 'next': {
      const rounds = s.enc?.trainerFight?.rounds;
      const turns = rounds ? (rounds[s.round]?.turns ?? []) : (s.enc?.battle?.turns ?? []);

      // An exchange is two beats, in the order speed put them: the faster
      // side's, then the other's. A half that never came — that side was
      // already down — is skipped, which keeps an N-turn fight at 2N-1 beats
      // rather than a limp 2N with a dead one at the end.
      //
      // Both halves land here. 'counter' is deliberately absent from ORDER — it
      // is not a stage of the fight, it is one half of one — so it MUST be
      // handled before the ORDER walk below, exactly as 'send' is.
      //
      // A beat with more to say than the box holds pages first, the way the
      // payout always has. Then, once both halves are done, the end of the turn
      // gets a beat of its own if the weather or a condition has anything to
      // say — a sandstorm that lands after both moves reads wrong over either.
      if (s.phase === 'turn' || s.phase === 'counter' || s.phase === 'field') {
        const t = turns[s.turn];
        if (t && s.page < pages(beatLines(t, s.phase, '', '')).length - 1) {
          return { ...s, page: s.page + 1, step: s.step + 1 };
        }
        const then = t && s.phase !== 'field' ? secondBeat(t, s.phase) : null;
        if (then) return { ...s, phase: then, page: 0, step: s.step + 1 };
        if (t && s.phase !== 'field' && (t.endEvents?.length ?? 0) > 0) {
          return { ...s, phase: 'field', page: 0, step: s.step + 1 };
        }
        const nt = nextTurn(turns, s.turn + 1);
        if (nt) return { ...s, phase: nt.phase, turn: nt.turn, page: 0, step: s.step + 1 };
        return { ...s, phase: 'faint', turn: 0, page: 0, step: s.step + 1 };
      }
      // The hazards' say pages like any other beat.
      if (s.phase === 'arrive' && s.page < pages(arriveLines(boutOf(s), '', '')).length - 1) {
        return { ...s, page: s.page + 1, step: s.step + 1 };
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
      // The fight opens on whoever is faster, which may be their half — or,
      // for a round that has no beat at all, goes straight to its ending.
      const opening = ORDER[j] === 'turn' ? nextTurn(turns, 0) : null;
      return {
        phase: ORDER[j] === 'turn' ? (opening?.phase ?? 'faint') : ORDER[j],
        enc: s.enc,
        round: s.round,
        turn: opening?.turn ?? 0,
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
      className={`scene-sprite${stillPokemon(name) ? ' still' : ''}`}
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
        // Same prefix PetApp.tsx uses; docs/INTERNALS.md documents it as the way to
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
      : !fight && enc.won === false
        ? [
            '아무것도 얻지 못했다…',
            ...(enc.batch > 1 ? [`자리를 비운 동안 ${enc.batch}번 싸웠다.`] : []),
          ]
      : [
          ...(fight ? [`${fight.name}${josa(fight.name, '을', '를')} 이겼다!`] : []),
          /**
           * The BADGE is not a line here any more — the `badge` beat before
           * this one carries it, at 2x in a case rather than at 17px on a text
           * baseline. Repeating it would have the payout say the same thing
           * twice inside four seconds, and would put the picture back in the
           * one place this scene ever shrank art to fit.
           *
           * The machine stayed, because it is text and the box pages text. The
           * beat has no room for a second line: 170px of badge plus its frame
           * plus one caption already fills a 218px stage.
           */
          ...(fight?.prizeKo
            ? [`기술머신 ${fight.prizeKo}${josa(fight.prizeKo, '을', '를')} 함께 받았다!`]
            : []),
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
  onPlaying,
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
  /**
   * Tell the panel, on the edges only. A ref, so a parent that passes a fresh
   * function every render does not re-announce the same state.
   */
  const onPlayingRef = useRef(onPlaying);
  onPlayingRef.current = onPlaying;
  useEffect(() => {
    onPlayingRef.current?.(playing);
  }, [playing]);
  const enc = st.enc;
  const cls = ['scene', playing && 'playing', playing && 'frozen'].filter(Boolean).join(' ');
  const inBattle =
    enc &&
    (st.phase === 'vs' ||
      st.phase === 'badge' ||
      st.phase === 'meet' ||
      st.phase === 'enter' ||
      st.phase === 'intro' ||
      st.phase === 'form' ||
      st.phase === 'turn' ||
      st.phase === 'counter' ||
      st.phase === 'field' ||
      st.phase === 'arrive' ||
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
  /**
   * The Pokemon on my side of this round.
   *
   * The companion, except in a league fight — where it is whichever of the six
   * is still standing. Read per round rather than per encounter, so a bar that
   * empties hands over mid-fight exactly as the record says it did.
   */
  const mineNow = enc?.trainerFight?.mine?.[st.round] ?? null;
  const myBack =
    mineNow ? mineNow.sprite : transformed ? enc!.formBackSprite : (enc?.petBack ?? null);
  /** What to call my side. The companion's nickname, or the party member's species. */
  const myName = mineNow ? mineNow.name : (enc?.petName ?? '');

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
    st.phase === 'enter' || st.phase === 'intro' || st.phase === 'form' || st.phase === 'send' || st.phase === 'arrive';
  // Whichever half comes second in its turn is the one where the other side's
  // bar has already moved — `foeFirst` flips which that is.
  const foeSettled =
    st.phase === 'turn' || st.phase === 'field'
      ? st.turn
      : st.phase === 'counter'
        ? now?.foeFirst
          ? st.turn - 1
          : st.turn
        : framing
          ? -1
          : turns.length - 1;
  const mySettled =
    st.phase === 'counter' || st.phase === 'field'
      ? st.turn
      : st.phase === 'turn'
        ? now?.foeFirst
          ? st.turn
          : st.turn - 1
        : framing
          ? -1
          : turns.length - 1;
  /**
   * What the foe's bar reads before the first blow of the round: full, unless
   * this one was dragged out earlier and has come back — or the hazards took
   * their share on the way in, which the arrival beat shows.
   */
  const foeRoundStart = bout ? (bout.foeStartHp ?? bout.foeMaxHp) : 0;
  const entryHit = (on: 'me' | 'foe') =>
    (bout?.entry ?? []).reduce((a, e) => a + (e.k === 'hazard-hit' && e.on === on ? e.hp : 0), 0);
  const arrived = st.phase === 'arrive' && st.page >= pages(arriveLines(bout, '', '')).length - 1;
  const foeFrame = foeRoundStart - (arrived || !framing ? entryHit('foe') : 0);
  const foePct = !bout
    ? 100
    : foeSettled < 0
      ? Math.round((foeFrame / bout.foeMaxHp) * 100)
      : Math.round(((turns[foeSettled]?.foeHpAfter ?? 0) / bout.foeMaxHp) * 100);
  /**
   * What my bar reads before their first answer of the round.
   *
   * Not a full bar: a trainer's team is fought without healing, so round two
   * opens on whatever round one left.
   */
  const myRoundStart = (bout?.myStartHp ?? bout?.myMaxHp ?? 100) - (arrived ? entryHit('me') : 0);
  const myPct = !bout
    ? 100
    : Math.round(((mySettled < 0 ? myRoundStart : (turns[mySettled]?.myHpAfter ?? myRoundStart)) / bout.myMaxHp) * 100);
  /**
   * The bar's colour, decided the way the games decide it: on the pixels of a
   * 48px bar, not on the ratio (hpLevel, src/uikit.ts). The class names are
   * the scene's own; the thresholds are the design system's.
   */
  const hpClass = (pct: number) => ({ hi: '', mid: 'low', lo: 'crit' })[hpLevel(pct, 100)];

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
    if (mine ? now.missed || !!now.mySkip : !now.foeActed || now.foeMissed || !!now.foeSkip) return null;
    // Charging, bracing and bouncing off a Protect all land nothing.
    const quiet = (mine ? now.myEvents : now.foeEvents)?.some(
      (e) => e.k === 'charge' || e.k === 'blocked' || e.k === 'protect',
    );
    if (quiet) return null;
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
      crit: mine ? now.crit : now.foeCrit,
    };
  })();

  /** Who is out right now, and what to draw for them. */
  const foeSlot = bout?.foeSlot ?? st.round;
  const foeName = fight ? (fight.team[foeSlot]?.name ?? '') : (enc?.wildName ?? '');
  const foeSprite = fight ? (fight.team[foeSlot]?.sprite ?? null) : (enc?.wildSprite ?? null);
  /** Their team members already down before this round, for the ball tray. */
  const downBefore = new Set<number>();
  (fight?.rounds ?? []).slice(0, st.round).forEach((r, i) => {
    // A round with no recorded exit predates them, and was always a knockout.
    if (!r.exit || r.exit === 'foe-down' || r.exit === 'both-down') downBefore.add(r.foeSlot ?? i);
  });
  /** How this round ended. Fixtures from before rounds had exits read as a knockout. */
  const exit: SceneExit | undefined = bout?.exit;
  /**
   * The companion went down rather than the opponent.
   *
   * A wild fight can be lost too now. Read off the fight being shown, so the
   * faint beat agrees with the bars it follows.
   */
  const lost = fight
    ? !fight.won && st.round === fight.rounds.length - 1
    : !!enc?.battle && !enc.battle.won;
  /** Lost with my bar at zero: the companion is the one that goes down. */
  const wiped = lost && (turns.at(-1)?.myHpAfter ?? 0) === 0;
  /**
   * Lost with both still standing. The fight ran into MAX_TURNS — a wild one
   * wanders off, a trainer's Pokemon simply outlasted mine — or a wild fight
   * was ended by 날려버리기 or 순간이동. Nobody faints.
   */
  const stalled = lost && !wiped;
  /** Who goes down at the end of this round, as the sprites show it. */
  const foeDown = exit ? exit === 'foe-down' || exit === 'both-down' : !lost;
  const foeGone = foeDown || exit === 'foe-forced' || exit === 'foe-retreat';
  const myDown = exit ? exit === 'me-down' || exit === 'both-down' : wiped;
  const myGone = myDown || exit === 'me-forced' || exit === 'me-retreat';

  /**
   * When each name plate is on screen.
   *
   * The games take a plate away with the Pokemon it belongs to: the foe's goes
   * as it faints and comes back with the next one, and yours stays through the
   * payout unless you are the one that fell.
   */
  const showFoePlate =
    st.phase === 'enter' || st.phase === 'intro' || st.phase === 'form' || acting || st.phase === 'field';

  /**
   * What the field is doing, for the chip at the top of the stage.
   *
   * The end-of-turn snapshot of the turn before — so rain that starts on my
   * half shows up at that half, not a beat early — unless this turn has
   * already changed the field in a half on screen or behind us.
   */
  const fieldNow = (() => {
    if (!bout) return null;
    if (st.phase === 'field') return turns[st.turn]?.field ?? null;
    if (!acting) return framing ? null : (turns.at(-1)?.field ?? null);
    const t = turns[st.turn];
    const prev = st.turn > 0 ? (turns[st.turn - 1]?.field ?? null) : null;
    if (!t) return prev;
    const seen: SceneEvent[] = [];
    const first = firstBeat(t);
    const mineShown = st.phase === 'turn' || first === 'turn';
    const theirsShown = st.phase === 'counter' || first === 'counter';
    if (mineShown) seen.push(...(t.myEvents ?? []));
    if (theirsShown) seen.push(...(t.foeEvents ?? []));
    const changed = seen.some((e) => e.k === 'weather' || e.k === 'terrain' || e.k === 'trick-room');
    return changed ? (t.field ?? prev) : prev;
  })();
  const fieldChip = fieldLabel(fieldNow);

  /**
   * What the send-out says: whoever is new since the last round. The first
   * round of a trainer fight is their first Pokemon, as it always was.
   */
  const sendLines = (() => {
    if (!fight) return [];
    const prev = st.round > 0 ? fight.rounds[st.round - 1] : null;
    const foeNew = !prev || (prev.foeSlot ?? st.round - 1) !== foeSlot;
    const mineNew = !!prev && prev.mySlot !== undefined && prev.mySlot !== bout?.mySlot;
    const out: string[] = [];
    if (foeNew) out.push(`${fight.name}${josa(fight.name, '은', '는')} ${foeName}${josa(foeName, '을', '를')} 내보냈다!`);
    if (mineNew) out.push(`가랏, ${myName}!`);
    return out.length ? out : [`${fight.name}${josa(fight.name, '은', '는')} ${foeName}${josa(foeName, '을', '를')} 내보냈다!`];
  })();
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

          {/* The weather and the terrain, while they last. Text on a plate
              rather than art: nothing upstream draws a weather icon, and a
              plate reads in both themes. */}
          {fieldChip && <span className="scene-field uiplate">{fieldChip}</span>}

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
          {fight && (st.phase === 'meet' || st.phase === 'send') && (
            <div className={`scene-trainer${st.phase === 'meet' ? ' entering' : ''}`}>
              {fight.sprite ? (
                <SceneSprite name={fight.sprite} target={TRAINER_TARGET} alt={fight.name} />
              ) : (
                <span className="scene-silhouette" role="img" aria-label={fight.name} />
              )}
            </div>
          )}

          {/* The stare-down.
 
              The whole stage for a moment, which is the only way an 80x80
              canvas can carry an event — there is no larger art of these people
              anywhere, so scale and time are the only levers. Two faces, the
              team they are about to send, and what is at stake.
 
              Its own layer rather than a dressed-up `meet`: `meet` puts the
              person where their Pokemon will stand, and this one is a split
              screen. Sharing an element would mean two position rules fighting
              over the same class. */}
          {fight && st.phase === 'vs' && (
            <div className="scene-vs">
              <span className="scene-vs-side foe">
                {fight.sprite ? (
                  <SceneSprite name={fight.sprite} target={TRAINER_TARGET * 2} alt={fight.name} />
                ) : (
                  <span className="scene-silhouette" role="img" aria-label={fight.name} />
                )}
                <b className="uiplate">{fight.name}</b>
                {/* The team, as the art rather than as five-pixel dots. The
                    tray during the fight stays dots on purpose — this is the
                    one beat with room to show who is coming. */}
                <span className="scene-vs-team">
                  {fight.team.map((m, i) => (
                    <i key={`${m.speciesId}-${i}`}>
                      {m.sprite ? <SceneSprite name={m.sprite} target={24} alt={m.name} /> : null}
                    </i>
                  ))}
                </span>
              </span>
              <span className="scene-vs-mid" aria-hidden="true">
                VS
              </span>
              <span className="scene-vs-side mine">
                {myBack ? (
                  <SceneSprite name={myBack} target={TRAINER_TARGET * 2} alt={myName} />
                ) : (
                  <span className="scene-silhouette" role="img" aria-label={myName} />
                )}
                <b className="uiplate">{myName}</b>
                {/* Deliberately NOT the badge at stake.
 
                    `badgeKo` is only populated when the fight was won, so
                    putting it here would announce the result before the first
                    Pokemon is out — the replay knows the ending and the viewer
                    must not. The badge gets its own beat afterwards, which is
                    where a prize belongs anyway. */}
                <span className="scene-vs-team" />
              </span>
            </div>
          )}

          {/* The badge, handed over.
 
              85x85 at 2x in a drawn case, instead of 17px on a text baseline
              for 1.6 seconds. This was the only place in the scene that ever
              scaled art DOWN, and what it shrank was the one picture the whole
              road is for.
 
              A league clear lands here too: the art is the charm the league
              actually hands over, because no trophy sprite exists upstream and
              naming the real prize beats inventing a cup. */}
          {fight?.badgeKo && st.phase === 'badge' && (
            <div className="scene-prize">
              <span className="scene-prize-case uicase">
                {fight.badgeSprite ? (
                  <img src={spriteUrl(fight.badgeSprite)} alt="" />
                ) : (
                  <span className="scene-silhouette" role="img" aria-label={fight.badgeKo} />
                )}
              </span>
              <b>
                {fight.badgeKo}
                {josa(fight.badgeKo, '을', '를')} 받았다!
              </b>
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
                <span className="scene-balls" aria-label={`남은 ${fight.team.length - downBefore.size}마리`}>
                  {fight.team.map((_, i) => (
                    <i key={i} className={downBefore.has(i) ? 'out' : ''} />
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
              foeGone && (st.phase === 'faint' || st.phase === 'send' || st.phase === 'reward')
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

          {/* My bar. It can empty in any fight — a wild one included. */}
          <div
            className="scene-plate uiplate mine"
            role="group"
            aria-label={myStatus ? `${myName} 체력, ${myStatus}` : `${myName} 체력`}
            hidden={!showMyPlate}
          >
            {/* `petName` is already the nickname when one is set — buildState
                resolves `nickname ?? name` — so the plate calls the companion
                whatever the rest of the app calls it. A league round overrides
                it with the party member that is actually out; those have no
                nicknames, because they are dex entries rather than the one
                Pokemon being raised. */}
            <span className="scene-who">
              <span className="scene-nm">{myName}</span>
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
              myGone && (st.phase === 'faint' || st.phase === 'reward') ? ' fainted' : ''
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
                alt={myName}
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
              /* Whoever is new this round is the one sent out: theirs, mine,
                 or both after a double knockout. */
              sendLines.map((line, i) => (
                <Fragment key={i}>
                  {i > 0 && <br />}
                  {line}
                </Fragment>
              ))
            ) : st.phase === 'arrive' ? (
              (pages(arriveLines(bout, myName, foeName))[st.page] ?? []).map((line, i) => (
                <Fragment key={i}>
                  {i > 0 && <br />}
                  {line}
                </Fragment>
              ))
            ) : st.phase === 'enter' || st.phase === 'intro' ? (
              /* Wild only: every trainer path is taken by the branch above. */
              <>
                앗! 야생 {foeName}
                {josa(foeName, '이', '가')} 나타났다!
              </>
            ) : st.phase === 'form' ? (
              <>
                {myName}
                {josa(myName, '은', '는')} {enc.formKo}
                {euro(enc.formKo ?? '')} 변했다!
                <br />
                {enc.formKind === 'gmax'
                  ? `${GMAX_TURNS}턴 동안 받는 피해가 절반이 된다!`
                  : '힘이 넘쳐흐른다!'}
              </>
            ) : (acting || st.phase === 'field') && turns[st.turn] ? (
              /* Either half, or the end of the turn: two lines a page. */
              (pages(beatLines(turns[st.turn], st.phase, myName, foeName))[st.page] ?? []).map((line, i) => (
                <Fragment key={i}>
                  {i > 0 && <br />}
                  {line}
                </Fragment>
              ))
            ) : st.phase === 'faint' ? (
              stalled ? (
                fight ? (
                  <>
                    {foeName}
                    {josa(foeName, '을', '를')} 끝내 쓰러뜨리지 못했다…
                  </>
                ) : (
                  <>
                    {foeName}
                    {josa(foeName, '은', '는')} 어딘가로 가 버렸다…
                  </>
                )
              ) : wiped ? (
                <>
                  {myName}
                  {josa(myName, '은', '는')} 눈앞이 캄캄해졌다…
                </>
              ) : exit === 'both-down' ? (
                <>둘 다 쓰러졌다!</>
              ) : exit === 'me-down' ? (
                <>
                  {myName}
                  {josa(myName, '은', '는')} 쓰러졌다!
                </>
              ) : (exit === 'foe-forced' || exit === 'foe-retreat') && fight ? (
                <>
                  {fight.name}
                  {josa(fight.name, '은', '는')} {foeName}
                  {josa(foeName, '을', '를')} 불러들였다!
                </>
              ) : exit === 'me-forced' || exit === 'me-retreat' ? (
                <>{myName}, 돌아와!</>
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
