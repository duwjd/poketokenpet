import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Rules that a rendering test cannot see.
 *
 * happy-dom resolves no stylesheet, so `getComputedStyle` in the panel's UI
 * tests reports nothing useful about how anything actually looks. These two
 * regressions were both invisible that way and very visible on screen, so they
 * are pinned against the source instead.
 */
const css = readFileSync('src/App.css', 'utf8');
const scene = readFileSync('src/Scene.css', 'utf8');
const pet = readFileSync('src/PetApp.css', 'utf8');
const index = readFileSync('src/index.css', 'utf8');
const all = [css, scene, pet, index].join('\n');

describe('the item list', () => {
  /**
   * The complaint this whole redesign started from.
   *
   * Making the entire row a `<button>` quietly handed it the pill buttons'
   * fill-on-hover — a style drawn for a 60x28 pill, applied to a 400x44 row —
   * so pointing at a line dyed the whole thing solid teal.
   */
  it('never gives a row the pill buttons\' fill', () => {
    expect(css).toContain('.items button:not(.rowbtn)');
    expect(css).toContain('.items button:not(.rowbtn):hover');
    // And no unscoped form survives that would reach the row again.
    expect(css).not.toMatch(/^\.items button \{/m);
    expect(css).not.toMatch(/^\.items button:hover/m);
  });

  it('gives a pointed-at row a surface, not the accent', () => {
    expect(css).toContain('.items li.row:hover { background: var(--track); }');
  });

  /**
   * PokeAPI files Generation 8 and 9 item icons at 160x160, not the 30x30 every
   * other item is, and the 전용 도구 and 전설의 알 rows wrap their image in a
   * `span.icon` rather than putting the class on it. Without a size the inner
   * image renders at its natural width: measured in headless Chrome, the Rusted
   * Sword drew across the whole panel and over three rows of text.
   */
  it('keeps an icon inside its box however the row wraps it', () => {
    expect(css).toContain('.items .icon img { max-width: 100%; max-height: 100%; }');
    expect(css).toContain('.items img.icon { object-fit: contain; }');
  });

  /** Only the row button is one line; move slots and settings have two. */
  it('flattens only the row button', () => {
    expect(css).toContain('.items .rowbtn.lbl');
    expect(css).toMatch(/\.items \.lbl \{[^}]*flex-direction: column/);
  });
});

describe('the clerk window', () => {
  /**
   * A game text box does not grow, and this one must not: the list sits
   * directly under it, so a taller question would shove every row down under
   * the pointer that was about to click one.
   */
  it('is a fixed height, not a minimum', () => {
    const rule = css.slice(css.indexOf('.saywin {'), css.indexOf('}', css.indexOf('.saywin {')));
    expect(rule).toMatch(/\n  height: \d+px;/);
    expect(rule).not.toContain('min-height');
    expect(rule).toContain('overflow: hidden');
  });

  /** The box that used to be stuck to the bottom of the panel is gone. */
  it('replaced the sticky description box', () => {
    expect(css).not.toContain('.uidesc');
  });
});

/**
 * The pixel-font rules.
 *
 * A bitmap face is drawn at one size and is only crisp at integer multiples of
 * it — anything else resamples the glyph and the Hangul turns to mush. That is
 * not a preference, it is how the format works, so it is pinned here rather
 * than left to whoever adds the next rule.
 */
describe('type', () => {
  const sizes = [...all.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1].trim());

  it('uses only the four sizes the faces are drawn at', () => {
    // 8 Galmuri7 · 10 Galmuri9 · 12 Galmuri11 · 24 Galmuri11 doubled.
    // 20px is the emoji box in a list row and 0 hides text — neither is Galmuri.
    const allowed = new Set(['8px', '10px', '12px', '24px', '20px', '0', 'inherit']);
    const odd = [...new Set(sizes)].filter((v) => !allowed.has(v));
    expect(odd).toEqual([]);
  });

  it('never sizes type in rem', () => {
    // rem follows the root size, which a user can change. A bitmap needs px.
    expect(sizes.filter((v) => v.includes('rem'))).toEqual([]);
  });

  it('turns antialiasing off', () => {
    expect(index).toContain('-webkit-font-smoothing: none');
  });

  it('declares every face it asks for', () => {
    const declared = [...index.matchAll(/font-family:\s*'(Galmuri\d+)'/g)].map((m) => m[1]);
    const used = [...all.matchAll(/font-family:\s*'(Galmuri\d+)'/g)].map((m) => m[1]);
    for (const f of new Set(used)) expect(declared).toContain(f);
  });

  it('points at files the package actually ships', () => {
    for (const [, file] of index.matchAll(/url\('galmuri\/dist\/([^']+)'\)/g)) {
      expect(existsSync(`node_modules/galmuri/dist/${file}`)).toBe(true);
    }
  });
});

