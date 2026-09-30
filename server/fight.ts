import { hasDamaging, mulberry32, type Rarity } from './game.ts';
import { abilityOf, abilitySlotFor } from './abilities.ts';
import { BATTLE_FORMS } from './abilitydata.ts';
import type { Form } from './forms.ts';
import { statsOf } from './dexdata.ts';
import {
  ALLURING_VOICE,
  ALWAYS_FAILS,
  BATON_PASS,
  BEAK_BLAST,
  BEAT_UP,
  BURNING_JEALOUSY,
  CLEAR_SMOG,
  CRASH_MOVES,
  DARK_VOID,
  DIRE_CLAW,
  ELECTRO_SHOT,
  FELL_STINGER,
  FICKLE_BEAM,
  FINAL_GAMBIT,
  FIRST_TURN_MOVES,
  FLYING_PRESS,
  FREEZE_DRY,
  FUSION_MOVES,
  GIGATON_HAMMER,
  GLAIVE_RUSH,
  HEAL_TARGET,
  LAST_RESORT,
  MINIMIZE_PUNISH,
  NO_ESCAPE_MOVES,
  PLASMA_FISTS,
  PRESENT,
  PROTECT_BREAKERS,
  PROTECT_PIERCERS,
  PURIFY,
  REVELATION_DANCE,
  SALT_CURE,
  SE_BOOST_MOVES,
  SELF_NO_ESCAPE,
  SHEER_COLD,
  SHELL_TRAP,
  SPARKLING_ARIA,
  SPECTRAL_THIEF,
  SPIKY_PROTECT,
  SPIN_MOVES,
  SPIT_UP,
  STEEL_ROLLER,
  STOCKPILE,
  STONE_AXE,
  SUCKER_MOVES,
  SWALLOW,
  SYRUP_BOMB,
  TYPE_SPENDERS,
  CHARGE,
  CHARGE_MOVES,
  COMPANION_FRIENDSHIP,
  CURSE,
  DEFAULT_FRIENDSHIP,
  DEFENSE_CURL,
  DEFOG,
  DEFROST_MOVES,
  DRAG_OUT_MOVES,
  DREAM_EATER,
  ENCORE,
  ENDURE,
  FALSE_SWIPES,
  FIXED_DAMAGE,
  FOCUS_ENERGY,
  FOCUS_PUNCH,
  FUTURE_MOVES,
  GRASSY_GLIDE,
  GRAVITY,
  GUARD_SWAP,
  HALF_COST_MOVES,
  HAZARD_MOVES,
  HAZE,
  ICE_SPINNER,
  IMPRISON,
  LOCK_MOVES,
  MAGIC_ROOM,
  METRONOME,
  MIMIC,
  MOVE_PATCHES,
  MULTI_HIT,
  NATURE_POWER,
  NATURE_POWER_MOVES,
  OHKO_MOVES,
  PAIN_SPLIT,
  PIVOT_MOVES,
  POWDER_MOVES,
  POWER_SWAP,
  PROTECT_MOVES,
  PSYCHIC_NOISE,
  PSYCH_UP,
  PSYWAVE,
  RAGE,
  REACHES,
  RECHARGE_MOVES,
  REST,
  RETURN_MOVES,
  ROOST,
  SAFEGUARD,
  SCREEN_BREAKERS,
  SCREEN_MOVES,
  SCREEN_TURNS,
  SECRET_POWER,
  SELF_KO_MOVES,
  SKY_DROP,
  SLEEP_TALK,
  SMACK_DOWN_MOVES,
  SNATCH,
  SNORE,
  SOLAR_MOVES,
  SOUND_MOVES,
  SPEED_SWAP,
  SPITE,
  STAT_READS,
  STRUGGLE,
  SUBSTITUTE,
  TAUNT,
  TELEKINESIS,
  TELEPORT,
  TERRAIN_MOVES,
  TERRAIN_TURNS,
  TERRAIN_TYPE,
  THROAT_CHOP,
  TRI_ATTACK,
  TRICK_ROOM,
  TRICK_ROOM_TURNS,
  UPPER_HAND,
  VENOM_DRENCH,
  WEATHER_MOVES,
  WEATHER_TURNS,
  WONDER_ROOM,
  weatherBallType,
  fieldBlocks,
  grounded,
  powerOf,
  terrainPowerMult,
  weatherAccuracy,
  weatherChips,
  weatherDefenceMult,
  weatherHealShare,
  weatherPowerMult,
  type Power,
  type PowerSide,
  type Screen,
  type Terrain,
  type Weather,
} from './battlefield.ts';
import {
  MOVES,
  TYPES,
  effectiveness,
  learnableMoves,
  levelUpMoves,
  moveById,
  speciesInfo,
  type Ailment,
  hasFlag,
  type MoveInfo,
  type MoveType,
  type StatName,
} from './moves.ts';

/**
 * The battle: two teams, one Pokemon out on each side, turn by turn.
 *
 * Everything that decides a fight lives here — level-50 stats from base
 * stats, the damage formula, status conditions, stat stages, moves and what
 * they do, switching. The rules that are tables rather than state (weather,
 * terrain, screens, formula powers, which move id is which) are in
 * server/battlefield.ts; the words are in src/battleText.ts. server/hunt.ts,
 * server/trainer.ts and server/gyms.ts only decide WHO fights.
 */

/**
 * Damage for a move whose power PokeAPI does not carry.
 *
 * Twenty-three machine moves are physical or special with `power: 0` — Seismic
 * Toss, Low Kick, Grass Knot, Gyro Ball — because their power is a formula of
 * level, weight or speed this game has no inputs for. Without this they would
 * round to the damage formula's minimum and a moveset holding one would limp.
 */
const FIXED_POWER = 40;

/**
 * The level every Pokemon fights at, on both sides.
 *
 * This game has no levels, so every fight is fought as if it were a flat-50
 * battle: base stats decide who hits harder, who takes it better and who moves
 * first. No IVs, no EVs and a neutral nature, so two of the same species are
 * exactly as strong as each other — see `battleStats`.
 */
export const BATTLE_LEVEL = 50;

/** A critical hit lands for half again. How often is `critChance`. */
const CRIT_MULT = 1.5;
/** Same-type attack bonus. */
const STAB_MULT = 1.5;
/** Stat stages run -6..+6, as in the games. */
const MAX_STAGE = 6;
/** What a recovery move gives back when the data names no share. 회복하기 is half. */
const HEAL_SHARE = 0.5;
/** Confusion's hit on itself: a typeless 40-power physical blow. */
const CONFUSION_POWER = 40;

/**
 * Moves that badly poison rather than poison.
 *
 * PokeAPI files 맹독 under plain 'poison' — its meta table has no separate
 * ailment for it — so the id is the only thing that tells them apart. 독엄니
 * does the same thing as a side effect.
 */
const TOXIC_MOVES = new Set([92, 305, 919]);

/**
 * Everything that can stand on a side.
 *
 * `Ailment` is PokeAPI's vocabulary for what a machine move inflicts. Two more
 * exist in the fight without any machine move carrying them: 'toxic' (see
 * TOXIC_MOVES) and 'sleep', which a named trainer's transcribed set can hold.
 */
export type Condition = Ailment | 'sleep' | 'toxic';

/**
 * The non-volatile conditions — one at a time, and they outlast the turn.
 *
 * A second one on a side that already has one simply fails, as in the games.
 */
const NON_VOLATILE = new Set<Condition>(['burn', 'poison', 'toxic', 'paralysis', 'sleep', 'freeze']);

/** Types that cannot carry a condition at all. Fire does not burn, and so on. */
const IMMUNE: Partial<Record<Condition, readonly MoveType[]>> = {
  burn: ['fire'],
  poison: ['poison', 'steel'],
  toxic: ['poison', 'steel'],
  paralysis: ['electric'],
  freeze: ['ice'],
};

/** Self-targeting, despite reading as something inflicted. Treated as a guard. */
const SELF_AILMENTS = new Set(['protect']);
/**
 * Ailments that are a hole in the data rather than a thing that happens.
 *
 * PokeAPI labels a handful of moves 'unknown'. Narrating that as
 * "상태가 이상해졌다" invents an effect the move does not have.
 */
const NO_AILMENT = new Set(['none', 'unknown']);

/** What a companion with nothing taught swings with. */
export const TACKLE = { name: '몸통박치기', power: 40 } as const;

/**
 * Base stats for an opponent whose species is not known.
 *
 * Only a test ever fights one — every real call site names the species — but
 * rarity is the one thing still known about it then, so it decides.
 */
const FALLBACK_BASE: Record<Rarity, number> = {
  common: 55,
  uncommon: 70,
  rare: 85,
  legendary: 105,
};

/**
 * Turns one battle may run to.
 *
 * At level 50 almost every fight is over in two to six. The cap is only there
 * for the pairs that cannot hurt each other — two walls trading one-damage
 * hits — and running into it is a loss for whoever did not win: a wild
 * Pokemon wanders off, a trainer's team holds.
 */
export const MAX_TURNS = 20;

/**
 * A full bar, for the saves that store HP as a share.
 *
 * The league carries six bars across encounters in `leagueRun.hp`. Those were
 * written as 0..100 before HP was real, so the save keeps that scale and the
 * fight converts at the door — see `leagueRoundAt`.
 */
export const BATTLE_MAX_HP = 100;

/** Six numbers, in STATS order: HP, 공격, 방어, 특수공격, 특수방어, 스피드. */
export type BattleStats = { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };

/**
 * Level-50 stats from base stats, with no IVs, no EVs and a neutral nature.
 *
 * The games' formulas with every optional term at zero:
 *   HP    = floor(2 × base × 50 / 100) + 50 + 10 = base + 60
 *   other = floor(2 × base × 50 / 100) + 5       = base + 5
 * 껍질몬 is the one exception the games make — its HP is always 1.
 */
export function battleStats(base: readonly number[]): BattleStats {
  const lv = BATTLE_LEVEL;
  const other = (b: number) => Math.floor((2 * b * lv) / 100) + 5;
  return {
    hp: base[0] === 1 ? 1 : Math.floor((2 * base[0] * lv) / 100) + lv + 10,
    atk: other(base[1]),
    def: other(base[2]),
    spa: other(base[3]),
    spd: other(base[4]),
    spe: other(base[5]),
  };
}

/**
 * An opponent's stats with its trainer's grit applied.
 *
 * Every stat but Speed. One companion fights a leader's WHOLE team without
 * healing, which at honest level-50 stats is a fight almost nobody wins — so
 * the named rosters are tuned, and grit is the one dial for it (the teams
 * themselves are never trimmed). Leaving Speed alone is what keeps the canon
 * team playing like itself: who moves first and which matchups are good are
 * exactly what they are in the games; only how hard it hits and how much it
 * takes moves.
 */
function gritted(s: BattleStats, grit: number): BattleStats {
  if (grit === 1) return s;
  const g = (v: number) => Math.max(1, Math.round(v * grit));
  return { hp: g(s.hp), atk: g(s.atk), def: g(s.def), spa: g(s.spa), spd: g(s.spd), spe: s.spe };
}

/** A species' level-50 stats, or null outside 1..1025. */
export function speciesStats(speciesId: number): BattleStats | null {
  const base = statsOf(speciesId);
  return base ? battleStats(base) : null;
}

/** What a status move did for the side that used it, when no event says it better. */
export type SelfEffect = 'heal' | 'failed';

/**
 * Why a side's move never happened this turn.
 *
 * 'confusion' means it hurt itself instead — `selfHit` says for how much.
 * 'flinch' and 'recharge' are caused by a move; 'taunt', 'heal-block',
 * 'imprison', 'torment' and 'throat-chop' mean the chosen move was barred, and
 * the turn went with it. 'held' is a Pokemon carried up by 프리폴.
 */
export type SkipReason =
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

/** A condition that wore off right before the side moved. */
export type Cured = 'sleep' | 'freeze' | 'confusion';

/** The seven stats a stage change can move. */
export type StatKey = 'atk' | 'def' | 'spa' | 'spd' | 'spe' | 'acc' | 'eva';

/** Entry hazards, by what lays them. */
export type Hazard = 'spikes' | 'toxicSpikes' | 'stealthRock' | 'stickyWeb';

/** Field-wide rooms and Gravity: everyone shares them. */
export type Room = 'gravity' | 'wonderRoom' | 'magicRoom';

/** Which move called another one. */
export type Caller = 'sleep-talk' | 'metronome' | 'nature-power' | 'copycat' | 'instruct';

/** A side's one-turn shield that is not Protect: 와이드가드, 패스트가드, 트릭가드. */
export type Guard = 'wide' | 'quick' | 'crafty';

/** What a status move turned somebody's type into, for the line that says so. */
export type TypeChange = { on: 'user' | 'target'; types: MoveType[] };

/**
 * Something one side's move did beyond its damage line, in order.
 *
 * `on` is relative to the side that moved: 'user' is the mover, 'target' the
 * other one. A stat event with `delta` 0 is the games' "더 이상 오르지 않는다".
 * Move names ride along as ids; server/state.ts adds the Korean (`moveKo`).
 */
export type BattleEvent =
  | { k: 'stat'; on: 'user' | 'target'; stat: StatKey; delta: number; tried: number }
  | { k: 'weather'; set: Weather }
  | { k: 'terrain'; set: Terrain }
  | { k: 'terrain-cleared' }
  | { k: 'screen'; set: Screen }
  | { k: 'trick-room'; on: boolean }
  | { k: 'room'; set: Room; on: boolean }
  /** A multi-hit move: how many landed, and how many of those were critical. */
  | { k: 'hits'; n: number; crits?: number }
  | { k: 'drain'; hp: number }
  | { k: 'recoil'; hp: number }
  | { k: 'crash'; hp: number }
  | { k: 'charge'; moveId: number }
  | { k: 'protect' }
  | { k: 'blocked' }
  | { k: 'endure' }
  | { k: 'endured' }
  | { k: 'self-ko' }
  | { k: 'thaw' }
  | { k: 'ohko' }
  | { k: 'call'; by: Caller; moveId: number }
  | { k: 'substitute' }
  | { k: 'sub-hit' }
  | { k: 'sub-broke' }
  | { k: 'taunt' }
  | { k: 'encore' }
  | { k: 'spite'; moveId: number; n: number }
  | { k: 'haze' }
  | { k: 'focus' }
  | { k: 'curse'; ghost: boolean }
  | { k: 'safeguard' }
  | { k: 'pain-split' }
  | { k: 'psych-up' }
  | { k: 'swap'; what: 'power' | 'guard' | 'speed' }
  | { k: 'mimic'; moveId: number }
  | { k: 'hazard'; set: Hazard; layers: number }
  | { k: 'defog' }
  | { k: 'screens-broken' }
  | { k: 'telekinesis' }
  | { k: 'imprison' }
  | { k: 'snatch' }
  | { k: 'snatched'; moveId: number }
  | { k: 'heal-block' }
  | { k: 'future' }
  | { k: 'forced-out' }
  | { k: 'retreat' }
  /** 역린 and its kin wore out, and the user is confused from it. */
  | { k: 'rampage-end' }
  /** 소란피기 began (`start`) or goes on. */
  | { k: 'uproar'; start: boolean }
  | { k: 'uproar-end' }
  /** Somebody asleep was woken by the noise. */
  | { k: 'uproar-wake' }
  /** 참기 is storing up, or letting go. */
  | { k: 'bide' }
  | { k: 'bide-release' }
  /** 떨어뜨리기 brought a flying target down. */
  | { k: 'grounded' }
  /** 분노: the one hit got angrier. */
  | { k: 'rage' }
  /** 충전 is holding a charge for the next Electric move. */
  | { k: 'charged' }
  /** 철제광선: the user paid half its bar for it. */
  | { k: 'half-cost'; hp: number }
  /** 프리폴 carried the target up. */
  | { k: 'sky-drop' }
  | { k: 'seeded' }
  | { k: 'perish' }
  | { k: 'drowsy' }
  | { k: 'disable'; moveId: number }
  | { k: 'belly-drum' }
  | { k: 'stockpile'; n: number }
  | { k: 'stockpile-gone' }
  | { k: 'wish' }
  | { k: 'magic-coat' }
  | { k: 'bounced'; moveId: number }
  | { k: 'destiny-bond' }
  | { k: 'destiny-bond-took' }
  | { k: 'grudge' }
  | { k: 'grudge-took'; moveId: number }
  | { k: 'cure-team' }
  | { k: 'no-escape'; both?: boolean }
  | { k: 'identified' }
  | { k: 'splash' }
  | { k: 'transform' }
  | { k: 'sketch'; moveId: number }
  | { k: 'lock-on' }
  | { k: 'type'; on: 'user' | 'target'; types: MoveType[] }
  | { k: 'healing-wish' }
  | { k: 'psycho-shift' }
  | { k: 'power-trick' }
  | { k: 'split'; what: 'power' | 'guard' }
  | { k: 'heart-swap' }
  | { k: 'topsy-turvy' }
  | { k: 'guard'; set: Guard }
  | { k: 'guarded'; by: Guard }
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
  | { k: 'type-lost'; type: MoveType }
  | { k: 'plasma' }
  | { k: 'nothing' }
  | { k: 'instructed'; moveId: number }
  /** A condition that landed on the MOVER — 토치카's poison, 부리캐논's burn from the other side. */
  | { k: 'self-status'; condition: Condition }
  /** 클리어스모그: the target's stages are back to zero. */
  | { k: 'cleared' }
  /** An ability had its say. The lines after it say what it did. */
  | { k: 'ability'; on: 'user' | 'target'; ability: string }
  /** An ability kept the move off entirely. */
  | { k: 'immune'; on: 'user' | 'target' }
  /** An ability kept a stat from dropping. */
  | { k: 'stat-held'; on: 'user' | 'target' }
  /** 위액: its ability stopped working. */
  | { k: 'ability-lost'; on: 'user' | 'target' }
  /** 고민씨, 심플빔, 역할, 동료만들기: it has a new ability. */
  | { k: 'ability-set'; on: 'user' | 'target'; ability: string }
  | { k: 'ability-swap' }
  | { k: 'form'; on: 'user' | 'target'; form: string }
  | { k: 'hurt'; on: 'user' | 'target'; hp: number }
  | { k: 'heal'; on: 'user' | 'target'; hp: number }
  | { k: 'sport'; what: 'water' | 'mud' }
  /** A wild fight is over with nobody down: 'target' was blown away, or 'user' ran. */
  | { k: 'fled'; who: 'user' | 'target' };

/**
 * What happened once both sides had moved, or as somebody came in. `on` is
 * absolute here: 'me' is the companion's side, 'foe' the opponent's.
 */
export type EndEvent =
  | { k: 'weather-chip'; on: 'me' | 'foe'; weather: Weather; hp: number }
  | { k: 'weather-end'; weather: Weather }
  | { k: 'status-chip'; on: 'me' | 'foe'; condition: Condition | 'curse'; hp: number }
  | { k: 'terrain-heal'; on: 'me' | 'foe'; hp: number }
  | { k: 'terrain-end'; terrain: Terrain }
  | { k: 'screen-end'; on: 'me' | 'foe'; screen: Screen | 'safeguard' }
  | { k: 'trick-room-end' }
  | { k: 'room-end'; room: Room }
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
  | { k: 'end-stat'; on: 'me' | 'foe'; stat: StatKey; delta: number }
  | { k: 'wore-off-2'; on: 'me' | 'foe'; what: 'disable' | 'magnet-rise' | 'mist' }
  | { k: 'sport-end'; what: 'water' | 'mud' }
  | { k: 'ability'; on: 'me' | 'foe'; ability: string }
  | { k: 'weather-set'; weather: Weather }
  | { k: 'terrain-set'; terrain: Terrain }
  | { k: 'end-heal'; on: 'me' | 'foe'; hp: number }
  | { k: 'end-hurt'; on: 'me' | 'foe'; hp: number }
  | { k: 'end-cured'; on: 'me' | 'foe' }
  | { k: 'end-form'; on: 'me' | 'foe'; form: string }
  | { k: 'end-transform'; on: 'me' | 'foe' }
  | { k: 'end-trace'; on: 'me' | 'foe'; ability: string }
  | { k: 'end-type'; on: 'me' | 'foe'; types: MoveType[] }
  | { k: 'end-screens-gone' }
  | { k: 'end-shudder'; on: 'me' | 'foe' }
  | { k: 'end-forewarn'; on: 'me' | 'foe'; moveId: number }
  | { k: 'end-stat-held'; on: 'me' | 'foe' };

/** One side's half of the field, as the scene shows it. Turns left, or layers. */
export type SideView = Partial<Record<Screen | 'safeguard' | Hazard, number>>;

/** The field as it stands at the end of a turn, for the chip over the scene. */
export type FieldView = {
  weather: Weather | null;
  weatherTurns: number;
  terrain: Terrain | null;
  terrainTurns: number;
  trickRoom: number;
  rooms: Partial<Record<Room, number>>;
  mine: SideView;
  theirs: SideView;
};

/**
 * One exchange: my action and theirs, in whichever order they came.
 *
 * Both halves are always described from their own side's point of view, and
 * `foeFirst` says which one happened first. A half that never came — the side
 * had already fainted, or was switched out mid-turn — has `meActed`/`foeActed`
 * false. A turn cut by a switch is continued in the next round's first turn.
 */
export type BattleTurn = {
  /** Whether the opponent moved before me this turn. Priority, then speed. */
  foeFirst: boolean;

  /** Whether I got a turn at all. False when I fainted or was switched out before my slot. */
  meActed: boolean;
  /** The move used, or null for the untaught fallback swing. */
  moveId: number | null;
  damage: number;
  crit: boolean;
  /** The swing went wide. Damage is zero and nothing else happens. */
  missed: boolean;
  /** Type matchup, as a multiplier: 0, 0.25, 0.5, 1, 2 or 4. */
  effect: number;
  /** What my move left on the opponent this turn, or null. */
  ailment: Condition | null;
  /** 'heal' a recovery move, 'failed' when there was nothing for it to do. */
  selfEffect: SelfEffect | null;
  /** Why my move did not happen, or null. */
  mySkip: SkipReason | null;
  /** What I did to myself in confusion. Already inside myHpAfter. */
  mySelfHit: number;
  /** A condition that lifted right before I moved. */
  myCured: Cured | null;
  /** Everything else my move did, in order: stages, weather, hits, recoil… */
  myEvents: BattleEvent[];

  /** Whether the opponent got a turn at all. */
  foeActed: boolean;
  /** What it used. Null means the plain fallback swing. */
  foeMoveId: number | null;
  /** What the opponent's move did to me. Zero on a miss or a skipped turn. */
  counter: number;
  foeCrit: boolean;
  foeMissed: boolean;
  /** That move's matchup against MY types: 0, 0.25, 0.5, 1, 2 or 4. */
  foeEffect: number;
  /** What the opponent's move left on ME this turn, or null. */
  foeAilment: Condition | null;
  foeSelfEffect: SelfEffect | null;
  foeSkip: SkipReason | null;
  foeSelfHit: number;
  foeCured: Cured | null;
  foeEvents: BattleEvent[];

  /** End-of-turn chip on the opponent — weather, burn, poison, a bind. Already inside foeHpAfter. */
  residual: number;
  /** The same on me. Already inside myHpAfter. */
  myResidual: number;
  /** What happened after both had moved: weather and status chip, things wearing off. */
  endEvents: EndEvent[];
  /** The field once the turn is over. */
  field: FieldView;
  /** Non-volatile conditions still on each side once this turn has finished — the plate badge. */
  foeStatus: Condition | null;
  myStatus: Condition | null;
  /** Both bars once the whole turn — both actions and the chip — has landed. */
  foeHpAfter: number;
  myHpAfter: number;
};

/**
 * How a round ended.
 *
 * '-down' is a faint; '-forced' is 날려버리기 or 드래곤테일 pulling somebody out;
 * '-retreat' is the side's own 유턴, 순간이동 or 배턴터치. 'fled' is a wild
 * fight that ended with nobody down, 'stall' one that ran into MAX_TURNS.
 */
export type RoundExit =
  | 'foe-down'
  | 'me-down'
  | 'both-down'
  | 'foe-forced'
  | 'foe-retreat'
  | 'me-forced'
  | 'me-retreat'
  | 'fled'
  | 'stall';

/**
 * One round: the stretch of a fight with the same two Pokemon out.
 *
 * A wild encounter is one round. A trainer's team is one per Pokemon they
 * send — more, if somebody is pulled out and comes back.
 */
export type Battle = {
  foeMaxHp: number;
  myMaxHp: number;
  /** HP I came into this round with. Below max after a trainer's first Pokemon. */
  myStartHp: number;
  /** The same for the opponent — below max when one comes back after being pulled out. */
  foeStartHp: number;
  /** Which of each team is out. Always 0 for a side of one. */
  mySlot: number;
  foeSlot: number;
  /** Hazards that struck as this round's newcomers arrived. */
  entry: EndEvent[];
  turns: BattleTurn[];
  /** How it ended. */
  exit: RoundExit;
  /** Opponent down, me still standing, at the end of this round. */
  won: boolean;
  /** The non-volatile condition I walk out with. */
  myStatusAfter: Condition | null;
};

/** A whole fight, one or more rounds. */
export type Fight = {
  rounds: Battle[];
  /** Every one of theirs down while one of mine still stands. */
  won: boolean;
  end: 'won' | 'lost' | 'fled' | 'stall';
  /** My team's HP and conditions afterwards, slot by slot. */
  hp: number[];
  status: (Condition | null)[];
  /** Which of mine stood, round by round. */
  outFor: number[];
};

/**
 * How much a move of the opponent's own type is favoured in its draw.
 *
 * A lean, not a rule — the same language `trainerAt` uses for a class's
 * preferred types. It has to be a weight: six species have no attacking move of
 * their own type at all, and a filter would leave them with nothing to swing.
 * Three puts STAB on roughly three picks in five.
 */
const STAB_WEIGHT = 3;
/** Explosion and Hyper Beam stay reachable, just rare. A Rattata should not open with one. */
const HEAVY_POWER = 130;
const HEAVY_DAMP = 0.4;

/**
 * How hard the type chart leans on WHICH move gets thrown.
 *
 * Until this existed the chart only ever applied to the damage, never to the
 * choice — so a companion that knew a Ground move threw it at a Flying type
 * about a quarter of the time, forever, and the panel said "효과가 없는 것
 * 같다…" for it. Both sides now read the chart before picking.
 *
 * Keyed on what `effectiveness` returns: 0, 0.25, 0.5, 1, 2 or 4, every one of
 * them exactly representable, so a Map keyed on the double is exact.
 *
 * THERE IS DELIBERATELY NO ENTRY FOR 1. A neutral matchup falls through to a
 * literal 1, and that is not tidiness — it is what makes an all-neutral pick
 * weigh 1 across the board, which `pickWeighted` turns back into exactly the
 * uniform draw this replaced. Four of the six GOLDEN rows in
 * test/hunt.test.ts are that case and stay byte-identical. Add an entry for 1
 * and they all move.
 *
 * A lean, not a rule, for the reason written above `battleAt`: rotating to the
 * best move made 2000 encounters produce two distinct sequences. 0.05 keeps an
 * immune move on about one pick in sixty against three neutral ones — rare
 * enough to stop being the story of the fight, common enough that "효과가 없는
 * 것 같다…" is still a line the game can say.
 */
const MATCHUP_WEIGHT = new Map<number, number>([
  [0, 0.05],
  [0.25, 0.2],
  [0.5, 0.45],
  [2, 2.6],
  [4, 5],
]);

/**
 * The same lean on the wild one's side, and much softer on purpose.
 *
 * A wild Pokemon is not being directed by anybody. It stops using the move that
 * visibly does nothing; it does not scheme. The top half stays near 1 because
 * it is a budget rather than a taste: `foeMult` below promises a mean of about
 * one over the weighted draw, and the counter is tuned against that mean. This
 * table costs it roughly +6%; applying the chart at full strength cost +19% and
 * quietly made every trainer harder.
 */
const FOE_MATCHUP_WEIGHT = new Map<number, number>([
  [0, 0.15],
  [0.25, 0.6],
  [0.5, 0.8],
  [2, 1.15],
  [4, 1.3],
]);

/** Neutral is the absent key, so it returns the literal 1. See the tables. */
function chartWeight(effect: number, table: Map<number, number>): number {
  return table.get(effect) ?? 1;
}

/**
 * `effectiveness` against one side, resolved once for all eighteen types.
 *
 * EMPTY when there is nothing to hit. Every lookup then misses and the caller's
 * `?? 1` is what keeps a battle with no type information on either side
 * bit-for-bit what it was before the chart was consulted at all.
 *
 * Eighteen chart evaluations per fight rather than one per move per turn: the
 * biggest machine learnset is 222 moves.
 */
function matchupTable(against: readonly MoveType[]): Map<MoveType, number> {
  const out = new Map<MoveType, number>();
  if (against.length) for (const t of TYPES) out.set(t, effectiveness(t, against));
  return out;
}

type FoePool = { moves: MoveInfo[]; weights: number[]; total: number };

/**
 * What a species can plausibly attack with, cached per species.
 *
 * Its level-up learnset up to the level every fight is fought at — what a
 * wild one of it knows in the games, which is the last moves it learned by
 * level. A species with nothing to hit with by 50 falls back to the machine
 * learnset the TM drops use. Status and formula-power moves are filtered out:
 * neither carries a number this can size a swing against, and "야생 꼬렛의
 * 칼춤!" is not the fight anyone came for.
 *
 * Null for a species with nothing left after either — it falls back to the
 * same plain swing an untaught companion uses.
 */
const foePools = new Map<number, FoePool | null>();

/**
 * Weight a set of moves the way an opponent picks between them.
 *
 * Shared by the two ways a pool is built — everything a species could learn,
 * and the four a named trainer actually carries — so the two can never drift
 * into weighting the same move differently.
 *
 * `named` keeps what a wild pool drops. A transcribed set is the trainer's own
 * four, and 전기자석파 or 맹독 in it is half of how that leader fights; a
 * formula-power move there swings at FIXED_POWER, as the companion's does.
 */
function poolFrom(ids: readonly number[], types: readonly MoveType[], named = false): FoePool | null {
  const moves = ids
    .map(moveById)
    .filter(
      (m): m is MoveInfo =>
        !!m &&
        (named
          ? m.damageClass !== 'status' || statusKind(m).kind !== 'guard'
          : m.damageClass !== 'status' && m.power > 0),
    );
  if (!moves.length) return null;
  const weights = moves.map((m) =>
    m.damageClass === 'status'
      ? 1
      : (types.includes(m.type) ? STAB_WEIGHT : 1) * (m.power >= HEAVY_POWER ? HEAVY_DAMP : 1),
  );
  return { moves, weights, total: weights.reduce((a, w) => a + w, 0) };
}

function foePool(speciesId: number): FoePool | null {
  const cached = foePools.get(speciesId);
  if (cached !== undefined) return cached;
  const types = speciesInfo(speciesId)?.types ?? [];
  const byLevel = [...new Set(levelUpMoves(speciesId).filter(([lv]) => lv <= BATTLE_LEVEL).map(([, id]) => id))];
  const pool = poolFrom(byLevel, types) ?? poolFrom(learnableMoves(speciesId), types);
  foePools.set(speciesId, pool);
  return pool;
}

/**
 * The four moves a named opponent actually carries.
 *
 * Cached on the move list itself rather than on the species: a trainer's team
 * can hold the same species twice with different sets, and 카밀레 does exactly
 * that. Keyed on the ids joined, which is stable because the table is literal.
 */
const namedPools = new Map<string, FoePool | null>();

function namedPool(ids: readonly number[], types: readonly MoveType[]): FoePool | null {
  const key = ids.join(',');
  const cached = namedPools.get(key);
  if (cached !== undefined) return cached;
  const pool = poolFrom(ids, types, true);
  namedPools.set(key, pool);
  return pool;
}

/**
 * A move as the battle reads it: the table's row, with the few gaps PokeAPI
 * has not filled in yet patched from MOVE_PATCHES. Everything in this file
 * goes through here rather than `moveById`.
 */
