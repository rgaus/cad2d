# Segment Trim via the Trim/Split Tool

## Example Scenario

Consider two shapes registered in the DCEL:

- **Shape A**: a rectangle from (0,0) to (10,10). Closed, fills an area.
- **Shape B**: an open V-shaped polygon from (2,15) to (5,5) to (8,15). Its two arms
  cross the rectangle's top edge.

### Registration — intersection splitting

When the V polygon is added to the DCEL, Phase 2 (intersection detection) discovers
that each arm crosses the rectangle's top edge:

- Left arm (2,15)→(5,5) intersects the top edge at (3.5, 10).
- Right arm (5,5)→(8,15) intersects the top edge at (6.5, 10).

Phase 4 splits the rectangle's top edge at both points, yielding three DCEL edges:

```
  (0,10) ────── (3.5,10) ────── (6.5,10) ────── (10,10)
```

Phase 5 splits each V-arm at its respective intersection vertex, yielding four
edges for the V polygon:

```
  (2,15) ─→ (3.5,10) ─→ (5,5) ─→ (6.5,10) ─→ (8,15)
```

After registration, vertices (3.5,10) and (6.5,10) are **shared** between the
rectangle and the V polygon. The rectangle's `kind` changes from `"rectangle"`
to `"polygon"` because its top edge was split.

### User action

The user activates the Trim/Split tool, hovers near the rectangle's top edge
segment _between_ the two intersection points — the segment (3.5,10)→(6.5,10)
that lies "inside" the V — and clicks.

### Result

Three new polygons are created (the originals are deleted):

1. **Main polygon** (closed): The rectangle's perimeter with the top-middle
   segment replaced by the V's inner downward notch. Traces:

   ```
   (6.5,10) → (10,10) → (10,0) → (0,0) → (0,10) → (3.5,10) → (5,5) → (6.5,10)
   ```

2. **Offcut 1** (open): The V's upper-left wing that now sticks out alone.

   ```
   (2,15) → (3.5,10)
   ```

3. **Offcut 2** (open): The V's upper-right wing.
   ```
   (6.5,10) → (8,15)
   ```

Conceptually, the trim has "cut out" the segment (3.5,10)→(6.5,10) and fused the
two shapes together along the remaining boundary. The V's wings above the
rectangle become separate dangling open polygons.

---

## How the Trim Works End-to-End

The trim flow lives in `TrimSplitTool.ts` and `DCELShapeIndex.ts` and proceeds
through five stages.

### 1. Hover Detection (`computeTrimSegment`)

When the cursor moves and does NOT trigger split-point detection (no 2+ segments
intersect at an exact point near the cursor), the tool falls back to finding the
nearest DCEL edge via `queryNearestSegment`:

1. Build a proximity bounding box around the cursor (in sheet units)
2. Iterate all DCEL edges via `queryBoundingBox` (Cohen-Sutherland filtered
   superset). For each candidate, compute the closest-point distance
3. Pick the edge with the smallest distance
4. Augment the result with `associatedGeometries` — every shape whose `edgePairs`
   includes this edge (searched in both directions)
5. Emit a `TrimSegment` event with the edge's endpoint vertex IDs, the segment
   data, and the associated geometry IDs

### 2. Click Handling (`processCurrentTrim`)

On mouse down with `type === 'trim-segment'`:

**Resolve half-edge IDs and exclusion set:**

```typescript
const cachedPair = dcel.getCachedEdgePair(trimSegment.pointAId, trimSegment.pointBId);
const excludedHeIds = [cachedPair.originToDest, cachedPair.destToOrigin];
const excludedEdgeKey = dcel.getEdgeKey(trimSegment.pointAId, trimSegment.pointBId);
```

**Collect affected shapes:**

Starts with `associatedGeometries` (shapes that own the exact trimmed edge),
then adds any shape whose `vertexIds` includes either endpoint vertex:

```typescript
const affectedShapeIds = new Set(trimSegment.associatedGeometries);
for (const result of dcelIndex.computeShapesForVertexId(trimSegment.pointAId)) {
  affectedShapeIds.add(result.id);
}
for (const result of dcelIndex.computeShapesForVertexId(trimSegment.pointBId)) {
  affectedShapeIds.add(result.id);
}
```

This is critical: the V polygon shares the trimmed segment's endpoints but does
NOT own the edge between them (its `edgePairs` contains incoming/outgoing edges
at those vertices, not the edge connecting them directly). The vertex-ID lookup
picks up this "touch" relationship.

**Walk combined boundary and partition offcuts, then create new geometry in
one history transaction:**

