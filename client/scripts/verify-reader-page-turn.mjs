import { chromium } from 'playwright';
import { prepareReaderVerification } from './reader-verification-environment.mjs';

const PAGE_TURN_DEBUG_STORAGE_KEY = 'epub-reader:page-turn-debug';
const PAGE_TURN_FIXTURES = {
  chapterLtr: {
    filename: 'Page Turn Chapter Boundary LTR.epub',
    title: 'Page Turn Chapter Boundary LTR',
    options: { chapterCount: 2, paragraphCount: 40 },
  },
  longLtr: {
    filename: 'Page Turn Long LTR.epub',
    title: 'Page Turn Long LTR',
    options: { paragraphCount: 180 },
  },
  rtl: {
    filename: 'Page Turn RTL.epub',
    title: 'Page Turn RTL',
    options: { pageProgressionDirection: 'rtl', paragraphCount: 100 },
  },
};
const environment = await prepareReaderVerification({
  fixtures: Object.values(PAGE_TURN_FIXTURES),
});
let browser;

function assertScenario(condition, scenario, details) {
  if (!condition) {
    throw new Error(`${scenario} failed: ${JSON.stringify(details)}`);
  }
}

function parsePageLabel(label) {
  const match = String(label).trim().match(/^(\d+)\/(\d+)$/);
  if (!match) throw new Error(`Invalid page label: ${label}`);
  return { current: Number(match[1]), total: Number(match[2]) };
}

async function configureDiagnostics(context, {
  disableWaapi = false,
  forceBackend = null,
} = {}) {
  const value = JSON.stringify({ enabled: true, forceBackend });
  await context.addInitScript(({ disableWaapi: shouldDisableWaapi, key, value: stored }) => {
    if (window !== window.top) return;
    sessionStorage.setItem(key, stored);
    if (shouldDisableWaapi) {
      Object.defineProperty(Element.prototype, 'animate', {
        configurable: true,
        value: undefined,
        writable: true,
      });
    }
  }, {
    disableWaapi,
    key: PAGE_TURN_DEBUG_STORAGE_KEY,
    value,
  });
}

async function createMobileContext(options = {}) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
    ...(options.reducedMotion ? { reducedMotion: options.reducedMotion } : {}),
  });
  await configureDiagnostics(context, options);
  return context;
}

async function waitSettled(page) {
  await page.waitForFunction(() => {
    const overlay = document.querySelector('.reader-overlay');
    return overlay && [
      'reader-page-turn-pending',
      'reader-page-turn-dragging',
      'reader-page-turn-settling',
    ].every((className) => !overlay.classList.contains(className));
  }, undefined, { timeout: 5000 });
}

async function openReader(context, fixture) {
  const page = await context.newPage();
  await page.goto(environment.appUrl, { waitUntil: 'networkidle', timeout: 30000 });
  const book = page.locator('.book-shell[data-book-id]').filter({
    hasText: fixture.title,
  }).first();
  await book.waitFor({ timeout: 10000 });
  const bookId = Number(await book.getAttribute('data-book-id'));
  assertScenario(Number.isInteger(bookId), 'Fixture selection', { fixture, bookId });
  await book.tap();
  await page.waitForSelector('.reader-gesture-layer', { timeout: 15000 });
  await page.waitForFunction(() => {
    const label = document.querySelector('.reader-page-progress')?.textContent?.trim();
    const container = document.querySelector('.reader-epub-container');
    const overlay = document.querySelector('.reader-overlay');
    const readyPhase = overlay && [
      'reader-page-turn-idle',
      'reader-page-turn-basic',
    ].some((className) => overlay.classList.contains(className));
    const flipSettled = overlay &&
      overlay.style.transition === '' &&
      getComputedStyle(overlay).transform === 'none';
    return Boolean(
      label &&
      label !== '--/--' &&
      container?.querySelector('iframe') &&
      readyPhase &&
      flipSettled
    );
  });
  return { bookId, page };
}

async function label(page) {
  return parsePageLabel(await page.locator('.reader-page-progress').textContent());
}