const patched = new Map<number, MoveInfo | null>();
function moveOf(id: number | null): MoveInfo | null {
  if (id === null) return null;
  const hit = patched.get(id);
  if (hit !== undefined) return hit;
  const base = moveById(id);
  const out = base && MOVE_PATCHES[id] ? { ...base, ...MOVE_PATCHES[id] } : base;
  patched.set(id, out);
  return out;
}

/**
 * What a status move is for.
 *
 * The id tables in server/battlefield.ts come first, because PokeAPI files
 * those moves under catch-all categories ('unique', 'field-effect'). After
 * them the data decides: an ailment, a heal, or a list of stage changes.
 * `guard` — a stage of each defence — is what is left, and after this pass
 * only a move with no effect in a one-on-one fight at all ends up there.
 */
type StatusKind =
  | { kind: 'ailment'; condition: Condition }
  | { kind: 'weather'; weather: Weather }
  | { kind: 'terrain'; terrain: Terrain }
  | { kind: 'screen'; screen: Screen }
  | { kind: 'hazard'; hazard: Hazard; max: number }
  | { kind: 'room'; room: Room }
  | { kind: 'trick-room' }
  | { kind: 'protect' }
  | { kind: 'endure' }
  | { kind: 'rest' }
  | { kind: 'sleep-talk' }
  | { kind: 'heal' }
  | { kind: 'stats' }
  | { kind: 'unique'; id: number }
  | { kind: 'fails' }
  | { kind: 'guard' };

/** The status moves handled one by one in `runUnique`. */
const UNIQUE = new Set([
  SUBSTITUTE, TAUNT, ENCORE, SPITE, HAZE, FOCUS_ENERGY, CURSE, SAFEGUARD, PAIN_SPLIT, PSYCH_UP,
  POWER_SWAP, GUARD_SWAP, SPEED_SWAP, METRONOME, MIMIC, NATURE_POWER, TELEPORT, BATON_PASS,
  DEFOG, TELEKINESIS, IMPRISON, SNATCH, 46, 18,
  // Level-up moves.
  275, 195, 50, 316, 187, STOCKPILE, SWALLOW, 262, 273, 277, 288, 194, 215, 312, 212, 335, 150, 160,
  176, 170, 199, 166, 144, 361, 461, 367, 375, 379, 380, 383, 388, 391, 392, 393, 469, 501, 578, 470,
  471, 487, 493, 494, 495, 513, 563, 567, 571, 576, 579, 582, 587, 668, 673, PURIFY, 689, 750, 753,
  756, 748, 880, 882, 863, 850, 54, 867, 272, 602, 674, 505, 666, 346, 300, 285,
]);

/**
 * The unique status moves aimed at the other Pokemon — what Protect stops and
 * accuracy is rolled for. The rest work on the user or the field.
 */
const AIMED_UNIQUE = new Set([
  TAUNT, ENCORE, SPITE, PAIN_SPLIT, PSYCH_UP, POWER_SWAP, GUARD_SWAP, SPEED_SWAP, MIMIC, DEFOG, TELEKINESIS, 46, 18,
  50, 316, 262, 212, 335, 176, 170, 199, 375, 380, 388, 391, 470, 471, 487, 493, 494, 567, 571, 576, 285,
  582, 668, PURIFY, 689, 750, 753, 505, 666,
]);

function statusKind(move: MoveInfo): StatusKind {
  const id = move.id;
  if (ALWAYS_FAILS.has(id)) return { kind: 'fails' };
  if (id in WEATHER_MOVES) return { kind: 'weather', weather: WEATHER_MOVES[id] };
  if (id in TERRAIN_MOVES) return { kind: 'terrain', terrain: TERRAIN_MOVES[id] };
  if (id in SCREEN_MOVES) return { kind: 'screen', screen: SCREEN_MOVES[id] };
  if (id in HAZARD_MOVES) return { kind: 'hazard', ...HAZARD_MOVES[id] };
  if (id === GRAVITY) return { kind: 'room', room: 'gravity' };
  if (id === WONDER_ROOM) return { kind: 'room', room: 'wonderRoom' };
  if (id === MAGIC_ROOM) return { kind: 'room', room: 'magicRoom' };
  if (id === TRICK_ROOM) return { kind: 'trick-room' };
  if (PROTECT_MOVES.has(id) || id in SPIKY_PROTECT) return { kind: 'protect' };
  if (id === ENDURE) return { kind: 'endure' };
  if (id === REST) return { kind: 'rest' };
  if (id === SLEEP_TALK) return { kind: 'sleep-talk' };
  if (UNIQUE.has(id)) return { kind: 'unique', id };
  if (!NO_AILMENT.has(move.ailment) && !SELF_AILMENTS.has(move.ailment)) {
    return { kind: 'ailment', condition: conditionOf(move) };
  }
  if (move.healing > 0 || move.category === 'heal') return { kind: 'heal' };
  if (move.statChanges.length) return { kind: 'stats' };
  return { kind: 'guard' };
}

/** What a move inflicts, with 맹독 told apart from plain poison. */
function conditionOf(move: MoveInfo): Condition {
  return move.ailment === 'poison' && TOXIC_MOVES.has(move.id) ? 'toxic' : move.ailment;
}

/** Whether a move's stage changes land on its user. PokeAPI's target says so for status moves. */
function statsOnUser(move: MoveInfo): boolean {
  if (move.damageClass !== 'status') return move.category === 'damage-raise';
  return move.target === 'user' || move.target === 'users-field' || move.target === 'user-and-allies';
}

/**
 * A move aimed at the other Pokemon — what Protect stops, what a substitute
 * soaks, what accuracy is rolled for. Weather, screens and self-buffs are not.
 */
function hitsOpponent(move: MoveInfo | null): boolean {
  if (!move) return true;
  if (move.damageClass !== 'status') return true;
  const sk = statusKind(move);
  switch (sk.kind) {
    case 'ailment':
      return true;
    case 'stats':
      return !statsOnUser(move);
    case 'unique':
      return AIMED_UNIQUE.has(sk.id);
    default:
      return false;
  }
}

/**
 * Status moves a substitute keeps off. Everything aimed at the other Pokemon
 * but the ones that go around it — 울부짖기 and 날려버리기 blow the whole
 * thing away, and swaps and 자기암시 read stats rather than touch the target.
 */
function subBlocks(move: MoveInfo): boolean {
  if (!hitsOpponent(move)) return false;
  // Sound goes through a substitute, and so does anything the games mark as reaching past one.
  if (hasFlag(move, 'sound') || hasFlag(move, 'authentic')) return false;
  return ![46, 18, PSYCH_UP, POWER_SWAP, GUARD_SWAP, SPEED_SWAP, SPITE, ENCORE, TAUNT, DEFOG, 391, 470, 471].includes(move.id);
}

/** 가로채기 steals moves that work on their user. */
function snatchable(move: MoveInfo): boolean {
  if (move.damageClass !== 'status') return false;
  const sk = statusKind(move);
  if (sk.kind === 'stats') return statsOnUser(move);
  if (sk.kind === 'unique') return [SUBSTITUTE, FOCUS_ENERGY, SAFEGUARD].includes(sk.id);
  return sk.kind === 'heal' || sk.kind === 'screen' || sk.kind === 'rest' || sk.kind === 'guard';
}

const STAT_KEY: Record<StatName, StatKey> = {
  attack: 'atk',
  defense: 'def',
  'special-attack': 'spa',
  'special-defense': 'spd',
  speed: 'spe',
  accuracy: 'acc',
  evasion: 'eva',
};

/**
 * One roll, one item, weighted.
 *
 * With every weight at 1, the first negative residual lands at
 * `Math.floor(roll * n)` — the uniform draw.
 */
function pickWeighted<T>(items: readonly T[], weights: readonly number[], total: number, roll: number): T {
  let pick = roll * total;
  for (let i = 0; i < items.length; i++) {
    pick -= weights[i];
    if (pick < 0) return items[i];
  }
  // Floating point can leave a sliver at the top of the range.
  return items[items.length - 1];
}

/**
 * Everything 손가락흔들기 can reach: every machine move but the callers, the
 * ones that only fail here, and the protections.
 */
const METRONOME_POOL = MOVES.filter(
  (m) =>
    ![METRONOME, SLEEP_TALK, MIMIC, NATURE_POWER, SNATCH, ENDURE, STRUGGLE, 383, 166, 144, 689, 194, 364, 880, 863].includes(
      m.id,
    ) &&
    !(m.id in SPIKY_PROTECT) &&
    !PROTECT_MOVES.has(m.id) &&
    !ALWAYS_FAILS.has(m.id),
).map((m) => m.id);

export type BattleOpts = {
  /**
   * HP this fight starts on, in real HP. Defaults to full.
   *
   * A trainer's team is fought one after another without healing, so each round
   * picks up where the last one left off.
   */
  startHp?: number;
  /** The non-volatile condition I walk in with — a burn from the round before. */
  startStatus?: Condition | null;
  /**
   * How tough a named opponent is, multiplied onto every stat but Speed.
   *
   * See `gritted`. 1 is the species exactly as its base stats make it.
   */
  grit?: number;
  /**
   * The four moves this opponent actually carries, if it is somebody's.
   *
   * Without it the opponent draws from EVERYTHING its species can attack with,
   * which is the right model for a wild Pokemon — nothing chose its moveset —
   * and the wrong one for 망초's 샹델라, which has four. A transcribed set keeps
   * its status moves too: 독 and 전기자석파 are half of what a gym leader is.
   */
  foeMoves?: readonly number[];
  /** The companion's species: its base stats, types and weight. */
  mySpeciesId?: number;

  /*
   * ── Form options ────────────────────────────────────────────────────────
   *
   * Each defaults to the identity, so a battle fought without a form is the
   * species fighting as itself.
   */

  /** My base stats, overriding `mySpeciesId`'s. A mega's own spread. */
  myStats?: readonly number[];
  /** My weight, for 안다리걸기 and 헤비봄버. A mega is heavier than its base. */
  myWeightKg?: number;
  /**
   * Multiplied onto the damage the opponent's moves do to me.
   *
   * Gigantamax passes 0.5 for `counterMultTurns` turns, which is this app's
   * translation of the games' doubled HP.
   */
  counterMult?: number;
  /** How many turns `counterMult` lasts. Gigantamax reverts after three. */
  counterMultTurns?: number;
  /** My types, overriding `mySpeciesId`. A Mega Charizard X is Fire/Dragon. */
  myTypes?: readonly MoveType[];
  /**
   * My friendship, for 은혜갚기 and 화풀이. The companion's grows with its
   * level (`friendshipOf`); a graduate in the party is at the top of the scale.
   */
  myFriendship?: number;
  /** My ability, by slug. The companion's is the slot it hatched with (`abilityFor`). */
  myAbility?: string | null;
  /** The opponent's, when the caller knows it; otherwise dealt from the seed. */
  foeAbility?: string | null;
};

/** Turns a Gigantamax lasts, as in the games. */
export const GMAX_TURNS = 3;

/**
 * What a Gigantamax does to incoming damage.
 *
 * Halving it is doubled HP said the other way round, and doubled HP is what
 * Dynamax actually does in the games — its base stats are the base species'.
 */
export const GMAX_GUARD = 0.5;

/**
 * The battle knobs a form contributes.
 *
 * One definition, every call site: the fight settled in `hunt`, and both
 * replays the panel builds. Written down once because a form that boosted the
 * settled fight but not the replay would show a battle that did not happen.
 *
 * `worn` is the PERMANENT form, if the companion is fused. It is simply what
 * this Pokemon is now — its types, stats and weight. A battle form on top of
 * it wins, because that is the shape actually swinging.
 */
export function formOpts(form: Form | null, worn: Form | null = null): BattleOpts {
  const shape = form ?? worn;
  if (!shape) return {};
  return {
    myTypes: shape.types,
    myStats: shape.stats,
    myWeightKg: shape.weightKg,
    ...(form?.kind === 'gmax' ? { counterMult: GMAX_GUARD, counterMultTurns: GMAX_TURNS } : {}),
  };
}

/**
 * One Pokemon on a team, as `fightAt` takes it.
 *
 * Built from `BattleOpts` for the companion and from a species id and a grit
 * for everyone else — see `mineOf` and `foeOf`.
 */
export type Fighter = {
  speciesId?: number;
  /** Base stats for when the species is unknown. Only a test ever needs this. */
  rarity?: Rarity;
  stats?: readonly number[];
  types?: readonly MoveType[];
  weightKg?: number;
  /**
   * The moves it was taught — or null to draw like an opponent: from a named
   * trainer's transcribed `named` four, or from everything its species can
   * attack with.
   */
  moves: readonly number[] | null;
  named?: readonly number[];
  grit?: number;
  startHp?: number;
  startStatus?: Condition | null;
  friendship: number;
  /** A Gigantamax: damage taken multiplied by `mult` for its first `turns` turns out. */
  guard?: { mult: number; turns: number };
  /**
   * Its ability, by PokeAPI slug. Undefined means "whatever this individual
   * would have": `fightAt` deals it from the species and the seed, the way a
   * wild one is born with one. Null is none at all.
   */
  ability?: string | null;
};

/** The companion (or a party member) as a Fighter. */
export function mineOf(moves: readonly number[], opts: BattleOpts = {}): Fighter {
  return {
    speciesId: opts.mySpeciesId,
    stats: opts.myStats,
    types: opts.myTypes,
    weightKg: opts.myWeightKg,
    moves,
    startHp: opts.startHp,
    startStatus: opts.startStatus ?? null,
    friendship: opts.myFriendship ?? COMPANION_FRIENDSHIP,
    ...(opts.myAbility !== undefined ? { ability: opts.myAbility } : {}),
    ...(opts.counterMult !== undefined && opts.counterMult !== 1
      ? { guard: { mult: opts.counterMult, turns: opts.counterMultTurns ?? Infinity } }
      : {}),
  };
}

/** An opponent as a Fighter. */
export function foeOf(
  speciesId: number | undefined,
  rarity: Rarity,
  grit = 1,
  named?: readonly number[],
  ability?: string | null,
): Fighter {
  return { speciesId, rarity, moves: null, named, grit, friendship: DEFAULT_FRIENDSHIP, ...(ability !== undefined ? { ability } : {}) };
}

/** How a side picks its moves: which ones, their base weights, and how hard the chart leans. */
type Kit = {
  ids: (number | null)[];
  weight: (id: number | null) => number;
  table: Map<number, number>;
  /** A taught side leans on the chart like a player; an opponent more softly. */
  player: boolean;
};

function kitOf(f: Fighter, types: readonly MoveType[]): Kit {
  if (f.moves) {
    // A moveset with nothing that hits gets its plain swing back — otherwise
    // teaching one status move left a companion strictly worse off than
    // teaching nothing. An empty one is just the plain swing.
    const ids: (number | null)[] = !f.moves.length ? [null] : hasDamaging([...f.moves]) ? [...f.moves] : [...f.moves, null];
    return { ids, weight: () => 1, table: MATCHUP_WEIGHT, player: true };
  }
  const pool = f.named?.length ? namedPool(f.named, types) : f.speciesId ? foePool(f.speciesId) : null;
  const weights = new Map<number | null, number>(pool ? pool.moves.map((m, i) => [m.id, pool.weights[i]] as const) : []);
  return {
    ids: pool ? pool.moves.map((m) => m.id) : [null],
    weight: (id) => weights.get(id) ?? 1,
    table: FOE_MATCHUP_WEIGHT,
    player: false,
  };
}

type Stages = Record<StatKey, number>;
const ZERO_STAGES = (): Stages => ({ atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 });

/** One Pokemon on a team: what it keeps when it switches out. */
type Mon = {
  f: Fighter;
  /** Base stats, before the level-50 formula — 집단구타 reads a teammate's attack from here. */
  base: readonly number[];
  stats: BattleStats;
  maxHp: number;
  hp: number;
  types: readonly MoveType[];
  weightKg: number;
  status: Condition | null;
  sleepLeft: number;
  kit: Kit;
  /** PP spent so far, by move id. The table's `pp` is the full count. */
  ppUsed: Map<number, number>;
  /** Turns spent out, for a Gigantamax that wears off. */
  turnsOut: number;
  /** Times it has been hit this fight, across switches — 분노의주먹. */
  timesHit: number;
  /** Its own ability, which it comes back to whenever it is sent out. */
  ability: string | null;
  /** One-per-fight abilities already spent: 불요의검, 불굴의방패, 감미로운꿀, 유대변화, 마이티체인지. */
  spent: Set<string>;
  /** The battle form an ability has put it in, by PokeAPI name — 킬가르도's blade and the like. */
  form: string | null;
};

/**
 * The Pokemon out on one side, and everything that belongs to being out:
 * stat stages, a substitute, a taunt. All of it goes when it switches out —
 * except what 배턴터치 hands on.
 */
type Side = {
  mon: Mon;
  stats: BattleStats;
  maxHp: number;
  hp: number;
  types: readonly MoveType[];
  weightKg: number;
  friendship: number;
  status: Condition | null;
  sleepLeft: number;
  /** How many turns 맹독 has been ticking. Starts over on every switch-in. */
  toxicN: number;
  confused: number;
  trapped: number;
  volatile: Set<string>;
  stages: Stages;
  critStage: number;
  substitute: number;
  taunt: number;
  encore: { id: number | null; turns: number } | null;
  healBlock: number;
  telekinesis: number;
  cursed: boolean;
  imprisoning: boolean;
  snatching: boolean;
  /** 흉내내기's learned move, replacing 흉내내기 in the kit while it stays out. */
  mimic: number | null;
  lastMove: number | null | undefined;
  lastFailed: boolean;
  streak: number;
  charging: number | null;
  vanished: 'air' | 'ground' | 'water' | 'gone' | null;
  recharge: boolean;
  protecting: boolean;
  enduring: boolean;
  protectRun: number;
  flinched: boolean;
  wasHit: boolean;
  moved: boolean;
  /** What this side picked this turn — 기선제압 and 가로채기 look at the other's. */
  picked: number | null;
  /** Stages went up this turn — 매혹의보이스, 질투의불꽃. */
  rose: boolean;
  /** Stages went down this turn — 분풀이. */
  fell: boolean;
  /** Damage the opponent's moves did to it this turn, by class — 카운터, 미러코트. */
  took: { physical: number; special: number };
  /** Locked into a move for several turns: 역린, 구르기, 소란피기, 참기. */
  lock: { id: number; kind: 'rampage' | 'rollout' | 'uproar' | 'bide'; turns: number; stored: number } | null;
  /** Kept on using 분노. */
  raging: boolean;
  /** 충전 is holding a charge. */
  charged: boolean;
  /** Has used 웅크리기 while out. */
  curled: boolean;
  /** 떨어뜨리기 brought it down; it stays grounded while out. */
  smackedDown: boolean;
  /** Turns of 지옥찌르기 left. */
  silenced: number;
  /** Carried up by the other side's 프리폴. */
  held: boolean;
  /** Its own types while 날개쉬기 has taken the Flying one away. */
  roostTypes: readonly MoveType[] | null;
  /** Nothing tried since it came in — 속이기 and 만나자마자 need this. */
  fresh: boolean;
  /** Moves tried since it came in — 비장의무기. */
  tried: Set<number>;
  seeded: boolean;
  /** Turns left on 멸망의노래, 0 when none. */
  perish: number;
  /** Turns until 하품 puts it to sleep, 0 when none. */
  drowsy: number;
  disabled: { id: number; turns: number } | null;
  /** Its next move cannot miss — 마음의눈, 록온. Turns left. */
  lockOn: number;
  destinyBond: boolean;
  grudge: boolean;
  minimized: boolean;
  /** 냄새구별: its evasion does not count, and Normal and Fighting moves reach it. */
  identified: boolean;
  stockpile: number;
  ingrained: boolean;
  aquaRing: boolean;
  magnetRise: number;
  /** Cannot flee or be switched by its own hand — 검은눈빛 and the like. */
  noEscape: boolean;
  noRetreat: boolean;
  magicCoat: boolean;
  /** 변신 or 스케치: the moves it now has instead. */
  moveset: number[] | null;
  laserFocus: number;
  /** 대검돌격: until it moves again, it takes double and cannot dodge. */
  glaive: boolean;
  salted: boolean;
  syrup: number;
  octolock: boolean;
  /** 송전: its move this turn is Electric. */
  electrified: boolean;
  /** 부리캐논 heating up, 트랩셸 set — this turn only. */
  beak: boolean;
  shellTrap: boolean;
  /** Which protection it is behind, for the ones with a sting. */
  protectId: number | null;
  /** Its ability right now — 트레이스, 스킬스왑 and 미라 can change it until it goes back. */
  ability: string | null;
  /** 위액 or 코어퍼니셔: its ability does nothing until it leaves. */
  abilityOff: boolean;
  /** 타오르는불꽃 has taken a Fire move: its own Fire moves are half again. */
  flashFire: boolean;
  /** 슬로스타트: turns left at half attack and speed. */
  slowStart: number;
  /** 게으름: this turn is the one it loafs. */
  loafing: boolean;
  /** 변환자재, 리베로: already changed type since it came in. */
  shifted: boolean;
  /** 무아지경: the move it is locked into. */
  choiceLock: number | null;
  /** 편승: copying the other side's boost, so it does not copy its own copy. */
  copying: boolean;
  /** Came in this very turn — 잠복 hits it twice as hard. */
  justIn: boolean;
};

/** One team: its Pokemon, who is out, and its half of the field. */
type Team = {
  mons: Mon[];
  slot: number;
  active: Side;
  screens: Partial<Record<Screen | 'safeguard' | 'mist', number>>;
  /** A 희망사항 coming true at the end of next turn, for whoever is out. */
  wish: { turns: number; hp: number } | null;
  /** 치유소원 or 초승달춤: the next one in comes in whole. */
  healingWish: boolean;
  /** 와이드가드 and its kin, for this turn. */
  guard: Guard | null;
  hazards: Partial<Record<Hazard, number>>;
  /** A 미래예지 on its way to whoever is out here. */
  future: { turns: number; damage: number } | null;
  /** Whether this is a wild Pokemon — the fight ends rather than switching. */
  wild: boolean;
  /** The turn one of this team last fainted on, for 원수갚기. */
  faintedOn: number;
};

function monOf(f: Fighter): Mon {
  const info = f.speciesId ? speciesInfo(f.speciesId) : null;
  const base = f.stats ?? (f.speciesId ? statsOf(f.speciesId) : null) ?? Array(6).fill(f.rarity ? FALLBACK_BASE[f.rarity] : 80);
  const stats = gritted(battleStats(base), f.grit ?? 1);
  const types = f.types ?? info?.types ?? [];
  const hp = Math.max(0, Math.min(stats.hp, f.startHp ?? stats.hp));
  return {
    f,
    base,
    stats,
    maxHp: stats.hp,
    hp,
    types,
    weightKg: f.weightKg ?? info?.weightKg ?? 50,
    status: f.startStatus ?? null,
    sleepLeft: 0,
    kit: kitOf(f, types),
    ppUsed: new Map(),
    turnsOut: 0,
    timesHit: 0,
    ability: f.ability ?? null,
    spent: new Set(),
    form: null,
  };
}

function sideOf(mon: Mon): Side {
  return {
    mon,
    stats: mon.stats,
    maxHp: mon.maxHp,
    hp: mon.hp,
    types: mon.types,
    weightKg: mon.weightKg,
    friendship: mon.f.friendship,
    status: mon.status,
    sleepLeft: mon.sleepLeft,
    toxicN: 0,
    confused: 0,
    trapped: 0,
    volatile: new Set(),
    stages: ZERO_STAGES(),
    critStage: 0,
    substitute: 0,
    taunt: 0,
    encore: null,
    healBlock: 0,
    telekinesis: 0,
    cursed: false,
    imprisoning: false,
    snatching: false,
    mimic: null,
    lastMove: undefined,
    lastFailed: false,
    streak: 0,
    charging: null,
    vanished: null,
    recharge: false,
    protecting: false,
    enduring: false,
    protectRun: 0,
    flinched: false,
    wasHit: false,
    moved: false,
    picked: null,
    rose: false,
    fell: false,
    took: { physical: 0, special: 0 },
    lock: null,
    raging: false,
    charged: false,
    curled: false,
    smackedDown: false,
    silenced: 0,
    held: false,
    roostTypes: null,
    fresh: true,
    tried: new Set(),
    seeded: false,
    perish: 0,
    drowsy: 0,
    disabled: null,
    lockOn: 0,
    destinyBond: false,
    grudge: false,
    minimized: false,
    identified: false,
    stockpile: 0,
    ingrained: false,
    aquaRing: false,
    magnetRise: 0,
    noEscape: false,
    noRetreat: false,
    magicCoat: false,
    moveset: null,
    laserFocus: 0,
    glaive: false,
    salted: false,
    syrup: 0,
    octolock: false,
    electrified: false,
    beak: false,
    shellTrap: false,
    protectId: null,
    ability: mon.ability,
    abilityOff: false,
    flashFire: false,
    slowStart: mon.ability === 'slow-start' ? 5 : 0,
    loafing: false,
    shifted: false,
    choiceLock: null,
    copying: false,
    justIn: true,
  };
}

/** Write back what a Pokemon keeps when it leaves the field. */
function stow(t: Team): void {
  const s = t.active;
  s.mon.hp = s.hp;
  s.mon.status = s.status;
  s.mon.sleepLeft = s.sleepLeft;
}

/** Whether a team has anybody else who could come in. */
function benchOf(t: Team): number[] {
  return t.mons.map((_, i) => i).filter((i) => i !== t.slot && t.mons[i].hp > 0);
}

/** The weather, terrain, rooms and Trick Room both sides share. */
type Field = {
  /** `primal`: 시작의바다, 끝의대지, 델타스트림 — nothing replaces it, and it lasts while its holder does. */
  weather: { kind: Weather; turns: number; primal?: boolean } | null;
  terrain: { kind: Terrain; turns: number } | null;
  trickRoom: number;
  rooms: Partial<Record<Room, number>>;
  /** Somebody is in a 소란피기: nobody on the field can fall asleep. */
  uproar: boolean;
  /** 물놀이, 흙놀이: turns left, Fire and Electric at a third. */
  sports: Partial<Record<'water' | 'mud', number>>;
  /** 페어리록: nobody can flee next turn. */
  fairyLock: number;
  /** 플라스마피스트: Normal moves are Electric for the rest of this turn. */
  plasma: boolean;
  /** The last move anybody used — 흉내쟁이. */
  lastMove: number | null;
  /** The move used just before, this turn — 크로스플레임, 크로스썬더. */
  lastThisTurn: number | null;
};

/** The games' stage multiplier: +1 is 1.5x, -1 is 2/3. */
function stageMult(stage: number): number {
  return stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage);
}

/** Accuracy and evasion use thirds instead of halves. */
function accuracyMult(stage: number): number {
  const s = Math.max(-MAX_STAGE, Math.min(MAX_STAGE, stage));
  return s >= 0 ? (3 + s) / 3 : 3 / (3 - s);
}

/** Crit odds by stage, Gen 7 onward. */
function critChance(stage: number): number {
  return stage <= 0 ? 1 / 24 : stage === 1 ? 1 / 8 : stage === 2 ? 1 / 2 : 1;
}

/** Speed as the turn order reads it: stages, Tailwind, and a paralysis halving. */
function speedOf(s: Side, t: Team): number {
  let v = Math.floor(s.stats.spe * stageMult(s.stages.spe) * abilityStatMult(s, 'spe'));
  if (t.screens.tailwind) v *= 2;
  // 속보 is quicker for its paralysis, not slower.
  if (s.status === 'paralysis' && !has(s, 'quick-feet')) v = Math.floor(v / 2);
  return v;
}

/** On the ground, for terrain and for ground moves. Gravity pulls everyone down; 텔레키네시스 lifts. */
function onGround(s: Side, field: Field): boolean {
  if (field.rooms.gravity || s.smackedDown || s.ingrained) return true;
  if (s.telekinesis > 0 || s.magnetRise > 0) return false;
  if (has(s, 'levitate') || has(s, 'eelevate')) return false;
  return grounded(s.types);
}

/** Move a stage and say so. Clamped at ±6; a clamped move records delta 0. */
function shift(s: Side, stat: StatKey, change: number, on: 'user' | 'target', events: BattleEvent[], from?: Side): void {
  // `from` is who caused it, when that is the other side — the only drops an
  // ability can stop, and the only ones that set off 오기.
  const byFoe = !!from && from !== s;
  const d = bentChange(s, change, byFoe ? from : undefined);
  if (byFoe && d < 0) {
    const guard = dropGuard(s, stat, from!);
    if (guard) {
      events.push({ k: 'ability', on, ability: guard });
      if (guard === 'mirror-armor') shift(from!, stat, d, on === 'user' ? 'target' : 'user', events);
      else events.push({ k: 'stat-held', on });
      return;
    }
  }
  const before = s.stages[stat];
  const after = Math.max(-MAX_STAGE, Math.min(MAX_STAGE, before + d));
  s.stages[stat] = after;
  if (after > before) s.rose = true;
  if (after < before) s.fell = true;
  events.push({ k: 'stat', on, stat, delta: after - before, tried: d });
  if (byFoe && after < before) afterDrop(s, on, events);
  if (!byFoe && after > before) afterRise(s, stat, after - before, on, events);
}

/**
 * Everything a move's stage changes do, to whichever side they land on. A
 * substitute keeps the other side's drops off; its own boosts still land.
 */
function applyStats(move: MoveInfo, user: Side, target: Side, events: BattleEvent[], targetTeam?: Team): void {
  const self = statsOnUser(move);
  const who = self ? user : target;
  if (who.hp <= 0) return;
  if (!self && target.substitute > 0) return;
  // 흰안개 keeps the other side's drops off, and says so once.
  if (!self && targetTeam?.screens.mist && move.statChanges.some((c) => c.change < 0)) {
    for (const c of move.statChanges) if (c.change > 0) shift(who, STAT_KEY[c.stat], c.change, 'target', events);
    events.push({ k: 'mist-held' });
    return;
  }
  for (const c of move.statChanges) shift(who, STAT_KEY[c.stat], c.change, self ? 'user' : 'target', events);
}

// ── Abilities ───────────────────────────────────────────────────────────────
//
// What each ability does, at the point in a fight where it acts. Who has
// which, and the few that do nothing here, are server/abilities.ts.

/**
 * The fight being played.
 *
 * Abilities reach into places deep in the stack that were written without a
 * fight in hand — a stat stage moving, a condition landing — and threading the
 * context through every one of those calls would touch half this file for one
 * question each. `fightAt` sets it and puts it back; nothing else writes it.
 */
let CTX: Ctx | null = null;

/** 틀깨기 and its two twins: the target's defensive abilities do not count. */
const MOLD_BREAKERS = new Set(['mold-breaker', 'turboblaze', 'teravolt']);

/**
 * The abilities 틀깨기 walks past — the ones that would stop or soften a move
 * aimed at their holder. The games' own list.
 */
const BREAKABLE = new Set([
  'battle-armor', 'big-pecks', 'bulletproof', 'clear-body', 'contrary', 'damp', 'dazzling', 'disguise',
  'dry-skin', 'filter', 'flash-fire', 'flower-gift', 'flower-veil', 'fluffy', 'friend-guard', 'fur-coat',
  'grass-pelt', 'heatproof', 'heavy-metal', 'hyper-cutter', 'ice-face', 'ice-scales', 'immunity',
  'inner-focus', 'insomnia', 'keen-eye', 'leaf-guard', 'levitate', 'light-metal', 'lightning-rod',
  'limber', 'magic-bounce', 'magma-armor', 'marvel-scale', 'mirror-armor', 'motor-drive', 'multiscale',
  'oblivious', 'overcoat', 'own-tempo', 'pastel-veil', 'punk-rock', 'queenly-majesty', 'sand-veil',
  'sap-sipper', 'shell-armor', 'shield-dust', 'simple', 'snow-cloak', 'solid-rock', 'soundproof',
  'sticky-hold', 'storm-drain', 'sturdy', 'suction-cups', 'sweet-veil', 'tangled-feet', 'telepathy',
  'thick-fat', 'unaware', 'vital-spirit', 'volt-absorb', 'water-absorb', 'water-bubble', 'water-veil',
  'white-smoke', 'wonder-guard', 'wonder-skin', 'armor-tail', 'earth-eater', 'good-as-gold',
  'purifying-salt', 'well-baked-body', 'wind-rider', 'thermal-exchange', 'eelevate', 'aura-guard',
  'aroma-veil',
]);

