import { chromium } from 'playwright';
import { prepareReaderVerification } from './reader-verification-environment.mjs';

const environment = await prepareReaderVerification();
const APP_URL = environment.appUrl;
const SCREENSHOT_PATH = environment.screenshotPath;
let browser;

try {
  browser = await chromium.launch(environment.browserOptions);
  const page = await browser.newPage({
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
  });

  await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 30000 });
  const firstBook = page.locator('.continue-book-button[data-book-id], button.book-shell[data-book-id]').first();
  await firstBook.waitFor({ timeout: 10000 });
  await firstBook.tap();
  await page.waitForSelector('.reader-overlay', { timeout: 15000 });
  await page.locator('.reader-gesture-layer').tap({ position: { x: 188, y: 334 } });
  await page.waitForFunction(() => (
    !document.querySelector('.reader-overlay')?.classList.contains('reader-chrome-hidden')
  ), { timeout: 10000 });
  await page.locator('.reader-bottombar-button').filter({ hasText: '设置' }).tap();
  await page.waitForSelector('.reader-panel-settings', { timeout: 10000 });
  await page.waitForTimeout(450);

  const result = await page.evaluate(() => {
    const panel = document.querySelector('.reader-panel-settings');
    const content = panel.querySelector('.reader-settings-content');
    const panelRect = panel.getBoundingClientRect();
    const labels = [...panel.querySelectorAll('.reader-settings-label')].map((label) =>
      label.textContent.trim(),
    );
    const sliders = [...panel.querySelectorAll('input[type="range"]')].map((slider) => {
      const rect = slider.getBoundingClientRect();
      return {
        min: slider.min,
        max: slider.max,
        step: slider.step,
        height: Math.round(rect.height),
      };
    });

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      panel: {
        top: Math.round(panelRect.top),
        bottom: Math.round(panelRect.bottom),
        width: Math.round(panelRect.width),
        height: Math.round(panelRect.height),
      },
      sliders,
      labels,
      canScroll: content.scrollHeight > content.clientHeight,
    };
  });

  const requiredLabels = [
    '字体',
    '左右边距',
    '上下边距',
    '行距',
    '字距',
    '主题',
  ];
  const missingLabels = requiredLabels.filter((label) => !result.labels.includes(label));
  const smallSliders = result.sliders.filter((slider) => slider.height < 44);

  if (result.sliders.length < 4 || missingLabels.length > 0 || smallSliders.length > 0) {
    throw new Error(
      `Aa 设置面板控件异常：sliders=${JSON.stringify(result.sliders)}, missing=${missingLabels.join(',')}`,
    );
  }

  await page.locator('.reader-theme-option').filter({ hasText: '夜间' }).tap();

  const interactionResult = await page.evaluate(() => {
    const overlay = document.querySelector('.reader-overlay');

    return {
      darkTheme: overlay?.classList.contains('reader-theme-dark') || false,
      turnControlsRemoved:
        !document.body.innerText.includes('翻页方式') &&
        !document.body.innerText.includes('动画效果'),
    };
  });

  if (!interactionResult.darkTheme || !interactionResult.turnControlsRemoved) {
    throw new Error(
      `Aa 设置面板外观控件未生效：${JSON.stringify(interactionResult)}`,
    );
  }

  await page.locator('.reader-settings-menu-item').filter({ hasText: '字体' }).tap();
  await page.waitForSelector('.reader-settings-font-panel', { timeout: 10000 });

  const fontResult = await page.evaluate(() => {
    const panel = document.querySelector('.reader-panel-settings');
    const fontSlider = panel.querySelector('input[type="range"]');
    const sliderRect = fontSlider.getBoundingClientRect();
    const values = [...panel.querySelectorAll('.reader-settings-value')].map((value) =>
      value.textContent.trim(),
    );

    return {
      title: panel.querySelector('.reader-settings-group-title')?.textContent.trim(),
      fontValue: values.find((value) => value.endsWith('号')) || null,
      slider: {
        min: fontSlider.min,
        max: fontSlider.max,
        step: fontSlider.step,
        height: Math.round(sliderRect.height),
      },
    };
  });

  if (
    fontResult.title !== '字号' ||
    fontResult.slider.min !== '14' ||
    fontResult.slider.max !== '40' ||
    fontResult.slider.step !== '2' ||
    fontResult.slider.height < 44 ||
    !fontResult.fontValue
  ) {
    throw new Error(`字号设置面板异常：${JSON.stringify(fontResult)}`);
  }

  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
  console.log(JSON.stringify({
    ...result,
    ...interactionResult,
    font: fontResult,
    screenshot: SCREENSHOT_PATH,
  }, null, 2));
} finally {
  try {
    await browser?.close();
  } finally {
    await environment.cleanup();
  }
}
