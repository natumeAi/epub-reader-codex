import { describe, expect, it, vi } from 'vitest';
import {
  createEpubPageTurnAdapter,
  toLogicalScroll,
  toPhysicalScroll,
} from './epubPageTurnAdapter.js';

function createRendition(overrides = {}) {
  const scroller = {
    clientWidth: 375,
    scrollLeft: 100,
    scrollWidth: 1375,
    style: {},
    addEventListener: vi.fn(),
  };
  const manager = {
    name: 'continuous',
    container: scroller,
    isPaginated: true,
    layout: { divisor: 1, pageWidth: 100 },
    settings: {
      axis: 'horizontal',
      direction: 'ltr',
      rtlScrollType: 'negative',
      snap: true,
    },
    snapper: {},
  };
  return {
    rendition: { manager, display: vi.fn().mockResolvedValue(undefined) },
    manager,
    scroller,
    ...overrides,
  };
}

describe('epub page-turn adapter core', () => {
  it('normalizes LTR, RTL default, and RTL negative coordinates', () => {
    expect(toLogicalScroll({
      scrollLeft: 240, maxScroll: 1000, direction: 'ltr', rtlScrollType: 'negative',
    })).toBe(240);
    expect(toLogicalScroll({
      scrollLeft: 760, maxScroll: 1000, direction: 'rtl', rtlScrollType: 'default',
    })).toBe(240);
    expect(toLogicalScroll({
      scrollLeft: -240, maxScroll: 1000, direction: 'rtl', rtlScrollType: 'negative',
    })).toBe(240);
    expect(toPhysicalScroll({
      logicalScroll: 240, maxScroll: 1000, direction: 'rtl', rtlScrollType: 'default',
    })).toBe(760);
    expect(toPhysicalScroll({
      logicalScroll: 240, maxScroll: 1000, direction: 'rtl', rtlScrollType: 'negative',
    })).toBe(-240);
  });

  it.each([
    ['manager', ({ manager }) => { manager.name = 'default'; }],
    ['paginated', ({ manager }) => { manager.isPaginated = false; }],
    ['axis', ({ manager }) => { manager.settings.axis = 'vertical'; }],
    ['snap', ({ manager }) => { manager.snapper = null; }],
    ['page-width', ({ manager }) => { manager.layout.pageWidth = 0; }],
    ['direction', ({ manager }) => { manager.settings.direction = 'sideways'; }],
    ['rtl-scroll-type', ({ manager }) => {
      manager.settings.direction = 'rtl';
      manager.settings.rtlScrollType = 'reverse';
    }],
    ['alignment', ({ scroller }) => { scroller.scrollLeft = 140; }],
  ])('reports a deterministic %s capability failure', (reason, mutate) => {
    const fixture = createRendition();
    mutate(fixture);
    expect(createEpubPageTurnAdapter(fixture.rendition).inspect()).toMatchObject({
      available: false,
      reason,
    });
  });

  it('derives every drag write from the stable origin without drift', () => {
    const { rendition, scroller } = createRendition();
    const adapter = createEpubPageTurnAdapter(rendition);
    expect(adapter.begin('stable-cfi')).toMatchObject({
      available: true,
      origin: 100,
      pageWidth: 100,
    });

    adapter.dragBy(-40);
    adapter.dragBy(-80);
    expect(scroller.scrollLeft).toBe(180);
    expect(adapter.isStableAt(1)).toBe(false);
    expect(scroller.addEventListener).not.toHaveBeenCalled();
  });

  it('limits a missing-neighbor drag to a 28px transformed boundary offset', () => {
    const { rendition, scroller } = createRendition();
    scroller.scrollLeft = 0;
    const adapter = createEpubPageTurnAdapter(rendition);
    const session = adapter.begin('first-page');
    expect(session.canPrevious).toBe(false);

    const result = adapter.dragBy(200);
    expect(result).toMatchObject({
      boundary: true,
      direction: 'prev',
      effectiveDistanceX: 28,
    });
    expect(scroller.scrollLeft).toBe(0);
    expect(scroller.style.transform).toBe('translate3d(28px, 0, 0)');

    adapter.cancel();
    expect(scroller.style.transform).toBe('');
  });
});
