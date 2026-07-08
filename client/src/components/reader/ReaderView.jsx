import { useCallback, useEffect, useRef, useState } from 'react';
import Epub from 'epubjs';
import {
  getReaderSettings,
  getReadingProgress,
  saveReaderSettings,
  saveReadingProgress,
} from '../../api/books.js';

const SAVE_DEBOUNCE_MS = 2000;
const SETTINGS_SAVE_DEBOUNCE_MS = 500;
// Horizontal travel (px) past which a pointer gesture counts as a swipe, not a tap
const SWIPE_THRESHOLD = 45;
// Page-turn animation
const PAGE_SLIDE_OUT_MS = 180;
const PAGE_SLIDE_IN_MS = 180;
// Open/close FLIP animation: overlay scales between the shelf cover rect and full screen.
// Same duration/easing both directions to keep open/close symmetric.
const READER_FLIP_ANIM_MS = 300;
const READER_FLIP_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const READER_COVER_FADE_MS = 200;
// Fallback when the origin/target cover rect can't be found (e.g. off-screen).
const READER_FALLBACK_ANIM_MS = 220;
const DEFAULT_FONT_SIZE = 100;
const FONT_SIZE_MIN = 80;
const FONT_SIZE_MAX = 140;
const FONT_SIZE_STEP = 10;
const DEFAULT_HORIZONTAL_MARGIN = 24;
const HORIZONTAL_MARGIN_MIN = 12;
const HORIZONTAL_MARGIN_MAX = 48;
const HORIZONTAL_MARGIN_STEP = 6;
const DEFAULT_VERTICAL_MARGIN = 20;
const VERTICAL_MARGIN_MIN = 12;
const VERTICAL_MARGIN_MAX = 48;
const VERTICAL_MARGIN_STEP = 6;
const DEFAULT_LINE_HEIGHT = 1.6;
const LINE_HEIGHT_MIN = 1.3;
const LINE_HEIGHT_MAX = 2;
const LINE_HEIGHT_STEP = 0.1;
const DEFAULT_LETTER_SPACING = 0;
const LETTER_SPACING_MIN = 0;
const LETTER_SPACING_MAX = 0.12;
const LETTER_SPACING_STEP = 0.02;
const READER_LAYOUT_STYLE_ID = 'reader-layout-settings';
const READER_THEME_STYLE_ID = 'reader-theme-settings';
const DEFAULT_FONT_FAMILY_ID = 'system';
const DEFAULT_THEME_ID = 'light';
const FONT_FAMILY_OPTIONS = [
  {
    id: DEFAULT_FONT_FAMILY_ID,
    label: '默认',
    value: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif',
  },
  {
    id: 'sans',
    label: '黑体',
    value: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
  },
  {
    id: 'serif',
    label: '宋体',
    value: '"Songti SC", SimSun, "Noto Serif CJK SC", serif',
  },
  {
    id: 'kai',
    label: '楷体',
    value: '"Kaiti SC", KaiTi, serif',
  },
];
const READER_THEME_OPTIONS = [
  {
    id: DEFAULT_THEME_ID,
    label: '白色',
    swatch: '#ffffff',
    text: '#1d1d1f',
    muted: '#6e6e73',
    background: '#ffffff',
    selection: 'rgba(0, 122, 255, 0.22)',
  },
  {
    id: 'warm',
    label: '暖色',
    swatch: '#f4ecd9',
    text: '#2f271d',
    muted: '#806f5a',
    background: '#f4ecd9',
    selection: 'rgba(180, 122, 48, 0.24)',
  },
  {
    id: 'green',
    label: '护眼',
    swatch: '#dfeadb',
    text: '#1f2c22',
    muted: '#617060',
    background: '#dfeadb',
    selection: 'rgba(52, 120, 72, 0.22)',
  },
  {
    id: 'dark',
    label: '夜间',
    swatch: '#171717',
    text: '#eeeeee',
    muted: '#a6a6a6',
    background: '#171717',
    selection: 'rgba(90, 160, 255, 0.3)',
  },
];
function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clampFontSize(value) {
  return clampNumber(value, FONT_SIZE_MIN, FONT_SIZE_MAX, DEFAULT_FONT_SIZE);
}