describe('the pixel grid', () => {
  it('has no rounded corners anywhere', () => {
    // The one thing that cannot be drawn on a pixel grid.
    for (const sheet of [css, scene, pet]) {
      expect(sheet).not.toMatch(/^\s*border-radius:/m);
    }
  });

  /**
   * The battle platforms are round, and the rule above is why they cannot say
   * so with a border-radius. They are a stepped polygon instead — fifty-two
   * hand-written percentages, which is exactly the kind of thing that rots the
   * first time somebody nudges one number.
   *
   * So this rebuilds the staircase from the ellipse and compares. Thirteen rows
   * down the height; each row's half-width is taken at the row's MID-line and
   * then held across the row, which is why a vertex sits off the curve — it is
   * on the step, and the step is what a pixel platform is made of.
   */
  it('keeps the battle platforms on an ellipse', () => {
    const decl = scene.match(/--pad-shape:\s*polygon\(([^)]*)\)/);
    expect(decl, '--pad-shape is gone').not.toBeNull();
    const points = decl![1]
      .split(',')
      .map((p) => p.trim().split(/\s+/).map((n) => Number.parseFloat(n)));

    const ROWS = 13;
    /** Half-width of the ellipse across row `i`, as a percentage of the box. */
    const half = (i: number) => {
      const dy = ((i + 0.5) / ROWS - 0.5) / 0.5;
      return 50 * Math.sqrt(Math.max(0, 1 - dy * dy));
    };
    const want: number[][] = [];
    for (let i = 0; i < ROWS; i++) {
      want.push([50 + half(i), (i * 100) / ROWS], [50 + half(i), ((i + 1) * 100) / ROWS]);
    }
    for (let i = ROWS - 1; i >= 0; i--) {
      want.push([50 - half(i), ((i + 1) * 100) / ROWS], [50 - half(i), (i * 100) / ROWS]);
    }

    expect(points.length).toBe(want.length);
    points.forEach(([x, y], i) => {
      // The declaration is written to two decimal places.
      expect(x, `x of point ${i}`).toBeCloseTo(want[i][0], 1);
      expect(y, `y of point ${i}`).toBeCloseTo(want[i][1], 1);
    });
  });

  /**
   * The eighteen type tints and four rarity edges are mixed toward the surface
   * a badge sits ON, not the field behind the panel. Mixing toward the field
   * would re-tint every one of them the moment a tab changed colour.
   */
  it('mixes type and rarity colours toward the surface, never the field', () => {
    const mixes = [...css.matchAll(/color-mix\(in srgb, var\(--[tr]\)[^)]*\)/g)].map((m) => m[0]);
    expect(mixes.length).toBeGreaterThan(5);
    for (const m of mixes) {
      // A badge's fill and border mix toward the window it sits in; its TEXT
      // mixes toward the foreground. Neither may reach for the field, which
      // now changes colour per tab and would re-tint all eighteen.
      expect(m === m && (m.includes('var(--surface)') || m.includes('var(--fg)'))).toBe(true);
      expect(m).not.toContain('var(--ground)');
    }
  });
});

