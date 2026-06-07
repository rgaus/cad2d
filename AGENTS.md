@~/.config/opencode/AGENTS.md

## Detailed Docs

The docs/ directory has deep dives on specific subsystems. DO NOT load all docs files at once --
read the AGENTS.md first, then use the Read tool to fetch only the docs files relevant to your
current task.

## Overview

Cad2d (working name) is a 2d cad application which makes casual mechanical drawing easy.

- Progressive web app (works offline as well as online)
- Equally optimized for laptop (full-screen Chrome on 14" MacBook) and iPad (mouse + touch)
- Highly decoupled and testable: complex pieces are EventEmitter-based classes receiving input via handler methods and emitting output events

## Directory Structure

```
src/
  app/                          # Next.js App Router
    page.tsx                    # Root page -- wires Sheet, ToolManager, ActionsManager
    components/                 # React UI (viewport, panels, overlays)
  lib/
    actions/                    # Actions extend BaseAction, registered in ActionsManager
    constraint-engine.ts        # Iterative gradient descent constraint solver
    dcel.ts                     # Core DCEL (Doubly Connected Edge List)
    drag/                       # Window-level drag tracking utility
    geometry/                   # Polygon, Rectangle, Ellipse types + GeometryStore
      constraints/              # LinearConstraint, ConstraintEndpoint
      dcel-shape-index.ts       # Sync layer between shapes and DCEL
    history/                    # HistoryManager: undo/redo stacks + transactions
    math/                       # Vector math, intersection, Bezier, bounding box, Cohen-Sutherland
    serialization/              # SVG superset save/load format
    sheet/                      # Sheet config (width, height, defaultUnit, etc.)
    snapping/                   # Grid snap, angular snap, key point snap
    tools/                      # 7 tools (select/move/polygon/rect/ellipse/trim-split/constraint)
      ToolManager.ts            # Central coordinator: routes events to active tool, tracks modifiers
      SelectionManager.ts       # Tracks selected geometry IDs
    units/                      # Length (in/ft/mm/cm/m) and Angle (deg/rad) classes
    viewport/                   # Position classes, ViewportControls, grid math
    renderer.ts                 # RendererLayers enum (Solids/Overlays/Tooltips)
  components/                   # Pixi.js renderers (PolygonRenderer, ConstraintsRenderer, etc.)
  __tests__/                    # Jest unit tests
```

File naming: PascalCase for classes/components (`SelectAllAction.tsx`), kebab-case for utilities (`my-utility-file.ts`).

## Core Principles

**Decoupled Core**: Complex logic lives in pure TypeScript classes (no React deps). They use EventEmitter for output and explicit handler methods for input. Fully unit-testable without a DOM.

**ECS / Component architecture**: All geometry types are now flat `Geometry<ComponentA & ComponentB & ...>` intersections — no more top-level domain fields like `polygon.points`. Components include `PolygonComponent`, `RectangleComponent`, `EllipseComponent`, `FillColorComponent`, `RenderOrderComponent`, `LinkDimensionsComponent`. Properties are accessed via `Component.get(geometry)`, updated via `Component.update(geometry, partial)`.

**Unified CRUD via `GeometryStore`**: Shape-specific methods (`addPolygon`, `deleteRectangle`, `updateEllipse`) have been replaced with generic methods that dispatch by component:

- `add(idPrefix, template)` / `addDirect(geometry)` — insert
- `updateById(id, fn)` / `updateByIdDirect(id, fn)` / `updateByIdWithComponentDirect(id, component, fn)` — update
- `delete(id)` / `deleteDirect(id)` — delete
- `listWithComponent(component)` / `listWithComponents(a, b, c?, d?)` — query
- `getByIdWithComponent(id, component)` / `getByIdWithComponents(id, a, b, c?, d?)` — lookup

The `*WithComponent*` variants narrow the return type to `Geometry<C>`. `updateById` (no suffix) records to history; `*Direct` variants do not. HistoryManager uses `*Direct` methods during undo/redo replay to prevent infinite loops.

**React as Thin Wrapper**: React components instantiate core classes, forward DOM events, subscribe to core events, and render Pixi elements from state. No business logic in React.

## Coordinate System

Four position classes, each with `toWorld` / `toViewport` / `toScreen` conversion methods:

- **ScreenPosition** -- screen pixels, origin top-left of viewport
- **ViewportPosition** -- PixiJS viewport coords (includes pan/zoom transform)
- **WorldPosition** -- world/document coordinates in pixels (`SHEET_UNITS_TO_PIXELS = 64` bridges pixels <-> sheet units)
- **SheetPosition** -- coordinates in the sheet's `defaultUnit` (NOT pixels). A point at `{x:3, y:3}` means 3 inches if `defaultUnit='in'`, 3 cm if `defaultUnit='cm'`, etc.

Curve/segment types (generic over Position): `LineSegment<P>`, `QuadraticCurve<P>`, `CubicCurve<P>`. Type guards: `isLineSegment`, `isQuadraticCurve`, `isCubicCurve`.

## Conventions

**Manager classes**: Complex subsystems are coordinated by `*Manager` classes (ToolManager,
ActionsManager, HistoryManager, SerializationManager, SelectionManager). These own the lifecycle
of their subsystem, wire dependencies together, and act as the public API surface.

**EventEmitter pattern**: All stateful classes use `EventEmitter3` for output. React components
subscribe to events and read current state, rather than polling. Subscribers are stored as class
fields and cleaned up on unmount/blur.

**Handler methods**: Input goes through explicit handler methods (`handleMouseDown`,
`handleKeyDown`, `handleWheel`). Tools and managers follow this pattern -- no ad-hoc callbacks.

**Constructor injection**: Dependencies are passed via constructor and stored as private fields.
No service locator or global singletons.

**Stateless logic as pure functions**: Snapping, math, intersection detection, and similar
stateless operations live in standalone modules as exported functions, not classes. Only mutable
state gets class wrappers.

**Discriminated unions for complex state**: All multi-variant state uses discriminated union
types (`type Foo = { type: "bar"; ... } | { type: "baz"; ... }`), never inheritance hierarchies.
Examples: `UndoEntry` (~25 variants), `ConstraintEndpoint` (4 variants), `PolygonSegment`
(3 variants).

## Detailed Docs

See `docs/` for deep dives on specific subsystems:

- [Coordinate System](docs/coordinate-system.md)
- [Unit System](docs/unit-system.md)
- [Geometry Store](docs/geometry-store.md)
- [Snapping](docs/snapping.md)
- [Constraint Engine](docs/constraint-engine.md)
- [History Management](docs/history-management.md)
- [Serialization](docs/serialization.md)
- [Layers / Render Order](docs/layers.md)
- [DCEL](docs/dcel.md)

Tests run via `npm test` (Jest). All tests in `src/__tests__/`.

## Formatting

Code is formatted with Prettier. Run `npm run format` after any changes to ensure the code is
properly formatted. The CI pipeline will fail if `npm run format:check` fails.
