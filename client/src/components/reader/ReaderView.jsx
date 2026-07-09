import { useCallback, useEffect, useRef, useState } from 'react';
import { saveReadingProgress } from '../../api/readingApi.js';
import { useEpubRendition } from '../../hooks/useEpubRendition.js';
import { usePageProgress } from '../../hooks/usePageProgress.js';
import { useReaderSettings } from '../../hooks/useReaderSettings.js';
import { ReaderBottomBar } from './ReaderBottomBar.jsx';
import { ReaderSettingsPanel } from './ReaderSettingsPanel.jsx';
import { ReaderTopBar } from './ReaderTopBar.jsx';
import { TocPanel } from './TocPanel.jsx';

const SAVE_DEBOUNCE_MS = 2000;
// Horizontal travel (px) past which a pointer gesture counts as a swipe, not a tap
const SWIPE_THRESHOLD = 45;
// Page-turn animation. Start the visual response before epub.js navigation,
// but do not let epub.js swap iframe contents before the current page leaves.
const PAGE_SLIDE_OUT_MS = 80;
const PAGE_SLIDE_IN_MS = 80;
const PAGE_NAV_TIMEOUT_MS = 1200;
// Open/close FLIP animation: overlay scales between the shelf cover rect and full screen.
// Same duration/easing both directions to keep open/close symmetric.
const READER_FLIP_ANIM_MS = 300;
const READER_FLIP_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const READER_COVER_FADE_MS = 200;
// Fallback when the origin/target cover rect can't be found (e.g. off-screen).
const READER_FALLBACK_ANIM_MS = 220;

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function waitForNextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });
}

function waitForPageTurnAnimation(elements, fallbackMs) {
  return new Promise((resolve) => {
    let settled = false;
    const animatedElements = elements.filter(Boolean).filter((element) => {
      const style = window.getComputedStyle(element);
      return style.animationName !== 'none' && style.animationDuration !== '0s';
    });

    if (animatedElements.length === 0) {
      wait(fallbackMs).then(resolve);
      return;
    }

    const cleanups = [];
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanups.forEach((cleanup) => cleanup());
      resolve();
    };

    const timer = setTimeout(finish, fallbackMs + 160);
    cleanups.push(() => clearTimeout(timer));

    animatedElements.forEach((element) => {
      const handleAnimationDone = (event) => {
        if (event.target === element) finish();
      };
      element.addEventListener('animationend', handleAnimationDone);
      element.addEventListener('animationcancel', handleAnimationDone);
      cleanups.push(() => {
        element.removeEventListener('animationend', handleAnimationDone);
        element.removeEventListener('animationcancel', handleAnimationDone);
      });
    });
  });
}

function waitForRelocated(rendition, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      rendition.off?.('relocated', finish);
      resolve();
    };

    rendition.on?.('relocated', finish);
    timer = setTimeout(finish, timeoutMs);
  });
}

async function getCurrentLocation(rendition) {
  const location = rendition?.currentLocation?.();
  if (!location) return null;
  return typeof location.then === 'function' ? location : Promise.resolve(location);
}

function isAtPageBoundary(location, dir) {
  return dir === 'next' ? Boolean(location?.atEnd) : Boolean(location?.atStart);
}

function schedulePageTurnFollowUp(callback) {
  requestAnimationFrame(() => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(callback, { timeout: 500 });
      return;
    }
    setTimeout(callback, 80);
  });
}

function isKeyboardEditingTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"], [role="slider"]'));
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

