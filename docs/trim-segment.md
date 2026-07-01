# Segment Trim via the Trim/Split Tool

## The Rectangle and the V

Two shapes live in the DCEL. Shape A is a rectangle from (0,0) to (10,10). Shape B is an open V-shaped polygon from (2,15) to (5,5) to (8,15). Both arms of the V cross the rectangle's top edge.

Registration discovers two intersections. The left arm hits the top edge at (3.5,10). The right arm hits at (6.5,10). Phase 4 splits the rectangle's top edge into three pieces. Phase 5 splits each V-arm at its intersection vertex.

```
Rectangle top edge:
  (0,10) ── (3.5,10) ── (6.5,10) ── (10,10)

V polygon edges:
  (2,15) → (3.5,10) → (5,5) → (6.5,10) → (8,15)
```

Vertices (3.5,10) and (6.5,10) are shared between both shapes. The rectangle's kind changes from `rectangle` to `polygon`. Its top edge was split.

The user hovers near the middle top segment (3.5,10)→(6.5,10) and clicks. Three new polygons appear. The originals are deleted.

1. Main polygon (closed): the rectangle's perimeter with a V-shaped notch in the top edge. Traces (6.5,10) → (10,10) → (10,0) → (0,0) → (0,10) → (3.5,10) → (5,5) → (6.5,10).

2. Offcut 1 (open): the V's upper-left wing. Traces (2,15) → (3.5,10).

3. Offcut 2 (open): the V's upper-right wing. Traces (6.5,10) → (8,15).

## Two Overlapping Rectangles

Rect A is (0,0) to (100,100). Rect B is (50,50) to (150,150). They overlap like a plus sign.

Registration creates intersection points. Rect A's right edge meets Rect B's bottom edge at (100,50). Rect A's top edge meets Rect B's left edge at (50,100). Rect A's edges are split. Rect B gains intersection vertices on its bottom edge at (100,50) and its left edge at (50,100). Since Rect B now has six vertices, its kind changes from `rectangle` to `polygon`.

The user hovers near the middle of the segment (100,50)→(100,100) on Rect A's right edge and clicks.

The combined boundary walks: (100,50) → (100,0) → (0,0) → (0,100) → (50,100) → (50,50) → (100,50). This is the L-shaped polygon formed by Rect A plus the overlapping square.

One offcut comes from Rect A: the top-right edge (100,100)→(50,100). Two points. Another offcut comes from Rect B: the outer perimeter that sticks out from the L, tracing (100,50)→(150,50)→(150,150)→(50,150)→(50,100). Five points.

Three new polygons total. One closed L-shape and two open offcuts.

## A Non-Closed Polygon

A single open polygon has three points: (0,0) → (100,0) → (100,100). It has two edges. The user clicks near the middle of the first edge (0,0)→(100,0).

The combined boundary walks from the other endpoint (100,0) along the remaining edge (100,0)→(100,100). This is a dead end. No valid next edges exist. The walk records it as a non-closed path. There are no offcuts.

A new open polygon is created with two points: (100,0) → (100,100). The original polygon is deleted.

## How the Trim Works

The trim flow lives in TrimSplitTool.ts and DCELShapeIndex.ts. It has five stages.

### 1. Hover Detection

The cursor does not trigger split-point detection. There is no intersection of two or more segments at the cursor. The tool falls back to finding the nearest DCEL edge.

`queryNearestSegment` builds a proximity bounding box around the cursor. It iterates all DCEL edges inside that box. It picks the edge whose closest point is nearest to the cursor. It augments the result with every shape whose edgePairs include this edge. That search is bidirectional.

The function returns a TrimSegment event. It carries the edge's endpoint vertex IDs, the segment data, and the associated geometry IDs.

### 2. Click Handling

`processCurrentTrim` receives the TrimSegment event. It resolves both half-edge IDs for the trimmed DCEL edge. These become the excluded set.

It collects all affected shapes. It starts with the shapes that own the exact edge. It then adds every shape that shares either endpoint vertex. The vertex-ID roundup is critical. A shape may only touch the trimmed edge at its endpoints without owning it. The V polygon in the first example is such a shape.

It calls `walkCombinedBoundary` first with `pointAId` as the start vertex. If that returns null, it retries with `pointBId`. The retry is necessary when the trimmed edge is a terminal edge of an open polygon. The only outgoing edge at pointAId is the excluded edge itself.

A single half-edge in the boundary is valid. The boundary guard allows `result.length >= 1`.

The function then builds an edge-key set from the boundary. It walks each affected shape's face loop. It partitions the loop into offcut runs. Edges in the boundary are flushed. Edges outside the boundary are collected. The excluded edge is skipped.

Each offcut run becomes an open polygon. `_faceLoopToPolygonPoints` converts half-edges to point arrays. It adds the last edge's destination when the chain is open.

The function applies a single history transaction. It deletes all original shapes. It creates the main boundary polygon. It creates each offcut polygon.

### 3. walkCombinedBoundary

This is the core algorithm. It builds the boundary of the fused shape. It walks the DCEL and hops between face loops at shared vertices. It skips the excluded edge.

