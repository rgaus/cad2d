# Coordinate System

Cad2d uses five distinct position classes to separate concerns across screen rendering, viewport transforms, world geometry, sheet units, and geometry-relative coordinates.

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
     |
     | .toGeometryRelativeSheetPosition(geometry)  (inverse render matrix, then subtract raw origin)
     v
GeometryRelativeSheetPosition  --  geometry-local coordinates (0,0 = raw natural origin)
     |
     | .toSheet(geometry)  (add raw origin, then apply render matrix)
     v
SheetPosition (rendered)
```

## Geometry-Relative Coordinates

`GeometryRelativeSheetPosition` represents a position in a geometry's local, untransformed
coordinate system. The origin `(0, 0)` is the geometry's raw natural origin:

- rectangle: raw upper-left `origin`
- ellipse: raw `center`
- polygon: raw bounding-box upper-left

Raw geometry storage varies by shape type:

- rectangle: absolute `origin` (upper-left)
- ellipse: absolute `center`
- polygon: a stable absolute `position` plus `GeometryRelativeSheetPosition` points stored locally
  relative to that position. The position is chosen as the raw bounding-box upper-left at creation
  and is deliberately not re-centered after edits.

These absolute values define the geometry-relative origin. Conversion is explicit:

- `GeometryRelativeSheetPosition.fromRawSheet(position, geometry)` converts a raw absolute
  `SheetPosition` into geometry-relative coordinates by subtracting the raw origin.
- `SheetPosition.toGeometryRelativeSheetPosition(geometry)` converts a **rendered** sheet position
  into geometry-relative coordinates by applying the inverse render matrix and subtracting the raw
  origin.
- `GeometryRelativeSheetPosition.toSheet(geometry)` projects geometry-relative coordinates into
  rendered sheet space by adding the raw origin and applying `Entity.generateRenderMatrix(geometry)`.

Helpers such as `GeometryComponent.keyPoints`, bounding boxes, and oriented bounding boxes return
geometry-relative coordinates. Consumers project with `.toSheet(geometry)` when they need rendered
sheet space. `RenderShape`s and filters remain in rendered sheet space.

Polygons store a stable raw `position` plus local geometry-relative segments. They support the same
`RotationComponent` behavior as rectangles and ellipses; their rotation pivot is the polygon's raw
`position`. Baked conversions (booleans, trim/split, filter materialization, rectangle/ellipse to
polygon) reset rotation to zero because the rendered geometry is already baked into local points.

`getOrigin` and `getRenderOrigin` intentionally remain absolute-space functions because they are
inputs to the render matrix itself.

### Anchor and rotation invariant

The anchor key point plus anchor offset maps to the geometry's raw natural origin. Rotation then
pivots around that same raw natural origin. In other words, with raw origin `O`, key point `K`
(geometry-relative), and anchor offset `A`:

```text
renderTransform(O + K + A) = O
```

The anchor handle is rendered at `O`, and `RotationComponent` rotates around `O`. This is the
intended anchor-as-rotation-center behavior.

## Key Constants

- **`SHEET_UNITS_TO_PIXELS = 64`** -- 1 sheet unit = 64 pixels. All geometry is stored in sheet units, converted to pixels for rendering.

## Curve/Segment Types (generic over Position)

```typescript
type LineSegment<P> = { start: P; end: P };
type QuadraticCurve<P> = { start: P; end: P; controlPoint: P };
type CubicCurve<P> = { start: P; end: P; controlPointA: P; controlPointB: P };
```

Type guards: `isLineSegment`, `isQuadraticCurve`, `isCubicCurve` -- check for the presence of `controlPoint` / `controlPointA` properties.

## Important Design Notes

- **SheetPosition is NOT in pixels or centimeters.** Its numeric values are in whatever the sheet's `defaultUnit` is set to. Always check `sheet.defaultUnit` before interpreting.
- **Changing `defaultUnit` does NOT convert existing geometry.** A stored `SheetPosition` of `{x:3, y:3}` becomes 3 meters if you switch to `'m'`, or 3 cm if you switch to `'cm'`.
- **Viewport state** (pan position + scale) is owned by `ViewportControls` and converted via `ViewportState` objects passed to the conversion methods.