/**
 * The design tokens.
 *
 * Before these existed the panel used nineteen different spacing values across
 * eighty-four declarations, five control heights and five horizontal paddings.
 * None of that is visible as a bug; it shows up as "the screen feels untidy",
 * which is the hardest kind of thing to hold still without a test.
 */
describe('the spacing and size system', () => {
  const spacing = [...css.matchAll(/\b(?:margin|padding|gap)[a-z-]*:\s*([^;]+);/g)].map((m) => m[1]);

  it('sizes every gap from the scale', () => {
    // A raw px value here is a value nobody chose twice.
    const raw = spacing.filter((v) => /\d+px/.test(v));
    expect(raw).toEqual([]);
  });

  it('keeps every control to the two heights', () => {
    // Only the things you press or type into. Gauges, sprite boxes and the
    // drawn counter are pictures and size themselves.
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    const odd: string[] = [];
    for (const [, sel, body] of rules) {
      const name = sel.trim().split('\n').at(-1)!.trim();
      if (!/button|\.chip|input|\.tabs|rowbtn|badge/.test(name)) continue;
      const h = body.match(/\bheight:\s*([^;]+);/);
      if (h && /^\d+px$/.test(h[1].trim())) odd.push(`${name} → ${h[1].trim()}`);
    }
    expect(odd).toEqual([]);
  });
});

describe('alignment', () => {
  /**
   * One left edge for the panel.
   *
   * `.app` used to be centred with six rules setting `left` back again, so a
   * heading sat centred and the list under it sat left — nothing shared an
   * edge. Centring is opt-in now, and the list of things that opt in is short
   * enough to write down.
   */
  it('is left by default, and centres only pictures', () => {
    expect(css).toMatch(/\.app \{[^}]*text-align: left/s);
    const centred = [...css.matchAll(/([^{}]+)\{[^}]*text-align:\s*center/g)].map((m) =>
      m[1].trim().split('\n').at(-1)!.trim(),
    );
    expect(centred.sort()).toEqual(['.dex li', '.portrait']);
  });

  it('keeps the row label left, which a button does not inherit', () => {
    // The UA sets `text-align: center` on <button>, so flipping the page to
    // left-aligned sent every row label to the middle until this went back.
    expect(css).toMatch(/\.items \.rowbtn \{[^}]*text-align: left/s);
  });
});

