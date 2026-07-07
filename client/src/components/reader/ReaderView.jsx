import { useCallback, useEffect, useRef, useState } from 'react';
import Epub from 'epubjs';
import { getReadingProgress, saveReadingProgress } from '../../api/books.js';

const SAVE_DEBOUNCE_MS = 2000;

export function ReaderView({ book, onClose }) {
  const containerRef = useRef(null);
  const bookRef = useRef(null);
  const renditionRef = useRef(null);
  const saveTimerRef = useRef(null);
  const pendingProgressRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);

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

  useEffect(() => {
    if (!containerRef.current || !book?.id) return;

    let destroyed = false;

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

        let startCfi;
        try {
          const data = await getReadingProgress(book.id);
          startCfi = data.progress?.cfi || undefined;
        } catch {
          // No saved progress — start from beginning
        }

        if (destroyed) return;

        await rendition.display(startCfi);

        if (destroyed) return;
        setIsLoading(false);

        // Generate location percentages for progress % display (non-blocking)
        epubBook.locations.generate(1024).catch(() => {});

        rendition.on('relocated', (location) => {
          if (destroyed) return;
          const cfi = location.start.cfi;
          const pct = epubBook.locations.percentageFromCfi(cfi);
          const progressValue =
            typeof pct === 'number' && Number.isFinite(pct) ? pct : 0;
          setProgress(progressValue);
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
      flushSave(pendingProgressRef.current);
      pendingProgressRef.current = null;
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
      bookRef.current = null;
      renditionRef.current = null;
    };
  }, [book?.id, flushSave, scheduleSave]);

  return (
    <div
      className="reader-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`正在阅读：${book?.title || '书籍'}`}
    >
      <header className="reader-header">
        <button
          className="reader-close-button"
          type="button"
          aria-label="返回书架"
          onClick={onClose}
        >
          <span aria-hidden="true" />
        </button>
        <span className="reader-title">{book?.title || ''}</span>
        <span className="reader-progress-label" aria-label={`进度 ${Math.round(progress * 100)}%`}>
          {progress > 0 ? `${Math.round(progress * 100)}%` : ''}
        </span>
      </header>

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
        <div ref={containerRef} className="reader-epub-container" />
      </div>

      {/* Left / right tap zones for page turning */}
      <div className="reader-tap-zones" aria-hidden="true">
        <button
          className="reader-tap-prev"
          type="button"
          tabIndex={-1}
          onClick={() => renditionRef.current?.prev()}
        />
        <button
          className="reader-tap-next"
          type="button"
          tabIndex={-1}
          onClick={() => renditionRef.current?.next()}
        />
      </div>
    </div>
  );
}

export default ReaderView;
