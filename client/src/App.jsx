import { useCallback, useEffect, useRef, useState } from 'react';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  createFolderFromBooks,
  listRecentReading,
  listFolderBooks,
  listShelfItems,
  moveFolderBookToShelf,
  moveShelfBookToFolder,
  renameFolder,
  updateFolderBookOrder,
  updateShelfItemOrder,
  uploadBook,
} from './api/books.js';
import { ReaderView } from './components/reader/ReaderView.jsx';

const centerZoneRatio = 0.46;
const sortIntentDelayMs = 450;
const shelfSortTransition = {
  duration: 460,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
};
const FOLDER_CLOSE_ANIM_MS = 180;

function shelfItemKey(item) {
  return `${item.type}:${item.id}`;
}

function toShelfOrderItem(item) {
  return {
    type: item.type,
    id: item.id,
  };
}

function normalizeShelfItem(item) {
  return {
    ...item,
    key: shelfItemKey(item),
  };
}

function folderBookKey(book) {
  return `folder-book:${book.id}`;
}

function normalizeFolderBook(book) {
  return {
    ...book,
    key: folderBookKey(book),
  };
}

function normalizeShelfBookFromFolderBook(book) {
  return {
    type: 'book',
    id: book.id,
    sortOrder: book.sortOrder,
    book,
    key: folderBookKey(book),
  };
}

