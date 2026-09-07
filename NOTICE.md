# NOTICE — Attribution, Trademarks and Disclaimer

*English first, 한국어는 아래에.*

---

## 1. Disclaimer of affiliation

**PokeTokenPet is an unofficial, non-commercial fan project.**

It is **not** affiliated with, endorsed by, sponsored by, or in any way
officially connected to Nintendo, Creatures Inc., GAME FREAK inc.,
The Pokémon Company, Anthropic PBC, or Pokémon Showdown.

Pokémon and all associated names, characters and images are trademarks and
copyrighted works of **Nintendo, Creatures Inc. and GAME FREAK inc.**
"Claude" and "Claude Code" are trademarks of **Anthropic PBC**.

This project is distributed free of charge. It is not sold, it contains no
advertising, no in-app purchases, no telemetry and no donation link.

## 2. No Pokémon assets are contained in this repository

This is the single most important fact about how this project is built, and it
is enforced by the code, not by a promise:

- **Zero Pokémon images are committed to this repository.** Search it; there
  are none.
- Sprites, battle backdrops and trainer art are **fetched at runtime, on the
  end user's own machine, from third-party public hosts**, and cached under
  `~/.poketokenpet/` on that machine only (`server/sprites.ts`).
- Those cached files are **never bundled into a release artifact and never
  redistributed** by this project.

The runtime sources are:

| What | Host | Note |
|---|---|---|
| Pokémon sprites (Gen-5 B/W, Showdown, static) | [PokeAPI/sprites](https://github.com/PokeAPI/sprites) | Fetched per species, on demand |
| Battle backdrops, trainer sprites | [play.pokemonshowdown.com](https://pokemonshowdown.com) | ~15 files, ~0.2 MB total, once ever |
| Species / move / dex / form text data | [PokeAPI](https://pokeapi.co) | Generated once into `server/*.ts` by `scripts/gen-*.ts` |

If you are a rights holder and want this changed or taken down, please open an
issue on this repository and it will be handled promptly.

## 3. Committed artwork and fonts

Only six kinds of pixels ship inside this repository, and every one of them is
either original or under a licence that permits redistribution:

| Asset | Source | Licence |
|---|---|---|
| UI chrome (windows, panels, buttons) — `src/ui-*.png` | Drawn in-repo by `scripts/gen-ui.ts` | MIT (this repository) |
| App / tray icon — `build/*` | Original artwork | MIT (this repository) |
| Grass & terrain tiles — `src/scenes/*.png` | "Overworld – Grass Biome" by **Beast** | CC0 |
| Town sheet far band | "RPG Town Pixel Art Assets" by **Luis Zuno (@ansimuz)** | CC0 |
| Cave / mountain path / ruins sheets | "Tiny RPG Mountain Tileset" by **Luis Zuno (@ansimuz)** | CC0 † |
| Seaside / desert sheets | "16x16 Overworld Tiles" by **ARoachIFoundOnMyPillow** | CC0 |
| Galmuri pixel font | [quiple/galmuri](https://github.com/quiple/galmuri) | SIL OFL-1.1 |

None of these require on-screen attribution, which is why the application has
no credits screen. They are credited here anyway.

† OpenGameArt records this pack as CC0 (declared by the author, who is also the
submitter). The `public-license.txt` bundled inside the pack does not use the
words "CC0" but grants the same two properties this project relies on —
redistribution permitted and credit not required. Its full text is quoted
verbatim in the header of `scripts/gen-grass.ts`, and `test/payload-shape.test.ts`
asserts that it stays there.

## 4. Privacy

PokeTokenPet reads your local Claude Code transcripts to count tokens:

- **Reads:** `~/.claude/projects/**/*.jsonl`, `~/.claude/sessions/`, `~/.claude.json`
  (for the account label only). Read-only — it never writes to or deletes from
  these.
- **Writes:** `~/.poketokenpet/` — game state and the sprite cache. Nothing else.
- **Sends:** nothing. There is no server, no account, no analytics, no crash
  reporting. The only outbound network requests the app ever makes are the
  sprite/backdrop downloads listed in section 2.

The contents of your conversations are never parsed for text — only the token
count fields on each message are read (`server/usage.ts`).

## 5. Third-party software

Runtime and build dependencies (React, Electron, Vite, and the rest) carry
their own licences; see `package.json` and `node_modules/*/LICENSE`.

---

# 한국어

## 1. 비제휴 고지

**PokeTokenPet은 비공식 · 비영리 팬 프로젝트입니다.**

닌텐도, 크리처스, 게임프리크, 주식회사 포켓몬, Anthropic PBC, Pokémon Showdown
어느 곳과도 제휴·후원·승인 관계가 **없습니다.**

포켓몬 및 관련된 모든 이름·캐릭터·이미지는 **닌텐도 / 크리처스 / 게임프리크**의
상표이자 저작물입니다. "Claude"와 "Claude Code"는 **Anthropic PBC**의 상표입니다.

이 프로젝트는 무료로 배포됩니다. 판매하지 않고, 광고·인앱결제·수집 정보·후원
링크가 일절 없습니다.

## 2. 이 저장소에는 포켓몬 이미지가 하나도 없습니다

약속이 아니라 구조로 지켜집니다:

- **포켓몬 이미지 커밋 0개.** 저장소를 뒤져도 없습니다.
- 스프라이트 · 배틀 배경 · 트레이너 그림은 **사용자 본인의 기기에서 실행 중에**
  외부 공개 호스트로부터 받아 `~/.poketokenpet/`에만 캐시됩니다
  (`server/sprites.ts`).
- 캐시된 파일은 **배포본에 포함되지 않으며 재배포되지 않습니다.**

실행 중 접속하는 곳은 위 영문 표와 같습니다 — PokeAPI/sprites, Pokémon Showdown,
그리고 텍스트 데이터 생성에만 쓰이는 PokeAPI입니다.

권리자께서 수정이나 삭제를 원하시면 이 저장소에 이슈를 남겨 주세요. 즉시
처리하겠습니다.

## 3. 저장소에 커밋된 그림과 폰트

커밋되는 픽셀은 위 영문 표의 여섯 종류뿐이고, 전부 직접 그렸거나 재배포가
허용된 라이선스(CC0 / SIL OFL-1.1)입니다. 여섯 다 화면 크레딧 의무가 없어서
앱 안에 크레딧 화면이 없고, 대신 여기에 적어 둡니다.

## 4. 개인정보

- **읽는 것** — `~/.claude/projects/**/*.jsonl`, `~/.claude/sessions/`,
  `~/.claude.json`(계정 라벨용). 읽기 전용이며 수정·삭제하지 않습니다.
- **쓰는 것** — `~/.poketokenpet/` (게임 상태와 스프라이트 캐시). 그 외 없음.
- **보내는 것** — 없습니다. 서버도 계정도 분석도 크래시 리포트도 없습니다.
  유일한 외부 통신은 2절의 스프라이트 다운로드뿐입니다.

대화 **내용**은 파싱하지 않습니다. 메시지마다 붙은 토큰 수 필드만 읽습니다
(`server/usage.ts`).
