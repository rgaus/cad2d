import { SheetPosition } from '../lib/viewport/types';
import { computeLineSpriteTransform } from '../lib/viewport/lineSpriteMath';

describe('computeLineSpriteTransform', () => {
  const SHEET_UNITS_TO_PIXELS = 64;

  describe('center position is always the midpoint', () => {
    it('horizontal line - center is midpoint', () => {
      const result = computeLineSpriteTransform(
        new SheetPosition(0, 0),
        new SheetPosition(10, 0)
      );
      expect(result.centerX).toBe(5 * SHEET_UNITS_TO_PIXELS);
      expect(result.centerY).toBe(0);
    });

    it('horizontal line reversed - center is still midpoint', () => {
      const result = computeLineSpriteTransform(
        new SheetPosition(10, 0),
        new SheetPosition(0, 0)
      );
      expect(result.centerX).toBe(5 * SHEET_UNITS_TO_PIXELS);
      expect(result.centerY).toBe(0);
    });

    it('diagonal line - center is midpoint', () => {
      const result = computeLineSpriteTransform(
        new SheetPosition(2, 3),
        new SheetPosition(10, 7)
      );
      expect(result.centerX).toBe((2 + 10) / 2 * SHEET_UNITS_TO_PIXELS);
      expect(result.centerY).toBe((3 + 7) / 2 * SHEET_UNITS_TO_PIXELS);
    });
  });

  describe('length is always positive and symmetric', () => {
    it('length is computed correctly for horizontal line', () => {
      const result = computeLineSpriteTransform(
        new SheetPosition(0, 0),
        new SheetPosition(10, 0)
      );
      expect(result.length).toBe(10 * SHEET_UNITS_TO_PIXELS);
    });

    it('length is the same regardless of point order', () => {
      const result1 = computeLineSpriteTransform(
        new SheetPosition(0, 0),
        new SheetPosition(10, 10)
      );
      const result2 = computeLineSpriteTransform(
        new SheetPosition(10, 10),
        new SheetPosition(0, 0)
      );
      expect(result1.length).toBe(result2.length);
    });
  });

  describe('angle from atan2(dy, dx) - this is the standard approach', () => {
    it('horizontal line going right: atan2(0, positive) = 0', () => {
      const result = computeLineSpriteTransform(
        new SheetPosition(0, 0),
        new SheetPosition(10, 0)
      );
      expect(result.angleDegrees).toBe(0);
    });

    it('horizontal line going left: atan2(0, negative) = 180', () => {
      const result = computeLineSpriteTransform(
        new SheetPosition(10, 0),
        new SheetPosition(0, 0)
      );
      expect(result.angleDegrees).toBe(180);
    });

    it('vertical line going down: atan2(positive, 0) = 90', () => {
      const result = computeLineSpriteTransform(
        new SheetPosition(0, 0),
        new SheetPosition(0, 10)
      );
      expect(result.angleDegrees).toBe(90);
    });

    it('vertical line going up: atan2(negative, 0) = -90', () => {
      const result = computeLineSpriteTransform(
        new SheetPosition(0, 10),
        new SheetPosition(0, 0)
      );
      expect(result.angleDegrees).toBe(-90);
    });

    it('diagonal down-right: atan2(positive, positive) gives 0 < angle < 90', () => {
      const result = computeLineSpriteTransform(
        new SheetPosition(0, 0),
        new SheetPosition(10, 10)
      );
      expect(result.angleDegrees).toBeGreaterThan(0);
      expect(result.angleDegrees).toBeLessThan(90);
      expect(result.angleDegrees).toBeCloseTo(45, 5);
    });

    it('diagonal up-right: atan2(negative, positive) gives -90 < angle < 0', () => {
      const result = computeLineSpriteTransform(
        new SheetPosition(0, 10),
        new SheetPosition(10, 0)
      );
      expect(result.angleDegrees).toBeGreaterThan(-90);
      expect(result.angleDegrees).toBeLessThan(0);
      expect(result.angleDegrees).toBeCloseTo(-45, 5);
    });
  });

  describe('PixiJS rotation convention compatibility', () => {
    it('atan2 angle should work directly with PixiJS sprite angle property', () => {
      const result = computeLineSpriteTransform(
        new SheetPosition(0, 0),
        new SheetPosition(10, 0)
      );
      // PixiJS uses degrees clockwise for angle
      // atan2(0, 10) = 0, which in PixiJS means no rotation (pointing right)
      // This is the standard convention
      expect(result.angleDegrees).toBe(0);
    });

    it('vertical line gives 90 degrees', () => {
      const result = computeLineSpriteTransform(
        new SheetPosition(0, 0),
        new SheetPosition(0, 10)
      );
      // atan2(10, 0) = 90 degrees
      expect(result.angleDegrees).toBe(90);
    });
  });
});
