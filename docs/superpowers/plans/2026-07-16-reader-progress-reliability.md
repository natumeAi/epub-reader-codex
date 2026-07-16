# Reader Progress Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保留 locations 未就绪时的有效阅读百分比，并通过本地 outbox、串行 latest-wins 请求、keepalive 与前台重试保证最后阅读位置最终同步。

**Architecture:** 无 React 依赖的 `readingProgress` 模块负责数据校验、百分比选择与版本化 localStorage；`useReadingProgressPersistence` 作为单 worker 串行发送所有待同步记录。`useEpubRendition` 只产生位置快照，`ReaderView` 只组合渲染、设置与持久化 hook。

**Tech Stack:** React 19、epub.js 0.3.93、Fetch API、localStorage、Vitest、Testing Library、Playwright

---

## File map

- Create: `client/src/utils/readingProgress.js` — 进度记录校验、locations 百分比选择、outbox 读写和快照比较。
- Create: `client/src/utils/readingProgress.test.js` — 纯函数与损坏存储测试。
- Modify: `client/src/api/readingApi.js` — 支持 `signal`、`keepalive` 并保留 HTTP status。
- Create: `client/src/api/readingApi.test.js` — 验证 fetch 选项和错误 status。
- Create: `client/src/hooks/useReadingProgressPersistence.js` — localStorage-first、单请求、latest-wins 的同步 worker。
- Create: `client/src/hooks/useReadingProgressPersistence.test.jsx` — 串行、失败保留、恢复重试和不可重试错误测试。
- Modify: `client/src/hooks/useEpubRendition.js` — 保存服务端百分比，等待 locations 后再计算准确百分比。
- Create: `client/src/hooks/useEpubRendition.test.jsx` — 复现 2.27% 被重置的异步时序。
- Modify: `client/src/components/reader/ReaderView.jsx` — 删除组件内 debounce 保存器并组合新 hook。
- Create: `client/scripts/verify-reader-progress.mjs` — 浏览器级复现与回归验证。
- Modify: `client/package.json` — 增加进度 Playwright 命令。
- Modify: `.github/workflows/quality.yml` — mobile job 执行进度回归。

### Task 1: Pure progress selection and versioned outbox

**Files:**
- Create: `client/src/utils/readingProgress.test.js`
- Create: `client/src/utils/readingProgress.js`

- [ ] **Step 1: Write failing pure-function tests**

Create `client/src/utils/readingProgress.test.js`:

```js
import { describe, expect, it } from 'vitest';
import {
  PROGRESS_OUTBOX_KEY,
  isSameProgressSnapshot,
  readProgressOutbox,
  sanitizeProgressRecord,
  selectProgressForRelocation,
  writeProgressOutbox,
} from './readingProgress.js';

describe('reading progress utilities', () => {
  it('keeps 2.27 percent until locations are ready', () => {
    const locations = { percentageFromCfi: () => 0 };

    expect(selectProgressForRelocation({
      cfi: 'epubcfi(/6/2!/4/2)',
      lastValidProgress: 0.0227,
      locations,
      locationsReady: false,
    })).toBe(0.0227);
  });

  it('uses and clamps a finite percentage after locations are ready', () => {
    expect(selectProgressForRelocation({
      cfi: 'epubcfi(/6/2!/4/2)',
      lastValidProgress: 0.0227,
      locations: { percentageFromCfi: () => 1.4 },
      locationsReady: true,
    })).toBe(1);
  });

  it('round-trips only valid versioned outbox records', () => {
    const storage = window.localStorage;
    const valid = sanitizeProgressRecord({
      bookId: 9,
      cfi: 'epubcfi(/6/2!/4/2)',
      progress: 0.45,
      chapterHref: 'chapter.xhtml',
      chapterLabel: '第一章',
    });

    expect(writeProgressOutbox({ 9: valid }, storage)).toBe(true);
    expect(readProgressOutbox(storage)).toEqual({ 9: valid });

    storage.setItem(PROGRESS_OUTBOX_KEY, '{broken json');
    expect(readProgressOutbox(storage)).toEqual({});
  });

  it('compares every field in a sent snapshot', () => {
    const snapshot = sanitizeProgressRecord({ bookId: 3, cfi: 'a', progress: 0.1 });

    expect(isSameProgressSnapshot(snapshot, { ...snapshot })).toBe(true);
    expect(isSameProgressSnapshot(snapshot, { ...snapshot, cfi: 'b' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the utility test and verify it fails**

Run: `npm test -- readingProgress.test.js`

Expected: exit code 1 with `Failed to resolve import "./readingProgress.js"`.

- [ ] **Step 3: Implement the pure utility module**

Create `client/src/utils/readingProgress.js`:

```js
export const PROGRESS_OUTBOX_KEY = 'epub-reader:pending-reading-progress:v1';
const OUTBOX_VERSION = 1;

