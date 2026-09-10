import fs from 'node:fs';
import path from 'node:path';
import { createScanner, scanAll, rollup, type CountMode } from './usage.ts';
import {
  accrue,
  advance,
  battleFormOf,
  calibrateHatchThreshold,
  formChances,
  displayIdOf,
  fusionsAvailable,
  lifetimeOf,
  mulberry32,
  progress,
  speciesIdOf,
  type GameEvent,
  type HuntEntry,
  type Rarity,
} from './game.ts';
import { ACHIEVEMENTS, CAT_KO, settleAchievements, tiersOf } from './achievements.ts';
import { legendItem } from './legenddata.ts';
import { LEGEND_GATES, SHARDS_PER_ITEM, itemKo, legendRow } from './legends.ts';
import { formById, formsFrom, type Form } from './forms.ts';
import { loadState, saveState } from './store.ts';
import type { BattleTurn as BattleTurnRaw } from './hunt.ts';
import {
  HUNT_INTERVAL_MS,
  MOVE_SLOTS,
  TACKLE,
  battleAt,
  formOpts,
  hunt,
  huntCap,
  moveMult,
  teachableNow,
} from './hunt.ts';
import { TYPE_KO, moveById, speciesInfo } from './moves.ts';
import { PRODUCTS, UNIQUE, owns, priceOf, wallet, type ItemId } from './shop.ts';
import { NAMES, NATURE_KO, speciesName } from './species.ts';
import {
  cacheStats,
  ensureBackground,
  ensureBadgeSprite,
  ensureEffect,
  ensureEggSprite,
  ensureItemSprite,
  ensureNpcSprite,
  ensureSprite,
  ensureStaticSprite,
} from './sprites.ts';
import { effectFor } from './movefx.ts';
import { biomeFor } from './biome.ts';
// Renderer-side module, imported for its data rather than its rendering: it is
// pure, DOM-free, and its only import is a type. server/hunt.ts already reaches
// across for src/josa.ts for the same reason.
import { generationOf, rarityOfSpecies } from './dex.ts';
import { trainerAt, trainerBattleAt } from './trainer.ts';
import {
  GYMS,
  LEAGUE,
  LEAGUE_CITY,
  encountersUntilStop,
  gymById,
  gymLocked,
  gymTrainer,
  leagueById,
  leagueRoundAt,
} from './gyms.ts';
import { PARTY_SIZE, assignable } from './party.ts';
import { shrinesOpen, stopFor } from './shrines.ts';
import { appDataDir } from './paths.ts';

/**
 * The single source of truth for the /api/state payload.
 *
 * The Vite dev server and the packaged Electron main process both serve this
 * shape. They used to hold two hand-copied builders, which silently drifted the
 * moment a field was added to one of them — so it lives here once.
 */
/**
 * How long a built payload may be served from cache.
 *
 * Both surfaces — the Vite middleware and the Electron main process — hold the
 * same cache, and this number used to be typed out in each of them. It is the
 * cache TTL, not a poll interval: a renderer that has just become visible asks
 * on demand and must not get a stale answer.
 */
export const REFRESH_MS = 20_000;

/**
 * Who stands behind the shop counter.
 *
 * A Showdown trainer sprite, picked by eye from the handful that read as
 * counter staff: `waitress` is mid-greeting with one hand raised, which is the
 * pose the opening line wants. (`clerk`, despite the name, is Black/White's
 * office-worker trainer class in a suit — not a shopkeeper.)
 */
const CLERK = 'waitress';

/**
 * Escape hatch back to a full rescan on every tick.
 *
 * A marker file rather than only an env var: server/paths.ts already records
 * that a GUI app launched from Finder or Explorer does not inherit shell
 * environment, so an env var alone is unreachable in the packaged app. The
 * file sits in the folder the tray's "데이터 폴더 열기" item already opens, so
 * a user can roll back without a rebuild.
 */
const FULL_SCAN =
  process.env.PTP_FULL_SCAN === '1' || fs.existsSync(path.join(appDataDir(), 'full-scan'));

/**
 * Whether now is a good moment for a full rebuild.
 *
 * A hook rather than a direct check, because the answer is host-specific:
 * Electron can ask `powerMonitor` how long the machine has been idle, and this
 * module must not import it. Unset — the browser build, the tests, the
 * generator scripts — means "always fine", which is the old behaviour.
 */
let quietEnough: (() => boolean) | undefined;

/** Called once by the host at startup. See `canReconcile` in usage.ts. */
export function setReconcileGate(fn: () => boolean) {
  quietEnough = fn;
}

/**
 * One scanner for the process.
 *
 * It holds the record map and the per-file cursors between ticks — that
 * retention IS the optimisation, so it must not be recreated per call.
 *
 * The gate is read through `quietEnough` on every call rather than captured, so
 * the host can install it after this module is first imported.
 */
const scanner = createScanner(undefined, undefined, {
  canReconcile: () => !quietEnough || quietEnough(),
});

