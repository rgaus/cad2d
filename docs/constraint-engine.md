# Constraint Engine

The constraint system has two layers: user-facing constraints (persisted, visible dimension lines) and engine-level constraints (solver-native mathematical constraints).

## User-Facing Constraints

Currently there is one user-facing type: `LinearConstraint`. It represents a target distance between two endpoints.

**Endpoints** (`ConstraintEndpoint`) can be:
- Free-floating points (`{ type: "point", point: SheetPosition }`)
- Locked to a rectangle corner, ellipse key point, or polygon vertex index

**User interaction:**
- **Creating**: ConstraintTool (key `c`) -- click two endpoints with key point snapping (8px radius) and grid/angular snapping
- **Editing via SelectTool**: drag label to adjust offset, drag endpoints to move, double-click label to edit length value

## Engine-Level Constraints

The solver (`constraint-engine.ts`) uses these types internally:

| Type | Description |
|------|-------------|
| `distance` | Point-to-point target distance |
| `fixedPoint` | Pin a vertex to an absolute position |
| `horizontal` | Two points must share the same Y |
| `vertical` | Two points must share the same X |
| `parallel` | Two line segments must have the same direction |
| `perpendicular` | Two line segments must be orthogonal |

Each type implements `computeError()`, `computeGradient()`, and `isInConflict()`.

## Solving Approach: Gradient Descent

The solver is purely numerical -- no symbolic solving.

1. **Energy model**: Each constraint defines `error = 0.5 * (actual - target)^2`. Total loss = sum across all constraints.
2. **Analytical gradients**: Each constraint type computes partial derivatives of its error w.r.t. each point's (x, y). Numerical fallback via central differences for general loss functions.
3. **Iteration**: Default 100,000 steps, learning rate 0.01, epsilon 1e-5. Early exit when loss < 1e-10.
4. **State format**: Flat array of numbers (x0, y0, x1, y1, ...) converted to/from a Map<PointId, SheetPosition>.

## The `reconstrain()` Pipeline

Triggered by `ReconstrainAction` (key R) or programmatically:

1. `DCELShapeIndex.computeEngineConstraints()` builds solver input:
   - Position map from all DCEL vertices
   - Auto-inferred horizontal/vertical constraints from rectangles (4 per rect)
   - Auto-inferred vertical/horizontal from ellipses (2 per ellipse)
   - User LinearConstraints converted to `distance` engine constraints
   - Fixed point pins for vertices that should not move
2. `gradientDescent()` runs the solver
3. `DCELShapeIndex.computeShapesForVertexId()` maps solved vertex positions back to shape-level updates (polygon point indices, rectangle corners, ellipse key points)
4. Each shape is updated via `updatePolygon()`/`updateRectangle()`/`updateEllipse()`
5. DCEL is immediatly resynced for all touched shapes
6. Entire solve is wrapped in a single history transaction

## Auto-Inferred Constraints

When solving, the system automatically adds constraints for:
- **Rectangles**: 4 constraints (top edge = horizontal, bottom edge = horizontal, right edge = vertical, left edge = vertical)
- **Ellipses**: 2 constraints (top-bottom = vertical, left-right = horizontal)

This keeps rectangles rectangular and ellipses elliptical during constraint solving.
