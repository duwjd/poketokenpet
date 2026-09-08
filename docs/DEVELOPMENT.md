# 개발 · 빌드 · 배포

이 저장소를 이어서 개발하고, 빌드하고, 새 버전을 내는 방법입니다.
무엇을 만드는지는 [DESIGN.md](DESIGN.md), 어떻게 만들었는지는
[INTERNALS.md](INTERNALS.md)에 있습니다.

---

## 1. 준비

**Node 22 이상**이 필요합니다 (`--experimental-strip-types`로 `.ts` 스크립트를 직접
실행하므로 낮은 버전에서는 `gen:*`와 `validate`가 돌지 않습니다).

```bash
git clone https://github.com/duwjd/poketokenpet.git
cd poketokenpet
npm install
```

`~/.claude/projects/`에 트랜스크립트가 있어야 셀 토큰이 있습니다. 없어도 앱은 뜨지만
안내 문구만 나옵니다.

## 2. 개발 루프

```bash
npm run electron:dev     # 데스크톱 앱 (Vite HMR + Electron) ← 평소엔 이것
npm run dev              # 브라우저 버전, http://localhost:5173
```

브라우저 버전은 Chrome/Edge의 **"페이지를 앱으로 설치"** 로 독립 창으로도 띄울 수 있습니다.

