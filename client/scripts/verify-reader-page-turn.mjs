import { chromium } from 'playwright';
import { prepareReaderVerification } from './reader-verification-environment.mjs';

const environment = await prepareReaderVerification();
let browser;

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
    return {
      left: scroller.scrollLeft,
      sheetRemoved: !document.querySelector('.reader-page-turn-sheet'),
      edgeOpacity: Number(getComputedStyle(
        document.querySelector('.reader-page-edge'),
      ).opacity),
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

try {
  browser = await chromium.launch(environment.browserOptions);
  const context = await browser.newContext({
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await openReader(context);
  const initialPage = await label(page);

  const { start: normalStart, mid: normalMid } = await drag(page, {
    fromX: 330,
    toX: 190,
    inspectMid: true,
  });
  const normalPage = await label(page);
  if (
    normalMid.left === normalStart.left ||
    normalMid.edgeOpacity === 0 ||
    normalPage.current !== initialPage.current + 1 ||
    !normalMid.sheetRemoved
  ) {
    throw new Error('Normal drag failed: ' + JSON.stringify({
      initialPage, normalStart, normalMid, normalPage,
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
  if (
    rollbackMid.left === rollbackGestureStart.left ||
    rollbackPage.current !== rollbackStart.current ||
    Math.abs(rollbackEnd.left - rollbackGestureStart.left) > 1
  ) {
    throw new Error('Rollback failed: ' + JSON.stringify({
      rollbackStart, rollbackGestureStart, rollbackMid, rollbackPage, rollbackEnd,
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
  await context.close();

  const reducedContext = await browser.newContext({
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
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

  console.log(JSON.stringify({
    normalPage,
    rollbackPage,
    fastSwipePage,
    reducedMotionPage,
    sheetRemoved: normalMid.sheetRemoved,
  }, null, 2));
} finally {
  try {
    await browser?.close();
  } finally {
    await environment.cleanup();
  }
}
