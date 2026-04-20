import { applySnapping, distance } from '../lib/tools/SnappingCalculator';
import type { PolygonPoint } from '../lib/tools/types';

describe('applySnapping', () => {
  describe('shift disables all snapping', () => {
    it('returns original position when shift is held', () => {
      const pos: PolygonPoint = { x: 3.7, y: 5.3 };
      const result = applySnapping(pos, null, {
        primaryGridSize: 1,
        secondaryGridSize: 0.2,
        shiftHeld: true,
        superHeld: false,
      });
      expect(result.x).toBeCloseTo(3.7);
      expect(result.y).toBeCloseTo(5.3);
    });
  });

  describe('grid snapping', () => {
    it('snaps to grid lines', () => {
      const pos: PolygonPoint = { x: 3.7, y: 5.3 };
      const result = applySnapping(pos, null, {
        primaryGridSize: 1,
        secondaryGridSize: 0.2,
        shiftHeld: false,
        superHeld: false,
      });
      expect(result.x).toBeCloseTo(3.8, 1);
      expect(result.y).toBeCloseTo(5.2, 1);
    });

    it('handles null secondary grid size', () => {
      const pos: PolygonPoint = { x: 3.7, y: 5.3 };
      const result = applySnapping(pos, null, {
        primaryGridSize: 1,
        secondaryGridSize: null,
        shiftHeld: false,
        superHeld: false,
      });
      expect(result.x).toBeCloseTo(4, 1);
      expect(result.y).toBeCloseTo(5, 1);
    });
  });

  describe('angular snapping with super', () => {
    it('snaps to 0 degrees (horizontal right)', () => {
      const pos: PolygonPoint = { x: 5, y: 5 };
      const prev: PolygonPoint = { x: 0, y: 5 };
      const result = applySnapping(pos, prev, {
        primaryGridSize: 1,
        secondaryGridSize: 0.2,
        shiftHeld: false,
        superHeld: true,
      });
      expect(result.x).toBeCloseTo(5, 0);
      expect(result.y).toBeCloseTo(5, 0);
    });

    it('snaps to 90 degrees (vertical up)', () => {
      const pos: PolygonPoint = { x: 0, y: 5 };
      const prev: PolygonPoint = { x: 0, y: 10 };
      const result = applySnapping(pos, prev, {
        primaryGridSize: 1,
        secondaryGridSize: 0.2,
        shiftHeld: false,
        superHeld: true,
      });
      expect(result.x).toBeCloseTo(0, 0);
      expect(result.y).toBeCloseTo(5, 0);
    });

    it('snaps to 45 degrees', () => {
      const pos: PolygonPoint = { x: 5, y: 5 };
      const prev: PolygonPoint = { x: 0, y: 0 };
      const result = applySnapping(pos, prev, {
        primaryGridSize: 1,
        secondaryGridSize: 0.2,
        shiftHeld: false,
        superHeld: true,
      });
      expect(result.x).toBeCloseTo(result.y, 1);
    });

    it('angular snapping applies after grid snapping', () => {
      const pos: PolygonPoint = { x: 0.5, y: 0.5 };
      const prev: PolygonPoint = { x: 0, y: 0 };
      const result = applySnapping(pos, prev, {
        primaryGridSize: 1,
        secondaryGridSize: 0.2,
        shiftHeld: false,
        superHeld: true,
      });
      expect(result.x).toBeCloseTo(result.y, 1);
    });
  });

  describe('with null prevPoint', () => {
    it('does not crash when prevPoint is null', () => {
      const pos: PolygonPoint = { x: 3.7, y: 5.3 };
      const result = applySnapping(pos, null, {
        primaryGridSize: 1,
        secondaryGridSize: 0.2,
        shiftHeld: false,
        superHeld: true,
      });
      expect(result.x).toBeCloseTo(3.8, 1);
    });
  });
});

describe('distance', () => {
  it('calculates euclidean distance correctly', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(distance({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0);
    expect(distance({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(1);
  });
});