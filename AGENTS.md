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
  app/                    # Next.js App Router pages and components
    components/           # React UI components
    page.tsx              # Root page
  lib/
    units/                # Unit conversion system
      length.ts           # Length classes (inches, feet, mm, cm, meters)
    viewport/             # Viewport rendering and interaction logic
      types.ts            # Position classes and types
      viewportMath.ts     # Coordinate conversion utilities
      ViewportControls.ts # Core class (event-driven, testable)
  __tests__/              # Unit tests
```

### Core Principles

**Decoupled Core**: Complex logic lives in pure TypeScript classes under `lib/`. These classes:
- Take no React dependencies
- Use EventEmitter for output events (e.g., `cursorChange`)
- Accept input via explicit handler methods (e.g., `handleWheel`, `handleMouseDown`)
- Are fully unit-testable by instantiating them directly and calling methods

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
- **WorldPosition**: Represents a position in world (document) coordinates. This is the canonical
  space for modelling geometry.
- **SheetPosition**: Is the same as WorldPosition, only coordinates are in **default sheet units**
  (NOT pixels). SheetPosition coordinates are NOT always in centimeters — they are in whatever
  unit the sheet's `defaultUnit` is set to (mm, cm, m, in, or ft).

**Important:** When comparing or storing geometry values (like polygon points), the values are
stored in default sheet units. A point at `{x: 3, y: 3}` means 3 units in the sheet's default unit,
not 3 centimeters. Always consider the sheet's `defaultUnit` when interpreting these values.

### Default Sheet Unit

Each sheet has a configurable `defaultUnit` which controls:
- The unit used for storing polygon geometry (SheetPosition coordinates)
- The unit used for grid snapping (via `SHEET_UNITS_TO_PIXELS` conversion)
- The unit family (metric vs SAE) used for determining grid stop values

**Available units:** `mm`, `cm`, `m` (metric) or `in`, `ft` (SAE).

**Grid snapping:** The `getGridAtScale()` function returns grid values in **cm** (metric) or
**inches** (SAE), regardless of the sheet's actual default unit. These values must be converted:
- Metric grids (cm) → mm sheet: multiply by 10
- Metric grids (cm) → m sheet: divide by 100
- SAE grids (inches) → ft sheet: divide by 12

This conversion is handled in `ToolManager.syncSnappingOptions()`.

**SHEET_UNITS_TO_PIXELS:** All position conversions between sheet units and pixels use the
constant `SHEET_UNITS_TO_PIXELS = 64`. This defines how many pixels equal one sheet unit.
The sheet's width/height is converted to pixels via `width.toSheetUnits(sheet).magnitude * SHEET_UNITS_TO_PIXELS`.

**Changing default unit:** When a user changes the sheet's default unit, existing polygon geometry
is NOT converted — only the interpretation of the stored values changes. For example, a point
at `{x: 3, y: 3}` is 3 meters if `defaultUnit='m'`, but 3 centimeters if `defaultUnit='cm'`.

### Unit System

The application uses a `Length` interface with subclasses for each unit of measurement:

- **InchesLength**, **FeetLength**, **MillimetersLength**, **CentimetersLength**, **MetersLength**

Each class has:
- A `type` symbol property for runtime type identification
- A `magnitude` number property representing the value in that unit
- `toX()` methods to convert to all other units (e.g., `toMeters()`, `toMillimeters()`)
- A `toDisplayString()` method returning human-readable output (e.g., "1 inch", "5 cms")

Factory helpers are available via the `Lengths` object:
```typescript
const meters = Lengths.meters(1.5);
const inches = Lengths.inches(5);
```

When accepting a length value as a function parameter, opt to take `Length` and lazy convert to the
format you need in that given place:
```typescript
function myFunc(len: Length) {
    const inches = len.toInches();
}
```

### Testing

Unit tests live in `src/__tests__/` and test core classes in isolation by:
1. Instantiating the class with test config
2. Calling input methods (handler methods)
3. Asserting output state via `getState()` or event emissions

This approach allows testing complex viewport interaction logic without needing a DOM
environment or React rendering. Tests are run via `npm test` (Jest).

### Math Helpers (`src/lib/math/index.ts`)
Common 2D geometry utilities for vector math:
- `vec2(x, y)` - create vector
- `addVec2`, `subVec2`, `scaleVec2` - vector arithmetic
- `normVec2`, `perpVec2` - normalization and perpendicular
- `dotVec2`, `lenVec2`, `distVec2` - vector operations
- `midPoint(a, b)` - midpoint between two vectors
- `quadraticBezierControlFromMidpoint(start, end, midpoint)` - given a start, end, and a point the
  curve should pass through at t=0.5, returns the quadratic Bezier control point. Used by cubic arc
  rendering to derive controlPointB.
- `isQuadraticCurve(c)` - type guard for quadratic Bezier curves
- `isCubicCurve(c)` - type guard for cubic Bezier curves
- `isLineSegment(c)` - type guard for line segments
- `arcToLineSegments(curve, numSamples=20)` - rasterizes a quadratic or cubic Bezier curve into
  an array of points. Useful for converting arc segments to line segments for polygon operations.

### Polygon Drawing Workflow
When the Polygon tool is selected:
1. User moves mouse - a preview handle shows where the first point will be snapped to the grid
2. User clicks - first point is placed at the snapped position, preview line follows mouse
3. Each subsequent click adds a new point, snapped to grid (and angular if Super/Meta held)
4. Clicking the first handle (when 2+ points exist) OR pressing Enter completes the polygon as closed
5. Pressing Escape cancels polygon creation

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
2. Press and hold Alt, then click — this sets `pendingArcEndPoint` (the arc endpoint), but does
   NOT add a segment yet
3. Move the mouse — a live WIP arc preview renders, using the mouse position as the control input
4. Click to confirm — the arc segment is added and `pendingArcEndPoint` is cleared

**Arc modes:**
- **Quadratic mode** (default): the user clicks to place the quadratic Bezier control point directly.
  The arc endpoint was set in step 2. Result: `arc-quadratic` segment with `point = pendingArcEndPoint`
  and `controlPoint = user-clicked position`.
- **Cubic mode**: the user clicks to place `controlPointA`. `controlPointB` is computed via
  `quadraticBezierControlFromMidpoint(start, end, midPoint(start, end))` so the arc's midpoint
  lies at the chord midpoint. Result: `arc-cubic` segment with `point = pendingArcEndPoint`,
  `controlPointA = user-clicked position`, `controlPointB = computed`.

### Actions

Actions are operations triggered from the action menu (or via keyboard shortcuts). They live in
`src/lib/actions/` and extend `BaseAction`.

**Creating a new action:**

1. Create a file like `src/lib/actions/MyAction.tsx`:
```typescript
import React from "react";
import { BaseAction } from "./BaseAction";
import { ActionManager } from "./ActionManager";

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

2. Register in `src/lib/actions/ActionManager.ts`:
```typescript
import { MyAction } from "./MyAction";

const ACTIONS = [UndoAction, RedoAction, TestAction, MyAction];
const ACTIONS_BY_TYPE = {
  // ... existing
  "my-action": MyAction,
};
export type ActionType = keyof typeof ACTIONS_BY_TYPE;
```

**Available services via `BaseAction`:**
- `this.getGeometryStore()` - access polygons, rectangles, ellipses
- `this.getSelectionManager()` - get selected IDs, listen to selection changes
- `this.getHistoryManager()` - for undo/redo support

**Important notes for action implementation:**
- The `desc` property provides user-facing tooltip/description text
- `executeKeyCombo = null` means no keyboard shortcut; use `"cmd+shift+key"` format for shortcuts
