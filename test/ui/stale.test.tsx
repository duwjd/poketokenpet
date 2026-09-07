// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App.tsx';
import { STATE } from './state-fixture.ts';

/**
 * A poll failure after the first success used to be completely invisible: the
 * error was recorded but the render guard only showed it when there was no
 * state at all, so the panel went on rendering stale numbers indefinitely.
 */

let ok = true;

beforeEach(() => {
  ok = true;
  // Only the timers the poll uses; faking the whole clock swallows React 19's
  // scheduler, exactly as test/ui/scene.test.tsx notes.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (!ok) return Promise.reject(new Error('HTTP 500'));
      if (String(url).startsWith('/api/state')) {
        return Promise.resolve({ ok: true, json: async () => STATE } as unknown as Response);
      }
      return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const settle = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('stale data', () => {
  it('keeps the last good data on screen when polls start failing', async () => {
    render(<App />);
    await settle();
    expect(screen.getByRole('tablist')).toBeTruthy();

    ok = false;
    await settle(5000);
    await settle(5000);

    // Still rendering, and now saying how old it is.
    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(screen.getByText(/연결 실패 ·/)).toBeTruthy();
  });

  it('says nothing about a single missed poll', async () => {
    render(<App />);
    await settle();
    ok = false;
    await settle(5000);
    expect(screen.queryByText(/연결 실패 ·/)).toBeNull();
  });

  it('clears itself once a poll lands again', async () => {
    render(<App />);
    await settle();
    ok = false;
    await settle(5000);
    await settle(5000);
    expect(screen.getByText(/연결 실패 ·/)).toBeTruthy();

    ok = true;
    await settle(5000);
    expect(screen.queryByText(/연결 실패 ·/)).toBeNull();
  });

  it('forces a real refresh from 다시 시도', async () => {
    render(<App />);
    await settle();
    ok = false;
    await settle(5000);
    await settle(5000);

    ok = true;
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await settle();

    // The panel could never force a refresh before: fetchState has always taken
    // the flag and App never passed it, so every retry hit the 20s server cache.
    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(urls).toContain('/api/state?force=1');
    expect(screen.queryByText(/연결 실패 ·/)).toBeNull();
  });

  it('still shows the fatal screen when the FIRST load fails', async () => {
    ok = false;
    render(<App />);
    await settle();
    // The original path, deliberately untouched: no tabs, just the error.
    expect(screen.getByText(/연결 실패:/)).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
  });
});
