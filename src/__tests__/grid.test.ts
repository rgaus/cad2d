import { getGridAtScale } from '../lib/viewport/grid';

describe('getGridAtScale', () => {
  describe('grid stops at various zoom levels', () => {
    it('should use 50cm grid at very low zoom (0.016x)', () => {
      const grid = getGridAtScale(0.016);
      expect(grid.primarySheetUnits).toBe(50);
      expect(grid.secondarySheetUnits).toBe(10);
      expect(grid.primaryPx).toBeCloseTo(51.2, 1);
    });

    it('should use 20cm grid at 0.03125x zoom', () => {
      const grid = getGridAtScale(0.03125);
      expect(grid.primarySheetUnits).toBe(20);
      expect(grid.secondarySheetUnits).toBe(5);
      expect(grid.primaryPx).toBeCloseTo(40, 0);
    });

    it('should use 20cm grid at 0.0625x zoom', () => {
      const grid = getGridAtScale(0.0625);
      expect(grid.primarySheetUnits).toBe(20);
      expect(grid.secondarySheetUnits).toBe(5);
      expect(grid.primaryPx).toBeCloseTo(80, 0);
    });

    it('should use 10cm grid at 0.125x zoom', () => {
      const grid = getGridAtScale(0.125);
      expect(grid.primarySheetUnits).toBe(10);
      expect(grid.secondarySheetUnits).toBe(2);
      expect(grid.primaryPx).toBeCloseTo(80, 0);
    });

    it('should use 5cm grid at 0.25x zoom', () => {
      const grid = getGridAtScale(0.25);
      expect(grid.primarySheetUnits).toBe(5);
      expect(grid.secondarySheetUnits).toBe(1);
      expect(grid.primaryPx).toBeCloseTo(80, 0);
    });

    it('should use 2cm grid at 0.5x zoom', () => {
      const grid = getGridAtScale(0.5);
      expect(grid.primarySheetUnits).toBe(2);
      expect(grid.secondarySheetUnits).toBe(0.5);
      expect(grid.primaryPx).toBeCloseTo(64, 0);
    });

    it('should use 1cm grid at 1x zoom', () => {
      const grid = getGridAtScale(1);
      expect(grid.primarySheetUnits).toBe(1);
      expect(grid.secondarySheetUnits).toBe(0.2);
      expect(grid.primaryPx).toBeCloseTo(64, 0);
      expect(grid.secondaryPx).toBeCloseTo(12.8, 1);
    });

    it('should use 0.5cm grid at 2x zoom', () => {
      const grid = getGridAtScale(2);
      expect(grid.primarySheetUnits).toBe(0.5);
      expect(grid.secondarySheetUnits).toBe(0.1);
      expect(grid.primaryPx).toBeCloseTo(64, 0);
    });

    it('should use 0.2cm grid at 4x zoom', () => {
      const grid = getGridAtScale(4);
      expect(grid.primarySheetUnits).toBe(0.2);
      expect(grid.secondarySheetUnits).toBe(0.05);
      expect(grid.primaryPx).toBeCloseTo(51.2, 1);
    });

    it('should use 0.1cm grid at 8x zoom', () => {
      const grid = getGridAtScale(8);
      expect(grid.primarySheetUnits).toBe(0.1);
      expect(grid.secondarySheetUnits).toBe(0.02);
      expect(grid.primaryPx).toBeCloseTo(51.2, 1);
    });

    it('should use 0.05cm grid at 16x zoom', () => {
      const grid = getGridAtScale(16);
      expect(grid.primarySheetUnits).toBe(0.05);
      expect(grid.secondarySheetUnits).toBe(0.01);
      expect(grid.primaryPx).toBeCloseTo(51.2, 1);
    });

    it('should use 0.02cm grid at 32x zoom', () => {
      const grid = getGridAtScale(32);
      expect(grid.primarySheetUnits).toBe(0.02);
      expect(grid.secondarySheetUnits).toBe(0.01);
      expect(grid.primaryPx).toBeCloseTo(40.96, 1);
    });

    it('should use 0.02cm grid at 64x zoom', () => {
      const grid = getGridAtScale(64);
      expect(grid.primarySheetUnits).toBe(0.02);
      expect(grid.secondarySheetUnits).toBe(0.01);
      expect(grid.primaryPx).toBeCloseTo(81.92, 1);
    });
  });

  describe('pixel calculations', () => {
    it('should calculate primaryPx correctly at 1x zoom', () => {
      const grid = getGridAtScale(1);
      expect(grid.primaryPx).toBe(64);
    });
  });
});
