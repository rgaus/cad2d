import { CentimetersLength, Length } from '../units/length';

export const CM_TO_PIXELS = 16;

export const SHEET_A4_WIDTH_CM = 21;
export const SHEET_A4_HEIGHT_CM = 29.7;

export type Sheet = {
  readonly width: Length;
  readonly height: Length;
};

const Sheets = {
  a4(): Sheet {
    return {
      width: new CentimetersLength(SHEET_A4_WIDTH_CM),
      height: new CentimetersLength(SHEET_A4_HEIGHT_CM),
    };
  },

  updateWidth(sheet: Sheet, newWidth: Length): Sheet {
    return {
      width: newWidth,
      height: sheet.height,
    };
  },

  updateHeight(sheet: Sheet, newHeight: Length): Sheet {
    return {
      width: sheet.width,
      height: newHeight,
    };
  },
};

export { Sheets };
