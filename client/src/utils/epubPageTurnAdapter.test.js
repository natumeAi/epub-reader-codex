import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEpubPageTurnAdapter,
  toLogicalScroll,
  toPhysicalScroll,
} from './epubPageTurnAdapter.js';

function createRect({ left = 0, top = 0, width = 100, height = 375 } = {}) {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

function createFakeAnimation() {
  let resolveFinished;
  let rejectFinished;
  let settled = false;
  return {
    cancel: vi.fn(),
    fail: vi.fn((error = new Error('animation failed')) => {
      if (settled) return;
      settled = true;
      rejectFinished(error);
    }),
    finish: vi.fn(() => {
      if (settled) return;
      settled = true;
      resolveFinished();
    }),
    finished: new Promise((resolve, reject) => {
      resolveFinished = resolve;
      rejectFinished = reject;
    }),
    startTime: null,
  };
}

function installFakeWaapi(element, animations = []) {
  element.animate = vi.fn(() => {
    const animation = createFakeAnimation();
    animations.push(animation);
    return animation;
  });
  element.getAnimations = vi.fn(() => []);
  return element;
}

function createViewElement(container, geometry, animations) {
  const element = installFakeWaapi(document.createElement('div'), animations);
  element.className = 'epub-view';
  element.getBoundingClientRect = vi.fn(() => createRect(geometry));
  container.appendChild(element);
  return element;
}

function createRendition(overrides = {}) {
  const viewContainer = document.createElement('div');
  viewContainer.dataset.pageTurnAdapterFixture = '';
  document.body.appendChild(viewContainer);
  const animations = [];
  const viewElements = [
    createViewElement(viewContainer, { left: 0 }, animations),
    createViewElement(viewContainer, { left: 100 }, animations),
  ];
  const displayedViews = viewElements.map((element) => ({
    displayed: true,
    element,
  }));
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
    views: {
      container: viewContainer,
      displayed: vi.fn(() => displayedViews),
    },
  };
  return {
    rendition: {
      manager,
      display: vi.fn().mockResolvedValue(undefined),
      reportLocation: vi.fn(),
    },
    manager,
    scroller,
    animations,
    displayedViews,
    viewContainer,
    viewElements,
    ...overrides,
  };
}

afterEach(() => {
  document.querySelectorAll('[data-page-turn-adapter-fixture]').forEach((element) => {
    element.remove();
  });
});

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
      backend: 'scroll',
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

function createObserverDriver() {
  const mutationObservers = [];
  const resizeObservers = [];
  const createObserver = (instances) => class FakeObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnect = vi.fn();
      this.observe = vi.fn();
      this.trigger = (entries = []) => callback(entries, this);
      instances.push(this);
    }
  };

  return {
    environment: {
      MutationObserver: createObserver(mutationObservers),
      ResizeObserver: createObserver(resizeObservers),
    },
    mutationObservers,
    resizeObservers,
  };
}