function clampHorizontalMargin(value) {
  return clampNumber(
    value,
    HORIZONTAL_MARGIN_MIN,
    HORIZONTAL_MARGIN_MAX,
    DEFAULT_HORIZONTAL_MARGIN,
  );
}

function clampVerticalMargin(value) {
  return clampNumber(
    value,
    VERTICAL_MARGIN_MIN,
    VERTICAL_MARGIN_MAX,
    DEFAULT_VERTICAL_MARGIN,
  );
}

function clampLineHeight(value) {
  return Number(
    clampNumber(value, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX, DEFAULT_LINE_HEIGHT).toFixed(1),
  );
}

function clampLetterSpacing(value) {
  return Number(
    clampNumber(
      value,
      LETTER_SPACING_MIN,
      LETTER_SPACING_MAX,
      DEFAULT_LETTER_SPACING,
    ).toFixed(2),
  );
}

function getReaderFontFamily(fontFamilyId) {
  return FONT_FAMILY_OPTIONS.find((option) => option.id === fontFamilyId)?.value ||
    FONT_FAMILY_OPTIONS[0].value;
}

function getReaderTheme(themeId) {
  return READER_THEME_OPTIONS.find((option) => option.id === themeId) ||
    READER_THEME_OPTIONS[0];
}

function sanitizeReaderSettings(settings) {
  return {
    fontSize: clampFontSize(settings?.fontSize),
    fontFamilyId: FONT_FAMILY_OPTIONS.some((option) => option.id === settings?.fontFamilyId)
      ? settings.fontFamilyId
      : DEFAULT_FONT_FAMILY_ID,
    horizontalMargin: clampHorizontalMargin(settings?.horizontalMargin),
    verticalMargin: clampVerticalMargin(settings?.verticalMargin),
    lineHeight: clampLineHeight(settings?.lineHeight),
    letterSpacing: clampLetterSpacing(settings?.letterSpacing),
    themeId: READER_THEME_OPTIONS.some((option) => option.id === settings?.themeId)
      ? settings.themeId
      : DEFAULT_THEME_ID,
  };
}

// Builds the transform that collapses the full-screen reader overlay down onto
// a cover's on-screen rect (or the inverse, expanding from it).
function rectToTransformString(rect) {
  if (!rect || !rect.width || !rect.height) return null;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  if (!vw || !vh) return null;

  return `translate(${rect.left}px, ${rect.top}px) scale(${rect.width / vw}, ${rect.height / vh})`;
}

function getReaderLayoutCss({ lineHeight, letterSpacing }) {
  return `
    html {
      margin: 0 !important;
      padding: 0 !important;
    }

    body {
      line-height: ${lineHeight} !important;
      letter-spacing: ${letterSpacing}em !important;
    }

    p, div, section, article, blockquote, li {
      line-height: ${lineHeight} !important;
      letter-spacing: ${letterSpacing}em !important;
    }
  `;
}

function getReaderThemeCss(theme) {
  return `
    html,
    body {
      background: ${theme.background} !important;
      color: ${theme.text} !important;
    }

    a {
      color: inherit !important;
    }

    ::selection {
      background: ${theme.selection} !important;
    }

    p, div, section, article, blockquote, li, span {
      color: ${theme.text} !important;
    }
  `;
}

function applyReaderLayoutStylesToContents(contents, settings) {
  if (!contents) return;

  contents.addStylesheetCss?.(getReaderLayoutCss(settings), READER_LAYOUT_STYLE_ID);

  const verticalMargin = `${settings.verticalMargin}px`;
  const lineHeight = String(settings.lineHeight);
  const letterSpacing = `${settings.letterSpacing}em`;

  contents.css?.('padding-top', verticalMargin, true);
  contents.css?.('padding-bottom', verticalMargin, true);
  contents.css?.('line-height', lineHeight, true);
  contents.css?.('letter-spacing', letterSpacing, true);
}

function applyReaderThemeStylesToContents(contents, theme) {
  if (!contents) return;

  contents.addStylesheetCss?.(getReaderThemeCss(theme), READER_THEME_STYLE_ID);
  contents.css?.('background', theme.background, true);
  contents.css?.('color', theme.text, true);
}

