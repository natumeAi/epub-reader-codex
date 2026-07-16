import { describe, expect, it } from 'vitest';
import {
  PAGE_TURN_RULES,
  clampDragDistance,
  classifyDirection,
  dampBoundaryDistance,
  decidePageDelta,
  getDistanceThreshold,
  getRecentVelocity,
  getSettleDuration,
  getTapZone,
} from './pageTurnGesture.js';

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
});