function trackStyleProperty(style, property, initialValue = '') {
  let value = initialValue;
  const write = vi.fn((nextValue) => { value = nextValue; });
  Object.defineProperty(style, property, {
    configurable: true,
    get: () => value,
    set: write,
  });
  return { read: () => value, write };
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

it('writes the scroller once per animation frame', async () => {
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
  const settling = adapter.animateTo(1, { duration: 180 });

  frames.step(0);
  expect(writeScrollLeft).toHaveBeenCalledTimes(1);

  writeScrollLeft.mockClear();
  frames.step(180);
  await settling;

  expect(writeScrollLeft).toHaveBeenCalledTimes(1);
  expect(scrollLeft).toBe(200);
});

it('deduplicates identical boundary and edge transform writes', () => {
  const fixture = createRendition();
  fixture.scroller.scrollLeft = 0;
  const scrollerTransform = trackStyleProperty(fixture.scroller.style, 'transform');
  const edgeStyle = { willChange: '' };
  const edgeTransform = trackStyleProperty(edgeStyle, 'transform');
  const edgeElement = { style: edgeStyle };
  const adapter = createEpubPageTurnAdapter(fixture.rendition);

  adapter.begin('first-page', { edgeElement });
  scrollerTransform.write.mockClear();
  edgeTransform.write.mockClear();

  adapter.dragBy(200);
  adapter.dragBy(200);

  expect(scrollerTransform.write).toHaveBeenCalledTimes(1);
  expect(scrollerTransform.read()).toBe('translate3d(28px, 0, 0)');
  expect(edgeTransform.write).toHaveBeenCalledTimes(1);
  expect(edgeTransform.read()).toBe('translate3d(28px, 0, 0)');

  adapter.cancel();
});

it.each(['end', 'cancel', 'destroy'])(
  'positions the page seam directly and restores inline styles on %s',
  (cleanupMethod) => {
    const fixture = createRendition();
    const edgeElement = document.createElement('div');
    edgeElement.style.transform = 'scale(0.9)';
    edgeElement.style.willChange = 'opacity';
    const adapter = createEpubPageTurnAdapter(fixture.rendition);

    adapter.begin('stable-cfi', { edgeElement });
    expect(edgeElement.style.willChange).toBe('transform');

    adapter.dragBy(-40);
    expect(edgeElement.style.transform).toBe('translate3d(60px, 0, 0)');
    expect(edgeElement.style.getPropertyValue('--reader-page-turn-progress')).toBe('');

    adapter.dragBy(40);
    expect(edgeElement.style.transform).toBe('translate3d(40px, 0, 0)');

    adapter[cleanupMethod]();
    expect(edgeElement.style.transform).toBe('scale(0.9)');
    expect(edgeElement.style.willChange).toBe('opacity');
  },
);

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

describe('forced compositor session preparation', () => {
  it.each([
    ['zero views', 'views', ({ manager }) => {
      manager.views.displayed.mockReturnValue([]);
    }],
    ['disconnected view', 'view-disconnected', ({ viewElements }) => {
      viewElements[0].remove();
    }],
    ['replaced view', 'view-disconnected', ({ viewElements }) => {
      const replacement = installFakeWaapi(document.createElement('div'));
      replacement.className = 'epub-view';
      viewElements[0].replaceWith(replacement);
    }],
    ['business transform', 'view-transform', ({ viewElements }) => {
      viewElements[0].style.transform = 'scale(0.9)';
    }],
    ['active animation', 'view-animation', ({ viewElements }) => {
      viewElements[0].getAnimations.mockReturnValue([createFakeAnimation()]);
    }],
    ['missing animate', 'waapi', ({ viewElements }) => {
      viewElements[0].animate = undefined;
    }],
    ['invalid geometry', 'geometry', ({ viewElements }) => {
      viewElements[0].getBoundingClientRect.mockReturnValue(createRect({ width: 0 }));
    }],
  ])('reports %s as deterministic %s without changing styles', (_name, reason, mutate) => {
    const fixture = createRendition();
    const edgeElement = installFakeWaapi(document.createElement('div'));
    edgeElement.style.transform = 'scale(0.8)';
    edgeElement.style.willChange = 'opacity';
    fixture.viewElements[0].style.willChange = 'contents';
    const originalViewStyles = fixture.viewElements.map((element) => ({
      transform: element.style.transform,
      willChange: element.style.willChange,
    }));
    mutate(fixture);
    const expectedViewStyles = fixture.viewElements.map((element) => ({
      transform: element.style.transform,
      willChange: element.style.willChange,
    }));
    const diagnostics = createDiagnosticsSpy();
    const adapter = createEpubPageTurnAdapter(fixture.rendition, {
      debugConfig: { enabled: true, forceBackend: 'compositor' },
      diagnostics,
    });

    expect(adapter.inspect()).toEqual({ available: false, reason });
    expect(adapter.begin('stable-cfi', { edgeElement })).toBeNull();
    expect(fixture.viewElements.map((element) => ({
      transform: element.style.transform,
      willChange: element.style.willChange,
    }))).toEqual(expectedViewStyles);
    expect(edgeElement.style.transform).toBe('scale(0.8)');
    expect(edgeElement.style.willChange).toBe('opacity');
    expect(diagnostics.begin).not.toHaveBeenCalled();

    if (reason !== 'view-transform') {
      expect(expectedViewStyles).toEqual(originalViewStyles);
    }
  });

  it.each(['end', 'cancel', 'destroy'])(
    'prepares only displayed views and restores exact styles on %s',
    (cleanupMethod) => {
      const fixture = createRendition();
      fixture.viewElements[0].style.willChange = 'contents';
      fixture.viewElements[1].style.willChange = 'opacity';
      const undisplayedElement = createViewElement(
        fixture.viewContainer,
        { left: 200 },
        fixture.animations,
      );
      undisplayedElement.style.willChange = 'scroll-position';
      const edgeElement = installFakeWaapi(document.createElement('div'));
      edgeElement.style.transform = 'scale(0.8)';
      edgeElement.style.willChange = 'opacity';
      const adapter = createEpubPageTurnAdapter(fixture.rendition, {
        debugConfig: { enabled: true, forceBackend: 'compositor' },
      });

      expect(adapter.begin('stable-cfi', { edgeElement })).toMatchObject({
        available: true,
        backend: 'compositor',
        origin: 100,
        pageWidth: 100,
      });
      expect(fixture.viewElements.map((element) => element.style.transform)).toEqual(['', '']);
      expect(fixture.viewElements.map((element) => element.style.willChange)).toEqual([
        'transform',
        'transform',
      ]);
      expect(edgeElement.style.transform).toBe('scale(0.8)');
      expect(edgeElement.style.willChange).toBe('transform');
      expect(undisplayedElement.style.willChange).toBe('scroll-position');

      adapter[cleanupMethod]();
      expect(fixture.viewElements.map((element) => element.style.transform)).toEqual(['', '']);
      expect(fixture.viewElements.map((element) => element.style.willChange)).toEqual([
        'contents',
        'opacity',
      ]);
      expect(edgeElement.style.transform).toBe('scale(0.8)');
      expect(edgeElement.style.willChange).toBe('opacity');
      expect(undisplayedElement.style.willChange).toBe('scroll-position');
    },
  );

  it('restores compositor styles before recovering the stable CFI', async () => {
    const fixture = createRendition();
    fixture.viewElements[0].style.willChange = 'contents';
    const edgeElement = installFakeWaapi(document.createElement('div'));
    edgeElement.style.transform = 'scale(0.8)';
    edgeElement.style.willChange = 'opacity';
    const adapter = createEpubPageTurnAdapter(fixture.rendition, {
      debugConfig: { enabled: true, forceBackend: 'compositor' },
    });

    expect(adapter.begin('stable-cfi', { edgeElement })).toMatchObject({
      available: true,
      backend: 'compositor',
    });
    await expect(adapter.recover()).resolves.toBe(true);

    expect(fixture.rendition.display).toHaveBeenCalledWith('stable-cfi');
    expect(fixture.viewElements[0].style.willChange).toBe('contents');
    expect(fixture.viewElements[1].style.willChange).toBe('');
    expect(edgeElement.style.transform).toBe('scale(0.8)');
    expect(edgeElement.style.willChange).toBe('opacity');
  });

  it('moves every displayed view and the seam without scrolling', () => {
    const fixture = createRendition();
    const edgeElement = installFakeWaapi(document.createElement('div'), fixture.animations);
    const adapter = createEpubPageTurnAdapter(fixture.rendition, {
      debugConfig: { enabled: true, forceBackend: 'compositor' },
    });

    adapter.begin('stable-cfi', { edgeElement });
    expect(adapter.dragBy(-40)).toMatchObject({
      boundary: false,
      direction: 'next',
      effectiveDistanceX: -40,
      progress: 0.4,
    });

    expect(fixture.viewElements.map((element) => element.style.transform)).toEqual([
      'translate3d(-40px, 0, 0)',
      'translate3d(-40px, 0, 0)',
    ]);
    expect(edgeElement.style.transform).toBe('translate3d(60px, 0, 0)');
    expect(fixture.scroller.scrollLeft).toBe(100);
    expect(fixture.scroller.style.transform || '').toBe('');
    expect(fixture.rendition.reportLocation).not.toHaveBeenCalled();

    adapter.cancel();
  });

  it('damps a missing-neighbor compositor drag to 28px without scrolling', () => {
    const fixture = createRendition();
    fixture.scroller.scrollLeft = 0;
    const edgeElement = installFakeWaapi(document.createElement('div'), fixture.animations);
    const adapter = createEpubPageTurnAdapter(fixture.rendition, {
      debugConfig: { enabled: true, forceBackend: 'compositor' },
    });

    expect(adapter.begin('first-page', { edgeElement })).toMatchObject({
      backend: 'compositor',
      canPrevious: false,
    });
    expect(adapter.dragBy(200)).toMatchObject({
      boundary: true,
      direction: 'prev',
      effectiveDistanceX: 28,
    });

    expect(fixture.viewElements.map((element) => element.style.transform)).toEqual([
      'translate3d(28px, 0, 0)',
      'translate3d(28px, 0, 0)',
    ]);
    expect(edgeElement.style.transform).toBe('translate3d(28px, 0, 0)');
    expect(fixture.scroller.scrollLeft).toBe(0);
    expect(fixture.scroller.style.transform || '').toBe('');

    adapter.cancel();
  });

  it('rolls compositor views back as one WAAPI group without relocation', async () => {
    const fixture = createRendition();
    fixture.viewElements[0].style.willChange = 'contents';
    fixture.viewElements[1].style.willChange = 'opacity';
    const edgeElement = installFakeWaapi(document.createElement('div'), fixture.animations);
    edgeElement.style.transform = 'scale(0.8)';
    edgeElement.style.willChange = 'opacity';
    let scrollLeft = fixture.scroller.scrollLeft;
    const writeScrollLeft = vi.fn((value) => { scrollLeft = value; });
    Object.defineProperty(fixture.scroller, 'scrollLeft', {
      configurable: true,
      get: () => scrollLeft,
      set: writeScrollLeft,
    });
    const frames = createFrameDriver();
    const diagnostics = createDiagnosticsSpy();
    const adapter = createEpubPageTurnAdapter(fixture.rendition, {
      ...frames.environment,
      debugConfig: { enabled: true, forceBackend: 'compositor' },
      diagnostics,
      timeline: { currentTime: 250 },
    });

    adapter.begin('stable-cfi', {
      action: 'drag',
      edgeElement,
      inputTime: 40,
    });
    adapter.dragBy(-40);
    const rollback = adapter.animateTo(0, {
      action: 'rollback',
      duration: 120,
      inputTime: 75,
    });

    expect(fixture.viewElements.every((element) => (
      element.animate.mock.calls.length === 1
    ))).toBe(true);
    expect(edgeElement.animate).toHaveBeenCalledTimes(1);
    expect(fixture.animations).toHaveLength(3);
    expect(fixture.animations.map((animation) => animation.startTime)).toEqual([
      250,
      250,
      250,
    ]);

    const viewKeyframes = fixture.viewElements[0].animate.mock.calls[0][0];
    const edgeKeyframes = edgeElement.animate.mock.calls[0][0];
    expect(viewKeyframes[0]).toEqual({
      offset: 0,
      transform: 'translate3d(-40px, 0, 0)',
    });
    expect(viewKeyframes.at(-1)).toEqual({
      offset: 1,
      transform: 'translate3d(0px, 0, 0)',
    });
    expect(edgeKeyframes[0].transform).toBe('translate3d(60px, 0, 0)');
    expect(edgeKeyframes.at(-1).transform).toBe('translate3d(100px, 0, 0)');
    expect(fixture.viewElements[0].animate.mock.calls[0][1]).toEqual({
      duration: 120,
      easing: 'linear',
      fill: 'forwards',
    });
    expect(writeScrollLeft).not.toHaveBeenCalled();
    expect(fixture.rendition.reportLocation).not.toHaveBeenCalled();

    let rollbackResolved = false;
    void rollback.then(() => { rollbackResolved = true; });
    fixture.animations[0].finish();
    fixture.animations[1].finish();
    await Promise.resolve();
    expect(rollbackResolved).toBe(false);
    fixture.animations[2].finish();

    await expect(rollback).resolves.toEqual({
      status: 'completed',
      backend: 'compositor',
    });
    expect(fixture.animations.every((animation) => (
      animation.cancel.mock.calls.length === 1
    ))).toBe(true);
    expect(fixture.viewElements.map((element) => element.style.transform)).toEqual(['', '']);
    expect(fixture.viewElements.map((element) => element.style.willChange)).toEqual([
      'contents',
      'opacity',
    ]);
    expect(edgeElement.style.transform).toBe('scale(0.8)');
    expect(edgeElement.style.willChange).toBe('opacity');
    expect(scrollLeft).toBe(100);
    expect(writeScrollLeft).not.toHaveBeenCalled();
    expect(fixture.rendition.reportLocation).not.toHaveBeenCalled();
    expect(adapter.isStableAt(0)).toBe(true);
    expect(diagnostics.begin).toHaveBeenNthCalledWith(1, {
      action: 'drag',
      backend: 'compositor',
      inputTime: 40,
    });
    expect(diagnostics.begin).toHaveBeenNthCalledWith(2, {
      action: 'rollback',
      backend: 'compositor',
      inputTime: 75,
    });
    expect(diagnostics.markAnimationStart).toHaveBeenCalledWith(
      'record-2',
      expect.any(Number),
      { sampleFrames: true },
    );

    adapter.end();
  });

  it('accepts transform-only scroll width growth through an RTL commit', async () => {
    const fixture = createRendition();
    fixture.manager.settings.direction = 'rtl';
    fixture.manager.settings.rtlScrollType = 'negative';
    fixture.scroller.scrollLeft = -100;
    const edgeElement = installFakeWaapi(document.createElement('div'), fixture.animations);
    const frames = createFrameDriver();
    const adapter = createEpubPageTurnAdapter(fixture.rendition, {
      ...frames.environment,
      debugConfig: { enabled: true, forceBackend: 'compositor' },
      diagnostics: createDiagnosticsSpy(),
    });

    expect(adapter.begin('stable-cfi', { edgeElement })).toMatchObject({
      backend: 'compositor',
      origin: 100,
    });
    adapter.dragBy(-40);
    fixture.scroller.scrollWidth = 1415;
    const commit = adapter.animateTo(1, { duration: 180 });

    expect(fixture.animations).toHaveLength(3);
    fixture.scroller.scrollWidth = 1475;
    fixture.animations.forEach((animation) => animation.finish());
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(frames.environment.requestAnimationFrame).toHaveBeenCalledTimes(1);

    frames.step(16);
    await expect(commit).resolves.toEqual({
      status: 'completed',
      backend: 'compositor',
    });
    expect(fixture.scroller.scrollLeft).toBe(-200);
    adapter.end();
  });

  it.each([
    ['LTR', 'ltr', 'negative', 100, 200],
    ['RTL default', 'rtl', 'default', 900, 800],
    ['RTL negative', 'rtl', 'negative', -100, -200],
  ])(
    'commits one compositor page with one atomic %s scroll write',
    async (_name, direction, rtlScrollType, initialPhysical, expectedPhysical) => {
      const fixture = createRendition();
      fixture.manager.settings.direction = direction;
      fixture.manager.settings.rtlScrollType = rtlScrollType;
      fixture.viewElements[0].style.willChange = 'contents';
      fixture.viewElements[1].style.willChange = 'opacity';
      const edgeElement = installFakeWaapi(document.createElement('div'), fixture.animations);
      edgeElement.style.transform = 'scale(0.8)';
      edgeElement.style.willChange = 'opacity';
      fixture.rendition.next = vi.fn();
      fixture.rendition.prev = vi.fn();
      fixture.manager.ignore = true;
      let scrollLeft = initialPhysical;
      const writes = [];
      const writeScrollLeft = vi.fn((value) => {
        writes.push({
          animationCancelCounts: fixture.animations.map((animation) => (
            animation.cancel.mock.calls.length
          )),
          managerIgnore: fixture.manager.ignore,
          value,
          viewWillChange: fixture.viewElements.map((element) => (
            element.style.willChange
          )),
        });
        scrollLeft = value;
      });
      Object.defineProperty(fixture.scroller, 'scrollLeft', {
        configurable: true,
        get: () => scrollLeft,
        set: writeScrollLeft,
      });
      const frames = createFrameDriver();
      const adapter = createEpubPageTurnAdapter(fixture.rendition, {
        ...frames.environment,
        debugConfig: { enabled: true, forceBackend: 'compositor' },
        diagnostics: createDiagnosticsSpy(),
        timeline: { currentTime: 250 },
      });

      expect(adapter.begin('stable-cfi', {
        action: 'tap-next',
        edgeElement,
        inputTime: 40,
      })).toMatchObject({
        backend: 'compositor',
        origin: 100,
        pageWidth: 100,
      });
      const commit = adapter.animateTo(1, {
        action: 'commit',
        duration: 180,
        inputTime: 75,
      });
      let commitResolved = false;
      void commit.then(() => { commitResolved = true; });

      expect(fixture.animations).toHaveLength(3);
      const viewKeyframes = fixture.viewElements[0].animate.mock.calls[0][0];
      const edgeKeyframes = edgeElement.animate.mock.calls[0][0];
      expect(viewKeyframes[0].transform).toBe('translate3d(0px, 0, 0)');
      expect(viewKeyframes.at(-1).transform).toBe('translate3d(-100px, 0, 0)');
      expect(edgeKeyframes[0].transform).toBe('translate3d(100px, 0, 0)');
      expect(edgeKeyframes.at(-1).transform).toBe('translate3d(0px, 0, 0)');
      expect(fixture.viewElements[0].animate.mock.calls[0][1]).toEqual({
        duration: 180,
        easing: 'linear',
        fill: 'forwards',
      });
      expect(writeScrollLeft).not.toHaveBeenCalled();
      expect(frames.environment.requestAnimationFrame).not.toHaveBeenCalled();
      expect(fixture.rendition.reportLocation).not.toHaveBeenCalled();

      fixture.animations.forEach((animation) => animation.finish());
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(commitResolved).toBe(false);
      expect(writeScrollLeft).not.toHaveBeenCalled();
      expect(frames.environment.requestAnimationFrame).toHaveBeenCalledTimes(1);
      expect(fixture.animations.every((animation) => (
        animation.cancel.mock.calls.length === 0
      ))).toBe(true);

      frames.step(16);
      await expect(commit).resolves.toEqual({
        status: 'completed',
        backend: 'compositor',
      });

      expect(writeScrollLeft).toHaveBeenCalledTimes(1);
      expect(writes).toEqual([{
        animationCancelCounts: [0, 0, 0],
        managerIgnore: false,
        value: expectedPhysical,
        viewWillChange: ['transform', 'transform'],
      }]);
      expect(scrollLeft).toBe(expectedPhysical);
      expect(fixture.animations.every((animation) => (
        animation.cancel.mock.calls.length === 1
      ))).toBe(true);
      expect(fixture.viewElements.map((element) => element.style.transform)).toEqual(['', '']);
      expect(fixture.viewElements.map((element) => element.style.willChange)).toEqual([
        'contents',
        'opacity',
      ]);
      expect(edgeElement.style.transform).toBe('scale(0.8)');
      expect(edgeElement.style.willChange).toBe('opacity');
      expect(adapter.isStableAt(1)).toBe(true);
      expect(adapter.isStableAligned()).toBe(true);
      expect(fixture.rendition.reportLocation).not.toHaveBeenCalled();
      expect(fixture.rendition.next).not.toHaveBeenCalled();
      expect(fixture.rendition.prev).not.toHaveBeenCalled();

      adapter.end();
    },
  );

  it.each([
    ['removed view', 'view-disconnected', ({ viewElements }) => {
      viewElements[0].remove();
    }],
    ['replaced view', 'views', (fixture) => {
      const replacement = createViewElement(
        fixture.viewContainer,
        { left: 0 },
        fixture.animations,
      );
      fixture.viewElements[0].replaceWith(replacement);
      fixture.manager.views.displayed.mockReturnValue([
        { displayed: true, element: replacement },
        fixture.displayedViews[1],
      ]);
    }],
    ['disconnected identity', 'view-disconnected', ({ viewElements }) => {
      Object.defineProperty(viewElements[0], 'isConnected', {
        configurable: true,
        value: false,
      });
    }],
    ['changed geometry', 'geometry', ({ viewElements }) => {
      viewElements[0].getBoundingClientRect.mockReturnValue(createRect({ width: 120 }));
    }],
  ])('invalidates a compositor session for %s before starting another backend', async (
    _name,
    reason,
    mutate,
  ) => {
    const fixture = createRendition();
    const edgeElement = installFakeWaapi(document.createElement('div'), fixture.animations);
    const debugConfig = { enabled: true, forceBackend: 'compositor' };
    const adapter = createEpubPageTurnAdapter(fixture.rendition, { debugConfig });

    adapter.begin('stable-cfi', { edgeElement });
    adapter.dragBy(-40);
    mutate(fixture);
    const settling = adapter.animateTo(0, { duration: 120 });
    fixture.animations.forEach((animation) => animation.finish());

    await expect(settling).resolves.toEqual({
      status: 'unavailable',
      backend: 'compositor',
      reason,
    });
    expect(fixture.viewElements.map((element) => element.style.transform)).toEqual(['', '']);
    expect(edgeElement.style.transform).toBe('');
    expect(fixture.scroller.scrollLeft).toBe(100);
    expect(adapter.inspect()).toEqual({ available: false, reason });
    expect(adapter.begin('forced-again', { edgeElement })).toBeNull();

    debugConfig.forceBackend = null;
    expect(adapter.begin('scroll-fallback', { edgeElement })).toMatchObject({
      available: true,
      backend: 'scroll',
    });
    adapter.end();
  });

  it.each([
    ['rejected', new Error('animation failed')],
    ['cancelled', new DOMException('Animation cancelled', 'AbortError')],
  ])('disables compositor after one animation is %s', async (_name, failure) => {
    const fixture = createRendition();
    const edgeElement = installFakeWaapi(document.createElement('div'), fixture.animations);
    const debugConfig = { enabled: true, forceBackend: 'compositor' };
    const adapter = createEpubPageTurnAdapter(fixture.rendition, { debugConfig });

    adapter.begin('stable-cfi', { edgeElement });
    adapter.dragBy(-40);
    const settling = adapter.animateTo(0, { duration: 120 });
    fixture.animations[0].fail(failure);

    await expect(settling).resolves.toEqual({
      status: 'unavailable',
      backend: 'compositor',
      reason: 'animation',
    });
    expect(fixture.animations.every((animation) => (
      animation.cancel.mock.calls.length === 1
    ))).toBe(true);
    expect(fixture.viewElements.map((element) => element.style.transform)).toEqual(['', '']);
    expect(edgeElement.style.transform).toBe('');
    expect(adapter.inspect()).toEqual({ available: false, reason: 'animation' });
    expect(adapter.begin('forced-again', { edgeElement })).toBeNull();

    debugConfig.forceBackend = null;
    expect(adapter.begin('scroll-fallback', { edgeElement })).toMatchObject({
      backend: 'scroll',
    });
    adapter.end();
  });

  it('observes compositor geometry and child-list changes and disconnects on failure', () => {
    const fixture = createRendition();
    const observers = createObserverDriver();
    const edgeElement = installFakeWaapi(document.createElement('div'), fixture.animations);
    const adapter = createEpubPageTurnAdapter(fixture.rendition, {
      ...observers.environment,
      debugConfig: { enabled: true, forceBackend: 'compositor' },
    });

    adapter.begin('stable-cfi', { edgeElement });
    expect(observers.resizeObservers).toHaveLength(1);
    expect(observers.mutationObservers).toHaveLength(1);
    expect(observers.mutationObservers[0].observe).toHaveBeenCalledWith(
      fixture.viewContainer,
      { childList: true },
    );
    adapter.dragBy(-40);
    fixture.viewElements[0].getBoundingClientRect.mockReturnValue(createRect({ width: 120 }));
    observers.resizeObservers[0].trigger();

    expect(fixture.viewElements.map((element) => element.style.transform)).toEqual(['', '']);
    expect(edgeElement.style.transform).toBe('');
    expect(fixture.scroller.scrollLeft).toBe(100);
    expect(observers.resizeObservers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(observers.mutationObservers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(adapter.inspect()).toEqual({ available: false, reason: 'geometry' });
  });

  it.each([
    ['pointercancel', (adapter) => adapter.cancel({
      reason: 'pointercancel',
      restoreOrigin: true,
    }), true],
    ['viewport resize', (adapter) => adapter.cancel({
      reason: 'viewport',
      restoreOrigin: true,
    }), true],
    ['settings mutation', (adapter) => adapter.setPageGap(144), true],
    ['destroy', (adapter) => adapter.destroy(), false],
  ])('treats %s as external cancellation without disabling compositor', async (
    name,
    cancelSession,
    canRestart,
  ) => {
    const fixture = createRendition();
    const observers = createObserverDriver();
    const edgeElement = installFakeWaapi(document.createElement('div'), fixture.animations);
    const adapter = createEpubPageTurnAdapter(fixture.rendition, {
      ...observers.environment,
      debugConfig: { enabled: true, forceBackend: 'compositor' },
    });

    adapter.begin('stable-cfi', { edgeElement });
    adapter.dragBy(-40);
    const settling = adapter.animateTo(0, { duration: 120 });
    cancelSession(adapter);
    fixture.animations[0].fail(new DOMException('Cancelled', 'AbortError'));

    await expect(settling).resolves.toEqual({
      status: 'cancelled',
      backend: 'compositor',
    });
    expect(fixture.viewElements.map((element) => element.style.transform)).toEqual(['', '']);
    expect(edgeElement.style.transform).toBe('');
    expect(fixture.scroller.scrollLeft).toBe(100);
    expect(observers.resizeObservers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(observers.mutationObservers[0].disconnect).toHaveBeenCalledTimes(1);

    if (name === 'settings mutation') {
      expect(fixture.manager.settings.gap).toBe(144);
      expect(fixture.manager.updateLayout).toHaveBeenCalledTimes(1);
    }
    if (canRestart) {
      expect(adapter.inspect()).toMatchObject({ available: true });
      expect(adapter.begin('fresh-cfi', { edgeElement })).toMatchObject({
        backend: 'compositor',
      });
      adapter.cancel();
    } else {
      expect(adapter.begin('fresh-cfi', { edgeElement })).toBeNull();
    }
  });

  it('ignores stale Animation.finished resolution after a newer session begins', async () => {
    const fixture = createRendition();
    const edgeElement = installFakeWaapi(document.createElement('div'), fixture.animations);
    const adapter = createEpubPageTurnAdapter(fixture.rendition, {
      debugConfig: { enabled: true, forceBackend: 'compositor' },
    });

    adapter.begin('first-cfi', { edgeElement });
    adapter.dragBy(-40);
    const firstSettling = adapter.animateTo(0, { duration: 120 });
    const staleAnimations = fixture.animations.slice();
    adapter.cancel({ reason: 'pointercancel', restoreOrigin: true });

    adapter.begin('second-cfi', { edgeElement });
    adapter.dragBy(-20);
    staleAnimations.forEach((animation) => animation.finish());
    await expect(firstSettling).resolves.toEqual({
      status: 'cancelled',
      backend: 'compositor',
    });
    expect(fixture.viewElements.map((element) => element.style.transform)).toEqual([
      'translate3d(-20px, 0, 0)',
      'translate3d(-20px, 0, 0)',
    ]);

    adapter.cancel();
  });

  it('cancels a pending compositor commit frame before it can write the target', async () => {
    const fixture = createRendition();
    const edgeElement = installFakeWaapi(document.createElement('div'), fixture.animations);
    let scrollLeft = fixture.scroller.scrollLeft;
    const writeScrollLeft = vi.fn((value) => { scrollLeft = value; });
    Object.defineProperty(fixture.scroller, 'scrollLeft', {
      configurable: true,
      get: () => scrollLeft,
      set: writeScrollLeft,
    });
    const frames = createFrameDriver();
    const adapter = createEpubPageTurnAdapter(fixture.rendition, {
      ...frames.environment,
      debugConfig: { enabled: true, forceBackend: 'compositor' },
      diagnostics: createDiagnosticsSpy(),
    });

    adapter.begin('stable-cfi', { edgeElement });
    const commit = adapter.animateTo(1, { duration: 180 });
    fixture.animations.forEach((animation) => animation.finish());
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(frames.environment.requestAnimationFrame).toHaveBeenCalledTimes(1);

    adapter.cancel({ reason: 'viewport', restoreOrigin: true });
    expect(frames.environment.cancelAnimationFrame).toHaveBeenCalledWith(1);
    await expect(commit).resolves.toEqual({
      status: 'cancelled',
      backend: 'compositor',
    });
    expect(writeScrollLeft).not.toHaveBeenCalledWith(200);
    expect(scrollLeft).toBe(100);
    expect(fixture.viewElements.map((element) => element.style.transform)).toEqual(['', '']);
  });
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
  expect(adapter.inspect()).toEqual({ available: false, reason: 'recovery' });
});
