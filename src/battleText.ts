import { josa } from './josa.ts';

/**
 * What the battle box says, from what the fight recorded.
 *
 * The server records WHAT happened as data (server/hunt.ts `BattleEvent`,
 * `EndEvent`) and this turns it into sentences, because only the scene knows
 * what to call each side — a nickname, a party member, a trainer's Pokemon.
 * Kept out of Scene.tsx so the reducer can count a beat's pages with the same
 * function the render uses, and so the lines can be tested without a DOM.
 *
 * The types here mirror the server's rather than importing them: the renderer
 * never imports server code (see server/state.ts, which resolves every name).
 */

export type SceneSkip =
  | 'paralysis'
  | 'sleep'
  | 'freeze'
  | 'confusion'
  | 'infatuation'
  | 'flinch'
  | 'recharge'
  | 'taunt'
  | 'heal-block'
  | 'imprison'
  | 'torment'
  | 'throat-chop'
  | 'held'
  | 'disabled'
  | 'truant';
export type SceneCured = 'sleep' | 'freeze' | 'confusion';
export type SceneSelf = 'heal' | 'failed' | null;
export type SceneStat = 'atk' | 'def' | 'spa' | 'spd' | 'spe' | 'acc' | 'eva';
export type SceneWeather = 'rain' | 'sun' | 'sand' | 'hail' | 'snow' | 'winds';
export type SceneTerrain = 'electric' | 'grassy' | 'misty' | 'psychic';
export type SceneScreen = 'reflect' | 'lightScreen' | 'auroraVeil' | 'tailwind';
export type SceneHazard = 'spikes' | 'toxicSpikes' | 'stealthRock' | 'stickyWeb';
export type SceneGuard = 'wide' | 'quick' | 'crafty';
export type SceneRoom = 'gravity' | 'wonderRoom' | 'magicRoom';

/** One side's move, beyond its damage line. `on` is relative to the mover. */
export type SceneEvent =
  | { k: 'stat'; on: 'user' | 'target'; stat: SceneStat; delta: number; tried: number }
  | { k: 'weather'; set: SceneWeather }
  | { k: 'terrain'; set: SceneTerrain }
  | { k: 'terrain-cleared' }
  | { k: 'screen'; set: SceneScreen }
  | { k: 'trick-room'; on: boolean }
  | { k: 'room'; set: SceneRoom; on: boolean }
  | { k: 'hits'; n: number; crits?: number }
  | { k: 'drain'; hp: number }
  | { k: 'recoil'; hp: number }
  | { k: 'crash'; hp: number }
  | { k: 'charge'; moveId: number; moveKo?: string }
  | { k: 'protect' }
  | { k: 'blocked' }
  | { k: 'endure' }
  | { k: 'endured' }
  | { k: 'self-ko' }
  | { k: 'thaw' }
  | { k: 'ohko' }
  /** `moveKo` is resolved server-side, like every other move name. */
  | { k: 'call'; by?: 'sleep-talk' | 'metronome' | 'nature-power' | 'copycat' | 'instruct'; moveId: number; moveKo?: string }
  | { k: 'substitute' }
  | { k: 'sub-hit' }
  | { k: 'sub-broke' }
  | { k: 'taunt' }
  | { k: 'encore' }
  | { k: 'spite'; moveId: number; moveKo?: string; n: number }
  | { k: 'haze' }
  | { k: 'focus' }
  | { k: 'curse'; ghost: boolean }
  | { k: 'safeguard' }
  | { k: 'pain-split' }
  | { k: 'psych-up' }
  | { k: 'swap'; what: 'power' | 'guard' | 'speed' }
  | { k: 'mimic'; moveId: number; moveKo?: string }
  | { k: 'hazard'; set: SceneHazard; layers: number }
  | { k: 'defog' }
  | { k: 'screens-broken' }
  | { k: 'telekinesis' }
  | { k: 'imprison' }
  | { k: 'snatch' }
  | { k: 'snatched'; moveId: number; moveKo?: string }
  | { k: 'heal-block' }
  | { k: 'future' }
  | { k: 'forced-out' }
  | { k: 'retreat' }
  | { k: 'rampage-end' }
  | { k: 'uproar'; start: boolean }
  | { k: 'uproar-end' }
  | { k: 'uproar-wake' }
  | { k: 'bide' }
  | { k: 'bide-release' }
  | { k: 'grounded' }
  | { k: 'rage' }
  | { k: 'charged' }
  | { k: 'half-cost'; hp: number }
  | { k: 'sky-drop' }
  | { k: 'seeded' }
  | { k: 'perish' }
  | { k: 'drowsy' }
  | { k: 'disable'; moveId: number; moveKo?: string }
  | { k: 'belly-drum' }
  | { k: 'stockpile'; n: number }
  | { k: 'stockpile-gone' }
  | { k: 'wish' }
  | { k: 'magic-coat' }
  | { k: 'bounced'; moveId: number; moveKo?: string }
  | { k: 'destiny-bond' }
  | { k: 'destiny-bond-took' }
  | { k: 'grudge' }
  | { k: 'grudge-took'; moveId: number; moveKo?: string }
  | { k: 'cure-team' }
  | { k: 'no-escape'; both?: boolean }
  | { k: 'identified' }
  | { k: 'splash' }
  | { k: 'transform' }
  | { k: 'sketch'; moveId: number; moveKo?: string }
  | { k: 'lock-on' }
  | { k: 'type'; on: 'user' | 'target'; types: string[]; typesKo?: string[] }
  | { k: 'healing-wish' }
  | { k: 'psycho-shift' }
  | { k: 'power-trick' }
  | { k: 'split'; what: 'power' | 'guard' }
  | { k: 'heart-swap' }
  | { k: 'topsy-turvy' }
  | { k: 'guard'; set: SceneGuard }
  | { k: 'guarded'; by: SceneGuard }
  | { k: 'after-you' }
  | { k: 'electrify' }
  | { k: 'fairy-lock' }
  | { k: 'mist' }
  | { k: 'mist-held' }
  | { k: 'court-change' }
  | { k: 'revival'; slot: number }
  | { k: 'shed-tail' }
  | { k: 'tidy-up' }
  | { k: 'laser-focus' }
  | { k: 'ingrain' }
  | { k: 'aqua-ring' }
  | { k: 'magnet-rise' }
  | { k: 'octolock' }
  | { k: 'salted' }
  | { k: 'syrup' }
  | { k: 'spin' }
  | { k: 'feint' }
  | { k: 'sting'; hp: number }
  | { k: 'stolen' }
  | { k: 'beak' }
  | { k: 'shell-trap' }
  | { k: 'no-retreat' }
  | { k: 'present-heal'; hp: number }
  | { k: 'cured-burn' }
  | { k: 'heal-target'; hp: number }
  | { k: 'cured-target' }
  | { k: 'type-lost'; type: string; typeKo?: string }
  | { k: 'plasma' }
  | { k: 'nothing' }
  | { k: 'instructed'; moveId: number; moveKo?: string }
  | { k: 'self-status'; condition: string }
  | { k: 'cleared' }
  | { k: 'sport'; what: 'water' | 'mud' }
  | { k: 'ability'; on: 'user' | 'target'; ability: string; abilityKo?: string }
  | { k: 'immune'; on: 'user' | 'target' }
  | { k: 'stat-held'; on: 'user' | 'target' }
  | { k: 'form'; on: 'user' | 'target'; form: string }
  | { k: 'hurt'; on: 'user' | 'target'; hp: number }
  | { k: 'heal'; on: 'user' | 'target'; hp: number }
  | { k: 'ability-lost'; on: 'user' | 'target' }
  | { k: 'ability-set'; on: 'user' | 'target'; ability: string; abilityKo?: string }
  | { k: 'ability-swap' }
  | { k: 'fled'; who: 'user' | 'target' };

