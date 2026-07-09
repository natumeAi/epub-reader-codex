import { BookCover } from './BookCover.jsx';
import { FolderCover } from './FolderCover.jsx';

export function ShelfItemCover({ item }) {
  if (item.type === 'folder') {
    return <FolderCover folder={item.folder} />;
  }

  return (
    <span className="book-cover">
      <BookCover book={item.book} />
    </span>
  );
}
