// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PetApp from '../../src/PetApp.tsx';
import { STATE } from './state-fixture.ts';

/**
 * The pet stops animating when nobody can see it.
 *
 * A transparent, always-on-top window is recomposited for every frame its
 * content changes, and `wobble` and `breathe` never stop asking for one. Two
 * signals turn that off, and neither covers the other: `visibilitychange` for a
 * hidden or occluded window, and the main process's `idle` push for sleep and
 * the lock screen, which an always-on-top window sits composited straight
 * through without the page ever being marked hidden.
 */

let idleCb: ((v: boolean) => void) | undefined;

beforeEach(() => {
  idleCb = undefined;
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
  vi.stubGlobal('pet', {
    getState: async () => STATE,
    getPrefs: async () => ({ petSize: 128 }),
    isIdle: async () => false,
    onState: () => () => {},
    onPrefs: () => () => {},
    onIdle: (cb: (v: boolean) => void) => {
      idleCb = cb;
      return () => {};
    },
    setInteractive: () => {},
    fitTo: () => {},
  });
});

let visibility = 'visible';

afterEach(() => {
  cleanup();
  visibility = 'visible';
  vi.unstubAllGlobals();
});

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const root = (c: HTMLElement) => c.querySelector('.pet-root') as HTMLElement;

describe('the pet while nobody is looking', () => {
  it('animates normally when visible and awake', async () => {
    const { container } = render(<PetApp />);
    await settle();
    expect(root(container).className).not.toMatch(/paused/);
    expect(root(container).className).not.toMatch(/asleep/);
  });

  it('pauses when the window goes hidden', async () => {
    const { container } = render(<PetApp />);
    await settle();
    visibility = 'hidden';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(root(container).className).toMatch(/paused/);
    // Occlusion is a guess, so the sprite must stay rendered — a wrong report
    // may not be allowed to make the pet vanish off the desktop.
    expect(root(container).className).not.toMatch(/asleep/);
  });

  it('resumes when the window comes back', async () => {
    const { container } = render(<PetApp />);
    await settle();
    visibility = 'hidden';
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    visibility = 'visible';
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(root(container).className).not.toMatch(/paused/);
  });

  it('pauses and stops rendering the sprite when the machine sleeps', async () => {
    const { container } = render(<PetApp />);
    await settle();
    expect(idleCb).toBeTypeOf('function');
    await act(async () => idleCb?.(true));
    // Asleep or locked is a fact, not a guess, so here the GIF may be dropped
    // out of rendering too — `animation-play-state` cannot stop one.
    expect(root(container).className).toMatch(/paused/);
    expect(root(container).className).toMatch(/asleep/);

    await act(async () => idleCb?.(false));
    expect(root(container).className).not.toMatch(/paused/);
    expect(root(container).className).not.toMatch(/asleep/);
  });
});
