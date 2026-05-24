@~/.config/opencode/AGENTS.md

## Overview
Cad2d (working name) is a 2d cad application which makes casual mechanical drawing easy. Important
design principals:
- Cad2d is a progressive web application. It should work just as well offline as online.
- Cad2d should be optimized equally well for working on a laptop (target a 14" macbook with full
  screen chrome) or an ipad. So, when thinking through interfaces, both mouse and touch based
  gestures should be considered equally.
- Cad2d is built to be highly decoupled, which makes it highly testable. Wherever possible, build
  complex pieces as classes which take events coming in and events going out, and write extensive
  unit tests verifying that each piece works as expected.

## Architecture
Cad2d is a next.js application which renders cad elements using pixi.js via @pixi/react. All source
code lives under `src/`.

### Directory Structure
```
src/
  app/                          # Next.js App Router pages and components
    page.tsx                    # Root page -- wires Sheet, ToolManager, ActionsManager, etc.
    components/                 # React UI components (viewport, panels, overlays)
  lib/
    actions/                    # Action menu actions (extend BaseAction)
      ActionsManager.ts         # Central action registry and key combo routing
      BaseAction.ts             # Abstract base class for all actions
      *.tsx                     # Action implementations (19 total)
    constraint-engine.ts        # Iterative gradient descent constraint solver
    dcel.ts                     # Core DCEL data structures and algorithms
    drag/
      create-drag-listener.ts   # Window-level drag tracking utility
    geometry/                   # Shape types and state management
      GeometryStore.ts          # Central geometry state manager
      types.ts                  # Id type
      polygon.ts                # Polygon type + keyPoints()
      rectangle.ts              # Rectangle type + keyPoints()
      ellipse.ts                # Ellipse type + keyPoints()
      colors.ts                 # Color palette
      dcel-shape-index.ts       # Sync layer: shapes <-> DCEL
      constraints/              # Constraint geometry types
        index.ts                # Constraint / ConstraintTemplate union exports
        linear.ts               # LinearConstraint type
        constraint-endpoint.ts  # ConstraintEndpoint type
    history/
      HistoryManager.ts         # Undo/redo stack management + transactions
      types.ts                  # All UndoEntry discriminated union types (31 types)
    math/                       # 2D geometry math utilities
      index.ts                  # Barrel export + top-level helpers
      vector.ts                 # Vector math (addVec2, subVec2, etc.)
      angle.ts                  # degreesToRadians / radiansToDegrees
      bounding-box.ts           # AABB helpers
      intersection.ts           # Segment-segment, curve-curve intersection
      bezier.ts                 # De Casteljau splitting/evaluation
      cohen-sutherland.ts       # Fast AABB rejection for intersection culling
    serialization/              # SVG save/load infrastructure
      SerializationManager.ts   # Core manager class
      versions.ts               # Version constants and migration chain
      serialize.ts              # Geometry -> SVG conversion
      deserialize.ts            # SVG -> Geometry + state extraction
    sheet/
      Sheet.ts                  # Sheet class (width, height, defaultUnit, etc.)
    snapping/
      index.ts                  # Grid snapping, angular snapping, key point snapping
    tools/                      # Drawing and editing tools
      ToolManager.ts            # Central tool registry, modifier key tracking
      BaseTool.ts               # Abstract base class for all tools
      types.ts                  # ToolType, WorkingPolygon, DraggingShapeState, etc.
      constants.ts              # SNAP_THRESHOLD_PX, MIN_POINT_DISTANCE_PX, etc.
      SelectionManager.ts       # Tracks selected geometry IDs
      SelectTool.ts             # Select/manipulate existing geometry
      MoveTool.ts               # Viewport panning
      PolygonTool.ts            # Create polygons (line + arc segments)
      RectangleTool.ts          # Create rectangles
      EllipseTool.ts            # Create ellipses
      TrimSplitTool.ts          # Split/trim segments at intersections
      ConstraintTool.ts         # Create dimension constraints
    units/                      # Unit conversion system
      length.ts                 # Length classes (inches, feet, mm, cm, meters)
      angle.ts                  # Angle classes (degrees, radians)
    viewport/                   # Viewport rendering and interaction logic
      types.ts                  # Position classes and types
      viewportMath.ts           # Coordinate conversion utilities
      ViewportControls.ts       # Core class (event-driven, testable)
      grid.ts                   # Grid stop tables and getGridAtScale()
      lineSpriteMath.ts         # Line sprite transform computation
    renderer.ts                 # RendererLayers enum + layer types
  components/                   # Pixi.js rendering components
    PolygonRenderer.tsx         # Polygon rendering
    RectangleRenderer.tsx       # Rectangle rendering
    EllipseRenderer.tsx         # Ellipse rendering
    ConstraintsRenderer.tsx     # Constraint rendering
    DCELDebugRenderer.tsx       # DCEL debug overlay
    SheetRenderer.tsx           # Grid lines + sheet outline rendering
  __tests__/                    # Unit tests (Jest)
```