function optionalString(value) {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string' ? value : undefined;
}

function clampProgress(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(1, Math.max(0, numericValue));
}

function defaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function sanitizeProgressRecord(value) {
  if (!value || !Number.isInteger(value.bookId) || value.bookId <= 0) return null;

  const progress = Number(value.progress);
  const cfi = optionalString(value.cfi);
  const chapterHref = optionalString(value.chapterHref);
  const chapterLabel = optionalString(value.chapterLabel);

  if (
    !Number.isFinite(progress) ||
    progress < 0 ||
    progress > 1 ||
    cfi === undefined ||
    chapterHref === undefined ||
    chapterLabel === undefined
  ) {
    return null;
  }

  return {
    bookId: value.bookId,
    cfi,
    progress,
    chapterHref,
    chapterLabel,
  };
}

export function selectProgressForRelocation({
  cfi,
  lastValidProgress,
  locations,
  locationsReady,
}) {
  const fallback = clampProgress(lastValidProgress);
  if (!locationsReady) return fallback;

  try {
    const percentage = locations?.percentageFromCfi?.(cfi);
    return Number.isFinite(percentage) ? clampProgress(percentage, fallback) : fallback;
  } catch {
    return fallback;
  }
}

export function readProgressOutbox(storage = defaultStorage()) {
  if (!storage) return {};

  try {
    const parsed = JSON.parse(storage.getItem(PROGRESS_OUTBOX_KEY));
    if (parsed?.version !== OUTBOX_VERSION || !parsed.records || typeof parsed.records !== 'object') {
      return {};
    }

    return Object.values(parsed.records).reduce((records, candidate) => {
      const record = sanitizeProgressRecord(candidate);
      if (record) records[record.bookId] = record;
      return records;
    }, {});
  } catch {
    return {};
  }
}

export function writeProgressOutbox(records, storage = defaultStorage()) {
  if (!storage) return false;

  try {
    const sanitizedRecords = Object.values(records || {}).reduce((result, candidate) => {
      const record = sanitizeProgressRecord(candidate);
      if (record) result[record.bookId] = record;
      return result;
    }, {});

    if (Object.keys(sanitizedRecords).length === 0) {
      storage.removeItem(PROGRESS_OUTBOX_KEY);
    } else {
      storage.setItem(PROGRESS_OUTBOX_KEY, JSON.stringify({
        version: OUTBOX_VERSION,
        records: sanitizedRecords,
      }));
    }
    return true;
  } catch {
    return false;
  }
}

export function isSameProgressSnapshot(first, second) {
  return Boolean(
    first &&
    second &&
    first.bookId === second.bookId &&
    first.cfi === second.cfi &&
    first.progress === second.progress &&
    first.chapterHref === second.chapterHref &&
    first.chapterLabel === second.chapterLabel,
  );
}
```

- [ ] **Step 4: Run the utility test**

Run: `npm test -- readingProgress.test.js`

Expected: exit code 0 with four passing tests.

- [ ] **Step 5: Commit the pure progress model**

```powershell
git add client/src/utils/readingProgress.js client/src/utils/readingProgress.test.js
git commit -m "test: define reading progress outbox model"
```

### Task 2: Fetch options and HTTP error classification

**Files:**
- Create: `client/src/api/readingApi.test.js`
- Modify: `client/src/api/readingApi.js`

- [ ] **Step 1: Write failing API tests**

Create `client/src/api/readingApi.test.js`:

```js
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveReadingProgress } from './readingApi.js';

