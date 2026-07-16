import { Angle as MathAngle, round } from '@/lib/math';

/** Supported sheet angle types. */
export type AngleType = 'degrees' | 'radians';

/** Runtime type symbol for DegreesAngle. */
export const DegreesType = Symbol('degrees');
/** Runtime type symbol for RadiansAngle. */
export const RadiansType = Symbol('radians');

/** Interface for angle values with unit conversion betweed degrees + radians and display support. */
export abstract class Angle {
  abstract readonly type: symbol;
  readonly magnitude: number;

  constructor(magnitude: number) {
    this.magnitude = magnitude;
  }

  abstract toDegrees(): DegreesAngle;
  abstract toRadians(): RadiansAngle;

  /** Converts this length into the default unit of the given sheet. */
  toSheetUnits(sheetAngleUnit: AngleType): Angle {
    switch (sheetAngleUnit) {
      case 'degrees':
        return this.toDegrees();
      case 'radians':
        return this.toRadians();
    }
  }

  static fromSheetUnits(sheetAngleUnit: AngleType, magnitude: number): Angle {
    switch (sheetAngleUnit) {
      case 'degrees':
        return new DegreesAngle(magnitude);
      case 'radians':
        return new RadiansAngle(magnitude);
    }
  }

  abstract toDisplayString(places?: number): string;

  static degrees(magnitude: number) {
    return new DegreesAngle(magnitude);
  }
  static radians(magnitude: number) {
    return new RadiansAngle(magnitude);
  }
}

export class DegreesAngle extends Angle {
  readonly type = DegreesType;

  toDegrees(): DegreesAngle {
    return this;
  }
  toRadians(): RadiansAngle {
    return new RadiansAngle(MathAngle.toRadians(this.magnitude));
  }

  toDisplayString(places?: number): string {
    const roundedMagnitude = round(this.magnitude, places ?? 3);
    return `${roundedMagnitude} deg`;
  }
}

export class RadiansAngle extends Angle {
  readonly type = RadiansType;

  toRadians(): RadiansAngle {
    return this;
  }
  toDegrees(): DegreesAngle {
    return new DegreesAngle(MathAngle.toDegrees(this.magnitude));
  }

  toDisplayString(places?: number): string {
    const roundedMagnitude = round(this.magnitude, places ?? 3);
    return `${roundedMagnitude} rad`;
  }
}