File naming: name files containing mainly a single class or a react component in pascal case, like
`MyComponent.tsx` or `SelectAllAction.tsx`. Name all other files in kabob case, like
`my-utility-file.ts`.

### Core Principles

**Decoupled Core**: Complex logic lives in pure TypeScript classes under `lib/`. These classes:
- Take no React dependencies
- Use EventEmitter for output events (e.g., `cursorChange`)
- Accept input via explicit handler methods (e.g., `handleWheel`, `handleMouseDown`)
- Are fully unit-testable by instantiating them directly and calling methods

**Direct/Public method pattern**: Every mutating method on GeometryStore has a `Direct` suffix
variant (e.g., `addPolygon` vs `addPolygonDirect`). The public version records to history; the
Direct version mutates state + syncs DCEL + emits events without recording. HistoryManager uses
Direct methods for undo/redo replay to prevent infinite loops.

**React as a Thin Wrapper**: React components (e.g., `ViewportRenderer2D`) serve as integration
layers that:
- Instantiate core classes
- Attach DOM event listeners and forward them to core handlers
- Subscribe to core events and apply side effects (cursor changes, re-renders)
- Render Pixi elements using state read from core

### Coordinate System

The application uses four distinct position types, each modelled as a class with `toWorld` /
`toViewport` / `toScreen` methods:

- **ScreenPosition**: Represents a position in screen pixels. Origin is top-left of the viewport.
- **ViewportPosition**: Represents a position in the PixiJS viewport coordinate space. Includes
  pan offset and scale - transforms to/from WorldPosition via the current ViewportState.
- **WorldPosition**: Represents a position in world (document) coordinates, in pixels.
  `SHEET_UNITS_TO_PIXELS = 64` bridges WorldPosition and SheetPosition.
- **SheetPosition**: Coordinates in **default sheet units** (NOT pixels). A point at
  `{x: 3, y: 3}` means 3 units in the sheet's `defaultUnit`, not 3 centimeters. Always consider
  the sheet's `defaultUnit` when interpreting these values.

**Curve/segment types** (generic over Position):
```typescript
type LineSegment<P> = { start: P; end: P };
type QuadraticCurve<P> = { start: P; end: P; controlPoint: P };
type CubicCurve<P> = { start: P; end: P; controlPointA: P; controlPointB: P };
```

Type guards: `isLineSegment`, `isQuadraticCurve`, `isCubicCurve`.

### Default Sheet Unit

Each sheet has a configurable `defaultUnit` which controls:
- The unit used for storing polygon geometry (SheetPosition coordinates)
- The unit used for grid snapping (via `SHEET_UNITS_TO_PIXELS` conversion)
- The unit family (metric vs SAE) used for determining grid stop values

**Available units:** `mm`, `cm`, `m` (metric) or `in`, `ft` (SAE).

**Grid snapping:** The `getGridAtScale()` function returns grid values in **cm** (metric) or
**inches** (SAE), regardless of the sheet's actual default unit. These values must be converted
to sheet units -- handled in `ToolManager.syncSnappingOptions()`.

