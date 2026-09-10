// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App.tsx';

import { DEX_ENTRY, STATE } from './state-fixture.ts';

/** What /api/state answers with. A test that needs different numbers sets it
 *  before rendering; beforeEach puts the shared fixture back. */
let payload: typeof STATE = STATE;

beforeEach(() => {
  payload = STATE;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/state')) {
        return { ok: true, json: async () => payload } as Response;
      }
      /*
       * The entry route must be matched BEFORE the index, and the index must be
       * an exact match — '/api/dex/6' also satisfies startsWith('/api/dex'), so
       * with these the other way round every entry test would be handed the
       * index array and would pass for entirely the wrong reason. Exactly the
       * trap server/plugin.ts guards against, and the mock has to guard it too.
       */
      if (String(url).startsWith('/api/dex/')) {
        return { ok: true, status: 200, json: async () => DEX_ENTRY } as Response;
      }
      if (String(url) === '/api/dex' || String(url).startsWith('/api/dex?')) {
        return {
          ok: true,
          json: async () => [
            { speciesId: 4, name: '파이리', rarity: 'rare', generation: 1, types: [{ id: 'fire', name: '불꽃' }] },
            { speciesId: 6, name: '리자몽', rarity: 'rare', generation: 1, types: [{ id: 'fire', name: '불꽃' }] },
            { speciesId: 25, name: '피카츄', rarity: 'common', generation: 1, types: [{ id: 'electric', name: '전기' }] },
          ],
        } as Response;
      }
      return { ok: true, json: async () => ({ ok: true, message: '샀습니다.' }) } as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ready = () => waitFor(() => expect(screen.getByRole('tablist')).toBeTruthy());

describe('panel tabs', () => {
  it('renders every tab and opens on 파트너', async () => {
    render(<App />);
    await ready();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['파트너', '기록', '가방', '도감', '업적', '상점', '설정']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('레오꼬');
  });

  it('shows only the selected tab, never everything at once', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();

    // The whole point of the change: the shop must not be on screen under 펫.
    expect(screen.queryByText('이상한사탕')).toBeNull();

    await user.click(screen.getByRole('tab', { name: /상점/ }));
    expect(screen.getByText('이상한사탕')).toBeTruthy();
    // ...and the pet hero is gone while the shop is open.
    expect(screen.queryByText('화염레오')).toBeNull();
  });

  it('each tab shows its own content', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();

    await user.click(screen.getByRole('tab', { name: /기록/ }));
    expect(screen.getByText('어디서 썼나')).toBeTruthy();
    expect(screen.getByText('최근 14일')).toBeTruthy();
    expect(screen.getByText('VS Code')).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: /가방/ }));
    expect(screen.getByText(/이상한사탕/)).toBeTruthy();
    // The dex moved out of the bag; the bag must no longer carry it.
    expect(screen.queryByText(/피카츄/)).toBeNull();

    await user.click(screen.getByRole('tab', { name: /도감/ }));
    expect(screen.getByRole('heading', { name: '도감' })).toBeTruthy();
    expect(screen.getByText(/피카츄/)).toBeTruthy();
    expect(screen.getByText('#025')).toBeTruthy();
    expect(screen.getByText(/1025종/)).toBeTruthy();
    expect(screen.queryByText(/이상한사탕/)).toBeNull();

    await user.click(screen.getByRole('tab', { name: /설정/ }));
    expect(screen.getByText('정보')).toBeTruthy();
  });

  it('marks the active tab for assistive tech', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: /설정/ }));
    const selected = screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain('설정');
  });

  it('keeps working after buying something', async () => {
    // Buying is two presses now: pick the row, then answer the clerk. That is
    // the deliberate change — an egg trades the companion away, and one press
    // used to do it with no warning.
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: /상점/ }));
    const row = screen.getAllByRole('button').find((b) => b.textContent?.includes('32.0M'));
    expect(row).toBeTruthy();
    await user.click(row!);
    await user.click(screen.getByRole('button', { name: '예' }));
    await waitFor(() => expect(screen.getByText('샀습니다.')).toBeTruthy());
    // Still on the shop tab, not thrown back to 펫.
    expect(screen.getByRole('tab', { name: /상점/ }).getAttribute('aria-selected')).toBe('true');
  });
  it('shows the hunt log on the pet tab', async () => {
    render(<App />);
    await ready();
    expect(screen.getByText(/방금 꼬렛/)).toBeTruthy();
    // Once as a taught move under the chain, once as the TM the log records.
    expect(screen.getAllByText('화염방사').length).toBeGreaterThan(0);
    expect(screen.getByText(/다음 조우까지/)).toBeTruthy();
  });

  it('explains itself instead of going silent when hunting is idle', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ...STATE, hunt: { ...STATE.hunt, idleReason: 'everstone' } }),
      })) as never,
    );
    render(<App />);
    await ready();
    // The scene caption is the one place this is said.
    expect(screen.getByText('변함없는돌을 차고 쉬고 있다')).toBeTruthy();
  });

  it('keeps the four move slots on the partner, where the moveset belongs', async () => {
    render(<App />);
    await ready();
    // One taught move plus three empty slots — the slot count must be visible.
    expect(screen.getAllByText('빈 칸')).toHaveLength(3);
    expect(screen.getByRole('button', { name: '잊기' })).toBeTruthy();
  });

  it('will not let you forget your only attack', () => {
    render(<App />);
    return ready().then(() => {
      // The fixture holds one move and it is an attack. The server refuses this
      // too — but a disabled button that says why is a rule, and a red toast
      // after the click is an error.
      const btn = screen.getByRole('button', { name: '잊기' }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(screen.getByText(/하나뿐인 공격 기술/)).toBeTruthy();
    });
  });

  it('locks the last attack in the forget picker only when the TM cannot hit', async () => {
    const statusTm = { ...STATE.tms[0], id: 86, name: '전기자석파', damageClass: 'status', power: 0 };
    const withStatusTm = {
      ...STATE,
      moves: [0, 1, 2, 3].map((i) =>
        // One attack, three status moves — exactly the shape the rule protects.
        i === 0
          ? { ...STATE.moves[0], id: 200 }
          : { ...STATE.moves[0], id: 200 + i, name: `변화${i}`, damageClass: 'status', power: 0 },
      ),
      tms: [statusTm],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).startsWith('/api/state')
          ? ({ ok: true, json: async () => withStatusTm } as Response)
          : ({ ok: true, json: async () => ({ ok: true, message: '배웠습니다.' }) } as Response),
      ),
    );
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '가방' }));
    await user.click(screen.getByRole('button', { name: '기술머신' }));
    await user.click(screen.getByRole('button', { name: '배우기' }));

    const picks = screen.getAllByRole('button', { name: '이걸 잊기' }) as HTMLButtonElement[];
    expect(picks).toHaveLength(4);
    // Only the attack is out of reach; the three status slots are fair game.
    expect(picks.map((b) => b.disabled)).toEqual([true, false, false, false]);
  });

  /**
   * A save with 47 machines held shows every one the companion can still learn,
   * which was 19 at the time this was written — about 950px of column in a
   * window that is 760px at its tallest.
   */
  describe('the machine pocket pages', () => {
    /** n machines, named so the page they land on is readable in a failure. */
    const manyTms = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        ...STATE.tms[0],
        id: 100 + i,
        name: `기술${String(i + 1).padStart(2, '0')}`,
        count: 1,
      }));

    const openMachines = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole('tab', { name: '가방' }));
      await user.click(screen.getByRole('button', { name: '기술머신' }));
    };

    it('shows one page at a time instead of the whole column', async () => {
      payload = { ...STATE, tms: manyTms(19), unusableTmCount: 0 };
      const user = userEvent.setup();
      render(<App />);
      await ready();
      await openMachines(user);

      // Eight of nineteen, and the ninth is not merely scrolled off — it is not
      // in the document at all.
      expect(document.querySelectorAll('.items li')).toHaveLength(8);
      expect(screen.getByText('기술01')).toBeTruthy();
      expect(screen.getByText('기술08')).toBeTruthy();
      expect(screen.queryByText('기술09')).toBeNull();
      expect(screen.getByText('1 / 3')).toBeTruthy();
    });

    it('walks forward and back, and stops at both ends', async () => {
      payload = { ...STATE, tms: manyTms(19), unusableTmCount: 0 };
      const user = userEvent.setup();
      render(<App />);
      await ready();
      await openMachines(user);

      const prev = () => screen.getByRole('button', { name: '이전 쪽' }) as HTMLButtonElement;
      const next = () => screen.getByRole('button', { name: '다음 쪽' }) as HTMLButtonElement;
      expect(prev().disabled).toBe(true);

      await user.click(next());
      expect(screen.getByText('2 / 3')).toBeTruthy();
      expect(screen.getByText('기술09')).toBeTruthy();
      expect(screen.queryByText('기술08')).toBeNull();
      expect(prev().disabled).toBe(false);

      await user.click(next());
      // Nineteen over eight leaves three on the last page.
      expect(screen.getByText('3 / 3')).toBeTruthy();
      expect(document.querySelectorAll('.items li')).toHaveLength(3);
      expect(next().disabled).toBe(true);

      await user.click(prev());
      expect(screen.getByText('2 / 3')).toBeTruthy();
    });

    it('draws no pager when everything fits on one page', async () => {
      // A control reading `1 / 1` says nothing — the same rule that gives a
      // species with no forms no row at all.
      payload = { ...STATE, tms: manyTms(8), unusableTmCount: 0 };
      const user = userEvent.setup();
      render(<App />);
      await ready();
      await openMachines(user);
      expect(document.querySelectorAll('.items li')).toHaveLength(8);
      expect(screen.queryByRole('button', { name: '다음 쪽' })).toBeNull();
    });

    it('steps aside while the forget picker is asking', async () => {
      // Two lists on one screen, one of them a question — the pager is for
      // browsing, and mid-decision is not browsing.
      payload = {
        ...STATE,
        tms: manyTms(19),
        unusableTmCount: 0,
        moves: Array.from({ length: 4 }, (_, i) => ({ ...STATE.moves[0], id: 900 + i })),
      };
      const user = userEvent.setup();
      render(<App />);
      await ready();
      await openMachines(user);
      expect(screen.getByText('1 / 3')).toBeTruthy();

      // Four slots full, so 배우기 asks which to forget.
      await user.click(screen.getAllByRole('button', { name: '배우기' })[0]);
      expect(screen.getByText(/배우려면 하나를/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: '다음 쪽' })).toBeNull();

      await user.click(screen.getByRole('button', { name: '취소' }));
      expect(screen.getByText('1 / 3')).toBeTruthy();
    });

    it('drops a half-made choice when the pocket changes', async () => {
      payload = {
        ...STATE,
        tms: manyTms(19),
        unusableTmCount: 0,
        moves: Array.from({ length: 4 }, (_, i) => ({ ...STATE.moves[0], id: 900 + i })),
      };
      const user = userEvent.setup();
      render(<App />);
      await ready();
      await openMachines(user);
      await user.click(screen.getAllByRole('button', { name: '배우기' })[0]);
      expect(screen.getByText(/배우려면 하나를/)).toBeTruthy();

      // The question belongs to the pocket it was asked in.
      await user.click(screen.getByRole('button', { name: '도구' }));
      await user.click(screen.getByRole('button', { name: '기술머신' }));
      expect(screen.queryByText(/배우려면 하나를/)).toBeNull();
    });

    it('goes back to the front when the pocket is left and reopened', async () => {
      payload = { ...STATE, tms: manyTms(19), unusableTmCount: 0 };
      const user = userEvent.setup();
      render(<App />);
      await ready();
      await openMachines(user);
      await user.click(screen.getByRole('button', { name: '다음 쪽' }));
      expect(screen.getByText('2 / 3')).toBeTruthy();

      await user.click(screen.getByRole('button', { name: '도구' }));
      await user.click(screen.getByRole('button', { name: '기술머신' }));
      expect(screen.getByText('1 / 3')).toBeTruthy();
    });

    /**
     * Teaching CONSUMES the machine, so the list shrinks under the page you are
     * standing on and the last page can stop existing. The page is clamped in
     * the render rather than corrected in an effect, so there is never a frame
     * showing an empty page.
     */
    it('does not strand you on a page that stopped existing', async () => {
      payload = { ...STATE, tms: manyTms(17), unusableTmCount: 0 };
      const user = userEvent.setup();
      render(<App />);
      await ready();
      await openMachines(user);
      await user.click(screen.getByRole('button', { name: '다음 쪽' }));
      await user.click(screen.getByRole('button', { name: '다음 쪽' }));
      // 17 over 8 is three pages, the last holding one.
      expect(screen.getByText('3 / 3')).toBeTruthy();
      expect(document.querySelectorAll('.items li')).toHaveLength(1);

      // Teaching it is what takes it away, and `act` refetches — so this is the
      // real path, not a poke at the state.
      payload = { ...STATE, tms: manyTms(16), unusableTmCount: 0 };
      await user.click(screen.getByRole('button', { name: '배우기' }));

      await waitFor(() => expect(screen.getByText('2 / 2')).toBeTruthy());
      expect(document.querySelectorAll('.items li')).toHaveLength(8);
    });
  });

  it('keeps the TMs in the bag, and does not repeat the slots there', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '가방' }));
    // Machines live in their own pocket now, as they do in the games.
    await user.click(screen.getByRole('button', { name: '기술머신' }));
    expect(screen.getByText('파괴광선')).toBeTruthy();
    expect(screen.getByRole('button', { name: '배우기' })).toBeTruthy();
    // The slots are on the other tab now, so nothing here should show them.
    expect(screen.queryByText('빈 칸')).toBeNull();
    expect(screen.queryByRole('button', { name: '잊기' })).toBeNull();
  });

  it('asks which move to forget once all four slots are full', async () => {
    const full = {
      ...STATE,
      moves: [0, 1, 2, 3].map((i) => ({ ...STATE.moves[0], id: 100 + i, name: `기술${i}` })),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).startsWith('/api/state')
          ? ({ ok: true, json: async () => full } as Response)
          : ({ ok: true, json: async () => ({ ok: true, message: '배웠습니다.' }) } as Response),
      ),
    );
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '가방' }));
    await user.click(screen.getByRole('button', { name: '기술머신' }));
    await user.click(screen.getByRole('button', { name: '배우기' }));
    // A compact stand-in appears in the bag rather than the server just
    // refusing with "기술이 4개라 하나를 잊어야 합니다".
    expect(screen.getByText(/배우려면 하나를/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '이걸 잊기' })).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('button', { name: '이걸 잊기' })).toBeNull();
  });

  it('can lift the hunt ceiling from settings', async () => {
    const posts: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).startsWith('/api/state')) {
          return { ok: true, json: async () => STATE } as Response;
        }
        posts.push(JSON.parse(String(init?.body)));
        return { ok: true, json: async () => ({ ok: true, message: '해제했습니다.' }) } as Response;
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '설정' }));
    // The label names the CAP's state; the id names what to do to it.
    await user.click(screen.getByRole('button', { name: '적용 중' }));
    expect(posts).toContainEqual(expect.objectContaining({ action: 'huntcap', id: 'off' }));
  });

  it('can switch auto-hunting off from settings', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '설정' }));
    await user.click(screen.getByRole('button', { name: '켜짐' }));
    // The action is followed by a state refresh, so find the shop call itself.
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const shop = calls.filter(([url]) => String(url) === '/api/shop').at(-1)!;
    expect(JSON.parse(String((shop[1] as RequestInit).body))).toMatchObject({
      action: 'hunt',
      id: 'off',
    });
  });
  it('opens with the clerk greeting you', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '상점' }));
    expect(screen.getByText(/어서 오세요! 프렌들리숍입니다/)).toBeTruthy();
    expect(document.querySelector('.mart-clerk')).toBeTruthy();
  });

  it('keeps the counter usable when the clerk never arrives', async () => {
    // The promise every runtime-fetched asset in this app makes: a miss is
    // cosmetic. No clerk, but the counter, the greeting and the prices stand.
    payload = { ...STATE, shop: { ...STATE.shop, clerk: null } };
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '상점' }));
    expect(document.querySelector('.mart-clerk')).toBeNull();
    expect(document.querySelector('.mart')).toBeTruthy();
    expect(screen.getByText(/어서 오세요/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /이상한사탕/ })).toBeTruthy();
  });

  it('asks before taking anything, and takes nothing until answered', async () => {
    const posts: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).startsWith('/api/state')) {
          return { ok: true, json: async () => STATE } as Response;
        }
        if (String(url).startsWith('/api/dex')) return { ok: true, json: async () => [] } as Response;
        posts.push(JSON.parse(String(init?.body)));
        return { ok: true, json: async () => ({ ok: true, message: '샀습니다.' }) } as Response;
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '상점' }));
    await user.click(screen.getByRole('button', { name: /이상한사탕/ }));

    expect(screen.getByText(/괜찮으시겠습니까/)).toBeTruthy();
    // The whole point: nothing has been bought yet.
    expect(posts).toEqual([]);

    await user.click(screen.getByRole('button', { name: '예' }));
    expect(posts).toContainEqual(expect.objectContaining({ action: 'buy', id: 'rare-candy' }));
    await waitFor(() => expect(screen.getByText('샀습니다.')).toBeTruthy());
  });

  it('buys nothing when you say no, and goes back to the greeting', async () => {
    const posts: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).startsWith('/api/state')) {
          return { ok: true, json: async () => STATE } as Response;
        }
        if (String(url).startsWith('/api/dex')) return { ok: true, json: async () => [] } as Response;
        posts.push(JSON.parse(String(init?.body)));
        return { ok: true, json: async () => ({ ok: true, message: '샀습니다.' }) } as Response;
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '상점' }));
    await user.click(screen.getByRole('button', { name: /이상한사탕/ }));
    await user.click(screen.getByRole('button', { name: '아니오' }));

    expect(posts).toEqual([]);
    expect(screen.getByText(/어서 오세요/)).toBeTruthy();
    expect(screen.queryByText(/괜찮으시겠습니까/)).toBeNull();
  });

  /**
   * The reason this feature is not only decoration.
   *
   * An egg retires the companion into the dex. Before the counter existed, one
   * stray press on the 80x-priced legendary egg did that with no warning at all.
   */
  it('warns that an egg trades the companion away, by name', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '상점' }));
    await user.click(screen.getByRole('button', { name: /전설의 알/ }));
    expect(screen.getByText(/레오꼬는 도감으로 떠납니다/)).toBeTruthy();
  });

  it('does not warn about a companion that is not there', async () => {
    // The egg state. `STATE.companion` is a concrete object so the other tests
    // can spread it; nulling it out is the one case that needs saying so.
    payload = { ...STATE, companion: null } as unknown as typeof STATE;
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '상점' }));
    await user.click(screen.getByRole('button', { name: /전설의 알/ }));
    expect(screen.queryByText(/도감으로 떠납니다/)).toBeNull();
    expect(screen.getByText(/괜찮으시겠습니까/)).toBeTruthy();
  });

  it('describes whatever is pointed at, in the clerk window', async () => {
    // Pointing costs nothing, exactly as moving the cursor down a list does in
    // the games — and it is the clerk who tells you, which is why there is no
    // second box under the list any more.
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '상점' }));
    expect(screen.getByText(/어서 오세요/)).toBeTruthy();

    await user.hover(screen.getByRole('button', { name: /이상한사탕/ }));
    expect(screen.getByText('진행도 +25%')).toBeTruthy();
    // Pointing is not buying, and it is not even asking.
    expect(screen.queryByRole('button', { name: '예' })).toBeNull();

    await user.unhover(screen.getByRole('button', { name: /이상한사탕/ }));
    expect(screen.getByText(/어서 오세요/)).toBeTruthy();
  });

  it('describes what the keyboard is on, not only what the mouse is on', async () => {
    render(<App />);
    await ready();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: '상점' }));
    // Real focus, not fireEvent: React listens on focusin, and the state it
    // sets has to be flushed before the assertion can see it.
    await act(async () => screen.getByRole('button', { name: /이상한사탕/ }).focus());
    expect(screen.getByText('진행도 +25%')).toBeTruthy();
  });

  it('describes a bag item in the same window, in the same place', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '가방' }));
    expect(screen.getByText('고르면 여기에 설명이 나옵니다.')).toBeTruthy();
    await user.hover(screen.getByRole('button', { name: /이상한사탕/ }));
    expect(screen.getByText('지금 단계 진행도를 25% 채웁니다.')).toBeTruthy();
  });

  it('marks a one-time item as owned instead of pricing it again', async () => {
    const posts: unknown[] = [];
    payload = {
      ...STATE,
      shop: {
        ...STATE.shop,
        products: STATE.shop.products.map((p) =>
          p.id === 'key-stone' ? { ...p, owned: true } : p,
        ),
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).startsWith('/api/state')) {
          return { ok: true, json: async () => payload } as Response;
        }
        if (String(url).startsWith('/api/dex')) return { ok: true, json: async () => [] } as Response;
        posts.push(JSON.parse(String(init?.body)));
        return { ok: true, json: async () => ({ ok: true, message: '샀습니다.' }) } as Response;
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '상점' }));

    const row = screen.getByRole('button', { name: /키스톤/ });
    expect(row.textContent).toContain('보유중');
    expect(row.textContent).not.toContain('534.0M');

    // Pressing it says so rather than opening a question nobody wants answered.
    await user.click(row);
    expect(screen.getByText(/이미 가지고 계십니다/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '예' })).toBeNull();
    expect(posts).toEqual([]);
  });

  it('says what is in effect while nothing is pointed at', async () => {
    /*
     * These lines used to sit in a grey `<p>` under the item list — the least
     * visible place on the screen, for the one thing on it that says the rules
     * are currently different. The window above it sat empty until hovered.
     */
    payload = {
      ...STATE,
      bag: { ...STATE.bag, everstone: true, shinyCharmActive: true },
    };
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '가방' }));

    expect(screen.getByText('지금 걸린 효과')).toBeTruthy();
    const desc = screen.getByText(/진화 정지 중/);
    expect(desc.textContent).toBe('진화 정지 중 · 다음 부화 샤이니 확률 8배');
    // Joined, not concatenated: the old line appended ' · ' to each fragment and
    // dangled a separator whenever the last one was absent.
    expect(desc.textContent).not.toMatch(/·\s*$/);
    expect(screen.queryByText('고르면 여기에 설명이 나옵니다.')).toBeNull();

    // Pointing at a row still wins, and letting go gives the effects back.
    await user.hover(screen.getByRole('button', { name: /이상한사탕/ }));
    expect(screen.getByText('지금 단계 진행도를 25% 채웁니다.')).toBeTruthy();
    await user.unhover(screen.getByRole('button', { name: /이상한사탕/ }));
    expect(screen.getByText('지금 걸린 효과')).toBeTruthy();
  });

  it('gives a passive item a pocket of its own, and no button', async () => {
    payload = { ...STATE, bag: { ...STATE.bag, inventory: { 'key-stone': 1, 'rare-candy': 2 } } };
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '가방' }));

    // 도구 holds what a button belongs on, so the key stone is not in it.
    expect(screen.queryByText('키스톤')).toBeNull();
    const candyRow = [...document.querySelectorAll('.items li')].find((li) =>
      li.textContent?.includes('이상한사탕'),
    )!;
    expect(candyRow.textContent).toContain('×2');
    expect(screen.getByRole('button', { name: '사용' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '중요한 물건' }));
    // Holding it IS the effect, so there is nothing to press...
    const keyRow = [...document.querySelectorAll('.items li')].find((li) =>
      li.textContent?.includes('키스톤'),
    )!;
    expect(keyRow.querySelector('button.rowbtn')).toBeTruthy(); // still selectable
    expect(keyRow.textContent).toContain('보유 중');
    expect([...keyRow.querySelectorAll('button')].filter((b) => !b.className.includes('rowbtn')))
      .toHaveLength(0);
    // ...and no count, because an accessory is not a stack.
    expect(keyRow.textContent).not.toContain('×1');
    // The consumable is not in here either — the split runs both ways.
    expect(screen.queryByText(/이상한사탕/)).toBeNull();
  });

  it('shows one bag pocket at a time', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '가방' }));
    // 도구 is open by default, so the machines are not on screen at all.
    expect(screen.getByRole('button', { name: /이상한사탕/ })).toBeTruthy();
    expect(screen.queryByText('파괴광선')).toBeNull();

    await user.click(screen.getByRole('button', { name: '기술머신' }));
    expect(screen.getByText('파괴광선')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /이상한사탕/ })).toBeNull();

    // Four pockets, and the hunt settings are not one of them — they went to 설정.
    for (const p of ['도구', '중요한 물건', '기술머신', '메가스톤']) {
      expect(screen.getByRole('button', { name: p })).toBeTruthy();
    }
    expect(screen.queryByText('자동사냥')).toBeNull();
  });

  it('groups the shop into shelves, and filters to one at a time', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '상점' }));

    // 전체 by default, with a heading over each shelf.
    expect(screen.getByRole('heading', { name: '알' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '진화' })).toBeTruthy();
    expect(screen.getByText('키스톤')).toBeTruthy();
    expect(screen.getByText('전설의 알')).toBeTruthy();

    // One shelf, and the heading goes away because the chip already says it.
    await user.click(screen.getByRole('button', { name: '진화' }));
    expect(screen.getByText('키스톤')).toBeTruthy();
    expect(screen.queryByText('전설의 알')).toBeNull();
    expect(screen.queryByRole('heading', { name: '진화' })).toBeNull();

    await user.click(screen.getByRole('button', { name: '전체' }));
    expect(screen.getByText('전설의 알')).toBeTruthy();
  });

  it('puts the usable mega stone first and says so', async () => {
    payload = {
      ...STATE,
      bag: {
        ...STATE.bag,
        inventory: { 'key-stone': 1 },
        stones: [
          { id: 10279, ko: '우츠보트나이트', formKo: '메가우츠보트', count: 1, usable: false, sprite: null },
          { id: 10034, ko: '리자몽나이트X', formKo: '메가리자몽X', count: 1, usable: true, sprite: 'item-charizardite-x.png' },
        ],
      },
    };
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '가방' }));

    await user.click(screen.getByRole('button', { name: '메가스톤' }));
    // Sorted usable-first: a hundred stones by id is a wall, and the one that
    // matters is the one this companion can actually use.
    const rows = [...document.querySelectorAll('.items li')].filter((li) =>
      /나이트/.test(li.textContent ?? ''),
    );
    expect(rows[0].textContent).toContain('리자몽나이트X');
    expect(rows[0].className).toContain('usable');
    expect(screen.getByText('지금 쓸 수 있음')).toBeTruthy();
    // The key stone is already in the bag, so the nudge is not shown.
    expect(screen.queryByText(/키스톤이 있으면/)).toBeNull();
  });

  it('nudges toward the key stone when a usable stone is sitting unused', async () => {
    payload = {
      ...STATE,
      bag: {
        ...STATE.bag,
        inventory: {},
        stones: [
          { id: 10034, ko: '리자몽나이트X', formKo: '메가리자몽X', count: 1, usable: true, sprite: null },
        ],
      },
    };
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '가방' }));
    await user.click(screen.getByRole('button', { name: '메가스톤' }));
    expect(screen.getByText(/키스톤이 있으면 배틀에서 메가진화합니다/)).toBeTruthy();
  });

  it('asks which partner to fuse with when there are two', async () => {
    const posts: unknown[] = [];
    payload = {
      ...STATE,
      companion: {
        ...STATE.companion,
        fusions: [
          { id: 10022, ko: '블랙큐레무', partner: 644, partnerKo: '제크로무', sprite: null },
          { id: 10023, ko: '화이트큐레무', partner: 643, partnerKo: '레시라무', sprite: null },
        ],
      },
      bag: { ...STATE.bag, inventory: { 'dna-splicers': 1 } },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).startsWith('/api/state')) {
          return { ok: true, json: async () => payload } as Response;
        }
        posts.push(JSON.parse(String(init?.body)));
        return { ok: true, json: async () => ({ ok: true, message: '블랙큐레무가 되었습니다.' }) } as Response;
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '가방' }));

    // Named by the partner, not by the result: "which one do I spend" is the
    // question being asked.
    await user.click(screen.getByRole('button', { name: '레시라무' }));
    expect(posts).toContainEqual(
      expect.objectContaining({ action: 'use', id: 'dna-splicers', slot: 10023 }),
    );
  });

  it('offers the battle form as a display switch on the partner', async () => {
    const posts: unknown[] = [];
    payload = {
      ...STATE,
      companion: {
        ...STATE.companion,
        // The row comes from `forms` now; `battleForm` is only the resolved one.
        forms: [
          { id: 10034, kind: 'mega', ko: '메가리자몽X', stone: { ko: '리자몽나이트X', have: true }, item: true, ready: true },
        ],
        battleForm: { id: 10034, kind: 'mega', ko: '메가리자몽X', sprite: '10034-w.gif' },
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).startsWith('/api/state')) {
          return { ok: true, json: async () => payload } as Response;
        }
        posts.push(JSON.parse(String(init?.body)));
        return { ok: true, json: async () => ({ ok: true, message: '배틀 모습으로 보여줍니다.' }) } as Response;
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await ready();
    expect(screen.getByText('배틀에서')).toBeTruthy();
    expect(screen.getAllByText('메가리자몽X').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: '꺼짐' }));
    expect(posts).toContainEqual(expect.objectContaining({ action: 'form', id: 'on' }));
  });

  /**
   * The row used to appear only once everything was satisfied, so the one
   * moment it could have helped was the one moment it was absent.
   */
  it('says what is missing before the form is possible', async () => {
    payload = {
      ...STATE,
      companion: {
        ...STATE.companion,
        forms: [
          { id: 10290, kind: 'mega', ko: '메가저리더프', stone: { ko: '저리더프나이트', have: false }, item: false, ready: false },
        ],
        battleForm: null,
      },
    };
    render(<App />);
    await ready();
    expect(screen.getByText('배틀에서')).toBeTruthy();
    expect(screen.getByText(/메가저리더프 · 저리더프나이트 필요/)).toBeTruthy();
  });

  it('asks for the key stone once the stone itself is in hand', async () => {
    payload = {
      ...STATE,
      companion: {
        ...STATE.companion,
        forms: [
          { id: 10290, kind: 'mega', ko: '메가저리더프', stone: { ko: '저리더프나이트', have: true }, item: false, ready: false },
        ],
        battleForm: null,
      },
    };
    render(<App />);
    await ready();
    expect(screen.getByText(/메가저리더프 · 키스톤 필요/)).toBeTruthy();
  });

  it('blames the everstone when that is what is in the way', async () => {
    payload = {
      ...STATE,
      companion: {
        ...STATE.companion,
        forms: [
          { id: 10290, kind: 'mega', ko: '메가저리더프', stone: { ko: '저리더프나이트', have: true }, item: true, ready: false },
        ],
        battleForm: null,
      },
      bag: { ...STATE.bag, everstone: true },
    };
    render(<App />);
    await ready();
    expect(screen.getByText(/메가저리더프 · 변함없는돌을 빼면 가능/)).toBeTruthy();
  });

  it('says nothing about forms for an ordinary Pokemon', async () => {
    // A row reading "없음" on every one of a thousand species is noise.
    render(<App />);
    await ready();
    expect(screen.queryByText('배틀에서')).toBeNull();
  });

  it('shows the status block on the pet tab', async () => {
    render(<App />);
    await ready();
    expect(screen.getByRole('heading', { name: '상태' })).toBeTruthy();
    expect(screen.getByText('작은사자포켓몬', { exact: false })).toBeTruthy();
    expect(screen.getByText('불꽃')).toBeTruthy();
    expect(screen.getByText('노말')).toBeTruthy();
    expect(screen.getByText('0.6m · 13.5kg')).toBeTruthy();
  });

  it('lists each move once, with its power and type, on the partner', async () => {
    render(<App />);
    await ready();
    // The move used to appear on two tabs; it lives in exactly one place now.
    expect(screen.getAllByText('화염방사')).toHaveLength(1);
    expect(screen.getByText(/위력 90/)).toBeTruthy();
    expect(document.querySelector('.items li[data-type=\'fire\']')).toBeTruthy();
  });

  it('scopes the partner hunt numbers to the companion, not the account', async () => {
    // The fixture's lifetime pair is 4.2M / 37; this companion's share is
    // 1.2M / 14. The partner tab is the companion's tab, so it shows the share.
    render(<App />);
    await ready();
    expect(screen.getByText('1.2M')).toBeTruthy();
    expect(screen.getAllByText('14회').length).toBeGreaterThan(0);
    expect(screen.queryByText('37회')).toBeNull();
  });

  it('labels the cap row as the lifetime pair it really is', async () => {
    // The ceiling weighs everything hunting ever did against everything ever
    // earned, so it cannot be split per companion — the label says so rather
    // than letting three rows look like one axis.
    render(<App />);
    await ready();
    expect(screen.getByText('사냥 상한 (누적)')).toBeTruthy();
    expect(screen.getByText('4.2M / 80.1M')).toBeTruthy();
  });

  it('shows a one-line hunt summary on the partner, and the log on 기록', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    // Eight rows of log here buried the partner's own information.
    expect(screen.getByText(/방금 꼬렛/)).toBeTruthy();
    expect(document.querySelectorAll('.hunts li')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: '사냥 기록 보기' }));
    expect(screen.getByRole('heading', { name: '사냥 기록' })).toBeTruthy();
    expect(document.querySelectorAll('.hunts li').length).toBeGreaterThan(0);
  });

  it('collapses the hunt log until asked for the rest', async () => {
    const many = {
      ...STATE,
      hunt: {
        ...STATE.hunt,
        log: Array.from({ length: 12 }, (_, i) => ({
          ...STATE.hunt.log[0],
          seq: 100 - i,
          wildName: `포켓${i}`,
        })),
      },
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => many }) as never));
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '기록' }));
    expect(document.querySelectorAll('.hunts li')).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: '전체 12건 보기' }));
    expect(document.querySelectorAll('.hunts li')).toHaveLength(12);
    // Expanding reveals the TM pills, and nothing else — the move the companion
    // attacked with used to sit beside the name and no longer does. `.how` is
    // the trainer 승/패 badge now, and these twelve rows are all wild.
    expect(document.querySelectorAll('.hunts .how')).toHaveLength(0);
    expect(document.querySelectorAll('.hunts .tm').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: '접기' }));
    expect(document.querySelectorAll('.hunts li')).toHaveLength(5);
  });

  it('renames the companion from the pencil next to its name', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('button', { name: '이름 바꾸기' }));
    const box = screen.getByLabelText('닉네임');
    await user.type(box, '레오');
    await user.click(screen.getByRole('button', { name: '확인' }));
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const shop = calls.filter(([url]) => String(url) === '/api/shop').at(-1)!;
    expect(JSON.parse(String((shop[1] as RequestInit).body))).toMatchObject({
      action: 'rename',
      id: '레오',
    });
  });

  it('closes the rename box on Escape without sending anything', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('button', { name: '이름 바꾸기' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText('닉네임')).toBeNull();
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.filter(([url]) => String(url) === '/api/shop')).toHaveLength(0);
  });

  it('offers a sprite cache readout and a purge in settings', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '설정' }));
    expect(screen.getByText(/3\.5MB · 42개/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '정리' }));
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const shop = calls.filter(([url]) => String(url) === '/api/shop').at(-1)!;
    expect(JSON.parse(String((shop[1] as RequestInit).body))).toMatchObject({ action: 'sprites' });
  });
  it('shows collected Pokemon as cards with their own art', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '도감' }));
    // Three collected, plus the two locked legendaries the fixture gates —
    // those show as ??? whether or not 미수집 포함 is on, because a slot you
    // cannot see is not a goal.
    expect(document.querySelectorAll('.dex li')).toHaveLength(5);
    expect(document.querySelectorAll('.dex li.unseen')).toHaveLength(2);
    // The shiny entry gets the shiny sprite the server resolved for it.
    const pika = screen.getByText('피카츄✨').closest('li')!;
    expect(pika.querySelector('img')!.getAttribute('src')).toContain('25-ash.gif');
    expect(pika.className).toContain('shinydex');
  });

  /**
   * The dex counts species and the counter counts individuals, so they differ
   * whenever a graduate registered a pre-evolution. Read without units that is
   * indistinguishable from a counter that stopped moving.
   */
  it('gives the species count its own unit and says why it outruns departures', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '도감' }));
    expect(screen.getByText('3').closest('p')!.textContent).toContain('3종 / 1025종');
    expect(screen.getByText(/2마리를 떠나보냈습니다/)).toBeTruthy();
    expect(screen.getByText(/진화 전 단계도 함께 등록되어/)).toBeTruthy();
  });

  it('drops the explanation once the two counts agree', async () => {
    const user = userEvent.setup();
    payload = { ...STATE, retiredCount: 3 };
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '도감' }));
    expect(screen.getByText(/3마리를 떠나보냈습니다/)).toBeTruthy();
    expect(screen.queryByText(/진화 전 단계도 함께 등록되어/)).toBeNull();
  });

  it('keeps the filters folded away until asked', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '도감' }));
    // Eighteen type chips always-on would be most of a screenful.
    expect(screen.queryByRole('heading', { name: '타입' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '필터' }));
    expect(screen.getByRole('heading', { name: '등급' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '세대' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '타입' })).toBeTruthy();
  });

  it('narrows the list by rarity, generation and type', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '도감' }));
    await user.click(screen.getByRole('button', { name: '필터' }));

    await user.click(screen.getByRole('button', { name: '귀함' }));
    expect(document.querySelectorAll('.dex li')).toHaveLength(2); // 리자몽, 나오하
    await user.click(screen.getByRole('button', { name: '9' }));
    expect(document.querySelectorAll('.dex li')).toHaveLength(1); // 나오하
    expect(screen.getByText('나오하')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '초기화' }));
    expect(document.querySelectorAll('.dex li')).toHaveLength(5);

    await user.click(screen.getByRole('button', { name: '불꽃' }));
    expect(document.querySelectorAll('.dex li')).toHaveLength(1); // 리자몽
  });

  it('says so plainly when a filter matches nothing', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '도감' }));
    await user.click(screen.getByRole('button', { name: '필터' }));
    // Not 전설 any more: the locked legendaries are permanently in that bucket,
    // so it can never come back empty. 조금 귀함 matches nothing in the fixture.
    await user.click(screen.getByRole('button', { name: '조금 귀함' }));
    expect(screen.getByText(/조건에 맞는 포켓몬이 없습니다/)).toBeTruthy();
  });

  it('shows a locked legendary as ??? and opens its condition', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '도감' }));

    // Two ??? cards, present without touching 미수집 포함, and pressable —
    // unlike an ordinary unseen slot, which has nothing to say.
    const locked = [...document.querySelectorAll('.dex li.unseen')];
    expect(locked).toHaveLength(2);
    for (const li of locked) expect(li.querySelector('button')).toBeTruthy();
    expect(locked[0].textContent).toContain('???');

    await user.click(locked[1].querySelector('button')!);
    // The grid is replaced, the name is still withheld, and the condition is up.
    expect(document.querySelector('.dex')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('???');
    expect(screen.getByRole('heading', { name: '획득 조건' })).toBeTruthy();
    expect(screen.getByText('도감 300종 · 트레이너 80승')).toBeTruthy();
    expect(screen.getByText(/알을 품어/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '← 목록' }));
    expect(document.querySelector('.dex')).toBeTruthy();
  });

  it('says a met condition is met rather than drawing a full bar', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '도감' }));
    // 프리져's gate is open in the fixture, so its bar would read 100% and say
    // nothing. What matters then is that it can actually turn up.
    const locked = [...document.querySelectorAll('.dex li.unseen')];
    await user.click(locked[0].querySelector('button')!);
    expect(screen.getByText('조우 가능')).toBeTruthy();
    expect(screen.getByText(/야생에서 만날 수 있습니다/)).toBeTruthy();
  });

  it('opens an entry when a card is pressed, and only for collected ones', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '도감' }));
    // Three collected cards plus two locked legendaries — five buttons. An
    // ordinary unseen slot is still not one; only these two are.
    expect(document.querySelectorAll('.dex li button')).toHaveLength(5);

    await user.click(screen.getByRole('button', { name: /리자몽/ }));
    // The grid is replaced, not covered — there is no dialog in this app.
    expect(document.querySelector('.dex')).toBeNull();
    expect(screen.getByRole('button', { name: '← 목록' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/화염포켓몬/)).toBeTruthy());
  });

  it('draws the header from the card, before the entry has arrived', async () => {
    const user = userEvent.setup();
    // A fetch that never settles, so only the card's own data can be on screen.
    const slow = vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/state')) {
        return { ok: true, json: async () => payload } as Response;
      }
      if (String(url).startsWith('/api/dex/')) return new Promise<Response>(() => {});
      return { ok: true, json: async () => [] } as Response;
    });
    vi.stubGlobal('fetch', slow);

    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '도감' }));
    await user.click(screen.getByRole('button', { name: /리자몽/ }));

    // This is the whole reason `dexOpen` holds the card and not an id pair.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('리자몽');
    expect(screen.getByText('#006')).toBeTruthy();
    expect(screen.getByText('불꽃')).toBeTruthy();
    expect(screen.getByText('불러오는 중…')).toBeTruthy();
  });

  it('goes back to the grid and puts the cursor on the card you came from', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '도감' }));
    await user.click(screen.getByRole('button', { name: /리자몽/ }));
    await user.click(screen.getByRole('button', { name: '← 목록' }));

    expect(document.querySelector('.dex')).toBeTruthy();
    /*
     * The grid was unmounted while the entry was open, so the button here is a
     * NEW element. Restoring by a captured node would focus a detached one and
     * do nothing at all, silently — which is why the restore goes by key.
     */
    expect(document.activeElement?.getAttribute('data-key')).toBe('6-n');
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '도감' }));
    await user.click(screen.getByRole('button', { name: /리자몽/ }));
    await user.keyboard('{Escape}');
    expect(document.querySelector('.dex')).toBeTruthy();
  });

  it('fetches an entry once, however often it is reopened', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    const entryCalls = () =>
      (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
        ([url]) => String(url).startsWith('/api/dex/'),
      ).length;

    await user.click(screen.getByRole('tab', { name: '도감' }));
    await user.click(screen.getByRole('button', { name: /리자몽/ }));
    await waitFor(() => expect(entryCalls()).toBe(1));
    await user.click(screen.getByRole('button', { name: '← 목록' }));
    await user.click(screen.getByRole('button', { name: /리자몽/ }));
    // An entry cannot change while the panel is open, so the second open is free.
    expect(entryCalls()).toBe(1);
  });

  it('sends the shiny flag, and files a shiny apart from a plain one', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '도감' }));
    await user.click(screen.getByRole('button', { name: /피카츄/ }));
    const urls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map(([u]) => String(u))
      .filter((u) => u.startsWith('/api/dex/'));
    expect(urls).toEqual(['/api/dex/25?shiny=1']);
  });

  it('leaving the tab closes the entry', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '도감' }));
    await user.click(screen.getByRole('button', { name: /리자몽/ }));
    await user.click(screen.getByRole('tab', { name: '파트너' }));
    await user.click(screen.getByRole('tab', { name: '도감' }));
    expect(document.querySelector('.dex')).toBeTruthy();
  });

  it('draws no flavour box at all when there is no Korean entry', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).startsWith('/api/state')) {
          return { ok: true, json: async () => payload } as Response;
        }
        if (String(url).startsWith('/api/dex/')) {
          return { ok: true, json: async () => ({ ...DEX_ENTRY, flavor: null }) } as Response;
        }
        return { ok: true, json: async () => [] } as Response;
      }),
    );
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '도감' }));
    await user.click(screen.getByRole('button', { name: /리자몽/ }));
    await waitFor(() => expect(screen.getByText(/화염포켓몬/)).toBeTruthy());
    // Absent, not an empty box and not a "설명 없음" line.
    expect(document.querySelector('.dexflavor')).toBeNull();
  });

  it('prints the matchup buckets, and the type tint is really wired', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '도감' }));
    await user.click(screen.getByRole('button', { name: /리자몽/ }));
    await waitFor(() => expect(document.querySelectorAll('.bars.matchups > li')).toHaveLength(5));
    expect(screen.getByText('4배')).toBeTruthy();
    // The games' word for zero, and what Scene.tsx prints for the same number.
    expect(screen.getByText('무효')).toBeTruthy();
    expect(document.querySelector('.matchups [data-type="ground"]')).toBeTruthy();
  });

  it('says the base stats are not what the battle reads', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '도감' }));
    await user.click(screen.getByRole('button', { name: /리자몽/ }));
    await waitFor(() => expect(screen.getByText('534')).toBeTruthy());
    // Without this line a stat chart implies a mechanic this app does not have.
    expect(screen.getByText(/배틀은 종족값을 읽지 않고/)).toBeTruthy();
  });

  it('omits the record rows it has nothing to put in', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).startsWith('/api/state')) {
          return { ok: true, json: async () => payload } as Response;
        }
        if (String(url).startsWith('/api/dex/')) {
          return {
            ok: true,
            json: async () => ({
              ...DEX_ENTRY,
              mine: { ...DEX_ENTRY.mine, nickname: null, formKo: null },
            }),
          } as Response;
        }
        return { ok: true, json: async () => [] } as Response;
      }),
    );
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '도감' }));
    await user.click(screen.getByRole('button', { name: /리자몽/ }));
    await waitFor(() => expect(screen.getByText('등록')).toBeTruthy());
    // "별명: 없음" on nine hundred entries is the row the 파트너 tab declined.
    expect(screen.queryByText('별명')).toBeNull();
    expect(screen.queryByText('떠난 모습')).toBeNull();
  });

  it('offers a retry when the entry cannot be fetched', async () => {
    const user = userEvent.setup();
    let fail = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).startsWith('/api/state')) {
          return { ok: true, json: async () => payload } as Response;
        }
        if (String(url).startsWith('/api/dex/')) {
          if (fail) throw new Error('offline');
          return { ok: true, json: async () => DEX_ENTRY } as Response;
        }
        return { ok: true, json: async () => [] } as Response;
      }),
    );
    render(<App />);
    await ready();
    await user.click(screen.getByRole('tab', { name: '도감' }));
    await user.click(screen.getByRole('button', { name: /리자몽/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: '다시 시도' })).toBeTruthy());
    fail = false;
    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(screen.getByText(/화염포켓몬/)).toBeTruthy());
  });

  it('fetches the full index once, and only when unseen slots are asked for', async () => {
    const user = userEvent.setup();
    render(<App />);
    await ready();
    const dexCalls = () =>
      (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
        ([url]) => String(url) === '/api/dex',
      ).length;

    await user.click(screen.getByRole('tab', { name: '도감' }));
    await user.click(screen.getByRole('button', { name: '필터' }));
    // ~116KB and static, so it must not ride along with every state poll.
    expect(dexCalls()).toBe(0);

    await user.click(screen.getByRole('button', { name: '미수집 포함' }));
    await waitFor(() => expect(document.querySelectorAll('.dex li.unseen').length).toBeGreaterThan(0));
    expect(dexCalls()).toBe(1);
    // An unseen slot shows a placeholder, never a download.
    expect(document.querySelector('.dex li.unseen img')).toBeNull();
    expect(screen.getAllByText('???').length).toBeGreaterThan(0);
  });
});
/**
 * The tab bar declared role="tablist"/role="tab"/aria-selected but implemented
 * none of the keyboard contract those roles promise: no tabIndex, no arrow
 * keys, and all six buttons in the tab order — the opposite of the pattern.
 */