describe('saveReadingProgress', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes signal and keepalive to fetch', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ progress: { bookId: 4 } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await saveReadingProgress(4, { cfi: 'cfi', progress: 0.2 }, {
      keepalive: true,
      signal: controller.signal,
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/reading/4', expect.objectContaining({
      keepalive: true,
      signal: controller.signal,
    }));
  });

  it('attaches the HTTP status to a failed save', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(saveReadingProgress(99, { progress: 0.2 })).rejects.toMatchObject({
      message: '无法保存阅读进度',
      status: 404,
    });
  });
});
```

- [ ] **Step 2: Run the API tests and verify the options are absent**

Run: `npm test -- readingApi.test.js`

Expected: exit code 1; the first test shows missing `keepalive`/`signal`, and the second shows missing `status`.

- [ ] **Step 3: Replace `saveReadingProgress` with the compatible options form**

Replace the function in `client/src/api/readingApi.js` with:

```js
export async function saveReadingProgress(
  bookId,
  { cfi, progress, chapterHref, chapterLabel },
  options = {},
) {
  const response = await fetch(`/api/reading/${bookId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cfi, progress, chapterHref, chapterLabel }),
    keepalive: Boolean(options.keepalive),
    signal: options.signal,
  });

  if (!response.ok) {
    const error = new Error('无法保存阅读进度');
    error.status = response.status;
    throw error;
  }

  return response.json();
}
```

- [ ] **Step 4: Run the API tests**

Run: `npm test -- readingApi.test.js`

Expected: exit code 0 with two passing tests.

- [ ] **Step 5: Commit the API contract**

```powershell
git add client/src/api/readingApi.js client/src/api/readingApi.test.js
git commit -m "fix: expose reading save transport options"
```

### Task 3: Serialized latest-wins persistence hook

**Files:**
- Create: `client/src/hooks/useReadingProgressPersistence.test.jsx`
- Create: `client/src/hooks/useReadingProgressPersistence.js`

- [ ] **Step 1: Write failing serialization and retry tests**

Create `client/src/hooks/useReadingProgressPersistence.test.jsx`:

```jsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readProgressOutbox,
  sanitizeProgressRecord,
  writeProgressOutbox,
} from '../utils/readingProgress.js';
import { useReadingProgressPersistence } from './useReadingProgressPersistence.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('useReadingProgressPersistence', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  it('serializes A then sends the newer B without deleting it with A', async () => {
    const first = deferred();
    const second = deferred();
    let inFlight = 0;
    let maximumInFlight = 0;
    const saveProgress = vi.fn((bookId, payload) => {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      const pending = saveProgress.mock.calls.length === 1 ? first : second;
      return pending.promise.finally(() => { inFlight -= 1; });
    });
    const { result } = renderHook(() => useReadingProgressPersistence({ bookId: 7, saveProgress }));

    act(() => {
      result.current.enqueueProgress({ cfi: 'A', progress: 0.1 });
      result.current.enqueueProgress({ cfi: 'B', progress: 0.2 });
    });
    expect(saveProgress).toHaveBeenCalledTimes(1);
    expect(saveProgress.mock.calls[0][1]).toMatchObject({ cfi: 'A' });

    await act(async () => { first.resolve({}); await first.promise; });
    await waitFor(() => expect(saveProgress).toHaveBeenCalledTimes(2));
    expect(saveProgress.mock.calls[1][1]).toMatchObject({ cfi: 'B' });

    await act(async () => { second.resolve({}); await second.promise; });
    await waitFor(() => expect(readProgressOutbox()).toEqual({}));
    expect(maximumInFlight).toBe(1);
  });

  it('keeps a network failure and retries when the page becomes visible', async () => {
    const saveProgress = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce({});
    const { result } = renderHook(() => useReadingProgressPersistence({ bookId: 8, saveProgress }));

    act(() => result.current.enqueueProgress({ cfi: 'offline-cfi', progress: 0.3 }));
    await waitFor(() => expect(saveProgress).toHaveBeenCalledTimes(1));
    expect(readProgressOutbox()[8]).toMatchObject({ cfi: 'offline-cfi' });

    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(saveProgress).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(readProgressOutbox()).toEqual({}));
  });

  it('uses keepalive on pagehide and drops a permanent 404', async () => {
    const notFound = Object.assign(new Error('missing'), { status: 404 });
    const saveProgress = vi.fn().mockRejectedValue(notFound);
    const { result } = renderHook(() => useReadingProgressPersistence({ bookId: 11, saveProgress }));

    act(() => result.current.enqueueProgress({ cfi: 'gone', progress: 0.6 }));
    await waitFor(() => expect(saveProgress).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(readProgressOutbox()).toEqual({}));

    saveProgress.mockResolvedValue({});
    writeProgressOutbox({
      11: sanitizeProgressRecord({ bookId: 11, cfi: 'last', progress: 0.7 }),
    });
    await act(async () => { await Promise.resolve(); });
    act(() => window.dispatchEvent(new Event('pagehide')));
    await waitFor(() => expect(saveProgress).toHaveBeenLastCalledWith(
      11,
      expect.objectContaining({ cfi: 'last' }),
      expect.objectContaining({ keepalive: true }),
    ));
  });
});
```

- [ ] **Step 2: Run the hook tests and verify the hook is missing**

Run: `npm test -- useReadingProgressPersistence.test.jsx`

Expected: exit code 1 with a failed import for `useReadingProgressPersistence.js`.

- [ ] **Step 3: Implement the single-worker outbox hook**

Create `client/src/hooks/useReadingProgressPersistence.js`:

```js
import { useCallback, useEffect, useRef } from 'react';
import { saveReadingProgress } from '../api/readingApi.js';
import {
  isSameProgressSnapshot,
  readProgressOutbox,
  sanitizeProgressRecord,
  writeProgressOutbox,
} from '../utils/readingProgress.js';

function isPermanentFailure(error) {
  return error?.status === 400 || error?.status === 404;
}

function nextRecord(records, preferredBookId) {
  return records[preferredBookId] || Object.values(records)[0] || null;
}

export function useReadingProgressPersistence({
  bookId,
  saveProgress = saveReadingProgress,
}) {
  const memoryOutboxRef = useRef({});
  const storageUnavailableRef = useRef(false);
  const workerRef = useRef(null);
  const keepaliveRequestedRef = useRef(false);
  const saveProgressRef = useRef(saveProgress);

  useEffect(() => {
    saveProgressRef.current = saveProgress;
  }, [saveProgress]);

  const readRecords = useCallback(() => (
    storageUnavailableRef.current ? memoryOutboxRef.current : readProgressOutbox()
  ), []);

  const replaceRecords = useCallback((records) => {
    if (!storageUnavailableRef.current && writeProgressOutbox(records)) {
      memoryOutboxRef.current = {};
      return;
    }

    storageUnavailableRef.current = true;
    memoryOutboxRef.current = records;
  }, []);

  const flushProgress = useCallback((options = {}) => {
    if (options.keepalive) keepaliveRequestedRef.current = true;
    if (workerRef.current) return workerRef.current;

    const worker = (async () => {
      while (true) {
        const records = readRecords();
        const snapshot = nextRecord(records, bookId);
        if (!snapshot) return;

        const keepalive = keepaliveRequestedRef.current;
        keepaliveRequestedRef.current = false;

        try {
          await saveProgressRef.current(snapshot.bookId, {
            cfi: snapshot.cfi,
            progress: snapshot.progress,
            chapterHref: snapshot.chapterHref,
            chapterLabel: snapshot.chapterLabel,
          }, { keepalive });
        } catch (error) {
          if (isPermanentFailure(error)) {
            const currentRecords = readRecords();
            delete currentRecords[snapshot.bookId];
            replaceRecords({ ...currentRecords });
            continue;
          }
          return;
        }

        const currentRecords = readRecords();
        if (isSameProgressSnapshot(currentRecords[snapshot.bookId], snapshot)) {
          delete currentRecords[snapshot.bookId];
          replaceRecords({ ...currentRecords });
        }
      }
    })();

    workerRef.current = worker;
    worker.finally(() => {
      if (workerRef.current === worker) workerRef.current = null;
    });
    return worker;
  }, [bookId, readRecords, replaceRecords]);

  const enqueueProgress = useCallback((progressData) => {
    const record = sanitizeProgressRecord({ bookId, ...progressData });
    if (!record) return false;

    replaceRecords({ ...readRecords(), [record.bookId]: record });
    void flushProgress();
    return true;
  }, [bookId, flushProgress, readRecords, replaceRecords]);

  const retryPendingProgress = useCallback(() => flushProgress(), [flushProgress]);

  useEffect(() => {
    const handlePageHide = () => { void flushProgress({ keepalive: true }); };
    const handlePageShow = () => { void retryPendingProgress(); };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void retryPendingProgress();
    };

    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    void retryPendingProgress();

    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [flushProgress, retryPendingProgress]);

  return { enqueueProgress, flushProgress, retryPendingProgress };
}
```

- [ ] **Step 4: Run the hook tests**

Run: `npm test -- useReadingProgressPersistence.test.jsx`

Expected: exit code 0 with three passing tests, and the maximum in-flight count is one.

- [ ] **Step 5: Commit the persistence worker**

```powershell
git add client/src/hooks/useReadingProgressPersistence.js client/src/hooks/useReadingProgressPersistence.test.jsx
git commit -m "fix: persist latest reading progress reliably"
```

### Task 4: Rendition locations readiness and saved-percentage preservation

**Files:**
- Create: `client/src/hooks/useEpubRendition.test.jsx`
- Modify: `client/src/hooks/useEpubRendition.js`

- [ ] **Step 1: Write the 2.27% asynchronous regression test**

Create `client/src/hooks/useEpubRendition.test.jsx`:

```jsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEpubRendition } from './useEpubRendition.js';

const mocks = vi.hoisted(() => ({
  epubBook: null,
  getReadingProgress: vi.fn(),
}));

vi.mock('epubjs', () => ({ default: vi.fn(() => mocks.epubBook) }));
vi.mock('../api/readingApi.js', () => ({
  getReadingProgress: mocks.getReadingProgress,
}));

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe('useEpubRendition progress', () => {
  beforeEach(() => {
    mocks.getReadingProgress.mockReset();
  });

  it('keeps saved progress before locations and recomputes after generation', async () => {
    const generated = deferred();
    const handlers = {};
    const location = {
      start: {
        cfi: 'epubcfi(/6/2!/4/2)',
        href: 'chapter.xhtml',
        displayed: { page: 2, total: 10 },
      },
    };
    const locations = {
      generate: vi.fn(() => generated.promise),
      percentageFromCfi: vi.fn(() => 0.43),
    };
    const rendition = {
      currentLocation: vi.fn(() => location),
      destroy: vi.fn(),
      display: vi.fn().mockResolvedValue(undefined),
      getContents: vi.fn(() => []),
      hooks: { content: { register: vi.fn() } },
      off: vi.fn(),
      on: vi.fn((name, handler) => { handlers[name] = handler; }),
    };
    mocks.epubBook = {
      destroy: vi.fn(),
      loaded: { navigation: Promise.resolve({ toc: [] }) },
      locations,
      renderTo: vi.fn(() => rendition),
    };
    mocks.getReadingProgress.mockResolvedValue({
      progress: { cfi: location.start.cfi, progress: 0.0227 },
    });

    const enqueueProgress = vi.fn();
    const refs = {
      bookRef: { current: null },
      containerRef: { current: document.createElement('div') },
      currentCfiRef: { current: null },
      isClosingRef: { current: false },
      readerSettingsRef: { current: { horizontalMargin: 24 } },
      renditionRef: { current: null },
    };
    const args = {
      ...refs,
      applyReaderHorizontalMargin: vi.fn().mockResolvedValue(undefined),
      applyReaderSettings: vi.fn(),
      applyReaderSettingsToContents: vi.fn(),
      book: { id: 5 },
      enqueueProgress,
      error: '',
      flushPendingReaderSettings: vi.fn(),
      isLoading: true,
      loadReaderSettings: vi.fn().mockResolvedValue({ horizontalMargin: 24 }),
      markReaderSettingsLoaded: vi.fn(),
      resetPageProgress: vi.fn(),
      resetReaderSettingsLoad: vi.fn(),
      setError: vi.fn(),
      setIsLoading: vi.fn(),
      updatePageProgressFromLocation: vi.fn(),
    };

    const { result } = renderHook(() => useEpubRendition(args));
    await waitFor(() => expect(rendition.display).toHaveBeenCalled());

    act(() => handlers.relocated(location));
    expect(result.current.progress).toBe(0.0227);
    expect(enqueueProgress).toHaveBeenLastCalledWith(expect.objectContaining({ progress: 0.0227 }));

    await act(async () => { generated.resolve(); await generated.promise; });
    await waitFor(() => expect(result.current.progress).toBe(0.43));
    expect(enqueueProgress).toHaveBeenLastCalledWith(expect.objectContaining({ progress: 0.43 }));
  });
});
```

- [ ] **Step 2: Run the regression and observe the reset**

Run: `npm test -- useEpubRendition.test.jsx`

Expected: exit code 1; the pre-generation relocation returns `0` instead of `0.0227`.

- [ ] **Step 3: Import the shared selector and change the hook inputs**

At the top of `client/src/hooks/useEpubRendition.js`, add:

```js
import { selectProgressForRelocation } from '../utils/readingProgress.js';
```

In the hook parameter list, replace `flushPendingChanges` and `scheduleSave` with:

```js
  enqueueProgress,
  flushPendingReaderSettings,
```

- [ ] **Step 4: Replace the saved-progress, display, locations and relocation block**

Inside the async effect, replace the block beginning with `let startCfi;` through the closing brace of the current `relocated` event registration with:

```js
        let startCfi;
        let loadedReaderSettings = readerSettingsRef.current;
        let lastValidProgress = 0;
        let locationsReady = false;

        const [progressResult, settingsResult] = await Promise.allSettled([
          getReadingProgress(book.id),
          loadReaderSettings(),
        ]);

        if (progressResult.status === 'fulfilled') {
          const savedProgress = progressResult.value.progress;
          startCfi = savedProgress?.cfi || undefined;
          if (Number.isFinite(savedProgress?.progress)) {
            lastValidProgress = Math.min(1, Math.max(0, savedProgress.progress));
            setProgress(lastValidProgress);
          }
        }

        if (settingsResult.status === 'fulfilled') {
          loadedReaderSettings = settingsResult.value;
        }

        if (destroyed) return;

        const updateFromLocation = (location) => {
          if (destroyed || !location?.start?.cfi) return;
          const cfi = location.start.cfi;
          const progressValue = selectProgressForRelocation({
            cfi,
            lastValidProgress,
            locations: epubBook.locations,
            locationsReady,
          });

          lastValidProgress = progressValue;
          currentCfiRef.current = cfi;
          setProgress(progressValue);
          updatePageProgressFromLocation(location);
          setCurrentHref(location.start.href || null);
          enqueueProgress({
            cfi,
            progress: progressValue,
            chapterHref: location.start.href || null,
            chapterLabel: null,
          });
        };

        handleRelocated = updateFromLocation;
        rendition.on('relocated', handleRelocated);
        applyReaderSettings(rendition, loadedReaderSettings);
        await rendition.display(startCfi);
        await applyReaderHorizontalMargin(
          rendition,
          loadedReaderSettings.horizontalMargin,
          startCfi,
        );

        if (destroyed) return;
        markReaderSettingsLoaded();
        setIsLoading(false);

        epubBook.loaded.navigation.then((nav) => {
          if (!destroyed) setToc(nav?.toc || []);
        }).catch(() => {});

        epubBook.locations.generate(1024).then(async () => {
          if (destroyed) return;
          locationsReady = true;
          const currentLocation = await Promise.resolve(rendition.currentLocation?.());
          updateFromLocation(currentLocation);
        }).catch(() => {
          locationsReady = false;
        });
```

Declare the handler beside the existing effect locals:

```js
    let destroyed = false;
    let handleRelocated;
    let reapplyReaderSettingsToView;
```

In the effect cleanup, replace `flushPendingChanges();` with the following and retain the existing rendition/book cleanup:

```js
      flushPendingReaderSettings();
      renditionRef.current?.off?.('relocated', handleRelocated);
```

In the page lifecycle effect, replace both hidden-state calls to `flushPendingChanges()` with `flushPendingReaderSettings()`. Update both effects' dependency arrays to use `enqueueProgress` and `flushPendingReaderSettings`, and remove `scheduleSave`/`flushPendingChanges`.

- [ ] **Step 5: Run the rendition regression**

Run: `npm test -- useEpubRendition.test.jsx`

Expected: exit code 0; the test observes `0.0227` before generation and `0.43` afterward.

- [ ] **Step 6: Commit the locations readiness fix**

```powershell
git add client/src/hooks/useEpubRendition.js client/src/hooks/useEpubRendition.test.jsx
git commit -m "fix: preserve progress until epub locations load"
```

### Task 5: Compose persistence in ReaderView

**Files:**
- Modify: `client/src/components/reader/ReaderView.jsx`

- [ ] **Step 1: Replace imports and remove component-owned save state**

Remove the `saveReadingProgress` import and `SAVE_DEBOUNCE_MS` declaration. Add:

```js
import { useReadingProgressPersistence } from '../../hooks/useReadingProgressPersistence.js';
```

Remove these two refs from `ReaderView`:

```js
  const saveTimerRef = useRef(null);
  const pendingProgressRef = useRef(null);
```

- [ ] **Step 2: Replace debounce callbacks with the persistence hook**

Delete `flushSave`, `scheduleSave`, and `flushPendingChanges`. Immediately after the destructuring assignment returned by `useReaderSettings`, add:

```js
  const {
    enqueueProgress,
    flushProgress,
  } = useReadingProgressPersistence({ bookId: book?.id });
```

The returned `flushProgress` remains intentionally available for reader-close integration and must not be wrapped in a fire-and-forget timer.

- [ ] **Step 3: Pass the new rendition contract and flush on close**

In the `useEpubRendition` call, remove `flushPendingChanges` and `scheduleSave`, then add:

```js
    enqueueProgress,
    flushPendingReaderSettings,
```

At the beginning of `handleCloseClick`, after the closing guard and before starting animation, add:

```js
    void flushProgress({ keepalive: true });
```

Add `flushProgress` to that callback's dependency array:

```js
  }, [book?.id, flushProgress, onClose]);
```

- [ ] **Step 4: Run focused tests and build**

Run:

```powershell
npm test -- readingProgress.test.js readingApi.test.js useReadingProgressPersistence.test.jsx useEpubRendition.test.jsx
npm run build
```

Expected: all focused tests pass and Vite exits 0 without an undefined prop/import error.

- [ ] **Step 5: Commit ReaderView integration**

```powershell
git add client/src/components/reader/ReaderView.jsx
git commit -m "refactor: move progress persistence out of reader view"
```

### Task 6: Browser regression for non-zero reopen progress

**Files:**
- Create: `client/scripts/verify-reader-progress.mjs`
- Modify: `client/package.json`
- Modify: `.github/workflows/quality.yml`

- [ ] **Step 1: Add the Playwright regression script**

Create `client/scripts/verify-reader-progress.mjs`:

```js
import { chromium } from 'playwright';
import { prepareReaderVerification } from './reader-verification-environment.mjs';

const environment = await prepareReaderVerification();
const browser = await chromium.launch(environment.browserOptions);
const page = await browser.newPage({
  viewport: { width: 375, height: 667 },
  isMobile: true,
  hasTouch: true,
});

async function readProgress(bookId) {
  const response = await fetch(new URL(`/api/reading/${bookId}`, environment.appUrl));
  if (!response.ok) throw new Error(`读取进度失败: ${response.status}`);
  return (await response.json()).progress;
}

try {
  await page.goto(environment.appUrl, { waitUntil: 'networkidle', timeout: 30000 });
  const bookButton = page.locator('.continue-book-button[data-book-id], button.book-shell[data-book-id]').first();
  const bookId = Number(await bookButton.getAttribute('data-book-id'));
  await bookButton.tap();
  await page.waitForSelector('.reader-overlay', { timeout: 15000 });

  for (let index = 0; index < 4; index += 1) {
    await page.locator('.reader-gesture-layer').tap({ position: { x: 340, y: 330 } });
    await page.waitForTimeout(300);
  }

  await page.waitForFunction(async (id) => {
    const response = await fetch(`/api/reading/${id}`);
    const body = await response.json();
    return Boolean(body.progress?.cfi && body.progress.progress > 0);
  }, bookId, { timeout: 15000 });
  const advanced = await readProgress(bookId);

  await page.locator('.reader-gesture-layer').tap({ position: { x: 188, y: 330 } });
  await page.locator('.reader-close-button').click();
  await page.waitForSelector('.reader-overlay', { state: 'detached', timeout: 5000 });

  const seededResponse = await fetch(new URL(`/api/reading/${bookId}`, environment.appUrl), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cfi: advanced.cfi,
      progress: 0.0227,
      chapterHref: advanced.chapterHref,
      chapterLabel: advanced.chapterLabel,
    }),
  });
  if (!seededResponse.ok) throw new Error(`预置进度失败: ${seededResponse.status}`);

  await page.locator(`.continue-book-button[data-book-id="${bookId}"], button.book-shell[data-book-id="${bookId}"]`).first().tap();
  await page.waitForSelector('.reader-overlay', { timeout: 15000 });
  await page.waitForTimeout(3500);

  const reopened = await readProgress(bookId);
  const label = await page.locator('.reader-progress-label').textContent();
  if (!(reopened.progress > 0) || /^0(?:\.0+)?%$/.test(label.trim())) {
    throw new Error(`进度回退：API=${JSON.stringify(reopened)}, UI=${label}`);
  }

  console.log(JSON.stringify({
    bookId,
    seededProgress: 0.0227,
    reopenedProgress: reopened.progress,
    uiLabel: label.trim(),
  }, null, 2));
} finally {
  await browser.close();
  await environment.cleanup();
}
```

- [ ] **Step 2: Add the npm script and CI command**

Add this key to `client/package.json` scripts:

```json
"verify:reader-progress": "node scripts/verify-reader-progress.mjs"
```

In `.github/workflows/quality.yml`, append this step to the `mobile` job after `verify:reader-mobile`:

```yaml
      - run: npm run verify:reader-progress
        working-directory: client
```

- [ ] **Step 3: Run the browser regression**

Run: `npm run verify:reader-progress`

Expected: exit code 0; JSON output reports `seededProgress: 0.0227`, `reopenedProgress` greater than 0, and a non-zero UI label.

- [ ] **Step 4: Run the complete client gate**

Run:

```powershell
npm test
npm run build
npm run verify:reader-mobile
npm run verify:reader-progress
```

Expected: all four commands exit 0; no parallel progress PUT assertion fails and no tracked screenshot changes.

- [ ] **Step 5: Commit the browser regression**

```powershell
git add client/scripts/verify-reader-progress.mjs client/package.json .github/workflows/quality.yml
git commit -m "test: cover reader progress reopening"
```

## Self-review checklist

- [ ] The original 2.27% reset maps to Task 1 and Task 4; background/offline persistence maps to Tasks 2, 3 and 5; browser acceptance maps to Task 6.
- [ ] `enqueueProgress` always writes before starting I/O, `workerRef` permits one request, and `isSameProgressSnapshot` prevents an old success from deleting a newer record.
- [ ] 400/404 remove the book record; network and 5xx leave it queued; pagehide requests keepalive; pageshow and visible-state changes retry.
- [ ] Scan this document for every prohibited placeholder phrase named by the writing-plans skill; expected result is zero matches.
- [ ] Verify consistent names across all tasks: `progress` (0–1), `chapterHref`, `chapterLabel`, `enqueueProgress`, `flushProgress`, `flushPendingReaderSettings`, and `PROGRESS_OUTBOX_KEY`.
