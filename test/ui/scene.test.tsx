// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Scene, {
  type SceneBattle,
  type SceneEncounter,
  type SceneTrainerFight,
} from '../../src/Scene.tsx';

const COMPANION = {
  name: '화염레오',
  sprite: '668-w.gif',
  backSprite: '668-wb.gif',
};

/**
 * A four-exchange fight, the last blow felling it.
 *
 * Four is the floor the real simulation guarantees (MIN_TURNS), so the fixture
 * matches what the panel actually has to render.
 */
const battle = (turns = 4): SceneBattle => ({
  foeMaxHp: 400,
  myMaxHp: 100,
  turns: Array.from({ length: turns }, (_, i) => {
    const foeHpAfter = i === turns - 1 ? 0 : 400 - (i + 1) * 90;
    return {
      moveName: i % 2 ? '돌진' : '화염방사',
      moveType: i % 2 ? 'normal' : 'fire',
      damage: 90,
      crit: i === 1,
      missed: false,
      effect: 1,
      foeHpAfter,
      foeActed: foeHpAfter > 0,
      foeMoveName: '몸통박치기',
      foeMoveType: 'normal',
      foeEffect: 1,
      moveClass: 'special',
      foeMoveClass: 'physical',
      ailmentKo: null,
      foeAilmentKo: null,
      selfEffect: null,
      foeStatusKo: null,
      myStatusKo: null,
      counter: foeHpAfter > 0 ? 12 : 0,
      myHpAfter: 100 - (i + 1) * 12,
    };
  }),
});

const enc = (over: Partial<SceneEncounter> = {}): SceneEncounter => ({
  seq: 10,
  wildName: '꼬렛',
  wildSprite: '19-a.gif',
  tokens: 210_227,
  moveName: null,
  battle: battle(),
  trainerFight: null,
  battleBg: 'bg-forest.png',
  formKo: null,
  formKind: null,
  formBackSprite: null,
  ...over,
});

const FX = {
  fire: 'fx-flareball.png',
  normal: 'fx-impact.png',
  water: 'fx-waterwisp.png',
  electric: 'fx-lightning.png',
};

const props = (log: SceneEncounter[]) => ({
  fx: FX,
  companion: COMPANION,
  eggSprite: null,
  eggRatio: 0,
  log,
  idleReason: null,
  nextInMs: 180_000,
  /** Where the journey opens, so the caption assertions have a fixed place. */
  stop: { ko: '태초마을', region: '관동', terrain: 'field', sky: null } as const,
  skylineBg: null,
  timeOfDay: 'day' as const,
});

/**
 * Step the phase chain.
 *
 * One phase per act() call: each timer's dispatch has to commit before the
 * effect can schedule the next one, so a single large jump would fire the first
 * timer and then find nothing else pending.
 */
const step = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const HOLDS = {
  alert: 700, wipe: 600, meet: 1400, enter: 500, intro: 1200, form: 1400,
  turn: 750, counter: 700, faint: 1100, send: 900, reward: 1600,
};

/**
 * One whole exchange: my swing, then their answer.
 *
 * The felling blow has no answer — the opponent is down — so the last exchange
 * of a round is a single beat. Every stepping test goes through here rather
 * than counting `HOLDS.turn` by hand, so the beat structure lives in one place.
 */
const exchange = async (last = false) => {
  await step(HOLDS.turn);
  if (!last) await step(HOLDS.counter);
};

/** Every exchange of one round, the last of which fells the opponent. */
const playRound = async (n: number) => {
  for (let i = 0; i < n; i++) await exchange(i === n - 1);
};

/**
 * Advance from `alert` up to (but not into) the named phase.
 *
 * `meet` is a trainer's beat and the machine steps over it for a wild
 * encounter, so it is opt-in — stepping its 1.4s on a wild fight would land
 * three beats further along than the caller asked for.
 */
const advanceTo = async (target: keyof typeof HOLDS, turns = 4, trainer = false) => {
  for (const p of ['alert', 'wipe', 'meet', 'enter', 'intro', 'turn', 'faint', 'send', 'reward'] as const) {
    if (p === target) return;
    if (p === 'meet' && !trainer) continue;
    if (p === 'turn') {
      for (let i = 0; i < turns; i++) await exchange(i === turns - 1);
    } else {
      await step(HOLDS[p]);
    }
  }
};