async function applyReaderHorizontalMargin(rendition, horizontalMargin, cfi) {
  const manager = rendition?.manager;
  const layout = rendition?._layout;
  if (!manager || !layout) return;

  manager.settings.gap = horizontalMargin * 2;
  manager.updateLayout?.();

  if (cfi) {
    await rendition.display(cfi);
  }
}

function applyReaderSettings(rendition, settings) {
  if (!rendition?.themes) return;
  const theme = getReaderTheme(settings.themeId);

  try {
    rendition.themes.register(settings.themeId, {
      body: {
        background: `${theme.background} !important`,
        color: `${theme.text} !important`,
      },
      a: {
        color: 'inherit !important',
      },
      '::selection': {
        background: `${theme.selection} !important`,
      },
    });
    rendition.themes.select(settings.themeId);
  } catch {
    // Content CSS below is the compatibility path for epub.js theme quirks.
  }

  rendition.getContents?.().forEach((contents) => {
    applyReaderLayoutStylesToContents(contents, settings);
    applyReaderThemeStylesToContents(contents, theme);
  });
  rendition.themes.fontSize(`${settings.fontSize}%`);
  rendition.themes.font(getReaderFontFamily(settings.fontFamilyId));
}

export function ReaderView({ book, originRect, onClose }) {
  const containerRef = useRef(null);
  const bookRef = useRef(null);
  const renditionRef = useRef(null);
  const saveTimerRef = useRef(null);
  const settingsSaveTimerRef = useRef(null);
  const pendingProgressRef = useRef(null);
  const pendingReaderSettingsRef = useRef(null);
  const pointerRef = useRef(null);
  const animatingRef = useRef(false);
  const currentCfiRef = useRef(null);
  const originRectRef = useRef(originRect);
  const isClosingRef = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [chromeVisible, setChromeVisible] = useState(false);
  // Bottom-bar panel: null | 'toc' | 'settings'
  const [activePanel, setActivePanel] = useState(null);
  const [toc, setToc] = useState([]);
  const [currentHref, setCurrentHref] = useState(null);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [fontFamilyId, setFontFamilyId] = useState(DEFAULT_FONT_FAMILY_ID);
  const [horizontalMargin, setHorizontalMargin] = useState(DEFAULT_HORIZONTAL_MARGIN);
  const [verticalMargin, setVerticalMargin] = useState(DEFAULT_VERTICAL_MARGIN);
  const [lineHeight, setLineHeight] = useState(DEFAULT_LINE_HEIGHT);
  const [letterSpacing, setLetterSpacing] = useState(DEFAULT_LETTER_SPACING);
  const [readerThemeId, setReaderThemeId] = useState(DEFAULT_THEME_ID);
  const [hasLoadedReaderSettings, setHasLoadedReaderSettings] = useState(false);
  const readerSettingsRef = useRef({
    fontSize: DEFAULT_FONT_SIZE,
    fontFamilyId: DEFAULT_FONT_FAMILY_ID,
    horizontalMargin: DEFAULT_HORIZONTAL_MARGIN,
    verticalMargin: DEFAULT_VERTICAL_MARGIN,
    lineHeight: DEFAULT_LINE_HEIGHT,
    letterSpacing: DEFAULT_LETTER_SPACING,
    themeId: DEFAULT_THEME_ID,
  });
  // Fixed two-stage page slide: old page exits, epub.js turns once, new page enters.
  const [pageTurn, setPageTurn] = useState(null);
  // Open/close FLIP animation state: the overlay transform collapses onto (or
  // expands from) the shelf cover rect captured at click time.
  const [flipTransform, setFlipTransform] = useState(() => (
    originRect ? rectToTransformString(originRect) : null
  ));
  const [flipTransitionEnabled, setFlipTransitionEnabled] = useState(false);
  const [coverOpacity, setCoverOpacity] = useState(() => (originRect ? 1 : 0));
  const [isFallbackClosing, setIsFallbackClosing] = useState(false);

  const flushSave = useCallback((progressData) => {
    if (!book?.id || !progressData) return;
    saveReadingProgress(book.id, progressData).catch(() => {});
  }, [book?.id]);

  const scheduleSave = useCallback((progressData) => {
    pendingProgressRef.current = progressData;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      flushSave(pendingProgressRef.current);
      pendingProgressRef.current = null;
    }, SAVE_DEBOUNCE_MS);
  }, [flushSave]);

  const flushReaderSettingsSave = useCallback((settings) => {
    if (!settings) return;
    saveReaderSettings(settings).catch(() => {});
  }, []);

  const scheduleReaderSettingsSave = useCallback((settings) => {
    pendingReaderSettingsRef.current = settings;
    if (settingsSaveTimerRef.current) clearTimeout(settingsSaveTimerRef.current);
    settingsSaveTimerRef.current = setTimeout(() => {
      flushReaderSettingsSave(pendingReaderSettingsRef.current);
      pendingReaderSettingsRef.current = null;
    }, SETTINGS_SAVE_DEBOUNCE_MS);
  }, [flushReaderSettingsSave]);

  useEffect(() => {
    if (!containerRef.current || !book?.id) return;

    let destroyed = false;
    setHasLoadedReaderSettings(false);

    // Standard async IIFE pattern for useEffect
    (async () => {
      let epubBook;
      let rendition;

      try {
        // Fetch as ArrayBuffer — avoids epub.js trying to resolve
        // internal EPUB paths relative to the API URL
        const fileResponse = await fetch(`/api/books/${book.id}/file`);
        if (!fileResponse.ok) throw new Error(`文件加载失败 (${fileResponse.status})`);
        if (destroyed) return;

        const arrayBuffer = await fileResponse.arrayBuffer();
        if (destroyed) return;

        epubBook = Epub(arrayBuffer);
        bookRef.current = epubBook;

        rendition = epubBook.renderTo(containerRef.current, {
          width: '100%',
          height: '100%',
          spread: 'none',
        });
        renditionRef.current = rendition;
        rendition.hooks.content.register((contents) => {
          applyReaderLayoutStylesToContents(contents, readerSettingsRef.current);
          applyReaderThemeStylesToContents(
            contents,
            getReaderTheme(readerSettingsRef.current.themeId),
          );
        });

        let startCfi;
        try {
          const [progressResult, settingsResult] = await Promise.allSettled([
            getReadingProgress(book.id),
            getReaderSettings(),
          ]);
          if (progressResult.status === 'fulfilled') {
            startCfi = progressResult.value.progress?.cfi || undefined;
          }

          if (settingsResult.status === 'fulfilled' && settingsResult.value.settings) {
            const nextSettings = sanitizeReaderSettings(settingsResult.value.settings);
            readerSettingsRef.current = nextSettings;
            setFontSize(nextSettings.fontSize);
            setFontFamilyId(nextSettings.fontFamilyId);
            setHorizontalMargin(nextSettings.horizontalMargin);
            setVerticalMargin(nextSettings.verticalMargin);
            setLineHeight(nextSettings.lineHeight);
            setLetterSpacing(nextSettings.letterSpacing);
            setReaderThemeId(nextSettings.themeId);
          }
        } catch {
          // No saved progress — start from beginning
        }

        if (destroyed) return;

        applyReaderSettings(rendition, readerSettingsRef.current);
        await rendition.display(startCfi);
        await applyReaderHorizontalMargin(
          rendition,
          readerSettingsRef.current.horizontalMargin,
          startCfi,
        );

        if (destroyed) return;
        setHasLoadedReaderSettings(true);
        setIsLoading(false);

        // Chapter list for the TOC panel (flattened one level; nested subitems kept)
        epubBook.loaded.navigation.then((nav) => {
          if (!destroyed) setToc(nav?.toc || []);
        }).catch(() => {});

        // Generate location percentages for progress % display (non-blocking)
        epubBook.locations.generate(1024).catch(() => {});

        rendition.on('relocated', (location) => {
          if (destroyed) return;
          const cfi = location.start.cfi;
          currentCfiRef.current = cfi;
          const pct = epubBook.locations.percentageFromCfi(cfi);
          const progressValue =
            typeof pct === 'number' && Number.isFinite(pct) ? pct : 0;
          setProgress(progressValue);
          setCurrentHref(location.start.href || null);
          scheduleSave({
            cfi,
            progress: progressValue,
            chapterHref: location.start.href || null,
            chapterLabel: null,
          });
        });
      } catch {
        if (!destroyed) {
          setError('无法打开这本书');
          setIsLoading(false);
        }
        rendition?.destroy();
        epubBook?.destroy();
        bookRef.current = null;
        renditionRef.current = null;
      }
    })();

    return () => {
      destroyed = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (settingsSaveTimerRef.current) clearTimeout(settingsSaveTimerRef.current);
      flushSave(pendingProgressRef.current);
      flushReaderSettingsSave(pendingReaderSettingsRef.current);
      pendingProgressRef.current = null;
      pendingReaderSettingsRef.current = null;
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
      currentCfiRef.current = null;
      bookRef.current = null;
      renditionRef.current = null;
    };
  }, [book?.id, flushReaderSettingsSave, flushSave, scheduleSave]);

  useEffect(() => {
    readerSettingsRef.current = {
      fontSize,
      fontFamilyId,
      horizontalMargin,
      verticalMargin,
      lineHeight,
      letterSpacing,
      themeId: readerThemeId,
    };
    if (isLoading || error) return;
    applyReaderSettings(renditionRef.current, readerSettingsRef.current);
  }, [
    fontSize,
    fontFamilyId,
    horizontalMargin,
    verticalMargin,
    lineHeight,
    letterSpacing,
    readerThemeId,
    isLoading,
    error,
  ]);

  useEffect(() => {
    if (isLoading || error) return;
    applyReaderHorizontalMargin(
      renditionRef.current,
      horizontalMargin,
      currentCfiRef.current,
    ).catch(() => {});
  }, [horizontalMargin, isLoading, error]);

  useEffect(() => {
    if (!hasLoadedReaderSettings) return;
    scheduleReaderSettingsSave(readerSettingsRef.current);
  }, [
    hasLoadedReaderSettings,
    fontSize,
    fontFamilyId,
    horizontalMargin,
    verticalMargin,
    lineHeight,
    letterSpacing,
    readerThemeId,
    scheduleReaderSettingsSave,
  ]);

  // Expand from the shelf cover rect (captured at click time) to full screen.
  // Skips animating entirely if no origin rect was captured.
  useEffect(() => {
    if (!originRectRef.current) return undefined;

    let raf1 = null;
    let raf2 = null;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setFlipTransitionEnabled(true);
        setFlipTransform(null);
        setCoverOpacity(0);
      });
    });

    const timer = setTimeout(() => {
      setFlipTransitionEnabled(false);
    }, READER_FLIP_ANIM_MS);

    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      clearTimeout(timer);
    };
  }, []);

  const handleCloseClick = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;

    const targetEl = book?.id
      ? document.querySelector(`[data-book-id="${book.id}"] .book-cover`)
      : null;
    const targetRect = targetEl?.getBoundingClientRect();

    if (targetRect && targetRect.width > 0 && targetRect.height > 0) {
      setFlipTransitionEnabled(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setFlipTransform(rectToTransformString(targetRect));
          setCoverOpacity(1);
        });
      });
      setTimeout(onClose, READER_FLIP_ANIM_MS);
    } else {
      setIsFallbackClosing(true);
      setTimeout(onClose, READER_FALLBACK_ANIM_MS);
    }
  }, [book?.id, onClose]);

  const turnPage = useCallback(async (dir) => {
    const rendition = renditionRef.current;
    if (!rendition || animatingRef.current) return;
    const nav = () => (dir === 'next' ? rendition.next() : rendition.prev());

    animatingRef.current = true;
    try {
      setPageTurn({ dir, phase: 'out', key: Date.now() });
      await new Promise((resolve) => {
        setTimeout(resolve, PAGE_SLIDE_OUT_MS);
      });
      await nav();
      setPageTurn({ dir, phase: 'in', key: Date.now() });
      await new Promise((resolve) => {
        setTimeout(resolve, PAGE_SLIDE_IN_MS);
      });
      setPageTurn(null);
    } finally {
      setPageTurn(null);
      animatingRef.current = false;
    }
  }, []);

  const goPrev = useCallback(() => turnPage('prev'), [turnPage]);
  const goNext = useCallback(() => turnPage('next'), [turnPage]);

  const goToHref = useCallback((href) => {
    if (!href) return;
    renditionRef.current?.display(href);
    setActivePanel(null);
  }, []);

  const decreaseFontSize = useCallback(() => {
    setFontSize((size) => clampFontSize(size - FONT_SIZE_STEP));
  }, []);

  const increaseFontSize = useCallback(() => {
    setFontSize((size) => clampFontSize(size + FONT_SIZE_STEP));
  }, []);

  const handleFontSizeChange = useCallback((event) => {
    setFontSize(clampFontSize(event.target.value));
  }, []);

  const handleHorizontalMarginChange = useCallback((event) => {
    setHorizontalMargin(clampHorizontalMargin(event.target.value));
  }, []);

  const handleVerticalMarginChange = useCallback((event) => {
    setVerticalMargin(clampVerticalMargin(event.target.value));
  }, []);

  const handleLineHeightChange = useCallback((event) => {
    setLineHeight(clampLineHeight(event.target.value));
  }, []);

  const handleLetterSpacingChange = useCallback((event) => {
    setLetterSpacing(clampLetterSpacing(event.target.value));
  }, []);

  const readerTheme = getReaderTheme(readerThemeId);

  const handlePointerDown = useCallback((event) => {
    pointerRef.current = { x: event.clientX, y: event.clientY };
  }, []);

  const handlePointerUp = useCallback((event) => {
    const start = pointerRef.current;
    pointerRef.current = null;
    if (!start) return;

    const dx = event.clientX - start.x;
    // Horizontal swipe: turn page regardless of where it started
    if (Math.abs(dx) >= SWIPE_THRESHOLD) {
      if (dx < 0) goNext();
      else goPrev();
      return;
    }

    // Tap: split reading area into left / center / right thirds
    const { left, width } = event.currentTarget.getBoundingClientRect();
    const zone = (event.clientX - left) / width;
    if (zone < 1 / 3) goPrev();
    else if (zone > 2 / 3) goNext();
    else {
      // Center tap toggles chrome; hiding chrome also dismisses any open panel
      setChromeVisible((v) => {
        if (v) setActivePanel(null);
        return !v;
      });
    }
  }, [goPrev, goNext]);

  const overlayStyle = {
    '--reader-bg': readerTheme.background,
    '--reader-text': readerTheme.text,
    '--reader-text-secondary': readerTheme.muted,
  };
  if (flipTransform) {
    overlayStyle.transform = flipTransform;
    overlayStyle.transformOrigin = '0 0';
  }
  if (flipTransitionEnabled) {
    overlayStyle.transition = `transform ${READER_FLIP_ANIM_MS}ms ${READER_FLIP_EASE}`;
  }

  return (
    <div
      className={[
        'reader-overlay',
        `reader-theme-${readerThemeId}`,
        chromeVisible ? '' : 'reader-chrome-hidden',
        isFallbackClosing ? 'reader-fallback-closing' : '',
      ].filter(Boolean).join(' ')}
      style={overlayStyle}
      role="dialog"
      aria-modal="true"
      aria-label={`正在阅读：${book?.title || '书籍'}`}
    >{/* header floats above the reading area; toggled by center tap */}
      <header className="reader-header">
        <button
          className="reader-close-button"
          type="button"
          aria-label="返回书架"
          onClick={handleCloseClick}
        >
          <span aria-hidden="true" />
        </button>
        <span className="reader-title">{book?.title || ''}</span>
        <span className="reader-progress-label" aria-label={`进度 ${Math.round(progress * 100)}%`}>
          {progress > 0 ? `${Math.round(progress * 100)}%` : ''}
        </span>
      </header>

      {book?.coverUrl && (
        <img
          className="reader-cover-clone"
          src={book.coverUrl}
          alt=""
          aria-hidden="true"
          style={{
            opacity: coverOpacity,
            transitionDuration: `${READER_COVER_FADE_MS}ms`,
          }}
        />
      )}

      <div className="reader-body">
        {isLoading && (
          <div className="reader-loading" role="status" aria-live="polite">
            <span className="reader-loading-spinner" aria-hidden="true" />
            <p>正在打开书籍</p>
          </div>
        )}
        {error && (
          <p className="reader-error error-message" role="alert">{error}</p>
        )}
        <div
          ref={containerRef}
          className={[
            'reader-epub-container',
            pageTurn ? `reader-page-slide-${pageTurn.phase}` : '',
            pageTurn ? `reader-page-slide-${pageTurn.dir}` : '',
          ].filter(Boolean).join(' ')}
        />
      </div>

      {/* Gesture layer: tap thirds (prev / toggle chrome / next) + horizontal swipe */}
      {!isLoading && !error && (
        <div
          className="reader-gesture-layer"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          aria-hidden="true"
        />
      )}

      {/* Bottom bar: entry points, shows/hides with the rest of the chrome */}
      {!isLoading && !error && (
        <nav className="reader-bottombar" aria-label="阅读器控制">
          <button
            type="button"
            className={`reader-bottombar-button${activePanel === 'toc' ? ' is-active' : ''}`}
            onClick={() => setActivePanel((p) => (p === 'toc' ? null : 'toc'))}
          >
            <span className="reader-bb-icon reader-bb-icon-toc" aria-hidden="true" />
            目录
          </button>
          <button
            type="button"
            className={`reader-bottombar-button${activePanel === 'settings' ? ' is-active' : ''}`}
            onClick={() => setActivePanel((p) => (p === 'settings' ? null : 'settings'))}
          >
            <span className="reader-bb-icon reader-bb-icon-aa" aria-hidden="true">Aa</span>
            设置
          </button>
        </nav>
      )}

      {/* Sliding panels: TOC and Aa settings */}
      {activePanel && (
        <div className="reader-panel-backdrop" onClick={() => setActivePanel(null)} />
      )}
      {activePanel === 'toc' && (
        <div className="reader-panel reader-panel-toc" role="dialog" aria-label="章节目录">
          <div className="reader-panel-handle" aria-hidden="true" />
          <h2 className="reader-panel-title">目录</h2>
          <ul className="reader-toc-list">
            {toc.length === 0 && <li className="reader-toc-empty">无目录信息</li>}
            {toc.map((item) => (
              <TocItem
                key={item.href || item.id || item.label}
                item={item}
                currentHref={currentHref}
                onSelect={goToHref}
              />
            ))}
          </ul>
        </div>
      )}
      {activePanel === 'settings' && (
        <div className="reader-panel reader-panel-settings" role="dialog" aria-label="阅读设置">
          <div className="reader-panel-handle" aria-hidden="true" />
          <h2 className="reader-panel-title">Aa 设置</h2>
          <div className="reader-settings-content">
            <section className="reader-settings-group" aria-labelledby="reader-text-settings-title">
              <h3 id="reader-text-settings-title" className="reader-settings-group-title">文字</h3>
              <div className="reader-settings-section" aria-labelledby="reader-font-size-title">
                <div className="reader-settings-row">
                  <span id="reader-font-size-title" className="reader-settings-label">字体大小</span>
                  <span className="reader-settings-value">{fontSize}%</span>
                </div>
                <div className="reader-font-size-control">
                  <button
                    type="button"
                    className="reader-font-step"
                    onClick={decreaseFontSize}
                    disabled={fontSize <= FONT_SIZE_MIN}
                    aria-label="减小字体"
                  >
                    A
                  </button>
                  <input
                    className="reader-setting-slider"
                    type="range"
                    min={FONT_SIZE_MIN}
                    max={FONT_SIZE_MAX}
                    step={FONT_SIZE_STEP}
                    value={fontSize}
                    onChange={handleFontSizeChange}
                    aria-labelledby="reader-font-size-title"
                  />
                  <button
                    type="button"
                    className="reader-font-step reader-font-step-large"
                    onClick={increaseFontSize}
                    disabled={fontSize >= FONT_SIZE_MAX}
                    aria-label="增大字体"
                  >
                    A
                  </button>
                </div>
              </div>

              <div className="reader-settings-section" aria-labelledby="reader-font-family-title">
                <div className="reader-settings-row">
                  <span id="reader-font-family-title" className="reader-settings-label">字体</span>
                </div>
                <div className="reader-font-options" role="group" aria-labelledby="reader-font-family-title">
                  {FONT_FAMILY_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`reader-font-option${fontFamilyId === option.id ? ' is-active' : ''}`}
                      style={{ fontFamily: option.value }}
                      onClick={() => setFontFamilyId(option.id)}
                      aria-pressed={fontFamilyId === option.id}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="reader-settings-group" aria-labelledby="reader-layout-settings-title">
              <h3 id="reader-layout-settings-title" className="reader-settings-group-title">排版</h3>
              <ReaderRangeSetting
                id="reader-horizontal-margin-title"
                label="左右边距"
                value={horizontalMargin}
                valueLabel={`每侧 ${horizontalMargin}px`}
                min={HORIZONTAL_MARGIN_MIN}
                max={HORIZONTAL_MARGIN_MAX}
                step={HORIZONTAL_MARGIN_STEP}
                onChange={handleHorizontalMarginChange}
              />
              <ReaderRangeSetting
                id="reader-vertical-margin-title"
                label="上下边距"
                value={verticalMargin}
                valueLabel={`${verticalMargin}px`}
                min={VERTICAL_MARGIN_MIN}
                max={VERTICAL_MARGIN_MAX}
                step={VERTICAL_MARGIN_STEP}
                onChange={handleVerticalMarginChange}
              />
              <ReaderRangeSetting
                id="reader-line-height-title"
                label="行距"
                value={lineHeight}
                valueLabel={lineHeight.toFixed(1)}
                min={LINE_HEIGHT_MIN}
                max={LINE_HEIGHT_MAX}
                step={LINE_HEIGHT_STEP}
                onChange={handleLineHeightChange}
              />
              <ReaderRangeSetting
                id="reader-letter-spacing-title"
                label="字距"
                value={letterSpacing}
                valueLabel={letterSpacing === 0 ? '默认' : `${letterSpacing.toFixed(2)}em`}
                min={LETTER_SPACING_MIN}
                max={LETTER_SPACING_MAX}
                step={LETTER_SPACING_STEP}
                onChange={handleLetterSpacingChange}
              />
            </section>

            <section className="reader-settings-group" aria-labelledby="reader-appearance-settings-title">
              <h3 id="reader-appearance-settings-title" className="reader-settings-group-title">外观</h3>
              <div className="reader-settings-section" aria-labelledby="reader-theme-title">
                <div className="reader-settings-row">
                  <span id="reader-theme-title" className="reader-settings-label">主题</span>
                  <span className="reader-settings-value">{readerTheme.label}</span>
                </div>
                <div className="reader-theme-options" role="group" aria-labelledby="reader-theme-title">
                  {READER_THEME_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`reader-theme-option${readerThemeId === option.id ? ' is-active' : ''}`}
                      onClick={() => setReaderThemeId(option.id)}
                      aria-pressed={readerThemeId === option.id}
                    >
                      <span
                        className="reader-theme-swatch"
                        style={{
                          backgroundColor: option.swatch,
                          color: option.text,
                        }}
                        aria-hidden="true"
                      />
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>

            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function ReaderRangeSetting({ id, label, value, valueLabel, min, max, step, onChange }) {
  return (
    <div className="reader-settings-section" aria-labelledby={id}>
      <div className="reader-settings-row">
        <span id={id} className="reader-settings-label">{label}</span>
        <span className="reader-settings-value">{valueLabel}</span>
      </div>
      <input
        className="reader-setting-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        aria-labelledby={id}
      />
    </div>
  );
}

// Renders a TOC entry plus one level of nested subitems (no deeper nesting UI)
function TocItem({ item, currentHref, onSelect }) {
  const href = item.href || '';
  const active = currentHref && href && currentHref.split('#')[0] === href.split('#')[0];
  return (
    <li>
      <button
        type="button"
        className={`reader-toc-entry${active ? ' is-current' : ''}`}
        onClick={() => onSelect(href)}
      >
        {item.label?.trim() || '未命名章节'}
      </button>
      {Array.isArray(item.subitems) && item.subitems.length > 0 && (
        <ul className="reader-toc-sublist">
          {item.subitems.map((sub) => (
            <li key={sub.href || sub.id || sub.label}>
              <button
                type="button"
                className="reader-toc-entry reader-toc-subentry"
                onClick={() => onSelect(sub.href || '')}
              >
                {sub.label?.trim() || '未命名章节'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default ReaderView;
