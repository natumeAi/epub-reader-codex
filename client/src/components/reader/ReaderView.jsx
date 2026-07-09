import { useCallback, useEffect, useRef, useState } from 'react';
import Epub from 'epubjs';
import {
  getReaderSettings,
  getReadingProgress,
  saveReaderSettings,
  saveReadingProgress,
} from '../../api/readingApi.js';
import { ReaderBottomBar } from './ReaderBottomBar.jsx';
import { ReaderSettingsPanel } from './ReaderSettingsPanel.jsx';
import { ReaderTopBar } from './ReaderTopBar.jsx';
import { TocPanel } from './TocPanel.jsx';

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
const BASE_HORIZONTAL_MARGIN = 48;
const DEFAULT_HORIZONTAL_MARGIN = 0;
const HORIZONTAL_MARGIN_MIN = 0;
const HORIZONTAL_MARGIN_MAX = 48;
const HORIZONTAL_MARGIN_STEP = 6;
const BASE_VERTICAL_MARGIN = 60;
const DEFAULT_VERTICAL_MARGIN = 0;
const VERTICAL_MARGIN_MIN = 0;
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
    id: 'pingfang',
    label: '苹方',
    value: '"PingFang SC", "PingFang TC", "PingFang HK", -apple-system, BlinkMacSystemFont, sans-serif',
  },
  {
    id: 'yahei',
    label: '微软雅黑',
    value: '"Microsoft YaHei", "Microsoft JhengHei", "PingFang SC", sans-serif',
  },
  {
    id: 'sans',
    label: '黑体',
    value: '"Heiti SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
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

function isKeyboardEditingTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"], [role="slider"]'));
}

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

function getEffectiveHorizontalMargin(horizontalMargin) {
  return BASE_HORIZONTAL_MARGIN + clampHorizontalMargin(horizontalMargin);
}

function getEffectiveVerticalMargin(verticalMargin) {
  return BASE_VERTICAL_MARGIN + clampVerticalMargin(verticalMargin);
}

function getPageProgressFromLocation(location) {
  const displayed = location?.start?.displayed;
  const current = Number(displayed?.page);
  const total = Number(displayed?.total);

  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) {
    return null;
  }

  return {
    current: Math.min(total, Math.max(1, Math.round(current))),
    total: Math.max(1, Math.round(total)),
  };
}

async function getCurrentRenditionLocation(rendition) {
  const location = rendition?.currentLocation?.();
  if (!location) return null;

  return typeof location.then === 'function' ? location : Promise.resolve(location);
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
  return getReaderFontOption(fontFamilyId).value;
}