describe('panel tabs — keyboard', () => {
  const user = () => userEvent.setup();

  it('moves selection and focus with the arrow keys', async () => {
    const u = user();
    render(<App />);
    await ready();
    await u.click(screen.getByRole('tab', { name: '파트너' }));

    await u.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: '기록' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '기록' }));
  });

  it('wraps at both ends', async () => {
    const u = user();
    render(<App />);
    await ready();
    await u.click(screen.getByRole('tab', { name: '파트너' }));

    await u.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: '설정' }).getAttribute('aria-selected')).toBe('true');
    await u.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: '파트너' }).getAttribute('aria-selected')).toBe('true');
  });

  it('jumps with Home and End', async () => {
    const u = user();
    render(<App />);
    await ready();
    await u.click(screen.getByRole('tab', { name: '가방' }));

    await u.keyboard('{End}');
    expect(screen.getByRole('tab', { name: '설정' }).getAttribute('aria-selected')).toBe('true');
    await u.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: '파트너' }).getAttribute('aria-selected')).toBe('true');
  });

  it('keeps exactly one tab in the tab order', async () => {
    const u = user();
    render(<App />);
    await ready();
    const inOrder = () => screen.getAllByRole('tab').filter((t) => t.tabIndex === 0);
    expect(inOrder()).toHaveLength(1);
    expect(inOrder()[0].textContent).toContain('파트너');

    await u.click(screen.getByRole('tab', { name: '도감' }));
    expect(inOrder()).toHaveLength(1);
    expect(inOrder()[0].textContent).toContain('도감');
  });

  it('associates the panel with its tab, and lets it be scrolled', async () => {
    render(<App />);
    await ready();
    const panel = screen.getByRole('tabpanel');
    // The panel is the scroll container, so it has to be focusable at all.
    expect(panel.tabIndex).toBe(0);
    expect(panel.getAttribute('aria-labelledby')).toBe('tab-pet');
    for (const t of screen.getAllByRole('tab')) {
      expect(t.getAttribute('aria-controls')).toBe(panel.id);
    }
  });
});