**SHEET_UNITS_TO_PIXELS:** All position conversions between sheet units and pixels use the
constant `SHEET_UNITS_TO_PIXELS = 64`. This defines how many pixels equal one sheet unit.
The sheet's width/height is converted to pixels via `width.toSheetUnits(sheet).magnitude * SHEET_UNITS_TO_PIXELS`.

**Changing default unit:** When a user changes the sheet's default unit, existing polygon geometry
is NOT converted -- only the interpretation of the stored values changes. For example, a point
at `{x: 3, y: 3}` is 3 meters if `defaultUnit='m'`, but 3 centimeters if `defaultUnit='cm'`.

### Unit System

The application has two unit hierarchies: length and angle.

#### Length Units (`src/lib/units/length.ts`)

Abstract base `Length` with 5 subclasses:

```
Length (abstract)
  |-- InchesLength      (type symbol = 'inches')
  |-- FeetLength        (type symbol = 'feet')
  |-- MillimetersLength (type symbol = 'millimeters')
  |-- CentimetersLength (type symbol = 'centimeters')
  |-- MetersLength      (type symbol = 'meters')
```

Methods: `toInches()`, `toFeet()`, `toMillimeters()`, `toCentimeters()`, `toMeters()`,
`toSheetUnits(unit)`, `toDisplayString()`.

Static factories: `Length.inches(n)`, `Length.feet(n)`, `Length.millimeters(n)`,
`Length.centimeters(n)`, `Length.meters(n)`, `Length.fromSheetUnits(unit, magnitude)`.

All conversions route through meters as the canonical intermediate.

Example display: `"1 inch"`, `"2.5 inches"`, `"5 mm"`, `"10 cms"`, `"2 meters"`.

Note: There is NO `Lengths` object -- use the `Length` class static methods directly.

When accepting a length value as a function parameter, prefer `Length` and convert lazily:
```typescript
function myFunc(len: Length) {
    const inches = len.toInches();
}
```

#### Angle Units (`src/lib/units/angle.ts`)

Abstract base `Angle` with 2 subclasses:

```
Angle (abstract)
  |-- DegreesAngle  (type symbol = 'degrees')
  |-- RadiansAngle  (type symbol = 'radians')
```

Methods: `toDegrees()`, `toRadians()`, `toSheetUnits(angleUnit)`, `toDisplayString(places?)`.

Static factories: `Angle.degrees(n)`, `Angle.radians(n)`, `Angle.fromSheetUnits(unit, magnitude)`.

Low-level math helpers in `src/lib/math/angle.ts`:
```typescript
degreesToRadians(degrees: number): number   // degrees * (PI / 180)
radiansToDegrees(radians: number): number    // radians / (PI / 180)
```

Note: Angle units exist but there is no `defaultAngleUnit` on `Sheet` yet. Angles are used
internally in radians but displayed in degrees.

### Testing

Unit tests live in `src/__tests__/` and test core classes in isolation by:
1. Instantiating the class with test config
2. Calling input methods (handler methods)
3. Asserting output state via `getState()` or event emissions

This approach allows testing complex viewport interaction logic without needing a DOM
environment or React rendering. Tests are run via `npm test` (Jest).

### Polygon Drawing Workflow

When the Polygon tool is selected, it operates as a state machine with states: `idle`,
`hovering-polygon-endpoint`, `drawing-line`, `drawing-arc-quadratic`, `drawing-arc-cubic`,
`hovering-auto-close-point`, `closing-arc-quadratic`, `closing-arc-cubic`.

1. User moves mouse -- a preview handle shows where the first point will be snapped to the grid
2. User clicks -- first point is placed at the snapped position, preview line follows mouse
3. Each subsequent click adds a new point, snapped to grid (and angular if Super/Meta held)
4. Clicking the first handle (when 2+ points exist) OR pressing Enter completes the polygon as closed
5. Pressing Escape cancels polygon creation
6. Clicking an existing non-closed polygon endpoint starts extending that polygon

**Data format:**

