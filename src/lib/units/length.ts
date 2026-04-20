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

/** Interface for length values with unit conversion and display support. */
interface Length {
  readonly type: symbol;
  readonly magnitude: number;

  toInches(): InchesLength;
  toFeet(): FeetLength;
  toMillimeters(): MillimetersLength;
  toCentimeters(): CentimetersLength;
  toMeters(): MetersLength;

  toDisplayString(): string;
}

class InchesLength implements Length {
  readonly type = InchesType;
  readonly magnitude: number;
  constructor(magnitude: number) {
    this.magnitude = magnitude;
  }

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

class FeetLength implements Length {
  readonly type = FeetType;
  readonly magnitude: number;
  constructor(magnitude: number) {
    this.magnitude = magnitude;
  }

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

class MillimetersLength implements Length {
  readonly type = MillimetersType;
  readonly magnitude: number;
  constructor(magnitude: number) {
    this.magnitude = magnitude;
  }

  toInches(): InchesLength { return this.toMeters().toInches(); }
  toFeet(): FeetLength { return this.toMeters().toFeet(); }
  toMillimeters(): MillimetersLength { return this; }
  toCentimeters(): CentimetersLength { return new CentimetersLength(this.magnitude / 10); }
  toMeters(): MetersLength { return new MetersLength(this.magnitude * MILLIMETERS_TO_METERS); }
  toDisplayString(): string {
    const roundedMagnitude = round(this.magnitude, 1);
    return roundedMagnitude === 1 ? '1 mm' : `${roundedMagnitude} mm`;
  }
}

class CentimetersLength implements Length {
  readonly type = CentimetersType;
  readonly magnitude: number;
  constructor(magnitude: number) {
    this.magnitude = magnitude;
  }

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

class MetersLength implements Length {
  readonly type = MetersType;
  readonly magnitude: number;
  constructor(magnitude: number) {
    this.magnitude = magnitude;
  }

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

export { Lengths, InchesLength, FeetLength, MillimetersLength, CentimetersLength, MetersLength };
export type { Length };
