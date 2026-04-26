import { Sheets } from '../lib/sheet/Sheet';

describe('Sheets', () => {
  describe('a4', () => {
    it('creates a sheet with default unit cm', () => {
      const sheet = Sheets.a4();
      expect(sheet.defaultUnit).toBe('cm');
    });

    it('creates a sheet with width and height in centimeters', () => {
      const sheet = Sheets.a4();
      expect(sheet.width.toCentimeters().magnitude).toBeCloseTo(21, 5);
      expect(sheet.height.toCentimeters().magnitude).toBeCloseTo(29.7, 5);
    });
  });

  describe('updateDefaultUnit', () => {
    it('returns a new sheet with updated default unit', () => {
      const sheet = Sheets.a4();
      const updated = Sheets.updateDefaultUnit(sheet, 'in');
      expect(updated.defaultUnit).toBe('in');
      expect(sheet.defaultUnit).toBe('cm');
    });

    it('preserves width, height, polygonStore, and historyManager', () => {
      const sheet = Sheets.a4();
      const updated = Sheets.updateDefaultUnit(sheet, 'in');
      expect(updated.width).toBe(sheet.width);
      expect(updated.height).toBe(sheet.height);
      expect(updated.geometryStore).toBe(sheet.geometryStore);
      expect(updated.historyManager).toBe(sheet.historyManager);
    });
  });

  describe('getDefaultUnitFamily', () => {
    it('returns metric for cm', () => {
      const sheet = Sheets.a4();
      expect(Sheets.getDefaultUnitFamily(sheet)).toBe('metric');
    });

    it('returns metric for mm', () => {
      const sheet = Sheets.updateDefaultUnit(Sheets.a4(), 'mm');
      expect(Sheets.getDefaultUnitFamily(sheet)).toBe('metric');
    });

    it('returns metric for m', () => {
      const sheet = Sheets.updateDefaultUnit(Sheets.a4(), 'm');
      expect(Sheets.getDefaultUnitFamily(sheet)).toBe('metric');
    });

    it('returns sae for in', () => {
      const sheet = Sheets.updateDefaultUnit(Sheets.a4(), 'in');
      expect(Sheets.getDefaultUnitFamily(sheet)).toBe('sae');
    });

    it('returns sae for ft', () => {
      const sheet = Sheets.updateDefaultUnit(Sheets.a4(), 'ft');
      expect(Sheets.getDefaultUnitFamily(sheet)).toBe('sae');
    });
  });
});