Polygon segments are stored as a discriminated union in `PolygonSegment`:
```typescript
type PointSegment = { type: "point"; point: SheetPosition };
type QuadraticBezierSegment = { type: "arc-quadratic"; point: SheetPosition; controlPoint: SheetPosition };
type CubicBezierSegment = { type: "arc-cubic"; point: SheetPosition; controlPointA: SheetPosition; controlPointB: SheetPosition };
type PolygonSegment = PointSegment | QuadraticBezierSegment | CubicBezierSegment;
```

**Snapping behavior:**
- Shift disables all snapping (free drawing)
- Super/Meta enables 45-degree angular snapping from the previous point
- Grid snapping (primary/secondary) is always active unless Shift is held
- Preview handle and dimension lines always render during polygon creation

**Creating an arc:**
1. Click to place a point segment (normal polygon point)
2. Press and hold Alt, then click -- this sets `pendingArcEndPoint` (the arc endpoint), but does
   NOT add a segment yet
3. Move the mouse -- a live WIP arc preview renders, using the mouse position as the control input
4. Click to confirm -- the arc segment is added and `pendingArcEndPoint` is cleared

### Actions

Actions are operations triggered from the action menu (or via keyboard shortcuts). They live in
`src/lib/actions/` and extend `BaseAction`. The `ActionsManager` (`ActionsManager.ts`) registers
all actions, handles key combo routing, and provides access to shared services.

**Creating a new action:**

1. Create a file like `src/lib/actions/MyAction.tsx`:
```typescript
import React from "react";
import { BaseAction } from "./BaseAction";
import { ActionsManager } from "./ActionsManager";

export class MyAction extends BaseAction {
  type = "my-action" as const;
  label = "My Action";
  desc = "Description of what this action does.";
  executeKeyCombo = null;  // or e.g. "cmd+shift+m"

  get icon(): React.ReactNode {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
        {/* SVG path here */}
      </svg>
    );
  }

  async execute() {
    // Implementation here
  }
}
```

2. Register in `ActionsManager.ts`:
```typescript
import { MyAction } from "./MyAction";

const ACTIONS = [UndoAction, RedoAction, SaveAction, /* ... */, MyAction];
const ACTIONS_BY_TYPE = {
  // ... existing
  "my-action": MyAction,
};
export type ActionType = keyof typeof ACTIONS_BY_TYPE;
```

**Available services via `BaseAction`:**
- `this.getSheet()` - access sheet configuration
- `this.getGeometryStore()` - access polygons, rectangles, ellipses, constraints
- `this.getSelectionManager()` - get selected IDs, listen to selection changes
- `this.getHistoryManager()` - for undo/redo and transactions
- `this.getSerializationManager()` - for save/load/copy

**Important notes:**
- The `desc` property provides user-facing tooltip/description text
- `executeKeyCombo = null` means no keyboard shortcut; use `"cmd+shift+key"` format for shortcuts
- `disabled` state is dynamic -- set in constructor via event subscriptions

### Tools System

Tool types are: `select` (key `s`), `move` (`m`), `polygon` (`p`), `rectangle` (`r`), `ellipse` (`e`), `trim-split` (`t`), `constraint` (`c`).

**ToolManager** (`src/lib/tools/ToolManager.ts`) is the central coordinator:
- Instantiates all tools and routes DOM events to the active tool
- Tracks modifier key state: `shiftHeld`, `superHeld`, `altHeld`, `ctrlHeld` with change events
- Owns `snappingOptions` (primaryGridSize, secondaryGridSize) and syncs them on zoom changes
- Provides `setActiveTool(type)` which calls `handleToolBlur()` on old tool and `handleToolFocus()` on new

**BaseTool** provides access to services via `this.toolManager.*`:
- `getGeometryStore()`, `getSelectionManager()`, `getHistoryManager()`, `getSheet()`

**Working shapes:** Drawing tools use transient `WorkingPolygon`, `WorkingRectangle`,
`WorkingEllipse`, `WorkingConstraint` objects (stored in GeometryStore) for in-progress shapes.
These are cleared on tool blur.

