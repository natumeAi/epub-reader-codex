import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getReaderSettings, saveReaderSettings } from '../api/readingApi.js';

const SETTINGS_SAVE_DEBOUNCE_MS = 500;
const DEFAULT_FONT_SIZE = 100;
const FONT_SIZE_MIN = 80;
const FONT_SIZE_MAX = 140;
const FONT_SIZE_STEP = 10;
const BASE_HORIZONTAL_MARGIN = 48;
const READER_COLUMN_GAP = 0;
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
const DEFAULT_READER_SETTINGS = {
  fontSize: DEFAULT_FONT_SIZE,
  fontFamilyId: DEFAULT_FONT_FAMILY_ID,
  horizontalMargin: DEFAULT_HORIZONTAL_MARGIN,
  verticalMargin: DEFAULT_VERTICAL_MARGIN,
  lineHeight: DEFAULT_LINE_HEIGHT,
  letterSpacing: DEFAULT_LETTER_SPACING,
  themeId: DEFAULT_THEME_ID,
};

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

function sanitizeFontFamilyId(fontFamilyId) {
  return FONT_FAMILY_OPTIONS.some((option) => option.id === fontFamilyId)
    ? fontFamilyId
    : DEFAULT_FONT_FAMILY_ID;
}

function sanitizeThemeId(themeId) {
  return READER_THEME_OPTIONS.some((option) => option.id === themeId)
    ? themeId
    : DEFAULT_THEME_ID;
}

function getEffectiveHorizontalMargin(horizontalMargin) {
  return BASE_HORIZONTAL_MARGIN + clampHorizontalMargin(horizontalMargin);
}

function getEffectiveVerticalMargin(verticalMargin) {
  return BASE_VERTICAL_MARGIN + clampVerticalMargin(verticalMargin);
}

function getReaderFontOption(fontFamilyId) {
  return FONT_FAMILY_OPTIONS.find((option) => option.id === fontFamilyId) ||
    FONT_FAMILY_OPTIONS[0];
}

function getReaderFontFamily(fontFamilyId) {
  return getReaderFontOption(fontFamilyId).value;
}

function getReaderTheme(themeId) {
  return READER_THEME_OPTIONS.find((option) => option.id === themeId) ||
    READER_THEME_OPTIONS[0];
}

function sanitizeReaderSettings(settings) {
  return {
    fontSize: clampFontSize(settings?.fontSize),
    fontFamilyId: sanitizeFontFamilyId(settings?.fontFamilyId),
    horizontalMargin: clampHorizontalMargin(settings?.horizontalMargin),
    verticalMargin: clampVerticalMargin(settings?.verticalMargin),
    lineHeight: clampLineHeight(settings?.lineHeight),
    letterSpacing: clampLetterSpacing(settings?.letterSpacing),
    themeId: sanitizeThemeId(settings?.themeId),
  };
}

