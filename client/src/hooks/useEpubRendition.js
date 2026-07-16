import { useCallback, useEffect, useState } from 'react';
import Epub from 'epubjs';
import { getReadingProgress } from '../api/readingApi.js';
import { selectProgressForRelocation } from '../utils/readingProgress.js';

const RENDITION_COLUMN_GAP = 0;

export function useEpubRendition({
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
}) {
  const [progress, setProgress] = useState(0);
  const [toc, setToc] = useState([]);
  const [currentHref, setCurrentHref] = useState(null);
  const [readerReloadKey, setReaderReloadKey] = useState(0);

  useEffect(() => {
    if (!containerRef.current || !book?.id) return undefined;

    let destroyed = false;
    let handleRelocated;
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
        let lastValidProgress = 0;
        let locationsReady = false;

        const [progressResult, settingsResult] = await Promise.allSettled([
          getReadingProgress(book.id),
          loadReaderSettings(),
        ]);

        if (destroyed) return;

        if (progressResult.status === 'fulfilled') {
          const savedProgress = progressResult.value.progress;
          startCfi = savedProgress?.cfi || undefined;
          if (Number.isFinite(savedProgress?.progress)) {
            lastValidProgress = Math.min(1, Math.max(0, savedProgress.progress));
            setProgress(lastValidProgress);
          }
        }

        if (settingsResult.status === 'fulfilled') {
          loadedReaderSettings = settingsResult.value;
        }

        const updateFromLocation = (location) => {
          if (destroyed || !location?.start?.cfi) return;
          const cfi = location.start.cfi;
          const progressValue = selectProgressForRelocation({
            cfi,
            lastValidProgress,
            locations: epubBook.locations,
            locationsReady,
          });

          lastValidProgress = progressValue;
          currentCfiRef.current = cfi;
          setProgress(progressValue);
          updatePageProgressFromLocation(location);
          setCurrentHref(location.start.href || null);
          enqueueProgress({
            cfi,
            progress: progressValue,
            chapterHref: location.start.href || null,
            chapterLabel: null,
          });
        };

        handleRelocated = updateFromLocation;
        rendition.on('relocated', handleRelocated);
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

        epubBook.locations.generate(1024).then(async () => {
          if (destroyed) return;
          locationsReady = true;
          const currentLocation = await Promise.resolve(rendition.currentLocation?.());
          updateFromLocation(currentLocation);
        }).catch(() => {
          locationsReady = false;
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
      flushPendingReaderSettings();
      renditionRef.current?.off?.('relocated', handleRelocated);
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
    enqueueProgress,
    flushPendingReaderSettings,
    loadReaderSettings,
    markReaderSettingsLoaded,
    readerReloadKey,
    readerSettingsRef,
    renditionRef,
    resetPageProgress,
    resetReaderSettingsLoad,
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
      flushPendingReaderSettings();
    };
    const handlePageShow = () => {
      recoverVisibleReader();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        recoverVisibleReader();
      } else {
        flushPendingReaderSettings();
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
  }, [flushPendingReaderSettings, recoverVisibleReader]);

  return {
    currentHref,
    progress,
    toc,
  };
}