/** After both sides moved, or as somebody came in. `on` is absolute: 'me' is the companion's side. */
export type SceneEndEvent =
  | { k: 'weather-chip'; on: 'me' | 'foe'; weather: SceneWeather; hp: number }
  | { k: 'weather-end'; weather: SceneWeather }
  | { k: 'status-chip'; on: 'me' | 'foe'; condition: string; hp: number }
  | { k: 'terrain-heal'; on: 'me' | 'foe'; hp: number }
  | { k: 'terrain-end'; terrain: SceneTerrain }
  | { k: 'screen-end'; on: 'me' | 'foe'; screen: SceneScreen | 'safeguard' }
  | { k: 'trick-room-end' }
  | { k: 'room-end'; room: SceneRoom }
  | { k: 'wore-off'; on: 'me' | 'foe'; what: 'taunt' | 'encore' | 'telekinesis' | 'heal-block' }
  | { k: 'future-hit'; on: 'me' | 'foe'; hp: number }
  | { k: 'hazard-hit'; on: 'me' | 'foe'; hazard: 'spikes' | 'stealthRock'; hp: number }
  | { k: 'toxic-spikes'; on: 'me' | 'foe'; condition: 'poison' | 'toxic' }
  | { k: 'toxic-spikes-gone'; on: 'me' | 'foe' }
  | { k: 'sticky-web'; on: 'me' | 'foe' }
  | { k: 'leech-seed'; on: 'me' | 'foe'; hp: number; healed: number }
  | { k: 'perish'; on: 'me' | 'foe'; n: number }
  | { k: 'yawn-sleep'; on: 'me' | 'foe' }
  | { k: 'wish'; on: 'me' | 'foe'; hp: number }
  | { k: 'ring-heal'; on: 'me' | 'foe'; hp: number; what: 'ingrain' | 'aqua-ring' }
  | { k: 'salt'; on: 'me' | 'foe'; hp: number }
  | { k: 'syrup'; on: 'me' | 'foe' }
  | { k: 'octolock'; on: 'me' | 'foe' }
  | { k: 'healed-in'; on: 'me' | 'foe' }
  | { k: 'end-stat'; on: 'me' | 'foe'; stat: SceneStat; delta: number }
  | { k: 'wore-off-2'; on: 'me' | 'foe'; what: 'disable' | 'magnet-rise' | 'mist' }
  | { k: 'sport-end'; what: 'water' | 'mud' }
  | { k: 'ability'; on: 'me' | 'foe'; ability: string; abilityKo?: string }
  | { k: 'weather-set'; weather: SceneWeather }
  | { k: 'terrain-set'; terrain: SceneTerrain }
  | { k: 'end-heal'; on: 'me' | 'foe'; hp: number }
  | { k: 'end-hurt'; on: 'me' | 'foe'; hp: number }
  | { k: 'end-cured'; on: 'me' | 'foe' }
  | { k: 'end-form'; on: 'me' | 'foe'; form: string }
  | { k: 'end-transform'; on: 'me' | 'foe' }
  | { k: 'end-trace'; on: 'me' | 'foe'; ability: string; abilityKo?: string }
  | { k: 'end-type'; on: 'me' | 'foe'; types: string[]; typesKo?: string[] }
  | { k: 'end-screens-gone' }
  | { k: 'end-shudder'; on: 'me' | 'foe' }
  | { k: 'end-forewarn'; on: 'me' | 'foe'; moveId: number; moveKo?: string }
  | { k: 'end-stat-held'; on: 'me' | 'foe' };

