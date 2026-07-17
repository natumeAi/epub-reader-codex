import { chromium } from 'playwright';
import { prepareReaderVerification } from './reader-verification-environment.mjs';

const environment = await prepareReaderVerification();
const PAGE_TURN_DEBUG_STORAGE_KEY = 'epub-reader:page-turn-debug';
const FORCED_SCROLL_DEBUG_VALUE = JSON.stringify({
  enabled: true,
  forceBackend: 'scroll',
});
let browser;

async function enableForcedScrollDiagnostics(context) {
  await context.addInitScript(({ key, value }) => {
    sessionStorage.setItem(key, value);
  }, {
    key: PAGE_TURN_DEBUG_STORAGE_KEY,
    value: FORCED_SCROLL_DEBUG_VALUE,
  });
}

function parsePageLabel(label) {
  const match = String(label).trim().match(/^(\d+)\/(\d+)$/);
  if (!match) throw new Error('Invalid page label: ' + label);
  return { current: Number(match[1]), total: Number(match[2]) };
}

async function openReader(context) {
  const page = await context.newPage();
  await page.goto(environment.appUrl, { waitUntil: 'networkidle', timeout: 30000 });
  const book = page.locator(
    '.continue-book-button[data-book-id], button.book-shell[data-book-id]',
  ).first();
  await book.waitFor({ timeout: 10000 });
  await book.tap();
  await page.waitForSelector('.reader-gesture-layer', { timeout: 15000 });
  await page.waitForFunction(() => {
    const label = document.querySelector('.reader-page-progress')?.textContent?.trim();
    const container = document.querySelector('.reader-epub-container');
    return Boolean(label && label !== '--/--' && container?.querySelector('iframe'));
  });
  return page;
}

async function label(page) {
  return parsePageLabel(await page.locator('.reader-page-progress').textContent());
}

async function readScroll(page) {
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
    const iframeBody = container.querySelector('iframe')?.contentDocument?.body;
    const iframeBodyStyle = iframeBody ? getComputedStyle(iframeBody) : null;
    return {
      left: scroller.scrollLeft,
      width: scroller.clientWidth,
      sheetRemoved: !document.querySelector('.reader-page-turn-sheet'),
      containerLeft: container.offsetLeft,
      containerRight: container.offsetLeft + container.clientWidth,
      edgeBackgroundColor: edgeStyle.backgroundColor,
      edgeLeft: edge.offsetLeft + edgeTransform.m41,
      edgeOpacity: Number(edgeStyle.opacity),
      edgeSeamOffset: Number.parseFloat(edgeBeforeStyle.left),
      edgeWidth: edge.offsetWidth,
      edgeInlineTransform: edge.style.transform,
      edgeInlineWillChange: edge.style.willChange,
      pageColumnGap: Number.parseFloat(iframeBodyStyle?.columnGap),
      pagePaddingLeft: Number.parseFloat(iframeBodyStyle?.paddingLeft),
      pagePaddingRight: Number.parseFloat(iframeBodyStyle?.paddingRight),
      scrollerInlineTransform: scroller.style.transform,
      scrollerInlineWillChange: scroller.style.willChange,
    };
  });
}

function temporaryStylesAreCleared(state) {
  return state.edgeInlineTransform === '' &&
    state.edgeInlineWillChange === '' &&
    state.scrollerInlineTransform === '' &&
    state.scrollerInlineWillChange === '';
}

async function readStableDiagnostics(page) {
  const read = () => page.evaluate(() => (
    window.__EPUB_READER_PAGE_TURN_DIAGNOSTICS__?.getRecords?.() ?? null
  ));
  const first = await read();
  if (!first) throw new Error('Forced-scroll diagnostics facade is absent');
  await page.waitForTimeout(100);
  const second = await read();
  if (!second || second.length !== first.length) {
    throw new Error('Diagnostics grew after settle: ' + JSON.stringify({ first, second }));
  }
  return second;
}

function requireDiagnosticActions(records, expectedActions, scenario) {
  const actions = records.map((record) => record.action);
  const invalidRecord = records.find((record) => (
    record.backend !== 'scroll' || !Number.isFinite(record.endTime)
  ));
  if (
    JSON.stringify(actions) !== JSON.stringify(expectedActions) ||
    invalidRecord
  ) {
    throw new Error(`${scenario} diagnostics failed: ` + JSON.stringify({
      actions,
      expectedActions,
      invalidRecord,
      records,
    }));
  }
}

