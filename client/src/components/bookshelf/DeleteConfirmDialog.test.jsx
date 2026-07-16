import { render, screen } from '@testing-library/react';
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
});