/** One side's half of the field: screens and Tailwind as turns left, hazards as layers. */
export type SceneSideField = Partial<Record<SceneScreen | 'safeguard' | SceneHazard, number>>;

/** The field once a turn is over, for the chip at the top of the stage. */
export type SceneField = {
  weather: SceneWeather | null;
  weatherTurns: number;
  terrain: SceneTerrain | null;
  terrainTurns: number;
  trickRoom: number;
  rooms?: Partial<Record<SceneRoom, number>>;
  mine: SceneSideField;
  theirs: SceneSideField;
};

const eun = (name: string) => `${name}${josa(name, '은', '는')}`;
const eul = (name: string) => `${name}${josa(name, '을', '를')}`;
const iga = (name: string) => `${name}${josa(name, '이', '가')}`;

export const ROOM_KO: Record<SceneRoom, string> = {
  gravity: '중력',
  wonderRoom: '원더룸',
  magicRoom: '매직룸',
};

/** What the charge turn of each two-turn move looks like. */
const CHARGE_KO: Record<number, (name: string) => string> = {
  76: (n) => `${eun(n)} 빛을 흡수했다!`,
  669: (n) => `${eun(n)} 빛을 흡수했다!`,
  19: (n) => `${eun(n)} 하늘 높이 날아올랐다!`,
  340: (n) => `${eun(n)} 높이 뛰어올랐다!`,
  91: (n) => `${eun(n)} 땅으로 파고들었다!`,
  291: (n) => `${eun(n)} 물속으로 숨었다!`,
  566: (n) => `${eun(n)} 순식간에 모습을 감췄다!`,
  467: (n) => `${eun(n)} 순식간에 모습을 감췄다!`,
  130: (n) => `${eun(n)} 목을 움츠렸다!`,
  143: (n) => `${iga(n)} 격렬한 빛에 휩싸였다!`,
  13: (n) => `${n}의 주위에서 공기가 소용돌이친다!`,
  800: (n) => `${n}에게 우주의 힘이 넘쳐흐른다!`,
};

const STAT_KO: Record<SceneStat, string> = {
  atk: '공격',
  def: '방어',
  spa: '특수공격',
  spd: '특수방어',
  spe: '스피드',
  acc: '명중률',
  eva: '회피율',
};

export const WEATHER_KO: Record<SceneWeather, string> = {
  rain: '비',
  sun: '쾌청',
  sand: '모래바람',
  hail: '싸라기눈',
  snow: '설경',
  winds: '난기류',
};

export const TERRAIN_KO: Record<SceneTerrain, string> = {
  electric: '일렉트릭필드',
  grassy: '그래스필드',
  misty: '미스트필드',
  psychic: '사이코필드',
};

export const SCREEN_KO: Record<SceneScreen, string> = {
  reflect: '리플렉터',
  lightScreen: '빛의장막',
  auroraVeil: '오로라베일',
  tailwind: '순풍',
};

const WEATHER_START: Record<SceneWeather, string> = {
  rain: '비가 내리기 시작했다!',
  sun: '햇살이 강해졌다!',
  sand: '모래바람이 불기 시작했다!',
  hail: '싸라기눈이 내리기 시작했다!',
  snow: '눈이 내리기 시작했다!',
  winds: '수수께끼의 난기류가 비행 포켓몬을 지킨다!',
};

const WEATHER_END: Record<SceneWeather, string> = {
  rain: '비가 그쳤다!',
  sun: '햇살이 원래대로 돌아왔다!',
  sand: '모래바람이 가라앉았다!',
  hail: '싸라기눈이 그쳤다!',
  snow: '눈이 그쳤다!',
  winds: '수수께끼의 난기류가 사라졌다!',
};

const TERRAIN_START: Record<SceneTerrain, string> = {
  electric: '발밑에 전기가 흐르기 시작했다!',
  grassy: '발밑에 풀이 무성해졌다!',
  misty: '발밑에 안개가 자욱해졌다!',
  psychic: '발밑이 이상한 느낌으로 가득 찼다!',
};

const TERRAIN_END: Record<SceneTerrain, string> = {
  electric: '발밑의 전기가 사라졌다!',
  grassy: '발밑의 풀이 사라졌다!',
  misty: '발밑의 안개가 사라졌다!',
  psychic: '발밑의 이상한 느낌이 사라졌다!',
};

const SCREEN_START: Record<SceneScreen, string> = {
  reflect: '물리 공격에 강해졌다!',
  lightScreen: '특수 공격에 강해졌다!',
  auroraVeil: '물리 공격과 특수 공격에 강해졌다!',
  tailwind: '등 뒤에서 순풍이 불기 시작했다!',
};

const CHIP_KO: Record<string, string> = {
  burn: '화상 데미지를 입었다!',
  poison: '독 데미지를 입었다!',
  toxic: '독 데미지를 입었다!',
  trap: '조이는 데미지를 입었다!',
  nightmare: '악몽에 시달리고 있다!',
};

