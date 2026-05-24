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

  describe('SAE grid stops', () => {
    it('should use 12in grid at very low zoom (0.016x)', () => {
      const grid = getGridAtScale(0.016, 'sae');
      expect(grid.primarySheetUnits).toBe(12);
      expect(grid.secondarySheetUnits).toBe(6);
      expect(grid.primaryPx).toBeCloseTo(12.288, 2);
    });

    it('should use 1in grid at 1x zoom', () => {
      const grid = getGridAtScale(1, 'sae');
      expect(grid.primarySheetUnits).toBe(1);
      expect(grid.secondarySheetUnits).toBe(0.25);
      expect(grid.primaryPx).toBeCloseTo(64, 0);
      expect(grid.secondaryPx).toBeCloseTo(16, 0);
    });

    it('should use 1/4in grid at 4x zoom', () => {
      const grid = getGridAtScale(4, 'sae');
      expect(grid.primarySheetUnits).toBe(0.25);
      expect(grid.secondarySheetUnits).toBe(0.125);
      expect(grid.primaryPx).toBeCloseTo(64, 0);
    });

    it('should use 1/16in grid at 16x zoom', () => {
      const grid = getGridAtScale(16, 'sae');
      expect(grid.primarySheetUnits).toBe(0.0625);
      expect(grid.secondarySheetUnits).toBe(0.03125);
      expect(grid.primaryPx).toBeCloseTo(64, 0);
    });

    it('should use 1/64in grid at very high zoom', () => {
      const grid = getGridAtScale(64, 'sae');
      expect(grid.primarySheetUnits).toBe(0.015625);
      expect(grid.secondarySheetUnits).toBe(null);
      expect(grid.primaryPx).toBeCloseTo(64, 0);
      expect(grid.secondaryPx).toBe(null);
    });
  });

  describe('minSheetUnits clamping', () => {
    it('clamps to a larger stop when minSheetUnits is above the nearest stop', () => {
      // At 1x zoom the nearest stop is 1cm. With min 3cm, clamp up to 5cm.
      // Secondary (1cm) is below min, so it's nulled.
      const grid = getGridAtScale(1, 'metric', 3);
      expect(grid.primarySheetUnits).toBe(5);
      expect(grid.secondarySheetUnits).toBeNull();
    });

    it('clamps to 0.5cm stop when minSheetUnits is 0.3cm at 4x zoom', () => {
      // At 4x zoom ideal is 0.25, nearest is 0.2cm. With min 0.3cm, clamp up to 0.5cm.
      // Secondary (0.1cm) is below min, so it's nulled.
      const grid = getGridAtScale(4, 'metric', 0.3);
      expect(grid.primarySheetUnits).toBe(0.5);
      expect(grid.secondarySheetUnits).toBeNull();
    });

    it('nulls secondary grid lines when secondary falls below minSheetUnits', () => {
      // At 1x zoom the secondary stop is 0.2cm. With min 0.3cm, secondary should be null.
      const grid = getGridAtScale(1, 'metric', 0.3);
      expect(grid.primarySheetUnits).toBe(1);
      expect(grid.secondarySheetUnits).toBeNull();
      expect(grid.secondaryPx).toBeNull();
    });

    it('clamps to the largest stop when minSheetUnits exceeds all stops', () => {
      const grid = getGridAtScale(1, 'metric', 200);
      expect(grid.primarySheetUnits).toBe(100);
      expect(grid.secondarySheetUnits).toBeNull();
    });

    it('does not clamp when minSheetUnits is 0 (no minimum)', () => {
      const grid = getGridAtScale(1, 'metric', 0);
      expect(grid.primarySheetUnits).toBe(1);
      expect(grid.secondarySheetUnits).toBe(0.2);
    });

    it('does not affect results when minSheetUnits is below the nearest stop', () => {
      // At 1x zoom the nearest is 1cm. min of 0.01cm is well below, so no change.
      const grid = getGridAtScale(1, 'metric', 0.01);
      expect(grid.primarySheetUnits).toBe(1);
      expect(grid.secondarySheetUnits).toBe(0.2);
    });

    it('clamps SAE grid when minSheetUnits is 2 inches at 1x zoom', () => {
      // At 1x zoom the nearest SAE stop is 1in. With min 2in, clamp up to 3in.
      // Secondary (1in) is below min, so it's nulled.
      const grid = getGridAtScale(1, 'sae', 2);
      expect(grid.primarySheetUnits).toBe(3);
      expect(grid.secondarySheetUnits).toBeNull();
    });

    it('nulls SAE secondary when minSheetUnits is 0.3 inches at 1x zoom', () => {
      const grid = getGridAtScale(1, 'sae', 0.3);
      expect(grid.primarySheetUnits).toBe(1);
      expect(grid.secondarySheetUnits).toBeNull();
      expect(grid.secondaryPx).toBeNull();
    });
  });
});