**두 가지를 동시에 띄워도 안전합니다.** `buildState`가 멱등이라 같은 `state.json`에
두 파이프라인이 붙어도 같은 바이트를 씁니다. 왜 그렇게 만들었는지는
[INTERNALS.md의 "왜 경과시간을 누적하지 않는가"](INTERNALS.md#왜-경과시간을-누적하지-않는가)에
있습니다.

| 명령 | 언제 |
|---|---|
| `npm run electron:dev` | 평소 개발 |
| `npm run dev` | UI만 빠르게 볼 때 |
| `npm test` | 커밋 전 (Vitest, 659개) |
| `npm run lint` | 커밋 전 (oxlint) |
| `npm run validate` | **숫자가 이상할 때 제일 먼저** |

### `npm run validate`를 먼저 의심하세요

토큰 숫자가 의심스러우면 이것부터 돌리세요. 파서를 **실측 데이터와 대조**하고,
[PokeTokenBar](https://github.com/chattymin/PokeTokenBar)가 설치돼 있으면 그 앱의 로그와도
자동으로 맞춰 봅니다. 파서가 틀리는 다섯 가지 방법은
[INTERNALS.md의 "함정 다섯 개"](INTERNALS.md#토큰을-세는-방법--함정-다섯-개)에 있고,
`validate`는 그 다섯 개를 전부 검사합니다.

### 상태를 초기화하려면

```bash
rm -rf ~/.poketokenpet          # 게임 상태 + 설정 + 스프라이트 캐시 전부
rm ~/.poketokenpet/state.json   # 게임만 초기화 (캐시는 유지)
```

`~/.claude/`는 Claude Code의 것이니 **건드리지 마세요.** 이 앱은 거기서 읽기만 합니다.

## 3. 코드를 고칠 때의 규칙

### 생성물은 직접 고치지 않습니다

이 파일들은 `scripts/gen-*.ts`가 PokeAPI에서 만들어 냅니다. 손으로 고치면 다음 재생성 때
조용히 사라집니다.

| 파일 | 재생성 |
|---|---|
| `server/species.ts` | `npm run gen:species` |
| `server/moves.ts` | `npm run gen:moves` |
| `server/dexdata.ts` | `npm run gen:dex` |
| `server/forms.ts` | `npm run gen:forms` |
| `server/legenddata.ts` | `npm run gen:legends` |
| `server/journey.ts` | `npm run gen:journey` |
| `src/scenes/*.png` | `npm run gen:grass` |
| `src/ui-*.png` | `npm run gen:ui` |
| `docs/img/*.png` | `npm run gen:shots` |

반대로 `server/legends.ts`(전설 조우 조건)와 `server/achievements.ts`(업적 표)는
**손으로 쓰는 파일**입니다.

### 새 시스템을 넣으면 업적도 같이 넣습니다

업적은 게임을 다 만든 뒤에 얹는 장식이 아니라 **시스템의 일부**입니다. 새 시스템을
추가하면서 `server/achievements.ts`를 안 건드렸다면 그 변경은 아직 안 끝난 것입니다.
자세한 이유는 [DESIGN.md의 "업적은 시스템과 함께 갑니다"](DESIGN.md#업적은-시스템과-함께-갑니다).

### 저장 상태에 필드를 더하면 `migrate`에 적습니다

`server/store.ts`의 `migrate`가 기존 사용자의 `state.json`을 새 스키마로 올립니다.
빠뜨리면 **이미 플레이 중인 사람만** 깨지고, 새로 설치한 사람은 멀쩡해서 눈치채기 어렵습니다.

### 포켓몬 이미지는 절대 커밋하지 않습니다

새 그림이 필요하면 `server/sprites.ts`의 `cacheAsset`을 타서 **런타임에 받게** 하세요.
겹치지 않는 파일명 접두사만 고르면 타임아웃·네거티브 캐시·중복 제거·원자적 쓰기가 전부
따라옵니다. `test/payload-shape.test.ts`가 이 규칙을 지킵니다.

이건 취향이 아니라 **이 프로젝트를 공개 배포할 수 있게 하는 유일한 근거**입니다 —
[NOTICE.md](../NOTICE.md) 참고.

### README 스크린샷을 다시 뽑으려면

```bash
npm run gen:shots
```

Vite를 :5199에 띄우고, `node_modules`에 이미 있는 Electron으로 패널을 열어
`docs/img/`에 PNG 여덟 장을 씁니다. 화면에는 아무것도 뜨지 않습니다.

**실제 저장 파일은 절대 안 씁니다.** `scripts/shotdata.ts`가 만든 데모 페이로드를
쓰고, `scripts/shot-app.mjs`가 세션 수준에서 `/api/*`를 전부 취소하므로 진짜
`buildState`는 구조적으로 도달할 수 없습니다 — 기록 탭이 어떤 클라이언트를 쓰는지와
14일 활동 이력을 그리기 때문에 이게 중요합니다.

**결과를 CI에서 diff하지 마세요.** 스프라이트 대부분이 애니메이션 GIF라 캡처 순간의
프레임이 매번 다릅니다. 사람이 눈으로 보고 커밋하는 산출물입니다.

UI를 고쳤으면 다시 돌리고, **생성된 PNG를 직접 열어 확인한 뒤** 커밋하세요.

## 4. 빌드

```bash
npm run app:pack     # release/ 에 앱만 (설치본 없이 바로 실행) — 빠름
npm run app:dist     # dmg / zip 배포본 — 느림, 여러 아키텍처
```

`app:dist`는 **현재 OS용만** 만듭니다. mac에서 돌리면 mac dmg/zip 4개(x64·arm64 ×
dmg·zip)가 나오고, Windows zip은 나오지 않습니다. 네 플랫폼을 다 얻는 방법은 CI뿐입니다
(아래 5번).

### 아키텍처를 반드시 명시해야 합니다

`electron-builder.yml`의 `mac`과 `win` 양쪽에 `arch: [x64, arm64]`가 적혀 있습니다.
**이걸 지우면 안 됩니다.** electron-builder는 arch 목록이 없으면 호스트 아키텍처만
만드는데, 실패하지 않고 **조용히 성공**합니다. Apple Silicon에서 릴리스를 내면 Intel Mac
사용자가 받을 파일이 없는 채로 초록불이 켜집니다.

## 5. 릴리스 내기

명령 한 줄입니다.

```bash
npm version patch        # 0.2.1 → 0.2.2, 커밋 + v0.2.2 태그 생성
git push --follow-tags
```

`v*` 태그가 푸시되면 `.github/workflows/release.yml`이:

1. **mac**(macos-14)과 **Windows**(windows-latest) 러너에서 각각 lint · test · 빌드
2. 산출물 6개를 artifact로 올림
3. 합쳐서 `SHA256SUMS.txt`를 만들고 **초안(draft) Release**에 첨부

약 4분 걸립니다. 초안인 것은 의도적입니다 — 사람이 파일 목록을 한 번 보고
**Publish release**를 누르라고.

`npm version minor`(0.3.0), `major`(1.0.0)도 같습니다.

### 태그 없이 리허설하기

GitHub → **Actions** 탭 → 왼쪽 사이드바의 **Release** → **Run workflow**.

`workflow_dispatch`라서 Release는 만들어지지 않고, 빌드 결과물만 실행 페이지에 artifact로
떨어집니다. 워크플로를 고친 뒤에는 태그를 밀기 전에 이걸로 먼저 확인하세요.

> Actions 탭이 비어 보이는 건 **실행 이력이 0개**라서입니다. 워크플로 자체는 왼쪽
> 사이드바에 있습니다. New workflow는 새 파일을 만드는 버튼이니 누르지 마세요.

### electron-builder가 CI에서 혼자 발행하려 듭니다

`app:dist`에 `--publish never`가 붙어 있습니다. **지우지 마세요.**

electron-builder는 CI 환경을 감지하면 아무도 시키지 않아도 GitHub Releases에 업로드를
시작합니다. 토큰이 없으면 이렇게 실패합니다:

```
• Implicit publishing triggered by CI detection.
⨯ GitHub Personal Access Token is not set, neither programmatically,
  nor using env "GH_TOKEN"
```

빈 `GH_TOKEN`을 넣는 것은 해결책이 아닙니다 — 그건 발행을 끄는 게 아니라, **dmg와 zip을
전부 만든 뒤 마지막 업로드에서** 실패하게 만들 뿐입니다. 로그가 "빌드는 다 잘 되고 맨
끝에서 죽는" 모양이면 이걸 의심하세요.

업로드는 릴리스 잡이 artifact를 모아서 하는 일이지 electron-builder가 할 일이 아닙니다.

### 왜 서명하지 않는가

macOS Developer ID는 연 $99, Windows EV 인증서는 연 $300~400이라 개인 프로젝트에는
값어치가 없다고 판단했습니다. 대신 받는 사람이 겪는 경고를 문서로 대신합니다 —
[MACOS.md](MACOS.md), [WINDOWS.md](WINDOWS.md).

여기서 제일 중요한 사실 하나: **macOS Sequoia(15)부터는 우클릭 → 열기가 막혔습니다.**
오래된 안내를 따라 우클릭을 반복하는 사람은 영영 못 엽니다. 시스템 설정 → 개인정보 보호
및 보안의 **그래도 열기**이거나 `xattr -dr com.apple.quarantine` 둘 중 하나여야 합니다.

Windows는 NSIS 설치본보다 **portable zip**이 SmartScreen 경고가 덜해서 zip만 냅니다.

서명을 붙이기로 마음이 바뀌면 `electron-builder.yml`의 `mac.identity: null`을 지우고
CI에 인증서 시크릿을 넣으면 됩니다.

## 6. 막혔을 때

| 증상 | 먼저 볼 곳 |
|---|---|
| 토큰 숫자가 이상하다 | `npm run validate` |
| 빌드는 되는데 CI 맨 끝에서 실패 | 위 "electron-builder가 CI에서" 절 |
| Intel Mac에서 안 열린다 | `electron-builder.yml`의 `arch` 목록 |
| 스프라이트가 안 보인다 | 설정 탭 → 스프라이트 캐시 → 정리, 그리고 콘솔 로그 |
| 기존 사용자만 깨진다 | `server/store.ts`의 `migrate` |
| 트레이 아이콘이 없다 (Windows) | zip을 **폴더로 풀었는지** — [WINDOWS.md](WINDOWS.md) |

앱은 시작할 때 자기 상태를 콘솔에 찍습니다. 이게 1차 진단입니다:

```
[poketokenpet]
  tray          ok · title="355.2M"
  pet           128x128 @ 1344,740 · visible=true · onTop=true · clickThrough=false
  sprite fetch  ok 667-w.gif (32576B)
  companion     레오꼬 1/2 · 51%
```