**Drag operations:** `SelectTool` uses `createDragListener()` which attaches window-level
mousemove/mouseup listeners for reliable drag tracking, including escape cancellation and
viewport edge nudging.

### Snapping System (`src/lib/snapping/index.ts`)

Core snapping module providing pure functions:

**SnappingOptions:**
```typescript
type SnappingOptions = {
  primaryGridSize: number;       // Primary grid spacing in sheet units
  secondaryGridSize: number | null;  // Finer grid spacing, or null
  shiftHeld: boolean;            // Disables ALL snapping when true
  superHeld: boolean;            // Enables 45-degree angular snapping
};
```

**Functions:**
- `applySnapping(pos, prevPoint, options)` - main entry point. Snaps to nearest grid line
  (primary or secondary, whichever is closer). If `superHeld && prevPoint`, also applies
  45-degree angular snapping. If `shiftHeld`, returns original position unchanged.
- `snapToNearestGrid(pos, primarySize, secondarySize)` - snap to nearest grid line of either size
- `applyKeyPointSnapping(pos, shiftHeld, options)` - grid-snaps then checks if within 8px of a
  geometry key point (rectangle corner, ellipse key point, polygon vertex). Returns a
  `ConstraintEndpoint` locked to that geometry, or a `{ type: "point" }` endpoint.
- `snapTo45Degrees(start, end)` - preserves distance, snaps angle to nearest 45 degrees

**Key point snapping threshold:** `KEY_POINT_SNAP_THRESHOLD_PX = 8` (pixels at current scale).

**Grid rendering** is handled by `SheetRenderer.tsx` which calls `getGridAtScale()` and draws
primary (gray) and secondary (lighter gray) grid lines, culled to the visible area.

**Modifier key behavior:**
| Key | Effect |
|-----|--------|
| Shift | Disables ALL snapping |
| Meta/Super | Enables 45-degree angular snapping |
| Alt | Center-mode (rect/ellipse), arc endpoint (polygon) |

### Constraints

Constraints are a first-class geometry type with user-facing and engine-level layers.

#### User-Facing Constraints

**LinearConstraint** (`src/lib/geometry/constraints/linear.ts`):
```typescript
type LinearConstraint = {
  id: Id;
  type: 'linear';
  pointA: ConstraintEndpoint;
  pointB: ConstraintEndpoint;
  constrainedLength: Length;           // target distance
  connectorLineOffsetPx: number;       // visual label offset
};
```

**ConstraintEndpoint** (`src/lib/geometry/constraints/constraint-endpoint.ts`):
```typescript
type ConstraintEndpoint =
  | { type: "point"; point: SheetPosition }
  | { type: "locked-rectangle"; id: Id; point: RectangleEndpoint }
  | { type: "locked-ellipse"; id: Id; point: EllipseEndpoint }
  | { type: "locked-polygon"; id: Id; pointIndex: number };
```

Endpoints can be free-floating or locked to specific geometry points (rectangle corners, ellipse
key points, polygon vertex indices).

**Creating:** Activate ConstraintTool (key `c`), click two endpoints. Uses key point snapping
(8px radius) and grid/angular snapping. On completion, calls `geometryStore.addConstraint()`.

**Editing:** SelectTool handles constraint manipulation:
- Drag label to adjust `connectorLineOffsetPx`
- Drag endpoints to move (with undo support)
- Double-click label to edit length value

#### Engine-Level Constraints (`src/lib/constraint-engine.ts`)

The solver uses a separate engine constraint type:
```typescript
type EngineConstraint =
  | { type: "distance"; pointA: PointId; pointB: PointId; targetDistance: number }
  | { type: "fixedPoint"; point: PointId; position: SheetPosition }
  | { type: "horizontal"; pointA: PointId; pointB: PointId }
  | { type: "vertical"; pointA: PointId; pointB: PointId }
  | { type: "parallel"; segmentA: {...}; segmentB: {...} }
  | { type: "perpendicular"; segmentA: {...}; segmentB: {...} };
```