describe('the league party', () => {
  const openParty = async () => {
    const u = userEvent.setup();
    render(<App />);
    await ready();
    await u.click(screen.getByRole('tab', { name: '도감' }));
    await u.click(screen.getByRole('button', { name: /파티/ }));
    return u;
  };

  it('is a third view of the dex, not a tab of its own', async () => {
    // Every candidate is on the grid below it, which is the whole argument
    // for putting it here.
    const u = userEvent.setup();
    render(<App />);
    await ready();
    await u.click(screen.getByRole('tab', { name: '도감' }));
    expect(screen.getByRole('button', { name: '파티 2 / 6' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /파티/ })).toBeNull();
  });

  it('draws six seats, filled and empty', async () => {
    await openParty();
    expect(document.querySelectorAll('.partyseats li')).toHaveLength(6);
    expect(document.querySelectorAll('.partyseats li.empty')).toHaveLength(4);
    // Scoped to the seats: the grid below is still on screen and carries the
    // same names, which is the point of putting the two together.
    const seated = [...document.querySelectorAll('.partyseats .lbl > span')].map(
      (el) => el.textContent,
    );
    expect(seated.join(' ')).toContain('리자몽');
    expect(seated.join(' ')).toContain('거북왕');
  });

  it('names the nearer obstacle first', async () => {
    // One badge of eight, so the badges are what is missing — not the party.
    // Saying "fill six seats" to somebody who cannot enter yet would be true
    // and useless.
    await openParty();
    expect(screen.getByText(/배지 8개를 모으면/)).toBeTruthy();
  });

  it('separates a move it already knows from one that costs a machine', async () => {
    const u = await openParty();
    await u.click(screen.getAllByRole('button', { name: '기술' })[0]);
    // Free, because the dex records 리자몽 having known it.
    expect(screen.getByText('날개치기')).toBeTruthy();
    expect(screen.getByText('이미 배운 기술')).toBeTruthy();
    // And the one out of the bag says out loud that it is spent.
    expect(screen.getByText('기술머신 소비')).toBeTruthy();
  });

  it('marks a dex card that is already fielded', async () => {
    await openParty();
    // 리자몽 is in the party and on the grid; the card wears the accent edge.
    expect(document.querySelectorAll('.dex li.inparty').length).toBeGreaterThan(0);
  });
});

