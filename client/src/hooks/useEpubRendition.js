import { useCallback, useEffect, useState } from 'react';
import Epub from 'epubjs';
import { getReadingProgress } from '../api/readingApi.js';

const RENDITION_COLUMN_GAP = 0;

export function useEpubRendition({
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
}) {
  const [progress, setProgress] = useState(0);
  const [toc, setToc] = useState([]);
  const [currentHref, setCurrentHref] = useState(null);
  const [readerReloadKey, setReaderReloadKey] = useState(0);

  useEffect(() => {
    if (!containerRef.current || !book?.id) return undefined;

    let destroyed = false;
    let reapplyReaderSettingsToView;
    setIsLoading(true);
    setError('');
    resetPageProgress();
    setToc([]);
    resetReaderSettingsLoad();

    (async () => {
      let epubBook;
      let rendition;

      try {
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
          flow: 'paginated',
          gap: RENDITION_COLUMN_GAP,
          spread: 'none',
        });
        renditionRef.current = rendition;
        rendition.hooks.content.register((contents) => {
          applyReaderSettingsToContents(contents);
        });
        reapplyReaderSettingsToView = (_section, view) => {
          const applyToRenderedContents = () => {
            if (destroyed) return;
            if (view?.contents) {
              applyReaderSettingsToContents(view.contents, readerSettingsRef.current);
              return;
            }
            rendition.getContents?.().forEach((contents) => {
              applyReaderSettingsToContents(contents, readerSettingsRef.current);
            });
          };

          applyToRenderedContents();
          requestAnimationFrame(() => {
            applyToRenderedContents();
          });
        };
        rendition.on('rendered', reapplyReaderSettingsToView);

        let startCfi;
        let loadedReaderSettings = readerSettingsRef.current;
        try {
          const [progressResult, settingsResult] = await Promise.allSettled([
            getReadingProgress(book.id),
            loadReaderSettings(),
          ]);
          if (progressResult.status === 'fulfilled') {
            startCfi = progressResult.value.progress?.cfi || undefined;
          }

          if (settingsResult.status === 'fulfilled') {
            loadedReaderSettings = settingsResult.value;
          }
        } catch {
          // No saved progress — start from beginning
        }

        if (destroyed) return;

        applyReaderSettings(rendition, loadedReaderSettings);
        await rendition.display(startCfi);
        await applyReaderHorizontalMargin(
          rendition,
          loadedReaderSettings.horizontalMargin,
          startCfi,
        );

        if (destroyed) return;
        markReaderSettingsLoaded();
        setIsLoading(false);

        epubBook.loaded.navigation.then((nav) => {
          if (!destroyed) setToc(nav?.toc || []);
        }).catch(() => {});

        epubBook.locations.generate(1024).catch(() => {});

        rendition.on('relocated', (location) => {
          if (destroyed) return;
          const cfi = location.start.cfi;
          currentCfiRef.current = cfi;
          const pct = epubBook.locations.percentageFromCfi(cfi);
          const progressValue =
            typeof pct === 'number' && Number.isFinite(pct) ? pct : 0;
          setProgress(progressValue);
          updatePageProgressFromLocation(location);
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
      renditionRef.current?.off?.('rendered', reapplyReaderSettingsToView);
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
      currentCfiRef.current = null;
      bookRef.current = null;
      renditionRef.current = null;
    };
  }, [
    applyReaderHorizontalMargin,
    applyReaderSettings,
    applyReaderSettingsToContents,
    book?.id,
    bookRef,
    containerRef,
    currentCfiRef,
    flushPendingChanges,
    loadReaderSettings,
    markReaderSettingsLoaded,
    readerReloadKey,
    readerSettingsRef,
    renditionRef,
    resetPageProgress,
    resetReaderSettingsLoad,
    scheduleSave,
    setError,
    setIsLoading,
    updatePageProgressFromLocation,
  ]);

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
        resetReaderSettingsLoad();
        setReaderReloadKey((key) => key + 1);
        return;
      }

      rendition.resize?.();

      if (currentCfiRef.current) {
        rendition.display(currentCfiRef.current).catch(() => {});
      }
    });
  }, [
    book?.id,
    containerRef,
    currentCfiRef,
    error,
    isClosingRef,
    isLoading,
    renditionRef,
    resetReaderSettingsLoad,
    setError,
    setIsLoading,
  ]);

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

  return {
    currentHref,
    progress,
    toc,
  };
}
