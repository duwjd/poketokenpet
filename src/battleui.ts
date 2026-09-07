import bang from './ui-bang.png';
import sign from './ui-sign.png';
import btn from './ui-btn.png';
import btnDark from './ui-btn-dark.png';
import btnDown from './ui-btn-down.png';
import btnDownDark from './ui-btn-down-dark.png';
import panel from './ui-panel.png';
import panelDark from './ui-panel-dark.png';
import plate from './ui-plate.png';
import plateDark from './ui-plate-dark.png';
import windowFrame from './ui-window.png';
import windowDark from './ui-window-dark.png';

/**
 * Pixel-art chrome for the battle screen.
 *
 * Drawn by scripts/gen-ui.ts rather than downloaded — there is no Creative
 * Commons version of the real battle UI and there cannot be, so the frames are
 * a reproduction. See that file.
 *
 * Separate images rather than one sheet: `border-image-source` slices the WHOLE
 * image and cannot be pointed at a sub-rectangle. Each is a couple of hundred
 * bytes and Vite inlines them.
 *
 * Shared by the panel's scene and the floating pet, which are separate windows
 * with separate stylesheets — hence a module rather than a custom property
 * defined in one of them.
 */
export const UI_WINDOW = windowFrame;
export const UI_PLATE = plate;
export const UI_BANG = bang;
export const UI_SIGN = sign;

/**
 * The same two frames drawn for a dark background.
 *
 * A bitmap cannot follow `prefers-color-scheme`, so there are two of each and
 * CSS picks. Only the panel uses these: the battle diorama is bright at every
 * hour, and `.scene` sets the light ones inline where no media query reaches.
 */
export const UI_WINDOW_DARK = windowDark;
export const UI_PLATE_DARK = plateDark;

/**
 * The quieter frames: a list row, and a button in its two states.
 *
 * Drawn by `plain()` rather than `frame()` — one outline and a fill, with a
 * highlight ring on the lit edge. A message box doubles its edge to read as a
 * window; a 26px button doing that would be mostly edge.
 */
export const UI_PANEL = panel;
export const UI_PANEL_DARK = panelDark;
export const UI_BTN = btn;
export const UI_BTN_DARK = btnDark;
export const UI_BTN_DOWN = btnDown;
export const UI_BTN_DOWN_DARK = btnDownDark;

/** `plain()` draws a single-pixel edge, so these slice at 3. */
export const UI_SLICE_SMALL = 3;

/**
 * How the frames were drawn, so the CSS slice matches.
 *
 * Two numbers rather than one because the two frames are drawn at different
 * sizes: a slice is painted 1:1 into a border of the same width, so the slice
 * IS the line weight, and the little name plates cannot carry the message
 * box's. See scripts/gen-ui.ts.
 */
export const UI_SLICE_WINDOW = 6;
export const UI_SLICE_PLATE = 4;
/**
 * The location sign, 16x16 with a 5px slice.
 *
 * Wider than the plate's 4 because the left slice has to contain the whole
 * signpost bar — border-image stretches the middle, so a bar that spilled out
 * of its slice would be smeared across the plaque.
 */
export const UI_SLICE_SIGN = 5;

/**
 * CSS custom properties for one host element.
 *
 * The slice vars feed `border-image-slice`, which takes an UNITLESS number for
 * a raster source — a px value there is silently ignored and the frame
 * collapses to nothing.
 */
export const battleUiVars = (): Record<string, string> => ({
  '--ui-window': `url("${UI_WINDOW}")`,
  '--ui-plate': `url("${UI_PLATE}")`,
  '--ui-window-dark': `url("${UI_WINDOW_DARK}")`,
  '--ui-plate-dark': `url("${UI_PLATE_DARK}")`,
  '--ui-panel': `url("${UI_PANEL}")`,
  '--ui-panel-dark': `url("${UI_PANEL_DARK}")`,
  '--ui-btn': `url("${UI_BTN}")`,
  '--ui-btn-dark': `url("${UI_BTN_DARK}")`,
  '--ui-btn-down': `url("${UI_BTN_DOWN}")`,
  '--ui-btn-down-dark': `url("${UI_BTN_DOWN_DARK}")`,
  '--ui-slice-small': `${UI_SLICE_SMALL}`,
  '--ui-bang': `url("${UI_BANG}")`,
  '--ui-sign': `url("${UI_SIGN}")`,
  '--ui-slice-sign': `${UI_SLICE_SIGN}`,
  '--ui-slice-window': `${UI_SLICE_WINDOW}`,
  '--ui-slice-plate': `${UI_SLICE_PLATE}`,
});
