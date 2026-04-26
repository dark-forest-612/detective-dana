---
name: tdd-cycle
description: |
  Tomboy Web 저장소의 표준 TDD 사이클로 새 기능을 구현. 사용 시점:
  로직 / 컴포넌트 / 스토어 등에 변경이 필요할 때, 먼저 실패하는 단위
  테스트부터 작성하라고 안내. Vitest + jsdom + fake-indexeddb 환경,
  `beforeEach` 에서 IDB 리셋, `$app/state` mock 등 프로젝트 컨벤션을
  따른다.
---

# TDD 사이클 (Tomboy Web)

## 절차

1. **실패하는 테스트 작성** — `tests/unit/` 아래 적절한 위치(또는 새 폴더)에 추가. 파일명은 보통 `<모듈>.<특징>.test.ts`.
2. `npm test -- <path>` 로 실패 확인.
3. **최소 구현** — 테스트만 통과시키는 가장 작은 변경. 추측/보일러플레이트 금지.
4. `npm test` 로 회귀 없는지 확인. 필요 시 `npm run check`.
5. **리팩토링** — 통과 상태에서 중복 / 불필요한 추상화 정리. 테스트 그대로 통과해야 함.
6. 의미 단위로 commit. 메시지는 "한 줄 요약 + 빈 줄 + 본문" (한국어).

## 테스트 환경 보일러플레이트

```ts
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { _resetDBForTest } from '$lib/storage/db.js';

beforeEach(() => {
	globalThis.indexedDB = new IDBFactory();
	_resetDBForTest();
});

afterEach(async () => {
	cleanup();                                    // 컴포넌트 테스트일 때
	await new Promise((r) => setTimeout(r, 20)); // onMount 비동기 잔존 처리
});
```

## 컴포넌트 테스트 시

- `@testing-library/svelte` 의 `render`, `screen`, `fireEvent`, `userEvent` 사용.
- `$app/state` 가 필요하면 `vi.mock('$app/state', () => ({ get page() { return { url: currentUrl }; } }))` 패턴.
- 라우트 컴포넌트는 `$routes/...` 별칭으로 import (svelte.config.js 에 등록되어 있음).
- 비동기 settings/IDB 로드 후 검증은 `findBy*` 또는 `waitFor`. `getBy*` 후 즉시 비교 금지.

## 코드 스타일

- 들여쓰기 탭, TS 에서는 작은따옴표, Svelte 속성 큰따옴표.
- 주석은 "왜" 만. "무엇" 은 식별자에 맡긴다.
- 새 의존성 추가 전에는 기존 도구로 해결 가능한지 확인.

## 검증 체크리스트

- [ ] `npm test` — 신규 + 기존 전부 통과
- [ ] `npm run check` — 0 error 0 warning
- [ ] 변경 의도와 무관한 파일 수정 없는지 `git diff --stat`
- [ ] 커밋 메시지 한국어, 본문에 "왜" 가 들어가 있는지
