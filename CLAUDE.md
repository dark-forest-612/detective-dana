# CLAUDE.md

Tomboy Web — Svelte 5 + SvelteKit 노트 앱 (Firestore 동기화 + IndexedDB 폴백).
이 문서는 Claude 가 이 저장소에서 작업할 때 참고할 핵심 컨텍스트입니다.

## 개발 명령

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | Vite 개발 서버 |
| `npm test` | Vitest 단일 실행 (jsdom + fake-indexeddb) |
| `npm run test:watch` | 워치 모드 |
| `npm run check` | `svelte-kit sync && svelte-check` (타입 체크) |
| `npm run build` | 프로덕션 빌드 (adapter-static) |
| `npm run rules:build` / `deploy:rules` | Firestore 룰 빌드/배포 |

테스트 + 타입 체크는 PR 단위로 항상 통과해야 함. 현재 테스트 수는 약 770+.

## 디렉터리 개요

```
src/
  lib/
    core/            # 도메인 로직 (notes, notebooks, favorites, categoryOrder)
    components/      # 공통 UI (TopNav, NoteList, TabBar, …)
    desktop/         # 멀티 윈도우 데스크톱 모드 (SidePanel, NoteWindow, session)
    editor/          # TipTap 기반 에디터, 자동 링크, 이미지 프리뷰
    repository/      # Firestore ↔ IndexedDB 추상화
    storage/         # appSettings, syncedSettings, recentNoteLog, db
    firebase/        # Firebase 클라이언트 초기화
    collab/          # 협업 락 / 사용자 신원
    search/          # 노트 풀텍스트 검색
    stores/          # toast, noteListCache 등
  routes/
    +layout.svelte   # TopNav를 포함한 루트 레이아웃 (모바일)
    notes/           # 노트 목록
    note/[id]/       # 노트 편집
    settings/        # 탭 기반 설정 (카테고리/프로필/기기 정보)
    desktop/         # 데스크톱 작업 공간
tests/unit/          # Vitest 유닛 테스트 (60+ 파일)
```

## 주요 데이터 흐름

### 노트
- 단일 데이터 모델 `NoteData` (`$lib/core/note`).
- Firestore 동기화는 `$lib/repository/index.js`의 `noteRepository`로 추상화.
- IndexedDB(`tomboy-web` DB v4) 의 `notes` 객체 저장소가 1차 저장소.
- 메모리 캐시 + 변경 알림: `$lib/stores/noteListCache.ts`.

### 노트북(카테고리)
- 노트북은 별도 엔티티가 아니라 노트의 `system:notebook:{name}` 태그로 표현.
- 템플릿 노트(`system:template`) 가 노트북 메타로 사용됨.
- API: `$lib/core/notebooks.ts` (`listNotebooks`, `createNotebook`, `assignNotebook`, `getCachedNotebooks`, `onNotebooksChanged` 등).

### 카테고리 등록 / 순서 (2026-04 업데이트)
- 네비게이션 바에 표시할 노트북 목록: synced setting `TAB_NOTEBOOKS_KEY` (`tabNotebooks`). **개수 제한 없음**.
- 카테고리 전역 표시 순서: synced setting `CATEGORY_ORDER_KEY` (`categoryOrder`). 누락된 이름은 알파벳 순으로 폴백.
- 정렬 로직은 `$lib/core/categoryOrder.ts`:
  - `applyCategoryOrder(allNotebooks, order)` — `order`에 있는 이름 먼저(존재하는 것만), 나머지는 원래 순서로 뒤에.
  - `moveCategory(order, name, 'up' | 'down')` — 경계에서 no-op.
- 설정 페이지(`/settings`) → "카테고리" 탭에서 체크박스로 등록 토글 + ▲/▼로 순서 조정. 행 컨테이너는 `.category-list-scroll` (max-height 50vh, overflow-y auto)로 스크롤.
- TopNav, 데스크톱 SidePanel 모두 같은 `CATEGORY_ORDER_KEY`를 구독하여 일관된 순서 사용.

### 동기화 설정 (`syncedSettings`)
- `$lib/storage/syncedSettings.ts`. Firebase 가 설정되어 있으면 Firestore `appSettings/{id}` 문서에, 아니면 IndexedDB `appSettings`에 저장.
- 키 상수:
  - `TAB_NOTEBOOKS_KEY = 'tabNotebooks'`
  - `CATEGORY_ORDER_KEY = 'categoryOrder'`
- API: `getSyncedSetting`, `setSyncedSetting`, `subscribeSyncedSetting` (Firebase 가 있을 때 라이브 업데이트).

### 로컬 전용 설정 / 최근 열람 로그
- 디바이스 한정 데이터는 `$lib/storage/appSettings.ts` (`getSetting`, `setSetting`)을 직접 사용.
- 최근 열람 노트 로그: `$lib/storage/recentNoteLog.ts`
  - `recordNoteOpened(guid)` — 가장 앞으로 이동, 중복 제거, `MAX_LOG_SIZE = 200`으로 절단.
  - `getRecentNoteRanks(): Map<guid, rank>` — 0이 가장 최근.
  - `sortByRecentOpen(notes, ranks, fallback?)` — 순수 정렬 함수. 미기록은 `fallback` 또는 입력 순서 유지.
  - `onRecentNoteLogChanged(cb)` — pub/sub.