/** What a side says when its move never happened. `move` names what was barred. */
export function skipLine(name: string, skip: SceneSkip, move = '기술'): string {
  switch (skip) {
    case 'taunt':
      return `${eun(name)} 도발당해서 ${eul(move)} 쓸 수 없다!`;
    case 'heal-block':
      return `${eun(name)} 회복봉인 때문에 ${eul(move)} 쓸 수 없다!`;
    case 'imprison':
      return `${eun(name)} 봉인당해서 ${eul(move)} 쓸 수 없다!`;
    case 'torment':
      return `${eun(name)} 트집 때문에 같은 기술을 연속으로 쓸 수 없다!`;
    case 'throat-chop':
      return `${eun(name)} 지옥찌르기의 효과로 ${eul(move)} 쓸 수 없다!`;
    case 'held':
      return `${eun(name)} 하늘에 붙잡혀 있어서 움직일 수 없다!`;
    case 'disabled':
      return `${eun(name)} 사슬묶기 때문에 ${eul(move)} 쓸 수 없다!`;
    case 'truant':
      return `${eun(name)} 게으름을 피우고 있다!`;
    case 'sleep':
      return `${eun(name)} 쿨쿨 잠들어 있다.`;
    case 'freeze':
      return `${eun(name)} 얼어붙어서 움직일 수 없다!`;
    case 'paralysis':
      return `${eun(name)} 몸이 저려서 움직일 수 없다!`;
    case 'infatuation':
      return `${eun(name)} 헤롱헤롱해서 기술을 쓸 수 없었다!`;
    case 'confusion':
      return `${eun(name)} 영문도 모르고 자신을 공격했다!`;
    case 'flinch':
      return `${eun(name)} 풀이 죽어 움직일 수 없다!`;
    case 'recharge':
      return `${eun(name)} 공격의 반동으로 움직일 수 없다!`;
  }
}

/** What a side says when a condition lifts right before it moves. */
export function curedLine(name: string, cured: SceneCured): string {
  return cured === 'sleep'
    ? `${eun(name)} 눈을 떴다!`
    : cured === 'freeze'
      ? `${name}의 얼음이 녹았다!`
      : `${name}의 혼란이 풀렸다!`;
}

/** One stage change, the way the games word it. */
export function statLine(name: string, stat: SceneStat, delta: number, tried: number): string {
  const s = STAT_KO[stat];
  const subj = `${name}의 ${s}${josa(s, '이', '가')}`;
  if (delta === 0) return tried > 0 ? `${subj} 더 올라가지 않는다!` : `${subj} 더 떨어지지 않는다!`;
  const size = Math.abs(delta) >= 3 ? '매우 크게 ' : Math.abs(delta) === 2 ? '크게 ' : '';
  return `${subj} ${size}${delta > 0 ? '올랐다!' : '떨어졌다!'}`;
}

/** An ability announcing itself, the way the games' banner reads: [리자몽의 선파워]. */
export function abilityLine(name: string, ability: string): string {
  return `[${name}의 ${ability}]`;
}

