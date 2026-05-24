# Coordinate System

Cad2d uses four distinct position classes to separate concerns across screen rendering, viewport transforms, world geometry, and sheet units.

## Position Classes

All four extend an abstract `Position` base with `x: number` and `y: number`. Each can convert to the others given the right context (viewport state for viewport transforms, sheet for unit conversion).

```
ScreenPosition  --  screen pixels, origin top-left of viewport
     |
     | .toViewport()  (directly equivalent -- ScreenPosition == ViewportPosition)
     | .toWorld(state)  (inverse of viewport transform)
     v
ViewportPosition  --  PixiJS coordinate space (includes pan offset + scale)
     |
     | .toWorld(state)   (applies inverse viewport transform)
     | .toScreen(state)  (applies viewport transform)
     v
WorldPosition  --  world/document coordinates in pixels
     |
     | .toViewport(state)  (applies viewport transform)
     | .toScreen(state)    (applies viewport transform)
     | .toSheet()          (divides x,y by SHEET_UNITS_TO_PIXELS)
     v
SheetPosition  --  coordinates in the sheet's defaultUnit (e.g., cm, in)
     |
     | .toWorld()  (multiplies x,y by SHEET_UNITS_TO_PIXELS)
```

## Key Constants

- **`SHEET_UNITS_TO_PIXELS = 64`** -- 1 sheet unit = 64 pixels. All geometry is stored in sheet units, converted to pixels for rendering.

## Curve/Segment Types (generic over Position)

```typescript
type LineSegment<P>    = { start: P; end: P }
type QuadraticCurve<P> = { start: P; end: P; controlPoint: P }
type CubicCurve<P>     = { start: P; end: P; controlPointA: P; controlPointB: P }
```

Type guards: `isLineSegment`, `isQuadraticCurve`, `isCubicCurve` -- check for the presence of `controlPoint` / `controlPointA` properties.

## Important Design Notes

- **SheetPosition is NOT in pixels or centimeters.** Its numeric values are in whatever the sheet's `defaultUnit` is set to. Always check `sheet.defaultUnit` before interpreting.
- **Changing `defaultUnit` does NOT convert existing geometry.** A stored `SheetPosition` of `{x:3, y:3}` becomes 3 meters if you switch to `'m'`, or 3 cm if you switch to `'cm'`.
- **Viewport state** (pan position + scale) is owned by `ViewportControls` and converted via `ViewportState` objects passed to the conversion methods.