export function ReaderView({ book, originRect, onClose }) {
  const containerRef = useRef(null);
  const bookRef = useRef(null);
  const renditionRef = useRef(null);
  const saveTimerRef = useRef(null);
  const pendingProgressRef = useRef(null);
  const pointerRef = useRef(null);
  const animatingRef = useRef(false);
  const currentCfiRef = useRef(null);
  const originRectRef = useRef(originRect);
  const isClosingRef = useRef(false);
  const pageTurnSheetRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [chromeVisible, setChromeVisible] = useState(false);
  // Bottom-bar panel: null | 'toc' | 'settings'
  const [activePanel, setActivePanel] = useState(null);
  // Settings panel page: 'main' | 'font'
  const [settingsView, setSettingsView] = useState('main');
  // Fixed page slide: current page moves immediately, then epub.js navigates while hidden.
  const [pageTurn, setPageTurn] = useState(null);
  // Open/close FLIP animation state: the overlay transform collapses onto (or
  // expands from) the shelf cover rect captured at click time.
  const [flipTransform, setFlipTransform] = useState(() => (
    originRect ? rectToTransformString(originRect) : null
  ));
  const [flipTransitionEnabled, setFlipTransitionEnabled] = useState(false);
  const [coverOpacity, setCoverOpacity] = useState(() => (originRect ? 1 : 0));
  const [isFallbackClosing, setIsFallbackClosing] = useState(false);

  const {
    pageProgressLabel,
    refreshCurrentPageProgress,
    resetPageProgress,
    updatePageProgressFromLocation,
  } = usePageProgress({ renditionRef });

  const {
    applyReaderHorizontalMargin,
    applyReaderSettings,
    applyReaderSettingsToContents,
    decreaseFontSize,
    flushPendingReaderSettings,
    fontFamilyId,
    fontFamilyOptions,
    fontSize,
    fontSizeMax,
    fontSizeMin,
    fontSizeStep,
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
    themeOptions,
  } = useReaderSettings({
    containerRef,
    currentCfiRef,
    isReaderReady: !isLoading && !error,
    onSettingsReflow: refreshCurrentPageProgress,
    renditionRef,
  });

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

  const flushPendingChanges = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    flushSave(pendingProgressRef.current);
    flushPendingReaderSettings();
    pendingProgressRef.current = null;
  }, [flushPendingReaderSettings, flushSave]);

  const {
    currentHref,
    progress,
    toc,
  } = useEpubRendition({
    applyReaderHorizontalMargin,
    applyReaderSettings,
    applyReaderSettingsToContents,
    book,
    bookRef,
    containerRef,
    currentCfiRef,
    error,
    flushPendingChanges,
    isClosingRef,
    isLoading,
    loadReaderSettings,
    markReaderSettingsLoaded,
    readerSettingsRef,
    renditionRef,
    resetPageProgress,
    resetReaderSettingsLoad,
    scheduleSave,
    setError,
    setIsLoading,
    updatePageProgressFromLocation,
  });

  useEffect(() => {
    if (activePanel !== 'settings') {
      setSettingsView('main');
    }
  }, [activePanel]);

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
      const currentLocation = await getCurrentLocation(rendition).catch(() => null);
      if (isAtPageBoundary(currentLocation, dir)) return;

      setPageTurn({ dir, phase: 'out', key: Date.now() });
      await waitForNextPaint();
      await waitForPageTurnAnimation(
        [containerRef.current, pageTurnSheetRef.current],
        PAGE_SLIDE_OUT_MS,
      );

      const relocated = waitForRelocated(rendition, PAGE_NAV_TIMEOUT_MS);
      Promise.resolve(nav()).catch(() => {});
      await relocated;

      setPageTurn({ dir, phase: 'in', key: Date.now() });
      await waitForNextPaint();
      await waitForPageTurnAnimation(
        [containerRef.current, pageTurnSheetRef.current],
        PAGE_SLIDE_IN_MS,
      );
      setPageTurn(null);
      schedulePageTurnFollowUp(() => {
        if (renditionRef.current === rendition && !isClosingRef.current) {
          applyReaderSettings(rendition, readerSettingsRef.current);
        }
      });
    } finally {
      setPageTurn(null);
      animatingRef.current = false;
    }
  }, [applyReaderSettings, containerRef, readerSettingsRef, renditionRef]);

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
        pageTurn ? 'reader-page-turning' : '',
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
          style={readerViewportStyle}
        />
        {pageTurn && (
          <div
            ref={pageTurnSheetRef}
            className={[
              'reader-page-turn-sheet',
              `reader-page-turn-sheet-${pageTurn.phase}`,
              `reader-page-turn-sheet-${pageTurn.dir}`,
            ].join(' ')}
            aria-hidden="true"
          />
        )}
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
          fontFamilyOptions={fontFamilyOptions}
          fontSize={fontSize}
          fontSizeMax={fontSizeMax}
          fontSizeMin={fontSizeMin}
          fontSizeStep={fontSizeStep}
          layoutSettings={layoutSettings}
          onBackToMain={() => setSettingsView('main')}
          onDecreaseFontSize={decreaseFontSize}
          onFontFamilyChange={handleFontFamilyChange}
          onFontSizeChange={handleFontSizeChange}
          onIncreaseFontSize={increaseFontSize}
          onOpenFontSettings={() => setSettingsView('font')}
          onThemeChange={handleThemeChange}
          readerFont={readerFont}
          readerTheme={readerTheme}
          readerThemeId={readerThemeId}
          settingsView={settingsView}
          themeOptions={themeOptions}
        />
      )}
    </div>
  );
}

export default ReaderView;