/** Every line one event adds, from the mover's side. Most add one; a few add none. */
export function eventLines(user: string, target: string, e: SceneEvent): string[] {
  switch (e.k) {
    case 'stat':
      return [statLine(e.on === 'user' ? user : target, e.stat, e.delta, e.tried)];
    case 'weather':
      return [WEATHER_START[e.set]];
    case 'terrain':
      return [TERRAIN_START[e.set]];
    case 'terrain-cleared':
      return ['발밑이 원래대로 돌아왔다!'];
    case 'screen':
      return [SCREEN_START[e.set]];
    case 'trick-room':
      return [e.on ? '시공이 뒤틀렸다!' : '뒤틀린 시공이 원래대로 돌아왔다!'];
    case 'room':
      return [
        e.set === 'gravity'
          ? '중력이 강해졌다!'
          : e.on
            ? e.set === 'wonderRoom'
              ? '방어와 특수방어가 뒤바뀌는 공간이 되었다!'
              : '도구의 효과가 사라지는 공간이 되었다!'
            : `${ROOM_KO[e.set]}${josa(ROOM_KO[e.set], '이', '가')} 원래대로 돌아왔다!`,
      ];
    case 'hits':
      // Each critical hit of a multi-hit move is its own line, as in the games.
      return [...Array<string>(e.crits ?? 0).fill('급소에 맞았다!'), `${e.n}번 맞았다!`];
    case 'drain':
      return [`${target}의 체력을 흡수했다!`];
    case 'recoil':
      return [`${eun(user)} 공격의 반동을 받았다!`];
    case 'crash':
      return [`${eun(user)} 기세가 넘쳐 땅에 부딪혔다!`];
    case 'charge':
      // 프리폴's lift is said by its own `sky-drop` line, which names the target.
      if (e.moveId === 507) return [];
      return [(CHARGE_KO[e.moveId] ?? ((n: string) => `${eun(n)} 힘을 모으고 있다!`))(user)];
    case 'protect':
      return [`${eun(user)} 방어 태세에 들어갔다!`];
    case 'blocked':
      return [`${eun(target)} 공격으로부터 몸을 지켰다!`];
    case 'endure':
      return [`${eun(user)} 버티기 태세에 들어갔다!`];
    case 'endured':
      return [`${eun(target)} 공격을 버텼다!`];
    case 'thaw':
      return [`${target}의 얼음이 녹았다!`];
    case 'ohko':
      return ['일격필살!'];
    case 'call':
      if (!e.moveKo) return [];
      return [
        e.by === 'metronome'
          ? `${iga(e.moveKo)} 나왔다!`
          : e.by === 'nature-power'
            ? `자연의힘은 ${e.moveKo}${josa(e.moveKo, '이', '가')} 되었다!`
            : e.by === 'copycat'
              ? `${eun(user)} ${eul(e.moveKo)} 따라 했다!`
              : `잠꼬대로 ${eul(e.moveKo)} 썼다!`,
      ];
    case 'substitute':
      return [`${user}의 대타가 나타났다!`];
    case 'sub-hit':
      return [`대타가 ${target} 대신 공격을 받았다!`];
    case 'sub-broke':
      return [`${target}의 대타는 사라져 버렸다…`];
    case 'taunt':
      return [`${eun(target)} 도발에 넘어가 버렸다!`];
    case 'encore':
      return [`${eun(target)} 앙코르를 받았다!`];
    case 'spite':
      return e.moveKo ? [`${target}의 ${e.moveKo} PP가 ${e.n} 줄었다!`] : [];
    case 'haze':
      return ['모든 능력 변화가 원래대로 돌아왔다!'];
    case 'focus':
      return [`${eun(user)} 한껏 기합이 들어갔다!`];
    case 'curse':
      return e.ghost ? [`${eun(user)} 자신의 체력을 깎아서 ${eul(target)} 저주했다!`] : [];
    case 'safeguard':
      return [`${user} 쪽은 신비의 베일에 둘러싸였다!`];
    case 'pain-split':
      return ['서로의 체력을 나눠 가졌다!'];
    case 'psych-up':
      return [`${eun(user)} ${target}의 능력 변화를 복사했다!`];
    case 'swap':
      return [
        e.what === 'speed'
          ? `${eun(user)} ${target}${josa(target, '과', '와')} 스피드를 바꿨다!`
          : `${eun(user)} ${target}${josa(target, '과', '와')} ${e.what === 'power' ? '공격과 특수공격' : '방어와 특수방어'}의 능력 변화를 바꿨다!`,
      ];
    case 'mimic':
      return e.moveKo ? [`${eun(user)} ${eul(e.moveKo)} 배웠다!`] : [];
    case 'hazard':
      return [
        e.set === 'spikes'
          ? `${target} 쪽 발밑에 압정이 뿌려졌다!`
          : e.set === 'toxicSpikes'
            ? `${target} 쪽 발밑에 독압정이 뿌려졌다!`
            : e.set === 'stickyWeb'
              ? `${target} 쪽 발밑에 끈적끈적네트가 펼쳐졌다!`
              : `${target} 쪽 주위에 뾰족한 바위가 떠다니기 시작했다!`,
      ];
    case 'defog':
      return [`${eun(user)} 안개를 날려버렸다!`];
    case 'screens-broken':
      return ['벽을 깨뜨렸다!'];
    case 'telekinesis':
      return [`${eun(target)} 공중에 떠올랐다!`];
    case 'imprison':
      return [`${eun(user)} 상대의 기술을 봉인했다!`];
    case 'snatch':
      return [`${eun(user)} 상대의 움직임을 엿보고 있다!`];
    case 'snatched':
      return e.moveKo ? [`${iga(target)} ${user}의 ${eul(e.moveKo)} 가로챘다!`] : [];
    case 'heal-block':
      return [`${eun(target)} 회복할 수 없게 되었다!`];
    case 'future':
      return [`${eun(user)} 미래를 내다봤다!`];
    case 'forced-out':
      return [`${eun(target)} 날려가 버렸다!`];
    case 'retreat':
      return [`${eun(user)} 물러났다!`];
    case 'fled':
      return [e.who === 'user' ? `${eun(user)} 도망쳤다!` : `${eun(target)} 날려가 버렸다!`];
    case 'rampage-end':
      return [`${eun(user)} 지쳐서 혼란에 빠졌다!`];
    case 'uproar':
      return [e.start ? `${eun(user)} 소란을 피우기 시작했다!` : `${eun(user)} 소란을 피우고 있다!`];
    case 'uproar-end':
      return [`${eun(user)} 소란피기를 멈췄다!`];
    case 'uproar-wake':
      return ['소란 때문에 눈을 떴다!'];
    case 'bide':
      return [`${eun(user)} 참고 있다!`];
    case 'bide-release':
      return [`${iga(user)} 참았던 힘을 방출했다!`];
    case 'grounded':
      return [`${eun(target)} 땅으로 떨어졌다!`];
    case 'rage':
      return [`${target}의 분노 볼티지가 올라간다!`];
    case 'charged':
      return [`${eun(user)} 충전했다!`];
    case 'half-cost':
      return [`${eun(user)} 자신의 체력을 깎았다!`];
    case 'sky-drop':
      return [`${eun(user)} ${eul(target)} 하늘로 데려갔다!`];
    case 'seeded':
      return [`${target}에게 씨앗을 심었다!`];
    case 'perish':
      return ['멸망의노래를 들은 포켓몬은 3턴 후에 쓰러진다!'];
    case 'drowsy':
      return [`${eun(target)} 졸음이 오기 시작했다!`];
    case 'disable':
      return e.moveKo ? [`${target}의 ${eul(e.moveKo)} 봉인했다!`] : [];
    case 'belly-drum':
      return [`${eun(user)} 체력을 깎아서 공격을 최대로 올렸다!`];
    case 'stockpile':
      return [`${eun(user)} ${e.n}개 비축했다!`];
    case 'stockpile-gone':
      return [`${user}의 비축이 사라졌다!`];
    case 'wish':
      return [`${eun(user)} 소원을 빌었다!`];
    case 'magic-coat':
      return [`${eun(user)} 매직코트로 몸을 감쌌다!`];
    case 'bounced':
      return e.moveKo ? [`${iga(target)} ${eul(e.moveKo)} 튕겨냈다!`] : [];
    case 'destiny-bond':
      return [`${eun(user)} 상대를 길동무로 삼으려 하고 있다!`];
    case 'destiny-bond-took':
      return [`${eun(target)} ${eul(user)} 길동무로 삼았다!`];
    case 'grudge':
      return [`${eun(user)} 상대에게 원념을 품으려 하고 있다!`];
    case 'grudge-took':
      return e.moveKo ? [`${user}의 ${iga(e.moveKo)} 원념으로 PP가 0이 되었다!`] : [];
    case 'cure-team':
      return ['동료의 상태이상이 나았다!'];
    case 'no-escape':
      return [e.both ? '서로 도망칠 수 없게 되었다!' : `${eun(target)} 이제 도망칠 수 없다!`];
    case 'identified':
      return [`${iga(user)} ${eul(target)} 꿰뚫어 보았다!`];
    case 'splash':
    case 'nothing':
      return ['하지만 아무 일도 일어나지 않았다!'];
    case 'transform':
      return [`${eun(user)} ${target}${josa(target, '으로', '로')} 변신했다!`];
    case 'sketch':
      return e.moveKo ? [`${eun(user)} ${eul(e.moveKo)} 스케치했다!`] : [];
    case 'lock-on':
      return [`${eun(user)} ${eul(target)} 노려보았다!`];
    case 'type': {
      const who = e.on === 'user' ? user : target;
      const ko = (e.typesKo ?? e.types).join('·');
      return [`${who}의 타입이 ${ko}${josa(ko, '이', '가')} 되었다!`];
    }
    case 'healing-wish':
      return [`${eun(user)} 동료를 위해 몸을 바쳤다!`];
    case 'psycho-shift':
      return [`${eun(user)} 상태이상을 옮겼다!`];
    case 'power-trick':
      return [`${eun(user)} 공격과 방어를 바꿨다!`];
    case 'split':
      return [e.what === 'power' ? '서로의 파워를 나눠 가졌다!' : '서로의 가드를 나눠 가졌다!'];
    case 'heart-swap':
      return [`${eun(user)} ${target}${josa(target, '과', '와')} 능력 변화를 바꿨다!`];
    case 'topsy-turvy':
      return [`${target}의 능력 변화가 뒤집혔다!`];
    case 'guard':
      return [GUARD_START[e.set](user)];
    case 'guarded':
      return [`${eun(target)} ${GUARD_KO[e.by]}로 몸을 지켰다!`];
    case 'after-you':
      return [`${eun(target)} 호의를 받아들였다!`];
    case 'electrify':
      return [`${target}의 기술이 전기 타입이 되었다!`];
    case 'fairy-lock':
      return ['다음 턴에는 아무도 도망칠 수 없다!'];
    case 'mist':
      return [`${user} 쪽이 흰안개에 둘러싸였다!`];
    case 'mist-held':
      return [`${eun(target)} 흰안개에 둘러싸여 있다!`];
    case 'court-change':
      return [`${eun(user)} 서로의 필드 효과를 바꿨다!`];
    case 'revival':
      return ['쓰러진 동료가 기운을 되찾았다!'];
    case 'shed-tail':
      return [`${eun(user)} 꼬리를 잘라 대타로 삼았다!`];
    case 'tidy-up':
      return ['정리정돈을 해서 설치물과 대타가 사라졌다!'];
    case 'laser-focus':
      return [`${eun(user)} 신경이 예민해졌다!`];
    case 'ingrain':
      return [`${eun(user)} 뿌리를 뻗었다!`];
    case 'aqua-ring':
      return [`${eun(user)} 물의 베일로 몸을 감쌌다!`];
    case 'magnet-rise':
      return [`${eun(user)} 전자력으로 떠올랐다!`];
    case 'octolock':
      return [`${eun(target)} 문어굳히기에 걸렸다!`];
    case 'salted':
      return [`${eun(target)} 소금절이가 되었다!`];
    case 'syrup':
      return [`${eun(target)} 끈적끈적한 시럽을 뒤집어썼다!`];
    case 'spin':
      return [`${eun(user)} 몸을 옭아매던 것에서 벗어났다!`];
    case 'feint':
      return [`${eun(target)} 방어가 풀렸다!`];
    case 'sting':
      return e.hp > 0 ? [`${eun(user)} 상처를 입었다!`] : [];
    case 'stolen':
      return [`${eun(user)} ${target}의 능력 변화를 빼앗았다!`];
    case 'beak':
      return [`${eun(user)} 부리를 가열하기 시작했다!`];
    case 'shell-trap':
      return [`${eun(user)} 트랩셸을 설치했다!`];
    case 'no-retreat':
      return [`${eun(user)} 배수의 진을 쳤다!`];
    case 'present-heal':
      return [`${target}의 체력이 회복됐다!`];
    case 'cured-burn':
      return [`${target}의 화상이 나았다!`];
    case 'heal-target':
      return [`${target}의 체력이 회복됐다!`];
    case 'cured-target':
      return ['상태이상이 나았다!'];
    case 'type-lost':
      return [`${user}의 ${e.typeKo ?? e.type} 타입이 사라졌다!`];
    case 'plasma':
      return ['전자 샤워가 쏟아졌다!'];
    case 'instructed':
      return e.moveKo ? [`${eun(target)} 지휘를 받아 ${eul(e.moveKo)} 한 번 더 썼다!`] : [];
    case 'self-status':
      return [`${eun(user)} ${SELF_STATUS_KO[e.condition] ?? '상태가 이상해졌다!'}`];
    case 'cleared':
      return [`${target}의 능력 변화가 원래대로 돌아왔다!`];
    case 'sport':
      return [e.what === 'water' ? '불꽃의 위력이 약해졌다!' : '전기의 위력이 약해졌다!'];
    case 'ability':
      return [abilityLine(e.on === 'user' ? user : target, e.abilityKo ?? e.ability)];
    case 'immune':
      return [`${e.on === 'user' ? user : target}에게는 효과가 없는 것 같다…`];
    case 'stat-held':
      return [`${e.on === 'user' ? user : target}의 능력은 떨어지지 않았다!`];
    case 'form':
      return [`${eun(e.on === 'user' ? user : target)} 모습이 바뀌었다!`];
    case 'hurt':
      return [`${eun(e.on === 'user' ? user : target)} 데미지를 입었다!`];
    case 'heal':
      return [`${e.on === 'user' ? user : target}의 체력이 회복됐다!`];
    case 'ability-lost':
      return [`${e.on === 'user' ? user : target}의 특성이 작용하지 않게 되었다!`];
    case 'ability-set': {
      const ko = e.abilityKo ?? e.ability;
      return [`${e.on === 'user' ? user : target}의 특성이 ${ko}${josa(ko, '이', '가')} 되었다!`];
    }
    case 'ability-swap':
      return [`${eun(user)} 서로의 특성을 바꿨다!`];
    case 'self-ko':
      // The faint beat says it. A second line here would say it twice.
      return [];
  }
}

