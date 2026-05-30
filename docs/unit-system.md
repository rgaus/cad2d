# Unit System

Cad2d has two independent unit hierarchies: length and angle.

## Length Units

An abstract `Length` base class with 5 concrete subclasses:

```
Length (abstract)
  |-- InchesLength
  |-- FeetLength
  |-- MillimetersLength
  |-- CentimetersLength
  |-- MetersLength
```

### Key Concepts

- **All conversions route through meters** as the canonical intermediate (except for adjacent conversions like mm <-> cm or in <-> ft).
- **Static factories**: `Length.inches(n)`, `Length.feet(n)`, `Length.millimeters(n)`, `Length.centimeters(n)`, `Length.meters(n)`, `Length.fromSheetUnits(unit, magnitude)`.
- **There is NO `Lengths` object** -- use the `Length` class static methods directly.
- **Display strings**: `"1 inch"`, `"2.5 inches"`, `"5 mm"`, `"10 cms"`, `"2 meters"`.

### When to use Length vs raw numbers

- **Geometry storage** (polygon points, rectangle corners, ellipse centers) is always in `SheetPosition` -- raw numbers in the sheet's default unit. No `Length` wrapper.
- **Constraint lengths** are stored as `Length` objects with their own unit, independent of the sheet's default unit. They are NOT reinterpreted when the sheet unit changes.
- **Function parameters**: prefer `Length` and convert lazily with `.toInches()`, `.toCentimeters()`, etc.

## Angle Units

An abstract `Angle` base class with 2 subclasses:

```
Angle (abstract)
  |-- DegreesAngle
  |-- RadiansAngle
```

- Static factories: `Angle.degrees(n)`, `Angle.radians(n)`, `Angle.fromSheetUnits(unit, magnitude)`.
- There is no `defaultAngleUnit` on `Sheet` yet. Angles are used internally in radians but displayed in degrees.
- Low-level helpers in `src/lib/math/angle.ts`: `degreesToRadians()`, `radiansToDegrees()`.

## Unit Family

The sheet has a `defaultUnitFamily: 'metric' | 'sae'` derived from `defaultUnit`. This controls:

- Which grid stop table to use (centimeters for metric, inches for SAE)
- The conversion factor from grid units to sheet units in `syncSnappingOptions()`

Metric family (`mm`, `cm`, `m`) uses cm-based grid stops. SAE family (`in`, `ft`) uses inch-based grid stops.
