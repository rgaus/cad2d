# Snapping System

Snapping is handled by pure functions in `src/lib/snapping/`. The system has three independent snapping modes that compose together.

## Snapping Modes

### 1. Grid Snapping (always on unless Shift held)

Rounds a position to the nearest grid line. Uses two grid sizes:

- **Primary grid**: coarser spacing (e.g., 1cm or 1in)
- **Secondary grid**: finer spacing (e.g., 0.5cm or 1/16in), optional

The position is snapped to whichever grid line (primary or secondary) is closer.

Grid spacing is computed at runtime by `getGridAtScale()` in `src/lib/viewport/grid.ts`, which picks from predefined stop tables (`GRID_STOPS_CM` for metric, `GRID_STOPS_IN` for SAE) based on the current viewport zoom level. The goal is to keep primary grid lines roughly 64px apart on screen.

### 2. Angular Snapping (only when Super/Meta held)

Snaps a position to the nearest 45-degree angle from a reference point. Preserves distance, only adjusts direction. Uses `atan2` + rounding to nearest multiple of PI/4.

### 3. Key Point Snapping (used by ConstraintTool and SelectTool)

After grid-snapping, checks if the cursor is within `KEY_POINT_SNAP_THRESHOLD_PX = 8` (pixels at current scale) of a geometry key point:

- Polygon vertices
- Rectangle corners
- Ellipse key points (top, right, bottom, left, center)

If a key point is found, returns a `ConstraintEndpoint` locked to that geometry. Otherwise returns a free-floating `{ type: "point" }` endpoint.

## Modifier Key Behavior

| Key        | Effect                                                                           |
| ---------- | -------------------------------------------------------------------------------- |
| Shift      | Disables ALL snapping (grid + angular + key point)                               |
| Meta/Super | Enables 45-degree angular snapping from previous point                           |
| Alt        | Center-mode (rectangle/ellipse), arc endpoint (polygon) -- NOT a snapping toggle |

Key state is tracked centrally in `ToolManager` via `handleKeyDown`/`handleKeyUp` and available to all tools via `getShiftHeld()`, `getSuperHeld()`, etc.

## Grid Rendering

The grid is drawn by `SheetRenderer.tsx` using Pixi.js `Graphics`:

1. Calls `getGridAtScale()` to get ideal primary/secondary spacing
2. Converts grid values from cm/inches to sheet units via a unit conversion factor
3. Culls grid lines to the visible viewport area
4. Draws secondary lines (lighter gray) first, then primary lines (darker gray) on top

## SnappingOptions

The main entry point is `applySnapping(pos, prevPoint, options)` which takes:

- `primaryGridSize` / `secondaryGridSize` -- grid spacing in sheet units
- `shiftHeld` -- disables all snapping
- `superHeld` -- enables angular snapping

These options are recomputed on every zoom change via `ToolManager.syncSnappingOptions()`.