function getReaderLayoutCss({ verticalMargin, lineHeight, letterSpacing }) {
  const effectiveVerticalMargin = getEffectiveVerticalMargin(verticalMargin);

  return `
    html {
      margin: 0 !important;
      padding: 0 !important;
    }

    body {
      box-sizing: border-box !important;
      padding-left: 0 !important;
      padding-right: 0 !important;
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

  contents.css?.('box-sizing', 'border-box', true);
  contents.css?.('padding-left', '0px', true);
  contents.css?.('padding-right', '0px', true);
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

function applyReaderLayoutStylesToFrames(container, settings) {
  if (!container) return;

  const verticalMargin = `${getEffectiveVerticalMargin(settings.verticalMargin)}px`;

  container.querySelectorAll('iframe').forEach((iframe) => {
    const body = iframe.contentDocument?.body;
    if (!body) return;

    body.style.setProperty('box-sizing', 'border-box', 'important');
    body.style.setProperty('padding-left', '0px', 'important');
    body.style.setProperty('padding-right', '0px', 'important');
    body.style.setProperty('padding-top', verticalMargin, 'important');
    body.style.setProperty('padding-bottom', verticalMargin, 'important');
  });
}

function applyReaderSettingsToRendition(rendition, settings) {
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
  rendition.themes.override('box-sizing', 'border-box', true);
  rendition.themes.override('padding-left', '0px', true);
  rendition.themes.override('padding-right', '0px', true);
  rendition.themes.override('padding-top', verticalMargin, true);
  rendition.themes.override('padding-bottom', verticalMargin, true);
  rendition.themes.override('line-height', lineHeight, true);
  rendition.themes.override('letter-spacing', letterSpacing, true);
  rendition.themes.override('background', theme.background, true);
  rendition.themes.override('color', theme.text, true);
  rendition.themes.fontSize(`${settings.fontSize}%`);
  rendition.themes.font(getReaderFontFamily(settings.fontFamilyId));
}

function applyReaderHorizontalMarginStylesToRendition(rendition, horizontalMargin) {
  if (!rendition?.themes) return;

  rendition.getContents?.().forEach((contents) => {
    contents.css?.('box-sizing', 'border-box', true);
    contents.css?.('padding-left', '0px', true);
    contents.css?.('padding-right', '0px', true);
  });
  rendition.themes.override('box-sizing', 'border-box', true);
  rendition.themes.override('padding-left', '0px', true);
  rendition.themes.override('padding-right', '0px', true);
}

async function applyReaderHorizontalMarginToRendition(rendition, horizontalMargin, cfi) {
  const manager = rendition?.manager;
  const layout = rendition?._layout;
  if (!manager || !layout) return;

  manager.settings.gap = READER_COLUMN_GAP;
  rendition.resize?.();
  manager.updateLayout?.();
  applyReaderHorizontalMarginStylesToRendition(rendition, horizontalMargin);

  if (cfi) {
    await rendition.display(cfi);
    applyReaderHorizontalMarginStylesToRendition(rendition, horizontalMargin);
  }
}

export function useReaderSettings({
  containerRef,
  currentCfiRef,
  isReaderReady,
  onSettingsReflow,
  renditionRef,
}) {
  const settingsSaveTimerRef = useRef(null);
  const pendingReaderSettingsRef = useRef(null);
  const readerSettingsRef = useRef(DEFAULT_READER_SETTINGS);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [fontFamilyId, setFontFamilyId] = useState(DEFAULT_FONT_FAMILY_ID);
  const [horizontalMargin, setHorizontalMargin] = useState(DEFAULT_HORIZONTAL_MARGIN);
  const [verticalMargin, setVerticalMargin] = useState(DEFAULT_VERTICAL_MARGIN);
  const [lineHeight, setLineHeight] = useState(DEFAULT_LINE_HEIGHT);
  const [letterSpacing, setLetterSpacing] = useState(DEFAULT_LETTER_SPACING);
  const [readerThemeId, setReaderThemeId] = useState(DEFAULT_THEME_ID);
  const [hasLoadedReaderSettings, setHasLoadedReaderSettings] = useState(false);

  const readerSettings = useMemo(() => ({
    fontSize,
    fontFamilyId,
    horizontalMargin,
    verticalMargin,
    lineHeight,
    letterSpacing,
    themeId: readerThemeId,
  }), [
    fontSize,
    fontFamilyId,
    horizontalMargin,
    verticalMargin,
    lineHeight,
    letterSpacing,
    readerThemeId,
  ]);

  useEffect(() => {
    readerSettingsRef.current = readerSettings;
  }, [readerSettings]);

  const updateReaderSettingsState = useCallback((settings) => {
    const nextSettings = sanitizeReaderSettings(settings);
    readerSettingsRef.current = nextSettings;
    setFontSize(nextSettings.fontSize);
    setFontFamilyId(nextSettings.fontFamilyId);
    setHorizontalMargin(nextSettings.horizontalMargin);
    setVerticalMargin(nextSettings.verticalMargin);
    setLineHeight(nextSettings.lineHeight);
    setLetterSpacing(nextSettings.letterSpacing);
    setReaderThemeId(nextSettings.themeId);
    return nextSettings;
  }, []);

  const loadReaderSettings = useCallback(async () => {
    const result = await getReaderSettings();
    return updateReaderSettingsState(result?.settings);
  }, [updateReaderSettingsState]);

  const resetReaderSettingsLoad = useCallback(() => {
    setHasLoadedReaderSettings(false);
  }, []);

  const markReaderSettingsLoaded = useCallback(() => {
    setHasLoadedReaderSettings(true);
  }, []);

  const flushReaderSettingsSave = useCallback((settings) => {
    if (!settings) return;
    saveReaderSettings(settings).catch(() => {});
  }, []);

  const flushPendingReaderSettings = useCallback(() => {
    if (settingsSaveTimerRef.current) clearTimeout(settingsSaveTimerRef.current);
    flushReaderSettingsSave(pendingReaderSettingsRef.current);
    pendingReaderSettingsRef.current = null;
  }, [flushReaderSettingsSave]);

  const scheduleReaderSettingsSave = useCallback((settings) => {
    pendingReaderSettingsRef.current = settings;
    if (settingsSaveTimerRef.current) clearTimeout(settingsSaveTimerRef.current);
    settingsSaveTimerRef.current = setTimeout(() => {
      flushReaderSettingsSave(pendingReaderSettingsRef.current);
      pendingReaderSettingsRef.current = null;
    }, SETTINGS_SAVE_DEBOUNCE_MS);
  }, [flushReaderSettingsSave]);

  useEffect(() => {
    return () => flushPendingReaderSettings();
  }, [flushPendingReaderSettings]);

  const syncReaderFrameLayout = useCallback(() => {
    const applyLatestLayout = () => {
      applyReaderLayoutStylesToFrames(containerRef.current, readerSettingsRef.current);
    };

    applyLatestLayout();

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(applyLatestLayout);
    } else {
      setTimeout(applyLatestLayout, 0);
    }

    setTimeout(applyLatestLayout, 120);
  }, [containerRef]);

  const applyReaderSettings = useCallback((rendition, settings = readerSettingsRef.current) => {
    applyReaderSettingsToRendition(rendition, settings);
    syncReaderFrameLayout();
  }, [syncReaderFrameLayout]);

  const applyReaderSettingsToContents = useCallback((contents, settings = readerSettingsRef.current) => {
    const theme = getReaderTheme(settings.themeId);
    applyReaderLayoutStylesToContents(contents, settings);
    applyReaderThemeStylesToContents(contents, theme);
  }, []);

  const applyReaderHorizontalMargin = useCallback((
    rendition,
    horizontalMarginValue = readerSettingsRef.current.horizontalMargin,
    cfi = currentCfiRef.current,
  ) => (
    applyReaderHorizontalMarginToRendition(rendition, horizontalMarginValue, cfi)
      .then((result) => {
        syncReaderFrameLayout();
        return result;
      })
  ), [currentCfiRef, syncReaderFrameLayout]);

  useEffect(() => {
    if (!isReaderReady) return undefined;
    const rendition = renditionRef.current;
    applyReaderSettings(rendition, readerSettingsRef.current);

    const timer = setTimeout(() => {
      onSettingsReflow?.(rendition);
    }, 80);

    return () => clearTimeout(timer);
  }, [
    applyReaderSettings,
    isReaderReady,
    onSettingsReflow,
    readerSettings,
    renditionRef,
  ]);

  useEffect(() => {
    if (!isReaderReady) return;
    const rendition = renditionRef.current;
    applyReaderHorizontalMargin(
      rendition,
      horizontalMargin,
      currentCfiRef.current,
    )
      .then(() => onSettingsReflow?.(rendition))
      .catch(() => {});
  }, [
    applyReaderHorizontalMargin,
    currentCfiRef,
    horizontalMargin,
    isReaderReady,
    onSettingsReflow,
    renditionRef,
  ]);

  useEffect(() => {
    if (!hasLoadedReaderSettings) return;
    scheduleReaderSettingsSave(readerSettingsRef.current);
  }, [hasLoadedReaderSettings, readerSettings, scheduleReaderSettingsSave]);

  const decreaseFontSize = useCallback(() => {
    setFontSize((size) => clampFontSize(size - FONT_SIZE_STEP));
  }, []);

  const increaseFontSize = useCallback(() => {
    setFontSize((size) => clampFontSize(size + FONT_SIZE_STEP));
  }, []);

  const handleFontSizeChange = useCallback((event) => {
    setFontSize(clampFontSize(event.target.value));
  }, []);

  const handleFontFamilyChange = useCallback((nextFontFamilyId) => {
    setFontFamilyId(sanitizeFontFamilyId(nextFontFamilyId));
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

  const handleThemeChange = useCallback((nextThemeId) => {
    setReaderThemeId(sanitizeThemeId(nextThemeId));
  }, []);

  const readerTheme = useMemo(() => getReaderTheme(readerThemeId), [readerThemeId]);
  const readerFont = useMemo(() => getReaderFontOption(fontFamilyId), [fontFamilyId]);
  const readerViewportStyle = useMemo(() => {
    const horizontalInset = `${getEffectiveHorizontalMargin(horizontalMargin)}px`;
    return {
      left: horizontalInset,
      right: horizontalInset,
    };
  }, [horizontalMargin]);
  const layoutSettings = useMemo(() => [
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
  ], [
    handleHorizontalMarginChange,
    handleLetterSpacingChange,
    handleLineHeightChange,
    handleVerticalMarginChange,
    horizontalMargin,
    letterSpacing,
    lineHeight,
    verticalMargin,
  ]);

  return {
    applyReaderHorizontalMargin,
    applyReaderSettings,
    applyReaderSettingsToContents,
    decreaseFontSize,
    flushPendingReaderSettings,
    fontFamilyId,
    fontFamilyOptions: FONT_FAMILY_OPTIONS,
    fontSize,
    fontSizeMax: FONT_SIZE_MAX,
    fontSizeMin: FONT_SIZE_MIN,
    fontSizeStep: FONT_SIZE_STEP,
    handleFontFamilyChange,
    handleFontSizeChange,
    handleThemeChange,
    increaseFontSize,
    layoutSettings,
    loadReaderSettings,
    markReaderSettingsLoaded,
    readerFont,
    readerSettingsRef,
    readerTheme,
    readerThemeId,
    readerViewportStyle,
    resetReaderSettingsLoad,
    themeOptions: READER_THEME_OPTIONS,
  };
}
