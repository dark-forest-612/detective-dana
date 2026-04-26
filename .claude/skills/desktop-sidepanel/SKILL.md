---
name: desktop-sidepanel
description: |
  데스크톱 좌측 SidePanel(rail + 확장 main)의 동작·정렬·핀 로직을
  변경할 때 사용. 호버/핀 상태 머신, 노트 표시 캡, 최근 열람 정렬,
  카테고리 칩 순서를 설명한다.
---

# 데스크톱 SidePanel 가이드

`src/lib/desktop/SidePanel.svelte` 는 항상 보이는 좌측 80px rail 과, 호버/핀 시 펼쳐지는 main 컬럼으로 구성됨.

## 표시 데이터

- 표시 노트 캡: **50** (`orderSidePanelNotes(...).slice(0, 50)`).
- 정렬: 최근 열람 → `changeDate` desc 폴백. 실제 로직은 `src/lib/desktop/sidePanelSort.ts` 의 `orderSidePanelNotes(notes, recentRanks)`.
- 노트북 칩 순서: `applyCategoryOrder(notebooks, categoryOrder)` (카테고리 스킬 참조).

## 최근 열람 로그

`src/lib/storage/recentNoteLog.ts` (로컬 전용, 동기화 안 함):

- `recordNoteOpened(guid)` — 호출 시 가장 앞으로, 중복 제거, MAX 200 절단.
- `getRecentNoteRanks()` — `Map<guid, rank>` (0 = 가장 최근).
- `sortByRecentOpen(notes, ranks, fallback?)` — 순수 정렬.
- `onRecentNoteLogChanged(cb)` — pub/sub.

기록 진입점은 `src/lib/desktop/session.svelte.ts` 의 `openWindow` / `openWindowAt`. 두 함수에서 `void recordNoteOpened(guid).catch(() => {})` 호출. **`SETTINGS_WINDOW_GUID` 는 제외** (kind === 'note' 게이트).

## 호버 / 핀 상태 머신

```
초기   : hovered=false, pinned=false → expanded=false (collapsed)
호버   : 마우스가 aside 영역 진입 → hovered=true → expanded=true
이탈   : 마우스가 aside 영역 이탈 → hovered=false → 핀 안 됐으면 collapsed
클릭   : 패널 내부 pointerdown / focusin → pinned=true (이후 마우스 떠나도 expanded 유지)
외부   : window pointerdown 중 panelRef.contains(target)===false → pinned=false
```

`expanded = hovered || pinned` 가 `.side-panel.expanded` 클래스를 토글하고, CSS 는 `.side-panel.expanded .main` 에서 `clip-path: inset(0 0 0 0); pointer-events: auto;`.

### 주의

- `onmouseenter` / `onmouseleave` 는 `<aside>` 단위. rail ↔ main 내부 이동에서는 발화하지 않으므로 깜빡임이 없다. `onmouseover` 등으로 바꾸지 말 것.
- 전역 `pointerdown` 리스너는 반드시 `onMount` cleanup 에서 `removeEventListener` 해야 함.
- `panelRef` 는 `<aside>` 에 `bind:this` 로 연결.
- 키보드 접근성을 위해 `onfocusin` 도 핀을 건다.

## 테스트

- 정렬 헬퍼는 `tests/unit/desktop/sidePanel.sort.test.ts` 에서 함수 단위 검증.
- `desktopSession` 의 기록 동작은 `tests/unit/desktop/desktopSession.recentLog.test.ts`.
- 호버/핀 클래스 전이는 `tests/unit/desktop/sidePanel.pin.test.ts` 에서 `fireEvent.mouseEnter / mouseLeave / pointerDown / focusIn` + 클래스 검사. `getComputedStyle` 의존 금지 (jsdom 한계).

## 표시 캡 변경 시

`SidePanel.svelte` 의 `slice(0, 50)` 와 그 위 주석을 동시에 갱신. 일부 테스트가 캡을 가정하므로 검색 후 업데이트.
