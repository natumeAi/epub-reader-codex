import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModalDialog } from './useModalDialog.js';

function Harness({ dialogStyle, onClose, open }) {
  const firstRef = useRef(null);
  const { dialogRef, onKeyDown } = useModalDialog({
    initialFocusRef: firstRef,
    onRequestClose: onClose,
    open,
  });

  if (!open) return null;
  return (
    <div
      ref={dialogRef}
      onKeyDown={onKeyDown}
      role="dialog"
      style={dialogStyle}
      tabIndex={-1}
    >
      <button ref={firstRef} type="button">First</button>
      <button type="button">Last</button>
    </div>
  );
}

describe('useModalDialog', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback) => { callback(); return 1; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  it('focuses inside, traps Tab, handles Escape, and restores focus', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <><button type="button">Trigger</button><Harness onClose={onClose} open={false} /></>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    trigger.focus();

    rerender(<><button type="button">Trigger</button><Harness onClose={onClose} open /></>);
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    expect(first).toHaveFocus();

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();
    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.keyDown(last, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<><button type="button">Trigger</button><Harness onClose={onClose} open={false} /></>);
    expect(screen.getByRole('button', { name: 'Trigger' })).toHaveFocus();
  });

  it('focuses the requested target during a transparent entry frame', () => {
    render(<Harness dialogStyle={{ opacity: 0 }} onClose={vi.fn()} open />);

    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
  });
});
