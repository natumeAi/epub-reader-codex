import { ShelfItemCover } from './ShelfItemCover.jsx';

export function ReadOnlyShelfItem({ item, onOpenBook, onOpenFolder }) {
  const name = item.type === 'folder'
    ? item.folder?.name || '文件夹'
    : item.book?.title || '未命名书籍';
  const label = item.type === 'book' && item.folderName
    ? `${name}，位于“${item.folderName}”`
    : name;

  const handleClick = (event) => {
    if (item.type === 'folder') {
      onOpenFolder(item.folder);
      return;
    }

    const rect = event.currentTarget.querySelector('.book-cover')?.getBoundingClientRect();
    onOpenBook(item.book, rect || null);
  };

  return (
    <button
      className="book-shell shelf-item read-only-shelf-item"
      type="button"
      aria-label={label}
      data-readonly="true"
      onClick={handleClick}
    >
      <ShelfItemCover item={item} />
      <span className="shelf-item-label">{name}</span>
      {item.type === 'book' && item.folderName ? (
        <span className="shelf-item-context">位于“{item.folderName}”</span>
      ) : null}
    </button>
  );
}