async function readReaderState(page) {
  return page.evaluate(() => {
    const container = document.querySelector('.reader-epub-container');
    const candidates = [...container.querySelectorAll('*')];
    const scroller = candidates.find((element) => {
      const overflowX = getComputedStyle(element).overflowX;
      return element.scrollWidth > element.clientWidth + 1 &&
        (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden');
    });
    if (!scroller) throw new Error('epub.js horizontal scroller not found');

    const edge = document.querySelector('.reader-page-edge');
    const edgeStyle = getComputedStyle(edge);
    const edgeBeforeStyle = getComputedStyle(edge, '::before');
    const edgeTransform = new DOMMatrixReadOnly(edgeStyle.transform);
    const allViewElements = [...container.querySelectorAll('.epub-view')];
    const viewElements = allViewElements.filter((element) => element.querySelector('iframe'));
    const iframeBody = container.querySelector('iframe')?.contentDocument?.body;
    const iframeBodyStyle = iframeBody ? getComputedStyle(iframeBody) : null;
    const readView = (element) => {
      const computedTransform = getComputedStyle(element).transform;
      const matrix = computedTransform === 'none'
        ? new DOMMatrixReadOnly()
        : new DOMMatrixReadOnly(computedTransform);
      return {
        animationCount: element.getAnimations?.().length ?? -1,
        computedTransform,
        connected: element.isConnected,
        inlineTransform: element.style.transform,
        inlineWillChange: element.style.willChange,
        translateX: matrix.m41,
      };
    };
    const views = viewElements.map(readView);

    return {
      containerLeft: container.offsetLeft,
      containerRight: container.offsetLeft + container.clientWidth,
      contentWidth: scroller.scrollWidth,
      edgeAnimationCount: edge.getAnimations?.().length ?? -1,
      edgeBackgroundColor: edgeStyle.backgroundColor,
      edgeDisplay: edgeStyle.display,
      edgeInlineTransform: edge.style.transform,
      edgeInlineWillChange: edge.style.willChange,
      edgeOpacity: Number(edgeStyle.opacity),
      edgeSeam: edge.offsetLeft + edgeTransform.m41 + Number.parseFloat(edgeBeforeStyle.left || '0'),
      edgeWidth: edge.offsetWidth,
      pageColumnGap: Number.parseFloat(iframeBodyStyle?.columnGap),
      pagePaddingLeft: Number.parseFloat(iframeBodyStyle?.paddingLeft),
      pagePaddingRight: Number.parseFloat(iframeBodyStyle?.paddingRight),
      scrollerInlineTransform: scroller.style.transform,
      scrollerInlineWillChange: scroller.style.willChange,
      scrollLeft: scroller.scrollLeft,
      sheetRemoved: !document.querySelector('.reader-page-turn-sheet'),
      allViews: allViewElements.map(readView),
      views,
      waapiAvailable: typeof Element.prototype.animate === 'function',
      width: scroller.clientWidth,
    };
  });
}

function temporaryStylesAreCleared(state) {
  return state.views.length > 0 &&
    state.allViews.every((view) => (
      view.inlineTransform === '' &&
      view.inlineWillChange === '' &&
      view.animationCount === 0
    )) &&
    state.edgeInlineTransform === '' &&
    state.edgeInlineWillChange === '' &&
    state.edgeAnimationCount === 0 &&
    state.scrollerInlineTransform === '' &&
    state.scrollerInlineWillChange === '';
}

function requireCompositorMidState(start, mid, scenario, { verifyGeometry = false } = {}) {
  const firstView = mid.views[0];
  const transformsMatch = mid.views.length > 0 && mid.views.every((view) => (
    view.connected &&
    view.inlineTransform === firstView.inlineTransform &&
    view.inlineWillChange === 'transform' &&
    Math.abs(view.translateX - firstView.translateX) <= 0.5
  ));
  const moved = firstView &&
    firstView.inlineTransform !== '' &&
    Math.abs(firstView.translateX) > 1;
  const expectedSeam = mid.containerRight + (firstView?.translateX || 0);
  const geometryValid = !verifyGeometry || (
    mid.containerLeft === 0 &&
    mid.pagePaddingLeft > 0 &&
    Math.abs(mid.pagePaddingRight - mid.pagePaddingLeft) <= 1 &&
    Math.abs(mid.pageColumnGap - mid.pagePaddingLeft * 2) <= 1 &&
    Math.abs(mid.edgeWidth - 14) <= 1 &&
    mid.edgeBackgroundColor === 'rgba(0, 0, 0, 0)' &&
    mid.sheetRemoved
  );

  assertScenario(
    transformsMatch &&
      moved &&
      Math.abs(mid.scrollLeft - start.scrollLeft) <= 1 &&
      Math.abs(mid.edgeSeam - start.edgeSeam) > 1 &&
      Math.abs(mid.edgeSeam - expectedSeam) <= 1 &&
      mid.edgeInlineWillChange === 'transform' &&
      mid.edgeOpacity > 0 &&
      geometryValid,
    scenario,
    { expectedSeam, geometryValid, mid, start },
  );
}

async function readStableDiagnostics(page) {
  const read = () => page.evaluate(() => (
    window.__EPUB_READER_PAGE_TURN_DIAGNOSTICS__?.getRecords?.() ?? null
  ));
  const first = await read();
  if (!first) throw new Error('Page-turn diagnostics facade is absent');
  await page.waitForTimeout(100);
  const second = await read();
  if (!second || second.length !== first.length) {
    throw new Error(`Diagnostics grew after settle: ${JSON.stringify({ first, second })}`);
  }
  return second;
}

async function clearDiagnostics(page) {
  await page.evaluate(() => window.__EPUB_READER_PAGE_TURN_DIAGNOSTICS__?.clear?.());
}

function requireDiagnostics(records, expectedActions, expectedBackend, scenario) {
  const actions = records.map((record) => record.action);
  const invalidRecord = records.find((record) => (
    record.backend !== expectedBackend || !Number.isFinite(record.endTime)
  ));
  assertScenario(
    JSON.stringify(actions) === JSON.stringify(expectedActions) && !invalidRecord,
    `${scenario} diagnostics`,
    { actions, expectedActions, expectedBackend, invalidRecord, records },
  );
}

async function readPersistedProgress(page, bookId) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/reading/${id}`);
    if (!response.ok) throw new Error(`Progress request failed: ${response.status}`);
    return (await response.json()).progress;
  }, bookId);
}

async function waitForInitialProgress(page, bookId) {
  await page.waitForFunction(async (id) => {
    const response = await fetch(`/api/reading/${id}`);
    if (!response.ok) return false;
    return Boolean((await response.json()).progress?.cfi);
  }, bookId, { timeout: 7000 });
  return readPersistedProgress(page, bookId);
}

async function waitForChangedProgress(page, bookId, previousCfi) {
  await page.waitForFunction(async ({ bookId: id, previousCfi: previous }) => {
    const response = await fetch(`/api/reading/${id}`);
    if (!response.ok) return false;
    const progress = (await response.json()).progress;
    return Boolean(progress?.cfi && progress.cfi !== previous);
  }, { bookId, previousCfi }, { timeout: 7000 });
  return readPersistedProgress(page, bookId);
}

async function readStableProgress(page, bookId) {
  const first = await readPersistedProgress(page, bookId);
  await page.waitForTimeout(100);
  const second = await readPersistedProgress(page, bookId);
  assertScenario(first?.cfi === second?.cfi, 'Persisted progress stability', { first, second });
  return second;
}

async function touch(session, type, x, y) {
  await session.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{
      id: 1,
      x,
      y,
      radiusX: 2,
      radiusY: 2,
      force: 1,
    }],
  });
}

async function waitForCompositorMotion(page) {
  await page.waitForFunction(() => {
    const views = [...document.querySelectorAll('.reader-epub-container .epub-view')]
      .filter((view) => view.querySelector('iframe'));
    return views.length > 0 && views.every((view) => (
      view.style.transform && view.style.transform !== 'translate3d(0px, 0px, 0px)'
    ));
  }, undefined, { timeout: 2000 });
}

async function waitForScrollMotion(page, startScrollLeft) {
  await page.waitForFunction((initial) => {
    const container = document.querySelector('.reader-epub-container');
    const scroller = [...container.querySelectorAll('*')].find((element) => {
      const overflowX = getComputedStyle(element).overflowX;
      return element.scrollWidth > element.clientWidth + 1 &&
        (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden');
    });
    return scroller && Math.abs(scroller.scrollLeft - initial) > 1;
  }, startScrollLeft, { timeout: 2000 });
}

async function drag(page, {
  fromX,
  holdMs = 0,
  midMotion = 'none',
  toX,
  y = 330,
}) {
  const session = await page.context().newCDPSession(page);
  await touch(session, 'touchStart', fromX, y);
  const start = await readReaderState(page);
  await touch(session, 'touchMove', toX, y);
  if (midMotion === 'compositor') await waitForCompositorMotion(page);
  else if (midMotion === 'scroll') await waitForScrollMotion(page, start.scrollLeft);
  else await page.waitForTimeout(50);
  if (holdMs) await page.waitForTimeout(holdMs);
  const mid = await readReaderState(page);
  await touch(session, 'touchEnd', toX, y);
  await session.detach();
  await waitSettled(page);
  const end = await readReaderState(page);
  return { end, mid, start };
}

async function tapReader(page, { x = 330, y = 330 } = {}) {
  const session = await page.context().newCDPSession(page);
  await touch(session, 'touchStart', x, y);
  await touch(session, 'touchEnd', x, y);
  await session.detach();
  await waitSettled(page);
}

function requireSinglePageAdvance(before, after, scenario) {
  assertScenario(
    after.current === before.current + 1 && after.total === before.total,
    scenario,
    { after, before },
  );
}

function requireOnePageScroll(start, end, scenario) {
  assertScenario(
    Math.abs((end.scrollLeft - start.scrollLeft) - start.width) <= 1,
    scenario,
    { end, start },
  );
}

async function runForcedCompositorLtr() {
  const context = await createMobileContext({ forceBackend: 'compositor' });
  try {
    const { bookId, page } = await openReader(context, PAGE_TURN_FIXTURES.longLtr);
    const initialPage = await label(page);
    const initialProgress = await waitForInitialProgress(page, bookId);
    await clearDiagnostics(page);
    const commit = await drag(page, {
      fromX: 330,
      midMotion: 'compositor',
      toX: 190,
    });
    const committedPage = await label(page);
    const committedProgress = await waitForChangedProgress(page, bookId, initialProgress.cfi);
    const commitRecords = await readStableDiagnostics(page);

    requireCompositorMidState(commit.start, commit.mid, 'Forced compositor LTR drag', {
      verifyGeometry: true,
    });
    requireSinglePageAdvance(initialPage, committedPage, 'Forced compositor LTR page result');
    requireOnePageScroll(commit.start, commit.end, 'Forced compositor LTR scroll commit');
    requireDiagnostics(commitRecords, ['drag', 'commit'], 'compositor', 'Forced compositor LTR');
    assertScenario(
      committedProgress.cfi !== initialProgress.cfi && temporaryStylesAreCleared(commit.end),
      'Forced compositor LTR cleanup/CFI',
      { commit, committedProgress, initialProgress },
    );

    const rollbackPageStart = committedPage;
    const rollbackProgressStart = await readStableProgress(page, bookId);
    await clearDiagnostics(page);
    const rollback = await drag(page, {
      fromX: 300,
      holdMs: 180,
      midMotion: 'compositor',
      toX: 265,
    });
    const rollbackPage = await label(page);
    const rollbackProgress = await readStableProgress(page, bookId);
    const rollbackRecords = await readStableDiagnostics(page);

    requireCompositorMidState(rollback.start, rollback.mid, 'Forced compositor LTR rollback drag');
    requireDiagnostics(rollbackRecords, ['drag', 'rollback'], 'compositor', 'Forced compositor rollback');
    assertScenario(
      rollbackPage.current === rollbackPageStart.current &&
        rollbackPage.total === rollbackPageStart.total &&
        rollbackProgress.cfi === rollbackProgressStart.cfi &&
        Math.abs(rollback.end.scrollLeft - rollback.start.scrollLeft) <= 1 &&
        temporaryStylesAreCleared(rollback.end),
      'Forced compositor rollback result',
      {
        rollback,
        rollbackPage,
        rollbackPageStart,
        rollbackProgress,
        rollbackProgressStart,
      },
    );

    return {
      backend: 'compositor',
      committedPage,
      rollbackPage,
      temporaryStylesCleared: true,
    };
  } finally {
    await context.close();
  }
}

async function runForcedScroll() {
  const context = await createMobileContext({ forceBackend: 'scroll' });
  try {
    const { bookId, page } = await openReader(context, PAGE_TURN_FIXTURES.longLtr);
    const beforePage = await label(page);
    const beforeProgress = await waitForInitialProgress(page, bookId);
    await clearDiagnostics(page);
    const gesture = await drag(page, {
      fromX: 330,
      midMotion: 'scroll',
      toX: 190,
    });
    const afterPage = await label(page);
    const afterProgress = await waitForChangedProgress(page, bookId, beforeProgress.cfi);
    const records = await readStableDiagnostics(page);

    requireSinglePageAdvance(beforePage, afterPage, 'Forced scroll page result');
    requireOnePageScroll(gesture.start, gesture.end, 'Forced scroll commit');
    requireDiagnostics(records, ['drag', 'commit'], 'scroll', 'Forced scroll');
    assertScenario(
      gesture.mid.scrollLeft !== gesture.start.scrollLeft &&
        afterProgress.cfi !== beforeProgress.cfi &&
        temporaryStylesAreCleared(gesture.end),
      'Forced scroll behavior',
      { afterProgress, beforeProgress, gesture },
    );
    return { afterPage, backend: 'scroll' };
  } finally {
    await context.close();
  }
}

async function runAutomaticScrollFallback() {
  const context = await createMobileContext({ disableWaapi: true });
  try {
    const { bookId, page } = await openReader(context, PAGE_TURN_FIXTURES.longLtr);
    const beforePage = await label(page);
    const beforeProgress = await waitForInitialProgress(page, bookId);
    await clearDiagnostics(page);
    const gesture = await drag(page, {
      fromX: 330,
      midMotion: 'scroll',
      toX: 190,
    });
    const afterPage = await label(page);
    const afterProgress = await waitForChangedProgress(page, bookId, beforeProgress.cfi);
    const records = await readStableDiagnostics(page);

    requireSinglePageAdvance(beforePage, afterPage, 'Automatic scroll fallback page result');
    requireDiagnostics(records, ['drag', 'commit'], 'scroll', 'Automatic scroll fallback');
    assertScenario(
      !gesture.start.waapiAvailable &&
        gesture.mid.scrollLeft !== gesture.start.scrollLeft &&
        afterProgress.cfi !== beforeProgress.cfi &&
        temporaryStylesAreCleared(gesture.end),
      'Automatic scroll fallback behavior',
      { afterProgress, beforeProgress, gesture },
    );
    return { afterPage, backend: 'scroll', waapiAvailable: false };
  } finally {
    await context.close();
  }
}

async function runReducedMotionBasic() {
  const context = await createMobileContext({
    forceBackend: 'compositor',
    reducedMotion: 'reduce',
  });
  try {
    const { page } = await openReader(context, PAGE_TURN_FIXTURES.longLtr);
    const beforePage = await label(page);
    await clearDiagnostics(page);
    const gesture = await drag(page, {
      fromX: 330,
      toX: 190,
    });
    const afterPage = await label(page);
    const records = await readStableDiagnostics(page);
    const phaseClass = await page.locator('.reader-overlay').getAttribute('class');

    requireSinglePageAdvance(beforePage, afterPage, 'Reduced-motion basic page result');
    assertScenario(
      gesture.mid.scrollLeft === gesture.start.scrollLeft &&
        gesture.mid.edgeDisplay === 'none' &&
        gesture.mid.edgeOpacity === 0 &&
        gesture.mid.views.every((view) => (
          view.inlineTransform === '' && view.inlineWillChange === ''
        )) &&
        records.length === 0 &&
        phaseClass?.includes('reader-page-turn-basic') &&
        temporaryStylesAreCleared(gesture.end),
      'Reduced-motion basic behavior',
      { gesture, phaseClass, records },
    );
    return { afterPage, backend: 'basic', edgeDisplay: gesture.mid.edgeDisplay };
  } finally {
    await context.close();
  }
}

async function runChapterBoundary() {
  const context = await createMobileContext({ forceBackend: 'compositor' });
  try {
    const { bookId, page } = await openReader(context, PAGE_TURN_FIXTURES.chapterLtr);
    const initialProgress = await waitForInitialProgress(page, bookId);
    const initialChapterHref = initialProgress.chapterHref;
    let previousProgress = initialProgress;

    for (let operation = 1; operation <= 30; operation += 1) {
      const beforePage = await label(page);
      await clearDiagnostics(page);
      await tapReader(page);
      const afterPage = await label(page);
      const afterProgress = await waitForChangedProgress(page, bookId, previousProgress.cfi);
      const end = await readReaderState(page);
      const records = await readStableDiagnostics(page);

      requireDiagnostics(records, ['drag', 'tap-next'], 'compositor', 'Chapter-boundary turn');
      assertScenario(
        temporaryStylesAreCleared(end),
        'Chapter-boundary cleanup',
        { afterPage, afterProgress, beforePage, end, operation },
      );

      if (afterProgress.chapterHref !== initialChapterHref) {
        assertScenario(
          previousProgress.chapterHref === initialChapterHref &&
            afterPage.current === 1 &&
            afterProgress.cfi !== previousProgress.cfi,
          'Chapter-boundary result',
          {
            afterPage,
            afterProgress,
            beforePage,
            initialChapterHref,
            operation,
            previousProgress,
          },
        );
        return {
          backend: 'compositor',
          fromChapterHref: initialChapterHref,
          operation,
          page: afterPage,
          toChapterHref: afterProgress.chapterHref,
        };
      }

      requireSinglePageAdvance(beforePage, afterPage, 'Pre-boundary page result');
      previousProgress = afterProgress;
    }

    throw new Error(`Chapter boundary was not reached within 30 pages from ${initialChapterHref}`);
  } finally {
    await context.close();
  }
}

async function runRtlCompositor() {
  const context = await createMobileContext({ forceBackend: 'compositor' });
  try {
    const { bookId, page } = await openReader(context, PAGE_TURN_FIXTURES.rtl);
    const initialPage = await label(page);
    const initialProgress = await waitForInitialProgress(page, bookId);
    await clearDiagnostics(page);
    const commit = await drag(page, {
      fromX: 330,
      midMotion: 'compositor',
      toX: 190,
    });
    const committedPage = await label(page);
    const committedProgress = await waitForChangedProgress(page, bookId, initialProgress.cfi);
    const commitRecords = await readStableDiagnostics(page);

    requireCompositorMidState(commit.start, commit.mid, 'RTL compositor drag');
    assertScenario(
      committedPage.total === initialPage.total &&
        Math.abs(
          Math.abs(commit.end.scrollLeft - commit.start.scrollLeft) - commit.start.width
      ) <= 1,
      'RTL compositor page result',
      {
        commit,
        commitRecords,
        committedPage,
        committedProgress,
        initialPage,
        initialProgress,
      },
    );
    requireDiagnostics(commitRecords, ['drag', 'commit'], 'compositor', 'RTL compositor commit');
    assertScenario(
      committedProgress.cfi !== initialProgress.cfi &&
        committedProgress.progress >= initialProgress.progress &&
        temporaryStylesAreCleared(commit.end),
      'RTL compositor commit result',
      { commit, committedProgress, initialProgress },
    );

    const rollbackProgressStart = await readStableProgress(page, bookId);
    await clearDiagnostics(page);
    const rollback = await drag(page, {
      fromX: 300,
      holdMs: 180,
      midMotion: 'compositor',
      toX: 265,
    });
    const rollbackPage = await label(page);
    const rollbackProgress = await readStableProgress(page, bookId);
    const rollbackRecords = await readStableDiagnostics(page);

    requireCompositorMidState(rollback.start, rollback.mid, 'RTL compositor rollback drag');
    requireDiagnostics(rollbackRecords, ['drag', 'rollback'], 'compositor', 'RTL compositor rollback');
    assertScenario(
      rollbackPage.current === committedPage.current &&
        rollbackPage.total === committedPage.total &&
        rollbackProgress.cfi === rollbackProgressStart.cfi &&
        Math.abs(rollback.end.scrollLeft - rollback.start.scrollLeft) <= 1 &&
        temporaryStylesAreCleared(rollback.end),
      'RTL compositor rollback result',
      {
        committedPage,
        rollback,
        rollbackPage,
        rollbackProgress,
        rollbackProgressStart,
      },
    );
    return {
      backend: 'compositor',
      committedPage,
      rollbackPage,
      temporaryStylesCleared: true,
    };
  } finally {
    await context.close();
  }
}

try {
  browser = await chromium.launch(environment.browserOptions);
  const forcedCompositor = await runForcedCompositorLtr();
  const forcedScroll = await runForcedScroll();
  const automaticScrollFallback = await runAutomaticScrollFallback();
  const reducedMotion = await runReducedMotionBasic();
  const chapterBoundary = await runChapterBoundary();
  const rtl = await runRtlCompositor();

  console.log(JSON.stringify({
    automaticScrollFallback,
    chapterBoundary,
    forcedCompositor,
    forcedScroll,
    reducedMotion,
    rtl,
  }, null, 2));
} finally {
  try {
    await browser?.close();
  } finally {
    await environment.cleanup();
  }
}
