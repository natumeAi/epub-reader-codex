import { describe, expect, it, vi } from 'vitest';
import {
  PAGE_TURN_DEBUG_STORAGE_KEY,
  createPageTurnDiagnostics,
  readPageTurnDebugConfig,
  summarizePageTurnFrames,
} from './pageTurnDiagnostics.js';

const FACADE_NAME = '__EPUB_READER_PAGE_TURN_DIAGNOSTICS__';

describe('page-turn diagnostics', () => {
  it('reads only explicit debug configuration and accepted forced backends', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({
        enabled: true,
        forceBackend: 'scroll',
      })),
    };

    expect(readPageTurnDebugConfig(storage)).toEqual({
      enabled: true,
      forceBackend: 'scroll',
    });
    expect(storage.getItem).toHaveBeenCalledWith(PAGE_TURN_DEBUG_STORAGE_KEY);

    storage.getItem.mockReturnValue(JSON.stringify({
      enabled: true,
      forceBackend: 'compositor',
    }));
    expect(readPageTurnDebugConfig(storage)).toEqual({
      enabled: true,
      forceBackend: 'compositor',
    });

    storage.getItem.mockReturnValue(JSON.stringify({
      enabled: 'true',
      forceBackend: 'unknown',
    }));
    expect(readPageTurnDebugConfig(storage)).toEqual({
      enabled: false,
      forceBackend: null,
    });
  });

  it('treats absent, malformed, and unavailable storage as disabled', () => {
    expect(readPageTurnDebugConfig(null)).toEqual({
      enabled: false,
      forceBackend: null,
    });
    expect(readPageTurnDebugConfig({ getItem: () => '{broken json' })).toEqual({
      enabled: false,
      forceBackend: null,
    });
    expect(readPageTurnDebugConfig({
      getItem: () => {
        throw new Error('storage unavailable');
      },
    })).toEqual({
      enabled: false,
      forceBackend: null,
    });
  });

  it('calculates deterministic rounded frame summaries', () => {
    expect(summarizePageTurnFrames({
      inputTime: 5,
      firstVisualTime: 21,
      frameTimestamps: [0, 16, 32, 53, 90, 130],
    })).toEqual({
      averageFps: 38.46,
      inputLatencyMs: 16,
      frameIntervalsMs: [16, 16, 21, 37, 40],
      p95FrameIntervalMs: 40,
      framesOver20Ms: 3,
      maxConsecutiveFramesOver33_4Ms: 2,
    });
  });

  it('does not schedule frames, publish a facade, or retain records when disabled', () => {
    const requestAnimationFrame = vi.fn();
    const target = {};
    const diagnostics = createPageTurnDiagnostics({
      enabled: false,
      requestAnimationFrame,
      target,
    });

    const recordId = diagnostics.begin({
      action: 'drag',
      backend: 'scroll',
      inputTime: 5,
    });
    diagnostics.markVisualUpdate(recordId, 10);
    diagnostics.markAnimationStart(recordId, 12, { sampleFrames: true });
    diagnostics.frame(recordId, 16);
    diagnostics.finish(recordId, 20);
    diagnostics.cancel(recordId, 'disabled', 20);

    expect(recordId).toBeNull();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(diagnostics.getRecords()).toEqual([]);
    expect(target).not.toHaveProperty(FACADE_NAME);
  });

  it('records terminal actions once and exposes bounded history by deep copy', () => {
    const target = {};
    const diagnostics = createPageTurnDiagnostics({ enabled: true, target });
    const facade = target[FACADE_NAME];
    const descriptor = Object.getOwnPropertyDescriptor(target, FACADE_NAME);

    expect(Object.isFrozen(facade)).toBe(true);
    expect(descriptor).toMatchObject({ configurable: true, writable: false });
    expect(Object.keys(facade)).toEqual(['getRecords', 'clear']);

    for (let index = 0; index < 205; index += 1) {
      const recordId = diagnostics.begin({
        action: index === 204 ? 'tap-next' : 'drag',
        backend: 'scroll',
        inputTime: index,
      });
      diagnostics.markVisualUpdate(recordId, index + 1);
      diagnostics.markVisualUpdate(recordId, index + 2);
      diagnostics.markAnimationStart(recordId, index + 3);
      diagnostics.frame(recordId, index + 3);
      diagnostics.frame(recordId, index + 19);
      diagnostics.finish(recordId, index + 20);
      diagnostics.finish(recordId, index + 200);
    }

    const records = facade.getRecords();
    expect(records).toHaveLength(200);
    expect(records[0]).toMatchObject({
      action: 'drag',
      backend: 'scroll',
      inputTime: 5,
      firstVisualTime: 6,
      animationStartTime: 8,
      endTime: 25,
      frameTimestamps: [8, 24],
      frameIntervalsMs: [16],
      cancelReason: null,
      averageFps: 62.5,
    });
    expect(records.at(-1)).toMatchObject({
      action: 'tap-next',
      inputTime: 204,
    });

    records[0].frameTimestamps.push(999);
    records[0].frameIntervalsMs.push(999);
    records[0].action = 'mutated';
    expect(diagnostics.getRecords()[0]).toMatchObject({
      action: 'drag',
      frameTimestamps: [8, 24],
      frameIntervalsMs: [16],
    });

    facade.clear();
    expect(diagnostics.getRecords()).toEqual([]);
  });

  it('stops debug-only sampling on finish, cancel, and destroy', () => {
    let nextFrameId = 1;
    const callbacks = new Map();
    const requestAnimationFrame = vi.fn((callback) => {
      const frameId = nextFrameId;
      nextFrameId += 1;
      callbacks.set(frameId, callback);
      return frameId;
    });
    const cancelAnimationFrame = vi.fn((frameId) => {
      callbacks.delete(frameId);
    });
    const target = {};
    const diagnostics = createPageTurnDiagnostics({
      cancelAnimationFrame,
      enabled: true,
      requestAnimationFrame,
      target,
    });

    const finishedId = diagnostics.begin({
      action: 'commit',
      backend: 'compositor',
      inputTime: 0,
    });
    diagnostics.markAnimationStart(finishedId, 0, { sampleFrames: true });
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    const firstCallback = callbacks.get(1);
    callbacks.delete(1);
    firstCallback(16);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);

    diagnostics.finish(finishedId, 20);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(2);
    expect(diagnostics.getRecords()[0].frameTimestamps).toEqual([16]);

    const cancelledId = diagnostics.begin({
      action: 'rollback',
      backend: 'compositor',
      inputTime: 30,
    });
    diagnostics.markAnimationStart(cancelledId, 30, { sampleFrames: true });
    diagnostics.cancel(cancelledId, 'pointercancel', 35);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(3);
    expect(diagnostics.getRecords().at(-1)).toMatchObject({
      cancelReason: 'pointercancel',
      endTime: 35,
    });

    const destroyedId = diagnostics.begin({
      action: 'tap-prev',
      backend: 'compositor',
      inputTime: 40,
    });
    diagnostics.markAnimationStart(destroyedId, 40, { sampleFrames: true });
    diagnostics.destroy();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(4);
    expect(diagnostics.getRecords()).toEqual([]);
    expect(target).not.toHaveProperty(FACADE_NAME);
  });

  it('removes only the facade installed by the destroyed instance', () => {
    const target = {};
    const first = createPageTurnDiagnostics({ enabled: true, target });
    const firstFacade = target[FACADE_NAME];
    const second = createPageTurnDiagnostics({ enabled: true, target });
    const secondFacade = target[FACADE_NAME];

    expect(secondFacade).not.toBe(firstFacade);
    first.destroy();
    expect(target[FACADE_NAME]).toBe(secondFacade);

    second.destroy();
    expect(target).not.toHaveProperty(FACADE_NAME);
  });
});
