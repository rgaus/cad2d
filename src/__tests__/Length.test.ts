import {
  Length,
  InchesLength,
  FeetLength,
  MillimetersLength,
  CentimetersLength,
  MetersLength,
} from '../lib/units/length';

describe('Length unit conversions', () => {
  describe('InchesLength', () => {
    it('should convert to feet', () => {
      const inches = new InchesLength(12);
      const feet = inches.toFeet();
      expect(feet.magnitude).toBeCloseTo(1, 10);
    });

    it('should convert to meters', () => {
      const inches = new InchesLength(1);
      const meters = inches.toMeters();
      expect(meters.magnitude).toBeCloseTo(0.0254, 10);
    });

    it('should convert to centimeters', () => {
      const inches = new InchesLength(1);
      const cm = inches.toCentimeters();
      expect(cm.magnitude).toBeCloseTo(2.54, 10);
    });

    it('should convert to millimeters', () => {
      const inches = new InchesLength(1);
      const mm = inches.toMillimeters();
      expect(mm.magnitude).toBeCloseTo(25.4, 10);
    });

    it('should roundtrip through meters accurately', () => {
      const original = new InchesLength(5);
      const meters = original.toMeters();
      const backToInches = meters.toInches();
      expect(backToInches.magnitude).toBeCloseTo(original.magnitude, 12);
    });
  });

  describe('FeetLength', () => {
    it('should convert to inches', () => {
      const feet = new FeetLength(1);
      const inches = feet.toInches();
      expect(inches.magnitude).toBeCloseTo(12, 10);
    });

    it('should convert to meters', () => {
      const feet = new FeetLength(1);
      const meters = feet.toMeters();
      expect(meters.magnitude).toBeCloseTo(0.3048, 10);
    });

    it('should convert to centimeters', () => {
      const feet = new FeetLength(1);
      const cm = feet.toCentimeters();
      expect(cm.magnitude).toBeCloseTo(30.48, 10);
    });

    it('should convert to millimeters', () => {
      const feet = new FeetLength(1);
      const mm = feet.toMillimeters();
      expect(mm.magnitude).toBeCloseTo(304.8, 10);
    });

    it('should roundtrip through meters accurately', () => {
      const original = new FeetLength(3);
      const meters = original.toMeters();
      const backToFeet = meters.toFeet();
      expect(backToFeet.magnitude).toBeCloseTo(original.magnitude, 12);
    });
  });

  describe('MillimetersLength', () => {
    it('should convert to centimeters', () => {
      const mm = new MillimetersLength(10);
      const cm = mm.toCentimeters();
      expect(cm.magnitude).toBeCloseTo(1, 10);
    });

    it('should convert to meters', () => {
      const mm = new MillimetersLength(1000);
      const meters = mm.toMeters();
      expect(meters.magnitude).toBeCloseTo(1, 10);
    });

    it('should convert to inches', () => {
      const mm = new MillimetersLength(25.4);
      const inches = mm.toInches();
      expect(inches.magnitude).toBeCloseTo(1, 10);
    });

    it('should convert to feet', () => {
      const mm = new MillimetersLength(304.8);
      const feet = mm.toFeet();
      expect(feet.magnitude).toBeCloseTo(1, 10);
    });

    it('should roundtrip through meters accurately', () => {
      const original = new MillimetersLength(50);
      const meters = original.toMeters();
      const backToMm = meters.toMillimeters();
      expect(backToMm.magnitude).toBeCloseTo(original.magnitude, 12);
    });
  });

  describe('CentimetersLength', () => {
    it('should convert to millimeters', () => {
      const cm = new CentimetersLength(1);
      const mm = cm.toMillimeters();
      expect(mm.magnitude).toBeCloseTo(10, 10);
    });

    it('should convert to meters', () => {
      const cm = new CentimetersLength(100);
      const meters = cm.toMeters();
      expect(meters.magnitude).toBeCloseTo(1, 10);
    });

    it('should convert to inches', () => {
      const cm = new CentimetersLength(2.54);
      const inches = cm.toInches();
      expect(inches.magnitude).toBeCloseTo(1, 10);
    });

    it('should convert to feet', () => {
      const cm = new CentimetersLength(30.48);
      const feet = cm.toFeet();
      expect(feet.magnitude).toBeCloseTo(1, 10);
    });

    it('should roundtrip through meters accurately', () => {
      const original = new CentimetersLength(75);
      const meters = original.toMeters();
      const backToCm = meters.toCentimeters();
      expect(backToCm.magnitude).toBeCloseTo(original.magnitude, 12);
    });
  });

  describe('MetersLength', () => {
    it('should convert to inches', () => {
      const meters = new MetersLength(1);
      const inches = meters.toInches();
      expect(inches.magnitude).toBeCloseTo(39.3700787402, 10);
    });

    it('should convert to feet', () => {
      const meters = new MetersLength(1);
      const feet = meters.toFeet();
      expect(feet.magnitude).toBeCloseTo(3.280839895, 10);
    });

    it('should convert to centimeters', () => {
      const meters = new MetersLength(1);
      const cm = meters.toCentimeters();
      expect(cm.magnitude).toBeCloseTo(100, 10);
    });

    it('should convert to millimeters', () => {
      const meters = new MetersLength(1);
      const mm = meters.toMillimeters();
      expect(mm.magnitude).toBeCloseTo(1000, 10);
    });

    it('should roundtrip to itself', () => {
      const original = new MetersLength(2.5);
      const backToMeters = original.toMeters();
      expect(backToMeters.magnitude).toBe(original.magnitude);
    });
  });
});

