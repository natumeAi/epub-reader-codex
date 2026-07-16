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
