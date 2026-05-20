import { Sheet } from '../lib/sheet/Sheet';

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
  });

  describe('getDefaultUnitFamily', () => {
    it('returns metric for cm', () => {
      expect(Sheet.getDefaultUnitFamily('cm')).toBe('metric');
    });

    it('returns metric for mm', () => {
      expect(Sheet.getDefaultUnitFamily('mm')).toBe('metric');
    });

    it('returns metric for m', () => {
      expect(Sheet.getDefaultUnitFamily('m')).toBe('metric');
    });

    it('returns sae for in', () => {
      expect(Sheet.getDefaultUnitFamily('in')).toBe('sae');
    });

    it('returns sae for ft', () => {
      expect(Sheet.getDefaultUnitFamily('ft')).toBe('sae');
    });
  });
});