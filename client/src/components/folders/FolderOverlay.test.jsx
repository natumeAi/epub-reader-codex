import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FolderOverlay } from './FolderOverlay.jsx';

const baseProps = {
  books: [],
  error: '',
  folder: { id: 1, name: 'Folder' },
  isClosing: false,
  isLoading: false,
  isRenaming: false,
  isRenameSaving: false,
  isSavingOrder: false,
  onClose: vi.fn(),
  onOpenBook: vi.fn(),
  onRenameCancel: vi.fn(),
  onRenameDraftChange: vi.fn(),
  onRenameStart: vi.fn(),
  onRenameSubmit: vi.fn(),
  renameDraft: 'Folder',
};

describe('FolderOverlay dialog behavior', () => {
  it('focuses the title and traps backward Tab', async () => {
    render(<FolderOverlay {...baseProps} />);
    const title = screen.getByRole('button', { name: 'Folder' });
    await waitFor(() => expect(title).toHaveFocus());
    fireEvent.keyDown(title, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: '关闭文件夹' })).toHaveFocus();
  });

  it('Escape in rename cancels rename without closing the folder', () => {
    const onClose = vi.fn();
    const onRenameCancel = vi.fn();
    render(
      <FolderOverlay
        {...baseProps}
        isRenaming
        onClose={onClose}
        onRenameCancel={onRenameCancel}
      />,
    );

    fireEvent.keyDown(screen.getByRole('textbox', { name: '文件夹名称' }), { key: 'Escape' });
    expect(onRenameCancel).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
