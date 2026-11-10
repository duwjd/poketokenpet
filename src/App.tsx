import { useEffect, useRef, useState } from 'react';
import './App.css';
import { euro } from './josa.ts';
import { battleUiVars } from './battleui.ts';
import {
  fetchDexEntry,
  fetchDexIndex,
  fetchState,
  shopAction,
  type DexDetail,
  type DexIndexEntry,
  type PetActionKind,
} from './api.ts';
import type { DexCard, State, TabId, Till } from './panel/types.ts';
import {
  AWAIT_MS,
  REGION_VIEW,
  SAID_MS,
  STALE_AFTER,
  TABS,
  agoLabel,
  dexKey,
  type Pocket,
  type ShopGroup,
} from './panel/labels.ts';
import { UpdateBanner } from './panel/UpdateBanner.tsx';
import { PetTab } from './panel/tabs/PetTab.tsx';
import { StatsTab } from './panel/tabs/StatsTab.tsx';
import { BagTab } from './panel/tabs/BagTab.tsx';
import { DexTab } from './panel/tabs/DexTab.tsx';
import { DexEntry } from './panel/tabs/DexEntry.tsx';
import { AwardsTab } from './panel/tabs/AwardsTab.tsx';
import { ShopTab } from './panel/tabs/ShopTab.tsx';
import { SettingsTab } from './panel/tabs/SettingsTab.tsx';

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  /**
   * How stale the data on screen is, and how many polls have failed.
   *
   * The age is computed when a poll FAILS rather than during render — reading
   * the clock in render is impure, and it does not need to be live: every
   * failed tick re-renders anyway, so the label refreshes on its own without a
   * second timer.
   */
  const lastOkRef = useRef<number | null>(null);
  const [staleMs, setStaleMs] = useState(0);
  const [fails, setFails] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<TabId>('pet');
  /** Which shop shelf is showing. null is "전체", which draws all three with headings. */
  const [shopGroup, setShopGroup] = useState<ShopGroup | null>(null);
  /**
   * What the clerk is doing.
   *
   * The games never take money on one press: they name the thing, name the
   * price, and ask. Here that matters for more than flavour — buying an egg
   * retires the companion, and until now one stray click did it with no warning
   * at all.
   */
  const [till, setTill] = useState<Till>({ at: 'idle' });
  /** Which pocket is open. */
  const [pocket, setPocket] = useState<Pocket>('item');
  /** Which page of the machine pocket is on screen. See TM_PAGE. */
  const [tmPage, setTmPage] = useState(0);
  /**
   * The bag row being described.
   *
   * Two of them, for the same reason the shop separates hover from a click: a
   * pointed-at row and a chosen row are different things, and letting the mouse
   * wipe out a keyboard or touch selection on its way past the list is how a
   * description vanishes just as it is being read.
   */
  const [bagPin, setBagPin] = useState<string | null>(null);
  const [bagOver, setBagOver] = useState<string | null>(null);
  const prevSpecies = useRef<number | null>(null);
  /**
   * Achievement ids already announced.
   *
   * Null until the first payload arms it, exactly as `prevSpecies` is: a save
   * with thirteen backlogged unlocks must not open the app with thirteen
   * toasts. After that, anything new gets one.
   */
  const seenAwards = useRef<Set<string> | null>(null);
  /**
   * The challenger already announced. `undefined` means not yet armed, which is
   * distinct from `null` — "nobody is standing" is a real value the arming pass
   * has to be able to record without it counting as a change.
   */
  const seenOffer = useRef<string | null | undefined>(undefined);
  /** Tab buttons, so arrow keys can move focus as well as selection. */
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const refresh = useRef<(force?: boolean) => Promise<void>>(async () => {});
  /**
   * Whether a battle is on screen, or an accepted one is about to be.
   *
   * Two flags because the gap between them is where the spoiler lived: the
   * accept returns, the next payload lands with the fight already decided —
   * a badge on the case, an evolution, an award — and only THEN does the scene
   * start. `awaiting` covers that gap; `playing` covers the fight itself.
   * Refs as well as state, because the poll reads them from a closure that
   * never re-subscribes.
   */
  const [playing, setPlaying] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const holdRef = useRef(false);
  useEffect(() => {
    holdRef.current = playing || awaiting;
  }, [playing, awaiting]);
  /** Toasts that arrived while a fight was playing, shown once it is over. */
  const held = useRef<string[]>([]);
  /**
   * Show a toast now, or once the fight on screen is over.
   *
   * Every announcement the poll makes goes through here. An evolution, an
   * award or a new badge's worth of progress landing mid-fight tells you how
   * the fight ends before it does.
   */
  const announce = (line: string, ms = 4000) => {
    if (holdRef.current) {
      held.current.push(line);
      return;
    }
    setFlash(line);
    setTimeout(() => setFlash(null), ms);
  };
  /** The TM waiting on a slot choice, once all four are full. */
  const [pendingTm, setPendingTm] = useState<number | null>(null);
  /** A level-up move waiting for a slot to go into, once all four are full. */
  const [pendingRelearn, setPendingRelearn] = useState<number | null>(null);
  /** Non-null while the rename box is open; holds the draft. */
  const [draftName, setDraftName] = useState<string | null>(null);
  /** Whether the hunt log is expanded on the 기록 tab. */
  const [allHunts, setAllHunts] = useState(false);
  /** Dex filters. Local state — the server never sees them. */
  const [showFilters, setShowFilters] = useState(false);
  const [fRarity, setFRarity] = useState<string | null>(null);
  const [fGen, setFGen] = useState<number | null>(null);
  const [fType, setFType] = useState<string | null>(null);
  const [showUnseen, setShowUnseen] = useState(false);
  /**
   * Which of the dex tab's three boards is up.
   *
   * One collection, three views: the grid, the legendary conditions, and the
   * league party. The party lives here rather than in a tab of its own because
   * every candidate for it is on the grid two rows below — picking six out of
   * the dex on a screen that is not the dex would be the wrong screen.
   */
  const [dexView, setDexView] = useState<'dex' | 'legends' | 'party'>('dex');
  /** Which party seat's move sheet is open, or null. */
  const [partySeat, setPartySeat] = useState<number | null>(null);
  /**
   * Which view of the board is showing.
   *
   * `REGION_VIEW` is the campaign — badge case, ladder, region picker. Null is
   * every achievement, and any other value is one category's id.
   *
   * One piece of state rather than two, because the campaign and the
   * achievement list are alternatives rather than a list and a filter over it:
   * a chip row where one entry hides the rows below it and the rest filter them
   * would be two controls wearing one coat. Sharing the state makes the row say
   * what it does — exactly one chip is lit, and that chip is what is on screen.
   *
   * It opens on the campaign. The list is 77 rows in ten shelves and is most of
   * a screen tall before its first heading; the campaign is one screenful and
   * is the half that changes while the pet walks.
   */
  const [awardCat, setAwardCat] = useState<string | null>(REGION_VIEW);
  /**
   * Which region's badge case is on screen. Null means "follow the journey".
   *
   * Renderer-local, and null rather than a region id, for three reasons. The
   * payload cache is one object shared by the panel, the pet window and the
   * tray, so a region on `/api/state` would have each of them evicting the
   * others. Saving it would make LOOKING a write to state.json, which two
   * processes already race. And null-until-touched is what lets the default
   * move as the journey walks into a new region while still staying put once
   * the reader has chosen — a stored id would park somebody on 관동 for ever.
   */
  const [badgeRegion, setBadgeRegion] = useState<string | null>(null);
  /**
   * Fold away what is already finished.
   *
   * Repeating rows are never folded — they have no finished state, and hiding
   * the one row in a category that still has something to chase would be the
   * opposite of what the toggle is for.
   */
  const [hideDone, setHideDone] = useState(false);
  /**
   * Fold the ten category chips away, exactly as the dex folds its eighteen.
   *
   * Same shape as `showFilters` above and for the same reason its comment
   * gives: an always-on row that is most of a screenful before the first thing
   * you came for. The board's row was worse than the dex's, because it also
   * carried the 지방 / 업적 switch — a mode and a filter in one coat, twelve
   * buttons across three wrapped lines at 420px.
   */
  const [showAwardCats, setShowAwardCats] = useState(false);
  /**
   * How many achievements were unlocked when the board was last looked at.
   *
   * A count in state rather than a ref, because the tab dot is rendered from
   * it: mutating a ref never re-renders, so a dot derived from one would draw
   * from whatever the previous render happened to see. Written from the poll
   * (which arms it on the first payload, so a backlog is not news) and from
   * `goTab` (which clears it when the board is actually opened) — both event
   * contexts, never during render.
   */
  const [awardsSeen, setAwardsSeen] = useState(0);
  /**
   * Show one slice of the achievement list, and put the tab's dot out.
   *
   * The dot used to go out on OPENING the tab, which was right while the list
   * was the first thing there. The tab now opens on the campaign, so opening it
   * is no longer reading the list — and a dot that clears itself while the news
   * it points at is still one click away is a dot that has stopped meaning
   * anything. Still an event handler, never a render: `awardsSeen` feeds the
   * dot, so writing it during render would draw from the previous pass.
   */
  const showAwards = (cat: string | null) => {
    setAwardCat(cat);
    setAwardsSeen(state?.awards.filter((a) => a.at !== null).length ?? 0);
  };
  /**
   * The full dex, fetched once when unseen slots are first asked for.
   *
   * ~116KB and static, which is why it is not in the state payload.
   */
  const [dexIndex, setDexIndex] = useState<DexIndexEntry[] | null>(null);
  /**
   * The card the dex tab has open, held WHOLE rather than as an id pair.
   *
   * The grid row already carries the number, the name, the art, the shiny flag
   * and the types — which is the entire header of the entry screen. Holding the
   * row means that header is on screen in the same frame as the press, and only
   * the sections below it wait on the network. There is nothing to spin.
   */
  const [dexOpen, setDexOpen] = useState<DexCard | null>(null);
  const [dexDetail, setDexDetail] = useState<DexDetail | null>(null);
  const [dexErr, setDexErr] = useState<string | null>(null);
  /**
   * Entries already fetched.
   *
   * Backing out and pressing the same card again is the likeliest thing anyone
   * does here, and an entry cannot change while the panel is open. Held for the
   * same reason `dexIndex` above is held.
   */
  const dexCache = useRef(new Map<string, DexDetail>());
  /**
   * Which card to put the cursor back on. A KEY, not a node.
   *
   * The grid is unmounted while an entry is open, so a node captured on the way
   * in is detached by the time we return — and `.focus()` on a detached node
   * does nothing at all, silently, which is the worst way for this to fail.
   */
  const dexReturn = useRef<string | null>(null);
  /** The scroller, so opening an entry starts at the top of it. */
  const panelRef = useRef<HTMLDivElement | null>(null);

  /**
   * Switch tabs, forgetting whatever was selected on the old one.
   *
   * Leaving the counter ends the conversation, so coming back starts a new one
   * rather than resuming a half-asked question about a price that has since
   * moved. Done here rather than in an effect keyed on `tab`: the tab change is
   * an event, and an effect that only ever mirrors an event is a second render
   * for nothing.
   */
  const goTab = (id: TabId) => {
    setTab(id);
    setTill({ at: 'idle' });
    setBagPin(null);
    setBagOver(null);
    setTmPage(0);
    setPendingTm(null);
    setAwardCat(REGION_VIEW);
    setHideDone(false);
    setShowAwardCats(false);
    setDexView('dex');
    setPartySeat(null);
    closeDex();
  };

  /**
   * Open one dex card's entry screen.
   *
   * The grid is replaced rather than covered — the panel IS a 420px popover, so
   * a dialog would be a window inside a window with no outside for a scrim to
   * cover, and the games do it this way too: shelf, entry, back. 가방's TM slot
   * picker already swaps a list for a chooser in place; this is that at screen
   * scale, not a new mechanism.
   */
  const openDex = (d: DexCard) => {
    const key = dexKey(d);
    dexReturn.current = key;
    setDexOpen(d);
    setDexErr(null);
    setDexDetail(dexCache.current.get(key) ?? null);
    // A card pressed from row eight would otherwise open an entry already
    // scrolled halfway down. Optional call: happy-dom has no scrollTo on an
    // element, and a missing method must not take the panel down.
    panelRef.current?.scrollTo?.(0, 0);
  };

  const closeDex = () => {
    setDexOpen(null);
    setDexDetail(null);
    setDexErr(null);
  };

  /** Show what was held back during a fight, all at once. */
  const release = () => {
    holdRef.current = false;
    const lines = held.current;
    held.current = [];
    if (!lines.length) return;
    setFlash(lines.join(' · '));
    setTimeout(() => setFlash(null), 4000);
  };

  /** The scene says when a fight starts and stops being on screen. */
  const onPlaying = (on: boolean) => {
    setPlaying(on);
    if (on) {
      holdRef.current = true;
      setAwaiting(false);
      return;
    }
    release();
  };

  /**
   * An accepted fight the scene never picked up — a failed poll, a companion
   * gone — must not hold the panel's toasts and the offer card for ever.
   */
  useEffect(() => {
    if (!awaiting) return;
    const t = setTimeout(() => {
      setAwaiting(false);
      release();
    }, AWAIT_MS);
    return () => clearTimeout(t);
  }, [awaiting]);

  const act = async (action: PetActionKind, id: string, slot: number | null = null) => {
    setBusy(true);
    try {
      const out = await shopAction(action, id, slot);
      if (action === 'challenge' && id.startsWith('accept') && out.ok) {
        // No toast: the scene is about to play the fight, and it is the scene
        // that says how it went. Hold everything else until it has.
        setAwaiting(true);
        holdRef.current = true;
      } else {
        setFlash(out.message ?? (out.ok ? '완료' : '실패'));
        setTimeout(() => setFlash(null), 3000);
      }
      refresh.current();
    } catch (e) {
      setFlash(String(e));
      setTimeout(() => setFlash(null), 3000);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Buy the thing the clerk just asked about.
   *
   * Deliberately not `act`: the reply belongs in the clerk's own box, not in
   * the toast that floats over the top of the window. Everything else about the
   * call is the same.
   */
  const buyAsked = async (id: string) => {
    setBusy(true);
    try {
      const out = await shopAction('buy', id, null);
      setTill({ at: 'said', line: out.message ?? (out.ok ? '고맙습니다!' : '죄송합니다.') });
      refresh.current();
    } catch (e) {
      setTill({ at: 'said', line: String(e) });
    } finally {
      setBusy(false);
    }
  };

  /**
   * The clerk stops talking on her own.
   *
   * `said` is the parting line, not a state anyone should have to dismiss.
   * Keyed on the line itself so two purchases in a row each get their full
   * three seconds rather than sharing one timer.
   */
  useEffect(() => {
    if (till.at !== 'said') return;
    const t = setTimeout(() => setTill({ at: 'idle' }), SAID_MS);
    return () => clearTimeout(t);
  }, [till]);

  useEffect(() => {
    let alive = true;
    const tick = async (force = false) => {
      try {
        // `force` skips the server's 20s cache. Only the retry button sets it:
        // fetchState has always supported it and nothing ever passed it.
        const data = await fetchState<State>(force);
        if (!alive) return;
        setState(data);
        setError(null);
        lastOkRef.current = Date.now();
        setFails(0);

        const id = data.companion?.speciesId ?? null;
        if (prevSpecies.current !== null && id !== null && id !== prevSpecies.current) {
          announce(`${data.companion!.name}${euro(data.companion!.name)} 진화!`);
        }
        if (prevSpecies.current === null && id !== null && data.events.some((e) => e.kind === 'hatched')) {
          announce(`${data.companion!.name} 부화!`);
        }
        prevSpecies.current = id;

        /**
         * A leader stepping into the road.
         *
         * Armed on the first payload like the rest, and keyed on the offer's
         * id so it fires once per challenger rather than every poll. Without
         * this the feature is invisible: nothing else in the app has ever
         * announced an encounter, so a card appearing quietly on a tab nobody
         * is looking at would be the same as not asking at all.
         */
        const offer = data.hunt.challenge?.id ?? null;
        if (seenOffer.current === undefined) {
          seenOffer.current = offer;
        } else if (offer && offer !== seenOffer.current) {
          announce(`${data.hunt.challenge!.ko} · 승부를 걸어왔습니다`);
          seenOffer.current = offer;
        } else {
          seenOffer.current = offer;
        }

        // Same shape as the two above, and armed the same way: the first
        // payload only records what is already unlocked.
        const unlocked = new Set(data.awards.filter((a) => a.at !== null).map((a) => a.id));
        if (seenAwards.current === null) {
          seenAwards.current = unlocked;
          setAwardsSeen(unlocked.size);
        } else {
          const fresh = data.awards.find((a) => a.at !== null && !seenAwards.current!.has(a.id));
          seenAwards.current = unlocked;
          if (fresh) announce(`업적 달성 — ${fresh.ko}`);
        }

      } catch (e) {
        if (!alive) return;
        setError(String(e));
        setStaleMs(lastOkRef.current === null ? 0 : Date.now() - lastOkRef.current);
        // Updater form: `tick` is captured by an effect with an empty dep list.
        setFails((f) => f + 1);
      }
    };
    refresh.current = tick;

    /**
     * The popover is hidden, not destroyed, so this interval would otherwise
     * keep polling for as long as the app runs. Poll once on the way back so
     * the panel is never up to five seconds stale when it reappears.
     */
    let h: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (h !== null) return;
      void tick();
      // Wrapped rather than passed directly: no runtime this app targets hands
      // a timer callback an argument, but Firefox is documented to pass the
      // lateness, and `tick`'s first parameter is now `force`. Hygiene, not a
      // live bug — the browser build is a supported way to run this.
      h = setInterval(() => void tick(), 5000);
    };
    const stop = () => {
      if (h === null) return;
      clearInterval(h);
      h = null;
    };
    const onVisibility = () => (document.visibilityState === 'hidden' ? stop() : start());

    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive = false;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // The index is only needed for unseen slots, so it is fetched the first time
  // that is switched on and then held.
  useEffect(() => {
    if (!showUnseen || dexIndex) return;
    let alive = true;
    fetchDexIndex()
      .then((ix) => alive && setDexIndex(ix))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [showUnseen, dexIndex]);

  /**
   * Fetch the open entry, once.
   *
   * In an effect keyed on the card rather than inside the click handler, so a
   * double press, a card reopened from the cache and an incidental re-render
   * cannot each start a request. `alive` is the same guard the index fetch
   * above uses.
   */
  useEffect(() => {
    if (!dexOpen) return;
    const key = dexKey(dexOpen);
    if (dexCache.current.has(key)) return;
    let alive = true;
    fetchDexEntry(dexOpen.speciesId, dexOpen.shiny)
      .then((e) => {
        if (e) dexCache.current.set(key, e);
        if (alive && e) setDexDetail(e);
      })
      .catch((err) => alive && setDexErr(String(err)));
    return () => {
      alive = false;
    };
  }, [dexOpen]);

  /**
   * Put the cursor back on the card you came from.
   *
   * By key, not by a captured node: the grid was unmounted while the entry was
   * open, so the button that opened it is a NEW element. Focusing it also
   * scrolls it back into view, which is the scroll restoration this screen
   * would otherwise need a second mechanism for.
   */
  useEffect(() => {
    if (dexOpen !== null || dexReturn.current === null) return;
    const key = dexReturn.current;
    dexReturn.current = null;
    document.querySelector<HTMLButtonElement>(`.dex [data-key="${key}"]`)?.focus();
  }, [dexOpen]);

  /**
   * Escape goes back, the way B does in the games.
   *
   * On the window rather than on the screen: the panel scrolls, so after a
   * wheel-scroll focus is on the scroller or on nothing at all, and a handler
   * that only fired for descendants would work for the keyboard and not for
   * anyone who reached for the mouse first. The field guard is one line and the
   * difference between "works" and "works until someone adds a search box".
   */
  useEffect(() => {
    if (!dexOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA') return;
      closeDex();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dexOpen]);

  if (error && !state) return <div className="app"><p className="err">연결 실패: {error}</p></div>;
  if (!state) return <div className="app"><p className="muted">스캔 중… (첫 실행은 몇 초 걸립니다)</p></div>;

  const { tokens, companion, progress } = state;
  const bagKey = bagOver ?? bagPin;

  const bagItems = Object.entries(state.bag.inventory).filter(([, n]) => (n ?? 0) > 0) as [
    string,
    number,
  ][];

  /**
   * What the bag's tab dot counts.
   *
   * The legendary pocket has to be in here: a signature item dropping is the
   * single most worth-a-look thing that can land in the bag, and it lit no dot
   * at all because this only ever summed `inventory`.
   */
  const bagCount =
    bagItems.reduce((a, [, n]) => a + n, 0) +
    state.legends.items.reduce((a, i) => a + i.count, 0) +
    state.legends.eggs.reduce((a, e) => a + e.count, 0) +
    state.legends.shards.filter((sh) => sh.ready).length;

  // Evolution items count only when this companion can use them: all
  // forty-one are shelved, and "you could afford a stone nobody here needs"
  // would keep the dot lit forever.
  const affordable = state.shop.products.filter(
    (p) => p.shelved && (p.kind !== 'evo' || p.usable) && state.shop.wallet >= p.price,
  ).length;

  const awardsDone = state.awards.filter((a) => a.at !== null).length;
  /** Unlocked since the board was last opened. Written by tick and goTab. */
  const unseenAwards = Math.max(0, awardsDone - awardsSeen);

  return (
    /* The 9-slice frames need their custom properties on an ancestor. Set once
       here rather than on each window that wears one — `.scene` sets its own
       copy inline, which is how it keeps the bright frame in dark mode. */
    <div className="app" style={battleUiVars() as React.CSSProperties}>
      {flash && (
        <div className="px-toast flash" role="status">
          {flash}
        </div>
      )}

      <UpdateBanner />

      {/*
        A real tablist, not just the roles.
        
        A <div>, not a <nav>: role="tablist" suppresses the landmark anyway, so
        the element was announcing navigation it did not provide. And the
        keyboard contract the roles promise is implemented below — six separate
        tab stops with inert arrow keys is the opposite of the ARIA pattern.
      */}
      <div
        className="tabs"
        role="tablist"
        aria-label="화면"
        onKeyDown={(e) => {
          const i = TABS.findIndex((t) => t.id === tab);
          const to =
            e.key === 'ArrowRight' ? (i + 1) % TABS.length
            : e.key === 'ArrowLeft' ? (i - 1 + TABS.length) % TABS.length
            : e.key === 'Home' ? 0
            : e.key === 'End' ? TABS.length - 1
            : -1;
          if (to < 0) return;
          // Without this the arrows scroll the panel underneath instead.
          e.preventDefault();
          // Selection follows focus: panels here are cheap to render, and it
          // keeps the keyboard consistent with what a click already does.
          goTab(TABS[to].id);
          tabRefs.current[to]?.focus();
        }}
      >
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            id={`tab-${t.id}`}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls="tabpanel"
            /* Roving tabindex: one stop for the whole set, arrows move within. */
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? 'on' : ''}
            onClick={() => goTab(t.id)}
          >
            {t.label}
            {/* A quiet dot beats a number badge here — it says "worth a look"
                without turning the panel into a notification centre. */}
            {t.id === 'shop' && affordable > 0 && <i className="dot" />}
            {t.id === 'bag' && bagCount > 0 && <i className="dot" />}
            {t.id === 'awards' && unseenAwards > 0 && <i className="dot" />}
            {/* A leader waiting for an answer. The one dot that is not "there
                is something to spend" but "somebody is standing there", which
                is why it goes on the tab the battle will play on. */}
            {t.id === 'pet' && state?.hunt.challenge && <i className="dot" />}
          </button>
        ))}
      </div>

      {/*
        Stale, not broken. The panel keeps rendering the last good data — this
        only admits its age, which is why it is muted rather than .err red and
        a persistent bar rather than the .flash toast (that one auto-dismisses
        after 3s and would re-fire every 5s while a server is down).
      */}
      {state && fails >= STALE_AFTER && (
        <div className="stale" title={error ?? undefined}>
          <span>연결 실패 · {agoLabel(staleMs)} 정보</span>
          <button
            className="px-btn px-btn--link"
            disabled={retrying}
            onClick={async () => {
              setRetrying(true);
              try {
                await refresh.current(true);
              } finally {
                setRetrying(false);
              }
            }}
          >
            다시 시도
          </button>
        </div>
      )}

      <div ref={panelRef} className="tabpanel" role="tabpanel" id="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={0}>

      {/*
        Each tab's body is a component in src/panel/tabs — two for the dex, its
        grid and an open entry. The state they read and set all stays up here,
        because the tabs are not independent: goTab clears each one's selection
        on the way out, the partner tab and the bag both light rows from
        bagKey, and the bag's 조건 보기 lands on the dex's legend board.
      */}
      {tab === 'pet' && (
        <PetTab
          state={state}
          tokens={tokens}
          companion={companion}
          progress={progress}
          busy={busy}
          playing={playing}
          awaiting={awaiting}
          pendingRelearn={pendingRelearn}
          setPendingRelearn={setPendingRelearn}
          draftName={draftName}
          setDraftName={setDraftName}
          bagKey={bagKey}
          goTab={goTab}
          onPlaying={onPlaying}
          act={act}
        />
      )}

      {tab === 'stats' && (
        <StatsTab
          state={state}
          tokens={tokens}
          allHunts={allHunts}
          setAllHunts={setAllHunts}
        />
      )}

      {tab === 'bag' && (
        <BagTab
          state={state}
          companion={companion}
          busy={busy}
          pocket={pocket}
          setPocket={setPocket}
          tmPage={tmPage}
          setTmPage={setTmPage}
          bagKey={bagKey}
          bagPin={bagPin}
          setBagPin={setBagPin}
          setBagOver={setBagOver}
          bagItems={bagItems}
          pendingTm={pendingTm}
          setPendingTm={setPendingTm}
          setDexView={setDexView}
          goTab={goTab}
          act={act}
        />
      )}

      {tab === 'dex' && dexOpen === null && (
        <DexTab
          state={state}
          busy={busy}
          dexView={dexView}
          setDexView={setDexView}
          showFilters={showFilters}
          setShowFilters={setShowFilters}
          fRarity={fRarity}
          setFRarity={setFRarity}
          fGen={fGen}
          setFGen={setFGen}
          fType={fType}
          setFType={setFType}
          showUnseen={showUnseen}
          setShowUnseen={setShowUnseen}
          dexIndex={dexIndex}
          partySeat={partySeat}
          setPartySeat={setPartySeat}
          openDex={openDex}
          act={act}
        />
      )}

      {/*
        * The 도감 entry screen.
        *
        * Replaces the grid rather than covering it — see openDex for why there
        * is no dialog here. The header draws from the card that was pressed, so
        * it is on screen in the same frame; only the sections below it wait.
        */}
      {tab === 'dex' && dexOpen !== null && (
        <DexEntry
          dexOpen={dexOpen}
          setDexOpen={setDexOpen}
          dexDetail={dexDetail}
          dexErr={dexErr}
          setDexErr={setDexErr}
          closeDex={closeDex}
          companion={companion}
        />
      )}

      {tab === 'awards' && (
        <AwardsTab
          state={state}
          awardCat={awardCat}
          setAwardCat={setAwardCat}
          badgeRegion={badgeRegion}
          setBadgeRegion={setBadgeRegion}
          hideDone={hideDone}
          setHideDone={setHideDone}
          showAwardCats={showAwardCats}
          setShowAwardCats={setShowAwardCats}
          showAwards={showAwards}
          awardsDone={awardsDone}
        />
      )}

      {tab === 'shop' && (
        <ShopTab
          state={state}
          busy={busy}
          shopGroup={shopGroup}
          setShopGroup={setShopGroup}
          till={till}
          setTill={setTill}
          buyAsked={buyAsked}
        />
      )}

      {tab === 'settings' && (
        <SettingsTab
          state={state}
          tokens={tokens}
          busy={busy}
          act={act}
        />
      )}

      </div>
    </div>
  );
}
