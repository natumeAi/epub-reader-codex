import { useCallback, useEffect, useRef, useState } from 'react';
import Epub from 'epubjs';
import { getReadingProgress, saveReadingProgress } from '../../api/books.js';

const SAVE_DEBOUNCE_MS = 2000;
// Horizontal travel (px) past which a pointer gesture counts as a swipe, not a tap
const SWIPE_THRESHOLD = 45;
// Page-turn animation
const TURN_DURATION_MS = 320;
const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const DEFAULT_FONT_SIZE = 100;
const FONT_SIZE_MIN = 80;
const FONT_SIZE_MAX = 140;
const FONT_SIZE_STEP = 10;
const DEFAULT_FONT_FAMILY_ID = 'system';
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

function clampFontSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size)) return DEFAULT_FONT_SIZE;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, size));
}

function getReaderFontFamily(fontFamilyId) {
  return FONT_FAMILY_OPTIONS.find((option) => option.id === fontFamilyId)?.value ||
    FONT_FAMILY_OPTIONS[0].value;
}

function applyReaderFontSettings(rendition, fontSize, fontFamilyId) {
  if (!rendition?.themes) return;
  rendition.themes.fontSize(`${fontSize}%`);
  rendition.themes.font(getReaderFontFamily(fontFamilyId));
}

export function ReaderView({ book, onClose }) {
  const containerRef = useRef(null);
  const bookRef = useRef(null);
  const renditionRef = useRef(null);
  const saveTimerRef = useRef(null);
  const pendingProgressRef = useRef(null);
  const pointerRef = useRef(null);
  const animatingRef = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [chromeVisible, setChromeVisible] = useState(true);
  // Bottom-bar panel: null | 'toc' | 'settings'
  const [activePanel, setActivePanel] = useState(null);
  const [toc, setToc] = useState([]);
  const [currentHref, setCurrentHref] = useState(null);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [fontFamilyId, setFontFamilyId] = useState(DEFAULT_FONT_FAMILY_ID);
  const fontSettingsRef = useRef({
    fontSize: DEFAULT_FONT_SIZE,
    fontFamilyId: DEFAULT_FONT_FAMILY_ID,
  });
  // 'slide' = 平移翻页, 'curl' = CSS 3D 近似卷曲
  const [turnStyle, setTurnStyle] = useState('curl');
  // Transient curl overlay: { dir: 'next' | 'prev', key } while a curl turn plays
  const [curl, setCurl] = useState(null);

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
        applyReaderFontSettings(
          rendition,
          fontSettingsRef.current.fontSize,
          fontSettingsRef.current.fontFamilyId,
        );

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

        // Chapter list for the TOC panel (flattened one level; nested subitems kept)
        epubBook.loaded.navigation.then((nav) => {
          if (!destroyed) setToc(nav?.toc || []);
        }).catch(() => {});

        // Generate location percentages for progress % display (non-blocking)
        epubBook.locations.generate(1024).catch(() => {});

        rendition.on('relocated', (location) => {
          if (destroyed) return;
          const cfi = location.start.cfi;
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
      flushSave(pendingProgressRef.current);
      pendingProgressRef.current = null;
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
      bookRef.current = null;
      renditionRef.current = null;
    };
  }, [book?.id, flushSave, scheduleSave]);

  useEffect(() => {
    fontSettingsRef.current = { fontSize, fontFamilyId };
    if (isLoading || error) return;
    applyReaderFontSettings(renditionRef.current, fontSize, fontFamilyId);
  }, [fontSize, fontFamilyId, isLoading, error]);

  // Tween the epub scroll-strip by one column, then let epub.js's own
  // next()/prev() sync its location (source of truth for progress).
  const slideWithin = useCallback((container, dir) => {
    return new Promise((resolve) => {
      const col = container.clientWidth;
      const from = container.scrollLeft;
      const target = dir === 'next' ? from + col : from - col;
      // Off the strip (section boundary) → no smooth slide possible
      if (target < 0 || target > container.scrollWidth - col + 1) {
        resolve(false);
        return;
      }
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / TURN_DURATION_MS);
        const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
        container.scrollLeft = from + (target - from) * e;
        if (t < 1) requestAnimationFrame(step);
        else resolve(true);
      };
      requestAnimationFrame(step);
    });
  }, []);

  const turnPage = useCallback(async (dir) => {
    const rendition = renditionRef.current;
    if (!rendition || animatingRef.current) return;
    const nav = () => (dir === 'next' ? rendition.next() : rendition.prev());

    if (prefersReducedMotion() || turnStyle === 'none') {
      await nav();
      return;
    }

    animatingRef.current = true;
    try {
      const container = containerRef.current?.querySelector('.epub-container');
      if (turnStyle === 'curl') {
        // CSS 3D flourish over an instant turn; overlay clears on animationend
        setCurl({ dir, key: Date.now() });
        await nav();
      } else {
        // slide: animate the strip, then sync epub location
        const slid = container ? await slideWithin(container, dir) : false;
        await nav();
        if (!slid) {
          /* section boundary — epub already swapped, nothing to unwind */
        }
      }
    } finally {
      animatingRef.current = false;
    }
  }, [turnStyle, slideWithin]);

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

  return (
    <div
      className={`reader-overlay${chromeVisible ? '' : ' reader-chrome-hidden'}`}
      role="dialog"
      aria-modal="true"
      aria-label={`正在阅读：${book?.title || '书籍'}`}
    >{/* header floats above the reading area; toggled by center tap */}
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

        {/* CSS 3D curl flourish: a shaded page-shaped sheet sweeps over the
            already-swapped content, giving a lightweight page-turn feel
            without snapshotting the iframe (keeps J3455 CPU load low). */}
        {curl && (
          <div
            key={curl.key}
            className={`reader-curl reader-curl-${curl.dir}`}
            aria-hidden="true"
            onAnimationEnd={() => setCurl(null)}
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
            <section className="reader-settings-section" aria-labelledby="reader-font-size-title">
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
                  className="reader-font-size-slider"
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
            </section>

            <section className="reader-settings-section" aria-labelledby="reader-font-family-title">
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
            </section>
          </div>
        </div>
      )}
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