/** Abilities nothing can copy, swap or suppress: the ones a species' very form rests on. */
const FIXED_ABILITIES = new Set([
  'multitype', 'stance-change', 'schooling', 'comatose', 'shields-down', 'disguise', 'rks-system',
  'battle-bond', 'power-construct', 'ice-face', 'gulp-missile', 'zero-to-hero', 'commander', 'tera-shift',
  'as-one-glastrier', 'as-one-spectrier', 'zen-mode',
]);

/** Its ability right now, if it is doing anything: not suppressed, not smothered by 화학변화가스. */
function abilityOn(s: Side, c: Ctx | null = CTX): string | null {
  if (!s.ability || s.abilityOff) return null;
  if (c && s.ability !== 'neutralizing-gas' && !FIXED_ABILITIES.has(s.ability)) {
    for (const o of [c.me.active, c.foe.active]) {
      if (o !== s && o.hp > 0 && o.ability === 'neutralizing-gas' && !o.abilityOff) return null;
    }
  }
  return s.ability;
}

/** The move being made right now ignores abilities outright — 메테오드라이브, 섀도레이, 포톤가이저. */
const IGNORES_ABILITIES = new Set([713, 714, 722]);
let ignoringFor: Side | null = null;

function moldBreaks(attacker: Side, c: Ctx | null = CTX): boolean {
  const a = abilityOn(attacker, c);
  return (!!a && MOLD_BREAKERS.has(a)) || ignoringFor === attacker;
}

/**
 * Whether `s` has this ability working. `attacker` is the side whose move is
 * being answered: a 틀깨기 walks past the abilities on BREAKABLE.
 */
function has(s: Side, slug: string, attacker?: Side, c: Ctx | null = CTX): boolean {
  if (abilityOn(s, c) !== slug) return false;
  if (attacker && attacker !== s && BREAKABLE.has(slug) && moldBreaks(attacker, c)) return false;
  return true;
}

/** The side facing this one. */
function facing(s: Side, c: Ctx | null = CTX): Side | null {
  if (!c) return null;
  return c.me.active === s ? c.foe.active : c.foe.active === s ? c.me.active : null;
}

/** Which team a side is on, and its absolute name. */
function teamOf(s: Side, c: Ctx): Team {
  return c.me.active === s ? c.me : c.foe;
}

/**
 * The weather as the fight reads it: 날씨부정 and 에어록 anywhere on the field
 * leave it in the sky and take it out of the rules.
 */
function weatherOf(c: Ctx | null = CTX): Weather | null {
  if (!c?.field.weather) return null;
  for (const s of [c.me.active, c.foe.active]) {
    const a = s.hp > 0 ? abilityOn(s, c) : null;
    if (a === 'cloud-nine' || a === 'air-lock') return null;
  }
  return c.field.weather.kind;
}

/** Protosynthesis and Quark Drive raise whichever stat is highest. Which one that is. */
function highestStat(s: Side): 'atk' | 'def' | 'spa' | 'spd' | 'spe' {
  const order = ['atk', 'def', 'spa', 'spd', 'spe'] as const;
  return order.reduce((best, k) => (s.stats[k] > s.stats[best] ? k : best), order[0]);
}

/** 고대활성 in the sun, 쿼크차지 on Electric Terrain: whether it is running right now. */
function paradoxOn(s: Side, c: Ctx | null = CTX): boolean {
  if (!c) return false;
  if (has(s, 'protosynthesis')) return weatherOf(c) === 'sun';
  if (has(s, 'quark-drive')) return c.field.terrain?.kind === 'electric';
  return false;
}

/**
 * What a side's abilities do to one of its own stats, before stages: 천하장사
 * doubles attack, 쓱쓱 doubles speed in the rain, 퍼코트 doubles defence
 * against a physical hit. The 재앙 abilities of the OTHER side lower it.
 */
function abilityStatMult(s: Side, stat: 'atk' | 'def' | 'spa' | 'spd' | 'spe', attacker?: Side): number {
  const c = CTX;
  if (!c) return 1;
  const w = weatherOf(c);
  const terrain = c.field.terrain?.kind ?? null;
  const half = s.hp * 2 <= s.maxHp;
  let m = 1;
  const on = (slug: string) => has(s, slug, attacker);
  switch (stat) {
    case 'atk':
      if (on('huge-power') || on('pure-power')) m *= 2;
      if (on('guts') && s.status) m *= 1.5;
      if (on('hustle') || on('gorilla-tactics')) m *= 1.5;
      if (on('defeatist') && half) m *= 0.5;
      if (on('slow-start') && s.slowStart > 0) m *= 0.5;
      if (on('flower-gift') && w === 'sun') m *= 1.5;
      if (on('toxic-boost') && (s.status === 'poison' || s.status === 'toxic')) m *= 1.5;
      if (on('orichalcum-pulse') && w === 'sun') m *= 5461 / 4096;
      break;
    case 'spa':
      if (on('solar-power') && w === 'sun') m *= 1.5;
      if (on('flare-boost') && s.status === 'burn') m *= 1.5;
      if (on('defeatist') && half) m *= 0.5;
      if (on('hadron-engine') && terrain === 'electric') m *= 5461 / 4096;
      break;
    case 'def':
      if (on('marvel-scale') && s.status) m *= 1.5;
      if (on('fur-coat')) m *= 2;
      if (on('grass-pelt') && terrain === 'grassy') m *= 1.5;
      break;
    case 'spd':
      if (on('flower-gift') && w === 'sun') m *= 1.5;
      break;
    case 'spe':
      if ((on('swift-swim') && w === 'rain') || (on('chlorophyll') && w === 'sun') || (on('sand-rush') && w === 'sand')) m *= 2;
      if ((on('slush-rush') && (w === 'hail' || w === 'snow')) || (on('surge-surfer') && terrain === 'electric')) m *= 2;
      if (on('quick-feet') && s.status) m *= 1.5;
      if (on('slow-start') && s.slowStart > 0) m *= 0.5;
      break;
  }
  if (paradoxOn(s, c) && highestStat(s) === stat) m *= stat === 'spe' ? 1.5 : 5325 / 4096;
  // The four 재앙 abilities lower the stat of everyone but their holder.
  const o = facing(s, c);
  if (o && o.hp > 0) {
    const ruin = abilityOn(o, c);
    if (
      (ruin === 'tablets-of-ruin' && stat === 'atk') ||
      (ruin === 'vessel-of-ruin' && stat === 'spa') ||
      (ruin === 'sword-of-ruin' && stat === 'def') ||
      (ruin === 'beads-of-ruin' && stat === 'spd')
    ) {
      m *= 0.75;
    }
  }
  return m;
}

/**
 * Put a side in a battle form an ability switches it into: its own types and
 * base stats, from BATTLE_FORMS. A form with a different HP stat (the complete
 * 지가르데) keeps the damage it has taken and gains the difference.
 */
function setForm(s: Side, name: string): boolean {
  const f = BATTLE_FORMS[name];
  if (!f || s.mon.form === name) return false;
  const next = gritted(battleStats(f.stats), s.mon.f.grit ?? 1);
  const gained = next.hp - s.maxHp;
  s.stats = { ...next };
  s.types = [...f.types];
  if (gained !== 0) {
    s.maxHp = next.hp;
    s.mon.maxHp = next.hp;
    s.hp = Math.max(1, Math.min(s.maxHp, s.hp + Math.max(0, gained)));
  }
  s.mon.form = name;
  return true;
}

/**
 * Whether an ability stops this stage from dropping, and which: 클리어바디 and
 * its kin stop all of them, 괴력집게 attack, 부풀린가슴 defence, 날카로운눈
 * accuracy; 미러아머 sends it back. Only drops the other side causes.
 */
function dropGuard(s: Side, stat: StatKey, from: Side): string | null {
  for (const slug of ['clear-body', 'white-smoke', 'full-metal-body', 'mirror-armor']) {
    if (has(s, slug, from)) return slug;
  }
  if (stat === 'atk' && has(s, 'hyper-cutter', from)) return 'hyper-cutter';
  if (stat === 'def' && has(s, 'big-pecks', from)) return 'big-pecks';
  if (stat === 'acc' && (has(s, 'keen-eye', from) || has(s, 'minds-eye', from))) return abilityOn(s)!;
  if (s.types.includes('grass') && has(s, 'flower-veil', from)) return 'flower-veil';
  return null;
}

/**
 * Stage changes, through the abilities that bend them. Called by `shift`
 * before anything moves.
 *
 * 심술꾸러기 flips it, 단순 doubles it. A drop caused by the other side can be
 * stopped (see `dropGuard`) and, once it lands, sets off 오기 and 승기.
 */
function bentChange(s: Side, change: number, from?: Side): number {
  if (!CTX) return change;
  let d = change;
  if (has(s, 'contrary', from)) d = -d;
  if (has(s, 'simple', from)) d *= 2;
  return d;
}

/** What an ability does once a stage has actually dropped at the other side's hand. */
function afterDrop(s: Side, on: 'user' | 'target', events: BattleEvent[]): void {
  if (has(s, 'defiant')) {
    events.push({ k: 'ability', on, ability: 'defiant' });
    shift(s, 'atk', 2, on, events);
  } else if (has(s, 'competitive')) {
    events.push({ k: 'ability', on, ability: 'competitive' });
    shift(s, 'spa', 2, on, events);
  }
}

/** 편승: the other side copies a boost this side gave itself. */
function afterRise(s: Side, stat: StatKey, delta: number, on: 'user' | 'target', events: BattleEvent[]): void {
  const o = facing(s);
  if (!o || o.copying || o.hp <= 0 || !has(o, 'opportunist')) return;
  o.copying = true;
  const back = on === 'user' ? 'target' : 'user';
  events.push({ k: 'ability', on: back, ability: 'opportunist' });
  shift(o, stat, delta, back, events);
  o.copying = false;
}

/**
 * A side's ability as it comes out: the weather it brings, the terrain, 위협,
 * 다운로드, 트레이스, 괴짜 and the rest. Written as EndEvents onto `entry`,
 * because a switch-in is not anybody's move.
 */
function onEntry(t: Team, c: Ctx, entry: EndEvent[]): void {
  const s = t.active;
  const o = otherOf(c, t).active;
  if (s.hp <= 0) return;
  const on = t === c.me ? 'me' : 'foe';
  const back = on === 'me' ? 'foe' : 'me';
  const a = abilityOn(s, c);
  if (!a) return;
  const say = () => entry.push({ k: 'ability', on, ability: a });
  const stats = (events: BattleEvent[], userAbs: 'me' | 'foe') => {
    for (const e of events) {
      if (e.k === 'stat') entry.push({ k: 'end-stat', on: e.on === 'user' ? userAbs : userAbs === 'me' ? 'foe' : 'me', stat: e.stat, delta: e.delta });
      else if (e.k === 'ability') entry.push({ k: 'ability', on: e.on === 'user' ? userAbs : userAbs === 'me' ? 'foe' : 'me', ability: e.ability });
      else if (e.k === 'stat-held') entry.push({ k: 'end-stat-held', on: e.on === 'user' ? userAbs : userAbs === 'me' ? 'foe' : 'me' });
    }
  };
  const setWeather = (w: Weather, primal = false) => {
    if (c.field.weather?.primal && !primal) return;
    if (c.field.weather?.kind === w && !primal) return;
    say();
    c.field.weather = { kind: w, turns: primal ? Infinity : WEATHER_TURNS, ...(primal ? { primal: true } : {}) };
    entry.push({ k: 'weather-set', weather: w });
  };
  const setTerrain = (tr: Terrain) => {
    if (c.field.terrain?.kind === tr) return;
    say();
    c.field.terrain = { kind: tr, turns: TERRAIN_TURNS };
    entry.push({ k: 'terrain-set', terrain: tr });
  };
  switch (a) {
    case 'drizzle':
      return setWeather('rain');
    case 'drought':
    case 'orichalcum-pulse':
      return setWeather('sun');
    case 'sand-stream':
      return setWeather('sand');
    case 'snow-warning':
      return setWeather('snow');
    case 'primordial-sea':
      return setWeather('rain', true);
    case 'desolate-land':
      return setWeather('sun', true);
    case 'delta-stream':
      return setWeather('winds', true);
    case 'electric-surge':
    case 'hadron-engine':
      return setTerrain('electric');
    case 'psychic-surge':
      return setTerrain('psychic');
    case 'misty-surge':
      return setTerrain('misty');
    case 'grassy-surge':
      return setTerrain('grassy');
    case 'intimidate': {
      if (o.hp <= 0) return;
      say();
      const events: BattleEvent[] = [];
      // 정신력, 마이페이스, 둔감, 배짱 shrug it off; 파수견 turns it round; 주눅 runs from it.
      if (['inner-focus', 'own-tempo', 'oblivious', 'scrappy'].some((x) => has(o, x, s))) {
        events.push({ k: 'ability', on: 'target', ability: abilityOn(o)! });
        events.push({ k: 'stat-held', on: 'target' });
      } else if (has(o, 'guard-dog', s)) {
        events.push({ k: 'ability', on: 'target', ability: 'guard-dog' });
        shift(o, 'atk', 1, 'target', events);
      } else if (o.substitute === 0) {
        shift(o, 'atk', -1, 'target', events, s);
      }
      if (has(o, 'rattled')) {
        events.push({ k: 'ability', on: 'target', ability: 'rattled' });
        shift(o, 'spe', 1, 'target', events);
      }
      stats(events, on);
      return;
    }
    case 'supersweet-syrup': {
      if (s.mon.spent.has(a) || o.hp <= 0) return;
      s.mon.spent.add(a);
      say();
      const events: BattleEvent[] = [];
      shift(o, 'eva', -1, 'target', events, s);
      stats(events, on);
      return;
    }
    case 'download': {
      if (o.hp <= 0) return;
      say();
      const events: BattleEvent[] = [];
      const def = o.stats.def * stageMult(o.stages.def);
      const spd = o.stats.spd * stageMult(o.stages.spd);
      shift(s, def < spd ? 'atk' : 'spa', 1, 'user', events);
      stats(events, on);
      return;
    }
    case 'intrepid-sword':
    case 'dauntless-shield': {
      if (s.mon.spent.has(a)) return;
      s.mon.spent.add(a);
      say();
      const events: BattleEvent[] = [];
      shift(s, a === 'intrepid-sword' ? 'atk' : 'def', 1, 'user', events);
      stats(events, on);
      return;
    }
    case 'trace': {
      const theirs = abilityOn(o, c);
      if (!theirs || FIXED_ABILITIES.has(theirs) || ['trace', 'imposter', 'neutralizing-gas', 'flower-gift', 'illusion'].includes(theirs)) return;
      s.ability = theirs;
      entry.push({ k: 'end-trace', on, ability: theirs });
      onEntry(t, c, entry);
      return;
    }
    case 'imposter': {
      if (o.hp <= 0 || o.substitute > 0) return;
      s.types = [...o.types];
      s.stats = { ...o.stats, hp: s.stats.hp };
      s.stages = { ...o.stages };
      s.moveset = kitIds(o).filter((id): id is number => id !== null);
      s.ability = o.ability;
      entry.push({ k: 'end-transform', on });
      return;
    }
    case 'screen-cleaner':
      say();
      for (const tm of [c.me, c.foe]) for (const k of ['reflect', 'lightScreen', 'auroraVeil'] as const) delete tm.screens[k];
      entry.push({ k: 'end-screens-gone' });
      return;
    case 'mimicry':
    case 'forecast':
      shapeByField(s, on, c, entry);
      return;
    case 'zero-to-hero':
      if (s.mon.spent.has('zero-to-hero') && setForm(s, 'palafin-hero')) {
        say();
        entry.push({ k: 'end-form', on, form: 'palafin-hero' });
      }
      return;
    case 'tera-shift':
      if (setForm(s, 'terapagos-terastal')) {
        say();
        entry.push({ k: 'end-form', on, form: 'terapagos-terastal' });
      }
      return;
    case 'anticipation': {
      // A shudder if the other side has a move that would hit it hard, or an OHKO.
      const scary = kitIds(o).some((id) => {
        const m = id === null ? null : moveOf(id);
        return !!m && m.damageClass !== 'status' && (OHKO_MOVES.has(m.id) || (s.types.length > 0 && effectiveness(m.type, s.types) > 1));
      });
      if (scary) {
        say();
        entry.push({ k: 'end-shudder', on });
      }
      return;
    }
    case 'forewarn': {
      const best = kitIds(o)
        .map((id) => (id === null ? null : moveOf(id)))
        .filter((m): m is MoveInfo => !!m)
        .sort((x, y) => (OHKO_MOVES.has(y.id) ? 150 : y.power) - (OHKO_MOVES.has(x.id) ? 150 : x.power))[0];
      if (best) {
        say();
        entry.push({ k: 'end-forewarn', on: back, moveId: best.id });
      }
      return;
    }
    case 'pressure':
    case 'mold-breaker':
    case 'turboblaze':
    case 'teravolt':
    case 'air-lock':
    case 'cloud-nine':
    case 'neutralizing-gas':
    case 'slow-start':
    case 'vessel-of-ruin':
    case 'sword-of-ruin':
    case 'tablets-of-ruin':
    case 'beads-of-ruin':
    case 'as-one-glastrier':
    case 'as-one-spectrier':
      // They announce themselves; what they do is read wherever it applies.
      say();
      return;
    case 'protosynthesis':
    case 'quark-drive':
      if (paradoxOn(s, c)) say();
      return;
    case 'shields-down':
    case 'schooling':
    case 'zen-mode':
      formByHp(s, on, c, entry);
      return;
  }
}

/** 기분파 follows the weather, 의태 the terrain. */
function shapeByField(s: Side, on: 'me' | 'foe', c: Ctx, out: EndEvent[]): void {
  if (has(s, 'forecast')) {
    const w = weatherOf(c);
    const name = w === 'sun' ? 'castform-sunny' : w === 'rain' ? 'castform-rainy' : w === 'hail' || w === 'snow' ? 'castform-snowy' : 'castform';
    if (setForm(s, name)) {
      out.push({ k: 'ability', on, ability: 'forecast' });
      out.push({ k: 'end-form', on, form: name });
    }
  }
  if (has(s, 'mimicry')) {
    const tr = c.field.terrain?.kind ?? null;
    const types: MoveType[] = tr ? [TERRAIN_TYPE[tr]] : [...s.mon.types];
    if (types.join() !== s.types.join()) {
      s.types = types;
      out.push({ k: 'ability', on, ability: 'mimicry' });
      out.push({ k: 'end-type', on, types });
    }
  }
}

/** 리밋실드, 어군, 달마모드, 스웜체인지: forms that follow the HP bar. */
function formByHp(s: Side, on: 'me' | 'foe', c: Ctx, out: EndEvent[]): void {
  if (s.hp <= 0) return;
  const half = s.hp * 2 <= s.maxHp;
  const quarter = s.hp * 4 < s.maxHp;
  let name: string | null = null;
  if (has(s, 'shields-down')) name = half ? 'minior-red' : 'minior-red-meteor';
  else if (has(s, 'schooling')) name = quarter ? 'wishiwashi-solo' : 'wishiwashi-school';
  else if (has(s, 'zen-mode')) name = half ? 'darmanitan-zen' : 'darmanitan-standard';
  else if (has(s, 'power-construct') && half) name = 'zygarde-complete';
  if (name && setForm(s, name)) {
    out.push({ k: 'ability', on, ability: abilityOn(s, c)! });
    out.push({ k: 'end-form', on, form: name });
  }
}

/**
 * The abilities that act once both sides have moved: 가속, 탈피, 촉촉바디,
 * 젖은접시, 아이스바디, 건조피부, 선파워, 나이트메어, 변덕쟁이, the countdown
 * of 슬로스타트, and the forms that follow the HP bar or the weather.
 */
function abilityEndOfTurn(c: Ctx, order: ['me' | 'foe', Team][], end: EndEvent[], add: (on: 'me' | 'foe', hp: number) => void): void {
  const w = weatherOf(c);
  for (const [on, t] of order) {
    const s = t.active;
    if (s.hp <= 0) continue;
    const a = abilityOn(s, c);
    if (!a) continue;
    const say = () => end.push({ k: 'ability', on, ability: a });
    const heal = (div: number) => {
      if (s.hp >= s.maxHp || s.healBlock > 0) return;
      const hp = Math.min(s.maxHp - s.hp, Math.max(1, Math.floor(s.maxHp / div)));
      say();
      s.hp += hp;
      end.push({ k: 'end-heal', on, hp });
    };
    const hurt = (div: number) => {
      if (has(s, 'magic-guard')) return;
      const hp = Math.min(s.hp, Math.max(1, Math.floor(s.maxHp / div)));
      say();
      s.hp -= hp;
      add(on, hp);
      end.push({ k: 'end-hurt', on, hp });
    };
    switch (a) {
      case 'speed-boost':
        // Not on the turn it came in.
        if (!s.justIn && s.stages.spe < MAX_STAGE) {
          say();
          s.stages.spe = Math.min(MAX_STAGE, s.stages.spe + 1);
          end.push({ k: 'end-stat', on, stat: 'spe', delta: 1 });
        }
        break;
      case 'shed-skin':
        if (s.status && c.rng() < 1 / 3) {
          say();
          s.status = null;
          end.push({ k: 'end-cured', on });
        }
        break;
      case 'hydration':
        if (s.status && w === 'rain') {
          say();
          s.status = null;
          end.push({ k: 'end-cured', on });
        }
        break;
      case 'rain-dish':
        if (w === 'rain') heal(16);
        break;
      case 'ice-body':
        if (w === 'hail' || w === 'snow') heal(16);
        break;
      case 'dry-skin':
        if (w === 'rain') heal(8);
        else if (w === 'sun') hurt(8);
        break;
      case 'solar-power':
        if (w === 'sun') hurt(8);
        break;
      case 'bad-dreams': {
        const o = otherOf(c, t).active;
        if (o.hp > 0 && (o.status === 'sleep' || has(o, 'comatose')) && !has(o, 'magic-guard')) {
          const hp = Math.min(o.hp, Math.max(1, Math.floor(o.maxHp / 8)));
          say();
          o.hp -= hp;
          add(on === 'me' ? 'foe' : 'me', hp);
          end.push({ k: 'end-hurt', on: on === 'me' ? 'foe' : 'me', hp });
        }
        break;
      }
      case 'moody': {
        const up = (['atk', 'def', 'spa', 'spd', 'spe'] as const).filter((k) => s.stages[k] < MAX_STAGE);
        if (!up.length) break;
        say();
        const u = up[Math.floor(c.rng() * up.length)];
        s.stages[u] = Math.min(MAX_STAGE, s.stages[u] + 2);
        end.push({ k: 'end-stat', on, stat: u, delta: 2 });
        const down = (['atk', 'def', 'spa', 'spd', 'spe'] as const).filter((k) => k !== u && s.stages[k] > -MAX_STAGE);
        if (down.length) {
          const d = down[Math.floor(c.rng() * down.length)];
          s.stages[d]--;
          end.push({ k: 'end-stat', on, stat: d, delta: -1 });
        }
        break;
      }
      case 'slow-start':
        if (s.slowStart > 0 && --s.slowStart === 0) say();
        break;
      case 'hunger-switch':
        if (setForm(s, s.mon.form === 'morpeko-hangry' ? 'morpeko-full-belly' : 'morpeko-hangry')) {
          end.push({ k: 'end-form', on, form: s.mon.form! });
        }
        break;
    }
    formByHp(s, on, c, end);
    shapeByField(s, on, c, end);
    // 아이스페이스 grows back in the snow.
    if (has(s, 'ice-face') && s.mon.form === 'eiscue-noice' && (w === 'hail' || w === 'snow') && setForm(s, 'eiscue-ice')) {
      end.push({ k: 'end-form', on, form: 'eiscue-ice' });
    }
  }
}

/** 프리즈스킨 and its kin: Normal moves turn this type. */
const SKINS: Record<string, MoveType> = {
  refrigerate: 'ice',
  pixilate: 'fairy',
  aerilate: 'flying',
  galvanize: 'electric',
  dragonize: 'dragon',
};

/**
 * The type an ability turns a move into, or null when it leaves it be:
 * 노말스킨 makes everything Normal, the skins make Normal something else,
 * 촉촉보이스 makes sound Water. Each of the first two also hits a fifth harder.
 */
function skinType(move: MoveInfo, type: MoveType, u: Side): MoveType | null {
  const a = abilityOn(u);
  if (!a) return null;
  if (a === 'normalize') return 'normal';
  if (type === 'normal' && SKINS[a]) return SKINS[a];
  if (a === 'liquid-voice' && hasFlag(move, 'sound')) return 'water';
  return null;
}

/** The type a move will be when this side uses it — what 변환자재 turns into. */
function typeFor(move: MoveInfo, u: Side, c: Ctx): MoveType {
  let ty: MoveType = move.type;
  const w = weatherOf(c);
  if (move.id === 311 && w) ty = weatherBallType(w);
  if (move.id === REVELATION_DANCE && u.types.length) ty = u.types[0];
  ty = skinType(move, ty, u) ?? ty;
  if (u.electrified || (c.field.plasma && ty === 'normal')) ty = 'electric';
  return ty;
}

/** Wind moves — what 바람타기 rides and 풍력발전 charges from. The games' own flag, which PokeAPI lacks. */
const WIND_MOVES = new Set([177, 314, 846, 59, 584, 16, 257, 542, 196, 572, 848, 201, 831, 366, 239, 18, 847]);

/**
 * Whether the target's ability keeps this move off it altogether — and, for
 * the ones that drink it in, what it gets out of it instead.
 *
 * 방음 stops sound, 방탄 balls and bombs, 방진 powders, 황금몸 every status
 * move. 저수·축전·건조피부 heal a quarter; 마중물·피뢰침 raise special attack,
 * 초식 attack, 전기엔진 speed; 타오르는불꽃 lights up; 노릇노릇바디 raises
 * defence; 흙먹기 eats Ground moves; 바람타기 rides the wind.
 */
function abilityBlocks(move: MoveInfo, type: MoveType, u: Side, t: Side, tt: Team, out: Action, c: Ctx): boolean {
  void tt;
  void c;
  const stop = (slug: string) => {
    out.events.push({ k: 'ability', on: 'target', ability: slug });
    out.events.push({ k: 'immune', on: 'target' });
    return true;
  };
  if (hasFlag(move, 'sound') && has(t, 'soundproof', u)) return stop('soundproof');
  if (hasFlag(move, 'ballistics') && has(t, 'bulletproof', u)) return stop('bulletproof');
  if (POWDER_MOVES.has(move.id) && has(t, 'overcoat', u)) return stop('overcoat');
  if (move.damageClass === 'status' && has(t, 'good-as-gold', u)) return stop('good-as-gold');
  const heal = (slug: string) => {
    out.events.push({ k: 'ability', on: 'target', ability: slug });
    const hp = t.healBlock > 0 ? 0 : Math.min(t.maxHp - t.hp, Math.max(1, Math.floor(t.maxHp / 4)));
    if (hp > 0) {
      t.hp += hp;
      out.events.push({ k: 'heal', on: 'target', hp });
    } else out.events.push({ k: 'immune', on: 'target' });
    return true;
  };
  const boost = (slug: string, stat: StatKey, n: number) => {
    out.events.push({ k: 'ability', on: 'target', ability: slug });
    shift(t, stat, n, 'target', out.events);
    return true;
  };
  if (WIND_MOVES.has(move.id) && has(t, 'wind-rider', u)) return boost('wind-rider', 'atk', 1);
  switch (type) {
    case 'water':
      if (has(t, 'water-absorb', u)) return heal('water-absorb');
      if (has(t, 'dry-skin', u)) return heal('dry-skin');
      if (has(t, 'storm-drain', u)) return boost('storm-drain', 'spa', 1);
      break;
    case 'electric':
      if (has(t, 'volt-absorb', u)) return heal('volt-absorb');
      if (has(t, 'lightning-rod', u)) return boost('lightning-rod', 'spa', 1);
      if (has(t, 'motor-drive', u)) return boost('motor-drive', 'spe', 1);
      break;
    case 'grass':
      if (has(t, 'sap-sipper', u)) return boost('sap-sipper', 'atk', 1);
      break;
    case 'fire':
      if (has(t, 'flash-fire', u)) {
        out.events.push({ k: 'ability', on: 'target', ability: 'flash-fire' });
        out.events.push({ k: 'immune', on: 'target' });
        t.flashFire = true;
        return true;
      }
      if (has(t, 'well-baked-body', u)) return boost('well-baked-body', 'def', 2);
      break;
    case 'ground':
      if (move.damageClass !== 'status' && has(t, 'earth-eater', u)) return heal('earth-eater');
      break;
  }
  return false;
}

/** Slicing moves — what 예리함 sharpens. The games' flag, which PokeAPI lacks. */
const SLICING_MOVES = new Set([
  15, 75, 163, 210, 314, 332, 348, 400, 403, 404, 427, 440, 533, 534, 548, 669, 781, 830, 845, 860, 869, 875, 891, 895, 910, 911,
]);

/** Whether a move's secondary effects are what 우격다짐 trades away for power. */
function sheerForceable(move: MoveInfo): boolean {
  if (move.damageClass === 'status') return false;
  if (move.ailmentChance > 0 || move.flinchChance > 0) return true;
  // A stat change is a secondary effect when it is a chance; a certain drop on
  // the user (인파이트) is the price of the move, not a bonus.
  return move.statChance > 0 && move.statChance < 100 && move.statChanges.length > 0;
}

/**
 * What the abilities do to a move's power. The attacker's: 테크니션, 철주먹,
 * 옹골찬턱, 메가런처, 단단한발톱, 예리함, 이판사판, 우격다짐, 애널라이즈,
 * 잠복, 모래의힘, the type boosters, 심록과 친구들 at a third of the bar,
 * 타오르는불꽃 lit, the skins. The field's: 다크오라, 페어리오라.
 */
function abilityPowerMult(move: MoveInfo, type: MoveType, power: number, u: Side, t: Side, c: Ctx, skinned: boolean): number {
  let m = 1;
  const a = abilityOn(u, c);
  const w = weatherOf(c);
  const third = u.hp * 3 <= u.maxHp;
  const contact = hasFlag(move, 'contact') && a !== 'long-reach';
  switch (a) {
    case 'technician':
      if (power > 0 && power <= 60) m *= 1.5;
      break;
    case 'iron-fist':
      if (hasFlag(move, 'punch')) m *= 1.2;
      break;
    case 'strong-jaw':
      if (hasFlag(move, 'bite')) m *= 1.5;
      break;
    case 'mega-launcher':
      if (hasFlag(move, 'pulse')) m *= 1.5;
      break;
    case 'tough-claws':
      if (contact) m *= 5325 / 4096;
      break;
    case 'sharpness':
      if (SLICING_MOVES.has(move.id)) m *= 1.5;
      break;
    case 'reckless':
      if (move.drain < 0 || CRASH_MOVES.has(move.id)) m *= 1.2;
      break;
    case 'sheer-force':
      if (sheerForceable(move)) m *= 5325 / 4096;
      break;
    case 'analytic':
      if (t.moved) m *= 5325 / 4096;
      break;
    case 'stakeout':
      if (t.justIn) m *= 2;
      break;
    case 'sand-force':
      if (w === 'sand' && (type === 'rock' || type === 'ground' || type === 'steel')) m *= 5325 / 4096;
      break;
    case 'steelworker':
    case 'steely-spirit':
      if (type === 'steel') m *= 1.5;
      break;
    case 'transistor':
      if (type === 'electric') m *= 5325 / 4096;
      break;
    case 'dragons-maw':
      if (type === 'dragon') m *= 1.5;
      break;
    case 'rocky-payload':
      if (type === 'rock') m *= 1.5;
      break;
    case 'fire-mane':
      if (type === 'fire') m *= 1.5;
      break;
    case 'punk-rock':
      if (hasFlag(move, 'sound')) m *= 5325 / 4096;
      break;
    case 'water-bubble':
      if (type === 'water') m *= 2;
      break;
    case 'overgrow':
      if (third && type === 'grass') m *= 1.5;
      break;
    case 'blaze':
      if (third && type === 'fire') m *= 1.5;
      break;
    case 'torrent':
      if (third && type === 'water') m *= 1.5;
      break;
    case 'swarm':
      if (third && type === 'bug') m *= 1.5;
      break;
    case 'normalize':
    case 'refrigerate':
    case 'pixilate':
    case 'aerilate':
    case 'galvanize':
    case 'dragonize':
      if (skinned) m *= 1.2;
      break;
    case 'supreme-overlord': {
      const fallen = teamOf(u, c).mons.filter((x) => x !== u.mon && x.hp <= 0).length;
      m *= 1 + 0.1 * Math.min(5, fallen);
      break;
    }
    case 'mega-sol':
      // 메가솔라: its moves are used as if the sun were out.
      m *= weatherPowerMult('sun', type) / weatherPowerMult(w, type);
      break;
  }
  if (u.flashFire && type === 'fire') m *= 1.5;
  // 다크오라 and 페어리오라 on either side power up every move of their type; 오라브레이크 turns them round.
  const auras = [u, t].filter((x) => x.hp > 0).map((x) => abilityOn(x, c));
  const aura = (type === 'dark' && auras.includes('dark-aura')) || (type === 'fairy' && auras.includes('fairy-aura'));
  if (aura) m *= auras.includes('aura-break') ? 3072 / 4096 : 5448 / 4096;
  return m;
}

