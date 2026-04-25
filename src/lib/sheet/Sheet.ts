import { CentimetersLength, Length, type UnitType } from '../units/length';
import { GeometryStore } from '../tools/GeometryStore';
import { HistoryManager } from '../history/HistoryManager';

/** Conversion factor: default sheet units to pixels. */
export const SHEET_UNITS_TO_PIXELS = 64;

/** Standard A4 sheet width in centimeters. */
export const SHEET_A4_WIDTH_CM = 21;
/** Standard A4 sheet height in centimeters. */
export const SHEET_A4_HEIGHT_CM = 29.7;

/** Unit family for grid rendering purposes. */
export type UnitFamily = 'metric' | 'sae';

/** A sheet with dimensions and geometry storage. */
export type Sheet = {
  readonly width: Length;
  readonly height: Length;
  readonly geometryStore: GeometryStore;
  readonly historyManager: HistoryManager;
  readonly defaultUnit: UnitType;
};

/** Factory for creating and modifying Sheet values. */
const Sheets = {
  /** Creates a standard A4 sheet (21cm x 29.7cm) with a GeometryStore wired to a HistoryManager. */
  a4(): Sheet {
    const historyManager = new HistoryManager();
    const geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
    return {
      width: new CentimetersLength(SHEET_A4_WIDTH_CM),
      height: new CentimetersLength(SHEET_A4_HEIGHT_CM),
      geometryStore,
      historyManager,
      defaultUnit: 'cm',
    };
  },

  /** Returns a new Sheet with the width replaced. */
  updateWidth(sheet: Sheet, newWidth: Length): Sheet {
    return {
      width: newWidth,
      height: sheet.height,
      geometryStore: sheet.geometryStore,
      historyManager: sheet.historyManager,
      defaultUnit: sheet.defaultUnit,
    };
  },

  /** Returns a new Sheet with the height replaced. */
  updateHeight(sheet: Sheet, newHeight: Length): Sheet {
    return {
      width: sheet.width,
      height: newHeight,
      geometryStore: sheet.geometryStore,
      historyManager: sheet.historyManager,
      defaultUnit: sheet.defaultUnit,
    };
  },

  /** Returns a new Sheet with the default unit replaced. */
  updateDefaultUnit(sheet: Sheet, unit: UnitType): Sheet {
    return {
      width: sheet.width,
      height: sheet.height,
      geometryStore: sheet.geometryStore,
      historyManager: sheet.historyManager,
      defaultUnit: unit,
    };
  },

  /** Returns the unit family (metric or sae) for a given sheet. */
  getDefaultUnitFamily(sheet: Sheet): UnitFamily {
    return sheet.defaultUnit === 'in' || sheet.defaultUnit === 'ft' ? 'sae' : 'metric';
  },
};

export { Sheets };
