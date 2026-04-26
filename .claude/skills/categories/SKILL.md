---
name: categories
description: |
  카테고리(노트북) 등록·표시·순서 관련 코드를 변경할 때 사용.
  Tomboy Web 의 카테고리 모델과 동기화 키 위치를 안내하고,
  네비게이션 바 / 데스크톱 SidePanel / 설정 UI 가 동일한 순서를
  공유하도록 보장하는 변경 패턴을 제시한다.
---

# 카테고리 (노트북) 작업 가이드

## 데이터 모델

- 노트북은 별도 엔티티가 아니라 노트의 `system:notebook:{name}` 태그.
- 템플릿 노트(`system:template`)가 노트북 메타로 사용됨.
- API: `$lib/core/notebooks.ts` (`listNotebooks`, `createNotebook`, `assignNotebook`, `getCachedNotebooks`, `onNotebooksChanged` 등).

## 동기화 설정 키

`src/lib/storage/syncedSettings.ts`:

| 상수 | 값 | 의미 |
| --- | --- | --- |
| `TAB_NOTEBOOKS_KEY` | `'tabNotebooks'` | 네비게이션 바에 표시할 노트북 이름 배열. **개수 제한 없음** |
| `CATEGORY_ORDER_KEY` | `'categoryOrder'` | 카테고리 전역 표시 순서 (문자열 배열) |

추가 키가 필요하면 같은 파일에 export 하고 주석에 의미를 명시.

## 순서 헬퍼

`src/lib/core/categoryOrder.ts`:

```ts
applyCategoryOrder(allNotebooks: string[], order: string[]): string[]
moveCategory(order: string[], name: string, direction: 'up' | 'down'): string[]
```

- `applyCategoryOrder` 는 `order` 에 있는(존재하는) 이름 먼저, 나머지는 원래 순서로 뒤에 붙임.
- 카테고리 순서를 사용하는 모든 컴포넌트는 반드시 이 헬퍼를 거쳐야 한다 (TopNav, SidePanel, Settings).

## 컴포넌트 진입점

| 화면 | 파일 | 책임 |
| --- | --- | --- |
| 모바일 상단 바 | `src/lib/components/TopNav.svelte` | 등록된 노트북을 카테고리 순서로 렌더, 가로 스크롤 |
| 데스크톱 SidePanel | `src/lib/desktop/SidePanel.svelte` | rail 의 노트북 칩을 카테고리 순서로 렌더 |
| 설정 UI | `src/routes/settings/+page.svelte` (카테고리 탭) | 등록 토글 + ▲/▼ 재정렬, 컨테이너 `.category-list-scroll` 세로 스크롤 |

각 진입점은 `subscribeSyncedSetting<string[]>(CATEGORY_ORDER_KEY, ...)` 으로 구독하고 `onMount` cleanup 에서 unsubscribe.

## 주의

- TopNav 는 가로 스크롤 가능해야 함 (`.nav-links-scroll` 클래스가 무조건 부여됨, 스크롤바는 시각적으로 숨김).
- 설정 카테고리 탭의 행 컨테이너는 `.category-list-scroll` (max-height: 50vh; overflow-y: auto). 클래스명을 변경하면 단위 테스트를 함께 갱신.
- 등록 토글 (`TAB_NOTEBOOKS_KEY`) 과 순서 (`CATEGORY_ORDER_KEY`) 는 별도 키. 등록되지 않은 노트북도 순서 배열에 들어 있을 수 있음.

## 테스트 패턴

- 순수 헬퍼는 `tests/unit/categoryOrder.test.ts` 처럼 함수 단위 테스트.
- 컴포넌트는 `setSetting('notebooksCache', [...])` + `setSetting(TAB_NOTEBOOKS_KEY, [...])` + `setSetting(CATEGORY_ORDER_KEY, [...])` 로 IDB 시드 후 렌더, 비동기 결과는 `findBy*` / `waitFor` 로 안정화.