/** Everything one half of an exchange says, in order. */
export type Half = {
  moveName: string;
  skip: SceneSkip | null;
  cured: SceneCured | null;
  missed: boolean;
  ailmentKo: string | null;
  selfEffect: SceneSelf;
  effect: number;
  crit: boolean;
  events: readonly SceneEvent[];
};

/**
 * One side's half, as lines. The box shows two at a time and pages the rest.
 *
 * In the order the games say them: whatever lifted, then the move, then what
 * the move did — miss, condition, matchup, crit — then everything else it did.
 * A skipped turn is the skip and nothing else.
 */
export function halfLines(user: string, target: string, h: Half): string[] {
  const out: string[] = [];
  if (h.cured) out.push(curedLine(user, h.cured));
  if (h.skip) {
    if (h.skip === 'confusion' && !h.cured) out.push(`${eun(user)} 혼란에 빠져 있다!`);
    out.push(skipLine(user, h.skip, h.moveName));
    return out;
  }
  out.push(`${user}의 ${h.moveName}!`);
  const charging = h.events.some((e) => e.k === 'charge' || e.k === 'protect' || e.k === 'blocked');
  const quiet = h.events.some((e) => e.k === 'weather' || e.k === 'terrain' || e.k === 'screen' || e.k === 'trick-room' || e.k === 'stat');
  if (h.missed) out.push('공격은 빗나갔다!');
  else if (h.selfEffect === 'failed') out.push('하지만 실패했다!');
  else if (h.selfEffect === 'heal') out.push(`${user}의 체력이 회복됐다!`);
  else if (!charging && !(quiet && h.effect === 1 && !h.ailmentKo)) {
    if (h.effect === 0) out.push('효과가 없는 것 같다…');
    else if (h.effect > 1) out.push('효과가 굉장했다!');
    else if (h.effect < 1) out.push('효과가 별로인 것 같다…');
    // A multi-hit move says its crits hit by hit, in its `hits` line.
    if (h.crit && h.effect !== 0 && !h.events.some((e) => e.k === 'hits')) out.push('급소에 맞았다!');
  }
  if (!h.missed) for (const e of h.events) out.push(...eventLines(user, target, e));
  if (h.ailmentKo) out.push(`${eun(target)} ${h.ailmentKo}`);
  return out;
}