beforeEach(() => {
  // Only the timers Scene itself uses. Faking the whole clock also captures
  // React 19's scheduler, so a dispatch would sit in its queue unflushed and
  // no phase would ever render.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Scene — travelling', () => {
  it('walks the grass and says when the next encounter is due', () => {
    render(<Scene {...props([enc()])} />);
    expect(screen.getByText('다음 조우까지 3분')).toBeTruthy();
    expect(document.querySelector('.scene-grass.near')).toBeTruthy();
    expect(document.querySelector('.scene-walker img')).toBeTruthy();
  });

  it('names the place on a sign, the way the games do', () => {
    // Region above, place below, on the plaque at the top-left. The countdown
    // is a separate line at the bottom — it is not part of the place.
    render(<Scene {...props([enc()])} />);
    const sign = document.querySelector('.scene-sign') as HTMLElement;
    expect(sign).toBeTruthy();
    expect(sign.textContent).toBe('관동태초마을');
    expect(sign.classList.contains('uisign')).toBe(true);
    // The caption no longer carries the place.
    expect(document.querySelector('.scene-caption')!.textContent).toBe('다음 조우까지 3분');
  });

  it('replays the sign when the pet reaches a new place', () => {
    // Keyed on the stop, so React inserts a fresh element and the CSS animation
    // starts from zero. No state machine, and no sign that sits there stale.
    const { rerender } = render(<Scene {...props([enc()])} />);
    const first = document.querySelector('.scene-sign');
    rerender(<Scene {...props([enc()])} />);
    expect(document.querySelector('.scene-sign')).toBe(first);

    rerender(
      <Scene
        {...props([enc()])}
        stop={{ ko: '무지개시티', region: '관동', terrain: 'town', sky: 'city' }}
      />,
    );
    const next = document.querySelector('.scene-sign') as HTMLElement;
    expect(next).not.toBe(first);
    expect(next.textContent).toBe('관동무지개시티');
  });

  it('hangs the horizon backdrop for where the pet is', () => {
    const { container } = render(<Scene {...props([enc()])} skylineBg="bg-dampcave.png" />);
    const scene = container.querySelector('.scene') as HTMLElement;
    expect(container.querySelector('.scene-sky')).toBeTruthy();
    expect(scene.style.getPropertyValue('--skyline')).toContain('bg-dampcave.png');
  });

  it('looks exactly as it did before when there is no backdrop', () => {
    // Null is the ordinary answer for two thirds of the journey — a plain field
    // names no backdrop — and it is also what a failed download looks like. The
    // custom property must then never land, so Scene.css's own
    // `var(--skyline, none)` is what answers and the scene keeps its flat sky.
    const { container } = render(<Scene {...props([enc()])} skylineBg={null} />);
    const scene = container.querySelector('.scene') as HTMLElement;
    expect(scene.style.getPropertyValue('--skyline')).toBe('');
    // The element still mounts; with no URL it paints nothing.
    expect(container.querySelector('.scene-sky')).toBeTruthy();
  });

  it('tints the scene by the time of day rather than by the OS theme', () => {
    const { container } = render(<Scene {...props([enc()])} timeOfDay="night" />);
    expect(container.querySelector('.scene')?.getAttribute('data-tod')).toBe('night');
  });

  it('explains itself instead of pretending to walk when hunting is idle', () => {
    render(<Scene {...props([])} idleReason="everstone" />);
    expect(screen.getByText('변함없는돌을 차고 쉬고 있다')).toBeTruthy();
  });

  it('shows the egg wobbling once it is close to hatching', () => {
    render(
      <Scene
        {...props([])}
        companion={null}
        eggSprite="egg.png"
        eggRatio={0.9}
        idleReason="egg"
      />,
    );
    expect(document.querySelector('.scene-sprite.cracking')).toBeTruthy();
  });

  it('does not replay the last battle on first load', () => {
    // The payload always carries a log, so an unguarded trigger would open with
    // a battle every single launch.
    render(<Scene {...props([enc()])} />);
    expect(screen.queryByText(/나타났다/)).toBeNull();
    expect(document.querySelector('.scene-battle')).toBeNull();
  });
});

