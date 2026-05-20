import EventEmitter from 'eventemitter3';
import { CentimetersLength, Length, type UnitType } from '../units/length';
import { GeometryStore } from '../tools/GeometryStore';
import { HistoryManager } from '../history/HistoryManager';

/** Conversion factor: default sheet units to pixels. */
export const SHEET_UNITS_TO_PIXELS = 64;

/** Standard A4 sheet width in centimeters. */
const SHEET_A4_WIDTH_CM = 21;
/** Standard A4 sheet height in centimeters. */
const SHEET_A4_HEIGHT_CM = 29.7;

/** Unit family for grid rendering purposes. */
export type UnitFamily = 'metric' | 'sae';

/** Events emitted by Sheet. */
export type SheetEvents = {
  widthChange: (width: Length) => void;
  heightChange: (height: Length) => void;
  defaultUnitChange: (unit: UnitType) => void;
};

/**
 * A sheet with dimensions and geometry storage.
 * Emits events when width, height, or defaultUnit changes.
 */
export class Sheet extends EventEmitter<SheetEvents> {
  width!: Length;
  height!: Length;
  geometryStore!: GeometryStore;
  historyManager!: HistoryManager;
  defaultUnit!: UnitType;

  private constructor(args: { width: Length, height: Length, defaultUnit: UnitType }) {
    super();

    this.width = args.width;
    this.height = args.height;
    this.defaultUnit = args.defaultUnit;

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
    this.emit('defaultUnitChange', unit);

    // // Convert width and height to the new default unit
    // // FIXME: is this a good idea? I'm not sure.
    // this.width = this.width.toSheetUnits(this.defaultUnit);
    // this.height = this.height.toSheetUnits(this.defaultUnit);
    // this.emit('widthChange', this.width);
    // this.emit('heightChange', this.height);
  }

  /** Returns the unit family (metric or sae) for a given default unit. */
  static getDefaultUnitFamily(defaultUnit: UnitType): UnitFamily {
    return defaultUnit === 'in' || defaultUnit === 'ft' ? 'sae' : 'metric';
  }
}