describe('the achievement board', () => {
  const open = async () => {
    const u = userEvent.setup();
    render(<App />);
    await ready();
    await u.click(screen.getByRole('tab', { name: '업적' }));
    return u;
  };

  it('draws all eight badge slots, earned or not', async () => {
    await open();
    // A checklist, not a shelf: the seven you have not won are the point.
    expect(screen.getByRole('heading', { level: 3, name: /배지\s*1 \/ 8/ })).toBeTruthy();
    const slots = document.querySelectorAll('.badgecase li');
    expect(slots).toHaveLength(8);
    expect(document.querySelectorAll('.badgecase li.unseen')).toHaveLength(7);
    // Every slot draws real art, including the ones not yet earned.
    expect(document.querySelectorAll('.badgecase img')).toHaveLength(8);
  });

  it('says what an earned slot is and where an unearned one waits', async () => {
    await open();
    // Earned: the badge's own name, and the TM it came with.
    expect(screen.getByText('회색배지')).toBeTruthy();
    expect(screen.getByText('암석봉인')).toBeTruthy();
    // Not yet: the city, and how far the journey still has to walk.
    expect(screen.getByText('블루시티')).toBeTruthy();
    expect(screen.getByText('47조우')).toBeTruthy();
    // Shut behind the other seven, which is 상록시티 and only ever 상록시티.
    expect(screen.getByText('배지 7개 필요')).toBeTruthy();
  });

  it('keeps the case up when a category is filtered', async () => {
    // It is the case, not a group of the board, so the chips do not hide it.
    const u = await open();
    await u.click(screen.getByRole('button', { name: '도감' }));
    expect(document.querySelectorAll('.badgecase li')).toHaveLength(8);
  });

  it('counts what is done against the whole board', async () => {
    await open();
    expect(screen.getByRole('heading', { name: '업적' })).toBeTruthy();
    expect(screen.getByText(/개 \/ 3개 달성/)).toBeTruthy();
  });

  it('groups by category, with a count on each heading', async () => {
    await open();
    // The shop's shelf idiom: a heading per group while nothing is filtered.
    expect(screen.getByRole('heading', { level: 3, name: /육성/ })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: /도감/ })).toBeTruthy();
    // 육성 holds the finished one-shot and the repeat; only the one-shot counts.
    expect(screen.getByRole('heading', { level: 3, name: /육성\s*1 \/ 2/ })).toBeTruthy();
  });

  it('drops the headings once a single category is chosen', async () => {
    const u = await open();
    await u.click(screen.getByRole('button', { name: '도감' }));
    // The board's own group headings, not the badge case's — that one is not
    // part of the board and stays put whatever the chips say.
    expect(
      screen.queryAllByRole('heading', { level: 3 }).filter((h) =>
        h.className.includes('awardshelf'),
      ),
    ).toEqual([]);
    expect(screen.queryByText('첫 졸업')).toBeNull();
    expect(screen.getByText('도감 50종')).toBeTruthy();

    await u.click(screen.getByRole('button', { name: '전체' }));
    expect(screen.getByText('첫 졸업')).toBeTruthy();
  });

  it('shows what an unlocked row paid, and how far a locked one has to go', async () => {
    await open();
    expect(screen.getByText('첫 졸업')).toBeTruthy();
    expect(screen.getByText(/한 마리를 도감으로 떠나보냈다/)).toBeTruthy();
    // A locked row states the bar rather than the prize, and names the item it
    // is holding, because that is the reason to keep going.
    expect(screen.getByText('3 / 50')).toBeTruthy();
    expect(screen.getByText(/보상: 반짝반짝부적/)).toBeTruthy();
  });

  it('shows a repeating row as a running count with its next target', async () => {
    await open();
    // Twice paid, and still going — so it reports the count, not a prize, and
    // says where the next step is.
    expect(screen.getByText(/2회 · \+/)).toBeTruthy();
    expect(screen.getByText(/다음 30/)).toBeTruthy();
  });

  it('never dims a repeating row, however many times it has paid', async () => {
    await open();
    const rows = [...document.querySelectorAll('.awards li')];
    expect(rows).toHaveLength(3);
    // Only the genuinely locked one-shot is dimmed. A repeat is never locked —
    // it is always partway to its next tier — and never finished either.
    expect(rows.filter((r) => r.classList.contains('empty'))).toHaveLength(1);
    // And a row is not pressable: `.row` would reserve the ▶ cursor gutter and
    // promise something to click.
    expect(rows.some((r) => r.classList.contains('row'))).toBe(false);
  });

  it('keeps a gauge on a repeating row but not on a finished one', async () => {
    await open();
    // Three rows, three gauges minus the one that is done for good.
    expect(document.querySelectorAll('.awards .track')).toHaveLength(2);
  });

  it('folds away finished one-shots but leaves the repeats', async () => {
    const u = await open();
    await u.click(screen.getByRole('button', { name: '달성 숨기기' }));
    expect(screen.queryByText('첫 졸업')).toBeNull();
    expect(screen.getByText('잘 가')).toBeTruthy();
    expect(screen.getByText('도감 50종')).toBeTruthy();

    await u.click(screen.getByRole('button', { name: '전부 보기' }));
    expect(screen.getByText('첫 졸업')).toBeTruthy();
  });

  it('says that trainer wins only start counting now', async () => {
    // The one thing the board genuinely cannot look backwards at, so it says so
    // rather than letting a long-running save read as zero wins for no reason.
    await open();
    expect(screen.getByText(/트레이너 승수는 이 업데이트부터 셉니다/)).toBeTruthy();
  });

  it('leaves the board when another tab is chosen', async () => {
    const u = await open();
    await u.click(screen.getByRole('tab', { name: '상점' }));
    expect(screen.queryByText('첫 졸업')).toBeNull();
  });
});

