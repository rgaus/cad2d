import { Length, CentimetersLength } from '../units/length';

export const CM_TO_PIXELS = 16;

export const SHEET_A4_WIDTH_CM = 21;
export const SHEET_A4_HEIGHT_CM = 29.7;

class Sheet {
  constructor(config: { width: Length; height: Length }) {
    this.width = config.width;
    this.height = config.height;
  }

  readonly width: Length;
  readonly height: Length;

  widthInCentimeters(): CentimetersLength {
    return this.width.toCentimeters();
  }

  heightInCentimeters(): CentimetersLength {
    return this.height.toCentimeters();
  }
}

export { Sheet };