Each type has `computeError()`, `computeGradient()`, and `isInConflict()` implementations.

**Solving approach:** Iterative gradient descent (`gradientDescent()`):
- Converts all point positions to a flat `Array<number>` (x0, y0, x1, y1, ...)
- Each constraint defines a spring-energy error function: `0.5 * error^2`
- Computes analytical gradients and steps against them: `input[i] -= learningRate * gradient[i]`
- Default: 100,000 iterations, learning rate 0.01, epsilon 1e-5
- Early exit when loss < 1e-10

**Orchestration (`GeometryStore.reconstrain()`):**
1. `DCELShapeIndex.computeEngineConstraints()` builds solver input:
   - Generates position map from all DCEL vertices
   - Auto-infers `horizontal`/`vertical` constraints from rectangles (4 per rect)
   - Auto-infers `vertical`/`horizontal` from ellipses (2 per ellipse)
   - Converts user `LinearConstraint` to `distance` engine constraints
   - Pins fixed positions as `fixedPoint` constraints
2. `gradientDescent()` runs the solver
3. `DCELShapeIndex.computeShapesForVertexId()` maps solved positions back to shape-level updates
4. Each shape is updated via `updatePolygon()`/`updateRectangle()`/`updateEllipse()`
5. DCEL is immediately (non-debounced) resynced for all touched shapes
6. Entire solve is wrapped in `historyManager.recordTransaction('reconstrain', ...)`

Triggered by `ReconstrainAction` (key `R`) or programmatically.

### History Management (`src/lib/history/`)

**HistoryManager** (`src/lib/history/HistoryManager.ts`) manages undo/redo with transaction support.

**Stacks:** LIFO `undoStack` and `redoStack` of `UndoEntry` discriminated union types (31 entry
types covering every undoable operation: polygon/rect/ellipse/conversion/constraint CRUD, render
order changes, color changes, point insertion, etc.).

**Transactions:** `recordTransaction(purpose, scopeFn)` groups multiple undo entries into a
single atomic unit:
1. Buffers all entries recorded during `scopeFn()` execution into `activeTransaction`
2. Wraps them in a `TransactionEntity` with a human-readable purpose string
3. Undo replays entries in **reverse** order; redo replays in **forward** order
4. Supports nesting (transactions within transactions)
5. Used for boolean operations (`'boolean-union'`), constrained shape creation
   (`'create-rectangle-with-constraints'`), and constraint solving (`'reconstrain'`)

**Undo/Redo:**
- `undo()`: pop from undoStack, call `applyReverse(entry)`, push to redoStack
- `redo()`: pop from redoStack, call `applyForward(entry)`, push to undoStack
- Both emit `stacksChange` event (consumed by UndoAction/RedoAction for disabled state)

**State serialization:** Full undo/redo stacks are serialized into the magic state comment,
preserving stableIdCounter for ID collision prevention.

### GeometryStore (`src/lib/geometry/GeometryStore.ts`)

Central geometry state manager. Extends `EventEmitter` and holds:
- `polygons: Array<Polygon>` -- completed polygons
- `rectangles: Array<Rectangle>` -- completed rectangles
- `ellipses: Array<Ellipse>` -- completed ellipses
- `constraints: Array<Constraint>` -- completed constraints
- `workingPolygon: WorkingPolygon | null` -- in-progress polygon
- `workingRectangle: WorkingRectangle | null` -- in-progress rectangle
- `workingEllipse: WorkingEllipse | null` -- in-progress ellipse
- `workingConstraints: Array<WorkingConstraint>` -- in-progress constraints
- `dcelIndex: DCELShapeIndex` -- DCEL sync layer

**Key patterns:**
- Every CRUD method has a `Direct` suffix variant (no history recording)
- DCEL sync is immediate for add/delete, **debounced 200ms per shape ID** for updates (via lodash)
- Emits change events for each shape type (`polygonsChanged`, `rectanglesChanged`, etc.)
- ID prefixes: `ply_` (polygon), `rct_` (rectangle), `elp_` (ellipse), `cns_` (constraint)