export async function buildState(mode: CountMode = 'activity') {
  const records = FULL_SCAN ? await scanAll() : await scanner.scan();
  const roll = rollup(records.values(), mode);

  let state = await loadState();
  let dirty = false;

  // A genuinely fresh install — not a migrated save, which arrives with an
  // empty anchor but a rebuilt lifetimeEarned. Size the hatch threshold to how
  // much this user actually burns before the first egg starts counting.
  if (state.lastTotal[mode] == null && state.lifetimeEarned === 0) {
    state = { ...state, hatchThreshold: calibrateHatchThreshold(roll.byDay), eggStartedAt: 0 };
    dirty = true;
  }

  const accrued = accrue(state, roll.totalTokens, mode);
  if (accrued.changed) dirty = true;
  state = accrued.state;

  // Settle hunting BEFORE advance, so a companion that crosses a threshold on
  // hunted tokens evolves in the same pass. The other order would pin the bar
  // at 100% for a whole 20s cache window first.
  //
  // Two consequences, both deliberate: a companion that evolves this tick did
  // its hunting with the moveset it had BEFORE evolving, and a companion that
  // graduates this tick donates its last encounters to the next egg.
  const hunted = hunt(state, Date.now());
  if (hunted.changed) dirty = true;
  state = hunted.state;

  const earned = state.lifetimeEarned;
  // Item-granted and hunted progress ride on top of earned tokens; the wallet
  // is separate. One definition, in game.ts — see lifetimeOf.
  const lifetimeTokens = lifetimeOf(state);
  const rng = mulberry32(Math.floor(lifetimeTokens) ^ 0x9e3779b9);
  const advanced = advance(state, lifetimeTokens, rng);
  let events: GameEvent[] = advanced.events;
  if (events.length) dirty = true;
  state = advanced.state;

  /**
   * Achievements, last and in one place.
   *
   * This is the only point in the tick where everything an achievement can key
   * on is settled at once — `hunt` has just booked the encounters and `advance`
   * has just filed anything that graduated — and it is still upstream of the
   * single save below. Pure and idempotent, so the identity check is enough to
   * know whether anything actually unlocked.
   */
  const settled = settleAchievements(state, Date.now());
  if (settled !== state) {
    dirty = true;
    state = settled;
  }

  if (dirty) await saveState(state);

  const active = state.active;
  const speciesId = active ? speciesIdOf(active) : null;
  /**
   * What is DRAWN, as opposed to what the companion IS.
   *
   * The two differ only when fused. Everything the dex, the rarity ladder, the
   * learnset and the encounter roll touch keeps using `speciesId`; the sprite,
   * the name and the types below follow `displayId`.
   */
  const displayId = active ? displayIdOf(active) : null;
  const activeForm = active?.formId !== undefined ? formById(active.formId) : null;
  /** What it would turn into in a fight right now. Null when nothing would. */
  const battleForm = battleFormOf(state);
  /**
   * The stones this companion could actually use, for the bag to highlight.
   *
   * Read off `formsFrom` rather than off `battleForm`, because the point is to
   * show a usable stone even while the key stone is off — that is precisely the
   * moment someone needs telling that they have one.
   */
  const usableStones = new Set(
    displayId === null ? [] : formsFrom(displayId).filter((f) => f.kind === 'mega').map((f) => f.id),
  );

  // Resolve moves here rather than shipping the 340-move table to the renderer:
  // server/moves.ts is 91KB and src/ never imports it.
  const describeMove = (id: number) => {
    const m = moveById(id);
    if (!m) return null;
    return {
      id: m.id,
      name: m.ko,
      nameEn: m.en,
      type: m.type,
      typeName: TYPE_KO[m.type],
      power: m.power,
      accuracy: m.accuracy,
      pp: m.pp,
      damageClass: m.damageClass,
    };
  };
  const teachable = teachableNow(state);
  const heldTms = Object.keys(state.tms)
    .map(Number)
    .filter((id) => (state.tms[id] ?? 0) > 0);
  const withIcon = async (id: number) => {
    const m = describeMove(id);
    if (!m) return null;
    // Only the types actually held get fetched — asking for all eighteen would
    // add eighteen cold round trips to the first payload.
    return { ...m, sprite: await ensureItemSprite(`tm-${m.type}`) };
  };
  /** Drop anything the generated table no longer knows, so the UI never sees null. */
  const known = <T,>(xs: (T | null)[]): T[] => xs.filter((x): x is T => x !== null);
  /**
   * Which id the panel and the floating pet draw.
   *
   * `showBattleForm` is the only decoration switch in the app: a mega lasts ten
   * seconds of every five minutes, and the floating pet is what is actually
   * looked at, so this lets someone see what they unlocked. It changes no rule
   * — `battleFormOf` is consulted again, honestly, when a fight is settled.
   */
  const shownId =
    state.showBattleForm && battleForm ? battleForm.id : displayId;
  const sprite = shownId ? await ensureSprite(shownId, active!.isShiny) : null;
  // The battle scene shows the companion from behind, as the games do.
  const backSprite = shownId ? await ensureSprite(shownId, active!.isShiny, true) : null;
  const eggSprite = active ? null : await ensureEggSprite();
  /**
   * The egg picture, whether or not one is currently hatching.
   *
   * `eggSprite` above is null while a companion is out — the scene has nothing
   * to draw. The shop still sells four eggs and needs the picture for their
   * rows, so it is resolved separately. Same cached file either way, so the
   * second call is an access() and no download.
   */
  const eggIcon = eggSprite ?? (await ensureEggSprite());
  /**
   * Whoever is behind the counter.
   *
   * Resolved on every build rather than only for the shop tab: the payload has
   * no idea which tab is open, and this is one 789-byte file fetched once,
   * ever. Null until it lands, which the counter renders as an empty counter.
   */
  const clerk = await ensureNpcSprite(CLERK);


  /**
   * Only the newest encounter gets its ANIMATED sprite resolved.
   *
   * Resolving all twenty log entries would download twenty animated species per
   * encounter — 42KB each for the BW GIFs, 82KB for the Showdown ones — and one
   * keeps it at exactly one, which is also all the scene animates. Same rule
   * covers `formSprite`, `trainerFight` and `battleBg`: those are all art the
   * battle screen plays, and only the newest entry ever draws a battle screen.
   *
   * The log's row ICONS are the deliberate exception, and they are a different
   * kind of thing: `ensureStaticSprite` fetches the flat 96x96 PNG, which
   * averages 1.7KB — a twenty-fifth of a BW GIF. Twenty of those is 34KB
   * against a cache already holding 34MB, so the size argument this comment
   * makes simply does not reach them.
   */
  const newestSeq = state.huntLog[0]?.seq ?? null;

  /**
   * The blow-by-blow, for the newest encounter only.
   *
   * Derived, never stored: it is a pure function of the encounter index, the
   * opponent's rarity and the moveset, so replaying it costs nothing and
   * bloating HuntEntry with a turn list would need another schema bump.
   */
  /**
   * Both halves of every exchange, named.
   *
   * `moveId` and `foeMoveId` are both "null means the plain fallback swing", so
   * one helper resolves either side. The renderer never imports server/moves.ts
   * — see describeMove above — so the names have to be attached here.
   */
  const nameOf = (id: number | null) =>
    id === null ? TACKLE.name : (moveById(id)?.ko ?? TACKLE.name);
  const typeOf = (id: number | null) =>
    id === null ? 'normal' : (moveById(id)?.type ?? 'normal');
  // Physical lands ON the target, special travels TO it, status stays home.
  // That is the grammar the games use, and one lookup is what it costs.
  const classOf = (id: number | null) =>
    id === null ? 'physical' : (moveById(id)?.damageClass ?? 'physical');

  /**
   * What a landed ailment is called on screen.
   *
   * Whole clauses rather than nouns: Korean needs a different particle after
   * each one and the scene has no room to assemble them. Anything not listed —
   * the vocabulary is generated, so it can grow — gets the neutral line, which
   * is still better than saying nothing happened.
   */
  const AILMENT_KO: Record<string, string> = {
    paralysis: '몸이 저려 잘 움직이지 못한다!',
    poison: '독에 걸렸다!',
    burn: '화상을 입었다!',
    freeze: '얼어붙었다!',
    confusion: '혼란에 빠졌다!',
    trap: '옭아매였다!',
    nightmare: '악몽에 시달리고 있다!',
    infatuation: '헤롱헤롱해졌다!',
    torment: '도발에 넘어갔다!',
    silence: '기술이 봉인됐다!',
    embargo: '도구를 쓸 수 없게 됐다!',
  };
  const ailmentKo = (a: string | null) => (a === null ? null : (AILMENT_KO[a] ?? '상태가 이상해졌다!'));

  /**
   * The plate badge, which is a different job from the sentence above.
   *
   * One or two characters, because it sits on a 152px plate beside an HP bar —
   * the games use a three-letter abbreviation (PSN, BRN, PAR) for exactly this
   * reason. A status with no label here simply gets no badge, which is how the
   * "volatile conditions are not indicated by an icon" rule is enforced; hunt.ts
   * already filters to the non-volatile five, and this is the second gate.
   */
  const STATUS_BADGE: Record<string, string> = {
    poison: '독',
    burn: '화상',
    paralysis: '마비',
    freeze: '얼음',
    sleep: '잠듦',
  };
  const badgeKo = (a: string | null) => (a === null ? null : (STATUS_BADGE[a] ?? null));

  const dressTurns = (b: { foeMaxHp: number; myMaxHp: number; turns: BattleTurnRaw[] }) => ({
    foeMaxHp: b.foeMaxHp,
    myMaxHp: b.myMaxHp,
    turns: b.turns.map((t) => ({
      ...t,
      moveName: nameOf(t.moveId),
      moveType: typeOf(t.moveId),
      moveClass: classOf(t.moveId),
      foeMoveName: nameOf(t.foeMoveId),
      foeMoveType: typeOf(t.foeMoveId),
      foeMoveClass: classOf(t.foeMoveId),
      ailmentKo: ailmentKo(t.ailment),
      foeAilmentKo: ailmentKo(t.foeAilment),
      foeStatusKo: badgeKo(t.foeStatus),
      myStatusKo: badgeKo(t.myStatus),
    })),
  });

  /**
   * A trainer fight, resolved for the panel.
   *
   * One round per team member, each a full battle. Sprites for the whole team,
   * because the scene shows them one after another — the same "newest entry
   * only" rule the wild sprite follows keeps this to one encounter's worth.
   *
   * `saved` is what the entry recorded when the encounter actually settled, and
   * it is here as a tripwire. `trainerAt` is pure in the class and name tables
   * as well as in `seq` (see its comment), so an update that adds a class
   * re-rolls who stood at every past index — and this is the one entry old
   * enough to notice, because it is the only one that gets replayed. Rather
   * than narrate a fight that did not happen, drop the animation for it: the
   * log row still says who it was and whether it was won, from the record.
   * Happens at most once, immediately after such an update.
   */
  const trainerFor = async (
    seq: number,
    form: Form | null,
    saved: { name: string },
    gym?: HuntEntry['gym'],
  ) => {
    /**
     * A gym leader is looked up by the id the entry RECORDED, never re-derived
     * from `seq`.
     *
     * For a route trainer that is a preference; here it is correctness.
     * `gymAt` reads the badge count, and the badge count changes inside the
     * very range `hunt()` replays — so "who was standing at seq 78" has no
     * answer that does not also name which badges were held at the time. The
     * record has it; the function does not.
     *
     * The name tripwire below still applies. For a gym it guards the table
     * rather than the roll: renaming a leader drops one replay instead of
     * narrating a fight against somebody else.
     */
    const row = gym ? gymById(gym.id) : null;
    const t = gym ? (row ? gymTrainer(row) : null) : trainerAt(seq);
    if (!t || !active || t.name !== saved.name) return null;
    const fight = trainerBattleAt(seq, t, active.moves, speciesId ?? undefined, formOpts(form, activeForm));
    return {
      name: t.name,
      won: fight.won,
      lostAt: fight.lostAt,
      /**
       * The badge this fight handed over, or null.
       *
       * Read off the RECORD rather than off the leader, because a rematch
       * hands over nothing and the row still has a badge number. Resolved
       * here for the same reason `nature` is: the renderer never looks
       * anything up.
       */
      badgeKo: gym?.badge ? (row?.badgeKo ?? null) : null,
      badgeSprite: gym?.badge ? await ensureBadgeSprite(gym.badge) : null,
      prizeKo: gym?.prize ? (moveById(gym.prize)?.ko ?? null) : null,
      /** The class portrait for the challenge beat. Null while it downloads. */
      sprite: await ensureNpcSprite(t.sprite),
      team: await Promise.all(
        t.team.map(async (id) => ({
          speciesId: id,
          name: speciesName(id),
          sprite: await ensureSprite(id),
        })),
      ),
      rounds: fight.rounds.map(dressTurns),
      /**
       * Which of MY side stood for each round.
       *
       * Always null here: a route trainer and a gym leader are both fought by
       * the one companion, whose art the scene already has. Present so the two
       * resolvers hand back the same shape and `SceneTrainerFight` needs no
       * union — the league is the only fight where my side changes mid-battle.
       */
      mine: null as { speciesId: number; name: string; sprite: string | null }[] | null,
    };
  };

  /**
   * One Elite Four encounter, replayed for the panel.
   *
   * Re-runs the fight rather than storing its turns, which is the bargain
   * every other battle here makes — and needs two things the entry records for
   * exactly this reason: the six bars it started from, and the six species
   * that were fielded. If the party has been rebuilt since, the second one no
   * longer matches and the animation is dropped rather than narrating somebody
   * else's fight. The log row still says who it was and how it went.
   *
   * The MOVES are read live, so re-arming a member between the fight and the
   * replay shifts it. That is the same latitude `trainerFor` gives the
   * companion's own moveset, and for the same reason: nothing records them.
   */
  const leagueFor = async (seq: number, saved: NonNullable<HuntEntry['league']>) => {
    const member = leagueById(saved.id);
    const party = state.party ?? [];
    if (!member) return null;
    if (party.length !== saved.team.length) return null;
    if (!party.every((m, i) => m.speciesId === saved.team[i])) return null;
    const fight = leagueRoundAt(seq, member, party, saved.hp);
    return {
      name: member.ko,
      won: fight.won,
      lostAt: fight.won ? null : fight.rounds.length - 1,
      sprite: await ensureNpcSprite(member.sprite),
      team: await Promise.all(
        member.team.map(async (id) => ({
          speciesId: id,
          name: speciesName(id),
          sprite: await ensureSprite(id),
        })),
      ),
      rounds: fight.rounds.map(dressTurns),
      /** Which of my six stood for each round, so the scene can swap art. */
      mine: await Promise.all(
        fight.outFor.map(async (i) => ({
          speciesId: party[i].speciesId,
          name: speciesName(party[i].speciesId),
          sprite: await ensureSprite(party[i].speciesId, party[i].shiny, true),
        })),
      ),
      badgeKo: null,
      badgeSprite: null,
      prizeKo: null,
    };
  };

  // Same dressing as a trainer round. It used to be a second copy of the map
  // body, which is how the two paths drift the moment a field is added.
  const battleFor = (seq: number, rarity: Rarity, wildId: number, form: Form | null) =>
    dressTurns(
      battleAt(seq, rarity, active?.moves ?? [], wildId, {
        mySpeciesId: speciesId ?? undefined,
        // The battle form comes from the LOG entry, not from the bag: a key
        // stone taken off tomorrow must not rewrite the fight being replayed
        // from yesterday. The worn form is read live, exactly as `mySpeciesId`
        // above already is.
        ...formOpts(form, activeForm),
      }),
    );

  /** Where the pet is, with any shut legendary room passed over. */
  const here = stopFor(state.huntCount, state);

  const payload = {
    tokens: {
      total: roll.totalTokens,
      today: roll.today,
      todayMessages: roll.todayMessages,
      messageCount: roll.messageCount,
      lifetime: lifetimeTokens,
      byDay: roll.byDay,
      byEntrypoint: roll.byEntrypoint,
      byModel: roll.byModel,
      mode,
    },
    companion: active
      ? {
          speciesId,
          /** The id actually drawn — a form id when fused. Never used for lookups. */
          displayId,
          name: activeForm?.ko ?? speciesName(speciesId!),
          nameEn: activeForm?.en ?? speciesName(speciesId!, 'en'),
          stageIndex: active.stageIndex,
          stageCount: active.pathIds.length,
          isShiny: active.isShiny,
          rarity: active.rarity,
          // Resolved here for the same reason speciesName is: the renderer never
          // imports the generated table. Falls back to the slug if the table
          // ever loses one, so the row is never blank.
          nature: NATURE_KO[active.nature] ?? active.nature,
          nickname: active.nickname ?? null,
          sprite,
          backSprite,
          // Resolved here, like speciesName — the renderer never imports the
          // 135KB generated table.
          // A fused Kyurem really is a different type chart, so the badges follow
          // the form. `genus` does not: forms have none upstream, and the base
          // one ("경계포켓몬") is still true of the fused shape.
          types: (activeForm?.types ?? speciesInfo(speciesId!)?.types ?? []).map((t) => ({
            id: t,
            name: TYPE_KO[t],
          })),
          genus: speciesInfo(speciesId!)?.genus ?? '',
          heightM: activeForm?.heightM ?? speciesInfo(speciesId!)?.heightM ?? 0,
          weightKg: activeForm?.weightKg ?? speciesInfo(speciesId!)?.weightKg ?? 0,
          /** Progress burned since this companion hatched. */
          withYou: Math.max(0, lifetimeTokens - active.bornAt),
          path: active.pathIds.map((id) => ({ id, name: speciesName(id) })),
          /** The permanent form it is wearing, if any. */
          form: activeForm && { id: activeForm.id, kind: activeForm.kind, ko: activeForm.ko },
          /** Fusions the dex makes possible right now. The bag turns these into buttons. */
          fusions: await Promise.all(
            fusionsAvailable(state).map(async (f) => ({
              id: f.id,
              ko: f.ko,
              partner: f.partner!,
              partnerKo: speciesName(f.partner!),
              sprite: await ensureSprite(f.id, active.isShiny),
            })),
          ),
          /**
           * Every battle form this species could reach, and what is still
           * missing for each.
           *
           * `battleForm` below only exists once everything is satisfied, which
           * meant the panel said nothing at exactly the moment it had something
           * worth saying. This is the "why not yet" half.
           */
          forms: formChances(state).map((c) => ({
            id: c.form.id,
            kind: c.form.kind,
            ko: c.form.ko,
            stone: c.stone,
            item: c.item,
            ready: c.ready,
          })),
          /**
           * What it becomes in a fight, resolved now so the panel can say so
           * before one happens. Null when nothing would.
           */
          battleForm: battleForm && {
            id: battleForm.id,
            kind: battleForm.kind,
            ko: battleForm.ko,
            sprite: await ensureSprite(battleForm.id, active.isShiny),
          },
        }
      : null,
    eggSprite,
    progress: progress(state, lifetimeTokens),
    hunt: {
      enabled: state.huntEnabled,
      tokens: state.huntTokens,
      /**
       * Null when the ceiling is off — huntCap returns Infinity there and JSON
       * turns that into null anyway, so this says it deliberately rather than
       * letting a serialiser quirk carry the meaning.
       */
      cap: state.huntUncapped ? null : huntCap(state),
      uncapped: state.huntUncapped,
      count: state.huntCount,
      /**
       * The same two figures, but only what THIS companion brought in.
       *
       * The partner tab reads these; everything else keeps reading the lifetime
       * pair above, and must — the journey stop, the encounter replay cursor,
       * the share cap and seven travel achievements are all keyed on it.
       *
       * Zero when there is no companion, which is the honest answer for an egg.
       */
      sinceBirth: {
        tokens: Math.max(0, state.huntTokens - (active?.huntTokensAtBirth ?? state.huntTokens)),
        count: Math.max(0, state.huntCount - (active?.huntCountAtBirth ?? state.huntCount)),
      },
      /**
       * The backdrop hung at the horizon of the travelling scene, or null.
       *
       * Where the pet IS, which is why it is derived from the same count the
       * caption is: src/journey.ts turns the count into a stop and the stop
       * carries its own `sky`. The battle screen's `battleBg` below answers a
       * different question (what did I just run into) off a different input
       * (the foe's type) — see server/biome.ts on why those stay apart.
       *
       * Resolved here rather than in the renderer because the renderer can only
       * READ the sprite cache; something has to ask for the download, and this
       * is the same one line battleBg already is.
       *
       * Null when the stop names no backdrop or the download has not landed,
       * and both mean the same thing on screen: the flat sky colour the scene
       * had before this existed.
       */
      /**
       * Where the pet is, resolved ONCE and sent down.
       *
       * `journeyFor` is a pure function of the count, but a shut shrine is a
       * function of the save — so the answer stops being something the
       * renderer can work out on its own, and it should not have to. The
       * caption, the backdrop and the ground now all read this one stop.
       */
      stop: here,
      /** How many of the legendary rooms this save has opened. */
      shrines: shrinesOpen(state),
      skylineBg: await ensureBackground(here.sky),
      intervalMs: HUNT_INTERVAL_MS,
      slots: MOVE_SLOTS,
      /** ms until the next encounter settles, or null when not hunting. */
      nextInMs:
        state.huntedAt === null
          ? null
          : Math.max(0, state.huntedAt + HUNT_INTERVAL_MS - Date.now()),
      speed: moveMult(active?.moves ?? []),
      /** Why hunting is idle right now, for the panel to explain itself. */
      idleReason: !state.huntEnabled
        ? ('off' as const)
        : state.everstone
          ? ('everstone' as const)
          : !active
            ? ('egg' as const)
            : null,
      log: await Promise.all(
        state.huntLog.map(async (e) => {
          // Resolved from the entry so the row says what happened, not what the
          // bag would do now. Both are null on every pre-existing entry.
          const form = e.form ? formById(e.form.id) : null;
          const stone = e.stoneId !== undefined ? formById(e.stoneId)?.stone : undefined;
          return {
          ...e,
          wildName: speciesName(e.wildId),
          moveName: e.moveId === null ? null : (moveById(e.moveId)?.ko ?? null),
          /** The mega stone this encounter left behind, ready to print. */
          stoneKo: stone?.ko ?? null,
          stoneSprite: stone?.sprite ? await ensureItemSprite(stone.sprite) : null,
          /** The form worn for this fight, and the back view the scene swaps in. */
          formKo: form?.ko ?? null,
          formKind: form?.kind ?? null,
          formSprite: form && e.seq === newestSeq ? await ensureSprite(form.id, !!active?.isShiny) : null,
          formBackSprite:
            form && e.seq === newestSeq ? await ensureSprite(form.id, !!active?.isShiny, true) : null,
          wildSprite: e.seq === newestSeq ? await ensureSprite(e.wildId) : null,
          /**
           * The row's thumbnail, for EVERY entry — see the newestSeq note above
           * for why this one is not held to that rule.
           *
           * Static rather than animated on purpose: the row wants a still frame
           * at a predictable canvas size, which is the same thing the tray
           * wanted when `ensureStaticSprite` was written. 96x96 always, so the
           * panel can size it without measuring.
           */
          icon: await ensureStaticSprite(e.wildId),
          /** The trainer fight, newest entry only — same rule as wildSprite. */
          trainerFight:
            e.seq !== newestSeq ? null
            : e.league ? await leagueFor(e.seq, e.league)
            : e.trainer ? await trainerFor(e.seq, form, e.trainer, e.gym)
            : null,
          /**
           * The backdrop this fight happens on, newest entry only — the older
           * entries are list rows that never draw a battle screen.
           *
           * Null when the download has not landed yet, which the scene renders
           * as the plain gradient it always used.
           */
          battleBg:
            e.seq === newestSeq
              ? await ensureBackground(biomeFor(speciesInfo(e.wildId)?.types ?? []))
              : null,
          battle:
            e.seq === newestSeq && speciesId !== null && !e.trainer && !e.legend
              ? // Rarity is not stored on the log entry, but the species IS, and
                // reading it from `wildId` is both cheaper and safer than
                // replaying `encounterAt`: a legendary gate can substitute what
                // an encounter shows, so a replay would narrate a fight against
                // a different Pokemon than the row it sits under.
                battleFor(
                  e.seq,
                  rarityOfSpecies(e.wildId),
                  e.wildId,
                  form,
                )
              : null,
          };
        }),
      ),
    },
    moves: known(await Promise.all((active?.moves ?? []).map(withIcon))),
    tms: known(
      await Promise.all(
        teachable.map(async (id) => {
          const m = await withIcon(id);
          return m && { ...m, count: state.tms[id] ?? 0 };
        }),
      ),
    ),
    /** Held TMs this companion cannot use, so the bag can say why. */
    unusableTmCount: heldTms.filter((id) => !teachable.includes(id)).length,
    /**
     * Collected entries, resolved for the panel.
     *
     * Rarity, generation and types all come from generated tables the renderer
     * is not allowed to import, so they are unfolded here — same rule as the
     * companion block above.
     *
     * Sprites are cheap in steady state: the dex grows one graduation at a time
     * and `ensureSprite` is a single access() once the file is on disk. Only
     * COLLECTED entries get one — an unseen slot has nothing to show, so the
     * "include unseen" toggle costs no downloads.
     */
    dex: await Promise.all(
      state.dex.map(async (d) => {
        /**
         * The shape it left as, if it was fused.
         *
         * Only the PICTURE and the NAME follow it. Rarity, generation, the type
         * filter and the collection count all stay on the base species, because
         * every one of them assumes an id in 1..1025 — putting 10022 into that
         * list is the expensive mistake this whole design avoids. Same thought
         * as the nickname: the card shows the individual that actually left.
         */
        const form = d.formId !== undefined ? formById(d.formId) : null;
        return {
          ...d,
          name: form?.ko ?? speciesName(d.speciesId),
          sprite: await ensureSprite(form?.id ?? d.speciesId, d.shiny),
          rarity: rarityOfSpecies(d.speciesId),
          generation: generationOf(d.speciesId),
          types: (speciesInfo(d.speciesId)?.types ?? []).map((t) => ({ id: t, name: TYPE_KO[t] })),
        };
      }),
    ),
    // Derived from the species table rather than a literal, so the Dex tab's
    // denominator cannot drift away from what is actually raisable.
    dexTotal: Object.keys(NAMES).length,
    retiredCount: state.retiredCount,
    hatchThreshold: state.hatchThreshold,
    shop: {
      wallet: wallet(state, earned),
      /** The clerk sprite, or null while it is still downloading. */
      clerk,
      products: await Promise.all(
        PRODUCTS.map(async (p) => ({
          id: p.id,
          name: p.name,
          desc: p.desc,
          kind: p.kind,
          /** Which shelf it sits on. The panel groups by this. */
          group: p.group,
          /**
           * Earned rather than sold.
           *
           * Still shipped, because the bag looks names, descriptions and icons
           * up in this list — it just never reaches a shelf. The panel filters
           * on this rather than on a hardcoded id list.
           */
          award: p.award ?? false,
          /** Null for items. Lets the shop rank the four eggs at a glance. */
          rarity: p.rarity,
          /**
           * Passed the whole state, not just the threshold: the Rare Candy is
           * priced off the CURRENT milestone, so its price moves as the partner
           * grows. Everything else ignores the rest of the state.
           */
          price: priceOf(p, state),
          /**
           * Already in the bag, for the products that only need owning once.
           *
           * Decided here rather than in the panel: the renderer would have to
           * re-derive which products sell only once, and two copies of a rule is
           * how the shop ends up selling something `buy` will refuse.
           *
           * UNIQUE, not PASSIVE — the Everstone joined the sell-once rule
           * without joining the no-button-in-the-bag one, and reading the wrong
           * set here is precisely the drift this comment warns about.
           */
          owned: UNIQUE.has(p.id as ItemId) && owns(state, p.id),
          // Eggs have no item icon upstream and used to fall back to an emoji,
          // which put one web-form row in the middle of a game counter. The
          // real egg sprite is already cached for the scene; use it.
          sprite: p.sprite ? await ensureItemSprite(p.sprite) : p.kind === 'egg' ? eggIcon : null,
        })),
      ),
    },
    bag: {
      inventory: state.inventory,
      everstone: state.everstone,
      showBattleForm: state.showBattleForm ?? false,
      shinyCharmActive: state.shinyCharmActive,
      forcedRarity: state.forcedRarity,
      /**
       * The mega stone collection.
       *
       * `usable` is what makes this list readable: a hundred stones sorted by
       * id is a wall, and the one that matters is the one this companion can
       * actually use. Icons are resolved only for stones actually held, so the
       * shelf costs nothing until it has something on it.
       */
      stones: await Promise.all(
        Object.entries(state.stones ?? {})
          .filter(([, n]) => (n ?? 0) > 0)
          .map(async ([id, count]) => {
            const form = formById(Number(id));
            return {
              id: Number(id),
              ko: form?.stone?.ko ?? `#${id}`,
              formKo: form?.ko ?? `#${id}`,
              count,
              usable: usableStones.has(Number(id)),
              sprite: form?.stone?.sprite ? await ensureItemSprite(form.stone.sprite) : null,
            };
          }),
      ),
    },
    /**
     * The achievement board.
     *
     * The whole table every tick, locked rows included. Twenty-eight rows of
     * short strings is nothing next to the hunt log beside it, so this needs
     * none of the out-of-band treatment the dex index gets — that split exists
     * because the dex catalogue is 116KB, and this is not.
     *
     * `have`/`need` come from the same `metric` the unlock test uses, so the
     * gauge on screen cannot disagree with whether the row is lit.
     */
    awards: await Promise.all(
      ACHIEVEMENTS.map(async (a) => {
        const { have, need } = a.metric(state);
        const item = a.item ? PRODUCTS.find((p) => p.id === a.item) : null;
        const tiers = a.repeat ? tiersOf(a, state) : null;
        /** How far into the CURRENT goal. For a repeat that is the tier, not the total. */
        const target = tiers ? tiers.next : need;
        const from = tiers ? tiers.times * need : 0;
        return {
          id: a.id,
          cat: a.cat,
          catKo: CAT_KO[a.cat],
          ko: a.ko,
          desc: a.desc,
          have,
          /** The number to reach next — the tier boundary for a repeating row. */
          need: target,
          /**
           * The gauge, 0..1, worked out here rather than in the panel.
           *
           * A repeating row's bar measures progress INSIDE the current tier, so
           * `have / need` would be wrong for it — 87 wins against a next-target
           * of 100 is 48% of the way from 75, not 87%. Computing it once, beside
           * the numbers it must agree with, is what keeps the bar and the row
           * from telling different stories.
           */
          ratio: target > from ? Math.min(1, Math.max(0, (have - from) / (target - from))) : 1,
          /** Unlocked at, in ms. Null is the whole locked/unlocked signal. */
          at: state.achievements?.[a.id] ?? null,
          /** Repeating rows only: the step, and how many times it has paid. */
          repeat: a.repeat ? need : null,
          times: tiers?.times ?? 0,
          money: Math.round(a.money * state.hatchThreshold),
          itemKo: item?.name ?? null,
          itemSprite: item?.sprite ? await ensureItemSprite(item.sprite) : null,
        };
      }),
    ),
    /**
     * The legendaries.
     *
     * The whole gate table every tick — ninety-four short rows, which is
     * nothing next to the hunt log beside it. `open` is what the hunt loop
     * actually uses; `have`/`need` are the same numbers the gate itself tests,
     * so the gauge on screen cannot disagree with whether the row is open.
     */
    /**
     * The league party.
     *
     * Its moves are unfolded here like every other name in this payload, and
     * what MAY be assigned is sent as two id lists rather than six more move
     * tables: `canTake` joins against `payload.tms`, which the bag already
     * carries in full, and `free` is the handful the dex records for that
     * species and is therefore not in the bag at all. Six copies of a 47-row
     * machine list, every twenty seconds, is the shape this avoids.
     */
    party: {
      size: PARTY_SIZE,
      ready: (state.party ?? []).length === PARTY_SIZE,
      cityKo: LEAGUE_CITY,
      members: await Promise.all(
        (state.party ?? []).map(async (m) => {
          const options = assignable(state, (state.party ?? []).indexOf(m));
          return {
            speciesId: m.speciesId,
            name: speciesName(m.speciesId),
            shiny: m.shiny,
            sprite: await ensureSprite(m.formId ?? m.speciesId, m.shiny),
            moves: known(m.moves.map((id) => describeMove(id))),
            /** Machines in the bag this one could be taught. */
            canTake: options.filter((o) => o.from === 'bag').map((o) => o.moveId),
            /** Already known by the species, so free — and named, since the bag may not hold it. */
            free: known(options.filter((o) => o.from === 'dex').map((o) => describeMove(o.moveId))),
          };
        }),
      ),
    },
    /**
     * The badge case.
     *
     * Deliberately NOT the "only what is held" rule the TM icons and the stone
     * shelf follow. A badge case is a CHECKLIST — a slot that draws nothing
     * has nothing to say, and the whole point of the screen is the eight
     * outlines you have not filled in yet. So all eight are resolved and the
     * panel greys the ones not held. Eight files at ~4KB, fetched once ever.
     */
    badges: await (async () => {
      const held = new Set(state.badges ?? []);
      return {
        count: held.size,
        total: GYMS.length,
        wins: state.gymWins ?? 0,
        /** The road's summit, and how far along it this save has come. */
        league: {
          cityKo: LEAGUE_CITY,
          open: held.size === GYMS.length,
          /** Members of the current run already down, 0..5. Null when none is running. */
          at: state.leagueRun?.at ?? null,
          size: LEAGUE.length,
          best: state.leagueBest ?? 0,
          wins: state.leagueWins ?? 0,
          clearedAt: state.leagues?.kanto ?? null,
          until: encountersUntilStop(state.huntCount, LEAGUE_CITY),
          members: await Promise.all(
            LEAGUE.map(async (m) => ({
              id: m.id,
              ko: m.ko,
              /** Beaten in the run that is under way, or in a run already cleared. */
              down: (state.leagueRun?.at ?? 0) > LEAGUE.indexOf(m),
              sprite: await ensureNpcSprite(m.sprite),
            })),
          ),
        },
        cases: await Promise.all(
          [...GYMS]
            // Displayed by badge NUMBER, which is the games' own order and the
            // order the case is printed in. `order` is when you meet them.
            .sort((a, b) => a.badge - b.badge)
            .map(async (g) => ({
              no: g.badge,
              ko: g.badgeKo,
              leaderKo: g.ko,
              cityKo: g.city,
              have: held.has(g.badge),
              /** 상록시티, and only it: shut until the other seven are held. */
              locked: gymLocked(g, held),
              /** Encounters until the pet stands there. 0 means it is there now. */
              until: encountersUntilStop(state.huntCount, g.city),
              /** The TM the badge comes with, for the card's second line. */
              prizeKo: moveById(g.prize)?.ko ?? null,
              sprite: await ensureBadgeSprite(g.badge),
            })),
        ),
      };
    })(),
    legends: {
      /** Signature items held, resolved for the bag. */
      items: await Promise.all(
        Object.entries(state.legendItems ?? {})
          .filter(([, n]) => (n ?? 0) > 0)
          .map(async ([slug, count]) => {
            const it = legendItem(slug);
            const gate = LEGEND_GATES.find((g) => g.item === slug);
            return {
              slug,
              ko: it?.ko ?? slug,
              count,
              forKo: gate ? speciesName(gate.speciesId) : null,
              sprite: it?.sprite ? await ensureItemSprite(it.sprite) : null,
            };
          }),
      ),
      /** Eggs won in battle, waiting to be raised. */
      eggs: await Promise.all(
        Object.entries(state.legendEggs ?? {})
          .filter(([, n]) => (n ?? 0) > 0)
          .map(async ([id, count]) => ({
            speciesId: Number(id),
            ko: speciesName(Number(id)),
            count,
            sprite: await ensureSprite(Number(id)),
          })),
      ),
      /** Fragments, and whether a set is ready to fuse. */
      shards: await Promise.all(
        Object.entries(state.shards ?? {})
          .filter(([, n]) => (n ?? 0) > 0)
          .map(async ([slug, count]) => {
            const it = legendItem(slug);
            return {
              slug,
              ko: it?.ko ?? slug,
              count,
              need: SHARDS_PER_ITEM,
              ready: (count ?? 0) >= SHARDS_PER_ITEM,
              sprite: it?.sprite ? await ensureItemSprite(it.sprite) : null,
            };
          }),
      ),
      /** The reservation a signature item bought, if one is pending. */
      waiting: state.forcedNext
        ? { speciesId: state.forcedNext.speciesId, ko: speciesName(state.forcedNext.speciesId) }
        : null,
      /** Every gate, for the board. */
      gates: LEGEND_GATES.map((g) => {
        const { have, need } = g.metric(state);
        const row = legendRow(g.speciesId);
        const held = g.item ? (state.legendItems?.[g.item] ?? 0) > 0 : false;
        return {
          speciesId: g.speciesId,
          ko: row?.ko ?? speciesName(g.speciesId),
          tier: g.tier,
          myth: row?.myth ?? false,
          gen: row?.gen ?? 0,
          how: g.how,
          have,
          need,
          ratio: need > 0 ? Math.min(1, Math.max(0, have / need)) : 1,
          itemKo: g.item ? itemKo(g.item) : null,
          source: g.source,
          /** The metric is cleared — for an item row, that means it can drop. */
          ready: have >= need,
          /** Holding the item, for a row that has one. */
          held,
          /** Actually meetable in the wild right now. */
          open: g.item ? held : have >= need,
          /** Already raised and graduated. */
          done: state.dex.some((d) => d.speciesId === g.speciesId),
        };
      }),
    },
    events,
    /** Disk used by the runtime sprite cache, for the Settings readout. */
    sprites: await cacheStats(),
    generatedAt: new Date().toISOString(),
  };

  /**
   * Sprite files the current screen depends on.
   *
   * Derived from the payload itself rather than re-listed by hand, so a cache
   * purge can never delete something that is visible right now. Anything not in
   * here is re-downloadable on demand.
   */
  /**
   * Impact art for the types actually swung this encounter.
   *
   * Keyed by move type rather than attached per turn: the same Flamethrower can
   * appear on four turns and there is no reason to resolve it four times, and
   * `dressTurns` is synchronous while this is a download.
   *
   * Only the types on screen, never all eighteen — the same rule the TM icons
   * follow above, and for the same reason: eighteen cold round trips would land
   * on the very first payload a new user waits for.
   */
  const fxTypes = new Set<string>();
  for (const e of payload.hunt.log) {
    const bouts = e.trainerFight ? e.trainerFight.rounds : e.battle ? [e.battle] : [];
    for (const b of bouts) {
      for (const t of b.turns) {
        fxTypes.add(t.moveType);
        if (t.foeActed) fxTypes.add(t.foeMoveType);
      }
    }
  }
  const fx: Record<string, string | null> = {};
  await Promise.all(
    [...fxTypes].map(async (t) => {
      fx[t] = await ensureEffect(effectFor(t));
    }),
  );

  const keepSprites = [
    payload.companion?.sprite,
    payload.companion?.backSprite,
    payload.eggSprite,
    ...payload.shop.products.map((x) => x.sprite),
    ...payload.moves.map((m) => m.sprite),
    ...payload.tms.map((m) => m.sprite),
    ...payload.hunt.log.map((e) => e.wildSprite),
    // The log's row icons, which are on screen whenever 기록 is open.
    ...payload.hunt.log.map((e) => e.icon),
    // Without this a cache purge deletes the art out of an open Pokedex.
    ...payload.dex.map((d) => d.sprite),
    // A trainer's whole team is on screen one after another, and the trainer
    // themself stands there before the first of them does.
    ...payload.hunt.log.flatMap((e) => e.trainerFight?.team.map((m) => m.sprite) ?? []),
    ...payload.hunt.log.map((e) => e.trainerFight?.sprite ?? null),
    // The award icons, for the same reason the dex art is pinned: they are on
    // screen whenever that tab is open.
    ...payload.awards.map((a) => a.itemSprite),
    // The badge case sits in that same tab, and all eight are drawn whether
    // held or not — so all eight are pinned.
    ...payload.badges.cases.map((b) => b.sprite),
    // The Elite Four's portraits, on the same screen.
    ...payload.badges.league.members.map((m) => m.sprite),
    // The league party, drawn in the dex tab whenever it is being built, and
    // one of them stands in the battle scene through a whole run.
    ...payload.party.members.map((m) => m.sprite),
    ...payload.hunt.log.flatMap((e) => e.trainerFight?.mine?.map((x) => x.sprite) ?? []),
    // The legendary shelf: item icons and the eggs' own art.
    ...payload.legends.items.map((i) => i.sprite),
    ...payload.legends.eggs.map((e) => e.sprite),
    ...payload.legends.shards.map((x) => x.sprite),
    // Without this a purge can delete an effect mid-animation.
    ...Object.values(fx),
    // The two backdrops, for the same reason: one is behind an open battle and
    // the other is behind the walk that is on screen whenever the battle is not.
    payload.hunt.skylineBg,
    ...payload.hunt.log.map((e) => e.battleBg),
  ].filter((x): x is string => typeof x === 'string');

  return { ...payload, fx, keepSprites };
}

export type PetState = Awaited<ReturnType<typeof buildState>>;

export type DexIndexEntry = {
  speciesId: number;
  name: string;
  rarity: string;
  generation: number;
  types: { id: string; name: string }[];
};

/**
 * Every species in the dex, with what the filters need.
 *
 * Deliberately NOT part of the /api/state payload. It is ~56KB and completely
 * static, and that payload goes over the wire every twenty seconds — the panel
 * fetches this once, when the "include unseen" toggle is first switched on.
 *
 * No sprites: an unseen slot shows a placeholder, so listing the whole dex
 * costs nothing to download.
 */
let dexIndexCache: DexIndexEntry[] | null = null;

export function dexIndex(): DexIndexEntry[] {
  if (dexIndexCache) return dexIndexCache;
  dexIndexCache = Object.keys(NAMES)
    .map(Number)
    .sort((a, b) => a - b)
    .map((speciesId) => ({
      speciesId,
      name: speciesName(speciesId),
      rarity: rarityOfSpecies(speciesId),
      generation: generationOf(speciesId),
      types: (speciesInfo(speciesId)?.types ?? []).map((t) => ({ id: t, name: TYPE_KO[t] })),
    }));
  return dexIndexCache;
}
