import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeleteConfirmDialog } from './DeleteConfirmDialog.jsx';

describe('DeleteConfirmDialog', () => {
  it('renders an accessible confirmation dialog', () => {
    render(
      <DeleteConfirmDialog
        book={{ id: 7, title: '测试书' }}
        isDeleting={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: '删除《测试书》？' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '删除' })).toBeEnabled();
  });

  it('focuses cancel, closes on Escape, and restores the trigger', async () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <>
        <button type="button">Delete trigger</button>
        <DeleteConfirmDialog
          book={null}
          isDeleting={false}
          onCancel={onCancel}
          onConfirm={vi.fn()}
        />
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'Delete trigger' });
    trigger.focus();
    rerender(
      <>
        <button type="button">Delete trigger</button>
        <DeleteConfirmDialog
          book={{ id: 1, title: 'Book' }}
          isDeleting={false}
          onCancel={onCancel}
          onConfirm={vi.fn()}
        />
      </>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: '取消' })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    rerender(
      <>
        <button type="button">Delete trigger</button>
        <DeleteConfirmDialog
          book={null}
          isDeleting={false}
          onCancel={onCancel}
          onConfirm={vi.fn()}
        />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Delete trigger' })).toHaveFocus();
  });
});