**Constraint resolution:** `resolveConstraintEndpoint(endpoint)` resolves locked endpoints by
looking up the referenced geometry and computing the relevant point (rectangle corner via
`rectCorners()`, ellipse key point via `ellipsePoints()`, polygon vertex by index).

**Query methods:**
- `getAllGeometryIds()` - all shape IDs
- `getAllGeometryAsSegments()` - all geometry as segments for intersection queries
- `getMaxRenderOrder()` - `[max, count]` for z-ordering

### Serialization

The application supports saving and loading drawings to an SVG superset file format.

**File format:** Valid SVG with cad2d-specific data attributes and a magic state comment.

**Geometry:** Stored as native SVG elements:
- Polygons as `<polygon>` (closed linear) or `<path>` (open/arc segments) with `data-type="polygon"`
- Rectangles as `<rect>` with `data-type="rectangle"`
- Ellipses as `<ellipse>` with `data-type="ellipse"`
- Linear constraints as `<g>` with `data-type="linear-constraint"` and `data-endpoint-*` attributes

Coordinates are stored in pixels (multiplied by `SHEET_UNITS_TO_PIXELS`), then divided back on load.

**State:** Non-geometric state stored in a magic HTML comment at the end of the file:
```svg
<!-- cad2d-state:{"version":1,...json state...} -->
```

Saved state includes: sheet dimensions/defaultUnit, viewport pan/zoom, selection IDs, full
history stacks (undo/redo), stableIdCounter, and active tool type.

**Versioning:** Current version is `1`. The `migrateState()` function in `versions.ts` runs through
`MIGRATION_LOADERS` in order to upgrade old files. To add a new version:
1. Bump `CURRENT_VERSION`
2. Add a migration loader for the previous version
3. Ensure backwards compatibility

**Fallback parsing:** Files without the magic comment are treated as plain SVG. `<rect>`, `<ellipse>`,
`<path>`, `<polygon>` elements are parsed as cad2d geometry. Arc paths (Q/C) are linearized via
`arcToLineSegments()` with a `console.warn`. Paths with only M commands are silently ignored.

**Optional integration:** SerializationManager is set via `setSerializationManager()` on both
ActionsManager and ToolManager. If not set, Save/Load actions no-op gracefully with a console
warning, allowing the system to work without serialization in tests.

**Not saved:**
- Working/transient shapes (discarded)
- DCEL state (reconstructed from geometry on load)

### DCEL (`src/lib/dcel.ts`)

The DCEL (Doubly Connected Edge List) models the planar subdivision of the drawing. It stores
vertices, directed half-edges (each twin links the opposite direction), and faces. Shapes are
synced into the DCEL via `DCELShapeIndex` (`src/lib/geometry/dcel-shape-index.ts`).

**Core types:**
- `VertexId` / `HalfEdgeId` / `FaceId` -- branded string IDs
- `HalfEdge` -- `originId`, `twinId`, `nextId`, `prevId`, `faceIds`
- `Face` -- `id`, `outerComponentId`

**Branded IDs:** All DCEL IDs use branded string types (`string & { readonly __brand: "VertexId" }`)
for type safety. They are serialized as plain strings.

**Ref-counting:** Both vertices and half-edges are reference-counted. When a shape is registered,
its positions become vertices (deduped via `addVertex`) and its edges become half-edge pairs
(deduped via `addEdge`). Removal uses `releaseVertex` / `releaseEdge` -- the element is only
culled when the last owning shape releases it.

**Face tracking:** Half-edges store an array of face IDs (`faceIds: Array<FaceId>`). Multiple
shapes that share the same directed half-edge each push their face ID. Readers use `faceIds[0]`
as the active face. On shape removal, `releaseEdge()` with a `faceId` parameter filters that
face ID out of shared half-edge `faceIds` arrays.

**Edge splitting (`splitEdge`):** When a new shape's edge crosses an existing edge, the existing
edge is split at the intersection point into two edges. The new edge is also split at the same
point. Face IDs are cloned from the original half-edges onto both resulting segments. The ref
count of the original edge is transferred to both new edges.