/**
 * What the abilities do to the finished damage: the target's 두꺼운지방,
 * 내열, 수포, 정화의소금, 건조피부, 복슬복슬, 필터 and its kin, 멀티스케일,
 * 얼음인분, 펑크록, 오라가드; the attacker's 색안경 and 브레인포스.
 */
function abilityDamageMult(
  move: MoveInfo,
  type: MoveType,
  effect: number,
  physical: boolean,
  contact: boolean,
  u: Side,
  t: Side,
  c: Ctx,
): number {
  let m = 1;
  const on = (slug: string) => has(t, slug, u, c);
  if (on('thick-fat') && (type === 'fire' || type === 'ice')) m *= 0.5;
  if ((on('heatproof') || on('water-bubble')) && type === 'fire') m *= 0.5;
  if (on('purifying-salt') && type === 'ghost') m *= 0.5;
  if (on('dry-skin') && type === 'fire') m *= 1.25;
  if (on('fluffy')) {
    if (contact) m *= 0.5;
    if (type === 'fire') m *= 2;
  }
  if ((on('filter') || on('solid-rock') || has(t, 'prism-armor', undefined, c)) && effect > 1) m *= 0.75;
  if ((on('multiscale') || has(t, 'shadow-shield', undefined, c)) && t.hp >= t.maxHp) m *= 0.5;
  if (on('ice-scales') && !physical) m *= 0.5;
  if (on('punk-rock') && hasFlag(move, 'sound')) m *= 0.5;
  if (on('aura-guard') && contact) m *= 0.5;
  if (has(u, 'tinted-lens', undefined, c) && effect > 0 && effect < 1) m *= 2;
  if (has(u, 'neuroforce', undefined, c) && effect > 1) m *= 1.25;
  return m;
}

/**
 * What an ability does when its holder is hit, one hit at a time: the contact
 * ones answer the attacker (정전기, 불꽃몸, 까칠한피부, 미라…), the rest react
 * to being hit at all (지구력, 깨어진갑옷, 정의의마음, 발끈…). And the
 * attacker's own contact abilities (독수, 독사슬) land here too.
 */
function reactToHit(
  move: MoveInfo,
  type: MoveType,
  dmg: number,
  crit: boolean,
  physical: boolean,
  contact: boolean,
  u: Side,
  t: Side,
  ut: Team,
  tt: Team,
  out: Action,
  c: Ctx,
): void {
  const rng = c.rng;
  const say = (on: 'user' | 'target', ability: string) => out.events.push({ k: 'ability', on, ability });
  const a = abilityOn(t, c);
  const hurtUser = (div: number, ability: string) => {
    if (u.hp <= 0 || has(u, 'magic-guard')) return;
    const hp = Math.min(u.hp, Math.max(1, Math.floor(u.maxHp / div)));
    say('target', ability);
    u.hp -= hp;
    out.events.push({ k: 'hurt', on: 'user', hp });
  };
  const statusUser = (cnd: Condition, ability: string) => {
    if (u.hp <= 0) return;
    if (inflict(u, ut, cnd, c.field, rng, t)) {
      say('target', ability);
      out.events.push({ k: 'self-status', condition: cnd });
    }
  };
  if (contact && u.hp > 0) {
    switch (a) {
      case 'static':
        if (rng() < 0.3) statusUser('paralysis', a);
        break;
      case 'flame-body':
        if (rng() < 0.3) statusUser('burn', a);
        break;
      case 'poison-point':
        if (rng() < 0.3) statusUser('poison', a);
        break;
      case 'effect-spore':
        // Grass types and 방진 are proof against spores.
        if (!u.types.includes('grass') && !has(u, 'overcoat') && rng() < 0.3) {
          statusUser((['poison', 'paralysis', 'sleep'] as const)[Math.floor(rng() * 3)], a);
        }
        break;
      case 'cute-charm':
        if (rng() < 0.3) statusUser('infatuation', a);
        break;
      case 'rough-skin':
      case 'iron-barbs':
        hurtUser(8, a);
        break;
      case 'gooey':
      case 'tangling-hair':
        say('target', a);
        shift(u, 'spe', -1, 'user', out.events, t);
        break;
      case 'mummy':
      case 'lingering-aroma':
        if (u.ability !== a && !FIXED_ABILITIES.has(u.ability ?? '')) {
          say('target', a);
          u.ability = a;
          out.events.push({ k: 'ability', on: 'user', ability: a });
        }
        break;
      case 'wandering-spirit':
        if (!FIXED_ABILITIES.has(u.ability ?? '')) {
          say('target', a);
          [u.ability, t.ability] = [t.ability, u.ability];
        }
        break;
      case 'perish-body':
        if (u.perish === 0 || t.perish === 0) {
          say('target', a);
          if (u.perish === 0) u.perish = 4;
          if (t.perish === 0) t.perish = 4;
          out.events.push({ k: 'perish' });
        }
        break;
    }
    // The attacker's own: 독수 poisons what it touches.
    if (has(u, 'poison-touch') && t.hp > 0 && rng() < 0.3 && inflict(t, tt, 'poison', c.field, rng, u)) {
      say('user', 'poison-touch');
      out.ailment = 'poison';
    }
  }
  // 독사슬: any hit may leave it badly poisoned.
  if (has(u, 'toxic-chain') && t.hp > 0 && rng() < 0.3 && inflict(t, tt, 'toxic', c.field, rng, u)) {
    say('user', 'toxic-chain');
    out.ailment = 'toxic';
  }
  if (t.hp > 0) {
    const half = t.hp * 2 <= t.maxHp && (t.hp + dmg) * 2 > t.maxHp;
    switch (a) {
      case 'stamina':
        say('target', a);
        shift(t, 'def', 1, 'target', out.events);
        break;
      case 'weak-armor':
        if (physical) {
          say('target', a);
          shift(t, 'def', -1, 'target', out.events);
          shift(t, 'spe', 2, 'target', out.events);
        }
        break;
      case 'water-compaction':
        if (type === 'water') {
          say('target', a);
          shift(t, 'def', 2, 'target', out.events);
        }
        break;
      case 'steam-engine':
        if (type === 'fire' || type === 'water') {
          say('target', a);
          shift(t, 'spe', 6, 'target', out.events);
        }
        break;
      case 'justified':
        if (type === 'dark') {
          say('target', a);
          shift(t, 'atk', 1, 'target', out.events);
        }
        break;
      case 'rattled':
        if (type === 'dark' || type === 'ghost' || type === 'bug') {
          say('target', a);
          shift(t, 'spe', 1, 'target', out.events);
        }
        break;
      case 'thermal-exchange':
        if (type === 'fire') {
          say('target', a);
          shift(t, 'atk', 1, 'target', out.events);
        }
        break;
      case 'anger-point':
        if (crit && t.stages.atk < MAX_STAGE) {
          say('target', a);
          t.stages.atk = MAX_STAGE;
          out.events.push({ k: 'stat', on: 'target', stat: 'atk', delta: MAX_STAGE, tried: 12 });
        }
        break;
      case 'berserk':
        if (half) {
          say('target', a);
          shift(t, 'spa', 1, 'target', out.events);
        }
        break;
      case 'anger-shell':
        if (half) {
          say('target', a);
          for (const k of ['atk', 'spa', 'spe'] as const) shift(t, k, 1, 'target', out.events);
          for (const k of ['def', 'spd'] as const) shift(t, k, -1, 'target', out.events);
        }
        break;
      case 'color-change':
        if (!(t.types.length === 1 && t.types[0] === type)) {
          say('target', a);
          t.types = [type];
          out.events.push({ k: 'type', on: 'target', types: [type] });
        }
        break;
      case 'cursed-body':
        if (!t.disabled && rng() < 0.3 && u.hp > 0 && !u.disabled) {
          say('target', a);
          u.disabled = { id: move.id, turns: 4 };
          out.events.push({ k: 'disable', moveId: move.id });
        }
        break;
      case 'cotton-down':
        say('target', a);
        shift(u, 'spe', -1, 'user', out.events, t);
        break;
      case 'electromorphosis':
        if (!t.charged) {
          say('target', a);
          t.charged = true;
        }
        break;
      case 'wind-power':
        if (WIND_MOVES.has(move.id) && !t.charged) {
          say('target', a);
          t.charged = true;
        }
        break;
      case 'sand-spit':
        if (weatherOf(c) !== 'sand' && !c.field.weather?.primal) {
          say('target', a);
          c.field.weather = { kind: 'sand', turns: WEATHER_TURNS };
          out.events.push({ k: 'weather', set: 'sand' });
        }
        break;
      case 'seed-sower':
        if (c.field.terrain?.kind !== 'grassy') {
          say('target', a);
          c.field.terrain = { kind: 'grassy', turns: TERRAIN_TURNS };
          out.events.push({ k: 'terrain', set: 'grassy' });
        }
        break;
      case 'toxic-debris':
        if (physical && (ut.hazards.toxicSpikes ?? 0) < 2) {
          say('target', a);
          ut.hazards.toxicSpikes = (ut.hazards.toxicSpikes ?? 0) + 1;
          out.events.push({ k: 'hazard', set: 'toxicSpikes', layers: ut.hazards.toxicSpikes });
        }
        break;
      case 'spicy-spray':
        statusUser('burn', a);
        break;
      case 'gulp-missile':
        break;
    }
  }
  // 그대로꿀꺽미사일: what it caught goes straight at the attacker.
  if (a === 'gulp-missile' && (t.mon.form === 'cramorant-gulping' || t.mon.form === 'cramorant-gorging')) {
    const gorging = t.mon.form === 'cramorant-gorging';
    setForm(t, 'cramorant');
    hurtUser(4, a);
    if (u.hp > 0) {
      if (gorging) statusUser('paralysis', a);
      else shift(u, 'def', -1, 'user', out.events, t);
    }
  }
  // 유폭, 내용물분출: a knockout costs the one that did it.
  if (t.hp <= 0 && u.hp > 0 && !has(u, 'magic-guard')) {
    if (a === 'aftermath' && contact && !has(u, 'damp')) hurtUser(4, a);
    if (a === 'innards-out') {
      const hp = Math.min(u.hp, dmg);
      say('target', a);
      u.hp -= hp;
      out.events.push({ k: 'hurt', on: 'user', hp });
    }
  }
  void tt;
}

/** The attacker's abilities that fire on a knockout, and 소울하트 on either side. */
function onKnockout(u: Side, t: Side, out: Action, c: Ctx): void {
  const a = abilityOn(u, c);
  const up = (stat: StatKey) => {
    out.events.push({ k: 'ability', on: 'user', ability: a! });
    shift(u, stat, 1, 'user', out.events);
  };
  switch (a) {
    case 'moxie':
    case 'chilling-neigh':
    case 'as-one-glastrier':
      up('atk');
      break;
    case 'grim-neigh':
    case 'as-one-spectrier':
      up('spa');
      break;
    case 'beast-boost':
    case 'eelevate':
      up(highestStat(u));
      break;
    case 'battle-bond':
      // 스칼렛·바이올렛: once a fight, attack, special attack and speed.
      if (!u.mon.spent.has('battle-bond')) {
        u.mon.spent.add('battle-bond');
        out.events.push({ k: 'ability', on: 'user', ability: a });
        for (const k of ['atk', 'spa', 'spe'] as const) shift(u, k, 1, 'user', out.events);
      }
      break;
  }
  for (const [s, on] of [
    [u, 'user'],
    [t, 'target'],
  ] as const) {
    if (s.hp > 0 && has(s, 'soul-heart')) {
      out.events.push({ k: 'ability', on, ability: 'soul-heart' });
      shift(s, 'spa', 1, on, out.events);
    }
  }
}

/** 토해내기 and 꿀꺽 spend the stockpile, and the defences it raised come back down. */
function releaseStockpile(s: Side, events: BattleEvent[]): void {
  const n = s.stockpile;
  s.stockpile = 0;
  shift(s, 'def', -n, 'user', events);
  shift(s, 'spd', -n, 'user', events);
  events.push({ k: 'stockpile-gone' });
}

/**
 * The moves that change or copy an ability: 위액, 고민씨, 심플빔, 동료만들기,
 * 역할, 배껴그리기, and the two that raise stats only for 플러스·마이너스.
 * Returns whether the move did anything. See server/abilities.ts.
 */
function runAbilityMove(id: number, u: Side, t: Side, out: Action, c: Ctx): boolean {
  void c;
  if (!abilityMoveUseful(id, u, t)) return false;
  switch (id) {
    case 380: // 위액
      t.abilityOff = true;
      out.events.push({ k: 'ability', on: 'target', ability: t.ability! });
      out.events.push({ k: 'ability-lost', on: 'target' });
      return true;
    case 388: // 고민씨
      t.ability = 'insomnia';
      if (t.status === 'sleep') t.status = null;
      out.events.push({ k: 'ability-set', on: 'target', ability: 'insomnia' });
      return true;
    case 493: // 심플빔
      t.ability = 'simple';
      out.events.push({ k: 'ability-set', on: 'target', ability: 'simple' });
      return true;
    case 494: // 동료만들기
      t.ability = u.ability;
      out.events.push({ k: 'ability-set', on: 'target', ability: u.ability! });
      return true;
    case 272: // 역할
    case 867: // 배껴그리기
      u.ability = t.ability;
      out.events.push({ k: 'ability-set', on: 'user', ability: t.ability! });
      return true;
    case 285: {
      // 스킬스왑
      [u.ability, t.ability] = [t.ability, u.ability];
      out.events.push({ k: 'ability-swap' });
      return true;
    }
    case 602: // 자기장조작: defence and special defence, for 플러스·마이너스.
      out.events.push({ k: 'ability', on: 'user', ability: u.ability! });
      shift(u, 'def', 1, 'user', out.events);
      shift(u, 'spd', 1, 'user', out.events);
      return true;
    case 674: // 어시스트기어: attack and special attack, for 플러스·마이너스.
      out.events.push({ k: 'ability', on: 'user', ability: u.ability! });
      shift(u, 'atk', 1, 'user', out.events);
      shift(u, 'spa', 1, 'user', out.events);
      return true;
  }
  return false;
}

/**
 * Put a condition on a side, if it can take one.
 *
 * Returns whether it landed. Every refusal the games make is here: a second
 * non-volatile condition, a type that cannot carry it, a field or a
 * 신비의부적 that keeps it off, a nightmare on someone awake, the same
 * volatile twice.
 */
function inflict(target: Side, targetTeam: Team, c: Condition, field: Field, rng: () => number, source?: Side): boolean {
  if (target.hp <= 0) return false;
  // 부식: poison lands even on Poison and Steel types.
  const corroding = !!source && (c === 'poison' || c === 'toxic') && has(source, 'corrosion');
  if (!corroding && IMMUNE[c]?.some((t) => target.types.includes(t))) return false;
  if (statusShield(target, c, source)) return false;
  if (fieldBlocks(weatherOf() ?? null, field.terrain?.kind ?? null, c, onGround(target, field), NON_VOLATILE.has(c))) {
    return false;
  }
  // 틈새포착 goes past 신비의부적.
  if (targetTeam.screens.safeguard && (NON_VOLATILE.has(c) || c === 'confusion' || c === 'yawn') && !(source && has(source, 'infiltrator'))) return false;
  const landed = inflictRaw(target, c, field, rng);
  // 싱크로: a burn, paralysis or poison goes straight back.
  if (landed && source && source !== target && ['burn', 'paralysis', 'poison', 'toxic'].includes(c) && has(target, 'synchronize') && CTX) {
    inflict(source, teamOf(source, CTX), c === 'toxic' ? 'toxic' : c, field, rng);
  }
  return landed;
}

/**
 * Whether the target's ability keeps a condition off it: 유연 and paralysis,
 * 불면 and sleep, 면역 and poison, 마이페이스 and confusion, 리프가드 in the
 * sun… `source` is who is inflicting it, for 틀깨기.
 */
function statusShield(s: Side, c: Condition, source?: Side): boolean {
  const on = (slug: string) => has(s, slug, source);
  const major = NON_VOLATILE.has(c) || c === 'yawn';
  if (major && (on('comatose') || on('purifying-salt'))) return true;
  if (major && on('leaf-guard') && weatherOf() === 'sun') return true;
  if (major && on('shields-down') && s.mon.form !== 'minior-red') return true;
  if (major && on('flower-veil') && s.types.includes('grass')) return true;
  switch (c) {
    case 'paralysis':
      return on('limber');
    case 'sleep':
    case 'yawn':
      return on('insomnia') || on('vital-spirit') || on('sweet-veil');
    case 'poison':
    case 'toxic':
      return on('immunity') || on('pastel-veil');
    case 'burn':
      return on('water-veil') || on('water-bubble') || on('thermal-exchange');
    case 'freeze':
      return on('magma-armor');
    case 'confusion':
      return on('own-tempo');
    case 'infatuation':
      return on('oblivious') || on('aroma-veil');
    case 'torment':
    case 'disable':
      return on('aroma-veil');
  }
  return false;
}

/** Put a condition on a side that nothing is keeping it off. */
function inflictRaw(target: Side, c: Condition, field: Field, rng: () => number): boolean {
  if (c === 'sleep' && field.uproar) return false;
  if (c === 'silence') {
    if (target.silenced > 0) return false;
    target.silenced = 2;
    return true;
  }
  // 씨뿌리기: never on a Grass type, never twice.
  if (c === 'leech-seed') {
    if (target.seeded || target.types.includes('grass') || target.substitute > 0) return false;
    target.seeded = true;
    return true;
  }
  // 하품: asleep at the end of next turn, if nothing it carries or stands on says otherwise.
  if (c === 'yawn') {
    if (target.drowsy > 0 || target.status || field.uproar) return false;
    if (fieldBlocks(field.weather?.kind ?? null, field.terrain?.kind ?? null, 'sleep', onGround(target, field), true)) return false;
    target.drowsy = 2;
    return true;
  }
  if (NON_VOLATILE.has(c)) {
    if (target.status) return false;
    target.status = c;
    if (c === 'sleep') target.sleepLeft = 1 + Math.floor(rng() * 3);
    if (c === 'toxic') target.toxicN = 0;
    return true;
  }
  if (c === 'confusion') {
    if (target.confused > 0) return false;
    target.confused = 2 + Math.floor(rng() * 4);
    return true;
  }
  if (c === 'trap') {
    if (target.trapped > 0) return false;
    target.trapped = 4 + Math.floor(rng() * 2);
    return true;
  }
  if (c === 'nightmare' && target.status !== 'sleep') return false;
  if (target.volatile.has(c)) return false;
  target.volatile.add(c);
  return true;
}

/**
 * Whether a status move bounces off this target's type.
 *
 * The games have two such rules: 전기자석파 is an Electric move and does
 * nothing to a Ground type, and powders do nothing to a Grass type. Every other
 * status move goes past the type chart — 이상한빛 confuses a Normal type and
 * 헤롱헤롱 works on a Ghost. A condition a type cannot carry at all (a Fire type
 * burned) is IMMUNE's business, not this.
 */
function statusImmune(move: MoveInfo, types: readonly MoveType[]): boolean {
  if (move.id === 86 && types.length && effectiveness(move.type, types) === 0) return true;
  return POWDER_MOVES.has(move.id) && types.includes('grass');
}

/** Whether every one of these stage changes would bounce off a ±6 cap. */
function statsCapped(move: MoveInfo, user: Side, target: Side): boolean {
  const who = statsOnUser(move) ? user : target;
  return move.statChanges.every((c) => {
    const at = who.stages[STAT_KEY[c.stat]];
    return c.change > 0 ? at >= MAX_STAGE : at <= -MAX_STAGE;
  });
}

/** PP left on a move. Struggle and the plain swing never run out. */
function ppLeft(s: Side, id: number | null): number {
  if (id === null || id === STRUGGLE) return Infinity;
  const m = moveOf(id);
  if (!m) return Infinity;
  return Math.max(0, m.pp - (s.mon.ppUsed.get(id) ?? 0));
}

/** The moves this side can reach for, 흉내내기 swapped for what it learned. */
function kitIds(s: Side): (number | null)[] {
  // 변신 and 스케치 replace the kit outright while it stays out.
  if (s.moveset) return s.moveset;
  return s.mon.kit.ids.map((id) => (id === MIMIC && s.mimic !== null ? s.mimic : id));
}

/** Whether a move is barred outright this turn: taunt, heal block, imprison. */
function barred(s: Side, other: Side, move: MoveInfo | null): SkipReason | null {
  if (!move) return null;
  if (s.taunt > 0 && move.damageClass === 'status') return 'taunt';
  if (s.healBlock > 0 && (statusKind(move).kind === 'heal' || move.id === REST || (move.drain > 0 && move.damageClass === 'status'))) {
    return 'heal-block';
  }
  if (other.imprisoning && kitIds(other).includes(move.id)) return 'imprison';
  if (s.volatile.has('torment') && move.id === s.lastMove) return 'torment';
  if (s.silenced > 0 && SOUND_MOVES.has(move.id)) return 'throat-chop';
  if (s.disabled && s.disabled.id === move.id) return 'disabled';
  return null;
}

/** Everything a half of a turn can reach: both teams, the field, the dice. */
type Ctx = {
  rng: () => number;
  field: Field;
  me: Team;
  foe: Team;
  /** A wild encounter: 울부짖기 and 순간이동 end it instead of switching. */
  wild: boolean;
  /** Which turn of the fight this is, from 1. */
  turn: number;
  /**
   * A switch or an end a move asked for, handled once the half is over.
   * `shedTail` is 꼬리자르기's substitute, handed to whoever comes in.
   */
  request: { team: Team; kind: 'forced' | 'retreat'; baton?: boolean; shedTail?: number } | { kind: 'fled' } | null;
};

const otherOf = (c: Ctx, t: Team) => (t === c.me ? c.foe : c.me);

/**
 * Whether a move would just fail right now, so a player would not pick it.
 *
 * Mostly status moves, but not only: 코골기 with nobody asleep, 꿈먹기 at
 * somebody awake, and the moves that cannot work here at all.
 */
function wasted(move: MoveInfo, ut: Team, tt: Team, c: Ctx): boolean {
  const user = ut.active;
  const target = tt.active;
  const field = c.field;
  const mine = ut === c.me;
  if (ALWAYS_FAILS.has(move.id)) return true;
  if (moveFails(move, user, target, ut, user.lastMove, c) && !SUCKER_MOVES.has(move.id) && move.id !== SHELL_TRAP) return true;
  // Helping the other side along is nobody's plan: 치유파동, 플라워힐, 데코레이션.
  if (HEAL_TARGET.has(move.id) || move.id === 777 || move.id === 495 || move.id === 150) return true;
  if (move.id === SWALLOW) return user.stockpile === 0 || user.hp >= user.maxHp;
  if (move.id === STOCKPILE) return user.stockpile >= 3;
  if (move.id === 187) return user.hp <= Math.floor(user.maxHp / 2) || user.stages.atk >= MAX_STAGE;
  if (move.id === 361 || move.id === 461 || move.id === 880) return benchOf(ut).length === 0;
  if (move.id === 863) return !ut.mons.some((m, i) => i !== ut.slot && m.hp <= 0);
  if (move.id === 73) return target.seeded || target.types.includes('grass');
  if (move.id === 195) return user.perish > 0 && target.perish > 0;
  if (move.id === 50) return !!target.disabled || target.lastMove === undefined || target.lastMove === null;
  if (move.id === 275) return user.ingrained;
  if (move.id === 392) return user.aquaRing;
  if (move.id === 393) return user.magnetRise > 0 || user.ingrained;
  if (move.id === 273) return !!ut.wish || user.hp >= user.maxHp;
  if (move.id === 212 || move.id === 335 || move.id === 753) return target.noEscape;
  if ([380, 388, 493, 494, 272, 867, 602, 674, 285].includes(move.id)) return !abilityMoveUseful(move.id, user, target);
  if (move.id === SNORE) return user.status !== 'sleep';
  if (move.id === DREAM_EATER) return target.status !== 'sleep';
  if (FUTURE_MOVES.has(move.id)) return tt.future !== null;
  if (DRAG_OUT_MOVES.has(move.id) && c.wild && mine) return true;
  if (move.damageClass !== 'status') return false;
  if (subBlocks(move) && target.substitute > 0) return true;
  const sk = statusKind(move);
  switch (sk.kind) {
    case 'fails':
      return true;
    case 'ailment': {
      const cnd = sk.condition;
      // 전기자석파 at a Ground type does nothing, and a player knows it — as
      // it knows 면역 keeps poison off and 축전 drinks electricity in.
      if (statusImmune(move, target.types)) return true;
      if (statusShield(target, cnd, user) || wouldBounce(move, user, target)) return true;
      if (cnd === 'sleep' && field.uproar) return true;
      if (tt.screens.safeguard && (NON_VOLATILE.has(cnd) || cnd === 'confusion')) return true;
      if (fieldBlocks(field.weather?.kind ?? null, field.terrain?.kind ?? null, cnd, onGround(target, field), NON_VOLATILE.has(cnd))) {
        return true;
      }
      if (NON_VOLATILE.has(cnd)) return !!target.status || !!IMMUNE[cnd]?.some((t) => target.types.includes(t));
      if (cnd === 'confusion') return target.confused > 0 && !move.statChanges.length;
      if (cnd === 'trap') return target.trapped > 0;
      if (cnd === 'nightmare') return target.status !== 'sleep' || target.volatile.has(cnd);
      return target.volatile.has(cnd);
    }
    case 'weather':
      return field.weather?.kind === sk.weather;
    case 'terrain':
      return field.terrain?.kind === sk.terrain;
    case 'screen':
      if (sk.screen === 'auroraVeil' && field.weather?.kind !== 'hail' && field.weather?.kind !== 'snow') return true;
      return !!ut.screens[sk.screen];
    case 'hazard':
      // Laying hazards in front of somebody with nobody to send in is a wasted turn.
      return (tt.hazards[sk.hazard] ?? 0) >= sk.max || benchOf(tt).length === 0;
    case 'room':
      return !!field.rooms[sk.room] || sk.room === 'magicRoom';
    case 'trick-room':
      return field.trickRoom > 0;
    case 'protect':
    case 'endure':
      return user.protectRun > 0;
    case 'rest':
      return user.hp >= user.maxHp || user.status === 'sleep' || field.uproar;
    case 'sleep-talk':
      return user.status !== 'sleep';
    case 'heal':
      return user.hp >= user.maxHp;
    case 'stats':
      if (move.id === VENOM_DRENCH) return target.status !== 'poison' && target.status !== 'toxic';
      return statsCapped(move, user, target);
    case 'guard':
      return user.stages.def >= MAX_STAGE && user.stages.spd >= MAX_STAGE;
    case 'unique':
      switch (sk.id) {
        case SUBSTITUTE:
          return user.substitute > 0 || user.hp <= Math.floor(user.maxHp / 4);
        case TAUNT:
          return target.taunt > 0;
        case ENCORE:
          return target.encore !== null || target.lastMove === undefined || target.lastMove === null;
        case SPITE:
          return target.lastMove === undefined || target.lastMove === null || ppLeft(target, target.lastMove) === 0;
        case HAZE:
          return [user, target].every((s) => Object.values(s.stages).every((v) => v === 0));
        case FOCUS_ENERGY:
          return user.critStage >= 2;
        case CURSE:
          return user.types.includes('ghost')
            ? target.cursed || user.hp <= Math.floor(user.maxHp / 2)
            : user.stages.atk >= MAX_STAGE && user.stages.def >= MAX_STAGE;
        case SAFEGUARD:
          return !!ut.screens.safeguard;
        case PAIN_SPLIT:
          return user.hp >= target.hp;
        case PSYCH_UP:
          return sum(target.stages) <= sum(user.stages);
        case POWER_SWAP:
          return target.stages.atk + target.stages.spa <= user.stages.atk + user.stages.spa;
        case GUARD_SWAP:
          return target.stages.def + target.stages.spd <= user.stages.def + user.stages.spd;
        case SPEED_SWAP:
          return target.stats.spe <= user.stats.spe;
        case MIMIC:
          return (
            target.lastMove === undefined ||
            target.lastMove === null ||
            [MIMIC, METRONOME, STRUGGLE, SLEEP_TALK, NATURE_POWER].includes(target.lastMove) ||
            kitIds(user).includes(target.lastMove)
          );
        case TELEPORT:
          // Fleeing a wild fight throws its reward away; nobody does that on purpose.
          return benchOf(ut).length === 0;
        case BATON_PASS:
          return benchOf(ut).length === 0;
        case DEFOG:
          return (
            !tt.screens.reflect &&
            !tt.screens.lightScreen &&
            !tt.screens.auroraVeil &&
            !tt.screens.safeguard &&
            !Object.keys(tt.hazards).length &&
            !Object.keys(ut.hazards).length &&
            !field.terrain
          );
        case TELEKINESIS:
          return target.telekinesis > 0 || !!field.rooms.gravity;
        case IMPRISON:
          return user.imprisoning;
        case 46:
        case 18:
          return benchOf(tt).length === 0 && !(c.wild && !mine);
        default:
          return false;
      }
  }
}

const sum = (s: Stages) => Object.values(s).reduce((a, v) => a + v, 0);

/**
 * The games' damage formula, at level 50.
 *
 *   floor(floor(floor(2 × 50 / 5 + 2) × power × A / D) / 50) + 2
 *
 * then weather and terrain, crit, the 0.85–1.00 roll, STAB, the type chart and
 * a burn, each floored in turn. A critical hit ignores the attacker's drops and
 * the defender's raises. 원더룸 swaps the two defences for the room's length.
 */
