import { useCallback, useEffect, useRef, useState } from 'react';
import {
  closestCenter,
  DndContext,
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
  listFolderBooks,
  listShelfItems,
  updateShelfItemOrder,
  uploadBook,
} from './api/books.js';

const centerZoneRatio = 0.46;
const sortIntentDelayMs = 450;
const shelfSortTransition = {
  duration: 460,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
};

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

function sortTargetKeyFromPoint({ activeKey, point, shelfItems, droppableRects }) {
  const orderedKeys = shelfItems.map((item) => item.key);
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
  const previewBooks = folder.previewBooks || [];

  return (
    <span className="folder-cover">
      <span className="folder-preview-grid" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, index) => {
          const previewBook = previewBooks[index];

          return (
            <span className="folder-preview-slot" key={index}>
              {previewBook?.coverUrl ? (
                <img className="folder-preview-image" src={previewBook.coverUrl} alt="" loading="lazy" />
              ) : (
                <span className="folder-preview-placeholder" />
              )}
            </span>
          );
        })}
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

function SortableShelfItem({ disabled, dragIntent, item, onOpenFolder }) {
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
  const handleClick = () => {
    if (item.type === 'folder') {
      onOpenFolder(item.folder);
    }
  };

  return (
    <button
      ref={setNodeRef}
      className={className}
      style={style}
      type="button"
      aria-label={label}
      onClick={handleClick}
      {...attributes}
      {...listeners}
    >
      <ShelfItemCover item={item} />
    </button>
  );
}

function FolderOverlay({
  books,
  error,
  folder,
  isLoading,
  onClose,
}) {
  if (!folder) {
    return null;
  }

  return (
    <div className="folder-overlay" role="dialog" aria-modal="true" aria-labelledby="folder-overlay-title">
      <button className="folder-backdrop" type="button" aria-label="关闭文件夹" onClick={onClose} />
      <section className="folder-panel">
        <header className="folder-panel-header">
          <h2 id="folder-overlay-title">{folder.name || '文件夹'}</h2>
          <button className="folder-close-button" type="button" aria-label="关闭文件夹" onClick={onClose}>
            <span aria-hidden="true" />
          </button>
        </header>

        {error ? (
          <p className="folder-status error-message" role="alert">
            {error}
          </p>
        ) : null}

        {isLoading ? (
          <div className="folder-book-grid" aria-label="文件夹加载中">
            {Array.from({ length: 4 }).map((_, index) => (
              <div className="folder-book-shell" key={index}>
                <div className="book-cover skeleton-cover" />
              </div>
            ))}
          </div>
        ) : books.length ? (
          <div className="folder-book-grid" aria-label="文件夹书籍">
            {books.map((book) => (
              <button
                className="folder-book-shell"
                type="button"
                aria-label={book.title || '未命名书籍'}
                key={book.id}
              >
                <span className="book-cover">
                  <BookCover book={book} />
                </span>
              </button>
            ))}
          </div>
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
  const ignoreFolderClickUntilRef = useRef(0);
  const sortIntentRef = useRef({ startedAt: 0, targetKey: null });
  const [shelfItems, setShelfItems] = useState([]);
  const [dragIntent, setDragIntent] = useState({ type: 'idle', targetKey: null });
  const [hasLoadedShelf, setHasLoadedShelf] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [openFolder, setOpenFolder] = useState(null);
  const [folderBooks, setFolderBooks] = useState([]);
  const [isFolderLoading, setIsFolderLoading] = useState(false);
  const [folderError, setFolderError] = useState('');
  const [error, setError] = useState('');
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
        const isCenterTarget = pointInRect(activeCenter, centerRect(lockedTarget.rect));

        if (canCreateFolder && isCenterTarget) {
          publishDragIntent({
            type: 'merge',
            targetKey: lockedTarget.key,
          });

          return activeCollision(active.id, droppableContainers);
        }

        publishDragIntent({ type: 'sort', targetKey: null });
        const sortTargetKey = sortTargetKeyFromPoint({
          activeKey: String(active.id),
          point: activeCenter,
          shelfItems,
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
        shelfItems,
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

  async function loadShelf() {
    setIsLoading(true);
    setError('');

    try {
      const data = await listShelfItems();
      setShelfItems((data.items || []).map(normalizeShelfItem));
    } catch (err) {
      setError(err.message || '无法加载书架');
    } finally {
      setHasLoadedShelf(true);
      setIsLoading(false);
    }
  }

  async function handleOpenFolder(folder) {
    if (!folder || isSavingOrder || performance.now() < ignoreFolderClickUntilRef.current) {
      return;
    }

    setOpenFolder(folder);
    setFolderBooks([]);
    setFolderError('');
    setIsFolderLoading(true);

    try {
      const data = await listFolderBooks(folder.id);
      setFolderBooks(data.books || []);
    } catch (err) {
      setFolderError(err.message || '无法加载文件夹');
    } finally {
      setIsFolderLoading(false);
    }
  }

  function handleCloseFolder() {
    setOpenFolder(null);
    setFolderBooks([]);
    setFolderError('');
    setIsFolderLoading(false);
  }

  useEffect(() => {
    loadShelf();
  }, []);

  useEffect(
    () => () => {
      if (dragIntentFrameRef.current) {
        cancelAnimationFrame(dragIntentFrameRef.current);
      }
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

  return (
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

        {isLoading && !hasLoadedShelf ? (
          <div className="shelf-grid" aria-label="书架加载中">
            {Array.from({ length: 6 }).map((_, index) => (
              <div className="book-shell" key={index}>
                <div className="book-cover skeleton-cover" />
              </div>
            ))}
          </div>
        ) : shelfItems.length ? (
          <DndContext
            modifiers={[restrictDragToShelfBounds]}
            sensors={sensors}
            collisionDetection={shelfCollisionDetection}
            onDragCancel={clearDragIntent}
            onDragEnd={handleShelfDragEnd}
          >
            <SortableContext items={shelfItems.map((item) => item.key)} strategy={rectSortingStrategy}>
              <div className="shelf-grid" aria-label="书架列表">
                {shelfItems.map((item) => (
                  <SortableShelfItem
                    disabled={isSavingOrder}
                    dragIntent={dragIntent}
                    item={item}
                    key={item.key}
                    onOpenFolder={handleOpenFolder}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
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
        isLoading={isFolderLoading}
        onClose={handleCloseFolder}
      />
    </main>
  );
}

export default App;
