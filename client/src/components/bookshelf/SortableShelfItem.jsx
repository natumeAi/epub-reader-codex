import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ShelfItemCover } from './ShelfItemCover.jsx';

const shelfSortTransition = {
  duration: 460,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
};

export function SortableShelfItem({ disabled, dragIntent, item, onOpenBook, onOpenFolder }) {
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
  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleClick(event);
      return;
    }

    listeners?.onKeyDown?.(event);
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
      onKeyDown={handleKeyDown}
    >
      <ShelfItemCover item={item} />
      <span className="shelf-item-label">{label}</span>
    </button>
  );
}