const CHIP_EXTRA: Record<string, string> = { curse: '저주받고 있다!' };

const GUARD_KO: Record<SceneGuard, string> = { wide: '와이드가드', quick: '패스트가드', crafty: '트릭가드' };
const GUARD_START: Record<SceneGuard, (n: string) => string> = {
  wide: (n) => `${n} 쪽이 와이드가드로 지켜졌다!`,
  quick: (n) => `${n} 쪽이 패스트가드로 지켜졌다!`,
  crafty: (n) => `${n} 쪽이 트릭가드로 지켜졌다!`,
};

/** A condition landing on the mover — a sting, a burn from 부리캐논. */
const SELF_STATUS_KO: Record<string, string> = {
  burn: '화상을 입었다!',
  poison: '독에 걸렸다!',
  toxic: '맹독을 입었다!',
  paralysis: '몸이 저려 잘 움직이지 못한다!',
  sleep: '잠들어 버렸다!',
  freeze: '얼어붙었다!',
  confusion: '혼란에 빠졌다!',
};

const WORE_OFF_2: Record<'disable' | 'magnet-rise' | 'mist', (n: string, side: string) => string> = {
  disable: (n) => `${n}의 사슬묶기가 풀렸다!`,
  'magnet-rise': (n) => `${n}의 전자부유가 끝났다!`,
  mist: (_n, side) => `${side}을 감싸던 흰안개가 사라졌다!`,
};

const WORE_OFF: Record<'taunt' | 'encore' | 'telekinesis' | 'heal-block', (n: string) => string> = {
  taunt: (n) => `${eun(n)} 도발의 효과가 풀렸다!`,
  encore: (n) => `${n}의 앙코르 상태가 풀렸다!`,
  telekinesis: (n) => `${eun(n)} 텔레키네시스에서 풀려났다!`,
  'heal-block': (n) => `${n}의 회복봉인이 풀렸다!`,
};