describe('Length factory helpers', () => {
  it('should create InchesLength via Length.inches', () => {
    const inches = Length.inches(5);
    expect(inches).toBeInstanceOf(InchesLength);
    expect(inches.magnitude).toBe(5);
  });

  it('should create FeetLength via Length.feet', () => {
    const feet = Length.feet(3);
    expect(feet).toBeInstanceOf(FeetLength);
    expect(feet.magnitude).toBe(3);
  });

  it('should create MillimetersLength via Length.mm', () => {
    const mm = Length.mm(100);
    expect(mm).toBeInstanceOf(MillimetersLength);
    expect(mm.magnitude).toBe(100);
  });

  it('should create CentimetersLength via Length.centimeters', () => {
    const cm = Length.centimeters(50);
    expect(cm).toBeInstanceOf(CentimetersLength);
    expect(cm.magnitude).toBe(50);
  });

  it('should create MetersLength via Length.meters', () => {
    const meters = Length.meters(1.5);
    expect(meters).toBeInstanceOf(MetersLength);
    expect(meters.magnitude).toBe(1.5);
  });
});

describe('Length display strings', () => {
  describe('InchesLength', () => {
    it('should return singular "1 inch" for magnitude 1', () => {
      expect(new InchesLength(1).toDisplayString()).toBe('1 inch');
    });

    it('should return plural for magnitude not 1', () => {
      expect(new InchesLength(5).toDisplayString()).toBe('5 inches');
    });
  });

  describe('FeetLength', () => {
    it('should return singular "1 foot" for magnitude 1', () => {
      expect(new FeetLength(1).toDisplayString()).toBe('1 foot');
    });

    it('should return plural for magnitude not 1', () => {
      expect(new FeetLength(3).toDisplayString()).toBe('3 feet');
    });
  });

  describe('MillimetersLength', () => {
    it('should return singular "1 mm" for magnitude 1', () => {
      expect(new MillimetersLength(1).toDisplayString()).toBe('1 mm');
    });

    it('should return plural for magnitude not 1', () => {
      expect(new MillimetersLength(25).toDisplayString()).toBe('25 mm');
    });
  });

  describe('CentimetersLength', () => {
    it('should return singular "1 cm" for magnitude 1', () => {
      expect(new CentimetersLength(1).toDisplayString()).toBe('1 cm');
    });

    it('should return plural "5 cms" for magnitude 5', () => {
      expect(new CentimetersLength(5).toDisplayString()).toBe('5 cms');
    });
  });

  describe('MetersLength', () => {
    it('should return singular "1 meter" for magnitude 1', () => {
      expect(new MetersLength(1).toDisplayString()).toBe('1 meter');
    });

    it('should return plural for magnitude not 1', () => {
      expect(new MetersLength(2.5).toDisplayString()).toBe('2.5 meters');
    });
  });
});

describe('Length identity conversions', () => {
  it('InchesLength.toInches should return same instance', () => {
    const inches = new InchesLength(5);
    expect(inches.toInches()).toBe(inches);
  });

  it('FeetLength.toFeet should return same instance', () => {
    const feet = new FeetLength(3);
    expect(feet.toFeet()).toBe(feet);
  });

  it('MillimetersLength.toMillimeters should return same instance', () => {
    const mm = new MillimetersLength(100);
    expect(mm.toMillimeters()).toBe(mm);
  });

  it('CentimetersLength.toCentimeters should return same instance', () => {
    const cm = new CentimetersLength(50);
    expect(cm.toCentimeters()).toBe(cm);
  });

  it('MetersLength.toMeters should return same instance', () => {
    const meters = new MetersLength(2);
    expect(meters.toMeters()).toBe(meters);
  });
});

describe('Length magnitude', () => {
  it('should preserve magnitude through construction', () => {
    expect(new InchesLength(10).magnitude).toBe(10);
    expect(new FeetLength(5).magnitude).toBe(5);
    expect(new MillimetersLength(100).magnitude).toBe(100);
    expect(new CentimetersLength(25).magnitude).toBe(25);
    expect(new MetersLength(3.5).magnitude).toBe(3.5);
  });
});

describe('Length type symbols', () => {
  it('should have distinct type symbols for each unit', () => {
    const inches = new InchesLength(1);
    const feet = new FeetLength(1);
    const mm = new MillimetersLength(1);
    const cm = new CentimetersLength(1);
    const meters = new MetersLength(1);

    expect(inches.type).not.toBe(feet.type);
    expect(inches.type).not.toBe(mm.type);
    expect(inches.type).not.toBe(cm.type);
    expect(inches.type).not.toBe(meters.type);
    expect(feet.type).not.toBe(mm.type);
    expect(feet.type).not.toBe(cm.type);
    expect(feet.type).not.toBe(meters.type);
    expect(mm.type).not.toBe(cm.type);
    expect(mm.type).not.toBe(meters.type);
    expect(cm.type).not.toBe(meters.type);
  });
});