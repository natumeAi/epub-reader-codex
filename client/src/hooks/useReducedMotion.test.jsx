import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useReducedMotion } from './useReducedMotion.js';

describe('useReducedMotion', () => {
  it('reads and reacts to the reduced-motion media query', () => {
    let listener;
    const mediaQuery = {
      matches: true,
      addEventListener: vi.fn((eventName, callback) => { listener = callback; }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', vi.fn(() => mediaQuery));
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);

    act(() => listener({ matches: false }));
    expect(result.current).toBe(false);
  });

  it('defaults to false when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });
});