describe('the colour tokens', () => {
  it('leaves no stray hex outside :root and the drawn counter', () => {
    // The counter is a picture — its gradient is art, like the scene's sky.
    const body = css.slice(css.indexOf('.tabs {'));
    const strays = [...body.matchAll(/(?:color|background|border-color):[^;]*?(#[0-9a-fA-F]{3,8})/g)]
      .map((m) => m[1]);
    const inCounter = body.slice(body.indexOf('.mart {'), body.indexOf('.saywin {'));
    const allowed = new Set([...inCounter.matchAll(/#[0-9a-fA-F]{3,8}/g)].map((m) => m[0]));
    expect(strays.filter((h) => !allowed.has(h))).toEqual([]);
  });

  it('has one ground, not one per tab', () => {
    expect(css).not.toContain("data-tab=");
  });
});

/**
 * The two stylesheets both write to :root, and the later one wins.
 *
 * This is not hypothetical: `--pad` was added here for box padding while
 * Scene.css already used `--pad` for the battle platform's GREEN. Scene.css
 * loads second, so every `padding: var(--pad)` in the panel silently became a
 * colour and was dropped — which looked like "the chips are cramped", not like
 * an error.
 */
describe('token names across the two stylesheets', () => {
  const names = (sheet: string) =>
    new Set([...sheet.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]));

  it('never collide', () => {
    const shared = [...names(css)].filter((n) => names(scene).has(n));
    expect(shared).toEqual([]);
  });
});

/**
 * The panel's two margins, which were not equal.
 *
 * Styling `::-webkit-scrollbar` turns the panel's overlay scrollbar into a
 * classic one, and a classic scrollbar is subtracted from the CONTENT box. So
 * the content sat 12px from the left and 12+10=22px from the right, while the
 * tab bar above — which does not scroll — kept 12px on both sides. On a 420px
 * window that reads, correctly, as "the whole thing is shoved left".
 *
 * The fix is arithmetic, which means it can drift silently: the padding is the
 * complement of the rail, and nothing in either declaration says so. These
 * check the sum instead of the values.
 */
describe('the horizontal margins', () => {
  const token = (name: string) => {
    const m = css.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm'));
    if (!m) throw new Error(`no ${name}`);
    return Number(m[1].trim().replace('px', ''));
  };
  const rule = (sel: string) => {
    const m = css.match(new RegExp(`^${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm'));
    if (!m) throw new Error(`no rule for ${sel}`);
    return m[1];
  };
  /** The left/right of a `padding:` shorthand, as token names. */
  const sides = (body: string) => {
    const v = body.match(/\bpadding:\s*([^;]+);/)![1].trim().split(/\s+/);
    return v.length === 1 ? [v[0], v[0]] : [v[1], v[1]];
  };
  const px = (v: string) => token(v.replace(/^var\(|\)$/g, ''));

  it('sizes the panel padding as the complement of the rail', () => {
    // --s2 + --rail === --s4: the content lands on the tab bar's inset.
    expect(token('--s2') + token('--rail')).toBe(token('--s4'));
  });

  it('puts the panel content on the same edges as the tab bar', () => {
    const [tabL, tabR] = sides(rule('.tabs')).map(px);
    const [panL, panR] = sides(rule('.tabpanel')).map(px);
    const rail = token('--rail');
    expect([panL + rail, panR + rail]).toEqual([tabL, tabR]);
  });

  it('reserves the gutter on both edges of everything that scrolls', () => {
    // `auto` draws the bar only when it overflows, so without this a short tab
    // and a long one had different margins and the screen jumped on a switch.
    const scrollers = [...css.matchAll(/([^{}]+)\{([^}]*overflow(?:-y)?:\s*(?:auto|scroll)[^}]*)\}/g)];
    expect(scrollers.length).toBeGreaterThan(0);
    for (const [, sel, body] of scrollers) {
      expect(`${sel.trim().split('\n').at(-1)!.trim()}: ${body}`).toMatch(
        /scrollbar-gutter:\s*stable both-edges/,
      );
    }
  });

  it('sizes the rail from the token, never a raw px', () => {
    const w = css.match(/::-webkit-scrollbar\s*\{\s*width:\s*([^;]+);/)![1].trim();
    expect(w).toBe('var(--rail)');
  });

  it('pads a row equally, and reserves the cursor column by name', () => {
    // 12px on the left "for the rarity strip" — which ends at 6px — put every
    // row's text 4px off its own centre, in the one box the token comment
    // claims starts at 11px like all the others.
    expect(rule('.items li')).not.toMatch(/padding-left/);
    expect(rule('.items li.row')).toMatch(/padding-left:\s*var\(--gutter-cursor\)/);
  });
});

/**
 * What the pet does when nobody can see it.
 *
 * Pinned against the source for the same reason everything else here is:
 * happy-dom resolves no stylesheet, so the rendering test in
 * test/ui/pet-idle.test.tsx can prove the classes land but not what they do.
 */
describe('the pet at rest', () => {
  it('pauses its animations rather than clearing them', () => {
    expect(pet).toContain('animation-play-state: paused');
    // `animation: none` would snap the sprite back to its untransformed pose
    // and jump again on resume, which is visible after a brief occlusion.
    expect(pet).not.toMatch(/\.pet-root\.paused[^{]*\{[^}]*animation:\s*none/);
  });

  it('takes the sprite out of rendering only when asleep', () => {
    // The only way to stop an animated GIF; reserved for sleep and the lock
    // screen, where invisibility is certain rather than a guess.
    expect(pet).toMatch(/\.pet-root\.asleep \.pet-stage[^{]*\{[^}]*content-visibility:\s*hidden/);
    expect(pet).not.toMatch(/\.pet-root\.paused[^{]*\{[^}]*content-visibility/);
  });
});