- **동기화하지 않음** (per-device hint).

## 데스크톱 SidePanel

`src/lib/desktop/SidePanel.svelte` 는 좌측 고정 rail + 호버/핀으로 펼쳐지는 main 컬럼.

### 데이터
- 표시 노트 캡: **50** (`orderSidePanelNotes(...).slice(0, 50)`).
- 정렬 우선순위: 최근 열람 순 → `changeDate` 내림차순 (헬퍼: `$lib/desktop/sidePanelSort.ts`의 `orderSidePanelNotes`).
- 최근 로그는 `desktopSession.openWindow / openWindowAt` 에서 `recordNoteOpened(guid)` 로 기록 (`SETTINGS_WINDOW_GUID` 는 제외).
- 노트북 칩 순서는 `applyCategoryOrder(notebooks, categoryOrder)`.

### 호버/핀 동작 (2026-04 업데이트)
- 두 상태: `hovered` (마우스가 패널 outer boundary 안에 있음), `pinned` (사용자가 명시적으로 활성화).
- `expanded = hovered || pinned` 가 CSS 클래스 `.expanded` 토글을 결정. 확장 시 `clip-path: inset(0 0 0 0); pointer-events: auto;`.
- **핀 트리거**: 패널 내부 `pointerdown` 또는 `focusin`. 핀이 걸린 동안에는 마우스가 떠나도 접히지 않음.
- **핀 해제**: 패널 외부에서 `pointerdown` (전역 `window` 리스너로 감지). `panelRef.contains(target)` 으로 in/out 판별.
- onmouseenter/leave 는 `<aside>` 단위에서만 발화하므로 rail ↔ main 이동 시 깜빡임 없음.
- CSS 셀렉터는 `.side-panel.expanded .main` 단일 규칙 (이전 `.rail:hover ~ .main, .main:hover, :focus-within` 조합 대체).

## TopNav (모바일 상단 바)

`src/lib/components/TopNav.svelte`.
- "전체" + 등록된 모든 노트북 (제한 없음). 순서는 `applyCategoryOrder` 적용.
- 카테고리가 많아지면 `.nav-links-scroll` 클래스로 가로 스크롤 (스크롤바 시각적으로 숨김). 클래스는 무조건 부여돼 있어 jsdom 테스트에서 클래스 존재로 검증 가능.

## 테스트 컨벤션

- Vitest + @testing-library/svelte + jsdom + fake-indexeddb.
- IDB 사용 테스트는 `beforeEach` 에서 `globalThis.indexedDB = new IDBFactory(); _resetDBForTest();`.
- `afterEach` 에 `cleanup(); await new Promise((r) => setTimeout(r, 20));` 패턴 — `onMount` 의 비동기 작업이 다음 테스트로 새지 않게 함.
- `$app/state` (페이지 URL) 는 모듈 레벨 변수 + `vi.mock` 으로 라우트별 stub. (`tests/unit/components/TopNav.test.ts` 참고)
- 라우트 컴포넌트 import 는 `svelte.config.js` 의 `$routes` 별칭 사용 가능 (`$routes/settings/+page.svelte`).
- 컴포넌트 비동기 데이터 로드(syncedSetting 등) 검증 시 `findBy*` 또는 `waitFor` 로 안정화.
- 새 기능은 TDD 사이클 (실패하는 테스트 → 최소 구현 → 리팩토링) 로 진행.

## 코드 스타일

- 들여쓰기는 **탭**.
- TS/JS 는 작은따옴표, Svelte 속성 값은 큰따옴표.
- 한국어 UI 라벨, 코드 주석은 한/영 혼용 가능. 주석은 "왜"만 적기 (이 저장소의 기존 컨벤션 그대로).
- 추가 의존성 도입 전에는 기존 도구로 가능한지 먼저 확인.

## 자주 만지는 진입점

| 변경 의도 | 보통 손대는 파일 |
| --- | --- |
| 노트북 등록 / 순서 UX | `routes/settings/+page.svelte`, `lib/core/categoryOrder.ts` |
| 상단 탭 표시 | `lib/components/TopNav.svelte` |
| 데스크톱 SidePanel (목록/칩/호버) | `lib/desktop/SidePanel.svelte`, `lib/desktop/sidePanelSort.ts` |
| 노트 열림 기록 | `lib/desktop/session.svelte.ts` (openWindow/openWindowAt) |
| 동기 설정 키 추가 | `lib/storage/syncedSettings.ts` (키 상수 export + 구독자 추가) |
| 로컬 전용 설정 | `lib/storage/appSettings.ts` 직접 사용, 필요 시 새 모듈 추가 |