/** What the box says once both have moved — or as somebody comes in. */
export function endLines(me: string, foe: string, events: readonly SceneEndEvent[]): string[] {
  const name = (on: 'me' | 'foe') => (on === 'me' ? me : foe);
  const side = (on: 'me' | 'foe') => (on === 'me' ? '우리 편' : '상대 편');
  return events.map((e) => {
    switch (e.k) {
      case 'weather-chip':
        return `${e.weather === 'sand' ? '모래바람' : '싸라기눈'}이 ${eul(name(e.on))} 덮쳤다!`;
      case 'weather-end':
        return WEATHER_END[e.weather];
      case 'status-chip':
        return `${eun(name(e.on))} ${CHIP_KO[e.condition] ?? CHIP_EXTRA[e.condition] ?? '데미지를 입었다!'}`;
      case 'terrain-heal':
        return `${name(e.on)}의 체력이 회복됐다!`;
      case 'terrain-end':
        return TERRAIN_END[e.terrain];
      case 'screen-end':
        return e.screen === 'safeguard'
          ? `${side(e.on)}을 감싸던 신비의 베일이 사라졌다!`
          : `${side(e.on)}의 ${SCREEN_KO[e.screen]}${josa(SCREEN_KO[e.screen], '이', '가')} 사라졌다!`;
      case 'trick-room-end':
        return '뒤틀린 시공이 원래대로 돌아왔다!';
      case 'room-end':
        return `${ROOM_KO[e.room]}${josa(ROOM_KO[e.room], '이', '가')} 원래대로 돌아왔다!`;
      case 'wore-off':
        return WORE_OFF[e.what](name(e.on));
      case 'future-hit':
        return `${eun(name(e.on))} 미래예지 공격을 받았다!`;
      case 'hazard-hit':
        return e.hazard === 'stealthRock'
          ? `뾰족한 바위가 ${name(e.on)}에게 박혔다!`
          : `${eun(name(e.on))} 압정뿌리기의 데미지를 입었다!`;
      case 'toxic-spikes':
        return `${eun(name(e.on))} 독압정 때문에 ${e.condition === 'toxic' ? '맹독' : '독'}에 걸렸다!`;
      case 'toxic-spikes-gone':
        return `${iga(name(e.on))} 독압정을 흡수했다!`;
      case 'sticky-web':
        return `${eun(name(e.on))} 끈적끈적네트에 걸렸다!`;
      case 'leech-seed':
        return `씨뿌리기가 ${name(e.on)}의 체력을 빼앗는다!`;
      case 'perish':
        return `${name(e.on)}의 멸망 카운트가 ${e.n}${josa(String(e.n), '이', '가')} 되었다!`;
      case 'yawn-sleep':
        return `${eun(name(e.on))} 잠들어 버렸다!`;
      case 'wish':
        return `${name(e.on)}의 소원이 이루어졌다!`;
      case 'ring-heal':
        return e.what === 'ingrain'
          ? `${eun(name(e.on))} 뿌리로부터 양분을 흡수했다!`
          : `물의 베일이 ${name(e.on)}의 체력을 회복시켰다!`;
      case 'salt':
        return `${eun(name(e.on))} 소금절이의 데미지를 입었다!`;
      case 'syrup':
      case 'octolock':
        return '';
      case 'healed-in':
        return `${eun(name(e.on))} 치유의 소원을 받아 회복됐다!`;
      case 'end-stat':
        return statLine(name(e.on), e.stat, e.delta, e.delta);
      case 'wore-off-2':
        return WORE_OFF_2[e.what](name(e.on), side(e.on));
      case 'sport-end':
        return e.what === 'water' ? '물놀이의 효과가 사라졌다!' : '흙놀이의 효과가 사라졌다!';
      case 'ability':
        return abilityLine(name(e.on), e.abilityKo ?? e.ability);
      case 'weather-set':
        return WEATHER_START[e.weather];
      case 'terrain-set':
        return TERRAIN_START[e.terrain];
      case 'end-heal':
        return `${name(e.on)}의 체력이 회복됐다!`;
      case 'end-hurt':
        return `${eun(name(e.on))} 데미지를 입었다!`;
      case 'end-cured':
        return `${name(e.on)}의 상태이상이 나았다!`;
      case 'end-form':
        return `${eun(name(e.on))} 모습이 바뀌었다!`;
      case 'end-transform':
        return `${eun(name(e.on))} ${name(e.on === 'me' ? 'foe' : 'me')}${josa(name(e.on === 'me' ? 'foe' : 'me'), '으로', '로')} 변신했다!`;
      case 'end-trace': {
        const ko = e.abilityKo ?? e.ability;
        return `${eun(name(e.on))} ${name(e.on === 'me' ? 'foe' : 'me')}의 ${eul(ko)} 트레이스했다!`;
      }
      case 'end-type': {
        const ko = (e.typesKo ?? e.types).join('·');
        return `${name(e.on)}의 타입이 ${ko}${josa(ko, '이', '가')} 되었다!`;
      }
      case 'end-screens-gone':
        return '모든 벽이 사라졌다!';
      case 'end-shudder':
        return `${eun(name(e.on))} 몸을 떨었다!`;
      case 'end-forewarn':
        return e.moveKo ? `${name(e.on)}의 ${eul(e.moveKo)} 읽었다!` : '';
      case 'end-stat-held':
        return `${name(e.on)}의 능력은 떨어지지 않았다!`;
    }
  }).filter((l) => l !== '');
}

/** Lines in pages of the box's two rows. Never empty: a beat always shows something. */
export function pages(lines: readonly string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < lines.length; i += 2) out.push(lines.slice(i, i + 2));
  return out.length ? out : [[]];
}

/** The chip over the stage: what the field is doing, or null for a quiet one. */
export function fieldLabel(f: SceneField | null | undefined): string | null {
  if (!f) return null;
  const parts: string[] = [];
  if (f.weather) parts.push(`${WEATHER_KO[f.weather]} ${f.weatherTurns}`);
  if (f.terrain) parts.push(`${TERRAIN_KO[f.terrain]} ${f.terrainTurns}`);
  if (f.trickRoom > 0) parts.push(`트릭룸 ${f.trickRoom}`);
  for (const [room, turns] of Object.entries(f.rooms ?? {}) as [SceneRoom, number][]) parts.push(`${ROOM_KO[room]} ${turns}`);
  return parts.length ? parts.join(' · ') : null;
}
