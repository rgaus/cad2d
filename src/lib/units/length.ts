import { round } from "../math";

/** Runtime type symbol for InchesLength. */
export const InchesType = Symbol('inches');
/** Runtime type symbol for FeetLength. */
export const FeetType = Symbol('feet');
/** Runtime type symbol for MillimetersLength. */
export const MillimetersType = Symbol('millimeters');
/** Runtime type symbol for CentimetersLength. */
export const CentimetersType = Symbol('centimeters');
/** Runtime type symbol for MetersLength. */
export const MetersType = Symbol('meters');

const INCHES_TO_METERS = 0.0254;
const FEET_TO_METERS = 0.3048;
const MILLIMETERS_TO_METERS = 0.001;
const CENTIMETERS_TO_METERS = 0.01;

/** Supported sheet unit types. */
export const UNITS = ['in', 'ft', 'mm', 'cm', 'm'] as const;
export type UnitType = typeof UNITS[number];

/** Converts inches to centimeters. */
export const INCHES_TO_CENTIMETERS = INCHES_TO_METERS * 100;

/** Interface for length values with unit conversion and display support. */
abstract class Length {
  readonly abstract type: symbol;
  readonly magnitude: number;

  constructor(magnitude: number) {
    this.magnitude = magnitude;
  }

  abstract toInches(): InchesLength;
  abstract toFeet(): FeetLength;
  abstract toMillimeters(): MillimetersLength;
  abstract toCentimeters(): CentimetersLength;
  abstract toMeters(): MetersLength;

  /** Converts this length into the default unit of the given sheet. */
  toSheetUnits(sheetDefaultUnit: UnitType): Length {
    switch (sheetDefaultUnit) {
      case 'm':
        return this.toMeters();
      case 'cm':
        return this.toCentimeters();
      case 'mm':
        return this.toMillimeters();
      case 'in':
        return this.toInches();
      case 'ft':
        return this.toFeet();
    }
  }

  static fromSheetUnits(sheetDefaultUnit: UnitType, magnitude: number): Length {
    switch (sheetDefaultUnit) {
      case 'm':
        return new MetersLength(magnitude);
      case 'cm':
        return new CentimetersLength(magnitude);
      case 'mm':
        return new MillimetersLength(magnitude);
      case 'in':
        return new InchesLength(magnitude);
      case 'ft':
        return new FeetLength(magnitude);
    }
  }

  abstract toDisplayString(): string;
}

class InchesLength extends Length {
  readonly type = InchesType;

  toInches(): InchesLength { return this; }
  toFeet(): FeetLength { return new FeetLength(this.magnitude / 12); }
  toMillimeters(): MillimetersLength { return this.toMeters().toMillimeters(); }
  toCentimeters(): CentimetersLength { return this.toMeters().toCentimeters(); }
  toMeters(): MetersLength { return new MetersLength(this.magnitude * INCHES_TO_METERS); }

  toDisplayString(): string {
    const roundedMagnitude = round(this.magnitude, 3);
    return roundedMagnitude === 1 ? '1 inch' : `${roundedMagnitude} inches`;
  }
}

class FeetLength extends Length {
  readonly type = FeetType;

  toInches(): InchesLength { return new InchesLength(this.magnitude * 12); }
  toFeet(): FeetLength { return this; }
  toMillimeters(): MillimetersLength { return this.toMeters().toMillimeters(); }
  toCentimeters(): CentimetersLength { return this.toMeters().toCentimeters(); }
  toMeters(): MetersLength { return new MetersLength(this.magnitude * FEET_TO_METERS); }
  toDisplayString(): string {
    const roundedMagnitude = round(this.magnitude, 3);
    return roundedMagnitude === 1 ? '1 foot' : `${roundedMagnitude} feet`;
  }
}

class MillimetersLength extends Length {
  readonly type = MillimetersType;

  toInches(): InchesLength { return this.toMeters().toInches(); }
  toFeet(): FeetLength { return this.toMeters().toFeet(); }
  toMillimeters(): MillimetersLength { return this; }
  toCentimeters(): CentimetersLength { return new CentimetersLength(this.magnitude / 10); }
  toMeters(): MetersLength { return new MetersLength(this.magnitude * MILLIMETERS_TO_METERS); }
  toDisplayString(): string {
    const roundedMagnitude = round(this.magnitude, 2);
    return roundedMagnitude === 1 ? '1 mm' : `${roundedMagnitude} mm`;
  }
}

class CentimetersLength extends Length {
  readonly type = CentimetersType;

  toInches(): InchesLength { return this.toMeters().toInches(); }
  toFeet(): FeetLength { return this.toMeters().toFeet(); }
  toMillimeters(): MillimetersLength { return new MillimetersLength(this.magnitude * 10); }
  toCentimeters(): CentimetersLength { return this; }
  toMeters(): MetersLength { return new MetersLength(this.magnitude * CENTIMETERS_TO_METERS); }
  toDisplayString(): string {
    const roundedMagnitude = round(this.magnitude, 3);
    return roundedMagnitude === 1 ? '1 cm' : `${roundedMagnitude} cms`;
  }
}

class MetersLength extends Length {
  readonly type = MetersType;

  toInches(): InchesLength { return new InchesLength(this.magnitude / INCHES_TO_METERS); }
  toFeet(): FeetLength { return new FeetLength(this.magnitude / FEET_TO_METERS); }
  toMillimeters(): MillimetersLength { return new MillimetersLength(this.magnitude / MILLIMETERS_TO_METERS); }
  toCentimeters(): CentimetersLength { return new CentimetersLength(this.magnitude / CENTIMETERS_TO_METERS); }
  toMeters(): MetersLength { return this; }
  toDisplayString(): string {
    const roundedMagnitude = round(this.magnitude, 3);
    return roundedMagnitude === 1 ? '1 meter' : `${roundedMagnitude} meters`;
  }
}

/** Factory for creating Length values in various units. */
const Lengths = {
  inches: (magnitude: number): InchesLength => new InchesLength(magnitude),
  feet: (magnitude: number): FeetLength => new FeetLength(magnitude),
  mm: (magnitude: number): MillimetersLength => new MillimetersLength(magnitude),
  centimeters: (magnitude: number): CentimetersLength => new CentimetersLength(magnitude),
  meters: (magnitude: number): MetersLength => new MetersLength(magnitude),
};

export { Length, Lengths, InchesLength, FeetLength, MillimetersLength, CentimetersLength, MetersLength };