function pointInRect(point, rect) {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function centerRect(rect) {
  const xInset = (rect.width * (1 - centerZoneRatio)) / 2;
  const yInset = (rect.height * (1 - centerZoneRatio)) / 2;

  return {
    left: rect.left + xInset,
    right: rect.right - xInset,
    top: rect.top + yInset,
    bottom: rect.bottom - yInset,
  };
}

function distanceToRectCenter(point, rect) {
  const x = rect.left + rect.width / 2 - point.x;
  const y = rect.top + rect.height / 2 - point.y;

  return Math.hypot(x, y);
}

function activeCollision(activeId, droppableContainers) {
  const activeContainer = droppableContainers.find(
    (droppableContainer) => String(droppableContainer.id) === String(activeId),
  );

  return activeContainer
    ? [
        {
          id: activeContainer.id,
          data: {
            droppableContainer: activeContainer,
            value: 0,
          },
        },
      ]
    : [];
}

function collisionForKey(targetKey, droppableContainers) {
  const targetContainer = droppableContainers.find(
    (droppableContainer) => String(droppableContainer.id) === String(targetKey),
  );

  return targetContainer
    ? [
        {
          id: targetContainer.id,
          data: {
            droppableContainer: targetContainer,
            value: 0,
          },
        },
      ]
    : [];
}

function isPointBeforeSortRect(point, rect) {
  const centerX = rect.left + rect.width / 2;

  if (point.y < rect.top) {
    return true;
  }

  if (point.y > rect.bottom) {
    return false;
  }

  return point.x < centerX;
}

function sortTargetKeyFromPoint({ activeKey, point, items, droppableRects }) {
  const orderedKeys = items.map((item) => item.key);
  const oldIndex = orderedKeys.indexOf(activeKey);

  if (oldIndex < 0) {
    return null;
  }

  const sortableKeys = orderedKeys.filter(
    (key) => key !== activeKey && droppableRects.get(key),
  );
  let insertionIndex = sortableKeys.length;

  for (let index = 0; index < sortableKeys.length; index += 1) {
    const rect = droppableRects.get(sortableKeys[index]);

    if (isPointBeforeSortRect(point, rect)) {
      insertionIndex = index;
      break;
    }
  }

  const clampedIndex = Math.max(0, Math.min(orderedKeys.length - 1, insertionIndex));

  return orderedKeys[clampedIndex];
}

function restrictDragToShelfBounds({ activeNodeRect, transform }) {
  const shelfElement = document.querySelector('.shelf-grid');

  if (!shelfElement || !activeNodeRect) {
    return transform;
  }

  const shelfRect = shelfElement.getBoundingClientRect();
  const minX = shelfRect.left - activeNodeRect.left;
  const maxX = shelfRect.right - activeNodeRect.right;
  const minY = shelfRect.top - activeNodeRect.top;
  const maxY = shelfRect.bottom - activeNodeRect.bottom;

  return {
    ...transform,
    x: Math.min(Math.max(transform.x, minX), maxX),
    y: Math.min(Math.max(transform.y, minY), maxY),
  };
}

function BookCover({ book }) {
  if (book.coverUrl) {
    return (
      <img
        className="book-cover-image"
        src={book.coverUrl}
        alt={book.title || '书籍封面'}
        loading="lazy"
      />
    );
  }

  return (
    <div className="book-cover-placeholder">
      <span className="placeholder-spine" aria-hidden="true" />
      <span className="placeholder-mark" aria-hidden="true" />
    </div>
  );
}

function FolderCover({ folder }) {
  const previewBooks = (folder.previewBooks || []).slice(0, 4);

  return (
    <span className="folder-cover">
      <span className="folder-preview-grid" aria-hidden="true">
        {previewBooks.map((previewBook, index) => (
          <span className="folder-preview-slot" key={previewBook.id ?? index}>
            {previewBook.coverUrl ? (
              <img className="folder-preview-image" src={previewBook.coverUrl} alt="" loading="lazy" />
            ) : (
              <span className="folder-preview-image folder-preview-image-empty" />
            )}
          </span>
        ))}
      </span>
    </span>
  );
}

function ShelfItemCover({ item }) {
  if (item.type === 'folder') {
    return <FolderCover folder={item.folder} />;
  }

  return (
    <span className="book-cover">
      <BookCover book={item.book} />
    </span>
  );
}

function DragPreview({ item }) {
  if (!item) {
    return null;
  }

  const label =
    item.type === 'folder'
      ? item.folder?.name || '文件夹'
      : item.book?.title || '未命名书籍';
  const isCoverOnly = item.type === 'folder-book';

  return (
    <div className={isCoverOnly ? 'drag-preview is-cover-only' : 'drag-preview'}>
      {isCoverOnly ? (
        <span className="book-cover">
          <BookCover book={item.book} />
        </span>
      ) : (
        <>
          <ShelfItemCover item={item} />
          <span className="shelf-item-label">{label}</span>
        </>
      )}
    </div>
  );
}

function FixedDragPreview({ item, point }) {
  if (!item || !point) {
    return null;
  }

  return (
    <div
      className="fixed-drag-preview"
      style={{
        left: point.x,
        top: point.y,
      }}
    >
      <DragPreview item={item} />
    </div>
  );
}

function pointerCenterFromDragEvent(event) {
  const initialRect = event.active.rect.current.initial;

  if (!initialRect) {
    return null;
  }

  return {
    x: initialRect.left + event.delta.x + initialRect.width / 2,
    y: initialRect.top + event.delta.y + initialRect.height / 2,
  };
}

function pointFromInputEvent(event) {
  if (!event) {
    return null;
  }

  const touch = event.touches?.[0] || event.changedTouches?.[0];

  if (touch) {
    return {
      x: touch.clientX,
      y: touch.clientY,
    };
  }

  if (typeof event.clientX === 'number' && typeof event.clientY === 'number') {
    return {
      x: event.clientX,
      y: event.clientY,
    };
  }

  return null;
}

function SortableShelfItem({ disabled, dragIntent, item, onOpenBook, onOpenFolder }) {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: item.key,
    data: {
      item,
      type: item.type,
    },
    disabled,
    transition: shelfSortTransition,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const isIntentTarget = dragIntent?.targetKey === item.key;
  const className = [
    'book-shell',
    'shelf-item',
    item.type === 'folder' ? 'is-folder-item' : '',
    isDragging ? 'is-dragging' : '',
    isIntentTarget && dragIntent.type === 'absorb' ? 'is-absorb-target' : '',
    isIntentTarget && dragIntent.type === 'merge' ? 'is-merge-target' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const label =
    item.type === 'folder'
      ? item.folder?.name || '文件夹'
      : item.book?.title || '未命名书籍';
  const handleClick = (event) => {
    if (item.type === 'folder') {
      onOpenFolder(item.folder);
    } else if (item.type === 'book') {
      const rect = event.currentTarget.querySelector('.book-cover')?.getBoundingClientRect();
      onOpenBook(item.book, rect || null);
    }
  };

  return (
    <button
      ref={setNodeRef}
      className={className}
      style={style}
      type="button"
      aria-label={label}
      data-book-id={item.type === 'book' ? item.book?.id : undefined}
      onClick={handleClick}
      {...attributes}
      {...listeners}
    >
      <ShelfItemCover item={item} />
      <span className="shelf-item-label">{label}</span>
    </button>
  );
}

function SortableFolderBook({ book, disabled, onOpenBook }) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: book.key,
    data: {
      book,
      type: 'folder-book',
    },
    disabled,
    transition: shelfSortTransition,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const className = ['folder-book-shell', isDragging ? 'is-dragging' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={setNodeRef}
      className={className}
      style={style}
    >
      <button
        ref={setActivatorNodeRef}
        className="folder-book-cover-button"
        disabled={disabled}
        type="button"
        aria-label={book.title || '未命名书籍'}
        onClick={(event) => {
          const rect = event.currentTarget.querySelector('.book-cover')?.getBoundingClientRect();
          onOpenBook(book, rect || null);
        }}
        {...attributes}
        {...listeners}
      >
        <span className="book-cover">
          <BookCover book={book} />
        </span>
      </button>
    </div>
  );
}

function ContinueReadingSection({ items, onOpenBook }) {
  if (!items.length) {
    return null;
  }

  return (
    <section className="continue-reading" aria-labelledby="continue-reading-title">
      <div className="continue-reading-header">
        <h2 id="continue-reading-title">继续阅读</h2>
      </div>
      <div className="continue-reading-list">
        {items.map((item) => {
          const book = item.book;
          const progressValue = Number(item.progress?.progress);
          const hasProgressValue = Number.isFinite(progressValue);
          const progressPercent = hasProgressValue
            ? Math.max(0, Math.min(100, Math.round(progressValue * 100)))
            : null;

          return (
            <button
              className="continue-book-button"
              key={book.id}
              type="button"
              data-book-id={book.id}
              onClick={(event) => {
                const rect = event.currentTarget.querySelector('.book-cover')?.getBoundingClientRect();
                onOpenBook(book, rect || null);
              }}
              aria-label={`继续阅读《${book.title || '未命名书籍'}》`}
            >
              <span className="book-cover continue-book-cover">
                <BookCover book={book} />
              </span>
              <span className="continue-book-title">{book.title || '未命名书籍'}</span>
              {progressPercent !== null ? (
                <span className="continue-book-progress">{progressPercent}%</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function FolderOverlay({
  books,
  error,
  folder,
  isClosing,
  isLoading,
  isRenaming,
  isRenameSaving,
  isSavingOrder,
  onClose,
  onOpenBook,
  onRenameCancel,
  onRenameDraftChange,
  onRenameStart,
  onRenameSubmit,
  renameDraft,
}) {
  if (!folder) {
    return null;
  }

  const folderName = folder.name || '文件夹';
  const overlayClassName = `folder-overlay${isClosing ? ' is-closing' : ''}`;

  return (
    <div className={overlayClassName} role="dialog" aria-modal="true" aria-labelledby="folder-overlay-title">
      <button className="folder-backdrop" type="button" aria-label="关闭文件夹" onClick={onClose} />
      <section className="folder-panel">
        <header className="folder-panel-header">
          {isRenaming ? (
            <div className="folder-title-editor">
              <h2 className="visually-hidden" id="folder-overlay-title">
                {folderName}
              </h2>
              <form className="folder-rename-form" onSubmit={onRenameSubmit}>
                <input
                  autoFocus
                  className="folder-rename-input"
                  disabled={isRenameSaving}
                  maxLength={80}
                  onChange={(event) => onRenameDraftChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      onRenameCancel();
                    }
                  }}
                  type="text"
                  value={renameDraft}
                  aria-label="文件夹名称"
                />
                <button
                  className="folder-rename-action is-confirm"
                  disabled={isRenameSaving}
                  type="submit"
                  aria-label="保存文件夹名称"
                >
                  <span aria-hidden="true" />
                </button>
                <button
                  className="folder-rename-action is-cancel"
                  disabled={isRenameSaving}
                  onClick={onRenameCancel}
                  type="button"
                  aria-label="取消重命名"
                >
                  <span aria-hidden="true" />
                </button>
              </form>
            </div>
          ) : (
            <h2 id="folder-overlay-title">
              <button className="folder-title-button" type="button" onClick={onRenameStart}>
                {folderName}
              </button>
            </h2>
          )}
          <button
            className="folder-close-button"
            disabled={isRenameSaving}
            type="button"
            aria-label="关闭文件夹"
            onClick={onClose}
          >
            <span aria-hidden="true" />
          </button>
        </header>

        {error ? (
          <p className="folder-status error-message" role="alert">
            {error}
          </p>
        ) : null}

        {isLoading ? (
          <div className="folder-loading-state" role="status" aria-live="polite">
            <span className="folder-loading-spinner" aria-hidden="true" />
            <p>正在打开文件夹</p>
          </div>
        ) : books.length ? (
          <SortableContext items={books.map((book) => book.key)} strategy={rectSortingStrategy}>
            <div className="folder-book-grid" aria-label="文件夹书籍">
              {books.map((book) => (
                <SortableFolderBook
                  book={book}
                  disabled={isSavingOrder}
                  key={book.key}
                  onOpenBook={onOpenBook}
                />
              ))}
            </div>
          </SortableContext>
        ) : (
          <div className="folder-empty-state" role="status">
            <div className="empty-cover" aria-hidden="true" />
            <p>这个文件夹是空的</p>
          </div>
        )}
      </section>
    </div>
  );
}

function App() {
  const fileInputRef = useRef(null);
  const dragIntentFrameRef = useRef(null);
  const dragIntentRef = useRef({ type: 'idle', targetKey: null });
  const folderBookShelfDragRef = useRef(null);
  const folderCloseTimeoutRef = useRef(null);
  const folderSortIntentRef = useRef({ startedAt: 0, targetKey: null });
  const ignoreFolderClickUntilRef = useRef(0);
  const latestPointerPointRef = useRef(null);
  const pointerTrackingCleanupRef = useRef(null);
  const sortIntentRef = useRef({ startedAt: 0, targetKey: null });
  const [shelfItems, setShelfItems] = useState([]);
  const [recentReadingItems, setRecentReadingItems] = useState([]);
  const [activeDragPreview, setActiveDragPreview] = useState(null);
  const [fixedDragPreviewPoint, setFixedDragPreviewPoint] = useState(null);
  const [dragIntent, setDragIntent] = useState({ type: 'idle', targetKey: null });
  const [hasLoadedShelf, setHasLoadedShelf] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [openFolder, setOpenFolder] = useState(null);
  const [isFolderClosing, setIsFolderClosing] = useState(false);
  const [folderBooks, setFolderBooks] = useState([]);
  const [isFolderLoading, setIsFolderLoading] = useState(false);
  const [isRenamingFolder, setIsRenamingFolder] = useState(false);
  const [isSavingFolderName, setIsSavingFolderName] = useState(false);
  const [isSavingFolderOrder, setIsSavingFolderOrder] = useState(false);
  const [folderNameDraft, setFolderNameDraft] = useState('');
  const [folderError, setFolderError] = useState('');
  const [error, setError] = useState('');
  const [readingBook, setReadingBook] = useState(null);
  const [readingBookOrigin, setReadingBookOrigin] = useState(null);
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 500,
        tolerance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const publishDragIntent = useCallback((intent) => {
    const nextIntent = intent || { type: 'idle', targetKey: null };
    const currentIntent = dragIntentRef.current;

    if (currentIntent.type === nextIntent.type && currentIntent.targetKey === nextIntent.targetKey) {
      return;
    }

    dragIntentRef.current = nextIntent;

    if (dragIntentFrameRef.current) {
      return;
    }

    dragIntentFrameRef.current = requestAnimationFrame(() => {
      dragIntentFrameRef.current = null;
      setDragIntent(dragIntentRef.current);
    });
  }, []);
  const shelfCollisionDetection = useCallback(
    (args) => {
      const { active, collisionRect, droppableContainers, droppableRects } = args;
      const activeType = active.data.current?.type;
      const activeCenter = {
        x: collisionRect.left + collisionRect.width / 2,
        y: collisionRect.top + collisionRect.height / 2,
      };
      let lockedTarget = null;

      for (const droppableContainer of droppableContainers) {
        const targetKey = String(droppableContainer.id);

        if (targetKey === String(active.id)) {
          continue;
        }

        const rect = droppableRects.get(droppableContainer.id);

        if (!rect || !pointInRect(activeCenter, rect)) {
          continue;
        }

        const distance = distanceToRectCenter(activeCenter, rect);

        if (!lockedTarget || distance < lockedTarget.distance) {
          lockedTarget = {
            distance,
            key: targetKey,
            rect,
            type: droppableContainer.data.current?.type,
          };
        }
      }

      if (lockedTarget) {
        const canCreateFolder = activeType === 'book' && lockedTarget.type === 'book';
        const canMoveIntoFolder = activeType === 'book' && lockedTarget.type === 'folder';
        const isCenterTarget = pointInRect(activeCenter, centerRect(lockedTarget.rect));

        if (canCreateFolder && isCenterTarget) {
          publishDragIntent({
            type: 'merge',
            targetKey: lockedTarget.key,
          });

          return activeCollision(active.id, droppableContainers);
        }

        if (canMoveIntoFolder && isCenterTarget) {
          publishDragIntent({
            type: 'absorb',
            targetKey: lockedTarget.key,
          });

          return activeCollision(active.id, droppableContainers);
        }

        publishDragIntent({ type: 'sort', targetKey: null });
        const sortTargetKey = sortTargetKeyFromPoint({
          activeKey: String(active.id),
          point: activeCenter,
          items: shelfItems,
          droppableRects,
        });

        if (sortTargetKey === String(active.id)) {
          sortIntentRef.current = { startedAt: 0, targetKey: null };
          return activeCollision(active.id, droppableContainers);
        }

        const now = performance.now();

        if (sortIntentRef.current.targetKey !== sortTargetKey) {
          sortIntentRef.current = {
            startedAt: now,
            targetKey: sortTargetKey,
          };

          return activeCollision(active.id, droppableContainers);
        }

        if (now - sortIntentRef.current.startedAt < sortIntentDelayMs) {
          return activeCollision(active.id, droppableContainers);
        }

        return collisionForKey(sortTargetKey, droppableContainers);
      }

      publishDragIntent({ type: 'sort', targetKey: null });
      const sortCollisions = closestCenter(args);
      const sortTargetKey = sortTargetKeyFromPoint({
        activeKey: String(active.id),
        point: activeCenter,
        items: shelfItems,
        droppableRects,
      });

      if (!sortTargetKey || sortTargetKey === String(active.id)) {
        sortIntentRef.current = { startedAt: 0, targetKey: null };
        return activeCollision(active.id, droppableContainers);
      }

      const now = performance.now();

      if (sortIntentRef.current.targetKey !== sortTargetKey) {
        sortIntentRef.current = {
          startedAt: now,
          targetKey: sortTargetKey,
        };

        return activeCollision(active.id, droppableContainers);
      }

      if (now - sortIntentRef.current.startedAt < sortIntentDelayMs) {
        return activeCollision(active.id, droppableContainers);
      }

      return collisionForKey(sortTargetKey, droppableContainers);
    },
    [publishDragIntent, shelfItems],
  );
  const folderCollisionDetection = useCallback(
    (args) => {
      const { active, collisionRect, droppableContainers, droppableRects } = args;
      const activeCenter = {
        x: collisionRect.left + collisionRect.width / 2,
        y: collisionRect.top + collisionRect.height / 2,
      };
      const sortTargetKey = sortTargetKeyFromPoint({
        activeKey: String(active.id),
        point: activeCenter,
        items: folderBooks,
        droppableRects,
      });

      if (!sortTargetKey || sortTargetKey === String(active.id)) {
        folderSortIntentRef.current = { startedAt: 0, targetKey: null };
        return activeCollision(active.id, droppableContainers);
      }

      const now = performance.now();

      if (folderSortIntentRef.current.targetKey !== sortTargetKey) {
        folderSortIntentRef.current = {
          startedAt: now,
          targetKey: sortTargetKey,
        };

        return activeCollision(active.id, droppableContainers);
      }

      if (now - folderSortIntentRef.current.startedAt < sortIntentDelayMs) {
        return activeCollision(active.id, droppableContainers);
      }

      return collisionForKey(sortTargetKey, droppableContainers);
    },
    [folderBooks],
  );
  const activeDragModifier = useCallback((args) => {
    const activeType = args.active?.data.current?.type;

    if (activeType === 'folder-book') {
      return args.transform;
    }

    return restrictDragToShelfBounds(args);
  }, []);
  const appCollisionDetection = useCallback(
    (args) => {
      const activeType = args.active.data.current?.type;

      if (activeType === 'folder-book' && !folderBookShelfDragRef.current) {
        return folderCollisionDetection(args);
      }

      return shelfCollisionDetection(args);
    },
    [folderCollisionDetection, shelfCollisionDetection],
  );

  async function loadRecentReading() {
    try {
      const data = await listRecentReading();
      setRecentReadingItems(data.items || []);
    } catch {
      setRecentReadingItems([]);
    }
  }

  async function loadShelf() {
    setIsLoading(true);
    setError('');

    try {
      const [shelfData, recentData] = await Promise.all([
        listShelfItems(),
        listRecentReading().catch(() => ({ items: [] })),
      ]);

      setShelfItems((shelfData.items || []).map(normalizeShelfItem));
      setRecentReadingItems(recentData.items || []);
    } catch (err) {
      setError(err.message || '无法加载书架');
    } finally {
      setHasLoadedShelf(true);
      setIsLoading(false);
    }
  }

  function handleOpenBook(book, originRect) {
    if (!book || isSavingOrder) return;
    setReadingBookOrigin(originRect || null);
    setReadingBook(book);
  }

  function handleCloseReader() {
    setReadingBook(null);
    setReadingBookOrigin(null);
    loadRecentReading();
  }

  async function handleOpenFolder(folder) {
    if (!folder || isSavingOrder || performance.now() < ignoreFolderClickUntilRef.current) {
      return;
    }

    if (folderCloseTimeoutRef.current) {
      clearTimeout(folderCloseTimeoutRef.current);
      folderCloseTimeoutRef.current = null;
    }

    setIsFolderClosing(false);
    setOpenFolder(folder);
    setFolderBooks([]);
    setFolderError('');
    setFolderNameDraft('');
    setIsRenamingFolder(false);
    setIsFolderLoading(true);

    try {
      const data = await listFolderBooks(folder.id);
      setFolderBooks((data.books || []).map(normalizeFolderBook));
    } catch (err) {
      setFolderError(err.message || '无法加载文件夹');
    } finally {
      setIsFolderLoading(false);
    }
  }

  function finishCloseFolder() {
    setOpenFolder(null);
    setIsFolderClosing(false);
    setFolderBooks([]);
    setFolderError('');
    setIsFolderLoading(false);
    setIsRenamingFolder(false);
    setIsSavingFolderName(false);
    setIsSavingFolderOrder(false);
    setFolderNameDraft('');
    folderSortIntentRef.current = { startedAt: 0, targetKey: null };
  }

  function handleCloseFolder() {
    if (isSavingFolderName || isFolderClosing) {
      return;
    }

    setIsFolderClosing(true);
    folderCloseTimeoutRef.current = setTimeout(() => {
      folderCloseTimeoutRef.current = null;
      finishCloseFolder();
    }, FOLDER_CLOSE_ANIM_MS);
  }

  useEffect(() => {
    loadShelf();
  }, []);

  useEffect(
    () => () => {
      if (dragIntentFrameRef.current) {
        cancelAnimationFrame(dragIntentFrameRef.current);
      }

      if (folderCloseTimeoutRef.current) {
        clearTimeout(folderCloseTimeoutRef.current);
      }

      stopPointerTracking();
    },
    [],
  );

  async function handleFileChange(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setIsUploading(true);
    setError('');

    try {
      await uploadBook(file);
      await loadShelf();
    } catch (err) {
      setError(err.message || '上传失败');
    } finally {
      setIsUploading(false);
      event.target.value = '';
    }
  }

  function clearDragIntent() {
    dragIntentRef.current = { type: 'idle', targetKey: null };
    sortIntentRef.current = { startedAt: 0, targetKey: null };
    setDragIntent(dragIntentRef.current);
  }

  function clearFolderDragIntent() {
    folderSortIntentRef.current = { startedAt: 0, targetKey: null };
  }

  function stopPointerTracking() {
    pointerTrackingCleanupRef.current?.();
    pointerTrackingCleanupRef.current = null;
    latestPointerPointRef.current = null;
  }

  function startPointerTracking() {
    stopPointerTracking();

    const updatePointerPoint = (event) => {
      const point = pointFromInputEvent(event);

      if (!point) {
        return;
      }

      latestPointerPointRef.current = point;

      if (folderBookShelfDragRef.current) {
        setFixedDragPreviewPoint(point);
      }
    };

    window.addEventListener('pointermove', updatePointerPoint, { passive: true });
    window.addEventListener('mousemove', updatePointerPoint, { passive: true });
    window.addEventListener('touchmove', updatePointerPoint, { passive: true });
    pointerTrackingCleanupRef.current = () => {
      window.removeEventListener('pointermove', updatePointerPoint);
      window.removeEventListener('mousemove', updatePointerPoint);
      window.removeEventListener('touchmove', updatePointerPoint);
    };
  }

  function clearFolderBookShelfDrag() {
    folderBookShelfDragRef.current = null;
  }

  function restoreFolderBookShelfDrag() {
    const dragState = folderBookShelfDragRef.current;

    if (!dragState) {
      return;
    }

    clearFolderBookShelfDrag();
    setShelfItems(dragState.previousShelfItems);
    setOpenFolder(dragState.folder);
    setFolderBooks(dragState.previousFolderBooks);
    setFolderError('');
    setIsFolderLoading(false);
    setIsRenamingFolder(false);
    clearFolderDragIntent();
    clearDragIntent();
    setFixedDragPreviewPoint(null);
  }

  function beginFolderBookShelfDrag(book) {
    if (!openFolder || !book || folderBookShelfDragRef.current) {
      return;
    }

    const previousShelfItems = shelfItems;
    const previousFolderBooks = folderBooks;
    const remainingFolderBooks = folderBooks.filter((folderBook) => folderBook.id !== book.id);
    const folderIndex = shelfItems.findIndex(
      (item) => item.type === 'folder' && item.id === openFolder.id,
    );
    const tempShelfBook = normalizeShelfBookFromFolderBook(book);
    const baseShelfItems =
      remainingFolderBooks.length === 0
        ? shelfItems.filter((item) => item.type !== 'folder' || item.id !== openFolder.id)
        : shelfItems.map((item) => {
            if (item.type !== 'folder' || item.id !== openFolder.id) {
              return item;
            }

            return normalizeShelfItem({
              ...item,
              folder: {
                ...item.folder,
                bookCount: Math.max(0, (item.folder?.bookCount ?? previousFolderBooks.length) - 1),
                previewBooks: (item.folder?.previewBooks || []).filter(
                  (previewBook) => previewBook.id !== book.id,
                ),
              },
            });
          });
    const insertIndex =
      folderIndex < 0
        ? baseShelfItems.length
        : remainingFolderBooks.length === 0
          ? folderIndex
          : folderIndex + 1;
    const nextShelfItems = [
      ...baseShelfItems.slice(0, insertIndex),
      tempShelfBook,
      ...baseShelfItems.slice(insertIndex),
    ];

    folderBookShelfDragRef.current = {
      book,
      folder: openFolder,
      previousFolderBooks,
      previousShelfItems,
    };
    setActiveDragPreview({
      type: 'folder-book',
      book,
    });
    setShelfItems(nextShelfItems);
    setOpenFolder(null);
    setFolderBooks([]);
    setFolderError('');
    setIsFolderLoading(false);
    setIsRenamingFolder(false);
    clearFolderDragIntent();
    publishDragIntent({ type: 'sort', targetKey: null });
  }

  function handleStartFolderRename() {
    if (!openFolder || isSavingFolderName) {
      return;
    }

    setFolderNameDraft(openFolder.name || '文件夹');
    setFolderError('');
    setIsRenamingFolder(true);
  }

  function handleCancelFolderRename() {
    if (isSavingFolderName) {
      return;
    }

    setIsRenamingFolder(false);
    setFolderNameDraft('');
  }

  async function handleSubmitFolderRename(event) {
    event.preventDefault();

    if (!openFolder || isSavingFolderName) {
      return;
    }

    setIsSavingFolderName(true);
    setFolderError('');

    try {
      const data = await renameFolder(openFolder.id, folderNameDraft.trim());
      const renamedFolder = data.folder;

      setOpenFolder(renamedFolder);
      setShelfItems((items) =>
        items.map((item) =>
          item.type === 'folder' && item.id === renamedFolder.id
            ? normalizeShelfItem({ ...item, folder: renamedFolder })
            : item,
        ),
      );
      setIsRenamingFolder(false);
      setFolderNameDraft('');
    } catch (err) {
      setFolderError(err.message || '无法重命名文件夹');
    } finally {
      setIsSavingFolderName(false);
    }
  }

  function handleDragStart(event) {
    const activeType = event.active.data.current?.type;

    setFixedDragPreviewPoint(null);
    startPointerTracking();

    if (activeType === 'folder-book') {
      setActiveDragPreview({
        type: 'folder-book',
        book: event.active.data.current.book,
      });
      return;
    }

    setActiveDragPreview(event.active.data.current?.item || null);
  }

  function handleDragMove(event) {
    const activeType = event.active.data.current?.type;

    if (activeType !== 'folder-book') {
      return;
    }

    const activeCenter = pointerCenterFromDragEvent(event);

    if (!activeCenter) {
      return;
    }

    if (folderBookShelfDragRef.current) {
      setFixedDragPreviewPoint(latestPointerPointRef.current || activeCenter);
      return;
    }

    if (!openFolder) {
      return;
    }

    const folderPanel = document.querySelector('.folder-panel');

    if (!folderPanel) {
      return;
    }

    if (!pointInRect(activeCenter, folderPanel.getBoundingClientRect())) {
      setFixedDragPreviewPoint(latestPointerPointRef.current || activeCenter);
      beginFolderBookShelfDrag(event.active.data.current.book);
    }
  }

  function handleDragCancel(event) {
    setActiveDragPreview(null);
    setFixedDragPreviewPoint(null);
    stopPointerTracking();

    if (folderBookShelfDragRef.current) {
      restoreFolderBookShelfDrag();
      return;
    }

    if (event.active.data.current?.type === 'folder-book') {
      clearFolderDragIntent();
      return;
    }

    clearDragIntent();
  }

  async function handleFolderBookShelfDragEnd(event) {
    const dragState = folderBookShelfDragRef.current;

    if (!dragState) {
      return;
    }

    const { active, over } = event;
    const oldIndex = shelfItems.findIndex((item) => item.key === String(active.id));
    const newIndex = over
      ? shelfItems.findIndex((item) => item.key === String(over.id))
      : oldIndex;
    const orderedShelfItems =
      oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex
        ? arrayMove(shelfItems, oldIndex, newIndex)
        : shelfItems;
    const orderItems = orderedShelfItems.map((item) =>
      item.key === dragState.book.key
        ? { type: 'book', id: dragState.book.id }
        : toShelfOrderItem(item),
    );

    setShelfItems(orderedShelfItems);
    setIsSavingOrder(true);
    setError('');
    clearDragIntent();

    try {
      const data = await moveFolderBookToShelf(
        dragState.folder.id,
        dragState.book.id,
        orderItems,
      );
      clearFolderBookShelfDrag();
      setShelfItems((data.shelfItems || []).map(normalizeShelfItem));
    } catch (err) {
      const previousShelfItems = dragState.previousShelfItems;
      const previousFolderBooks = dragState.previousFolderBooks;
      const previousFolder = dragState.folder;

      clearFolderBookShelfDrag();
      setShelfItems(previousShelfItems);
      setOpenFolder(previousFolder);
      setFolderBooks(previousFolderBooks);
      setFolderError(err.message || '无法移出书籍');
    } finally {
      setIsSavingOrder(false);
    }
  }

  async function handleDragEnd(event) {
    setActiveDragPreview(null);
    setFixedDragPreviewPoint(null);
    stopPointerTracking();

    if (folderBookShelfDragRef.current) {
      await handleFolderBookShelfDragEnd(event);
      return;
    }

    if (event.active.data.current?.type === 'folder-book') {
      await handleFolderDragEnd(event);
      return;
    }

    await handleShelfDragEnd(event);
  }

  async function handleShelfDragEnd(event) {
    const { active, over } = event;
    const finalDragIntent = dragIntentRef.current;

    ignoreFolderClickUntilRef.current = performance.now() + 300;
    clearDragIntent();

    if (isSavingOrder) {
      return;
    }

    const activeItem = shelfItems.find((item) => item.key === String(active.id));
    const targetItem = shelfItems.find((item) => item.key === finalDragIntent.targetKey);

    if (
      finalDragIntent.type === 'merge' &&
      activeItem?.type === 'book' &&
      targetItem?.type === 'book' &&
      activeItem.key !== targetItem.key
    ) {
      const previousShelfItems = shelfItems;

      setIsSavingOrder(true);
      setError('');

      try {
        const data = await createFolderFromBooks(activeItem.id, targetItem.id);
        setShelfItems((data.shelfItems || []).map(normalizeShelfItem));
      } catch (err) {
        setShelfItems(previousShelfItems);
        setError(err.message || '无法创建文件夹');
      } finally {
        setIsSavingOrder(false);
      }

      return;
    }

    if (
      finalDragIntent.type === 'absorb' &&
      activeItem?.type === 'book' &&
      targetItem?.type === 'folder'
    ) {
      const previousShelfItems = shelfItems;

      setIsSavingOrder(true);
      setError('');

      try {
        const data = await moveShelfBookToFolder(targetItem.id, activeItem.id);
        setShelfItems((data.shelfItems || []).map(normalizeShelfItem));
      } catch (err) {
        setShelfItems(previousShelfItems);
        setError(err.message || '无法移入文件夹');
      } finally {
        setIsSavingOrder(false);
      }

      return;
    }

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = shelfItems.findIndex((item) => item.key === String(active.id));
    const newIndex = shelfItems.findIndex((item) => item.key === String(over.id));

    if (oldIndex < 0 || newIndex < 0) {
      return;
    }

    const previousShelfItems = shelfItems;
    const reorderedShelfItems = arrayMove(shelfItems, oldIndex, newIndex);

    setShelfItems(reorderedShelfItems);
    setIsSavingOrder(true);
    setError('');

    try {
      const data = await updateShelfItemOrder(reorderedShelfItems.map(toShelfOrderItem));
      setShelfItems((data.items || reorderedShelfItems).map(normalizeShelfItem));
    } catch (err) {
      setShelfItems(previousShelfItems);
      setError(err.message || '无法保存书架顺序');
    } finally {
      setIsSavingOrder(false);
    }
  }

  async function handleFolderDragEnd(event) {
    const { active, over } = event;

    clearFolderDragIntent();

    if (!openFolder || isSavingFolderOrder || !over || active.id === over.id) {
      return;
    }

    const oldIndex = folderBooks.findIndex((book) => book.key === String(active.id));
    const newIndex = folderBooks.findIndex((book) => book.key === String(over.id));

    if (oldIndex < 0 || newIndex < 0) {
      return;
    }

    const previousFolderBooks = folderBooks;
    const reorderedFolderBooks = arrayMove(folderBooks, oldIndex, newIndex);

    setFolderBooks(reorderedFolderBooks);
    setIsSavingFolderOrder(true);
    setFolderError('');

    try {
      const data = await updateFolderBookOrder(
        openFolder.id,
        reorderedFolderBooks.map((book) => book.id),
      );
      setFolderBooks((data.books || reorderedFolderBooks).map(normalizeFolderBook));
      await loadShelf();
    } catch (err) {
      setFolderBooks(previousFolderBooks);
      setFolderError(err.message || '无法保存文件夹顺序');
    } finally {
      setIsSavingFolderOrder(false);
    }
  }

  return (
    <DndContext
      modifiers={[activeDragModifier]}
      sensors={sensors}
      collisionDetection={appCollisionDetection}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
      onDragMove={handleDragMove}
      onDragStart={handleDragStart}
    >
      <main className="app-shell" aria-label="EPUB Reader">
      <section className="library-home">
        <div className="library-header">
          <div>
            <p className="eyebrow">Library</p>
            <h1>我的书架</h1>
          </div>

          <button
            className="upload-button"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            aria-label="上传 EPUB"
          >
            <span className="upload-button-icon" aria-hidden="true" />
          </button>
          <input
            ref={fileInputRef}
            className="file-input"
            type="file"
            accept=".epub,application/epub+zip"
            onChange={handleFileChange}
          />
        </div>

        {error ? (
          <p className="status-message error-message" role="alert">
            {error}
          </p>
        ) : null}

        {isUploading || isSavingOrder || (isLoading && hasLoadedShelf) ? (
          <p className="status-message" role="status">
            {isUploading ? '正在上传' : isSavingOrder ? '正在保存顺序' : '正在更新书架'}
          </p>
        ) : null}

        {!isLoading ? (
          <ContinueReadingSection
            items={recentReadingItems}
            onOpenBook={handleOpenBook}
          />
        ) : null}

        {isLoading && !hasLoadedShelf ? (
          <div className="shelf-grid" aria-label="书架加载中">
            {Array.from({ length: 6 }).map((_, index) => (
              <div className="book-shell" key={index}>
                <div className="book-cover skeleton-cover" />
                <div className="shelf-item-label skeleton-label" />
              </div>
            ))}
          </div>
        ) : shelfItems.length ? (
          <SortableContext items={shelfItems.map((item) => item.key)} strategy={rectSortingStrategy}>
            <div className="shelf-grid" aria-label="书架列表">
              {shelfItems.map((item) => (
                <SortableShelfItem
                  disabled={isSavingOrder}
                  dragIntent={dragIntent}
                  item={item}
                  key={item.key}
                  onOpenBook={handleOpenBook}
                  onOpenFolder={handleOpenFolder}
                />
              ))}
            </div>
          </SortableContext>
        ) : (
          <div className="empty-state" role="status">
            <div className="empty-cover" aria-hidden="true" />
            <p>书架是空的</p>
          </div>
        )}
      </section>
      <FolderOverlay
        books={folderBooks}
        error={folderError}
        folder={openFolder}
        isClosing={isFolderClosing}
        isLoading={isFolderLoading}
        isRenaming={isRenamingFolder}
        isRenameSaving={isSavingFolderName}
        isSavingOrder={isSavingFolderOrder}
        onClose={handleCloseFolder}
        onOpenBook={handleOpenBook}
        onRenameCancel={handleCancelFolderRename}
        onRenameDraftChange={setFolderNameDraft}
        onRenameStart={handleStartFolderRename}
        onRenameSubmit={handleSubmitFolderRename}
        renameDraft={folderNameDraft}
      />
      {readingBook && (
        <ReaderView
          book={readingBook}
          originRect={readingBookOrigin}
          onClose={handleCloseReader}
        />
      )}
      </main>
      <DragOverlay dropAnimation={null}>
        <DragPreview item={fixedDragPreviewPoint ? null : activeDragPreview} />
      </DragOverlay>
      <FixedDragPreview item={activeDragPreview} point={fixedDragPreviewPoint} />
    </DndContext>
  );
}

export default App;
