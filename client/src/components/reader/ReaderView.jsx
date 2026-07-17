import { useCallback, useEffect, useRef, useState } from 'react';
import { useEpubRendition } from '../../hooks/useEpubRendition.js';
import { useModalDialog } from '../../hooks/useModalDialog.js';
import { usePageTurnController } from '../../hooks/usePageTurnController.js';
import { usePageProgress } from '../../hooks/usePageProgress.js';
import { useReadingProgressPersistence } from '../../hooks/useReadingProgressPersistence.js';
import { useReaderSettings } from '../../hooks/useReaderSettings.js';
import { useReducedMotion } from '../../hooks/useReducedMotion.js';
import { ReaderBottomBar } from './ReaderBottomBar.jsx';
import { ReaderSettingsPanel } from './ReaderSettingsPanel.jsx';
import { ReaderTopBar } from './ReaderTopBar.jsx';
import { TocPanel } from './TocPanel.jsx';

// Open/close FLIP animation: overlay scales between the shelf cover rect and full screen.
// Same duration/easing both directions to keep open/close symmetric.
const READER_FLIP_ANIM_MS = 300;
const READER_FLIP_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const READER_COVER_FADE_MS = 200;
// Fallback when the origin/target cover rect can't be found (e.g. off-screen).
const READER_FALLBACK_ANIM_MS = 220;

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
  const reducedMotion = useReducedMotion();
  const containerRef = useRef(null);
  const bookRef = useRef(null);
  const renditionRef = useRef(null);
  const readerInitialFocusRef = useRef(null);
  const currentCfiRef = useRef(null);
  const originRectRef = useRef(originRect);
  const isClosingRef = useRef(false);
  const pageEdgeRef = useRef(null);
  const cancelPageTurnRef = useRef(null);
  const cancelBeforeRenditionMutation = useCallback(() => {
    cancelPageTurnRef.current?.('settings');
  }, []);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [chromeVisible, setChromeVisible] = useState(false);
  // Bottom-bar panel: null | 'toc' | 'settings'
  const [activePanel, setActivePanel] = useState(null);
  // Settings panel page: 'main' | 'font'
  const [settingsView, setSettingsView] = useState('main');
  // Open/close FLIP animation state: the overlay transform collapses onto (or
  // expands from) the shelf cover rect captured at click time.
  const [flipTransform, setFlipTransform] = useState(() => (
    originRect && !reducedMotion ? rectToTransformString(originRect) : null
  ));
  const [flipTransitionEnabled, setFlipTransitionEnabled] = useState(false);
  const [coverOpacity, setCoverOpacity] = useState(() => (
    originRect && !reducedMotion ? 1 : 0
  ));
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
    resetReaderSettingsLoad,
    themeOptions,
  } = useReaderSettings({
    beforeRenditionMutation: cancelBeforeRenditionMutation,
    containerRef,
    currentCfiRef,
    isReaderReady: !isLoading && !error,
    onSettingsReflow: refreshCurrentPageProgress,
    renditionRef,
  });

  const {
    enqueueProgress,
    flushProgress,
  } = useReadingProgressPersistence({ bookId: book?.id });

  const {
    currentHref,
    pageTurnAdapter,
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
    enqueueProgress,
    error,
    flushPendingReaderSettings,
    isClosingRef,
    isLoading,
    loadReaderSettings,
    markReaderSettingsLoaded,
    readerSettingsRef,
    renditionRef,
    resetPageProgress,
    resetReaderSettingsLoad,
    setError,
    setIsLoading,
    updatePageProgressFromLocation,
  });

  const handleCenterTap = useCallback(() => {
    setChromeVisible((visible) => {
      if (visible) setActivePanel(null);
      return !visible;
    });
  }, []);

  const {
    cancelPageTurn,
    direction: pageTurnDirection,
    handlePointerCancel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    phase: pageTurnPhase,
    turnPage,
  } = usePageTurnController({
    adapter: pageTurnAdapter,
    currentCfiRef,
    disabled: Boolean(activePanel) || isLoading || Boolean(error),
    edgeRef: pageEdgeRef,
    onCenterTap: handleCenterTap,
    reducedMotion,
    renditionRef,
  });

  useEffect(() => {
    cancelPageTurnRef.current = cancelPageTurn;
    return () => {
      if (cancelPageTurnRef.current === cancelPageTurn) {
        cancelPageTurnRef.current = null;
      }
    };
  }, [cancelPageTurn]);

  useEffect(() => {
    if (activePanel !== 'settings') {
      setSettingsView('main');
    }
  }, [activePanel]);

  // Expand from the shelf cover rect (captured at click time) to full screen.
  // Skips animating entirely if no origin rect was captured.
  useEffect(() => {
    if (reducedMotion) return undefined;
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
  }, [reducedMotion]);

  const handleCloseClick = useCallback(() => {
    cancelPageTurnRef.current?.('close');
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    void flushProgress({ keepalive: true });
    if (reducedMotion) {
      onClose();
      return;
    }

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
  }, [book?.id, flushProgress, onClose, reducedMotion]);

  const { dialogRef, onKeyDown: onDialogKeyDown } = useModalDialog({
    initialFocusRef: readerInitialFocusRef,
    onRequestClose: handleCloseClick,
    open: true,
  });

  useEffect(() => {
    if (isLoading || error || activePanel) return undefined;

    const handleKeyDown = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || isKeyboardEditingTarget(event.target)) {
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        void turnPage('prev', {
          action: 'tap-prev',
          inputTime: event.timeStamp,
        });
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        void turnPage('next', {
          action: 'tap-next',
          inputTime: event.timeStamp,
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePanel, error, isLoading, turnPage]);

  const goToHref = useCallback((href) => {
    cancelPageTurnRef.current?.('toc');
    if (!href) return;
    renditionRef.current?.display(href);
    setActivePanel(null);
  }, []);

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
      ref={(node) => {
        dialogRef.current = node;
        readerInitialFocusRef.current = node;
      }}
      className={[
        'reader-overlay',
        `reader-theme-${readerThemeId}`,
        chromeVisible ? '' : 'reader-chrome-hidden',
        pageTurnPhase ? 'reader-page-turn-' + pageTurnPhase : '',
        pageTurnDirection ? 'reader-page-turn-direction-' + pageTurnDirection : '',
        isFallbackClosing ? 'reader-fallback-closing' : '',
      ].filter(Boolean).join(' ')}
      style={overlayStyle}
      role="dialog"
      aria-modal="true"
      aria-label={`正在阅读：${book?.title || '书籍'}`}
      onKeyDown={onDialogKeyDown}
      tabIndex={-1}
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
            transitionDuration: `${reducedMotion ? 0 : READER_COVER_FADE_MS}ms`,
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
          className="reader-epub-container"
        />
        <div
          ref={pageEdgeRef}
          className={[
            'reader-page-edge',
            pageTurnDirection ? 'reader-page-edge-' + pageTurnDirection : '',
          ].filter(Boolean).join(' ')}
          aria-hidden="true"
        />
      </div>

      {/* Gesture layer: tap thirds (prev / toggle chrome / next) + horizontal swipe */}
      <div
        className="reader-gesture-layer"
        onPointerCancel={handlePointerCancel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        aria-hidden="true"
      />

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