```typescript
historyManager.applyTransaction('trim-segment', () => {
  for (const sid of shapeIds) {
    geometryStore.deleteById(sid);
  }
  geometryStore.add(ID_PREFIXES.polygon, mainPolygon);
  for (const offcut of offcutPolygons) {
    geometryStore.add(ID_PREFIXES.polygon, offcutPolygon);
  }
});
```

### 3. `walkCombinedBoundary` — Tree-Based Graph Walk

This is the core algorithmic piece. It constructs the boundary of the fused
shape by walking the DCEL, hopping between face loops at shared vertices,
and skipping the excluded edge.

#### Phase 1: Vertex→edges adjacency

Iterate all undirected DCEL edges via `allEdgeSegments()`. For each, map BOTH
directed half-edges to their respective origin vertices. Each entry stores:

| Field      | Description                                                            |
| ---------- | ---------------------------------------------------------------------- |
| `he`       | The half-edge object (`id`, `originId`, `twinId`, `nextId`, `faceIds`) |
| `shapeIds` | Resolved from `he.faceIds` via the `_faceToShapeIds` map               |
| `length`   | Euclidean distance between the edge's endpoints                        |

This produces a directed adjacency map keyed by vertex. Every half-edge
(including twins) is present, so at any vertex you can enter via one
half-edge and exit via any other non-excluded, non-twin half-edge.

#### Phase 2: Branch-and-bound traversal

Start at `startVertexId`. Pick the first non-excluded outgoing half-edge.
Maintain a list of in-flight traversals, each tracking:

