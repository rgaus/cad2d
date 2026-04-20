import { CentimetersLength, Length } from '../units/length';

/** Conversion factor: centimeters to pixels. */
export const CM_TO_PIXELS = 16;

/** Standard A4 sheet width in centimeters. */
export const SHEET_A4_WIDTH_CM = 21;
/** Standard A4 sheet height in centimeters. */
export const SHEET_A4_HEIGHT_CM = 29.7;

/** A sheet with width and height dimensions. */
export type Sheet = {
  readonly width: Length;
  readonly height: Length;
};

/** Factory for creating and modifying Sheet values. */
const Sheets = {
  /** Creates a standard A4 sheet (21cm x 29.7cm). */
  a4(): Sheet {
    return {
      width: new CentimetersLength(SHEET_A4_WIDTH_CM),
      height: new CentimetersLength(SHEET_A4_HEIGHT_CM),
    };
  },

  /** Returns a new Sheet with the width replaced. */
  updateWidth(sheet: Sheet, newWidth: Length): Sheet {
    return {
      width: newWidth,
      height: sheet.height,
    };
  },

  /** Returns a new Sheet with the height replaced. */
  updateHeight(sheet: Sheet, newHeight: Length): Sheet {
    return {
      width: sheet.width,
      height: newHeight,
    };
  },
};

export { Sheets };