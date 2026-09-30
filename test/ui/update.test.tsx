// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateBanner } from '../../src/App.tsx';
import type { UpdateStatus } from '../../src/api.ts';

const base: UpdateStatus = {
  phase: 'idle',
  current: '0.4.0',
  version: null,
  url: null,
  received: 0,
  total: 0,
  message: null,
  canInstall: true,
};

/** A bridge whose update channel the test drives by hand. */
function stubBridge(initial: UpdateStatus) {
  let push: (u: UpdateStatus) => void = () => {};
  const pet = {
    getUpdate: vi.fn(async () => initial),
    onUpdate: vi.fn((cb: (u: UpdateStatus) => void) => {
      push = cb;
      return () => {};
    }),
    startUpdate: vi.fn(async () => {}),
    dismissUpdate: vi.fn(async () => {}),
  };
  vi.stubGlobal('pet', pet);
  return { pet, push: (u: UpdateStatus) => act(() => push(u)) };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the update banner', () => {
  it('draws nothing when there is nothing to do', async () => {
    stubBridge(base);
    const { container } = render(<UpdateBanner />);
    await act(async () => {});
    expect(container.querySelector('.updatebar')).toBeNull();
  });

  it('offers the new version, and one press starts everything', async () => {
    const { pet } = stubBridge({ ...base, phase: 'available', version: '0.5.0' });
    render(<UpdateBanner />);
    expect(await screen.findByText('새 버전 v0.5.0이 나왔습니다.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '업데이트' }));
    expect(pet.startUpdate).toHaveBeenCalledOnce();
  });

  it('only reports once the download is going — there is nothing left to click', async () => {
    const { push } = stubBridge({ ...base, phase: 'available', version: '0.5.0' });
    render(<UpdateBanner />);
    await screen.findByText('새 버전 v0.5.0이 나왔습니다.');
    push({ ...base, phase: 'downloading', version: '0.5.0', received: 42, total: 100 });
    expect(screen.getByText('42%')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    push({ ...base, phase: 'installing', version: '0.5.0' });
    expect(screen.getByText(/다시 시작합니다/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says why it failed and offers another try', async () => {
    const { pet } = stubBridge({ ...base, phase: 'error', version: '0.5.0', message: '받은 파일이 손상되었습니다' });
    render(<UpdateBanner />);
    expect(await screen.findByText(/받은 파일이 손상되었습니다/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(pet.startUpdate).toHaveBeenCalledOnce();
  });

  it('sends a machine with no zip to the release page instead', async () => {
    stubBridge({ ...base, phase: 'available', version: '0.5.0', canInstall: false });
    render(<UpdateBanner />);
    expect(await screen.findByRole('button', { name: '받으러 가기' })).toBeTruthy();
  });
});