The algorithm does not use `nextId` for pathfinding. Phase 4 of registration only relinks the forward loop after edge splits. The reverse loop (twin half-edges) may have `nextId = null`. The algorithm uses its own adjacency map built from `allEdgeSegments`. A missing `nextId` does not mean a dead end.

#### Phase 1: Adjacency Map

Iterate every undirected edge in the DCEL. Map both directed half-edges to their origin vertices. Each entry stores the half-edge object, the shape IDs resolved from its faceIds, and the Euclidean edge length.

This map is keyed by vertex. Every half-edge is present, including twins. At any vertex you can enter on one half-edge and exit on any other non-excluded, non-twin half-edge.

#### Phase 2: Tree Walk

The algorithm maintains a list of in-flight traversals. Each traversal tracks the current half-edge, the shape ID stack, the accumulated distance, the visited half-edge set, and the result path.

Start at `startVertexId`. Pick the first non-excluded outgoing half-edge. Push the first shape ID from the shapeIds array onto the stack. Seed the traversals list with this initial edge.

The while-loop pops traversals in LIFO order. For each traversal, it computes the destination vertex from the twin half-edge's origin.

If the destination equals the start vertex and the result has more than one edge, the loop closes. A single-edge result is not a real loop. The twin of one edge always originates at the start. This guard prevents false loop closures. The total distance is recorded. All in-flight traversals with greater distance are pruned. This is the branch-and-bound mechanism.

If the twin does not exist, the half-edge is orphaned. The traversal is pushed to the complete list as non-closed.

If the destination vertex has candidates, the algorithm pushes a new traversal for each valid, non-excluded, non-visited, non-twin half-edge. A candidate with a shape not on the stack pushes that shape onto the stack. A candidate whose shape is already on the stack stays on the same stack.

If the destination vertex has no valid candidates, the traversal dead-ends. It is pushed to the complete list as non-closed.

#### Result Selection

After the while-loop, the algorithm filters to closed traversals. It sorts by ascending distance. It returns the shortest closed loop.

If no closed loop exists, it falls back to the shortest non-closed path. This handles open polygons. The trimmed edge is a terminal edge. The walk necessarily reaches a leaf vertex with no valid outgoing edges.

The function returns null only when the complete list is empty.

### 4. Offcut Partitioning

For each affected shape, walk its full face loop. `getShapeFaceLoop` follows `nextId` from the tracked shape's first half-edge.

For each half-edge in the loop, compute the undirected edge key from the half-edge's origin and its twin's origin.

If the key equals the excluded edge key, flush the current offcut run and skip this edge. If the key is in the boundary edge keys, flush the current offcut run. Otherwise, collect the half-edge into the current offcut run.

At the end of the loop, flush any remaining run.

`_faceLoopToPolygonPoints` converts each run to polygon segments. It adds the origin point of each half-edge. When the run is open, it appends the last edge's destination if it differs from the first point.

### 5. Shape Creation

A single history transaction wraps all changes. Delete every original affected shape. Create the main polygon from the boundary. Create each offcut as an open polygon.

## DCEL Registration Invariants

**Phase 4 must link the reverse loop.** When `splitEdge` creates new half-edges, both the forward loop (even halfEdgeIds indices) and the reverse loop (odd indices) must be linked. The reverse loop is linked in descending order: `linkNext(halfEdgeIds[last], halfEdgeIds[last-2])` and so on. The reverse loop closes only for closed shapes. The check for closedness is `edgePairs[last].destId === edgePairs[0].originId`.

**A rectangle that gains intersection vertices becomes a polygon.** When Phase 5 adds split points to a rectangle's edges, the rectangle's `vertexIds` grows beyond the original perimeter. The shape's `kind` must change from `rectangle` to `polygon`. This happens before `this.shapes.set(id, ...)` at the end of `_registerShape`. The check is `vertexIds.length > perimeterPositions.length + extraPositions.length`. Without this, `computeShapesForVertexId` throws on null-labeled vertices.

## Known Issues and Follow-Ups

**Constraint migration.** Shapes are deleted and recreated during trimming. Constraints that reference the old shape IDs become orphaned. They must be migrated or re-mapped.

**Leftover console.log.** Line 320 of TrimSplitTool.tsx prints `OFFCUT` with the offcut polygon data.

**Boundary direction and winding.** The shortest closed loop is returned regardless of winding direction. The combined boundary may wind clockwise or counter-clockwise. Tests should use sorted point comparisons or accept either winding.

**Single-edge boundary for open trim.** A non-closed polygon with a terminal trimmed edge produces a boundary with exactly one half-edge. `_faceLoopToPolygonPoints` converts this to two points. The boundary guard must accept `result.length >= 1`.

**Start vertex fallback.** `walkCombinedBoundary` takes a single start vertex. For terminal edges, one endpoint may have no valid outgoing edge (the excluded one). `processCurrentTrim` must try both endpoints.

**Non-closed fallback in walkCombinedBoundary.** When no closed loop is found, the algorithm must return the shortest non-closed path. This is not a fallback for degenerate cases. It is the correct result for open polygons.