describe('Scene — encounter', () => {
  it('plays the whole sequence in order, then returns to travelling', async () => {
    const { rerender } = render(<Scene {...props([enc({ seq: 10 })])} />);
    rerender(<Scene {...props([enc({ seq: 11 })])} />);

    expect(screen.getByText('!')).toBeTruthy();
    await step(HOLDS.alert);
    expect(document.querySelector('.scene-wipe')).toBeTruthy();
    await step(HOLDS.wipe);
    expect(document.querySelector('.scene-battle')).toBeTruthy();
    expect(screen.getByText(/야생 꼬렛이 나타났다/)).toBeTruthy();
    await step(HOLDS.enter);
    expect(screen.getByText(/야생 꼬렛이 나타났다/)).toBeTruthy();

    // Four exchanges, and each is two beats now: my swing, then their answer.
    // The opponent used to be a bare "반격" tacked onto my line; it names its
    // own move on its own beat.
    await step(HOLDS.intro);
    expect(screen.getByText(/화염레오의 화염방사/)).toBeTruthy();
    await step(HOLDS.turn);
    expect(screen.getByText(/꼬렛의 몸통박치기/)).toBeTruthy();
    expect(screen.queryByText(/반격/)).toBeNull();

    await step(HOLDS.counter);
    expect(screen.getByText(/화염레오의 돌진/)).toBeTruthy();
    expect(screen.getByText(/급소에 맞았다/)).toBeTruthy();
    await exchange();
    expect(screen.getByText(/화염레오의 화염방사/)).toBeTruthy();
    await exchange();

    // The felling blow has no answer — the opponent is already down.
    expect(screen.getByText(/화염레오의 돌진/)).toBeTruthy();
    await step(HOLDS.turn);
    expect(screen.getByText(/쓰러뜨렸다/)).toBeTruthy();
    await step(HOLDS.faint);
    expect(screen.getByText('+210,227')).toBeTruthy();
    await step(HOLDS.reward);
    expect(document.querySelector('.scene-battle')).toBeNull();
    expect(document.querySelector('.scene-sign')!.textContent).toBe('관동태초마을');
  });

  /**
   * The transformation beat.
   *
   * It has to be invisible when nothing transforms — an empty 1.4s hold reads
   * as the app hanging, not as a pause — and unmissable when something does.
   */
  it('steps straight past the transformation beat in an ordinary fight', async () => {
    const { rerender } = render(<Scene {...props([enc({ seq: 10 })])} />);
    rerender(<Scene {...props([enc({ seq: 11 })])} />);
    await step(HOLDS.alert);
    await step(HOLDS.wipe);
    await step(HOLDS.enter);
    await step(HOLDS.intro);
    // Straight into the first swing, with no beat in between.
    expect(screen.getByText(/화염레오의 화염방사/)).toBeTruthy();
    expect(screen.queryByText(/변했다/)).toBeNull();
  });

  it('holds a beat on a mega evolution and swaps the sprite', async () => {
    const mega = {
      formKo: '메가리자몽X',
      formKind: 'mega' as const,
      formBackSprite: '10034-wb.gif',
    };
    const { rerender } = render(<Scene {...props([enc({ seq: 10, ...mega })])} />);
    rerender(<Scene {...props([enc({ seq: 11, ...mega })])} />);
    await step(HOLDS.alert);
    await step(HOLDS.wipe);
    await step(HOLDS.enter);

    const back = () => document.querySelector('.scene-mine img')?.getAttribute('src') ?? '';
    expect(back()).toContain('668-wb.gif'); // still itself while it is thrown out
    await step(HOLDS.intro);
    expect(screen.getByText(/메가리자몽X로 변했다/)).toBeTruthy();
    expect(back()).toContain('10034-wb.gif');

    await step(HOLDS.form);
    expect(screen.getByText(/화염레오의 화염방사/)).toBeTruthy();
    // And it stays transformed for the rest of the fight.
    expect(back()).toContain('10034-wb.gif');
  });

  it('lets a gigantamax lapse after three turns, as the fight does', async () => {
    const gmax = {
      formKo: '거다이맥스 리자몽',
      formKind: 'gmax' as const,
      formBackSprite: '10196-wb.gif',
    };
    // Five exchanges, so there are turns on both sides of the third.
    const long = enc({ seq: 11, battle: battle(5), ...gmax });
    const { rerender } = render(<Scene {...props([enc({ seq: 10, ...gmax })])} />);
    rerender(<Scene {...props([long])} />);
    await step(HOLDS.alert);
    await step(HOLDS.wipe);
    await step(HOLDS.enter);
    await step(HOLDS.intro);
    expect(screen.getByText(/3턴 동안 받는 피해가 절반/)).toBeTruthy();

    const back = () => document.querySelector('.scene-mine img')?.getAttribute('src') ?? '';
    await step(HOLDS.form);
    expect(back()).toContain('10196-wb.gif'); // turn 0
    await exchange();
    await exchange(); // turns 1 and 2
    expect(back()).toContain('10196-wb.gif');
    await exchange(); // turn 3 — it has run out
    expect(back()).toContain('668-wb.gif');
  });

  it('narrates what a status move did instead of a damage line', async () => {
    // A status move deals nothing now, so its follow-up line IS the effect —
    // otherwise the box would read "화염레오의 전기자석파!" and then nothing.
    const zap = battle(4).turns.map((t, i) =>
      i === 0
        ? { ...t, moveName: '전기자석파', moveType: 'electric', damage: 0, ailmentKo: '몸이 저려 잘 움직이지 못한다!' }
        : t,
    );
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([enc({ seq: 2, battle: { foeMaxHp: 400, myMaxHp: 100, turns: zap } })])} />);
    await advanceTo('turn');
    expect(screen.getByText(/화염레오의 전기자석파/)).toBeTruthy();
    expect(screen.getByText(/꼬렛은 몸이 저려 잘 움직이지 못한다/)).toBeTruthy();
  });

  it('names what the opponent left on me', async () => {
    const burn = battle(4).turns.map((t, i) =>
      i === 0 ? { ...t, foeMoveName: '불꽃세례', foeMoveType: 'fire', foeAilmentKo: '화상을 입었다!' } : t,
    );
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([enc({ seq: 2, battle: { foeMaxHp: 400, myMaxHp: 100, turns: burn } })])} />);
    await advanceTo('turn');
    await step(HOLDS.turn);
    expect(screen.getByText(/꼬렛의 불꽃세례/)).toBeTruthy();
    expect(screen.getByText(/화염레오는 화상을 입었다/)).toBeTruthy();
  });

  it('shows my companion from behind and the wild one from the front', async () => {
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([enc({ seq: 2 })])} />);
    await advanceTo('enter');
    const mine = document.querySelector('.scene-mine img') as HTMLImageElement;
    const foe = document.querySelector('.scene-foe img') as HTMLImageElement;
    expect(mine.src).toContain('668-wb.gif'); // the `b` is the back view
    expect(foe.src).toContain('19-a.gif');
  });

  it('throws the impact art of the move being used', async () => {
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([enc({ seq: 2 })])} />);
    await advanceTo('turn');
    // My half: 화염방사 is special and fire, so a fire projectile at the foe.
    const mine = document.querySelector('.scene-fx') as HTMLElement;
    expect(mine).toBeTruthy();
    expect(mine.className).toContain('at-foe');
    expect(mine.className).toContain('as-special');
    expect(mine.style.backgroundImage).toContain('fx-flareball.png');

    // Their half: the fixture answers with a normal physical 몸통박치기.
    await step(HOLDS.turn);
    const theirs = document.querySelector('.scene-fx') as HTMLElement;
    expect(theirs.className).toContain('at-mine');
    expect(theirs.className).toContain('as-physical');
    expect(theirs.style.backgroundImage).toContain('fx-impact.png');
  });

  it('draws nothing when nothing landed', async () => {
    // A miss and an immune matchup both already have their own line in the
    // message box; art on top of "효과가 없는 것 같다" would contradict it.
    const dud = battle(4).turns.map((t, i) =>
      i === 0 ? { ...t, missed: true, damage: 0 } : i === 1 ? { ...t, effect: 0, damage: 0 } : t,
    );
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(
      <Scene {...props([enc({ seq: 2, battle: { foeMaxHp: 400, myMaxHp: 100, turns: dud } })])} />,
    );
    await advanceTo('turn');
    expect(document.querySelector('.scene-fx')).toBeNull();
    await exchange();
    expect(document.querySelector('.scene-fx')).toBeNull();
  });

  it('plays the scene unchanged when the art never arrived', async () => {
    // Same property the backdrops have: a download that never lands is a
    // cosmetic loss, never a broken screen.
    const bare = { ...props([enc({ seq: 1 })]), fx: {} };
    const { rerender } = render(<Scene {...bare} />);
    rerender(<Scene {...{ ...props([enc({ seq: 2 })]), fx: {} }} />);
    await advanceTo('turn');
    expect(document.querySelector('.scene-fx')).toBeNull();
    expect(screen.getByText(/화염레오의 화염방사/)).toBeTruthy();
    expect(document.querySelectorAll('.scene-hp i')).toHaveLength(2);
  });

  it('keeps a status move on the side that used it', async () => {
    const setup = battle(4).turns.map((t, i) =>
      i === 0 ? { ...t, moveClass: 'status', moveType: 'normal', damage: 0 } : t,
    );
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(
      <Scene {...props([enc({ seq: 2, battle: { foeMaxHp: 400, myMaxHp: 100, turns: setup } })])} />,
    );
    await advanceTo('turn');
    const el = document.querySelector('.scene-fx') as HTMLElement;
    expect(el.className).toContain('as-status');
    // Mine, not the opponent's — a setup move happens where it was used.
    expect(el.className).toContain('at-mine');
  });

  it('badges a standing status on the plate that has it', async () => {
    // The message box says it once; the plate says it for as long as it lasts.
    const sick = battle(4).turns.map((t, i) =>
      i === 0
        ? { ...t, ailmentKo: '몸이 저려 잘 움직이지 못한다!', foeStatusKo: '마비' }
        : { ...t, foeStatusKo: '마비' },
    );
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(
      <Scene {...props([enc({ seq: 2, battle: { foeMaxHp: 400, myMaxHp: 100, turns: sick } })])} />,
    );
    await advanceTo('turn');
    const badge = document.querySelector('.scene-plate.foe .scene-st') as HTMLElement;
    expect(badge.textContent).toBe('마비');
    expect(badge.className).toContain('st-마비');
    // Mine is clean, so no badge over there.
    expect(document.querySelector('.scene-plate.mine .scene-st')).toBeNull();
    // It is a condition, not a flash — still there two beats later.
    await exchange();
    expect(document.querySelector('.scene-plate.foe .scene-st')!.textContent).toBe('마비');
  });

  it('puts the status in the plate label, not only in the colour', async () => {
    const sick = battle(4).turns.map((t) => ({ ...t, foeStatusKo: '독' }));
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(
      <Scene {...props([enc({ seq: 2, battle: { foeMaxHp: 400, myMaxHp: 100, turns: sick } })])} />,
    );
    await advanceTo('turn');
    expect(document.querySelector('.scene-plate.foe')!.getAttribute('aria-label')).toBe('꼬렛 체력, 독');
  });

  it('waits for the answer before badging my own side', async () => {
    // Same rule the HP bars follow: my plate settles on the counter beat, so a
    // status they inflict cannot appear before they have swung.
    const hurt = battle(4).turns.map((t) => ({ ...t, myStatusKo: '화상' }));
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(
      <Scene {...props([enc({ seq: 2, battle: { foeMaxHp: 400, myMaxHp: 100, turns: hurt } })])} />,
    );
    await advanceTo('turn');
    expect(document.querySelector('.scene-plate.mine .scene-st')).toBeNull();
    await step(HOLDS.turn);
    expect(document.querySelector('.scene-plate.mine .scene-st')!.textContent).toBe('화상');
  });

  it('says why the bar stopped when hunting has hit its cap', () => {
    // Encounters and TM drops carry on, so the walking half of the caption
    // stays true — it is the countdown that gives way to the reason.
    render(<Scene {...props([enc()])} capped />);
    expect(screen.getByText(/사냥 진행도가 상한에 닿았다/)).toBeTruthy();
    // The pet still walks and still meets things, so the sign stays up — only
    // the countdown gives way to the reason the bar is not moving.
    expect(document.querySelector('.scene-sign')!.textContent).toBe('관동태초마을');
  });

  it('names both sides on their plates', async () => {
    // The message box narrates whichever side is acting this beat, so the plate
    // is the only place a name is on screen continuously. The names were once
    // taken off the plates and nothing in here noticed.
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([enc({ seq: 2 })])} />);
    await advanceTo('enter');
    expect(document.querySelector('.scene-plate.foe .scene-nm')!.textContent).toBe('꼬렛');
    expect(document.querySelector('.scene-plate.mine .scene-nm')!.textContent).toBe('화염레오');
  });

  it('falls back to a silhouette when the wild sprite never arrived', async () => {
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([enc({ seq: 2, wildSprite: null })])} />);
    await advanceTo('enter');
    expect(document.querySelector('.scene-foe .scene-silhouette')).toBeTruthy();
    expect(screen.getByText(/나타났다/)).toBeTruthy(); // the show goes on
  });

  it('falls back to a silhouette when the wild sprite 404s', async () => {
    // happy-dom never fires load or error for these <img>s by itself, which is
    // also why every other sprite assertion in this file stays green.
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([enc({ seq: 2 })])} />);
    await advanceTo('enter');
    fireEvent.error(document.querySelector('.scene-foe img')!);
    expect(document.querySelector('.scene-foe .scene-silhouette')).toBeTruthy();
    // A broken sprite must not take the fight down with it.
    expect(screen.getByText(/나타났다/)).toBeTruthy();
  });

  it('falls back for my own back sprite too', async () => {
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([enc({ seq: 2 })])} />);
    await advanceTo('enter');
    fireEvent.error(document.querySelector('.scene-mine img')!);
    const el = document.querySelector('.scene-mine .scene-silhouette')!;
    expect(el).toBeTruthy();
    // The name still reaches assistive tech; a hidden <img> gave it nothing.
    expect(el.getAttribute('aria-label')).toBe('화염레오');
  });

  it('recovers when the species changes', async () => {
    // Without resetting on `name`, one 404 would leave a silhouette for ever.
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    fireEvent.error(document.querySelector('.scene-walker img')!);
    expect(document.querySelector('.scene-walker .scene-silhouette')).toBeTruthy();

    rerender(
      <Scene
        {...props([enc({ seq: 1 })])}
        companion={{ ...COMPANION, sprite: '667-w.gif' }}
      />,
    );
    expect(document.querySelector('.scene-walker img')).toBeTruthy();
  });

  it('announces a dropped TM in the reward step', async () => {
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([enc({ seq: 2, moveName: '파괴광선' })])} />);
    await advanceTo('reward');
    expect(screen.getByText(/기술머신 파괴광선을 주웠다/)).toBeTruthy();
  });

  it('names a plain tackle when nothing has been taught', async () => {
    const bare = battle(4);
    for (const t of bare.turns) {
      t.moveName = '몸통박치기';
      t.moveType = 'normal';
    }
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([enc({ seq: 2, battle: bare })])} />);
    await advanceTo('turn');
    expect(screen.getByText(/화염레오의 몸통박치기/)).toBeTruthy();
  });

  it('drains both HP bars as the exchanges land', async () => {
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([enc({ seq: 2 })])} />);
    await advanceTo('turn');
    const bars = () =>
      [...document.querySelectorAll('.scene-hp i')].map((el) => (el as HTMLElement).style.width);
    // My swing has landed but I have not been hit yet: 400 -> 310 for the foe,
    // still full for me. That split is the whole point of the two beats — one
    // shared index drained my bar before the opponent had swung.
    expect(bars()).toEqual(['78%', '100%']);
    await step(HOLDS.turn);
    expect(bars()).toEqual(['78%', '88%']);
    await step(HOLDS.counter);
    expect(bars()).toEqual(['55%', '88%']);
    await step(HOLDS.turn);
    expect(bars()).toEqual(['55%', '76%']);
    await exchange();
    await exchange();
    // The felling blow: their bar empties and mine holds where it was.
    expect(bars()).toEqual(['0%', '64%']);
  });

  it('runs longer against a tougher opponent', async () => {
    // Eight exchanges is a legendary; the phase chain has to stretch to fit.
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([enc({ seq: 2, battle: battle(8) })])} />);
    await advanceTo('faint', 8);
    expect(screen.getByText(/쓰러뜨렸다/)).toBeTruthy();
  });

  it('plays once and summarises the rest after an offline catch-up', async () => {
    // Eight hours away settles 96 encounters at once. Animating all of them
    // would take eleven minutes.
    const { rerender } = render(<Scene {...props([enc({ seq: 100 })])} />);
    rerender(<Scene {...props([enc({ seq: 196 })])} />);
    await advanceTo('reward');
    expect(screen.getByText(/자리를 비운 동안 96번 싸웠다/)).toBeTruthy();
    await step(HOLDS.reward);
    expect(document.querySelector('.scene-battle')).toBeNull();
  });

  it('skips on Enter and Space, not just a click', async () => {
    // role="button" on a div gets no activation from the browser, so without an
    // explicit handler this advertised an operable control that was not one.
    for (const key of ['Enter', ' ']) {
      const { rerender, unmount } = render(<Scene {...props([enc({ seq: 1 })])} />);
      rerender(<Scene {...props([enc({ seq: 2 })])} />);
      expect(screen.getByText('!')).toBeTruthy();
      fireEvent.keyDown(screen.getByRole('button', { name: '연출 넘기기' }), { key });
      await act(async () => {});
      expect(document.querySelector('.scene-battle')).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      unmount();
    }
  });

  it('is only in the tab order while something is playing', async () => {
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    expect((document.querySelector('.scene') as HTMLElement).tabIndex).toBe(-1);
    rerender(<Scene {...props([enc({ seq: 2 })])} />);
    expect((document.querySelector('.scene') as HTMLElement).tabIndex).toBe(0);
  });

  it('skips straight back to travelling when clicked', async () => {
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([enc({ seq: 2 })])} />);
    expect(screen.getByText('!')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '연출 넘기기' }));
    expect(document.querySelector('.scene-battle')).toBeNull();
    expect(document.querySelector('.scene-sign')!.textContent).toBe('관동태초마을');
    // The pending phase timer must go with it.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no timer running after unmount', async () => {
    const { rerender, unmount } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([enc({ seq: 2 })])} />);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start a battle while the companion is an egg', async () => {
    const { rerender } = render(
      <Scene {...props([enc({ seq: 1 })])} companion={null} eggSprite="egg.png" />,
    );
    rerender(<Scene {...props([enc({ seq: 2 })])} companion={null} eggSprite="egg.png" />);
    await step(2000);
    expect(document.querySelector('.scene-battle')).toBeNull();
  });
});

