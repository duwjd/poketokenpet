/**
 * The README's pictures, drawn as a page and captured by scripts/readme-app.mjs.
 *
 * Every section is authored at TWICE the size it is shown at: the README sets
 * `width` to half the capture, so GitHub halves it cleanly. Doubling is the
 * only resize pixel art and a bitmap face survive — which is why every font
 * size here is 24/48/96 (Galmuri11 at 2x/4x/8x) and every frame's border is
 * twice its slice.
 *
 * What is drawn: the app's own frames, the CC0 flower tile, Galmuri, and crops
 * of the screenshots in docs/img/. No sprite is loaded on its own — the
 * Pokemon on these cards are the ones already inside those screenshots.
 */
import '../index.css';
import './readme-art.css';
import windowFrame from '../ui-window.png';
import plate from '../ui-plate.png';
import btnPrimary from '../ui-btn-primary.png';
import flowers from '../scenes/flowers.png';
import icon from '../../build/icon.png';

/**
 * The release the what's-new card describes. Only the card: the banner carries
 * no version of its own, because a number drawn into a picture is stale the
 * day the next release lands — the README's shields badge says it live.
 */
const params = new URLSearchParams(location.search);
const version = params.get('v') ?? '';

const root = document.documentElement.style;
root.setProperty('--img-window', `url("${windowFrame}")`);
root.setProperty('--img-plate', `url("${plate}")`);
root.setProperty('--img-btn', `url("${btnPrimary}")`);
root.setProperty('--img-flowers', `url("${flowers}")`);

/** A 2x crop of one screenshot: x, y, w, h in the screenshot's own pixels. */
const crop = (shot: string, x: number, y: number, w: number, h: number) =>
  `<span class="crop" style="width:${w * 2}px;height:${h * 2}px;` +
  `background-image:url('/docs/img/${shot}.png');` +
  `background-size:${420 * 2}px ${760 * 2}px;` +
  `background-position:${-x * 2}px ${-y * 2}px"></span>`;

/** The battle stage inside every panel shot: 396x220 at (12, 52). */
const STAGE = [12, 52, 396, 220] as const;

const CARDS: { shot: string; box: readonly [number, number, number, number]; title: string; line: string }[] = [
  {
    shot: '01-partner',
    box: [12, 280, 396, 180],
    title: '레벨과 진화',
    line: 'Lv.1에서 100까지, 원작 레벨에 진화합니다',
  },
  {
    shot: '02-battle',
    box: STAGE,
    title: '진짜 배틀',
    line: '종족값·특성·날씨·랭크까지 원작대로',
  },
  {
    shot: '08-gym',
    box: STAGE,
    title: '체육관과 리그',
    line: '9개 지방의 관장이 기다립니다',
  },
  {
    shot: '06-awards',
    box: [12, 166, 396, 186],
    title: '배지 68개',
    line: '지방마다 배지함과 제패 기록',
  },
];

document.body.innerHTML = `
<section id="hero">
  <div class="sky"></div>
  <div class="ground"></div>
  <div class="hero-copy">
    <div class="brand">
      <img class="icon" src="${icon}" alt="">
      <h1>PokeTokenPet</h1>
    </div>
    <p class="tag">AI로 코딩한 만큼<br>포켓몬이 자랍니다</p>
    <p class="sub">Claude Code를 쓰면 알이 부화하고, 진화하고,<br>안 보는 동안 싸우고, 체육관에 도전합니다.</p>
    <div class="plates">
      <span class="plate">macOS · Windows</span>
      <span class="plate">무료 · 계정 없음</span>
      <span class="plate">원클릭 업데이트</span>
    </div>
  </div>
  <div class="win hero-shot">${crop('08-gym', ...STAGE)}</div>
  <img class="hero-pet" src="/docs/img/07-pet.png" alt="">
</section>

<section id="dl-mac" class="dl">
  <span class="btn"><b>▼ macOS용 받기</b><small>dmg · Apple Silicon / Intel</small></span>
</section>
<section id="dl-win" class="dl">
  <span class="btn"><b>▼ Windows용 받기</b><small>zip · x64 / ARM64</small></span>
</section>

<section id="new">
  <h2>${version ? `v${version}에서 ` : ''}새로워진 것</h2>
  <div class="cards">
    ${CARDS.map(
      (c) => `
      <div class="card">
        <div class="win">${crop(c.shot, ...c.box)}</div>
        <h3>${c.title}</h3>
        <p>${c.line}</p>
      </div>`,
    ).join('')}
  </div>
</section>
`;

// The capture script waits on this: fonts and every image decoded.
Promise.all([
  document.fonts.ready,
  ...[...document.images].map((i) => i.decode().catch(() => undefined)),
  ...['01-partner', '02-battle', '06-awards', '08-gym'].map(
    (s) =>
      new Promise((ok) => {
        const i = new Image();
        i.onload = i.onerror = ok;
        i.src = `/docs/img/${s}.png`;
      }),
  ),
]).then(() => {
  document.body.dataset.ready = '1';
});