function damageOf(
  user: Side,
  target: Side,
  power: number,
  physical: boolean,
  opts: {
    crit: boolean;
    roll: number;
    stab: boolean;
    effect: number;
    fieldMult?: number;
    defMult?: number;
    ignoreBurn?: boolean;
    wonder?: boolean;
    /** 속임수 swings with the target's attack; 바디프레스 with the user's defence. */
    atkFrom?: 'target-atk' | 'user-def';
    /** 사이코쇼크: a special move that lands on physical defence. */
    defStat?: 'def';
    /** DD래리어트: the target's defence stages do not count. */
    ignoreDefStages?: boolean;
    /** Everything the abilities on both sides put on the finished number — 필터, 멀티스케일, 색안경… */
    finalMult?: number;
  },
): number {
  const aStat = opts.atkFrom === 'user-def' ? 'def' : physical ? 'atk' : 'spa';
  const aSide = opts.atkFrom === 'target-atk' ? target : user;
  const dStat = opts.defStat ?? (physical ? 'def' : 'spd');
  // 원더룸 reads each defence as the other one, stages and all.
  const dRead = opts.wonder ? (dStat === 'def' ? 'spd' : 'def') : dStat;
  // 천진: whoever has it does not see the other side's stages.
  const blindA = user !== target && has(target, 'unaware', user);
  const blindD = user !== target && has(user, 'unaware');
  const aStage = blindA ? 0 : opts.crit ? Math.max(0, aSide.stages[aStat]) : aSide.stages[aStat];
  const dStage = opts.ignoreDefStages || blindD ? 0 : opts.crit ? Math.min(0, target.stages[dRead]) : target.stages[dRead];
  const a = Math.max(1, Math.floor(aSide.stats[aStat] * stageMult(aStage) * abilityStatMult(aSide, aStat, target)));
  const d = Math.max(
    1,
    Math.floor(target.stats[dRead] * stageMult(dStage) * (opts.defMult ?? 1) * (user !== target ? abilityStatMult(target, dRead, user) : 1)),
  );
  const lv = Math.floor((2 * BATTLE_LEVEL) / 5) + 2;
  let dmg = Math.floor(Math.floor((lv * power * a) / d) / 50) + 2;
  dmg = Math.floor(dmg * (opts.fieldMult ?? 1));
  // 스나이퍼: a critical hit lands for half again on top.
  if (opts.crit) dmg = Math.floor(dmg * CRIT_MULT * (has(user, 'sniper') ? 1.5 : 1));
  dmg = Math.floor((dmg * (85 + Math.floor(opts.roll * 16))) / 100);
  // 적응력: two times the same-type bonus, not one and a half.
  if (opts.stab) dmg = Math.floor(dmg * (has(user, 'adaptability') ? 2 : STAB_MULT));
  dmg = Math.floor(dmg * opts.effect);
  // 근성 turns a burn into an asset; it no longer halves.
  if (physical && user.status === 'burn' && !opts.ignoreBurn && !has(user, 'guts')) dmg = Math.floor(dmg / 2);
  dmg = Math.floor(dmg * (opts.finalMult ?? 1));
  return opts.effect === 0 ? 0 : Math.max(1, dmg);
}

type Action = {
  acted: boolean;
  moveId: number | null;
  damage: number;
  crit: boolean;
  missed: boolean;
  effect: number;
  ailment: Condition | null;
  selfEffect: SelfEffect | null;
  skip: SkipReason | null;
  selfHit: number;
  cured: Cured | null;
  events: BattleEvent[];
};

const noAction = (): Action => ({
  acted: false,
  moveId: null,
  damage: 0,
  crit: false,
  missed: false,
  effect: 1,
  ailment: null,
  selfEffect: null,
  skip: null,
  selfHit: 0,
  cured: null,
  events: [],
});

/**
 * Whatever keeps a side from moving, checked in the games' order.
 *
 * Mutates the side — a sleep counts down, a freeze may thaw, confusion may hit
 * itself — and says what happened. `sleepUsable` is 잠꼬대 or 코골기, the two
 * moves a sleeping Pokemon can still use; the sleep still counts down.
 */
function beforeMove(
  user: Side,
  rng: () => number,
  sleepUsable: boolean,
  defrosts = false,
): { skip: SkipReason | null; selfHit: number; cured: Cured | null } {
  let cured: Cured | null = null;
  if (user.held) return { skip: 'held', selfHit: 0, cured };
  if (user.status === 'freeze') {
    // 플레어드라이브, 열탕 and the like thaw their user on the way out.
    if (defrosts || rng() < 0.2) {
      user.status = null;
      cured = 'freeze';
    } else return { skip: 'freeze', selfHit: 0, cured };
  }
  if (user.status === 'sleep') {
    if (user.sleepLeft <= 0) {
      user.status = null;
      user.volatile.delete('nightmare');
      cured = 'sleep';
    } else {
      // 일찍기상 sleeps half as long.
      user.sleepLeft -= has(user, 'early-bird') ? 2 : 1;
      if (!sleepUsable) return { skip: 'sleep', selfHit: 0, cured };
    }
  }
  if (user.flinched) return { skip: 'flinch', selfHit: 0, cured };
  if (user.confused > 0) {
    user.confused--;
    if (user.confused === 0) {
      cured ??= 'confusion';
    } else if (rng() < 1 / 3) {
      const hit = Math.min(
        user.hp,
        damageOf(user, user, CONFUSION_POWER, true, { crit: false, roll: rng(), stab: false, effect: 1 }),
      );
      user.hp -= hit;
      return { skip: 'confusion', selfHit: hit, cured };
    }
  }
  if (user.volatile.has('infatuation') && rng() < 0.5) return { skip: 'infatuation', selfHit: 0, cured };
  if (user.status === 'paralysis' && rng() < 0.25) return { skip: 'paralysis', selfHit: 0, cured };
  return { skip: null, selfHit: 0, cured };
}

