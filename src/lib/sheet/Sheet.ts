import EventEmitter from 'eventemitter3';
import { GeometryStore } from '@/lib/geometry/GeometryStore';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { Length, type UnitType } from '@/lib/units/length';

/** Conversion factor: default sheet units to pixels. */
export const SHEET_UNITS_TO_PIXELS = 64;

const SHEET_DEFAULT_UNIT_PLACES = 3;

/** Unit family for grid rendering purposes. */
export type UnitFamily = 'metric' | 'sae';

/** Returns the unit family (metric or sae) for a given unit. */
export function computeUnitFamilyFromUnit(unit: UnitType): UnitFamily {
  return unit === 'in' || unit === 'ft' ? 'sae' : 'metric';
}

/** Specification for a standard sheet size preset. */
export type SheetSizePreset = {
  /** Width magnitude in the defaultUnit. */
  width: number;
  /** Height magnitude in the defaultUnit. */
  height: number;
  /** The default unit for this sheet size. */
  defaultUnit: UnitType;
  /** Human-readable label (e.g. "A4", "Letter"). */
  label: string;
};

export namespace SheetSizePreset {
  /** Returns true if the sheet's current dimensions and default unit match this spec. */
  export function matches(spec: SheetSizePreset, sheet: Sheet): 'portait' | 'landscape' | null {
    const widthMag = sheet.width.toSheetUnits(spec.defaultUnit).magnitude;
    const heightMag = sheet.height.toSheetUnits(spec.defaultUnit).magnitude;
    if (Math.abs(widthMag - spec.width) < 0.01 && Math.abs(heightMag - spec.height) < 0.01) {
      return 'portait';
    }
    if (Math.abs(heightMag - spec.width) < 0.01 && Math.abs(widthMag - spec.height) < 0.01) {
      return 'landscape';
    }
    return null;
  }
}

/** Standard sheet size presets. A-series in cm, US sizes in inches. */
export const SHEET_SIZE_PRESETS = {
  letter: { width: 8.5, height: 11, defaultUnit: 'in' as const, label: 'Letter' },
  a4: { width: 21.0, height: 29.7, defaultUnit: 'cm' as const, label: 'A4' },
  a1: { width: 59.4, height: 84.1, defaultUnit: 'cm' as const, label: 'A1' },
  a2: { width: 42.0, height: 59.4, defaultUnit: 'cm' as const, label: 'A2' },
  a3: { width: 29.7, height: 42.0, defaultUnit: 'cm' as const, label: 'A3' },
  a5: { width: 14.8, height: 21.0, defaultUnit: 'cm' as const, label: 'A5' },
  a6: { width: 10.5, height: 14.8, defaultUnit: 'cm' as const, label: 'A6' },
  a7: { width: 7.4, height: 10.5, defaultUnit: 'cm' as const, label: 'A7' },
  a8: { width: 5.2, height: 7.4, defaultUnit: 'cm' as const, label: 'A8' },
  legal: { width: 8.5, height: 14, defaultUnit: 'in' as const, label: 'Legal' },
  tabloid: { width: 11, height: 17, defaultUnit: 'in' as const, label: 'Tabloid' },
} as const;

export type SheetSizePresetKey = keyof typeof SHEET_SIZE_PRESETS;

/** Events emitted by Sheet. */
export type SheetEvents = {
  widthChange: (width: Length) => void;
  heightChange: (height: Length) => void;
  defaultUnitChange: (unit: UnitType) => void;
  defaultUnitFamilyChange: (family: UnitFamily) => void;
  unitPlacesChanged: (places: number) => void;
  dcelDebugViewChange: (value: boolean) => void;
};

/**
 * A sheet with dimensions and geometry storage.
 * Emits events when width, height, defaultUnit, or defaultUnitFamily changes.
 */
export class Sheet extends EventEmitter<SheetEvents> {
  width: Length;
  height: Length;
  geometryStore: GeometryStore;
  historyManager: HistoryManager;

  defaultUnit: UnitType;
  defaultUnitFamily: UnitFamily;

  /**
   * The number of decimal places / signifigant figures used when representing unit measurements.
   *
   * Potentially unexpected places this is used:
   * 1. Used to determine finest possible sheet grid resolution (at very course values, this can be noticable)
   */
  unitPlaces: number = SHEET_DEFAULT_UNIT_PLACES;