describe('the legendaries', () => {
  it('gives the signature items, fragments and eggs one pocket', async () => {
    const u = userEvent.setup();
    render(<App />);
    await ready();
    await u.click(screen.getByRole('tab', { name: '가방' }));
    await u.click(screen.getByRole('button', { name: '전설' }));

    // Three sections, in the order you meet them.
    expect(screen.getByRole('heading', { level: 3, name: '전용 도구' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: '조각' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: '전설의 알' })).toBeTruthy();

    // An item says who it calls, and can be spent.
    expect(screen.getByText('금강옥')).toBeTruthy();
    expect(screen.getByText(/디아루가를 부릅니다/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '사용' })).toBeTruthy();

    // A part-set of fragments shows the count and offers no button yet.
    expect(screen.getByText('천계의피리 조각')).toBeTruthy();
    expect(screen.getByText('4 / 12')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '합치기' })).toBeNull();

    // An egg says what using it costs before it is pressed.
    expect(screen.getByText(/프리져의 알/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '품기' })).toBeTruthy();
  });

  it('lists every gate with its condition, grouped by generation', async () => {
    const u = userEvent.setup();
    render(<App />);
    await ready();
    await u.click(screen.getByRole('tab', { name: '도감' }));
    await u.click(screen.getByRole('button', { name: '전설 목록' }));

    // The heading stays 도감 — the chips say which of its two views you are on.
    expect(screen.getByRole('heading', { level: 2, name: '도감' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '전설 목록' }).className).toContain('on');
    expect(screen.getByRole('heading', { level: 3, name: /1세대/ })).toBeTruthy();
    expect(screen.getByText('프리져')).toBeTruthy();
    expect(screen.getByText('관동 도감 40종')).toBeTruthy();
    // An open row says so; a shut one shows how far off it is.
    expect(screen.getByText('조우 가능')).toBeTruthy();
    expect(screen.getByText('12 / 300')).toBeTruthy();
    // Only the shut one is dimmed.
    const rows = [...document.querySelectorAll('.awards li')];
    expect(rows.filter((r) => r.classList.contains('empty'))).toHaveLength(1);

    // And the grid is still one chip away.
    await u.click(screen.getByRole('button', { name: '도감' }));
    expect(document.querySelector('.dex')).toBeTruthy();
  });

  it('lights the bag dot for a signature item alone', async () => {
    // The pocket the dot was blind to: no ordinary items at all, one orb.
    payload = {
      ...STATE,
      bag: { ...STATE.bag, inventory: {} },
    };
    render(<App />);
    await ready();
    const bag = screen.getByRole('tab', { name: '가방' });
    expect(bag.querySelector('.dot')).toBeTruthy();
  });

  it('sends the empty legendary pocket to the board', async () => {
    const u = userEvent.setup();
    payload = {
      ...STATE,
      legends: { ...STATE.legends, items: [], shards: [], eggs: [] },
    };
    render(<App />);
    await ready();
    await u.click(screen.getByRole('tab', { name: '가방' }));
    await u.click(screen.getByRole('button', { name: '전설' }));
    await u.click(screen.getByRole('button', { name: '조건 보기' }));

    expect(screen.getByRole('tab', { name: '도감' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { level: 3, name: /1세대/ })).toBeTruthy();
  });
});