/** How many times a multi-hit move lands: 2–5 goes 35/35/15/15, as in Gen 5+. */
function hitCount(hits: [number, number], rng: () => number): number {
  const [lo, hi] = hits;
  if (lo === hi) return lo;
  if (lo === 2 && hi === 5) {
    const r = rng();
    return r < 0.35 ? 2 : r < 0.7 ? 3 : r < 0.85 ? 4 : 5;
  }
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** The view of a side `powerOf` reads. */
function powerSide(s: Side, t: Team): PowerSide {
  const boosts = Object.values(s.stages).reduce((a, v) => a + Math.max(0, v), 0);
  return {
    hp: s.hp,
    maxHp: s.maxHp,
    speed: speedOf(s, t),
    // 헤비메탈 doubles its weight, 라이트메탈 halves it.
    weightKg: s.weightKg * (has(s, 'heavy-metal') ? 2 : has(s, 'light-metal') ? 0.5 : 1),
    // 절대안깸 is asleep for everything that reads it — 병상첨병 included.
    status: s.status ?? (has(s, 'comatose') ? 'sleep' : null),
    boosts,
    friendship: s.friendship,
  };
}

/** The move 자연의힘 becomes here. */
function naturePowerMove(field: Field): number {
  const ids = NATURE_POWER_MOVES[field.terrain?.kind ?? 'none'];
  return ids.find((id) => moveOf(id)) ?? 161;
}

/** One side's half of an exchange. */
function perform(ut: Team, tt: Team, pickedIn: number | null, c: Ctx, first: boolean): Action {
  const u = ut.active;
  const t = tt.active;
  if (u.hp <= 0) return noAction();
  const rng = c.rng;
  const out: Action = { ...noAction(), acted: true, moveId: pickedIn };
  const finish = (failed = false) => {
    u.moved = true;
    u.lastFailed = failed;
    // A lock that misses or fails is over, with no confusion to show for it.
    if (failed && u.lock && u.lock.kind !== 'bide') endLock(u, c.field);
    return out;
  };
  const fail = () => {
    out.selfEffect = 'failed';
    return finish(true);
  };

  if (u.recharge) {
    u.recharge = false;
    out.skip = 'recharge';
    return finish();
  }
  // 게으름: every other turn is spent lounging.
  if (has(u, 'truant')) {
    if (u.loafing) {
      u.loafing = false;
      out.skip = 'truant';
      return finish();
    }
    u.loafing = true;
  }
  // 앙코르 overrides whatever was chosen.
  let pickedId = pickedIn;
  if (u.encore && u.encore.id !== pickedId && ppLeft(u, u.encore.id) > 0) {
    pickedId = u.encore.id;
    out.moveId = pickedId;
  }
  const picked = pickedId === STRUGGLE ? null : moveOf(pickedId);
  const pre = beforeMove(
    u,
    rng,
    !!picked && (picked.id === SLEEP_TALK || picked.id === SNORE),
    !!picked && DEFROST_MOVES.has(picked.id),
  );
  out.cured = pre.cured;
  if (pre.skip) {
    out.skip = pre.skip;
    out.selfHit = pre.selfHit;
    // 불굴의마음: flinching only makes it quicker.
    if (pre.skip === 'flinch' && has(u, 'steadfast')) {
      out.events.push({ k: 'ability', on: 'user', ability: 'steadfast' });
      shift(u, 'spe', 1, 'user', out.events);
    }
    u.streak = 0;
    u.charging = null;
    u.vanished = null;
    if (u.lock) endLock(u, c.field);
    return finish();
  }
  const bar = barred(u, t, picked);
  if (bar) {
    out.skip = bar;
    return finish(true);
  }

  // PP goes the moment the move is really attempted — once for a charge, once
  // for a whole lock.
  const continuing = u.lock !== null && u.lock.id === pickedId;
  if (pickedId !== null && pickedId !== STRUGGLE && u.charging !== pickedId && !continuing) {
    u.mon.ppUsed.set(pickedId, (u.mon.ppUsed.get(pickedId) ?? 0) + 1);
  }

  // The callers: 잠꼬대, 손가락흔들기, 자연의힘 each reach for another move.
  let move = picked;
  if (picked?.id === SLEEP_TALK) {
    const callable = kitIds(u).filter(
      (id): id is number =>
        id !== null && id !== SLEEP_TALK && id !== REST && !(id in CHARGE_MOVES) && !(id in LOCK_MOVES) && ppLeft(u, id) > 0,
    );
    if (!asleep(u) || !callable.length) return fail();
    move = moveOf(callable[Math.floor(rng() * callable.length)]);
    out.events.push({ k: 'call', by: 'sleep-talk', moveId: move!.id });
  } else if (picked?.id === METRONOME) {
    move = moveOf(METRONOME_POOL[Math.floor(rng() * METRONOME_POOL.length)]);
    out.events.push({ k: 'call', by: 'metronome', moveId: move!.id });
  } else if (picked?.id === NATURE_POWER) {
    move = moveOf(naturePowerMove(c.field));
    out.events.push({ k: 'call', by: 'nature-power', moveId: move!.id });
  } else if (picked?.id === 383) {
    // 흉내쟁이: the last move anybody used.
    const last = c.field.lastMove === null ? null : moveOf(c.field.lastMove);
    if (!last || NOT_COPIED.has(last.id)) return fail();
    move = last;
    out.events.push({ k: 'call', by: 'copycat', moveId: last.id });
  }
  const moveId = move?.id ?? (pickedId === STRUGGLE ? STRUGGLE : null);
  const prevMove = u.lastMove;
  if (moveId !== null) {
    u.tried.add(moveId);
    c.field.lastMove = moveId === STRUGGLE ? c.field.lastMove : moveId;
  }
  // 길동무 and 원념 hold only until the user moves again.
  if (moveId !== 194) u.destinyBond = false;
  if (moveId !== 288) u.grudge = false;
  // 대검돌격's exposure ends the moment the user acts again.
  u.glaive = false;
  const fusionBoost = !!move && FUSION_MOVES[move.id] !== undefined && c.field.lastThisTurn === FUSION_MOVES[move.id];
  c.field.lastThisTurn = moveId;

  if (!(moveId !== null && (PROTECT_MOVES.has(moveId) || moveId === ENDURE))) u.protectRun = 0;
  // The streak moves count consecutive use; anything else starts it over.
  u.streak = pickedId !== null && pickedId === u.lastMove ? u.streak + 1 : 1;
  u.lastMove = pickedId;
  // 분노 lasts only as long as the user keeps choosing it.
  u.raging = moveId === RAGE;

  // 참기: two turns of taking it, then twice what it took, straight back.
  let bideDamage: number | null = null;
  if (move && LOCK_MOVES[move.id] === 'bide') {
    if (!u.lock) {
      u.lock = { id: move.id, kind: 'bide', turns: 2, stored: 0 };
      out.events.push({ k: 'bide' });
      return finish();
    }
    if (u.lock.turns > 1) {
      u.lock.turns--;
      out.events.push({ k: 'bide' });
      return finish();
    }
    const stored = u.lock.stored;
    u.lock = null;
    out.events.push({ k: 'bide-release' });
    if (stored <= 0) return fail();
    bideDamage = stored * 2;
  }

  // A two-turn move charges first — unless it is a solar move in the sun, or 일렉트로빔 in the rain.
  const charge = move ? CHARGE_MOVES[move.id] : undefined;
  const skipCharge =
    !!move &&
    ((SOLAR_MOVES.has(move.id) && c.field.weather?.kind === 'sun') || (move.id === ELECTRO_SHOT && c.field.weather?.kind === 'rain'));
  if (move && charge && !(skipCharge && u.charging !== move.id)) {
    if (u.charging !== move.id) {
      // 프리폴 cannot lift something behind a substitute, or anything 200kg and up.
      if (move.id === SKY_DROP && (t.substitute > 0 || t.weightKg >= 200 || t.hp <= 0)) return fail();
      u.charging = move.id;
      u.vanished = charge.vanish ?? null;
      out.events.push({ k: 'charge', moveId: move.id });
      if (move.id === SKY_DROP) {
        t.held = true;
        t.vanished = 'air';
        t.charging = null;
        out.events.push({ k: 'sky-drop' });
      }
      if (charge.boost) shift(u, charge.boost.stat, charge.boost.change, 'user', out.events);
      return finish();
    }
  }
  u.charging = null;
  u.vanished = null;
  // 프리폴 lands: the target comes back down with the hit.
  const skyDrop = move?.id === SKY_DROP && t.held;
  if (skyDrop) {
    t.held = false;
    t.vanished = null;
  }

  // 일렉트로빔 in the rain still takes its special attack, without the wait.
  if (move?.id === ELECTRO_SHOT && skipCharge) shift(u, 'spa', 1, 'user', out.events);
  if (move?.id === FOCUS_PUNCH && u.wasHit) return fail();
  // 기선제압 only works against a priority move that has not happened yet.
  if (move?.id === UPPER_HAND) {
    const theirs = t.picked === null ? null : moveOf(t.picked);
    if (t.moved || !theirs || theirs.priority <= 0 || theirs.damageClass === 'status') return fail();
  }
  if (move && moveFails(move, u, t, ut, prevMove, c)) return fail();
  // 무아지경: the first move it picks is the only one it will pick.
  if (move && has(u, 'gorilla-tactics') && u.choiceLock === null) u.choiceLock = pickedId;
  // 습기 on either side: nothing explodes.
  if (move && (SELF_KO_MOVES.has(move.id) || move.id === 720)) {
    const wet = [u, t].find((x) => x.hp > 0 && has(x, 'damp', u));
    if (wet) {
      out.events.push({ k: 'ability', on: wet === u ? 'user' : 'target', ability: 'damp' });
      return fail();
    }
  }
  // 변환자재, 리베로: the user becomes the type of the move it is about to use.
  if (move && !u.shifted && (has(u, 'protean') || has(u, 'libero'))) {
    const ty = typeFor(move, u, c);
    if (u.types.length !== 1 || u.types[0] !== ty) {
      u.types = [ty];
      u.shifted = true;
      out.events.push({ k: 'ability', on: 'user', ability: abilityOn(u)! });
      out.events.push({ k: 'type', on: 'user', types: [ty] });
    }
  }
  // 배틀스위치: into the blade to attack, back behind the shield for 킹실드.
  if (move && has(u, 'stance-change')) {
    const to = move.id === 588 ? 'aegislash-shield' : move.damageClass !== 'status' ? 'aegislash-blade' : null;
    if (to && setForm(u, to)) {
      out.events.push({ k: 'ability', on: 'user', ability: 'stance-change' });
      out.events.push({ k: 'form', on: 'user', form: to });
    }
  }
  // 메테오드라이브, 섀도레이, 포톤가이저 walk past the target's ability as 틀깨기 does.
  ignoringFor =
    move && (IGNORES_ABILITIES.has(move.id) || (move.damageClass === 'status' && has(u, 'mycelium-might'))) ? u : null;

  const aimed = hitsOpponent(move);
  if (aimed && move && priorityOf(move, u, c.field) > 0 && c.field.terrain?.kind === 'psychic' && onGround(t, c.field)) return fail();
  // 여왕의위엄, 비비드바디, 테일아머: nothing quick gets at it.
  if (aimed && move && priorityOf(move, u, c.field) > 0) {
    const wall = ['queenly-majesty', 'dazzling', 'armor-tail'].find((a) => has(t, a, u));
    if (wall) {
      out.events.push({ k: 'ability', on: 'target', ability: wall });
      return fail();
    }
  }
  // 짓궂은마음 hurries a status move, and a Dark type sees it coming.
  if (aimed && move && move.damageClass === 'status' && has(u, 'prankster') && t.types.includes('dark')) return fail();
  // 프레셔: a move aimed at it costs one PP more.
  if (aimed && move && !continuing && has(t, 'pressure', u) && pickedId !== null && pickedId !== STRUGGLE) {
    u.mon.ppUsed.set(pickedId, (u.mon.ppUsed.get(pickedId) ?? 0) + 1);
  }
  // 페인트 and the like tear a Protect down; 섀도다이브 and a few more go through it.
  if (aimed && move && PROTECT_BREAKERS.has(move.id) && (t.protecting || tt.guard)) {
    t.protecting = false;
    tt.guard = null;
    out.events.push({ k: 'feint' });
  }
  // 보이지않는주먹 and 관통드릴: contact goes straight through a Protect.
  const pierces = !!move && hasFlag(move, 'contact') && (has(u, 'unseen-fist') || has(u, 'piercing-drill'));
  if (aimed && t.protecting && !(move && PROTECT_PIERCERS.has(move.id)) && !pierces) {
    out.events.push({ k: 'blocked' });
    sting(u, t, move, out, c);
    return finish(true);
  }
  // 와이드가드, 패스트가드, 트릭가드.
  const guardedBy = aimed && move && tt.guard ? guardBlocks(tt.guard, move, u, c.field) : null;
  if (guardedBy) {
    out.events.push({ k: 'guarded', by: guardedBy });
    return finish(true);
  }

  // Somewhere only a few moves reach.
  if (aimed && t.vanished) {
    const reach = t.vanished === 'gone' || !move ? undefined : REACHES[t.vanished][move.id];
    if (!reach) {
      out.missed = true;
      u.streak = 0;
      return finish(true);
    }
  }

  // Accuracy. OHKO moves ignore stages and hit a third of the time at the same level.
  const ohko = !!move && OHKO_MOVES.has(move.id);
  let baseAcc = move ? (weatherAccuracy(c.field.weather?.kind ?? null, move.id) ?? move.accuracy) : 0;
  // 절대영도 lands a fifth of the time from anything that is not an Ice type.
  if (ohko) baseAcc = move?.id === SHEER_COLD && !u.types.includes('ice') ? 20 : 30;
  else if (aimed && (t.telekinesis > 0 || t.glaive || u.lockOn > 0)) baseAcc = 0;
  // 맹독 from a Poison type cannot miss; 짓밟기 and its kin cannot miss something small.
  else if (move && ((move.id === 92 && u.types.includes('poison')) || (MINIMIZE_PUNISH.has(move.id) && t.minimized))) baseAcc = 0;
  if (u.lockOn > 0 && aimed && move) u.lockOn = 0;
  // 노가드 on either side: everything lands.
  if (aimed && (has(u, 'no-guard') || has(t, 'no-guard'))) baseAcc = 0;
  // 미라클스킨: a status move aimed at it lands half the time at best.
  if (aimed && move?.damageClass === 'status' && baseAcc !== 0 && has(t, 'wonder-skin', u)) baseAcc = Math.min(baseAcc, 50);
  // 냄새구별, 날카로운눈, 심안: its evasion does not count. 천진 ignores both sides' stages.
  const seeThrough = t.identified || has(u, 'keen-eye') || has(u, 'minds-eye');
  let eva = seeThrough ? Math.min(0, t.stages.eva) : t.stages.eva;
  let acc = u.stages.acc;
  if (has(u, 'unaware')) eva = 0;
  if (has(t, 'unaware', u)) acc = 0;
  let accMult = 1;
  if (has(u, 'compound-eyes')) accMult *= 1.3;
  if (has(u, 'victory-star')) accMult *= 1.1;
  if (has(u, 'hustle') && move?.damageClass === 'physical') accMult *= 0.8;
  const w = weatherOf(c);
  if ((has(t, 'sand-veil', u) && w === 'sand') || (has(t, 'snow-cloak', u) && (w === 'hail' || w === 'snow'))) accMult *= 0.8;
  if (has(t, 'tangled-feet', u) && t.confused > 0) accMult *= 0.5;
  const accuracy = ohko ? baseAcc : baseAcc * accuracyMult(acc - eva) * accMult * (c.field.rooms.gravity ? 5 / 3 : 1);
  const hits = (): boolean => !(aimed && baseAcc > 0) || rng() * 100 < accuracy;
  if (!hits()) {
    out.missed = true;
    u.streak = 0;
    // 썬더다이브, 점프킥 and the rest crash into the ground when they miss.
    if (move && CRASH_MOVES.has(move.id)) {
      const hp = Math.min(u.hp, Math.floor(u.maxHp / 2));
      u.hp -= hp;
      out.events.push({ k: 'crash', hp });
    }
    // 철제광선 costs its half whether or not it lands.
    if (move && HALF_COST_MOVES.has(move.id)) payHalf(u, out);
    return finish(true);
  }

  if (move?.damageClass === 'status') {
    // 가루 moves do nothing to a Grass type, stat moves included.
    if (aimed && POWDER_MOVES.has(move.id) && t.types.includes('grass')) return fail();
    // What an ability keeps off: 방음 sound, 방진 powder, 황금몸 every status move,
    // and the absorbing ones take a matching status move in (전기자석파 into 축전).
    if (aimed && abilityBlocks(move, typeFor(move, u, c), u, t, tt, out, c)) return finish(true);
    // 매직코트, 매직미러: a move it can bounce comes straight back.
    if (aimed && (t.magicCoat || has(t, 'magic-bounce', u)) && hasFlag(move, 'reflectable')) {
      const bounced: Action = { ...noAction(), acted: true };
      runStatus(move, tt, ut, bounced, c);
      out.events.push({ k: 'bounced', moveId: move.id });
      for (const e of bounced.events) {
        out.events.push(e.k === 'stat' ? { ...e, on: e.on === 'user' ? 'target' : 'user' } : e);
      }
      if (bounced.ailment) out.events.push({ k: 'self-status', condition: bounced.ailment });
      return finish(bounced.selfEffect === 'failed');
    }
    // 가로채기: the other side takes the effect of a move meant for its user.
    if (t.snatching && snatchable(move)) {
      t.snatching = false;
      const stolen: Action = { ...noAction(), acted: true };
      runStatus(move, tt, ut, stolen, c);
      out.events.push({ k: 'snatched', moveId: move.id });
      for (const e of stolen.events) {
        out.events.push(e.k === 'stat' ? { ...e, on: e.on === 'user' ? 'target' : 'user' } : e);
      }
      return finish();
    }
    runStatus(move, ut, tt, out, c);
    return finish(out.selfEffect === 'failed');
  }

  // ── A move that hits ──────────────────────────────────────────────────
  if (move && (ALWAYS_FAILS.has(move.id) || (move.id === SNORE && !asleep(u)))) return fail();
  if (move?.id === DREAM_EATER && !asleep(t)) return fail();

  // 카운터, 미러코트, 메탈버스트: what the other side just did, sent back.
  const back = move ? RETURN_MOVES[move.id] : undefined;
  let returned: number | null = null;
  if (back) {
    const took = back.from === 'physical' ? u.took.physical : back.from === 'special' ? u.took.special : u.took.physical + u.took.special;
    if (took <= 0) return fail();
    returned = Math.max(1, Math.floor(took * back.mult));
  }

  // 날씨부정 and 에어록 take the weather out of the rules without clearing the sky.
  const weather = weatherOf(c);
  const struggle = pickedId === STRUGGLE && !move;
  const pw: Power = move
    ? powerOf(
        move,
        {
          user: powerSide(u, ut),
          target: powerSide(t, tt),
          weather,
          targetMovedFirst: t.moved,
          userWasHit: u.wasHit,
          streak: u.streak,
          userLastFailed: u.lastFailed,
          targetWasHit: t.wasHit,
          userStatsFell: u.fell,
          allyFainted: ut.faintedOn === c.turn - 1,
          curled: u.curled,
          terrain: c.field.terrain?.kind ?? null,
          userGrounded: onGround(u, c.field),
          targetYetToMove: !t.moved,
          gravity: !!c.field.rooms.gravity,
          fallen: ut.mons.filter((m, i) => i !== ut.slot && m.hp <= 0).length,
          timesHit: u.mon.timesHit,
          roll: move.id === PRESENT || move.id === FICKLE_BEAM ? rng() : undefined,
        },
        BATTLE_LEVEL,
        FIXED_POWER,
      )
    : { power: struggle ? 50 : TACKLE.power, fixed: null, type: 'normal' };
  // 프레젠트 that turned out to be a heal: a quarter of the target's bar, and nothing else.
  if (move?.id === PRESENT && pw.power === 0) {
    if (t.hp >= t.maxHp || t.substitute > 0) return fail();
    const hp = Math.min(t.maxHp - t.hp, Math.max(1, Math.floor(t.maxHp / 4)));
    t.hp += hp;
    out.events.push({ k: 'present-heal', hp });
    return finish();
  }
  // 토해내기: a hundred a stockpile.
  if (move?.id === SPIT_UP) pw.power = 100 * u.stockpile;
  // 목숨걸기: exactly what the user has left.
  if (move?.id === FINAL_GAMBIT) pw.fixed = u.hp;
  // What changes a move's type after the fact: 잠재댄스 is the user's own, 송전
  // makes it Electric, and so does 플라스마피스트 for a Normal move.
  if (move?.id === REVELATION_DANCE && u.types.length) pw.type = u.types[0];
  // 오라휠: Dark while 모르페코 is hungry.
  if (move?.id === 783 && u.mon.form === 'morpeko-hangry') pw.type = 'dark';
  const skinned = move ? skinType(move, pw.type, u) : null;
  if (skinned) pw.type = skinned;
  if (u.electrified || (c.field.plasma && pw.type === 'normal')) pw.type = 'electric';
  if (move && move.id in FIXED_DAMAGE) pw.fixed = FIXED_DAMAGE[move.id];
  // 사이코웨이브: anywhere from half the user's level to half again.
  if (move?.id === PSYWAVE) pw.fixed = Math.max(1, Math.floor((BATTLE_LEVEL * (50 + Math.floor(rng() * 101))) / 100));
  if (returned !== null) pw.fixed = returned;
  if (bideDamage !== null) pw.fixed = bideDamage;
  const type = pw.type;
  // Something off the ground takes nothing from a Ground move, flying or not;
  // under Gravity, or brought down, a Flying type loses that immunity.
  const reachesFlying = move?.id === 614; // 사우전드애로
  const tTypes =
    (!onGround(t, c.field) && !reachesFlying) || type !== 'ground' ? t.types : t.types.filter((x) => x !== 'flying');
  let effect = struggle ? 1 : tTypes.length ? effectiveness(type, tTypes) : 1;
  // 텔레키네시스, 전자부유 and 부유 keep it off the ground — 틀깨기 walks past the last.
  const floating =
    t.telekinesis > 0 ||
    t.magnetRise > 0 ||
    ((has(t, 'levitate', u) || has(t, 'eelevate', u)) && !c.field.rooms.gravity && !t.smackedDown && !t.ingrained);
  if (type === 'ground' && floating && !reachesFlying) effect = 0;
  // 냄새구별, 배짱 and 심안 let Normal and Fighting land on a Ghost.
  if ((t.identified || has(u, 'scrappy') || has(u, 'minds-eye')) && (type === 'normal' || type === 'fighting') && t.types.includes('ghost')) {
    const rest = t.types.filter((x) => x !== 'ghost');
    effect = rest.length ? effectiveness(type, rest) : 1;
  }
  // 프리즈드라이 is super effective on Water whatever the chart says.
  if (move?.id === FREEZE_DRY && t.types.includes('water')) {
    effect = t.types.reduce((a, x) => a * (x === 'water' ? 2 : effectiveness('ice', [x])), 1);
  }
  // 플라잉프레스 is Flying as well as Fighting.
  if (move?.id === FLYING_PRESS && t.types.length) effect *= effectiveness('flying', t.types);
  // 타르샷 leaves it doubly weak to fire.
  if (type === 'fire' && t.volatile.has('tar-shot')) effect *= 2;
  // 절대영도 does nothing to an Ice type.
  if (move?.id === SHEER_COLD && t.types.includes('ice')) effect = 0;
  // 프리폴 drops a Flying type from a height it does not mind.
  if (skyDrop && t.types.includes('flying')) effect = 0;
  // 델타스트림: nothing is super effective on a Flying type for being Flying.
  if (weather === 'winds' && t.types.includes('flying') && effectiveness(type, ['flying']) > 1) effect /= 2;
  // 테라셸: at full HP, everything is not very effective.
  if (has(t, 'tera-shell', u) && t.hp >= t.maxHp && effect > 0 && !struggle) effect = 0.5;
  // A fixed amount ignores the chart past an immunity: 지구던지기 is 50 on anything it can touch.
  if (pw.fixed !== null && effect > 0) effect = 1;
  out.effect = effect;
  // An ability that drinks the move in, or keeps it off: 저수, 피뢰침, 방음, 타오르는불꽃…
  if (move && !struggle && abilityBlocks(move, type, u, t, tt, out, c)) {
    out.effect = 1;
    return finish(true);
  }
  if (effect === 0) return finish(true);
  // 불가사의부적: only a super-effective hit gets through.
  if (!struggle && effect <= 1 && has(t, 'wonder-guard', u)) {
    out.events.push({ k: 'ability', on: 'target', ability: 'wonder-guard' });
    out.events.push({ k: 'immune', on: 'target' });
    return finish(true);
  }
  // 옹골참 shrugs off a one-hit knockout outright.
  if (ohko && has(t, 'sturdy', u)) {
    out.events.push({ k: 'ability', on: 'target', ability: 'sturdy' });
    out.events.push({ k: 'immune', on: 'target' });
    return finish(true);
  }
  // 시작의바다 puts out every Fire move; 끝의대지 dries up every Water one.
  if (c.field.weather?.primal && weather === 'rain' && type === 'fire') return fail();
  if (c.field.weather?.primal && weather === 'sun' && type === 'water') return fail();

  // 미래예지: nothing now; the hit lands two turns on, on whoever is out there.
  if (move && FUTURE_MOVES.has(move.id)) {
    if (tt.future) return fail();
    const dmg = damageOf(u, t, pw.power, false, { crit: false, roll: rng(), stab: u.types.includes(type), effect: 1 });
    tt.future = { turns: 3, damage: dmg };
    out.events.push({ k: 'future' });
    return finish();
  }
  if (pw.fixed === 0) return fail();

  if (move && SCREEN_BREAKERS.has(move.id) && (tt.screens.reflect || tt.screens.lightScreen || tt.screens.auroraVeil)) {
    delete tt.screens.reflect;
    delete tt.screens.lightScreen;
    delete tt.screens.auroraVeil;
    out.events.push({ k: 'screens-broken' });
  }

  // A lock starts on the first turn that gets this far.
  const lockKind = move ? LOCK_MOVES[move.id] : undefined;
  if (move && lockKind && lockKind !== 'bide' && !continuing) {
    const turns = lockKind === 'rampage' ? 2 + Math.floor(rng() * 2) : lockKind === 'rollout' ? 5 : 3;
    u.lock = { id: move.id, kind: lockKind, turns, stored: 0 };
    if (lockKind === 'uproar') {
      c.field.uproar = true;
      out.events.push({ k: 'uproar', start: true });
      for (const s of [u, t]) {
        if (s.status === 'sleep') {
          s.status = null;
          s.volatile.delete('nightmare');
          out.events.push({ k: 'uproar-wake' });
        }
      }
    }
  } else if (continuing && lockKind === 'uproar') {
    out.events.push({ k: 'uproar', start: false });
  }

  const physical = !move || move.damageClass === 'physical';
  const reads = move ? STAT_READS[move.id] : undefined;
  // 지진 into a hole, 파도타기 into the deep: double.
  const vanishedMult = move && t.vanished && t.vanished !== 'gone' ? (REACHES[t.vanished][move.id] ?? 1) : 1;
  const chargedMult = u.charged && type === 'electric' ? 2 : 1;
  // 물놀이, 흙놀이: Fire and Electric at a third.
  const sportMult = (type === 'fire' && c.field.sports.water) || (type === 'electric' && c.field.sports.mud) ? 1 / 3 : 1;
  // 하이드로스팀 is the one Water move the sun makes stronger.
  const steamSun = move?.id === 876 && weather === 'sun' ? 3 : 1;
  const fieldMult =
    weatherPowerMult(weather, type) *
    (move ? abilityPowerMult(move, type, pw.power, u, t, c, skinned !== null) : 1) *
    steamSun *
    sportMult *
    (move && MINIMIZE_PUNISH.has(move.id) && t.minimized ? 2 : 1) *
    (fusionBoost ? 2 : 1) *
    (move && SE_BOOST_MOVES.has(move.id) && effect > 1 ? 5461 / 4096 : 1) *
    terrainPowerMult(c.field.terrain?.kind ?? null, move, type, onGround(u, c.field), onGround(t, c.field)) *
    vanishedMult *
    chargedMult;
  if (type === 'electric') u.charged = false;
  const defPhysical = reads?.def === 'def' || physical;
  const defMult = weatherDefenceMult(weather, t.types, defPhysical !== !!c.field.rooms.wonderRoom);
  // 틈새포착 slips past the screens.
  const screened =
    !has(u, 'infiltrator') && (!!tt.screens.auroraVeil || (physical ? !!tt.screens.reflect : !!tt.screens.lightScreen));
  const guard = t.mon.f.guard && t.mon.turnsOut < t.mon.f.guard.turns ? t.mon.f.guard.mult : 1;
  const contact = !!move && hasFlag(move, 'contact') && !has(u, 'long-reach');
  const finalMult = move ? abilityDamageMult(move, type, effect, physical, contact, u, t, c) : 1;

  // How many hits, and how hard each: 집단구타 takes one per healthy teammate.
  const special = move ? MULTI_HIT[move.id] : undefined;
  let powers: number[];
  if (move?.id === BEAT_UP) {
    powers = ut.mons
      .filter((m) => (m === u.mon ? u.hp > 0 && !u.status : m.hp > 0 && !m.status))
      .map((m) => Math.floor(m.base[1] / 10) + 5);
    if (!powers.length) return fail();
  } else if (special?.powers) {
    powers = special.powers;
  } else {
    // 스킬링크: every hit a multi-hit move can have.
    const n = move?.hits ? (has(u, 'skill-link') ? move.hits[1] : hitCount(move.hits, rng)) : 1;
    powers = Array(n).fill(pw.power);
    // 부자유친: a second hit at a quarter of the power.
    if (move && n === 1 && !ohko && has(u, 'parental-bond')) powers.push(pw.fixed !== null ? pw.power : Math.max(1, Math.floor(pw.power / 4)));
  }
  const multi = !!move && (!!move.hits || move.id === BEAT_UP || !!special);

  // 섀도스틸: the target's raised stages become the user's before the hit.
  if (move?.id === SPECTRAL_THIEF && t.substitute === 0) {
    let took = false;
    for (const k of Object.keys(t.stages) as StatKey[]) {
      if (t.stages[k] > 0) {
        u.stages[k] = Math.min(MAX_STAGE, u.stages[k] + t.stages[k]);
        t.stages[k] = 0;
        took = true;
      }
    }
    if (took) out.events.push({ k: 'stolen' });
  }
  // 예민해지기 makes this one a critical hit.
  const sureCrit = u.laserFocus > 0;
  if (sureCrit) u.laserFocus = 0;

  let landed = 0;
  let crits = 0;
  let hitReal = false;
  // 전투무장, 조가비갑옷 keep critical hits off; 무도한행동 lands one on anything poisoned; 대운 sharpens the odds.
  const noCrit = has(t, 'battle-armor', u) || has(t, 'shell-armor', u);
  const sureCrit2 = sureCrit || (has(u, 'merciless') && (t.status === 'poison' || t.status === 'toxic'));
  const critStage = (move?.critRate ?? 0) + u.critStage + (has(u, 'super-luck') ? 1 : 0);
  const hpBefore = t.hp;
  for (let h = 0; h < powers.length && t.hp > 0; h++) {
    // 트리플악셀 and its kin check again before every hit after the first — unless 스킬링크 says it lands.
    if (h > 0 && special?.each && !has(u, 'skill-link') && !hits()) break;
    let dmg: number;
    let crit = false;
    if (ohko) {
      dmg = t.hp;
    } else if (pw.fixed !== null) {
      dmg = pw.fixed;
    } else {
      crit = !noCrit && (sureCrit2 || rng() < critChance(critStage));
      dmg = damageOf(u, t, powers[h], physical, {
        finalMult,
        crit,
        roll: rng(),
        stab: !struggle && u.types.includes(type),
        effect,
        fieldMult,
        defMult,
        ignoreBurn: move?.id === 263,
        wonder: !!c.field.rooms.wonderRoom,
        atkFrom: reads?.atk,
        defStat: reads?.def,
        ignoreDefStages: reads?.ignoreStages,
      });
      // A screen halves what gets through; a critical hit goes straight past it.
      if (screened && !crit) dmg = Math.floor(dmg / 2);
    }
    // 대검돌격 left the target wide open: double.
    dmg = Math.max(1, Math.round(dmg * guard * (t.glaive ? 2 : 1)));
    // Sound goes through a substitute.
    const pierce = !!move && (hasFlag(move, 'sound') || hasFlag(move, 'authentic') || has(u, 'infiltrator'));
    if (t.substitute > 0 && move?.id !== SKY_DROP && !pierce) {
      const took = Math.min(t.substitute, dmg);
      t.substitute -= took;
      out.damage += took;
      if (!out.events.some((e) => e.k === 'sub-hit')) out.events.push({ k: 'sub-hit' });
      if (t.substitute === 0) out.events.push({ k: 'sub-broke' });
    } else {
      if (t.enduring && dmg >= t.hp) {
        dmg = t.hp - 1;
        out.events.push({ k: 'endured' });
      }
      // 칼등치기 leaves the target hanging on.
      if (move && FALSE_SWIPES.has(move.id) && dmg >= t.hp) dmg = t.hp - 1;
      // 탈: the first hit is taken by the disguise, which costs an eighth.
      if (has(t, 'disguise', u) && t.mon.form !== 'mimikyu-busted' && dmg > 0) {
        setForm(t, 'mimikyu-busted');
        out.events.push({ k: 'ability', on: 'target', ability: 'disguise' });
        out.events.push({ k: 'form', on: 'target', form: 'mimikyu-busted' });
        dmg = Math.min(Math.max(1, Math.floor(t.maxHp / 8)), t.hp);
      }
      // 아이스페이스: the ice takes a physical hit.
      else if (physical && has(t, 'ice-face', u) && t.mon.form !== 'eiscue-noice' && dmg > 0) {
        setForm(t, 'eiscue-noice');
        out.events.push({ k: 'ability', on: 'target', ability: 'ice-face' });
        out.events.push({ k: 'form', on: 'target', form: 'eiscue-noice' });
        dmg = 0;
      }
      // 옹골참: from a full bar, it hangs on with one.
      if (dmg >= t.hp && t.hp === t.maxHp && t.hp > 1 && has(t, 'sturdy', u)) {
        dmg = t.hp - 1;
        out.events.push({ k: 'ability', on: 'target', ability: 'sturdy' });
        out.events.push({ k: 'endured' });
      }
      dmg = Math.min(t.hp, dmg);
      t.hp -= dmg;
      out.damage += dmg;
      if (dmg > 0) {
        hitReal = true;
        t.took[physical ? 'physical' : 'special'] += dmg;
        t.mon.timesHit++;
        if (t.lock?.kind === 'bide') t.lock.stored += dmg;
        if (move) reactToHit(move, type, dmg, crit, physical, contact, u, t, ut, tt, out, c);
      } else hitReal ||= move !== null && FALSE_SWIPES.has(move.id);
    }
    if (crit) crits++;
    out.crit ||= crit;
    landed++;
  }
  // 도망태세, 위기회피: dropped below half by this move, it gets out.
  if (hitReal && t.hp > 0 && hpBefore * 2 > t.maxHp && t.hp * 2 <= t.maxHp && (has(t, 'wimp-out') || has(t, 'emergency-exit')) && !c.request) {
    out.events.push({ k: 'ability', on: 'target', ability: abilityOn(t)! });
    if (benchOf(tt).length) {
      c.request = { team: tt, kind: 'retreat' };
      out.events.push({ k: 'forced-out' });
    } else if (c.wild) {
      c.request = { kind: 'fled' };
      out.events.push({ k: 'fled', who: 'target' });
    }
  }
  // Knocking something out: 자기과신, 백의울음, 흑의울음, 비스트부스트, 유대변화…
  if (hitReal && t.hp <= 0 && u.hp > 0 && move) onKnockout(u, t, out, c);
  if (ohko && hitReal) out.events.push({ k: 'ohko' });
  if (multi) out.events.push({ k: 'hits', n: landed, ...(crits ? { crits } : {}) });
  if (hitReal && out.damage > 0) t.wasHit = true;

  // 길동무: the one that knocked it out goes down with it. 원념: and its move is spent.
  if (hitReal && t.hp <= 0 && t.destinyBond && u.hp > 0) {
    u.hp = 0;
    out.events.push({ k: 'destiny-bond-took' });
  }
  if (hitReal && t.hp <= 0 && t.grudge && move) {
    u.mon.ppUsed.set(move.id, move.pp);
    out.events.push({ k: 'grudge-took', moveId: move.id });
  }
  // 부리캐논 heating up burns whatever touches it.
  if (hitReal && t.beak && move && hasFlag(move, 'contact') && u.hp > 0 && inflict(u, ut, 'burn', c.field, rng)) {
    out.events.push({ k: 'self-status', condition: 'burn' });
  }

  // 분노: every hit it takes while at it makes it angrier.
  if (hitReal && t.raging && t.hp > 0) {
    out.events.push({ k: 'rage' });
    shift(t, 'atk', 1, 'target', out.events);
  }
  // A fire move thaws what it hits, as in the games — and so do 열탕 and 열사의대지.
  if (hitReal && (type === 'fire' || (move && DEFROST_MOVES.has(move.id))) && t.status === 'freeze') {
    t.status = null;
    out.events.push({ k: 'thaw' });
  }
  if (move && out.damage > 0 && move.drain > 0 && u.hp > 0 && u.healBlock === 0) {
    const amount = Math.max(1, Math.floor((out.damage * move.drain) / 100));
    // 해감액: what it drank does it harm instead.
    if (has(t, 'liquid-ooze', u)) {
      if (!has(u, 'magic-guard')) {
        const hp = Math.min(u.hp, amount);
        u.hp -= hp;
        out.events.push({ k: 'ability', on: 'target', ability: 'liquid-ooze' });
        out.events.push({ k: 'hurt', on: 'user', hp });
      }
    } else {
      const heal = Math.min(u.maxHp - u.hp, amount);
      // At full HP nothing is restored, and the games say nothing either.
      if (heal > 0) {
        u.hp += heal;
        out.events.push({ k: 'drain', hp: heal });
      }
    }
  }
  // 돌머리 takes no recoil; 매직가드 takes nothing it did not get hit for.
  if (move && out.damage > 0 && move.drain < 0 && !has(u, 'rock-head') && !has(u, 'magic-guard')) {
    const hurt = Math.min(u.hp, Math.max(1, Math.floor((out.damage * -move.drain) / 100)));
    u.hp -= hurt;
    out.events.push({ k: 'recoil', hp: hurt });
  }
  if (move && HALF_COST_MOVES.has(move.id) && !has(u, 'magic-guard')) payHalf(u, out);
  if (struggle) {
    // 발버둥 costs a quarter of the user's whole bar, whatever it dealt.
    const hurt = Math.min(u.hp, Math.max(1, Math.floor(u.maxHp / 4)));
    u.hp -= hurt;
    out.events.push({ k: 'recoil', hp: hurt });
  }
  // What decides the secondary effects: 하늘의은총 doubles every chance,
  // 우격다짐 trades them all for power, 인분 keeps them off the target.
  const sheer = !!move && has(u, 'sheer-force') && sheerForceable(move);
  const grace = has(u, 'serene-grace') ? 2 : 1;
  const dusted = has(t, 'shield-dust', u);
  // Nothing a move does beyond its damage gets past a substitute.
  if (move && hitReal && !sheer) {
    const cnd = dusted && move.ailmentChance < 100 ? null : secondaryCondition(move, t, c, grace);
    if (cnd && inflict(t, tt, cnd, c.field, rng, u)) {
      // A Flamethrower that burns. 지옥찌르기's silence has no line of its own.
      if (cnd !== 'silence') out.ailment = cnd;
      // 독조종: whatever 복숭악동 poisons is confused as well.
      if ((cnd === 'poison' || cnd === 'toxic') && has(u, 'poison-puppeteer') && inflict(t, tt, 'confusion', c.field, rng, u)) {
        out.events.push({ k: 'ability', on: 'user', ability: 'poison-puppeteer' });
      }
    }
    // Only the side that moves first can make the other flinch. 정신력 never flinches;
    // 악취 adds a tenth to anything that could not already.
    const flinch = move.flinchChance > 0 ? move.flinchChance * grace : has(u, 'stench') ? 10 : 0;
    if (first && flinch > 0 && t.hp > 0 && !dusted && !has(t, 'inner-focus', u) && rng() * 100 < flinch) t.flinched = true;
    if (move.id === ALLURING_VOICE && t.rose && inflict(t, tt, 'confusion', c.field, rng)) out.ailment = 'confusion';
    if (move.id === PSYCHIC_NOISE && t.healBlock === 0) {
      t.healBlock = 2;
      out.events.push({ k: 'heal-block' });
    }
    // 떨어뜨리기: whatever was up comes down, and stays down.
    if (SMACK_DOWN_MOVES.has(move.id) && t.hp > 0 && !t.smackedDown) {
      const wasUp = !onGround(t, c.field) || t.vanished === 'air';
      t.smackedDown = true;
      t.telekinesis = 0;
      if (t.vanished === 'air') {
        t.vanished = null;
        t.charging = null;
      }
      if (wasUp) out.events.push({ k: 'grounded' });
    }
    // 비밀의힘 on a terrain that lowers a stat instead of inflicting something.
    if (move.id === SECRET_POWER && t.hp > 0 && t.substitute === 0) {
      const drop = c.field.terrain?.kind === 'misty' ? 'spa' : c.field.terrain?.kind === 'psychic' ? 'spe' : null;
      if (drop && rng() * 100 < 30) shift(t, drop, -1, 'target', out.events);
    }
    afterHit(move, u, t, tt, out);
  }
  // A self-boost is no secondary effect of the target's; a drop on it is, and 인분 keeps that off.
  const onTarget = !!move && !statsOnUser(move);
  if (
    move &&
    out.damage > 0 &&
    move.statChanges.length &&
    move.statChance > 0 &&
    !(sheer && move.statChance < 100) &&
    !(onTarget && dusted && move.statChance < 100) &&
    rng() * 100 < move.statChance * (move.statChance < 100 ? grace : 1)
  ) {
    applyStats(move, u, t, out.events, tt);
  }
  // 마지막일침: a knockout is worth three stages of attack.
  if (move?.id === FELL_STINGER && hitReal && t.hp <= 0 && u.hp > 0) shift(u, 'atk', 3, 'user', out.events);
  // 고속스핀, 킬러스핀: the user shakes off what was holding it.
  if (move && SPIN_MOVES.has(move.id) && out.damage > 0 && u.hp > 0) {
    if (u.trapped > 0 || u.seeded || Object.keys(ut.hazards).length) out.events.push({ k: 'spin' });
    u.trapped = 0;
    u.seeded = false;
    ut.hazards = {};
  }
  // 불사르기, 전광쌍격: the type it spent is gone until it switches out.
  if (move && move.id in TYPE_SPENDERS && out.damage > 0) {
    const lost = TYPE_SPENDERS[move.id];
    u.types = u.types.filter((x) => x !== lost);
    out.events.push({ k: 'type-lost', type: lost });
  }
  if (move?.id === PLASMA_FISTS && out.damage > 0) {
    c.field.plasma = true;
    out.events.push({ k: 'plasma' });
  }
  if (move?.id === GLAIVE_RUSH) u.glaive = true;
  if (move?.id === SPIT_UP) releaseStockpile(u, out.events);
  if (move?.id === FINAL_GAMBIT && out.damage > 0) {
    u.hp = 0;
    out.events.push({ k: 'self-ko' });
  }
  if (move?.id === STEEL_ROLLER && c.field.terrain && out.damage > 0) {
    c.field.terrain = null;
    out.events.push({ k: 'terrain-cleared' });
  }
  if (move?.id === ICE_SPINNER && c.field.terrain && out.damage > 0) {
    c.field.terrain = null;
    out.events.push({ k: 'terrain-cleared' });
  }
  if (move && SELF_KO_MOVES.has(move.id)) {
    u.hp = 0;
    out.events.push({ k: 'self-ko' });
  }
  if (move && RECHARGE_MOVES.has(move.id) && out.damage > 0) u.recharge = true;
  // 대격분, 난동부리기 and the rest are rampages; 역린's line is theirs too.
  // A lock runs down; 역린 leaves its user confused when it does.
  if (u.lock && u.lock.kind !== 'bide' && u.lock.id === move?.id) {
    if (--u.lock.turns <= 0) {
      const kind = u.lock.kind;
      endLock(u, c.field);
      if (kind === 'rampage' && u.hp > 0 && inflict(u, ut, 'confusion', c.field, rng)) out.events.push({ k: 'rampage-end' });
      if (kind === 'uproar') out.events.push({ k: 'uproar-end' });
    }
  }
  // 드래곤테일: the target goes back, or a wild fight is over.
  if (
    move &&
    DRAG_OUT_MOVES.has(move.id) &&
    hitReal &&
    t.hp > 0 &&
    u.hp > 0 &&
    !t.ingrained &&
    !has(t, 'suction-cups', u) &&
    !has(t, 'guard-dog', u)
  ) {
    if (benchOf(tt).length) {
      c.request = { team: tt, kind: 'forced' };
      out.events.push({ k: 'forced-out' });
    } else if (c.wild) {
      c.request = { kind: 'fled' };
      out.events.push({ k: 'fled', who: 'target' });
    }
  }
  // 유턴: the user goes back, if there is anyone to come in.
  if (move && PIVOT_MOVES.has(move.id) && u.hp > 0 && out.damage > 0 && benchOf(ut).length && !c.request) {
    c.request = { team: ut, kind: 'retreat' };
    out.events.push({ k: 'retreat' });
  }
  // 그대로꿀꺽미사일: 파도타기 or 다이빙 comes up with something in its mouth.
  if (move && (move.id === 57 || move.id === 291) && has(u, 'gulp-missile') && u.hp > 0) {
    const form = u.hp * 2 > u.maxHp ? 'cramorant-gulping' : 'cramorant-gorging';
    if (setForm(u, form)) out.events.push({ k: 'form', on: 'user', form });
  }
  // 코어퍼니셔: if the target has moved already, its ability is gone.
  if (move?.id === 687 && hitReal && t.hp > 0 && t.moved && !t.abilityOff && t.ability && !FIXED_ABILITIES.has(t.ability)) {
    t.abilityOff = true;
    out.events.push({ k: 'ability-lost', on: 'target' });
  }
  ignoringFor = null;
  dance(move, t, ut, tt, out, c);
  return finish();
}

/** Guards 무희 from copying its own copy. */
let dancing = false;

/**
 * 무희: a dance the other side makes, it makes too, straight after — without
 * spending its own turn or its PP.
 */
function dance(move: MoveInfo | null, t: Side, ut: Team, tt: Team, out: Action, c: Ctx): void {
  if (!move || dancing || !hasFlag(move, 'dance') || out.selfEffect === 'failed' || out.missed) return;
  if (t.hp <= 0 || !has(t, 'dancer')) return;
  dancing = true;
  const moved = t.moved;
  const pp = new Map(t.mon.ppUsed);
  const last = t.lastMove;
  const copy = perform(tt, ut, move.id, c, false);
  t.moved = moved;
  t.mon.ppUsed = pp;
  t.lastMove = last;
  dancing = false;
  out.events.push({ k: 'ability', on: 'target', ability: 'dancer' });
  for (const e of copy.events) out.events.push(e.k === 'stat' ? { ...e, on: e.on === 'user' ? 'target' : 'user' } : e);
}

/**
 * What a damaging move leaves behind on a real hit, past its ailment: salt,
 * syrup, rocks, a hold, a cleared slate. Each is one move's own rule.
 */
function afterHit(move: MoveInfo, u: Side, t: Side, tt: Team, out: Action): void {
  if (t.hp > 0) {
    if (move.id === SALT_CURE && !t.salted) {
      t.salted = true;
      out.events.push({ k: 'salted' });
    }
    if (move.id === SYRUP_BOMB && t.syrup === 0) {
      t.syrup = 3;
      out.events.push({ k: 'syrup' });
    }
    if (move.id === CLEAR_SMOG && Object.values(t.stages).some((v) => v !== 0)) {
      t.stages = ZERO_STAGES();
      out.events.push({ k: 'cleared' });
    }
    if (move.id === SPARKLING_ARIA && t.status === 'burn') {
      t.status = null;
      out.events.push({ k: 'cured-burn' });
    }
    if (NO_ESCAPE_MOVES.has(move.id) && !t.noEscape) {
      t.noEscape = true;
      if (SELF_NO_ESCAPE.has(move.id)) u.noEscape = true;
      out.events.push({ k: 'no-escape', both: SELF_NO_ESCAPE.has(move.id) });
    }
  }
  // 암석액스: the splinters stay on the target's side as 스텔스록.
  if (move.id === STONE_AXE && !tt.hazards.stealthRock) {
    tt.hazards.stealthRock = 1;
    out.events.push({ k: 'hazard', set: 'stealthRock', layers: 1 });
  }
}

/** Let go of a lock. 소란피기's noise stops with it. */
function endLock(s: Side, field: Field): void {
  if (s.lock?.kind === 'uproar') field.uproar = false;
  s.lock = null;
}

/** 철제광선: half the user's bar, rounded up, landed or not. */
function payHalf(u: Side, out: Action): void {
  const hp = Math.min(u.hp, Math.ceil(u.maxHp / 2));
  if (hp <= 0) return;
  u.hp -= hp;
  out.events.push({ k: 'half-cost', hp });
}

/**
 * What a damaging move tries to inflict on what it hit, rolled — or null.
 *
 * Mostly the data's own ailment and chance. The exceptions the data cannot say:
 * 트라이어택 picks one of three, 비밀의힘 reads the terrain, 질투의불꽃 needs the
 * target to have just powered up. 'unknown' is PokeAPI's label for a move whose
 * effect is its own rule (떨어뜨리기), handled where it happens.
 */
function secondaryCondition(move: MoveInfo, t: Side, c: Ctx, grace = 1): Condition | null {
  const rng = c.rng;
  if (move.id === TRI_ATTACK) {
    if (rng() * 100 >= 20 * grace) return null;
    return (['burn', 'paralysis', 'freeze'] as const)[Math.floor(rng() * 3)];
  }
  if (move.id === SECRET_POWER) {
    const terrain = c.field.terrain?.kind ?? null;
    if (terrain === 'misty' || terrain === 'psychic') return null;
    if (rng() * 100 >= 30 * grace) return null;
    return terrain === 'grassy' ? 'sleep' : 'paralysis';
  }
  if (move.id === BURNING_JEALOUSY && !t.rose) return null;
  if (move.id === THROAT_CHOP) return 'silence';
  if (move.id === DIRE_CLAW) {
    if (rng() * 100 >= 50 * grace) return null;
    return (['poison', 'paralysis', 'sleep'] as const)[Math.floor(rng() * 3)];
  }
  if (NO_AILMENT.has(move.ailment) || SELF_AILMENTS.has(move.ailment) || move.ailmentChance <= 0) return null;
  if (rng() * 100 >= move.ailmentChance * (move.ailmentChance < 100 ? grace : 1)) return null;
  return conditionOf(move);
}

/** What 흉내쟁이 will not copy: the other callers, and moves that only make sense for their owner. */
const NOT_COPIED = new Set([383, METRONOME, SLEEP_TALK, NATURE_POWER, 166, 144, 689, 194, 266, 476, STRUGGLE]);

/**
 * The reasons a move fails before it is even aimed — the conditions written
 * into the move itself rather than anything the field or the target does.
 */
function moveFails(move: MoveInfo, u: Side, t: Side, ut: Team, prevMove: number | null | undefined, c: Ctx): boolean {
  const id = move.id;
  // 속이기, 만나자마자: the first turn out only.
  if (FIRST_TURN_MOVES.has(id) && !u.fresh) return true;
  // 기습, 질풍신뢰: only into a damaging move that has not happened yet.
  if (SUCKER_MOVES.has(id)) {
    const theirs = t.picked === null || t.picked === -1 ? null : moveOf(t.picked);
    if (t.moved || !theirs || theirs.damageClass === 'status') return true;
  }
  if (id === GIGATON_HAMMER && prevMove === GIGATON_HAMMER) return true;
  if (id === LAST_RESORT) {
    const others = kitIds(u).filter((x): x is number => x !== null && x !== LAST_RESORT);
    if (!others.length || others.some((x) => !u.tried.has(x))) return true;
  }
  // 다크홀 is 다크라이's alone.
  if (id === DARK_VOID && u.mon.f.speciesId !== 491) return true;
  if (id in TYPE_SPENDERS && !u.types.includes(TYPE_SPENDERS[id])) return true;
  // 트랩셸 goes off only if a physical move hit it first this turn.
  if (id === SHELL_TRAP && u.took.physical <= 0) return true;
  if (id === SPIT_UP && u.stockpile === 0) return true;
  if (id === STEEL_ROLLER && !c.field.terrain) return true;
  // 도망치기류는 막혀 있으면 안 된다: 순간이동 cannot run from a wild fight while held.
  if (id === TELEPORT && c.wild && !benchOf(ut).length && (u.noEscape || c.field.fairyLock > 0 || u.trapped > 0)) return true;
  // 울부짖기, 날려버리기 cannot shift a Pokemon that has put down roots, or 흡반, or 파수견.
  if ((id === 46 || id === 18) && (t.ingrained || has(t, 'suction-cups', u) || has(t, 'guard-dog', u))) return true;
  // 순간이동 cannot run from what holds it: 그림자밟기, 개미지옥 on the ground, 자력 on Steel. 도주 runs anyway.
  if (id === TELEPORT && c.wild && !benchOf(ut).length && !has(u, 'run-away') && heldBy(u, t)) return true;
  return false;
}

/** Asleep as the moves that care about it see it: really asleep, or 절대안깸. */
function asleep(s: Side): boolean {
  return s.status === 'sleep' || has(s, 'comatose');
}

/** Whether an ability on the other side keeps this one from running: 그림자밟기, 개미지옥, 자력. */
function heldBy(s: Side, o: Side): boolean {
  if (o.hp <= 0) return false;
  if (has(o, 'shadow-tag') && !has(s, 'shadow-tag')) return true;
  if (has(o, 'arena-trap') && onGround(s, CTX!.field)) return true;
  if (has(o, 'magnet-pull') && s.types.includes('steel')) return true;
  return false;
}

/**
 * A Protect with a sting in it: what a move that ran into it gets back.
 * 킹실드 and the rest punish only contact; 킹실드, 블로킹, 스레드트랩 and
 * 화염의수호 only damaging contact.
 */
function sting(u: Side, t: Side, move: MoveInfo | null, out: Action, c: Ctx): void {
  const spike = t.protectId === null ? undefined : SPIKY_PROTECT[t.protectId];
  if (!spike || !move || !hasFlag(move, 'contact') || u.hp <= 0) return;
  if (spike.damagingOnly && move.damageClass === 'status') return;
  if (spike.stat) shift(u, spike.stat.key, spike.stat.change, 'user', out.events);
  if (spike.hurt) {
    const hp = Math.min(u.hp, Math.max(1, Math.floor(u.maxHp / spike.hurt)));
    u.hp -= hp;
    out.events.push({ k: 'sting', hp });
  }
  if (spike.condition) {
    const own = c.me.active === u ? c.me : c.foe;
    if (inflict(u, own, spike.condition, c.field, c.rng)) out.events.push({ k: 'self-status', condition: spike.condition });
  }
}

/** Whether a side's one-turn guard stops this move, and which guard it was. */
function guardBlocks(g: Guard, move: MoveInfo, u: Side, field: Field): Guard | null {
  if (g === 'quick' && priorityOf(move, u, field) > 0) return g;
  if (g === 'wide' && (move.target === 'all-opponents' || move.target === 'all-other-pokemon')) return g;
  if (g === 'crafty' && move.damageClass === 'status') return g;
  return null;
}

/** A move's priority as it stands: 그래스슬라이더 is quicker on grass. */
function priorityOf(move: MoveInfo, s: Side, field: Field): number {
  let p = move.priority;
  if (move.id === GRASSY_GLIDE && field.terrain?.kind === 'grassy' && onGround(s, field)) p += 1;
  // 짓궂은마음 hurries status moves; 질풍날개 Flying ones from a full bar; 힐링시프트 healing ones by three.
  if (move.damageClass === 'status' && has(s, 'prankster')) p += 1;
  if (move.type === 'flying' && s.hp >= s.maxHp && has(s, 'gale-wings')) p += 1;
  if ((hasFlag(move, 'heal') || move.drain > 0) && has(s, 'triage')) p += 3;
  return p;
}

/**
 * Who moves first between two moves of the same priority, when abilities have
 * a say: 시간벌기 and 균사의힘 (for a status move) go last; 퀵드로 sometimes
 * goes first. Null when they have nothing to say and speed decides.
 */
function bracketOrder(me: Side, foe: Side, myPick: number | null, foePick: number | null, rng: () => number): boolean | null {
  const last = (s: Side, pick: number | null) =>
    has(s, 'stall') || (has(s, 'mycelium-might') && pick !== null && moveOf(pick)?.damageClass === 'status');
  const meLast = last(me, myPick);
  const foeLast = last(foe, foePick);
  if (meLast !== foeLast) return meLast;
  const quick = (s: Side, pick: number | null) =>
    has(s, 'quick-draw') && pick !== null && moveOf(pick)?.damageClass !== 'status' && rng() < 0.3;
  const meQuick = has(me, 'quick-draw') ? quick(me, myPick) : false;
  const foeQuick = has(foe, 'quick-draw') ? quick(foe, foePick) : false;
  if (meQuick !== foeQuick) return foeQuick;
  return null;
}

/** A status move, once it has passed the accuracy check. */
function runStatus(move: MoveInfo, ut: Team, tt: Team, out: Action, c: Ctx): void {
  const u = ut.active;
  const t = tt.active;
  const field = c.field;
  const failed = () => {
    out.selfEffect = 'failed';
  };
  if (subBlocks(move) && t.substitute > 0) return failed();
  const sk = statusKind(move);
  switch (sk.kind) {
    case 'fails':
      return failed();
    case 'ailment': {
      // 전기자석파 does nothing to a Ground type, a powder nothing to a Grass
      // one; 맹독 nothing to Steel is IMMUNE's, inside `inflict`.
      if (statusImmune(move, t.types)) return failed();
      // 뽐내기 raises the target's attack whether or not the confusion lands.
      if (move.statChanges.length) applyStats(move, u, t, out.events, tt);
      if (inflict(t, tt, sk.condition, field, c.rng, u)) out.ailment = sk.condition;
      else if (!move.statChanges.length) failed();
      return;
    }
    case 'weather':
      if (field.weather?.kind === sk.weather) return failed();
      field.weather = { kind: sk.weather, turns: WEATHER_TURNS };
      out.events.push({ k: 'weather', set: sk.weather });
      return;
    case 'terrain':
      if (field.terrain?.kind === sk.terrain) return failed();
      field.terrain = { kind: sk.terrain, turns: TERRAIN_TURNS };
      out.events.push({ k: 'terrain', set: sk.terrain });
      return;
    case 'screen': {
      const veilOk = field.weather?.kind === 'hail' || field.weather?.kind === 'snow';
      if (ut.screens[sk.screen] || (sk.screen === 'auroraVeil' && !veilOk)) return failed();
      ut.screens[sk.screen] = SCREEN_TURNS[sk.screen];
      out.events.push({ k: 'screen', set: sk.screen });
      // 순풍 at its back: 바람타기 rides it, 풍력발전 charges from it.
      if (sk.screen === 'tailwind') {
        if (has(u, 'wind-rider')) {
          out.events.push({ k: 'ability', on: 'user', ability: 'wind-rider' });
          shift(u, 'atk', 1, 'user', out.events);
        } else if (has(u, 'wind-power') && !u.charged) {
          out.events.push({ k: 'ability', on: 'user', ability: 'wind-power' });
          u.charged = true;
        }
      }
      return;
    }
    case 'hazard': {
      const now = tt.hazards[sk.hazard] ?? 0;
      if (now >= sk.max) return failed();
      tt.hazards[sk.hazard] = now + 1;
      out.events.push({ k: 'hazard', set: sk.hazard, layers: now + 1 });
      return;
    }
    case 'room': {
      if (sk.room === 'gravity') {
        if (field.rooms.gravity) return failed();
        field.rooms.gravity = ROOM_TURNS;
        // Gravity drags everything down: nothing floats, nothing flies.
        for (const s of [u, t]) {
          s.telekinesis = 0;
          if (s.vanished === 'air') {
            s.vanished = null;
            s.charging = null;
          }
        }
        out.events.push({ k: 'room', set: 'gravity', on: true });
        return;
      }
      // Using a room again twists it back, as Trick Room does.
      const on = !field.rooms[sk.room];
      if (on) field.rooms[sk.room] = ROOM_TURNS;
      else delete field.rooms[sk.room];
      out.events.push({ k: 'room', set: sk.room, on });
      return;
    }
    case 'trick-room':
      field.trickRoom = field.trickRoom > 0 ? 0 : TRICK_ROOM_TURNS;
      out.events.push({ k: 'trick-room', on: field.trickRoom > 0 });
      return;
    case 'protect':
    case 'endure': {
      // Each one in a row is a third as likely to work as the last.
      if (c.rng() >= 1 / 3 ** u.protectRun) {
        u.protectRun = 0;
        return failed();
      }
      u.protectRun++;
      if (sk.kind === 'protect') {
        u.protecting = true;
        u.protectId = move.id;
        out.events.push({ k: 'protect' });
      } else {
        u.enduring = true;
        out.events.push({ k: 'endure' });
      }
      return;
    }
    case 'rest':
      if (u.hp >= u.maxHp || u.status === 'sleep' || u.healBlock > 0 || field.uproar) return failed();
      u.hp = u.maxHp;
      u.status = 'sleep';
      u.sleepLeft = 2;
      out.selfEffect = 'heal';
      return;
    case 'sleep-talk':
      // Reached only when there was nothing to call; `perform` handled the rest.
      return failed();
    case 'heal': {
      // 초승달의기도 and 정글힐 also cure whatever it carries, so they work at full HP too.
      const cures = (move.id === 849 || move.id === 816) && !!u.status;
      if (u.hp >= u.maxHp && !cures) return failed();
      if (u.healBlock > 0) return failed();
      // 모래모으기 heals two thirds in a sandstorm.
      const sand = move.id === 659 && field.weather?.kind === 'sand' ? 2 / 3 : null;
      const share = sand ?? weatherHealShare(move, field.weather?.kind ?? null) ?? (move.healing || HEAL_SHARE * 100) / 100;
      u.hp = Math.min(u.maxHp, u.hp + Math.max(1, Math.floor(u.maxHp * share)));
      out.selfEffect = 'heal';
      if (cures) {
        u.status = null;
        out.events.push({ k: 'cured-target' });
      }
      // 날개쉬기: grounded, and no longer Flying, until the turn is over.
      if (move.id === ROOST && u.types.includes('flying') && !u.roostTypes) {
        u.roostTypes = u.types;
        const rest = u.types.filter((x) => x !== 'flying');
        u.types = rest.length ? rest : ['normal'];
      }
      return;
    }
    case 'stats':
      if (move.id === VENOM_DRENCH && t.status !== 'poison' && t.status !== 'toxic') return failed();
      // 소울비트 costs a third of the bar, 제살깎기 half; neither can be paid from less.
      if (move.id === 775 || move.id === 868) {
        const cost = Math.floor(u.maxHp / (move.id === 775 ? 3 : 2));
        if (u.hp <= cost || statsCapped(move, u, t)) return failed();
        u.hp -= cost;
      }
      // 성장 doubles in the sun.
      if (move.id === 74 && field.weather?.kind === 'sun') {
        shift(u, 'atk', 2, 'user', out.events);
        shift(u, 'spa', 2, 'user', out.events);
        return;
      }
      if (move.id === 107) u.minimized = true; // 작아지기
      if (move.id === 475) u.weightKg = Math.max(0.1, u.weightKg - 100); // 바디퍼지
      if (move.id === CHARGE) {
        u.charged = true;
        out.events.push({ k: 'charged' });
      }
      if (move.id === DEFENSE_CURL) u.curled = true;
      if (statsCapped(move, u, t)) {
        // Say which stat would not move, the way the games do.
        applyStats(move, u, t, out.events, tt);
        return;
      }
      applyStats(move, u, t, out.events, tt);
      // 막말내뱉기: the drops land, then the user goes back.
      if (move.id === 575 && benchOf(ut).length && !c.request) {
        c.request = { team: ut, kind: 'retreat' };
        out.events.push({ k: 'retreat' });
      }
      return;
    case 'guard':
      shift(u, 'def', 1, 'user', out.events);
      shift(u, 'spd', 1, 'user', out.events);
      return;
    case 'unique':
      runUnique(sk.id, ut, tt, out, c);
      return;
  }
}

/**
 * Whether an ability on the target would swallow or refuse this status move —
 * what `abilityBlocks` does, asked without doing it, for the picker.
 */
function wouldBounce(move: MoveInfo, u: Side, t: Side): boolean {
  if (hasFlag(move, 'sound') && has(t, 'soundproof', u)) return true;
  if (POWDER_MOVES.has(move.id) && has(t, 'overcoat', u)) return true;
  if (has(t, 'good-as-gold', u)) return true;
  const ty = move.type;
  if (ty === 'electric' && ['volt-absorb', 'lightning-rod', 'motor-drive'].some((a) => has(t, a, u))) return true;
  if (ty === 'water' && ['water-absorb', 'storm-drain', 'dry-skin'].some((a) => has(t, a, u))) return true;
  if (ty === 'fire' && ['flash-fire', 'well-baked-body'].some((a) => has(t, a, u))) return true;
  if (ty === 'grass' && has(t, 'sap-sipper', u)) return true;
  return false;
}

/** Whether a move that works on abilities would do anything here. See `runAbilityMove`. */
function abilityMoveUseful(id: number, u: Side, t: Side): boolean {
  const mine = u.ability;
  const theirs = t.ability;
  const fixed = (a: string | null) => !a || FIXED_ABILITIES.has(a);
  switch (id) {
    case 380:
      return !t.abilityOff && !fixed(theirs);
    case 388:
      return theirs !== 'insomnia' && !fixed(theirs) && theirs !== 'truant';
    case 493:
      return theirs !== 'simple' && !fixed(theirs) && theirs !== 'truant';
    case 494:
      return !!mine && mine !== theirs && !fixed(theirs) && !['trace', 'imposter', 'flower-gift', 'illusion', 'neutralizing-gas'].includes(mine) && theirs !== 'truant';
    case 272:
    case 867:
      return !!theirs && theirs !== mine && !fixed(theirs) && !fixed(mine) && !['trace', 'imposter', 'wonder-guard', 'flower-gift', 'illusion', 'neutralizing-gas'].includes(theirs);
    case 285:
      return !fixed(mine) && !fixed(theirs) && mine !== theirs && ![mine, theirs].some((a) => a === 'wonder-guard' || a === 'illusion' || a === 'neutralizing-gas');
    case 602:
    case 674:
      return mine === 'plus' || mine === 'minus';
  }
  return false;
}

/** The status moves that are each their own rule. */
function runUnique(id: number, ut: Team, tt: Team, out: Action, c: Ctx): void {
  const u = ut.active;
  const t = tt.active;
  const failed = () => {
    out.selfEffect = 'failed';
  };
  switch (id) {
    case SUBSTITUTE: {
      // A quarter of the user's bar goes into a decoy that takes hits for it.
      const cost = Math.floor(u.maxHp / 4);
      if (u.substitute > 0 || u.hp <= cost || cost < 1) return failed();
      u.hp -= cost;
      u.substitute = cost;
      out.events.push({ k: 'substitute' });
      return;
    }
    case TAUNT:
      if (t.taunt > 0) return failed();
      // 둔감 and 아로마베일 are proof against it.
      if (has(t, 'oblivious', u) || has(t, 'aroma-veil', u)) return failed();
      // Three turns — four if the target has already moved this one.
      t.taunt = t.moved ? 4 : 3;
      out.events.push({ k: 'taunt' });
      return;
    case ENCORE:
      if (has(t, 'aroma-veil', u)) return failed();
      if (
        t.encore ||
        t.lastMove === undefined ||
        t.lastMove === null ||
        [ENCORE, MIMIC, STRUGGLE, SLEEP_TALK, METRONOME].includes(t.lastMove) ||
        ppLeft(t, t.lastMove) === 0
      ) {
        return failed();
      }
      t.encore = { id: t.lastMove, turns: 3 };
      out.events.push({ k: 'encore' });
      return;
    case SPITE: {
      const last = t.lastMove;
      if (last === undefined || last === null || last === STRUGGLE) return failed();
      const left = ppLeft(t, last);
      if (left <= 0 || left === Infinity) return failed();
      const n = Math.min(4, left);
      t.mon.ppUsed.set(last, (t.mon.ppUsed.get(last) ?? 0) + n);
      out.events.push({ k: 'spite', moveId: last, n });
      return;
    }
    case HAZE:
      u.stages = ZERO_STAGES();
      t.stages = ZERO_STAGES();
      out.events.push({ k: 'haze' });
      return;
    case FOCUS_ENERGY:
      if (u.critStage >= 2) return failed();
      u.critStage += 2;
      out.events.push({ k: 'focus' });
      return;
    case CURSE:
      if (u.types.includes('ghost')) {
        // Half its own bar, for a quarter of the target's every turn.
        if (t.cursed) return failed();
        const hp = Math.min(u.hp, Math.floor(u.maxHp / 2));
        u.hp -= hp;
        t.cursed = true;
        out.events.push({ k: 'curse', ghost: true });
        return;
      }
      shift(u, 'spe', -1, 'user', out.events);
      shift(u, 'atk', 1, 'user', out.events);
      shift(u, 'def', 1, 'user', out.events);
      return;
    case SAFEGUARD:
      if (ut.screens.safeguard) return failed();
      ut.screens.safeguard = 5;
      out.events.push({ k: 'safeguard' });
      return;
    case PAIN_SPLIT: {
      const avg = Math.floor((u.hp + t.hp) / 2);
      u.hp = Math.min(u.maxHp, avg);
      t.hp = Math.min(t.maxHp, avg);
      out.events.push({ k: 'pain-split' });
      return;
    }
    case PSYCH_UP:
      u.stages = { ...t.stages };
      u.critStage = t.critStage;
      out.events.push({ k: 'psych-up' });
      return;
    case POWER_SWAP: {
      const [a, s] = [u.stages.atk, u.stages.spa];
      u.stages.atk = t.stages.atk;
      u.stages.spa = t.stages.spa;
      t.stages.atk = a;
      t.stages.spa = s;
      out.events.push({ k: 'swap', what: 'power' });
      return;
    }
    case GUARD_SWAP: {
      const [d, s] = [u.stages.def, u.stages.spd];
      u.stages.def = t.stages.def;
      u.stages.spd = t.stages.spd;
      t.stages.def = d;
      t.stages.spd = s;
      out.events.push({ k: 'swap', what: 'guard' });
      return;
    }
    case SPEED_SWAP: {
      // The raw stat trades hands; stages stay where they are.
      const mine = u.stats.spe;
      u.stats = { ...u.stats, spe: t.stats.spe };
      t.stats = { ...t.stats, spe: mine };
      out.events.push({ k: 'swap', what: 'speed' });
      return;
    }
    case MIMIC: {
      const last = t.lastMove;
      if (
        last === undefined ||
        last === null ||
        [MIMIC, METRONOME, STRUGGLE, SLEEP_TALK, NATURE_POWER].includes(last) ||
        kitIds(u).includes(last)
      ) {
        return failed();
      }
      u.mimic = last;
      out.events.push({ k: 'mimic', moveId: last });
      return;
    }
    case TELEPORT:
      if (benchOf(ut).length) {
        c.request = { team: ut, kind: 'retreat' };
        out.events.push({ k: 'retreat' });
      } else if (c.wild) {
        c.request = { kind: 'fled' };
        out.events.push({ k: 'fled', who: 'user' });
      } else failed();
      return;
    case BATON_PASS:
      if (!benchOf(ut).length) return failed();
      c.request = { team: ut, kind: 'retreat', baton: true };
      out.events.push({ k: 'retreat' });
      return;
    case DEFOG:
      if (t.substitute === 0) shift(t, 'eva', -1, 'target', out.events);
      for (const k of ['reflect', 'lightScreen', 'auroraVeil', 'safeguard'] as const) delete tt.screens[k];
      tt.hazards = {};
      ut.hazards = {};
      c.field.terrain = null;
      out.events.push({ k: 'defog' });
      return;
    case TELEKINESIS:
      if (t.telekinesis > 0 || c.field.rooms.gravity) return failed();
      t.telekinesis = 3;
      out.events.push({ k: 'telekinesis' });
      return;
    case IMPRISON:
      if (u.imprisoning) return failed();
      u.imprisoning = true;
      out.events.push({ k: 'imprison' });
      return;
    case SNATCH:
      u.snatching = true;
      out.events.push({ k: 'snatch' });
      return;
    case 46:
    case 18:
      // 울부짖기, 날려버리기: blown back to the bench, or out of a wild fight.
      if (benchOf(tt).length) {
        c.request = { team: tt, kind: 'forced' };
        out.events.push({ k: 'forced-out' });
      } else if (c.wild) {
        c.request = { kind: 'fled' };
        out.events.push({ k: 'fled', who: 'target' });
      } else failed();
      return;
    // ── Level-up status moves ─────────────────────────────────────────────
    case 275: // 뿌리박기
      if (u.ingrained) return failed();
      u.ingrained = true;
      u.magnetRise = 0;
      out.events.push({ k: 'ingrain' });
      return;
    case 392: // 아쿠아링
      if (u.aquaRing) return failed();
      u.aquaRing = true;
      out.events.push({ k: 'aqua-ring' });
      return;
    case 393: // 전자부유
      if (u.magnetRise > 0 || u.ingrained || c.field.rooms.gravity) return failed();
      u.magnetRise = 5;
      out.events.push({ k: 'magnet-rise' });
      return;
    case 195: {
      // 멸망의노래: three turns for everyone on the field who is not counting already.
      let any = false;
      for (const s of [u, t]) {
        if (s.perish === 0 && s.hp > 0) {
          s.perish = 4;
          any = true;
        }
      }
      if (!any) return failed();
      out.events.push({ k: 'perish' });
      return;
    }
    case 50: {
      // 사슬묶기: the move it last used, for four turns.
      const last = t.lastMove;
      if (t.disabled || last === undefined || last === null || last === STRUGGLE || ppLeft(t, last) === 0) return failed();
      if (has(t, 'aroma-veil', u)) return failed();
      t.disabled = { id: last, turns: 4 };
      out.events.push({ k: 'disable', moveId: last });
      return;
    }
    case 316: // 냄새구별
      t.identified = true;
      t.stages.eva = Math.min(0, t.stages.eva);
      out.events.push({ k: 'identified' });
      return;
    case 187: {
      // 배북: half the bar for a maxed attack.
      const cost = Math.floor(u.maxHp / 2);
      if (u.hp <= cost || u.stages.atk >= MAX_STAGE) return failed();
      u.hp -= cost;
      u.stages.atk = MAX_STAGE;
      u.rose = true;
      out.events.push({ k: 'belly-drum' });
      return;
    }
    case STOCKPILE:
      if (u.stockpile >= 3) return failed();
      u.stockpile++;
      out.events.push({ k: 'stockpile', n: u.stockpile });
      shift(u, 'def', 1, 'user', out.events);
      shift(u, 'spd', 1, 'user', out.events);
      return;
    case SWALLOW: {
      if (u.stockpile === 0 || u.healBlock > 0) return failed();
      const share = [0, 1 / 4, 1 / 2, 1][u.stockpile];
      const hp = Math.min(u.maxHp - u.hp, Math.max(1, Math.floor(u.maxHp * share)));
      u.hp += hp;
      if (hp > 0) out.selfEffect = 'heal';
      releaseStockpile(u, out.events);
      return;
    }
    case 262: // 추억의선물: the stages land, and the user goes down whatever happened.
      if (t.substitute === 0) applyStats(moveOf(262)!, u, t, out.events, tt);
      u.hp = 0;
      out.events.push({ k: 'self-ko' });
      return;
    case 273: // 희망사항
      if (ut.wish) return failed();
      ut.wish = { turns: 2, hp: Math.max(1, Math.floor(u.maxHp / 2)) };
      out.events.push({ k: 'wish' });
      return;
    case 277: // 매직코트
      u.magicCoat = true;
      out.events.push({ k: 'magic-coat' });
      return;
    case 288: // 원념
      u.grudge = true;
      out.events.push({ k: 'grudge' });
      return;
    case 194: // 길동무: fails if it was the last thing it did.
      if (u.destinyBond && u.lastMove === 194) return failed();
      u.destinyBond = true;
      out.events.push({ k: 'destiny-bond' });
      return;
    case 215: // 치료방울
    case 312: {
      // 아로마테라피: the whole team, benched ones included.
      const any = ut.mons.some((m, i) => (i === ut.slot ? u.status : m.status) !== null);
      if (!any) return failed();
      for (const m of ut.mons) m.status = null;
      u.status = null;
      out.events.push({ k: 'cure-team' });
      return;
    }
    case 212: // 검은눈빛
    case 335: // 블록
      if (t.noEscape) return failed();
      t.noEscape = true;
      out.events.push({ k: 'no-escape' });
      return;
    case 150: // 튀어오르기
      out.events.push({ k: 'splash' });
      return;
    case 160: {
      // 텍스처: the type of its first move, if that is not already its type.
      const first = kitIds(u).map(moveOf).find((m) => m && m.id !== 160);
      if (!first || (u.types.length === 1 && u.types[0] === first.type)) return failed();
      u.types = [first.type];
      out.events.push({ k: 'type', on: 'user', types: [first.type] });
      return;
    }
    case 176: {
      // 텍스처2: a type that resists what the target last used.
      const last = t.lastMove === undefined || t.lastMove === null ? null : moveOf(t.lastMove);
      if (!last) return failed();
      const resist = TYPES.filter((ty) => effectiveness(last.type, [ty]) < 1 && !(u.types.length === 1 && u.types[0] === ty));
      if (!resist.length) return failed();
      const ty = resist[Math.floor(c.rng() * resist.length)];
      u.types = [ty];
      out.events.push({ k: 'type', on: 'user', types: [ty] });
      return;
    }
    case 170: // 마음의눈
    case 199: // 록온
      u.lockOn = 2;
      out.events.push({ k: 'lock-on' });
      return;
    case 166: {
      // 스케치: the target's last move, for good — here, for the fight.
      const last = t.lastMove;
      if (last === undefined || last === null || [166, STRUGGLE, 165].includes(last) || kitIds(u).includes(last)) return failed();
      u.moveset = kitIds(u).map((id) => (id === 166 ? last : id)).filter((id): id is number => id !== null);
      out.events.push({ k: 'sketch', moveId: last });
      return;
    }
    case 144: {
      // 변신: its types, stats but HP, stages and moves become the target's.
      if (t.substitute > 0 || u.moveset !== null) return failed();
      u.types = [...t.types];
      u.stats = { ...t.stats, hp: u.stats.hp };
      u.stages = { ...t.stages };
      u.critStage = t.critStage;
      u.weightKg = t.weightKg;
      u.moveset = kitIds(t).filter((id): id is number => id !== null);
      out.events.push({ k: 'transform' });
      return;
    }
    case 361: // 치유소원
    case 461: // 초승달춤
      if (!benchOf(ut).length) return failed();
      ut.healingWish = true;
      u.hp = 0;
      out.events.push({ k: 'healing-wish' });
      return;
    case 367: {
      // 경혈찌르기: two stages on one it can still raise, chosen at random.
      const open = (['atk', 'def', 'spa', 'spd', 'spe', 'acc', 'eva'] as const).filter((k) => u.stages[k] < MAX_STAGE);
      if (!open.length) return failed();
      shift(u, open[Math.floor(c.rng() * open.length)], 2, 'user', out.events);
      return;
    }
    case 375: {
      // 사이코시프트: its condition moves onto the target.
      const cnd = u.status;
      if (!cnd || t.status || !inflict(t, tt, cnd, c.field, c.rng)) return failed();
      u.status = null;
      out.ailment = cnd;
      out.events.push({ k: 'psycho-shift' });
      return;
    }
    case 379: // 파워트릭
      u.stats = { ...u.stats, atk: u.stats.def, def: u.stats.atk };
      out.events.push({ k: 'power-trick' });
      return;
    case 470:
    case 471: {
      // 가드셰어, 파워셰어: the raw stats averaged.
      const [a, b] = id === 470 ? (['def', 'spd'] as const) : (['atk', 'spa'] as const);
      const avg = (k: 'atk' | 'def' | 'spa' | 'spd') => Math.floor((u.stats[k] + t.stats[k]) / 2);
      const na = avg(a);
      const nb = avg(b);
      u.stats = { ...u.stats, [a]: na, [b]: nb };
      t.stats = { ...t.stats, [a]: na, [b]: nb };
      out.events.push({ k: 'split', what: id === 470 ? 'guard' : 'power' });
      return;
    }
    case 391: {
      // 하트스왑
      const mine = u.stages;
      u.stages = t.stages;
      t.stages = mine;
      out.events.push({ k: 'heart-swap' });
      return;
    }
    case 576: // 뒤집어엎기
      if (Object.values(t.stages).every((v) => v === 0)) return failed();
      for (const k of Object.keys(t.stages) as StatKey[]) t.stages[k] = -t.stages[k];
      out.events.push({ k: 'topsy-turvy' });
      return;
    case 469:
    case 501:
    case 578: {
      // 와이드가드, 패스트가드, 트릭가드: this turn only, and they never tire.
      const set: Guard = id === 469 ? 'wide' : id === 501 ? 'quick' : 'crafty';
      ut.guard = set;
      out.events.push({ k: 'guard', set });
      return;
    }
    case 487: // 물붓기
    case 750: {
      // 마법가루
      const ty: MoveType = id === 487 ? 'water' : 'psychic';
      if (t.types.length === 1 && t.types[0] === ty) return failed();
      t.types = [ty];
      out.events.push({ k: 'type', on: 'target', types: [ty] });
      return;
    }
    case 567: // 핼러윈
    case 571: {
      // 숲의저주: a third type, on top of what it is.
      const ty: MoveType = id === 567 ? 'ghost' : 'grass';
      if (t.types.includes(ty)) return failed();
      t.types = [...t.types.filter((x) => x !== (id === 567 ? 'grass' : 'ghost') || t.mon.types.includes(x)), ty];
      out.events.push({ k: 'type', on: 'target', types: [...t.types] });
      return;
    }
    case 513: // 미러타입
      if (!t.types.length) return failed();
      u.types = [...t.types];
      out.events.push({ k: 'type', on: 'user', types: [...t.types] });
      return;
    case 495: // 당신먼저: only while the target still has its move to make.
      if (t.moved) return failed();
      out.events.push({ k: 'after-you' });
      return;
    case 582: // 송전
      if (t.moved) return failed();
      t.electrified = true;
      out.events.push({ k: 'electrify' });
      return;
    case 587: // 페어리록
      if (c.field.fairyLock > 0) return failed();
      c.field.fairyLock = 2;
      out.events.push({ k: 'fairy-lock' });
      return;
    case 563: // 일구기
    case 579: {
      // 플라워가드: every Grass type on the field — on the ground, for 일구기.
      const who = [
        [u, 'user'],
        [t, 'target'],
      ] as const;
      const grass = who.filter(([s]) => s.types.includes('grass') && s.hp > 0 && (id === 579 || onGround(s, c.field)));
      if (!grass.length) return failed();
      for (const [s, on] of grass) {
        if (id === 563) {
          shift(s, 'atk', 1, on, out.events);
          shift(s, 'spa', 1, on, out.events);
        } else shift(s, 'def', 1, on, out.events);
      }
      return;
    }
    case 668: {
      // 힘흡수: heals what the target's attack is right now, and lowers it.
      if (t.stages.atk <= -MAX_STAGE || t.substitute > 0) return failed();
      const heal = Math.max(1, Math.floor(t.stats.atk * stageMult(t.stages.atk)));
      shift(t, 'atk', -1, 'target', out.events);
      if (u.healBlock === 0) {
        const hp = Math.min(u.maxHp - u.hp, heal);
        u.hp += hp;
        if (hp > 0) out.events.push({ k: 'drain', hp });
      }
      return;
    }
    case 673: // 예민해지기: the next move is a critical hit.
      u.laserFocus = 2;
      out.events.push({ k: 'laser-focus' });
      return;
    case PURIFY: {
      // 정화: cures the target, heals the user.
      if (!t.status) return failed();
      t.status = null;
      out.events.push({ k: 'cured-target' });
      if (u.healBlock === 0 && u.hp < u.maxHp) {
        u.hp = Math.min(u.maxHp, u.hp + Math.max(1, Math.floor(u.maxHp / 2)));
        out.selfEffect = 'heal';
      }
      return;
    }
    case 505: // 치유파동
    case 666: {
      // 플라워힐: heals the TARGET — in a single battle, the other side.
      if (t.hp >= t.maxHp || t.healBlock > 0 || t.substitute > 0) return failed();
      const share = id === 666 && c.field.terrain?.kind === 'grassy' ? 2 / 3 : 1 / 2;
      const hp = Math.min(t.maxHp - t.hp, Math.max(1, Math.floor(t.maxHp * share)));
      t.hp += hp;
      out.events.push({ k: 'heal-target', hp });
      return;
    }
    case 689: {
      // 지휘: the target uses its last move again, right now.
      const last = t.lastMove;
      const m = last === undefined || last === null ? null : moveOf(last);
      if (!m || m.id in CHARGE_MOVES || m.id in LOCK_MOVES || [689, 166, 144].includes(m.id) || t.hp <= 0 || ppLeft(t, m.id) === 0) {
        return failed();
      }
      out.events.push({ k: 'instructed', moveId: m.id });
      const again = perform(tt, ut, m.id, c, false);
      // What it did, from this side's point of view.
      for (const e of again.events) out.events.push(e.k === 'stat' ? { ...e, on: e.on === 'user' ? 'target' : 'user' } : e);
      return;
    }
    case 753: // 문어굳히기
      if (t.octolock) return failed();
      t.octolock = true;
      t.noEscape = true;
      out.events.push({ k: 'octolock' });
      return;
    case 756: {
      // 코트체인지: everything on each half of the field changes sides.
      const [ms, mh] = [ut.screens, ut.hazards];
      ut.screens = tt.screens;
      ut.hazards = tt.hazards;
      tt.screens = ms;
      tt.hazards = mh;
      out.events.push({ k: 'court-change' });
      return;
    }
    case 748: // 배수의진
      if (u.noRetreat) return failed();
      u.noRetreat = true;
      u.noEscape = true;
      out.events.push({ k: 'no-retreat' });
      for (const k of ['atk', 'def', 'spa', 'spd', 'spe'] as const) shift(u, k, 1, 'user', out.events);
      return;
    case 880: {
      // 꼬리자르기: half its bar into a substitute, which the next one inherits.
      const cost = Math.ceil(u.maxHp / 2);
      if (!benchOf(ut).length || u.hp <= cost || u.substitute > 0) return failed();
      u.hp -= cost;
      c.request = { team: ut, kind: 'retreat', shedTail: Math.floor(u.maxHp / 4) };
      out.events.push({ k: 'shed-tail' });
      return;
    }
    case 882: // 정리정돈: hazards and substitutes, everywhere.
      ut.hazards = {};
      tt.hazards = {};
      u.substitute = 0;
      t.substitute = 0;
      out.events.push({ k: 'tidy-up' });
      shift(u, 'atk', 1, 'user', out.events);
      shift(u, 'spe', 1, 'user', out.events);
      return;
    case 863: {
      // 회생의기도: a fainted teammate back, at half.
      const slot = ut.mons.findIndex((m, i) => i !== ut.slot && m.hp <= 0);
      if (slot < 0) return failed();
      ut.mons[slot].hp = Math.max(1, Math.floor(ut.mons[slot].maxHp / 2));
      ut.mons[slot].status = null;
      out.events.push({ k: 'revival', slot });
      return;
    }
    case 850: // 브레이브차지: special stats up, and whatever it carries is gone.
      shift(u, 'spa', 1, 'user', out.events);
      shift(u, 'spd', 1, 'user', out.events);
      if (u.status) {
        u.status = null;
        out.events.push({ k: 'cured-target' });
      }
      return;
    case 346: // 물놀이
    case 300: {
      // 흙놀이
      const what = id === 346 ? 'water' : 'mud';
      if (c.field.sports[what]) return failed();
      c.field.sports[what] = 5;
      out.events.push({ k: 'sport', what });
      return;
    }
    case 54: // 흰안개
      if (ut.screens.mist) return failed();
      ut.screens.mist = 5;
      out.events.push({ k: 'mist' });
      return;
    // Abilities: settled in server/abilities.ts once a Pokemon has one.
    case 380: // 위액
    case 388: // 고민씨
    case 493: // 심플빔
    case 494: // 동료만들기
    case 272: // 역할
    case 867: // 배껴그리기
    case 602: // 자기장조작
    case 674: // 어시스트기어
    case 285: // 스킬스왑
      if (!runAbilityMove(id, u, t, out, c)) failed();
      return;
    default:
      failed();
  }
}

/** Turns Gravity, 원더룸 and 매직룸 last. */
const ROOM_TURNS = 5;

/**
 * Bring a team's Pokemon at `slot` out, and let the hazards on its side have
 * their say. `baton` is 배턴터치: stages, a substitute, confusion and a
 * focus come across with it.
 */
function sendOut(
  t: Team,
  slot: number,
  on: 'me' | 'foe',
  field: Field,
  entry: EndEvent[],
  baton: Side | null = null,
  other: Team | null = null,
  shedTail = 0,
): void {
  // Whatever the leaver had hold of goes free: a bind, a 프리폴, a 소란피기.
  const leaving = t.active;
  if (other) {
    other.active.trapped = 0;
    // A hold is on somebody: when they go, it goes. 문어굳히기 and 물고버티기 included.
    other.active.octolock = false;
    if (other.active.noEscape && !other.active.noRetreat) other.active.noEscape = false;
    if (other.active.held) {
      other.active.held = false;
      other.active.vanished = null;
    }
  }
  if (leaving.lock) endLock(leaving, field);
  if (leaving.roostTypes) leaving.types = leaving.roostTypes;
  // What an ability does on the way out: 자연회복 cures, 재생력 heals a third,
  // 마이티체인지 comes back a hero, and a primal weather goes with its holder.
  if (leaving.hp > 0) {
    if (has(leaving, 'natural-cure')) leaving.status = null;
    if (has(leaving, 'regenerator')) leaving.hp = Math.min(leaving.maxHp, leaving.hp + Math.floor(leaving.maxHp / 3));
    if (has(leaving, 'zero-to-hero')) leaving.mon.spent.add('zero-to-hero');
  }
  if (field.weather?.primal && ['primordial-sea', 'desolate-land', 'delta-stream'].includes(abilityOn(leaving) ?? '')) {
    field.weather = null;
  }
  // Forms that hold only while out go back.
  if (leaving.mon.form && ['aegislash-blade', 'darmanitan-zen', 'morpeko-hangry', 'castform-sunny', 'castform-rainy', 'castform-snowy', 'wishiwashi-school', 'minior-red'].includes(leaving.mon.form)) {
    leaving.mon.form = null;
  }
  stow(t);
  t.slot = slot;
  const s = sideOf(t.mons[slot]);
  if (baton) {
    s.stages = { ...baton.stages };
    s.substitute = baton.substitute;
    s.confused = baton.confused;
    s.critStage = baton.critStage;
    s.cursed = baton.cursed;
  }
  // 꼬리자르기: the substitute is waiting for whoever comes in.
  if (shedTail > 0) s.substitute = shedTail;
  t.active = s;
  arrive(t, on, field, entry);
  if (CTX) onEntry(t, CTX, entry);
}

/** 스텔스록, 압정뿌리기, 독압정, 끈적끈적네트 on whoever just came in — and a 치유소원 waiting for it. */
function arrive(t: Team, on: 'me' | 'foe', field: Field, entry: EndEvent[]): void {
  const s = t.active;
  const ground = onGround(s, field);
  if (t.healingWish && s.hp > 0 && (s.hp < s.maxHp || s.status)) {
    t.healingWish = false;
    s.hp = s.maxHp;
    s.status = null;
    entry.push({ k: 'healed-in', on });
  }
  const guarded = has(s, 'magic-guard');
  if (t.hazards.stealthRock && s.hp > 0 && !guarded) {
    const eff = s.types.length ? effectiveness('rock', s.types) : 1;
    const hp = Math.min(s.hp, Math.max(1, Math.floor((s.maxHp * eff) / 8)));
    s.hp -= hp;
    entry.push({ k: 'hazard-hit', on, hazard: 'stealthRock', hp });
  }
  if (t.hazards.spikes && ground && s.hp > 0 && !guarded) {
    const frac = [0, 1 / 8, 1 / 6, 1 / 4][t.hazards.spikes];
    const hp = Math.min(s.hp, Math.max(1, Math.floor(s.maxHp * frac)));
    s.hp -= hp;
    entry.push({ k: 'hazard-hit', on, hazard: 'spikes', hp });
  }
  if (t.hazards.toxicSpikes && ground && s.hp > 0) {
    if (s.types.includes('poison')) {
      // A grounded Poison type soaks them up.
      delete t.hazards.toxicSpikes;
      entry.push({ k: 'toxic-spikes-gone', on });
    } else if (
      !s.status &&
      !s.types.includes('steel') &&
      !t.screens.safeguard &&
      field.terrain?.kind !== 'misty'
    ) {
      const condition = t.hazards.toxicSpikes >= 2 ? 'toxic' : 'poison';
      s.status = condition;
      s.toxicN = 0;
      entry.push({ k: 'toxic-spikes', on, condition });
    }
  }
  if (t.hazards.stickyWeb && ground && s.hp > 0) {
    entry.push({ k: 'sticky-web', on });
    if (s.stages.spe > -MAX_STAGE) {
      s.stages.spe--;
      entry.push({ k: 'end-stat', on, stat: 'spe', delta: -1 });
    }
  }
}

/** The end-of-turn chip a side takes from what it is carrying. */
function statusChip(s: Side, on: 'me' | 'foe', end: EndEvent[]): number {
  if (s.hp <= 0) return 0;
  // 포이즌힐: poison heals an eighth instead.
  if ((s.status === 'poison' || s.status === 'toxic') && has(s, 'poison-heal')) {
    if (s.hp < s.maxHp && s.healBlock === 0) {
      const hp = Math.min(s.maxHp - s.hp, Math.max(1, Math.floor(s.maxHp / 8)));
      s.hp += hp;
      end.push({ k: 'ability', on, ability: 'poison-heal' });
      end.push({ k: 'end-heal', on, hp });
    }
    if (s.status === 'toxic') s.toxicN = Math.min(15, s.toxicN + 1);
    return 0;
  }
  // 매직가드 takes no damage it was not hit for.
  if (has(s, 'magic-guard')) return 0;
  const part = (div: number) => Math.max(1, Math.floor(s.maxHp / div));
  const take = (condition: Condition | 'curse', amount: number) => {
    const hp = Math.min(s.hp, amount);
    if (hp <= 0) return 0;
    s.hp -= hp;
    end.push({ k: 'status-chip', on, condition, hp });
    return hp;
  };
  let chip = 0;
  if (s.status === 'burn') chip += take('burn', part(16));
  if (s.status === 'poison') chip += take('poison', part(8));
  if (s.status === 'toxic') {
    s.toxicN = Math.min(15, s.toxicN + 1);
    chip += take('toxic', Math.max(1, Math.floor((s.maxHp * s.toxicN) / 16)));
  }
  if (s.trapped > 0) {
    s.trapped--;
    chip += take('trap', part(8));
  }
  if (s.volatile.has('nightmare') && s.status === 'sleep') chip += take('nightmare', part(4));
  if (s.cursed) chip += take('curse', part(4));
  return chip;
}

/**
 * Everything that happens once both sides have moved, in the games' order:
 * weather chip, a 미래예지 landing, conditions, Grassy Terrain, then things
 * wearing off.
 *
 * Returns the net chip each side took; heals are inside the HP but not counted.
 */
function endOfTurn(c: Ctx, foeFirst: boolean): { mine: number; theirs: number; end: EndEvent[] } {
  const { field } = c;
  const end: EndEvent[] = [];
  let mine = 0;
  let theirs = 0;
  const add = (on: 'me' | 'foe', hp: number) => {
    if (on === 'me') mine += hp;
    else theirs += hp;
  };
  const order: ['me' | 'foe', Team][] = foeFirst ? [['foe', c.foe], ['me', c.me]] : [['me', c.me], ['foe', c.foe]];

  const liveWeather = weatherOf(c);
  if (field.weather && liveWeather) {
    const w = liveWeather;
    for (const [on, t] of order) {
      const s = t.active;
      if (s.hp <= 0 || !weatherChips(w, s.types) || s.vanished === 'ground' || s.vanished === 'water') continue;
      // What keeps the weather off: 매직가드, 방진, and each weather's own.
      if (has(s, 'magic-guard') || has(s, 'overcoat')) continue;
      if (w === 'sand' && ['sand-veil', 'sand-rush', 'sand-force'].some((a) => has(s, a))) continue;
      if (w === 'hail' && ['ice-body', 'snow-cloak'].some((a) => has(s, a))) continue;
      const hp = Math.min(s.hp, Math.max(1, Math.floor(s.maxHp / 16)));
      s.hp -= hp;
      add(on, hp);
      end.push({ k: 'weather-chip', on, weather: w, hp });
    }
  }
  for (const [on, t] of order) {
    if (!t.future) continue;
    if (--t.future.turns > 0) continue;
    const s = t.active;
    const hp = Math.min(s.hp, t.future.damage);
    t.future = null;
    if (s.hp <= 0) continue;
    s.hp -= hp;
    add(on, hp);
    end.push({ k: 'future-hit', on, hp });
  }
  // 희망사항 comes true for whoever is out.
  for (const [on, t] of order) {
    if (!t.wish) continue;
    if (--t.wish.turns > 0) continue;
    const s = t.active;
    const hp = s.hp > 0 && s.healBlock === 0 ? Math.min(s.maxHp - s.hp, t.wish.hp) : 0;
    t.wish = null;
    if (hp > 0) {
      s.hp += hp;
      end.push({ k: 'wish', on, hp });
    }
  }
  // 아쿠아링, 뿌리박기: a sixteenth back.
  for (const [on, t] of order) {
    const s = t.active;
    for (const what of ['aqua-ring', 'ingrain'] as const) {
      if (!(what === 'aqua-ring' ? s.aquaRing : s.ingrained) || s.hp <= 0 || s.hp >= s.maxHp || s.healBlock > 0) continue;
      const hp = Math.min(s.maxHp - s.hp, Math.max(1, Math.floor(s.maxHp / 16)));
      s.hp += hp;
      end.push({ k: 'ring-heal', on, hp, what });
    }
  }
  // 씨뿌리기: an eighth, to whoever is out on the other side — through 해감액, a hurt instead.
  for (const [on, t] of order) {
    const s = t.active;
    const o = otherOf(c, t).active;
    if (!s.seeded || s.hp <= 0 || o.hp <= 0 || has(s, 'magic-guard')) continue;
    const hp = Math.min(s.hp, Math.max(1, Math.floor(s.maxHp / 8)));
    s.hp -= hp;
    add(on, hp);
    let healed = o.healBlock > 0 ? 0 : Math.min(o.maxHp - o.hp, hp);
    if (has(s, 'liquid-ooze')) {
      healed = 0;
      if (!has(o, 'magic-guard')) {
        const hurt = Math.min(o.hp, hp);
        o.hp -= hurt;
        add(on === 'me' ? 'foe' : 'me', hurt);
      }
    }
    o.hp += healed;
    end.push({ k: 'leech-seed', on, hp, healed });
  }
  for (const [on, t] of order) add(on, statusChip(t.active, on, end));
  abilityEndOfTurn(c, order, end, add);
  for (const [on, t] of order) {
    const s = t.active;
    if (s.hp <= 0) continue;
    // 소금절이: an eighth, a quarter on Water and Steel.
    if (s.salted && !has(s, 'magic-guard')) {
      const div = s.types.includes('water') || s.types.includes('steel') ? 4 : 8;
      const hp = Math.min(s.hp, Math.max(1, Math.floor(s.maxHp / div)));
      s.hp -= hp;
      add(on, hp);
      end.push({ k: 'salt', on, hp });
    }
    // 문어굳히기: both defences down a stage.
    if (s.octolock && s.hp > 0) {
      end.push({ k: 'octolock', on });
      for (const stat of ['def', 'spd'] as const) {
        if (s.stages[stat] > -MAX_STAGE) {
          s.stages[stat]--;
          end.push({ k: 'end-stat', on, stat, delta: -1 });
        }
      }
    }
    // 시럽봄: speed down a stage, three turns.
    if (s.syrup > 0 && s.hp > 0) {
      s.syrup--;
      end.push({ k: 'syrup', on });
      if (s.stages.spe > -MAX_STAGE) {
        s.stages.spe--;
        end.push({ k: 'end-stat', on, stat: 'spe', delta: -1 });
      }
    }
    // 하품: the second end of turn puts it to sleep.
    if (s.drowsy > 0 && --s.drowsy === 0 && !s.status && s.hp > 0 && !field.uproar) {
      s.status = 'sleep';
      s.sleepLeft = 1 + Math.floor(c.rng() * 3);
      end.push({ k: 'yawn-sleep', on });
    }
    // 멸망의노래: three, two, one.
    if (s.perish > 0) {
      s.perish--;
      end.push({ k: 'perish', on, n: s.perish });
      if (s.perish === 0) {
        add(on, s.hp);
        s.hp = 0;
      }
    }
  }
  if (field.terrain?.kind === 'grassy') {
    for (const [on, t] of order) {
      const s = t.active;
      if (s.hp <= 0 || s.hp >= s.maxHp || !onGround(s, field) || s.healBlock > 0) continue;
      const hp = Math.min(s.maxHp - s.hp, Math.max(1, Math.floor(s.maxHp / 16)));
      s.hp += hp;
      end.push({ k: 'terrain-heal', on, hp });
    }
  }

  if (field.weather && --field.weather.turns <= 0) {
    end.push({ k: 'weather-end', weather: field.weather.kind });
    field.weather = null;
  }
  if (field.terrain && --field.terrain.turns <= 0) {
    end.push({ k: 'terrain-end', terrain: field.terrain.kind });
    field.terrain = null;
  }
  for (const [on, t] of order) {
    for (const key of Object.keys(t.screens) as (Screen | 'safeguard' | 'mist')[]) {
      if (--t.screens[key]! <= 0) {
        delete t.screens[key];
        end.push(key === 'mist' ? { k: 'wore-off-2', on, what: 'mist' } : { k: 'screen-end', on, screen: key });
      }
    }
    const s = t.active;
    const wear = (what: 'taunt' | 'encore' | 'telekinesis' | 'heal-block') => end.push({ k: 'wore-off', on, what });
    if (s.taunt > 0 && --s.taunt === 0) wear('taunt');
    if (s.encore && (--s.encore.turns <= 0 || ppLeft(s, s.encore.id) === 0)) {
      s.encore = null;
      wear('encore');
    }
    if (s.telekinesis > 0 && --s.telekinesis === 0) wear('telekinesis');
    if (s.healBlock > 0 && --s.healBlock === 0) wear('heal-block');
    if (s.silenced > 0) s.silenced--;
    s.justIn = false;
    if (s.disabled && --s.disabled.turns <= 0) {
      s.disabled = null;
      end.push({ k: 'wore-off-2', on, what: 'disable' });
    }
    if (s.magnetRise > 0 && --s.magnetRise === 0) end.push({ k: 'wore-off-2', on, what: 'magnet-rise' });
    if (s.lockOn > 0) s.lockOn--;
    if (s.laserFocus > 0) s.laserFocus--;
    // A Pokemon that was out for this whole turn has had its first turn.
    if (s.picked !== -1) s.fresh = false;
    s.magicCoat = false;
    s.electrified = false;
    s.beak = false;
    s.shellTrap = false;
    s.protectId = null;
    t.guard = null;

    // 날개쉬기's grounding lasts the turn it was used.
    if (s.roostTypes) {
      s.types = s.roostTypes;
      s.roostTypes = null;
    }
    s.snatching = false;
    s.mon.turnsOut++;
  }
  if (field.trickRoom > 0 && --field.trickRoom <= 0) end.push({ k: 'trick-room-end' });
  for (const what of ['water', 'mud'] as const) {
    if (field.sports[what] !== undefined && --field.sports[what]! <= 0) {
      delete field.sports[what];
      end.push({ k: 'sport-end', what });
    }
  }
  if (field.fairyLock > 0) field.fairyLock--;
  field.plasma = false;
  for (const room of Object.keys(field.rooms) as Room[]) {
    if (--field.rooms[room]! <= 0) {
      delete field.rooms[room];
      end.push({ k: 'room-end', room });
    }
  }
  return { mine, theirs, end };
}

function sideView(t: Team): SideView {
  return { ...t.screens, ...t.hazards };
}

/** The field as the scene shows it. */
function fieldView(c: Ctx): FieldView {
  const f = c.field;
  return {
    weather: f.weather?.kind ?? null,
    weatherTurns: f.weather?.turns ?? 0,
    terrain: f.terrain?.kind ?? null,
    terrainTurns: f.terrain?.turns ?? 0,
    trickRoom: f.trickRoom,
    rooms: { ...f.rooms },
    mine: sideView(c.me),
    theirs: sideView(c.foe),
  };
}

/**
 * Which move a side throws this turn.
 *
 * A move half-way through its charge, or one 앙코르 has locked in, is the only
 * choice. Otherwise a move that would only fail, one that is barred (도발,
 * 회복봉인, 봉인), one out of PP, or the move 트집 forbids repeating is
 * dropped first; then the rest are weighed by the chart. With every move out
 * of PP it is 발버둥.
 */
function choose(ut: Team, tt: Team, c: Ctx): number | null {
  const s = ut.active;
  if (s.charging !== null) return s.charging;
  if (s.lock) return s.lock.id;
  // 무아지경 keeps it on the move it opened with, while that move has PP.
  if (s.choiceLock !== null && has(s, 'gorilla-tactics') && ppLeft(s, s.choiceLock) > 0) return s.choiceLock;
  if (s.encore && ppLeft(s, s.encore.id) > 0) return s.encore.id;
  const all = kitIds(s);
  // 트집: the move just used cannot be chosen again; with nothing else left it is 발버둥.
  // 사슬묶기 and 거대해머's cooldown bar a move from being chosen the same way.
  const withPp = all.filter(
    (id) =>
      ppLeft(s, id) > 0 &&
      !(s.volatile.has('torment') && id === s.lastMove && id !== null) &&
      !(s.disabled && s.disabled.id === id) &&
      !(id === GIGATON_HAMMER && s.lastMove === GIGATON_HAMMER),
  );
  if (!withPp.length) return STRUGGLE;
  const usable = withPp.filter((id) => {
    const m = moveOf(id);
    if (!m) return true;
    return !barred(s, tt.active, m) && !wasted(m, ut, tt, c);
  });
  const from = usable.length ? usable : withPp;
  const chart = matchupTable(tt.active.types);
  // A Flying type pulled down — Gravity, 떨어뜨리기 — is in reach of Ground moves, and the pick knows it.
  const foeTypes = tt.active.types;
  if (foeTypes.includes('flying') && onGround(tt.active, c.field)) {
    const rest = foeTypes.filter((x) => x !== 'flying');
    chart.set('ground', rest.length ? effectiveness('ground', rest) : 1);
  }
  // So does what the other side's ability drinks in or floats over: a move
  // into 저수 or at 부유 is as good as immune, and a player knows it.
  const o = tt.active;
  const soak: [MoveType, string[]][] = [
    ['water', ['water-absorb', 'storm-drain', 'dry-skin']],
    ['electric', ['volt-absorb', 'lightning-rod', 'motor-drive']],
    ['fire', ['flash-fire', 'well-baked-body']],
    ['grass', ['sap-sipper']],
    ['ground', ['earth-eater']],
  ];
  for (const [ty, abilities] of soak) if (abilities.some((a) => has(o, a, s))) chart.set(ty, 0);
  if (!onGround(o, c.field) && (has(o, 'levitate', s) || has(o, 'eelevate', s))) chart.set('ground', 0);
  if (has(o, 'wonder-guard', s)) for (const ty of TYPES) if ((chart.get(ty) ?? 1) <= 1) chart.set(ty, 0);
  const weights = from.map((id) => {
    const m = moveOf(id);
    const base = s.mon.kit.weight(id);
    if (m?.damageClass === 'status') return base;
    return base * chartWeight(chart.get(m?.type ?? 'normal') ?? 1, s.mon.kit.table);
  });
  const total = weights.reduce((a, w) => a + w, 0);
  return pickWeighted(from, weights, total, c.rng());
}

/** A turn record, started blank and filled in as the halves happen. */
function blankTurn(foeFirst: boolean, myPick: number | null, foePick: number | null, c: Ctx): BattleTurn {
  return {
    foeFirst,
    meActed: false,
    moveId: myPick,
    damage: 0,
    crit: false,
    missed: false,
    effect: 1,
    ailment: null,
    selfEffect: null,
    mySkip: null,
    mySelfHit: 0,
    myCured: null,
    myEvents: [],
    foeActed: false,
    foeMoveId: foePick,
    counter: 0,
    foeCrit: false,
    foeMissed: false,
    foeEffect: 1,
    foeAilment: null,
    foeSelfEffect: null,
    foeSkip: null,
    foeSelfHit: 0,
    foeCured: null,
    foeEvents: [],
    residual: 0,
    myResidual: 0,
    endEvents: [],
    field: fieldView(c),
    foeStatus: c.foe.active.status,
    myStatus: c.me.active.status,
    foeHpAfter: c.foe.active.hp,
    myHpAfter: c.me.active.hp,
  };
}

function writeHalf(rec: BattleTurn, mine: boolean, a: Action): void {
  if (mine) {
    rec.meActed = a.acted;
    if (a.acted) rec.moveId = a.moveId;
    rec.damage = a.damage;
    rec.crit = a.crit;
    rec.missed = a.missed;
    rec.effect = a.effect;
    rec.ailment = a.ailment;
    rec.selfEffect = a.selfEffect;
    rec.mySkip = a.skip;
    rec.mySelfHit = a.selfHit;
    rec.myCured = a.cured;
    rec.myEvents = a.events;
  } else {
    rec.foeActed = a.acted;
    if (a.acted) rec.foeMoveId = a.moveId;
    rec.counter = a.damage;
    rec.foeCrit = a.crit;
    rec.foeMissed = a.missed;
    rec.foeEffect = a.effect;
    rec.foeAilment = a.ailment;
    rec.foeSelfEffect = a.selfEffect;
    rec.foeSkip = a.skip;
    rec.foeSelfHit = a.selfHit;
    rec.foeCured = a.cured;
    rec.foeEvents = a.events;
  }
}

/** Close a record against whoever is out right now. */
function sealTurn(rec: BattleTurn, c: Ctx): BattleTurn {
  rec.field = fieldView(c);
  rec.foeStatus = c.foe.active.status;
  rec.myStatus = c.me.active.status;
  rec.foeHpAfter = c.foe.active.hp;
  rec.myHpAfter = c.me.active.hp;
  return rec;
}

/**
 * Play out a whole fight between two teams, turn by turn.
 *
 * Pure in its arguments and seeded on its own salt, so asking for the battle
 * cannot change which Pokemon was met — and the settled fight and the panel's
 * replay of it are the same fight.
 *
 * Both sides fight at level 50 from their base stats (see `battleStats`). Each
 * turn both pick a move; the higher priority goes first, then the faster —
 * the slower, under Trick Room. Whatever each side carries gets its say before
 * it moves, and the weather, the terrain and the screens get theirs at the end
 * of the turn.
 *
 * A fainted Pokemon is replaced at the end of the turn by the next of its team
 * still standing; a switch a move asks for (유턴, 울부짖기) happens on the
 * spot, and the turn carries on with whoever came in. Weather, terrain, hazards
 * and screens stay on the field through all of it, and so does everything on
 * the Pokemon that is still out. The record is cut into rounds, one per pair
 * of Pokemon facing each other.
 *
 * It ends when one side has nobody left, when a wild fight is fled, or when a
 * round runs into MAX_TURNS — which is nobody's win.
 *
 * ## The move is rolled, not rotated
 *
 * Rotating made 2000 encounters produce two distinct sequences. The pick leans
 * on the type chart instead (MATCHUP_WEIGHT), and a move that would just fail
 * — the opponent is already poisoned, the rain is already falling — is left
 * out of it.
 */
export function fightAt(seed: number, mine: readonly Fighter[], theirs: readonly Fighter[], wild = false): Fight {
  const rng = mulberry32(Math.imul(seed + 1, 0x27d4eb2d) ^ 0xc2b2ae35);
  // Whoever has no ability given is dealt one, hashed off the seed and its
  // place on the team — never drawn from `rng`, so the fight's own dice are
  // exactly the dice they were.
  const dealt = (fs: readonly Fighter[], side: number) =>
    fs.map((f, i) =>
      f.ability !== undefined || !f.speciesId ? f : { ...f, ability: abilityOf(f.speciesId, abilitySlotFor(seed * 16 + side * 8 + i, f.speciesId)) },
    );
  const team = (fs: readonly Fighter[], isWild: boolean): Team => {
    const mons = fs.map(monOf);
    for (const m of mons) if (m.status === 'sleep') m.sleepLeft = 1 + Math.floor(rng() * 3);
    const slot = Math.max(0, mons.findIndex((m) => m.hp > 0));
    return {
      mons,
      slot,
      active: sideOf(mons[slot]),
      screens: {},
      wish: null,
      healingWish: false,
      guard: null,
      hazards: {},
      future: null,
      wild: isWild,
      faintedOn: -1,
    };
  };
  const c: Ctx = {
    rng,
    field: {
      weather: null,
      terrain: null,
      trickRoom: 0,
      rooms: {},
      uproar: false,
      sports: {},
      fairyLock: 0,
      plasma: false,
      lastMove: null,
      lastThisTurn: null,
    },
    me: team(dealt(mine, 0), false),
    foe: team(dealt(theirs, 1), wild),
    wild,
    turn: 0,
    request: null,
  };

  const outerCtx = CTX;
  CTX = c;
  // Nobody came in mid-turn at the start; both are just there.
  c.me.active.justIn = false;
  c.foe.active.justIn = false;
  // Abilities as the two come out, the faster first.
  const opening: EndEvent[] = [];
  const firstOut = speedOf(c.foe.active, c.foe) > speedOf(c.me.active, c.me) ? [c.foe, c.me] : [c.me, c.foe];
  for (const t of firstOut) onEntry(t, c, opening);
  const rounds: Battle[] = [];
  const outFor: number[] = [];
  let round: Battle = openRound(c, opening);
  let end: Fight['end'] | null = null;

  /**
   * End the current round and open the next against whoever is out now.
   * `won` and `myStatus` are read BEFORE the switch, by the caller — by the
   * time this runs, the actives are the newcomers.
   */
  const closeRound = (exit: RoundExit, entry: EndEvent[], won: boolean, myStatus: Condition | null) => {
    round.exit = exit;
    round.won = won;
    round.myStatusAfter = myStatus;
    rounds.push(round);
    outFor.push(round.mySlot);
    round = openRound(c, entry);
  };

  const nextOf = (t: Team) => t.mons.findIndex((m, i) => i !== t.slot && m.hp > 0);

  for (let guard = 0; guard < MAX_TURNS * 12 && !end; guard++) {
    if (round.turns.length >= MAX_TURNS) {
      end = 'stall';
      break;
    }
    c.turn++;
    c.field.lastThisTurn = null;
    for (const s of [c.me.active, c.foe.active]) {
      s.protecting = false;
      s.enduring = false;
      s.flinched = false;
      s.wasHit = false;
      s.moved = false;
      s.rose = false;
      s.fell = false;
      s.took = { physical: 0, special: 0 };
    }
    // A side that owes a recharge does not get to choose.
    const myPick = c.me.active.recharge ? (c.me.active.lastMove ?? null) : choose(c.me, c.foe, c);
    const foePick = c.foe.active.recharge ? (c.foe.active.lastMove ?? null) : choose(c.foe, c.me, c);
    c.me.active.picked = myPick;
    c.foe.active.picked = foePick;
    // 부리캐논 heats up and 트랩셸 is set before anybody moves.
    for (const [s, pick] of [
      [c.me.active, myPick],
      [c.foe.active, foePick],
    ] as const) {
      s.beak = pick === BEAK_BLAST;
      s.shellTrap = pick === SHELL_TRAP;
    }

    const pri = (id: number | null, s: Side) => {
      const m = id === null || id === STRUGGLE ? null : moveOf(id);
      return m ? priorityOf(m, s, c.field) : 0;
    };
    const myPri = pri(myPick, c.me.active);
    const foePri = pri(foePick, c.foe.active);
    const mySpeed = speedOf(c.me.active, c.me);
    const foeSpeed = speedOf(c.foe.active, c.foe);
    const bracket = foePri === myPri ? bracketOrder(c.me.active, c.foe.active, myPick, foePick, rng) : null;
    const foeFirst =
      foePri !== myPri
        ? foePri > myPri
        : bracket !== null
          ? bracket
          : foeSpeed === mySpeed
            ? rng() < 0.5
            : c.field.trickRoom > 0
              ? foeSpeed < mySpeed
              : foeSpeed > mySpeed;

    let rec = blankTurn(foeFirst, myPick, foePick, c);
    const order: ['me' | 'foe', number | null][] = foeFirst ? [['foe', foePick], ['me', myPick]] : [['me', myPick], ['foe', foePick]];
    for (let h = 0; h < 2 && !end; h++) {
      const [who, pick] = order[h];
      const ut = who === 'me' ? c.me : c.foe;
      const tt = otherOf(c, ut);
      // Somebody who came in mid-turn does not get a move of their own.
      if (h === 1 && ut.active.moved === false && ut.active.picked !== pick) continue;
      const a = perform(ut, tt, pick, c, h === 0);
      writeHalf(rec, who === 'me', a);
      if (!c.request) continue;
      const req = c.request;
      c.request = null;
      if (req.kind === 'fled') {
        end = 'fled';
        break;
      }
      // Cut the turn here: this round ends, the next begins with the newcomer.
      round.turns.push(sealTurn(rec, c));
      const on = req.team === c.me ? 'me' : 'foe';
      const bench = benchOf(req.team);
      // Dragged out: a random one of the bench, as in the games. Leaving on
      // its own: the next in line — the order a trainer's team is written in.
      const slot = req.kind === 'forced' ? bench[Math.floor(rng() * bench.length)] : nextOf(req.team);
      const myStatus = c.me.active.status;
      const entry: EndEvent[] = [];
      sendOut(req.team, slot, on, c.field, entry, req.baton ? req.team.active : null, otherOf(c, req.team), req.shedTail ?? 0);
      const exit: RoundExit =
        on === 'me' ? (req.kind === 'forced' ? 'me-forced' : 'me-retreat') : req.kind === 'forced' ? 'foe-forced' : 'foe-retreat';
      closeRound(exit, entry, false, myStatus);
      // The newcomer did not pick anything; mark it as having moved so the
      // rest of this turn passes it by.
      req.team.active.picked = -1;
      rec = blankTurn(foeFirst, c.me.active.picked === -1 ? null : myPick, c.foe.active.picked === -1 ? null : foePick, c);
    }
    if (end) {
      round.turns.push(sealTurn(rec, c));
      break;
    }

    const after = endOfTurn(c, foeFirst);
    rec.residual = after.theirs;
    rec.myResidual = after.mine;
    rec.endEvents = after.end;
    round.turns.push(sealTurn(rec, c));

    // Faints are replaced once the turn is over.
    const meDown = c.me.active.hp <= 0;
    const foeDown = c.foe.active.hp <= 0;
    if (!meDown && !foeDown) continue;
    const myNext = meDown ? nextOf(c.me) : -1;
    const foeNext = foeDown ? nextOf(c.foe) : -1;
    if (meDown && myNext < 0) {
      end = 'lost';
      break;
    }
    if (foeDown && foeNext < 0) {
      end = 'won';
      break;
    }
    const entry: EndEvent[] = [];
    const exit: RoundExit = meDown && foeDown ? 'both-down' : meDown ? 'me-down' : 'foe-down';
    const myStatus = c.me.active.status;
    if (meDown) c.me.faintedOn = c.turn;
    if (foeDown) c.foe.faintedOn = c.turn;
    if (meDown) sendOut(c.me, myNext, 'me', c.field, entry, null, c.foe);
    if (foeDown) sendOut(c.foe, foeNext, 'foe', c.field, entry, null, c.me);
    closeRound(exit, entry, foeDown && !meDown, myStatus);
    // A newcomer knocked out by the hazards on arrival.
    if (c.me.active.hp <= 0 && nextOf(c.me) < 0) {
      end = 'lost';
      break;
    }
    if (c.foe.active.hp <= 0 && nextOf(c.foe) < 0) {
      end = 'won';
      break;
    }
  }

  // The last round was left open; close it with how the whole thing ended.
  if (round.turns.length || !rounds.length) {
    const exit: RoundExit =
      end === 'won' ? 'foe-down' : end === 'lost' ? (c.foe.active.hp <= 0 ? 'both-down' : 'me-down') : end === 'fled' ? 'fled' : 'stall';
    round.exit = exit;
    round.won = end === 'won';
    round.myStatusAfter = c.me.active.status;
    rounds.push(round);
    outFor.push(round.mySlot);
  }
  stow(c.me);
  stow(c.foe);
  CTX = outerCtx;
  const won = end === 'won';
  return {
    rounds,
    won,
    end: end ?? 'stall',
    hp: c.me.mons.map((m) => m.hp),
    status: c.me.mons.map((m) => m.status),
    outFor,
  };
}

/** A fresh round for whoever is out right now. */
function openRound(c: Ctx, entry: EndEvent[]): Battle {
  return {
    foeMaxHp: c.foe.active.maxHp,
    myMaxHp: c.me.active.maxHp,
    myStartHp: c.me.active.hp + entry.filter((e) => 'on' in e && e.on === 'me' && e.k === 'hazard-hit').reduce((a, e) => a + (e as { hp: number }).hp, 0),
    foeStartHp: c.foe.active.hp + entry.filter((e) => 'on' in e && e.on === 'foe' && e.k === 'hazard-hit').reduce((a, e) => a + (e as { hp: number }).hp, 0),
    mySlot: c.me.slot,
    foeSlot: c.foe.slot,
    entry,
    turns: [],
    exit: 'stall',
    won: false,
    myStatusAfter: c.me.active.status,
  };
}

/**
 * One Pokemon against one: a wild encounter, or a legendary.
 *
 * `fightAt` with a team of one on each side, which is always a single round.
 * `won` is the fight's, so a wild Pokemon blown away by 울부짖기 is no win.
 */
export function battleAt(
  seq: number,
  rarity: Rarity,
  moves: number[],
  foeSpeciesId?: number,
  opts: BattleOpts = {},
): Battle {
  const fight = fightAt(seq, [mineOf(moves, opts)], [foeOf(foeSpeciesId, rarity, opts.grit ?? 1, opts.foeMoves, opts.foeAbility)], true);
  const b = fight.rounds[0];
  return { ...b, won: fight.won };
}
