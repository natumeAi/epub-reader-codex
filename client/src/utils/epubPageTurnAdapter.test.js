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
    updateLayout: vi.fn(),
  };
  return {
    rendition: {
      manager,
      display: vi.fn().mockResolvedValue(undefined),
      reportLocation: vi.fn(),
    },
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

  it('updates the rendition page gap through the private adapter boundary', () => {
    const { rendition, manager } = createRendition();
    const adapter = createEpubPageTurnAdapter(rendition);

    expect(adapter.setPageGap).toEqual(expect.any(Function));
    if (typeof adapter.setPageGap !== 'function') return;

    expect(adapter.setPageGap(144)).toBe(true);
    expect(manager.settings.gap).toBe(144);
    expect(manager.updateLayout).toHaveBeenCalledTimes(1);
  });

  it('allows basic relocated events when enhanced capability is unavailable', () => {
    const { rendition, manager } = createRendition();
    manager.settings.direction = 'rtl';
    manager.settings.rtlScrollType = 'reverse';
    const adapter = createEpubPageTurnAdapter(rendition);

    expect(adapter.inspect()).toMatchObject({
      available: false,
      reason: 'rtl-scroll-type',
    });
    expect(adapter.isStableAligned()).toBe(true);
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

function createFrameDriver() {
  let callback = null;
  let time = 0;
  return {
    environment: {
      cancelAnimationFrame: vi.fn(() => { callback = null; }),
      now: () => time,
      requestAnimationFrame: vi.fn((next) => {
        callback = next;
        return 1;
      }),
    },
    step(nextTime) {
      time = nextTime;
      const next = callback;
      callback = null;
      next?.(nextTime);
    },
  };
}

function createDiagnosticsSpy() {
  let nextRecordId = 1;
  return {
    begin: vi.fn(() => {
      const recordId = `record-${nextRecordId}`;
      nextRecordId += 1;
      return recordId;
    }),
    cancel: vi.fn(),
    clear: vi.fn(),
    destroy: vi.fn(),
    finish: vi.fn(),
    frame: vi.fn(),
    getRecords: vi.fn(() => []),
    markAnimationStart: vi.fn(),
    markVisualUpdate: vi.fn(),
  };
}

it('settles exactly one page and rolls back exactly to the origin', async () => {
  const first = createRendition();
  const firstFrames = createFrameDriver();
  const firstAdapter = createEpubPageTurnAdapter(first.rendition, firstFrames.environment);
  firstAdapter.begin('stable-cfi');
  firstAdapter.dragBy(-40);
  const completed = firstAdapter.animateTo(1, { duration: 180 });
  firstFrames.step(0);
  firstFrames.step(180);
  await expect(completed).resolves.toEqual({ status: 'completed', backend: 'scroll' });
  expect(first.scroller.scrollLeft).toBe(200);
  expect(firstAdapter.isStableAt(1)).toBe(true);

  const second = createRendition();
  const secondFrames = createFrameDriver();
  const secondAdapter = createEpubPageTurnAdapter(second.rendition, secondFrames.environment);
  secondAdapter.begin('stable-cfi');
  secondAdapter.dragBy(-40);
  const reverted = secondAdapter.animateTo(0, { duration: 120 });
  secondFrames.step(0);
  secondFrames.step(120);
  await expect(reverted).resolves.toEqual({ status: 'completed', backend: 'scroll' });
  expect(second.scroller.scrollLeft).toBe(100);
  expect(secondAdapter.isStableAt(0)).toBe(true);
});

it('writes the scroller and reports progress once per animation frame', async () => {
  const fixture = createRendition();
  const frames = createFrameDriver();
  const adapter = createEpubPageTurnAdapter(fixture.rendition, frames.environment);
  adapter.begin('stable-cfi');
  adapter.dragBy(-40);

  let scrollLeft = fixture.scroller.scrollLeft;
  const writeScrollLeft = vi.fn((value) => { scrollLeft = value; });
  Object.defineProperty(fixture.scroller, 'scrollLeft', {
    configurable: true,
    get: () => scrollLeft,
    set: writeScrollLeft,
  });
  const onProgress = vi.fn();
  const settling = adapter.animateTo(1, { duration: 180, onProgress });

  frames.step(0);
  expect(writeScrollLeft).toHaveBeenCalledTimes(1);
  expect(onProgress).toHaveBeenCalledTimes(1);

  writeScrollLeft.mockClear();
  onProgress.mockClear();
  frames.step(180);
  await settling;

  expect(writeScrollLeft).toHaveBeenCalledTimes(1);
  expect(onProgress).toHaveBeenCalledTimes(1);
  expect(scrollLeft).toBe(200);
});

it('records drag and scroll-animation timing without a second animation frame', async () => {
  const fixture = createRendition();
  const frames = createFrameDriver();
  const diagnostics = createDiagnosticsSpy();
  const edgeElement = document.createElement('div');
  const adapter = createEpubPageTurnAdapter(fixture.rendition, {
    ...frames.environment,
    debugConfig: { enabled: true, forceBackend: 'scroll' },
    diagnostics,
  });

  adapter.begin('stable-cfi', {
    action: 'drag',
    edgeElement,
    inputTime: 40,
  });
  expect(diagnostics.begin).toHaveBeenNthCalledWith(1, {
    action: 'drag',
    backend: 'scroll',
    inputTime: 40,
  });

  adapter.dragBy(-40);
  expect(diagnostics.markVisualUpdate).toHaveBeenCalledWith('record-1', 0);
  expect(diagnostics.frame).toHaveBeenCalledWith('record-1', 0);
  expect(frames.environment.requestAnimationFrame).not.toHaveBeenCalled();

  const settling = adapter.animateTo(1, {
    action: 'commit',
    duration: 180,
    inputTime: 75,
  });
  expect(diagnostics.finish).toHaveBeenCalledWith('record-1', 75);
  expect(diagnostics.begin).toHaveBeenNthCalledWith(2, {
    action: 'commit',
    backend: 'scroll',
    inputTime: 75,
  });
  expect(diagnostics.markAnimationStart).toHaveBeenCalledWith('record-2', 0);
  expect(frames.environment.requestAnimationFrame).toHaveBeenCalledTimes(1);

  frames.step(16);
  frames.step(180);
  await expect(settling).resolves.toEqual({ status: 'completed', backend: 'scroll' });

  expect(diagnostics.frame).toHaveBeenCalledWith('record-2', 16);
  expect(diagnostics.frame).toHaveBeenCalledWith('record-2', 180);
  expect(diagnostics.markVisualUpdate).toHaveBeenCalledWith('record-2', 16);
  expect(diagnostics.finish).toHaveBeenCalledWith('record-2', 180);
  expect(diagnostics.finish).toHaveBeenCalledTimes(2);
  expect(diagnostics.cancel).not.toHaveBeenCalled();
  expect(frames.environment.requestAnimationFrame).toHaveBeenCalledTimes(2);

  adapter.destroy();
  expect(diagnostics.destroy).toHaveBeenCalledTimes(1);
});

it('does not schedule an extra frame when diagnostics are disabled', async () => {
  const fixture = createRendition();
  const frames = createFrameDriver();
  const adapter = createEpubPageTurnAdapter(fixture.rendition, {
    ...frames.environment,
    debugConfig: { enabled: false, forceBackend: null },
  });

  adapter.begin('stable-cfi', { action: 'drag', inputTime: 10 });
  adapter.dragBy(-40);
  expect(frames.environment.requestAnimationFrame).not.toHaveBeenCalled();

  const settling = adapter.animateTo(0, {
    action: 'rollback',
    duration: 120,
    inputTime: 20,
  });
  expect(frames.environment.requestAnimationFrame).toHaveBeenCalledTimes(1);
  frames.step(0);
  frames.step(120);
  await expect(settling).resolves.toEqual({ status: 'completed', backend: 'scroll' });
  expect(frames.environment.requestAnimationFrame).toHaveBeenCalledTimes(2);
});

it('reports forced compositor as unavailable before Phase B', () => {
  const fixture = createRendition();
  const diagnostics = createDiagnosticsSpy();
  const adapter = createEpubPageTurnAdapter(fixture.rendition, {
    debugConfig: { enabled: true, forceBackend: 'compositor' },
    diagnostics,
  });

  expect(adapter.inspect()).toEqual({
    available: false,
    reason: 'forced-compositor-unavailable',
  });
  expect(adapter.begin('stable-cfi', {
    action: 'tap-next',
    inputTime: 75,
  })).toBeNull();
  expect(diagnostics.begin).not.toHaveBeenCalled();
});

it('cancels rAF, restores inline styles, and recovers the stable CFI', async () => {
  const fixture = createRendition();
  fixture.scroller.style.transform = 'scale(1)';
  const frames = createFrameDriver();
  const adapter = createEpubPageTurnAdapter(fixture.rendition, frames.environment);
  adapter.begin('epubcfi(/6/2!/4/2)');
  adapter.dragBy(-40);
  const settling = adapter.animateTo(1, { duration: 180 });

  adapter.cancel({ restoreOrigin: true });
  await expect(settling).resolves.toEqual({ status: 'cancelled', backend: 'scroll' });
  expect(frames.environment.cancelAnimationFrame).toHaveBeenCalledTimes(1);
  expect(fixture.scroller.scrollLeft).toBe(100);
  expect(fixture.scroller.style.transform).toBe('scale(1)');

  adapter.begin('epubcfi(/6/2!/4/2)');
  await expect(adapter.recover()).resolves.toBe(true);
  expect(fixture.rendition.display).toHaveBeenCalledWith('epubcfi(/6/2!/4/2)');

  adapter.destroy();
  expect(adapter.begin('later-cfi')).toBeNull();
});

it('reports the stable location when animation starts at the target page', async () => {
  const fixture = createRendition();
  const frames = createFrameDriver();
  const adapter = createEpubPageTurnAdapter(fixture.rendition, frames.environment);
  adapter.begin('stable-cfi');
  fixture.scroller.scrollLeft = 200;

  const settling = adapter.animateTo(1, { duration: 120 });
  frames.step(0);
  frames.step(120);

  await expect(settling).resolves.toEqual({ status: 'completed', backend: 'scroll' });
  expect(fixture.rendition.reportLocation).toHaveBeenCalledTimes(1);
});

it.each([
  ['missing', (rendition) => { rendition.reportLocation = undefined; }],
  ['failing', (rendition) => {
    rendition.reportLocation.mockRejectedValue(new Error('report failed'));
  }],
])('returns unavailable when exact-target reporting is %s', async (_name, mutate) => {
  const fixture = createRendition();
  mutate(fixture.rendition);
  const frames = createFrameDriver();
  const adapter = createEpubPageTurnAdapter(fixture.rendition, frames.environment);
  adapter.begin('stable-cfi');
  fixture.scroller.scrollLeft = 200;

  const settling = adapter.animateTo(1, { duration: 120 });
  frames.step(0);
  frames.step(120);

  await expect(settling).resolves.toEqual({ status: 'unavailable', backend: 'scroll' });
});

it('returns false when stable CFI recovery display fails', async () => {
  const fixture = createRendition();
  fixture.rendition.display.mockRejectedValue(new Error('display failed'));
  const adapter = createEpubPageTurnAdapter(fixture.rendition);
  adapter.begin('stable-cfi');

  await expect(adapter.recover()).resolves.toBe(false);
});
