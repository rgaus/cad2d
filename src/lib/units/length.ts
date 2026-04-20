export const InchesType = Symbol('inches');
export const FeetType = Symbol('feet');
export const MillimetersType = Symbol('millimeters');
export const CentimetersType = Symbol('centimeters');
export const MetersType = Symbol('meters');

const INCHES_TO_METERS = 0.0254;
const FEET_TO_METERS = 0.3048;
const MILLIMETERS_TO_METERS = 0.001;
const CENTIMETERS_TO_METERS = 0.01;

type Length<T> = {
  readonly type: symbol;
  readonly magnitude: number;

  toInches(): InchesLength;
  toFeet(): FeetLength;
  toMillimeters(): MillimetersLength;
  toCentimeters(): CentimetersLength;
  toMeters(): MetersLength;

  toDisplayString(): string;
};

class InchesLength implements Length<InchesLength> {
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
  toDisplayString(): string { return this.magnitude === 1 ? '1 inch' : `${this.magnitude} inches`; }
}

class FeetLength implements Length<FeetLength> {
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
  toDisplayString(): string { return this.magnitude === 1 ? '1 foot' : `${this.magnitude} feet`; }
}

class MillimetersLength implements Length<MillimetersLength> {
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
  toDisplayString(): string { return this.magnitude === 1 ? '1 mm' : `${this.magnitude} mm`; }
}

class CentimetersLength implements Length<CentimetersLength> {
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
  toDisplayString(): string { return this.magnitude === 1 ? '1 cm' : `${this.magnitude} cms`; }
}

class MetersLength implements Length<MetersLength> {
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
  toDisplayString(): string { return this.magnitude === 1 ? '1 meter' : `${this.magnitude} meters`; }
}

const Length = {
  inches: (magnitude: number): InchesLength => new InchesLength(magnitude),
  feet: (magnitude: number): FeetLength => new FeetLength(magnitude),
  mm: (magnitude: number): MillimetersLength => new MillimetersLength(magnitude),
  centimeters: (magnitude: number): CentimetersLength => new CentimetersLength(magnitude),
  meters: (magnitude: number): MetersLength => new MetersLength(magnitude),
};

export { Length, InchesLength, FeetLength, MillimetersLength, CentimetersLength, MetersLength };
