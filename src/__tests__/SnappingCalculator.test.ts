import { applySnapping, applySnappingLineSeries } from '@/lib/snapping';
import { SheetPosition } from '../lib/viewport/types';

describe('applySnapping', () => {
  describe('shift disables all snapping', () => {
    it('returns original position when shift is held', () => {
      const pos = new SheetPosition(3.7, 5.3);
      const result = applySnapping(pos, {
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
      const pos = new SheetPosition(3.7, 5.3);
      const result = applySnapping(pos, {
        primaryGridSize: 1,
        secondaryGridSize: 0.2,
        shiftHeld: false,
        superHeld: false,
      });
      expect(result.x).toBeCloseTo(3.8, 1);
      expect(result.y).toBeCloseTo(5.2, 1);
    });

    it('handles null secondary grid size', () => {
      const pos = new SheetPosition(3.7, 5.3);
      const result = applySnapping(pos, {
        primaryGridSize: 1,
        secondaryGridSize: null,
        shiftHeld: false,
        superHeld: false,
      });
      expect(result.x).toBeCloseTo(4, 1);
      expect(result.y).toBeCloseTo(5, 1);
    });
  });
});

describe('applySnappingLineSeries', () => {
  describe('angular snapping with super', () => {
    it('snaps to 0 degrees (horizontal right)', () => {
      const pos = new SheetPosition(5, 5);
      const prev = new SheetPosition(0, 5);
      const result = applySnappingLineSeries(pos, prev, {
        primaryGridSize: 1,
        secondaryGridSize: 0.2,
        shiftHeld: false,
        superHeld: true,
      });
      expect(result.x).toBeCloseTo(5, 0);
      expect(result.y).toBeCloseTo(5, 0);
    });

    it('snaps to 90 degrees (vertical up)', () => {
      const pos = new SheetPosition(0, 5);
      const prev = new SheetPosition(0, 10);
      const result = applySnappingLineSeries(pos, prev, {
        primaryGridSize: 1,
        secondaryGridSize: 0.2,
        shiftHeld: false,
        superHeld: true,
      });
      expect(result.x).toBeCloseTo(0, 0);
      expect(result.y).toBeCloseTo(5, 0);
    });

    it('snaps to 45 degrees', () => {
      const pos = new SheetPosition(5, 5);
      const prev = new SheetPosition(0, 0);
      const result = applySnappingLineSeries(pos, prev, {
        primaryGridSize: 1,
        secondaryGridSize: 0.2,
        shiftHeld: false,
        superHeld: true,
      });
      expect(result.x).toBeCloseTo(result.y, 1);
    });

    it('angular snapping applies after grid snapping', () => {
      const pos = new SheetPosition(0.5, 0.5);
      const prev = new SheetPosition(0, 0);
      const result = applySnappingLineSeries(pos, prev, {
        primaryGridSize: 1,
        secondaryGridSize: 0.2,
        shiftHeld: false,
        superHeld: true,
      });
      expect(result.x).toBeCloseTo(result.y, 1);
    });
  });
});
