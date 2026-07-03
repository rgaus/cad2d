import { Sheet, computeUnitFamilyFromUnit } from '../lib/sheet/Sheet';

describe('Sheet', () => {
  describe('a4', () => {
    it('creates a sheet with default unit cm', () => {
      const sheet = Sheet.a4();
      expect(sheet.defaultUnit).toBe('cm');
    });

    it('creates a sheet with width and height in centimeters', () => {
      const sheet = Sheet.a4();
      expect(sheet.width.toCentimeters().magnitude).toBeCloseTo(21, 5);
      expect(sheet.height.toCentimeters().magnitude).toBeCloseTo(29.7, 5);
    });

    it('creates a sheet with defaultUnitFamily metric', () => {
      const sheet = Sheet.a4();
      expect(sheet.defaultUnitFamily).toBe('metric');
    });
  });

  describe('updateDefaultUnit', () => {
    it('updates the default unit', () => {
      const sheet = Sheet.a4();
      sheet.updateDefaultUnit('in');
      expect(sheet.defaultUnit).toBe('in');
    });

    it('preserves width, height, geometryStore, and historyManager', () => {
      const sheet = Sheet.a4();
      const geometryStore = sheet.geometryStore;
      const historyManager = sheet.historyManager;
      sheet.updateDefaultUnit('in');
      expect(sheet.width).toBe(sheet.width);
      expect(sheet.height).toBe(sheet.height);
      expect(sheet.geometryStore).toBe(geometryStore);
      expect(sheet.historyManager).toBe(historyManager);
    });

    it('emits defaultUnitChange event', () => {
      const sheet = Sheet.a4();
      const handler = jest.fn();
      sheet.on('defaultUnitChange', handler);
      sheet.updateDefaultUnit('in');
      expect(handler).toHaveBeenCalledWith('in');
    });

    it('emits defaultUnitFamilyChange when unit family changes', () => {
      const sheet = Sheet.a4();
      const handler = jest.fn();
      sheet.on('defaultUnitFamilyChange', handler);
      sheet.updateDefaultUnit('in');
      expect(handler).toHaveBeenCalledWith('sae');
    });

    it('does not emit defaultUnitFamilyChange when unit family stays same', () => {
      const sheet = Sheet.a4();
      const handler = jest.fn();
      sheet.on('defaultUnitFamilyChange', handler);
      sheet.updateDefaultUnit('mm');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('computeUnitFamilyFromUnit', () => {
    it('returns metric for cm', () => {
      expect(computeUnitFamilyFromUnit('cm')).toBe('metric');
    });

    it('returns metric for mm', () => {
      expect(computeUnitFamilyFromUnit('mm')).toBe('metric');
    });

    it('returns metric for m', () => {
      expect(computeUnitFamilyFromUnit('m')).toBe('metric');
    });

    it('returns sae for in', () => {
      expect(computeUnitFamilyFromUnit('in')).toBe('sae');
    });

    it('returns sae for ft', () => {
      expect(computeUnitFamilyFromUnit('ft')).toBe('sae');
    });
  });

  describe('unitPlaces', () => {
    it('updates the default unit', () => {
      const sheet = Sheet.a4();
      sheet.updateUnitPlaces(10);
      expect(sheet.unitPlaces).toBe(10);
    });

    it('emits unitPlacesChanged event', () => {
      const sheet = Sheet.a4();
      const handler = jest.fn();
      sheet.on('unitPlacesChanged', handler);
      sheet.updateUnitPlaces(7);
      expect(handler).toHaveBeenCalledWith(7);
    });
  });

  describe('epsilon', () => {
    it('returns 0.1 when unitPlaces is 1', () => {
      const sheet = Sheet.a4();
      sheet.updateUnitPlaces(1);
      expect(sheet.epsilon).toBe(0.1);
    });

    it('returns 0.01 when unitPlaces is 2', () => {
      const sheet = Sheet.a4();
      sheet.updateUnitPlaces(2);
      expect(sheet.epsilon).toBe(0.01);
    });

    it('returns 0.001 when unitPlaces is 3 (matches the 0.001 lower bound)', () => {
      const sheet = Sheet.a4();
      sheet.updateUnitPlaces(3);
      expect(sheet.epsilon).toBe(0.001);
    });

    it('clamps to the 0.001 lower bound when unitPlaces is 4', () => {
      const sheet = Sheet.a4();
      sheet.updateUnitPlaces(4);
      expect(sheet.epsilon).toBe(0.001);
    });

    it('clamps to the 0.001 lower bound when unitPlaces is 5', () => {
      const sheet = Sheet.a4();
      sheet.updateUnitPlaces(5);
      expect(sheet.epsilon).toBe(0.001);
    });

    it('uses the default unitPlaces (3) when not explicitly changed', () => {
      const sheet = Sheet.a4();
      expect(sheet.epsilon).toBe(0.001);
    });

    it('reflects changes to unitPlaces automatically', () => {
      const sheet = Sheet.a4();
      expect(sheet.epsilon).toBe(0.001);
      sheet.updateUnitPlaces(2);
      expect(sheet.epsilon).toBeCloseTo(0.01, 10);
      sheet.updateUnitPlaces(3);
      expect(sheet.epsilon).toBe(0.001);
    });
  });
});
