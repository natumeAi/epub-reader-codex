import { describe, expect, it } from 'vitest';
import {
  PAGE_TURN_RULES,
  clampDragDistance,
  classifyDirection,
  dampBoundaryDistance,
  decidePageDelta,
  easeOutCubic,
  getDistanceThreshold,
  getRecentVelocity,
  getSettleDuration,
  getTapZone,
  sampleEaseOutCubicKeyframes,
} from './pageTurnGesture.js';

function maxInterpolationError(samples, easing) {
  let sampleIndex = 1;
  let maximumError = 0;

  for (let step = 0; step <= 1000; step += 1) {
    const offset = step / 1000;
    while (samples[sampleIndex].offset < offset) {
      sampleIndex += 1;
    }

    const left = samples[sampleIndex - 1];
    const right = samples[sampleIndex];
    const ratio = (offset - left.offset) / (right.offset - left.offset);
    const interpolated = left.value + (right.value - left.value) * ratio;
    maximumError = Math.max(maximumError, Math.abs(easing(offset) - interpolated));
  }

  return maximumError;
}

describe('page-turn gesture rules', () => {
  it('locks only after 10px and requires a 1.2 horizontal advantage', () => {
    expect(classifyDirection(9, 0)).toBe('pending');
    expect(classifyDirection(10, 8)).toBe('horizontal');
    expect(classifyDirection(10, 9)).toBe('vertical');
  });

  it('clamps the 28 percent distance threshold for phone and tablet widths', () => {
    expect(getDistanceThreshold(200)).toBe(72);
    expect(getDistanceThreshold(375)).toBe(105);
    expect(getDistanceThreshold(1000)).toBe(160);
  });

  it('calculates signed velocity from the latest 100ms sample window', () => {
    expect(getRecentVelocity([
      { x: 300, time: 0 },
      { x: 260, time: 50 },
      { x: 220, time: 100 },
    ])).toBeCloseTo(-0.8);
    expect(getRecentVelocity([
      { x: 100, time: 0 },
      { x: 145, time: 100 },
    ])).toBeCloseTo(0.45);
  });

  it('completes by distance or speed and otherwise returns zero pages', () => {
    expect(decidePageDelta({ distanceX: -110, velocityX: -0.1, pageWidth: 375 })).toBe(1);
    expect(decidePageDelta({ distanceX: 50, velocityX: 0.6, pageWidth: 375 })).toBe(-1);
    expect(decidePageDelta({ distanceX: -50, velocityX: -0.2, pageWidth: 375 })).toBe(0);

    const results = [
      decidePageDelta({ distanceX: -500, velocityX: -4, pageWidth: 375 }),
      decidePageDelta({ distanceX: 0, velocityX: 0, pageWidth: 375 }),
      decidePageDelta({ distanceX: 500, velocityX: 4, pageWidth: 375 }),
    ];
    expect(new Set(results)).toEqual(new Set([-1, 0, 1]));
  });

  it('limits drag, edge damping, settle duration, and tap zones', () => {
    expect(clampDragDistance(-800, 375)).toBe(-375);
    expect(dampBoundaryDistance(200)).toBe(PAGE_TURN_RULES.edgeDampingMaxPx);
    expect(dampBoundaryDistance(-40)).toBe(-10);
    expect(getSettleDuration(0, 375)).toBe(120);
    expect(getSettleDuration(375, 375)).toBe(220);
    expect(getTapZone(20, 0, 300)).toBe('prev');
    expect(getTapZone(150, 0, 300)).toBe('center');
    expect(getTapZone(280, 0, 300)).toBe('next');
  });

  it('samples ease-out cubic into monotonic keyframes with bounded error', () => {
    const samples = sampleEaseOutCubicKeyframes();

    expect(samples[0]).toEqual({ offset: 0, value: 0 });
    expect(samples.at(-1)).toEqual({ offset: 1, value: 1 });
    expect(samples.every((point, index) => (
      index === 0 || (
        point.offset > samples[index - 1].offset
        && point.value >= samples[index - 1].value
      )
    ))).toBe(true);
    expect(maxInterpolationError(samples, easeOutCubic)).toBeLessThanOrEqual(0.0025);
  });
});