- Current half-edge
- Shape ID stack (which shapes' face loops we are currently walking)
- Accumulated distance
- Visited half-edge set
- Result path (array of traversed half-edges)

The while-loop pops traversals (LIFO / depth-first) and processes each:

**Dead-end detection:** If `he.nextId` is null, the edge is orphaned (prev
pointer invalid or the face loop is broken). The traversal is marked as
non-closable and saved for distance comparison.

**Loop closing:** Compute `destVertexId = twin.originId` (the destination
vertex of the current half-edge). If equal to `startOriginId`, the walk has
returned. The total distance is recorded and all in-flight traversals with
_greater_ distance are pruned — this is the branch-and-bound mechanism that
prevents combinatorial explosion.

**Branching:** At `destVertexId`, collect ALL non-excluded, non-visited,
non-twin outgoing half-edges. For each candidate:

| Condition                             | Action                                            |
| ------------------------------------- | ------------------------------------------------- |
| Candidate's shape is on the stack     | Stay on same stack, push traversal                |
| Candidate's shape is NOT on the stack | Push the new shape onto the stack, push traversal |

Each candidate spawns a new traversal path. This tree can grow exponentially
at vertices where multiple shapes share a vertex, but loop-closing pruning
keeps it bounded.

**Result selection:** After the while-loop, the walk selects among all
completed (closed and dead-end) paths using a compound ranking system.
See the dedicated "Path Selection" section below for details.

#### Path Selection

`walkCombinedBoundary` returns the single best path from all traversals.
The selection algorithm uses a three-level sort to pick among competing
paths:

**Level 1 — Shape-count delta:**

```
delta = |path.traversedShapes - targetShapeCount|
```

`targetShapeCount` = |Set(shapeIds)| = number of uniquely-affected
shapes. The walk was seeded with `shapeIds[0]` and each time it
branches into a new shape's face, `traversedShapes` increments. A path
whose `traversedShapes` matches `targetShapeCount` has visited exactly
the right number of distinct shapes. Closer to target wins.

This handles cases like the three-rectangle scenario where one path
goes through only the two affected shapes (delta=0) and another goes
through all three including an unrelated shape (delta=1).

**Level 2 — Compactness (A/P³):**

```
ratio = area / perimeter³
```

Area is computed via the shoelace formula on chord vertices (straight-line
approximation, ignoring Bezier control points). Perimeter is the sum of
chord distances. Cubing the perimeter heavily penalizes extra path length:
a path that goes 50% further reduces its score by a factor of 3.4×,
outweighing any reasonable area gain.

This handles the two-overlapping-rectangle L-shape case: the union path
has both more area and more perimeter, but the perimeter penalty dominates,
so the tight L-shape boundary wins.

**Level 3 — Result length (lasso vs. non-lasso tiebreaker):**

When A/P³ is effectively tied (extremely rare), lasso paths are ranked
by `resultLength` descending (longer lasso = more of the full boundary
captured), and non-lasso paths by `resultLength` ascending (tighter
boundary preferred).

**Fallback:** If no closed path exists (open polygon trim on a terminal
edge), pick the shortest dead-end path by Euclidean distance.

#### Why this works

In the example, the traversal tree looks like:

```
start at (6.5,10): (6.5,10)→(10,10) [rect A, stack=[rectA]]
  → (10,10)→(10,0)
  → (10,0)→(0,0)
  → (0,0)→(0,10)
  → (0,10)→(3.5,10)
    At (3.5,10):
      ├── (3.5,10)→(2,15)   [poly B twin, no faceIds, dead end → discarded]
      └── (3.5,10)→(5,5)    [poly B, new shape → stack=[rectA, polyB]]
           → (5,5)→(6.5,10) [poly B, same shape → LOOP CLOSED]
```

The dead-end path up to (2,15) terminates without closing. The closed path is
the rectangle perimeter minus the trimmed top-middle segment, plus the V's
inner edges.

### 4. Offcut Partitioning

For each affected shape, walk its full face loop via `getShapeFaceLoop`
(`dcel.walkFaceLoop` following `nextId` from the tracked shape's first
half-edge). Partition the loop's edges into offcut runs:

1. Compute the undirected edge key for each loop half-edge
2. If edge key equals `excludedEdgeKey` → flush current offcut run, skip
3. If edge key is in `boundaryEdgeKeys` (built from the combined boundary) →
   flush current offcut run (this edge is part of the new main boundary)
4. Otherwise → collect the half-edge into the current offcut run

`_faceLoopToPolygonPoints` converts each run into `PolygonSegment` arrays
by resolving vertex positions and curve contexts from the DCEL. Open runs
append the last edge's destination vertex when it differs from the first.

In the example:

- **Rectangle A** face loop: every edge is either in the boundary or is the
  excluded edge. **Zero offcuts** — the rectangle is completely consumed into
  the main boundary.
- **V polygon** face loop:
  - (2,15)→(3.5,10): NOT in boundary → collect
  - (3.5,10)→(5,5): IN boundary → flush offcut 1
  - (5,5)→(6.5,10): IN boundary → flush none (nothing collected)
  - (6.5,10)→(8,15): NOT in boundary → flush offcut 2

### 5. Shape Creation

In a single history transaction:

1. Delete all original affected shapes
2. Create the main closed polygon from the combined boundary
3. Create each offcut as an open polygon

The main polygon's points are built by `_faceLoopToPolygonPoints` applied to
the boundary result, which preserves curve contexts (cubic/quadratic bezier
metadata) from the DCEL edge cache.

---

## Edge Cases

### Dead ends at leaf vertices

When a traversal reaches a vertex with only one outgoing half-edge (the one it
just arrived on), it has no next edge and is marked non-closable. Dead-end
paths are always discarded in favor of closed loops.

### Shapes that only touch at the trimmed edge's endpoints

The V polygon in the example does not own the trimmed edge, it only shares the
endpoint vertices. The `computeShapesForVertexId` roundup is essential for
picking up these "touch" relationships. Without it, the V polygon would not
be affected by the trim and would remain as a dangling separate shape.

### Open vs. closed offcuts

Offcut runs are converted to open polygons. The `_faceLoopToPolygonPoints`
method appends the final vertex only when the resulting polygon differs from
the start vertex (distance check vs `0.001` epsilon). Single-edge offcuts
produce 2-point open polygons.

### Relations between `shapeIds` parameter and the stack

`walkCombinedBoundary` receives `shapeIds` as the list of all affected shapes
(same as `affectedShapeIds`). The initial stack is seeded with `shapeIds[0]`,
which is the first shape in iterator order from the Set. At branching points,
the `isOnStack` check prevents infinite re-entry: once a shape is on the
stack, edges belonging to that shape don't grow the stack further.

---

## Known Issues / Follow-Ups

- **Four-corner fillet degeneracy**: When multiple circles share the same
  DCEL face ID (e.g., four inset circles at each corner of a rectangle),
  `traversedShapes` cannot distinguish which circle the walk traversed.
  After trimming the top-right corner, both the correct TR-only fillet
  path and a wrong TL-only (or all-four-circles) path have the same
  `traversedShapes` matching `targetShapeCount`. The A/P³ tiebreaker
  may favor the wrong path because the multi-circle lasso is geometrically
  more compact. A proper fix would require identifying which specific
  face IDs intersect the trimmed edge rather than counting distinct face
  IDs globally.
- **Constraint migration**: When shapes are deleted and recreated during
  trimming, any constraints (linear, perpendicular, etc.) referencing the old
  shape IDs are orphaned. These should be migrated or re-mapped.
- **Leftover `console.log`**: `processCurrentTrim` contains
  `console.log('OFFCUT', offcutPolygons)` on line 320.
- **Edge traversal for the "other side" of the boundary**: The current
  implementation only computes one combined boundary. If the same edge is
  trimmed at both ends, two separate combined boundaries might be needed.
