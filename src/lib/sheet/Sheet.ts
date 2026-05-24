import EventEmitter from 'eventemitter3';
import { CentimetersLength, Length, type UnitType } from '@/lib/units/length';
import { GeometryStore } from '@/lib/geometry/GeometryStore';
import { HistoryManager } from '@/lib/history/HistoryManager';

/** Conversion factor: default sheet units to pixels. */
export const SHEET_UNITS_TO_PIXELS = 64;

/** Standard A4 sheet width in centimeters. */
const SHEET_A4_WIDTH_CM = 21;
/** Standard A4 sheet height in centimeters. */
const SHEET_A4_HEIGHT_CM = 29.7;

const SHEET_DEFAULT_UNIT_PLACES = 3;

/** Unit family for grid rendering purposes. */
export type UnitFamily = 'metric' | 'sae';

/** Returns the unit family (metric or sae) for a given unit. */
export function computeUnitFamilyFromUnit(unit: UnitType): UnitFamily {
  return unit === 'in' || unit === 'ft' ? 'sae' : 'metric';
}

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
   */
  unitPlaces: number = SHEET_DEFAULT_UNIT_PLACES;

  /** When enabled, renders the {@link DCELDebugRenderer}. */
  dcelDebugView: boolean;

  private constructor(args: { width: Length, height: Length, defaultUnit: UnitType }) {
    super();

    this.width = args.width;
    this.height = args.height;
    this.defaultUnit = args.defaultUnit;
    this.defaultUnitFamily = computeUnitFamilyFromUnit(args.defaultUnit);

    this.dcelDebugView = globalThis?.localStorage ? globalThis?.localStorage.getItem('cad2d-dcel-debug-view') === 'true' : false;

    const historyManager = new HistoryManager();
    const geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
    this.geometryStore = geometryStore;
    this.historyManager = historyManager;
  }

  /** Creates a standard A4 sheet (21cm x 29.7cm) */
  static a4(): Sheet {
    return new Sheet({
      width: new CentimetersLength(SHEET_A4_WIDTH_CM),
      height: new CentimetersLength(SHEET_A4_HEIGHT_CM),
      defaultUnit: 'cm',
    });
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
    localStorage?.setItem('cad2d-dcel-debug-view', this.dcelDebugView ? 'true' : 'false')
    this.emit('dcelDebugViewChange', this.dcelDebugView);
  }
}