describe('Scene — reduced motion', () => {
  it('states the outcome instead of playing the theatre', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('reduced-motion'),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([enc({ seq: 2 })])} />);
    // No "!", no wipe — straight to the result.
    expect(screen.queryByText('!')).toBeNull();
    expect(document.querySelector('.scene-wipe')).toBeNull();
    expect(screen.getByText('+210,227')).toBeTruthy();
    await step(2200);
    expect(document.querySelector('.scene-battle')).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('Scene — trainer battles', () => {
  const round = (turns: number, myFrom = 100): SceneBattle => ({
    foeMaxHp: 200,
    myMaxHp: 100,
    turns: Array.from({ length: turns }, (_, i) => ({
      moveName: '화염방사',
      moveType: 'fire',
      damage: 70,
      crit: false,
      missed: false,
      effect: 1,
      foeHpAfter: i === turns - 1 ? 0 : 200 - (i + 1) * 70,
      foeActed: i !== turns - 1,
      foeMoveName: '물대포',
      foeMoveType: 'water',
      foeEffect: 1,
      moveClass: 'special',
      foeMoveClass: 'special',
      ailmentKo: null,
      foeAilmentKo: null,
      selfEffect: null,
      foeStatusKo: null,
      myStatusKo: null,
      counter: i === turns - 1 ? 0 : 8,
      myHpAfter: myFrom - (i + 1) * 8,
    })),
  });

  const fight = (over: Partial<SceneTrainerFight> = {}): SceneTrainerFight => ({
    name: '낚시꾼 동현',
    won: true,
    lostAt: null,
    sprite: 'npc-fisherman.png',
    team: [
      { speciesId: 129, name: '잉어킹', sprite: '129-a.gif' },
      { speciesId: 130, name: '갸라도스', sprite: '130-a.gif' },
    ],
    rounds: [round(3), round(2, 76)],
    ...over,
  });

  const trainerEnc = (over: Partial<SceneEncounter> = {}) =>
    enc({ seq: 2, battle: null, trainerFight: fight(), ...over });

  /** Alert, wipe and the trainer's own beat — everything before the send-out. */
  const meet = async () => {
    await step(HOLDS.alert);
    await step(HOLDS.wipe);
    await step(HOLDS.meet);
  };

  it('announces the challenge instead of a wild appearance', async () => {
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([trainerEnc()])} />);
    await step(HOLDS.alert);
    await step(HOLDS.wipe);
    expect(document.querySelector('.scene-text')!.textContent).toMatch(/승부를 걸어왔다/);
    expect(screen.queryByText(/나타났다/)).toBeNull();
  });

  it('shows the trainer, and only the trainer, before the first send-out', async () => {
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([trainerEnc()])} />);
    await step(HOLDS.alert);
    await step(HOLDS.wipe);

    // The person is on the platform their Pokemon will stand on.
    const portrait = document.querySelector('.scene-trainer img') as HTMLImageElement;
    expect(portrait.src).toContain('npc-fisherman.png');
    expect(portrait.alt).toBe('낚시꾼 동현');
    // Nobody has thrown anything yet, so neither combatant nor plate is up.
    expect(document.querySelector('.scene-foe')!.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('.scene-mine')!.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('.scene-plate.foe')!.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('.scene-plate.mine')!.hasAttribute('hidden')).toBe(true);

    // And then they step aside for it.
    await step(HOLDS.meet);
    expect(document.querySelector('.scene-trainer')).toBeNull();
    expect(document.querySelector('.scene-foe')!.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('.scene-text')!.textContent).toMatch(/잉어킹을 내보냈다/);
  });

  it('carries on without the portrait when it has not downloaded', async () => {
    // Same rule as the shop clerk: a missing Showdown asset costs the picture
    // and nothing else.
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([trainerEnc({ trainerFight: fight({ sprite: null }) })])} />);
    await step(HOLDS.alert);
    await step(HOLDS.wipe);
    expect(document.querySelector('.scene-trainer img')).toBeNull();
    expect(document.querySelector('.scene-trainer .scene-silhouette')).toBeTruthy();
    expect(document.querySelector('.scene-text')!.textContent).toMatch(/승부를 걸어왔다/);

    await step(HOLDS.meet);
    await step(HOLDS.enter);
    await step(HOLDS.intro);
    await playRound(3);
    expect(screen.getByText(/잉어킹을 쓰러뜨렸다/)).toBeTruthy();
  });

  it('never shows the trainer on a wild encounter', async () => {
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([enc({ seq: 2 })])} />);
    await step(HOLDS.alert);
    await step(HOLDS.wipe);
    // The wipe hands straight to 'enter': no person, and the wild line is up.
    expect(document.querySelector('.scene-trainer')).toBeNull();
    expect(document.querySelector('.scene-text')!.textContent).toMatch(/나타났다/);
  });

  it('shows how many the trainer has left', async () => {
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([trainerEnc()])} />);
    await meet();
    // Dots, not HP bars — the panel keeps exactly two of those.
    expect(document.querySelectorAll('.scene-balls i')).toHaveLength(2);
    expect(document.querySelectorAll('.scene-hp i')).toHaveLength(2);
  });

  it('renames the foe plate as the next team member comes out', async () => {
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([trainerEnc()])} />);
    const foeNm = () => document.querySelector('.scene-plate.foe .scene-nm')!.textContent;

    await advanceTo('enter', 4, true);
    expect(foeNm()).toBe('잉어킹');

    // Round one is three exchanges, then the faint beat and the send-out.
    await step(HOLDS.enter);
    await step(HOLDS.intro);
    await playRound(3);
    await step(HOLDS.faint);
    await step(HOLDS.send);

    expect(document.querySelector('.scene-plate.foe')!.hasAttribute('hidden')).toBe(false);
    expect(foeNm()).toBe('갸라도스');
  });

  it('sends out the next Pokemon after one goes down', async () => {
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([trainerEnc()])} />);
    await meet();
    await step(HOLDS.enter);
    await step(HOLDS.intro);
    // Round one: three exchanges against 잉어킹.
    expect((document.querySelector('.scene-foe img') as HTMLImageElement).src).toContain('129-a.gif');
    await playRound(3);
    expect(screen.getByText(/잉어킹을 쓰러뜨렸다/)).toBeTruthy();

    await step(HOLDS.faint);
    expect(document.querySelector('.scene-text')!.textContent).toMatch(/갸라도스를 내보냈다/);
    expect(document.querySelectorAll('.scene-balls i.out')).toHaveLength(1);

    await step(HOLDS.send);
    await step(HOLDS.enter);
    expect((document.querySelector('.scene-foe img') as HTMLImageElement).src).toContain('130-a.gif');
  });

  /**
   * The complaint: "승부를 걸어왔다" once per Pokemon.
   *
   * 'send' hands the machine back to 'enter', and the message box used to test
   * the phase without the round — so after correctly saying "갸라도스를
   * 내보냈다!" it re-announced the challenge for the 500ms of `enter` plus the
   * 1200ms of `intro`, every time the trainer reached for another Pokemon.
   *
   * The challenge has a beat of its own now, which is a stronger answer to the
   * same complaint: 'meet' happens once and every send-out reads alike.
   */
  it('challenges once, not once per Pokemon', async () => {
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([trainerEnc()])} />);
    const text = () => document.querySelector('.scene-text')!.textContent!;

    await step(HOLDS.alert);
    await step(HOLDS.wipe);
    // 'meet' says it, and it is the only beat that does.
    expect(text()).toMatch(/승부를 걸어왔다/);
    await step(HOLDS.meet);
    expect(text()).not.toMatch(/승부를 걸어왔다/);
    expect(text()).toMatch(/잉어킹을 내보냈다/);
    await step(HOLDS.enter);
    expect(text()).toMatch(/잉어킹을 내보냈다/);

    await step(HOLDS.intro);
    await playRound(3);
    await step(HOLDS.faint);
    expect(text()).toMatch(/갸라도스를 내보냈다/);

    // Both entry beats of round two, which is where it used to come back.
    await step(HOLDS.send);
    expect(text()).not.toMatch(/승부를 걸어왔다/);
    expect(text()).toMatch(/갸라도스를 내보냈다/);
    await step(HOLDS.enter);
    expect(text()).not.toMatch(/승부를 걸어왔다/);
    expect(text()).toMatch(/갸라도스를 내보냈다/);
    // And the person does not come back with them.
    expect(document.querySelector('.scene-trainer')).toBeNull();
  });

  /**
   * The same re-entry replayed the transformation beat.
   *
   * `formKind` is per ENCOUNTER, not per round, so the skip guard passed again
   * on the way back through 'send' and the second Pokemon arrived to
   * "거다이맥스했다!" all over again — 1.4s of a thing that happened once, at
   * the top of the fight.
   */
  it('transforms once, not once per Pokemon', async () => {
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(
      <Scene
        {...props([
          trainerEnc({
            formKo: '거다이맥스 리자몽',
            formKind: 'gmax' as const,
            formBackSprite: '10196-wb.gif',
          }),
        ])}
      />,
    );
    const text = () => document.querySelector('.scene-text')!.textContent!;

    await meet();
    await step(HOLDS.enter);
    await step(HOLDS.intro);
    // Round one gets the beat.
    expect(text()).toMatch(/거다이맥스 리자몽/);

    await step(HOLDS.form);
    await playRound(3);
    await step(HOLDS.faint);
    await step(HOLDS.send);
    await step(HOLDS.enter);
    await step(HOLDS.intro);
    // Round two steps straight from 'intro' into the fight.
    expect(text()).not.toMatch(/변했다/);
    expect(text()).toMatch(/의 /);
  });

  it('pays out only after the whole team is down', async () => {
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([trainerEnc()])} />);
    await meet();
    await step(HOLDS.enter);
    await step(HOLDS.intro);
    await playRound(3);
    await step(HOLDS.faint);
    await step(HOLDS.send);
    await step(HOLDS.enter);
    await step(HOLDS.intro);
    await playRound(2);
    await step(HOLDS.faint);
    // The name is its own text node, so the line is split across children.
    expect(document.querySelector('.scene-text')!.textContent).toMatch(/낚시꾼 동현을 이겼다/);
    expect(screen.getByText('+210,227')).toBeTruthy();
  });

  it('says so when the companion is the one that goes down', async () => {
    const lost = fight({ won: false, lostAt: 0, rounds: [round(3)] });
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([trainerEnc({ trainerFight: lost })])} />);
    await meet();
    await step(HOLDS.enter);
    await step(HOLDS.intro);
    await playRound(3);
    expect(screen.getByText(/눈앞이 캄캄해졌다/)).toBeTruthy();
    await step(HOLDS.faint);
    expect(document.querySelector('.scene-text')!.textContent).toMatch(/낚시꾼 동현에게 지고 말았다/);
    // A loss pays nothing, so no progress line.
    expect(screen.queryByText(/진행도/)).toBeNull();
  });

  it('drains the foe bar per round rather than across the whole fight', async () => {
    const { rerender } = render(<Scene {...props([enc({ seq: 1 })])} />);
    rerender(<Scene {...props([trainerEnc()])} />);
    await meet();
    await step(HOLDS.enter);
    const bars = () =>
      [...document.querySelectorAll('.scene-hp i')].map((el) => (el as HTMLElement).style.width);
    // Still on intro: nothing has landed yet.
    expect(bars()).toEqual(['100%', '100%']);

    await step(HOLDS.intro);
    expect(bars()[0]).toBe('65%');
    await playRound(3);
    await step(HOLDS.faint);
    await step(HOLDS.send);
    await step(HOLDS.enter);
    await step(HOLDS.intro);
    // The second Pokemon comes in on a fresh bar of its own; mine does not.
    expect(bars()[0]).toBe('65%');
    expect(Number(bars()[1].replace('%', ''))).toBeLessThan(100);
  });
});
