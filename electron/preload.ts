import { contextBridge, ipcRenderer } from 'electron';

/**
 * The only bridge between main and renderer.
 *
 * contextIsolation stays on and nodeIntegration off, so the renderer sees this
 * object and nothing else of Electron or Node.
 */
contextBridge.exposeInMainWorld('pet', {
  getState: (force?: boolean) => ipcRenderer.invoke('pet:getState', force),
  shop: (action: string, id: string, slot?: number | null) =>
    ipcRenderer.invoke('pet:shop', action, id, slot),
  dexIndex: () => ipcRenderer.invoke('pet:dexIndex'),
  dexEntry: (id: number, shiny?: boolean) => ipcRenderer.invoke('pet:dexEntry', id, shiny),
  getPrefs: () => ipcRenderer.invoke('pet:getPrefs'),
  setPrefs: (patch: Record<string, unknown>) => ipcRenderer.invoke('pet:setPrefs', patch),
  isIdle: () => ipcRenderer.invoke('pet:isIdle'),
  sizes: () => ipcRenderer.invoke('pet:sizes'),
  stepSize: (delta: number) => ipcRenderer.invoke('pet:stepSize', delta),
  fitTo: (w: number, h: number) => ipcRenderer.send('pet:fitTo', w, h),
  openPopover: () => ipcRenderer.invoke('pet:openPopover'),

  drag: (dx: number, dy: number) => ipcRenderer.send('pet:drag', dx, dy),
  dragEnd: () => ipcRenderer.send('pet:dragEnd'),
  setInteractive: (v: boolean) => ipcRenderer.send('pet:setInteractive', v),

  onState: (cb: (s: unknown) => void) => {
    const h = (_e: unknown, s: unknown) => cb(s);
    ipcRenderer.on('state', h);
    return () => ipcRenderer.off('state', h);
  },
  onPrefs: (cb: (p: unknown) => void) => {
    const h = (_e: unknown, p: unknown) => cb(p);
    ipcRenderer.on('prefs', h);
    return () => ipcRenderer.off('prefs', h);
  },
  onIdle: (cb: (v: boolean) => void) => {
    const h = (_e: unknown, v: boolean) => cb(v);
    ipcRenderer.on('idle', h);
    return () => ipcRenderer.off('idle', h);
  },
});