async function readDefaultDiagnosticsState(page) {
  return page.evaluate(() => {
    const facade = window.__EPUB_READER_PAGE_TURN_DIAGNOSTICS__;
    const overlay = document.querySelector('.reader-overlay');
    const activeAnimation = [
      'reader-page-turn-pending',
      'reader-page-turn-dragging',
      'reader-page-turn-settling',
    ].some((className) => overlay?.classList.contains(className));
    return {
      activeAnimation,
      facadePresent: Boolean(facade),
      recordCount: facade?.getRecords?.().length ?? 0,
    };
  });
}

async function waitSettled(page) {
  await page.waitForFunction(() => {
    const overlay = document.querySelector('.reader-overlay');
    return overlay &&
      !overlay.classList.contains('reader-page-turn-pending') &&
      !overlay.classList.contains('reader-page-turn-dragging') &&
      !overlay.classList.contains('reader-page-turn-settling');
  }, undefined, { timeout: 5000 });
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

async function drag(page, { fromX, toX, holdMs = 0, y = 330, inspectMid = false }) {
  const session = await page.context().newCDPSession(page);
  await touch(session, 'touchStart', fromX, y);
  const start = inspectMid ? await readScroll(page) : null;
  await touch(session, 'touchMove', toX, y);
  if (holdMs) await page.waitForTimeout(holdMs);
  const mid = inspectMid ? await readScroll(page) : null;
  await touch(session, 'touchEnd', toX, y);
  await session.detach();
  await waitSettled(page);
  return inspectMid ? { start, mid } : null;
}

async function tapReader(page, { x = 330, y = 330 } = {}) {
  const session = await page.context().newCDPSession(page);
  await touch(session, 'touchStart', x, y);
  await touch(session, 'touchEnd', x, y);
  await session.detach();
  await waitSettled(page);
}

try {
  browser = await chromium.launch(environment.browserOptions);
  const debugContext = await browser.newContext({
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
  });
  await enableForcedScrollDiagnostics(debugContext);
  const page = await openReader(debugContext);
  const initialPage = await label(page);

  const { start: normalStart, mid: normalMid } = await drag(page, {
    fromX: 330,
    toX: 190,
    inspectMid: true,
  });
  const normalPage = await label(page);
  const normalEnd = await readScroll(page);
  const normalRecords = await readStableDiagnostics(page);
  requireDiagnosticActions(normalRecords, ['drag', 'commit'], 'Normal drag');
  const normalDragDistance = normalMid.left - normalStart.left;
  const expectedMargin = normalMid.pagePaddingLeft;
  const expectedSeam = normalMid.containerRight - normalDragDistance;
  const actualSeam = normalMid.edgeLeft + normalMid.edgeSeamOffset;
  if (
    normalMid.left === normalStart.left ||
    normalMid.edgeOpacity === 0 ||
    normalMid.containerLeft !== 0 ||
    expectedMargin <= 0 ||
    Math.abs(normalMid.pagePaddingRight - expectedMargin) > 1 ||
    Math.abs(normalMid.pageColumnGap - expectedMargin * 2) > 1 ||
    Math.abs(normalMid.edgeWidth - 14) > 1 ||
    Math.abs(actualSeam - expectedSeam) > 1 ||
    !normalMid.edgeInlineTransform.startsWith('translate3d(') ||
    normalMid.edgeInlineWillChange !== 'transform' ||
    normalMid.edgeBackgroundColor !== 'rgba(0, 0, 0, 0)' ||
    normalPage.current !== initialPage.current + 1 ||
    !temporaryStylesAreCleared(normalEnd) ||
    !normalMid.sheetRemoved
  ) {
    throw new Error('Normal drag failed: ' + JSON.stringify({
      initialPage, normalStart, normalMid, normalEnd, normalPage, normalRecords,
    }));
  }

  const rollbackStart = await label(page);
  const { start: rollbackGestureStart, mid: rollbackMid } = await drag(page, {
    fromX: 300,
    toX: 265,
    holdMs: 180,
    inspectMid: true,
  });
  const rollbackPage = await label(page);
  const rollbackEnd = await readScroll(page);
  const rollbackRecords = await readStableDiagnostics(page);
  requireDiagnosticActions(
    rollbackRecords,
    ['drag', 'commit', 'drag', 'rollback'],
    'Rollback',
  );
  if (
    rollbackMid.left === rollbackGestureStart.left ||
    rollbackPage.current !== rollbackStart.current ||
    Math.abs(rollbackEnd.left - rollbackGestureStart.left) > 1 ||
    !temporaryStylesAreCleared(rollbackEnd)
  ) {
    throw new Error('Rollback failed: ' + JSON.stringify({
      rollbackStart,
      rollbackGestureStart,
      rollbackMid,
      rollbackPage,
      rollbackEnd,
      rollbackRecords,
    }));
  }

  const exactStart = await label(page);
  const exactScroll = await readScroll(page);
  const exactFromX = Math.min(350, exactScroll.width + 20);
  const exactToX = exactFromX - exactScroll.width;
  await drag(page, {
    fromX: exactFromX,
    toX: exactToX,
    holdMs: 250,
  });
  const exactPage = await label(page);
  const exactPhaseClass = await page.locator('.reader-overlay').getAttribute('class');
  if (
    exactPage.current !== exactStart.current + 1 ||
    exactPhaseClass?.includes('reader-page-turn-basic')
  ) {
    throw new Error('Exact-page drag failed: ' + JSON.stringify({
      exactStart, exactScroll, exactPage, exactPhaseClass,
    }));
  }

  const fastStart = await label(page);
  await drag(page, { fromX: 300, toX: 250, holdMs: 20 });
  const fastSwipePage = await label(page);
  if (fastSwipePage.current !== fastStart.current + 1) {
    throw new Error('Fast swipe failed: ' + JSON.stringify({
      fastStart, fastSwipePage,
    }));
  }
  const debugRecords = await readStableDiagnostics(page);
  requireDiagnosticActions(debugRecords, [
    'drag',
    'commit',
    'drag',
    'rollback',
    'drag',
    'commit',
    'drag',
    'commit',
  ], 'Forced-scroll scenarios');
  const backend = 'scroll';
  const recordCount = debugRecords.length;
  const temporaryStylesCleared = temporaryStylesAreCleared(normalEnd) &&
    temporaryStylesAreCleared(rollbackEnd);
  await debugContext.close();

  const reducedContext = await browser.newContext({
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  await enableForcedScrollDiagnostics(reducedContext);
  const reducedPage = await openReader(reducedContext);
  const reducedStart = await label(reducedPage);
  const { start: reducedGestureStart, mid: reducedMid } = await drag(reducedPage, {
    fromX: 330,
    toX: 190,
    inspectMid: true,
  });
  const reducedMotionPage = await label(reducedPage);
  if (
    reducedMid.left !== reducedGestureStart.left ||
    reducedMid.edgeOpacity !== 0 ||
    reducedMotionPage.current !== reducedStart.current + 1
  ) {
    throw new Error('Reduced motion failed: ' + JSON.stringify({
      reducedStart, reducedGestureStart, reducedMid, reducedMotionPage,
    }));
  }
  await reducedContext.close();

  const defaultContext = await browser.newContext({
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
  });
  const defaultPageHandle = await openReader(defaultContext);
  const defaultStart = await label(defaultPageHandle);
  await tapReader(defaultPageHandle);
  const defaultPage = await label(defaultPageHandle);
  await defaultPageHandle.waitForTimeout(100);
  const defaultState = await readDefaultDiagnosticsState(defaultPageHandle);
  const defaultScroll = await readScroll(defaultPageHandle);
  const defaultDiagnosticsAbsent =
    (!defaultState.facadePresent || defaultState.recordCount === 0) &&
    !defaultState.activeAnimation &&
    temporaryStylesAreCleared(defaultScroll);
  if (
    defaultPage.current !== defaultStart.current + 1 ||
    !defaultDiagnosticsAbsent
  ) {
    throw new Error('Default-disabled diagnostics failed: ' + JSON.stringify({
      defaultStart,
      defaultPage,
      defaultState,
      defaultScroll,
    }));
  }
  await defaultContext.close();

  console.log(JSON.stringify({
    backend,
    defaultDiagnosticsAbsent,
    defaultPage,
    recordCount,
    normalPage,
    rollbackPage,
    exactPage,
    fastSwipePage,
    reducedMotionPage,
    sheetRemoved: normalMid.sheetRemoved,
    temporaryStylesCleared,
  }, null, 2));
} finally {
  try {
    await browser?.close();
  } finally {
    await environment.cleanup();
  }
}