function getReaderFontOption(fontFamilyId) {
  return FONT_FAMILY_OPTIONS.find((option) => option.id === fontFamilyId) ||
    FONT_FAMILY_OPTIONS[0];
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

function getReaderLayoutCss({ verticalMargin, lineHeight, letterSpacing }) {
  const effectiveVerticalMargin = getEffectiveVerticalMargin(verticalMargin);

  return `
    html {
      margin: 0 !important;
      padding: 0 !important;
    }

    body {
      padding-top: ${effectiveVerticalMargin}px !important;
      padding-bottom: ${effectiveVerticalMargin}px !important;
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

  const verticalMargin = `${getEffectiveVerticalMargin(settings.verticalMargin)}px`;
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

  manager.settings.gap = getEffectiveHorizontalMargin(horizontalMargin) * 2;
  manager.updateLayout?.();

  if (cfi) {
    await rendition.display(cfi);
  }
}

function applyReaderSettings(rendition, settings) {
  if (!rendition?.themes) return;
  const theme = getReaderTheme(settings.themeId);
  const verticalMargin = `${getEffectiveVerticalMargin(settings.verticalMargin)}px`;
  const lineHeight = String(settings.lineHeight);
  const letterSpacing = `${settings.letterSpacing}em`;

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
  rendition.themes.override('padding-top', verticalMargin, true);
  rendition.themes.override('padding-bottom', verticalMargin, true);
  rendition.themes.override('line-height', lineHeight, true);
  rendition.themes.override('letter-spacing', letterSpacing, true);
  rendition.themes.override('background', theme.background, true);
  rendition.themes.override('color', theme.text, true);
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
  const [pageProgress, setPageProgress] = useState(null);
  const [chromeVisible, setChromeVisible] = useState(false);
  // Bottom-bar panel: null | 'toc' | 'settings'
  const [activePanel, setActivePanel] = useState(null);
  // Settings panel page: 'main' | 'font'
  const [settingsView, setSettingsView] = useState('main');
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
  const [readerReloadKey, setReaderReloadKey] = useState(0);
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

  const flushPendingChanges = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (settingsSaveTimerRef.current) clearTimeout(settingsSaveTimerRef.current);
    flushSave(pendingProgressRef.current);
    flushReaderSettingsSave(pendingReaderSettingsRef.current);
    pendingProgressRef.current = null;
    pendingReaderSettingsRef.current = null;
  }, [flushReaderSettingsSave, flushSave]);

  useEffect(() => {
    if (!containerRef.current || !book?.id) return;

    let destroyed = false;
    setIsLoading(true);
    setError('');
    setPageProgress(null);
    setToc([]);
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
          setPageProgress(getPageProgressFromLocation(location));
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
      flushPendingChanges();
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
      currentCfiRef.current = null;
      bookRef.current = null;
      renditionRef.current = null;
    };
  }, [book?.id, flushPendingChanges, readerReloadKey, scheduleSave]);

  const recoverVisibleReader = useCallback(() => {
    if (!book?.id || isClosingRef.current || isLoading || error) return;

    requestAnimationFrame(() => {
      const container = containerRef.current;
      const rendition = renditionRef.current;

      if (!container) {
        return;
      }

      const hasRenderedFrame = Boolean(container.querySelector('iframe'));

      if (!rendition || !hasRenderedFrame) {
        setError('');
        setIsLoading(true);
        setHasLoadedReaderSettings(false);
        setReaderReloadKey((key) => key + 1);
        return;
      }

      rendition.resize?.();

      if (currentCfiRef.current) {
        rendition.display(currentCfiRef.current).catch(() => {});
      }
    });
  }, [book?.id, error, isLoading]);

  useEffect(() => {
    const handlePageHide = () => {
      flushPendingChanges();
    };
    const handlePageShow = () => {
      recoverVisibleReader();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        recoverVisibleReader();
      } else {
        flushPendingChanges();
      }
    };

    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [flushPendingChanges, recoverVisibleReader]);

  useEffect(() => {
    if (activePanel !== 'settings') {
      setSettingsView('main');
    }
  }, [activePanel]);

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
    const rendition = renditionRef.current;
    applyReaderSettings(rendition, readerSettingsRef.current);

    const timer = setTimeout(() => {
      getCurrentRenditionLocation(rendition)
        .then((location) => {
          if (renditionRef.current !== rendition) return;
          const nextPageProgress = getPageProgressFromLocation(location);
          if (nextPageProgress) setPageProgress(nextPageProgress);
        })
        .catch(() => {});
    }, 80);

    return () => clearTimeout(timer);
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
    const rendition = renditionRef.current;
    applyReaderHorizontalMargin(
      rendition,
      horizontalMargin,
      currentCfiRef.current,
    )
      .then(() => getCurrentRenditionLocation(rendition))
      .then((location) => {
        if (renditionRef.current !== rendition) return;
        const nextPageProgress = getPageProgressFromLocation(location);
        if (nextPageProgress) setPageProgress(nextPageProgress);
      })
      .catch(() => {});
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
      applyReaderSettings(rendition, readerSettingsRef.current);
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

  useEffect(() => {
    if (isLoading || error || activePanel) return undefined;

    const handleKeyDown = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || isKeyboardEditingTarget(event.target)) {
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goPrev();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePanel, error, goNext, goPrev, isLoading]);

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
  const readerFont = getReaderFontOption(fontFamilyId);

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
  const pageProgressLabel = pageProgress
    ? `${pageProgress.current}/${pageProgress.total}`
    : '--/--';
  const layoutSettings = [
    {
      id: 'reader-horizontal-margin-title',
      label: '左右边距',
      value: horizontalMargin,
      valueLabel: `额外 ${horizontalMargin}px / 实际 ${getEffectiveHorizontalMargin(horizontalMargin)}px`,
      min: HORIZONTAL_MARGIN_MIN,
      max: HORIZONTAL_MARGIN_MAX,
      step: HORIZONTAL_MARGIN_STEP,
      onChange: handleHorizontalMarginChange,
    },
    {
      id: 'reader-vertical-margin-title',
      label: '上下边距',
      value: verticalMargin,
      valueLabel: `额外 ${verticalMargin}px / 实际 ${getEffectiveVerticalMargin(verticalMargin)}px`,
      min: VERTICAL_MARGIN_MIN,
      max: VERTICAL_MARGIN_MAX,
      step: VERTICAL_MARGIN_STEP,
      onChange: handleVerticalMarginChange,
    },
    {
      id: 'reader-line-height-title',
      label: '行距',
      value: lineHeight,
      valueLabel: lineHeight.toFixed(1),
      min: LINE_HEIGHT_MIN,
      max: LINE_HEIGHT_MAX,
      step: LINE_HEIGHT_STEP,
      onChange: handleLineHeightChange,
    },
    {
      id: 'reader-letter-spacing-title',
      label: '字距',
      value: letterSpacing,
      valueLabel: letterSpacing === 0 ? '默认' : `${letterSpacing.toFixed(2)}em`,
      min: LETTER_SPACING_MIN,
      max: LETTER_SPACING_MAX,
      step: LETTER_SPACING_STEP,
      onChange: handleLetterSpacingChange,
    },
  ];

  const handleToggleTocPanel = () => {
    setActivePanel((panel) => (panel === 'toc' ? null : 'toc'));
  };

  const handleToggleSettingsPanel = () => {
    setActivePanel((panel) => {
      if (panel === 'settings') return null;
      setSettingsView('main');
      return 'settings';
    });
  };

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
    >
      <ReaderTopBar
        onClose={handleCloseClick}
        progress={progress}
        title={book?.title}
      />

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

      {!isLoading && !error && (
        <span className="reader-page-progress" aria-label={`页码 ${pageProgressLabel}`}>
          {pageProgressLabel}
        </span>
      )}

      {!isLoading && !error && (
        <ReaderBottomBar
          activePanel={activePanel}
          onToggleSettings={handleToggleSettingsPanel}
          onToggleToc={handleToggleTocPanel}
        />
      )}

      {activePanel && (
        <div className="reader-panel-backdrop" onClick={() => setActivePanel(null)} />
      )}
      {activePanel === 'toc' && (
        <TocPanel
          currentHref={currentHref}
          onSelect={goToHref}
          toc={toc}
        />
      )}
      {activePanel === 'settings' && (
        <ReaderSettingsPanel
          fontFamilyId={fontFamilyId}
          fontFamilyOptions={FONT_FAMILY_OPTIONS}
          fontSize={fontSize}
          fontSizeMax={FONT_SIZE_MAX}
          fontSizeMin={FONT_SIZE_MIN}
          fontSizeStep={FONT_SIZE_STEP}
          layoutSettings={layoutSettings}
          onBackToMain={() => setSettingsView('main')}
          onDecreaseFontSize={decreaseFontSize}
          onFontFamilyChange={setFontFamilyId}
          onFontSizeChange={handleFontSizeChange}
          onIncreaseFontSize={increaseFontSize}
          onOpenFontSettings={() => setSettingsView('font')}
          onThemeChange={setReaderThemeId}
          readerFont={readerFont}
          readerTheme={readerTheme}
          readerThemeId={readerThemeId}
          settingsView={settingsView}
          themeOptions={READER_THEME_OPTIONS}
        />
      )}
    </div>
  );
}

export default ReaderView;
