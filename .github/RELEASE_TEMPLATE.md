## 어느 파일을 받나요 / Which file do I want?

| 내 컴퓨터 | 받을 파일 |
|---|---|
| Mac (Apple Silicon — M1/M2/M3/M4) | `PokeTokenPet-<ver>-arm64-mac.dmg` |
| Mac (Intel) | `PokeTokenPet-<ver>-x64-mac.dmg` |
| Windows (대부분) | `PokeTokenPet-<ver>-x64-win.zip` |
| Windows (ARM — Snapdragon 등) | `PokeTokenPet-<ver>-arm64-win.zip` |

Mac에서 어느 쪽인지 모르겠으면  → 좌측 상단 애플 메뉴 → **이 Mac에 관하여** → `칩`
항목에 Apple이 있으면 arm64, Intel이면 x64입니다.

## 처음 실행할 때 경고가 뜹니다

이 빌드는 **코드 서명이 되어 있지 않습니다.** 바이러스 판정이 아니라, 개인
프로젝트라 연 $99(Apple) / $300+(Windows)짜리 인증서를 붙이지 않았다는 뜻입니다.

- **macOS** — "손상되었기 때문에 열 수 없습니다"가 뜹니다.
  → [docs/MACOS.md](../blob/main/docs/MACOS.md)
- **Windows** — SmartScreen 파란 창이 뜹니다. **추가 정보 → 실행**.
  → [docs/WINDOWS.md](../blob/main/docs/WINDOWS.md)

찜찜하면 소스에서 직접 빌드하세요. `npm ci && npm run app:dist` 한 줄입니다.
위 파일들의 SHA-256은 `SHA256SUMS.txt`에 있습니다.

## 필요한 것

**Claude Code**를 쓴 적이 있어야 합니다. 앱은 `~/.claude/projects/`의 토큰 수만
읽습니다 (대화 내용은 읽지 않고, 아무것도 외부로 보내지 않습니다).

---

⚠️ **Unofficial fan project.** Not affiliated with, endorsed by or connected to
Nintendo, Creatures Inc., GAME FREAK inc., The Pokémon Company or Anthropic.
Pokémon is their trademark. This build contains **no Pokémon assets** — sprites
are downloaded on your own machine at runtime. Code is MIT.
See [NOTICE.md](../blob/main/NOTICE.md).