  /** When enabled, renders the {@link DCELDebugRenderer}. */
  dcelDebugView: boolean;

  private constructor(args: { width: Length; height: Length; defaultUnit: UnitType }) {
    super();

    this.width = args.width;
    this.height = args.height;
    this.defaultUnit = args.defaultUnit;
    this.defaultUnitFamily = computeUnitFamilyFromUnit(args.defaultUnit);

    this.dcelDebugView = globalThis?.localStorage
      ? globalThis?.localStorage.getItem('cad2d-dcel-debug-view') === 'true'
      : false;

    const historyManager = new HistoryManager();
    const geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
    this.geometryStore = geometryStore;
    this.historyManager = historyManager;
  }

  private static makeSheetPresetConstructor(key: SheetSizePresetKey): () => Sheet {
    return () => {
      const spec = SHEET_SIZE_PRESETS[key];
      return new Sheet({
        width: Length.fromSheetUnits(spec.defaultUnit, spec.width),
        height: Length.fromSheetUnits(spec.defaultUnit, spec.height),
        defaultUnit: spec.defaultUnit,
      });
    };
  }

  /** Creates a standard A4 sheet. */
  static a4 = this.makeSheetPresetConstructor('a4');

  /** Creates a standard A1 sheet. */
  static a1 = this.makeSheetPresetConstructor('a1');

  /** Creates a standard A2 sheet. */
  static a2 = this.makeSheetPresetConstructor('a2');

  /** Creates a standard A3 sheet. */
  static a3 = this.makeSheetPresetConstructor('a3');

  /** Creates a standard A5 sheet. */
  static a5 = this.makeSheetPresetConstructor('a5');

  /** Creates a standard A6 sheet. */
  static a6 = this.makeSheetPresetConstructor('a6');

  /** Creates a standard A7 sheet. */
  static a7 = this.makeSheetPresetConstructor('a7');

  /** Creates a standard A8 sheet. */
  static a8 = this.makeSheetPresetConstructor('a8');

  /** Creates a standard Letter sheet. */
  static letter = this.makeSheetPresetConstructor('letter');

  /** Creates a standard Legal sheet. */
  static legal = this.makeSheetPresetConstructor('legal');

  /** Creates a standard Tabloid sheet. */
  static tabloid = this.makeSheetPresetConstructor('tabloid');

  /** Updates the sheet dimensions and default unit to match the given size preset. */
  updateSizePreset(
    sizeKey: SheetSizePresetKey,
    orientation: 'portait' | 'landscape' = 'portait',
  ): void {
    const spec = SHEET_SIZE_PRESETS[sizeKey];
    const newWidth = Length.fromSheetUnits(
      spec.defaultUnit,
      orientation === 'portait' ? spec.width : spec.height,
    );
    const newHeight = Length.fromSheetUnits(
      spec.defaultUnit,
      orientation === 'portait' ? spec.height : spec.width,
    );
    this.updateWidth(newWidth);
    this.updateHeight(newHeight);
    if (this.defaultUnit !== spec.defaultUnit) {
      this.updateDefaultUnit(spec.defaultUnit);
    }
  }

  updateWidth(newWidth: Length): void {
    this.width = newWidth;
    this.emit('widthChange', newWidth);
  }

  updateHeight(newHeight: Length): void {
    this.height = newHeight;
    this.emit('heightChange', newHeight);
  }

  updateDefaultUnit(unit: UnitType): void {
    this.defaultUnit = unit;
    const newFamily = computeUnitFamilyFromUnit(unit);
    const familyChanged = newFamily !== this.defaultUnitFamily;
    this.defaultUnitFamily = newFamily;
    this.emit('defaultUnitChange', unit);
    if (familyChanged) {
      this.emit('defaultUnitFamilyChange', newFamily);
    }
  }

  updateUnitPlaces(unitPlaces: number): void {
    const unitPlacesChanged = unitPlaces !== this.unitPlaces;
    this.unitPlaces = unitPlaces;
    if (unitPlacesChanged) {
      this.emit('unitPlacesChanged', this.unitPlaces);
    }
  }

  updateDcelDebugView(value: boolean) {
    this.dcelDebugView = value;
    localStorage?.setItem('cad2d-dcel-debug-view', this.dcelDebugView ? 'true' : 'false');
    this.emit('dcelDebugViewChange', this.dcelDebugView);
  }
}
