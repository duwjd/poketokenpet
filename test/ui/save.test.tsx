// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SaveSettings } from '../../src/panel/SaveSettings.tsx';
import type { ShopReply } from '../../src/api.ts';

/** A bridge whose two save calls answer whatever the test says. */
function stubBridge(exportReply: ShopReply | null, importReply: ShopReply | null = null) {
  const pet = {
    exportSave: vi.fn(async () => exportReply),
    importSave: vi.fn(async () => importReply),
  };
  vi.stubGlobal('pet', pet);
  return pet;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the save file controls', () => {
  it('says where the export went', async () => {
    const pet = stubBridge({ ok: true, message: '내보냈습니다: poketokenpet-2026-11-10.json' });
    render(<SaveSettings />);
    await userEvent.click(screen.getByRole('button', { name: '내보내기' }));
    expect(pet.exportSave).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toContain('내보냈습니다');
  });

  it('says nothing when the dialog is cancelled', async () => {
    stubBridge(null, null);
    render(<SaveSettings />);
    await userEvent.click(screen.getByRole('button', { name: '불러오기' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a refused file as an error, not as news', async () => {
    stubBridge(null, { ok: false, message: 'PokeTokenPet 저장 파일이 아닙니다.' });
    render(<SaveSettings />);
    await userEvent.click(screen.getByRole('button', { name: '불러오기' }));
    const said = screen.getByRole('status');
    expect(said.className).toBe('err');
    expect(said.textContent).toContain('저장 파일이 아닙니다');
  });

  it('holds both buttons while a dialog is open, so a second press cannot stack another', async () => {
    let finish: (r: ShopReply | null) => void = () => {};
    const pet = { exportSave: vi.fn(() => new Promise<ShopReply | null>((r) => (finish = r))), importSave: vi.fn() };
    vi.stubGlobal('pet', pet);
    render(<SaveSettings />);
    await userEvent.click(screen.getByRole('button', { name: '내보내기' }));
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish(null));
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(false);
  });
});