**Colinear edge merging (`mergeEdges` + `_mergeColinearEdges`):** When a shape is removed, split
edges that are now colinear with their neighbor (same face IDs, sharing a vertex, exactly 2
incident half-edges at the middle vertex) are merged back into a single edge. This is called
automatically at the end of `_removeShape`.

**Intersection detection:** During shape registration, candidate edges are checked against existing
DCEL edges via:
1. **Broad-phase:** Cohen-Sutherland line-segment-vs-AABB rejection
2. **Narrow-phase:** Exact `computeLineSegmentIntersection`

Intersections at existing vertices (edges meeting at a shared corner) are detected but skipped.

**Shape registration flow** (6 phases):
1. Create vertices from shape `keyPoints()` (deduped via `addVertex`)
2. Broad-phase + narrow-phase intersection detection for each candidate edge
3. Group intersections by existing edge and new edge
4. Split existing edges at intersection points, propagate faceIds
5. Add new shape edges (with split points where needed)
6. Assign face ID and link the face loop

When a rectangle's edge is split, its tracked shape kind changes from `"rectangle"` to
`"polygon"` (no longer a simple axis-aligned rectangle).

**Constraint solving integration:**
- `computeEngineConstraints()` builds the solver input: position map from all DCEL vertices,
  auto-inferred horizontal/vertical constraints from rectangles/ellipses, user constraints
  resolved to DCEL vertex IDs, and fixed point pins
- `computeShapesForVertexId()` maps solver result positions back to shape-level updates
  (polygon point indices, rectangle corners, ellipse key points)

**Usage in GeometryStore:**
- `addXxxDirect` / `deleteXxxDirect` update the DCEL immediately
- `updateXxxDirect` updates are debounced per shape ID (200ms via lodash.debounce) for eventual
  consistency during rapid drags. The `immediate` flag (used in `reconstrain()`) bypasses debounce.
- The `dcelIndex` field exposes `DCELShapeIndex` for external querying

**Debug rendering:** `DCELDebugRenderer.tsx` visualizes half-edge pairs with directional arrows,
colored by face ID. Toggled via `Sheet.dcelDebugView` (localStorage).

**Key files:**
```
src/lib/
  dcel.ts                          # Core DCEL data structures and algorithms
  geometry/
    dcel-shape-index.ts            # Sync layer: shapes <-> DCEL
    GeometryStore.ts               # Geometry state + debounced DCEL sync
    types.ts                       # Shape type definitions
```

### Layers / Render Order

The application uses a compositing layer system for rendering, not traditional CAD layers.

**RendererLayers enum** (`src/lib/renderer.ts`):
```typescript
enum RendererLayers {
  Solids = 'Solids',      // Main fill and stroke of geometries
  Overlays = 'Overlays',   // Decorations (handles, selection borders, constraints)
  Tooltips = 'Tooltips',   // React DOM-rendered tooltips (outside Pixi)
}
```

**Rendering order:** `Solids` (Pixi) -> `Overlays` (Pixi) -> `Tooltips` (React DOM overlay).

**Within-layer z-ordering:** Each shape has a `renderOrder: number`. Shapes within a layer are
sorted ascending by `renderOrder`. New shapes default to `max + 1`.

**Render order actions:**
| Action | Effect |
|--------|--------|
| Raise | `renderOrder += 1` |
| Lower | `renderOrder -= 1` |
| Raise to Top | `renderOrder = 0` |
| Lower to Bottom | `renderOrder = getMaxRenderOrder()` |

**Per-shape-type layer definitions:** Each renderer file exports `ListLayers` or `SingleLayers`
mapping `RendererLayers` to rendering components (e.g., `PolygonLayers[Solids]` ->
`<PolygonSolid>`). The `ViewportRenderer2D` composes these via `renderLayer(layerName)`.

**State not serialized:** There is no traditional layer system with named layers, visibility,
or grouping. Only `renderOrder` is serialized per shape (`data-render-order` attribute).
