# DCEL (Doubly Connected Edge List)

The DCEL models the planar subdivision of the drawing. Every vertex, edge, and face in the geometry is represented, and the structure is kept consistent even as shapes overlap, split, and merge. This document covers the architecture, the hard-won lessons from implementing it, and the subtle edge cases that trip up newcomers.

## Core Data Structures

The DCEL has three fundamental records, each identified by a branded ID type (`VertexId`, `HalfEdgeId`, `FaceId`):

- **Vertex**: stores a position (`P extends Position`). Vertices are deduplicated by exact position via a position-index map (`"x,y" -> VertexId`).
- **HalfEdge**: a directed edge. Stores `originId`, `twinId`, `nextId`, `prevId`, and the `faceIds` array (see below). The twin always goes in the opposite direction.
- **Face**: a region bounded by a loop of half-edges. Anchored by one boundary half-edge.

The half-edge pairs that make up an undirected edge are created together. The "origin->dest" half-edge is the one whose `originId` matches the caller's first argument to `addEdge`. The cache stores which one is which so that a second caller adding the same edge in the opposite direction gets back the pair in the correct order.

## Reference Counting (the foundation)

Both vertices and half-edges are reference-counted. This is the mechanism that makes shared geometry work.

### Vertex ref-counting

`addVertex(pos)` checks the position index. If a vertex already exists at that position, its ref count is incremented and the existing `VertexId` is returned. If not, a new vertex is created with ref count 1.

`releaseVertex(id)` decrements the ref count. Only when it reaches zero is the vertex truly removed from the DCEL (its entry in `_vertices`, `_positionIndex`, `_vertexRefCount`, and `_outgoing` are all deleted). **Critically, when a vertex is culled, all its remaining outgoing half-edges are released via `releaseEdge`**  --  this is the mechanism that cascades cleanup.

### Edge ref-counting

`addEdge(originId, destId)` checks the edge cache (keyed by `sorted(originId, destId).join("|")`). If the edge already exists, the ref count is bumped and the existing half-edge IDs are returned in the caller's requested direction order. If not, a new half-edge pair is created with ref count 1.

`releaseEdge(originId, destId)` decrements the ref count. At count zero, the half-edge pair is removed from `_halfEdges`, the edge cache, and the outgoing sets of both endpoint vertices.

### The ref-count consistency invariant

Edges are always released **before** vertices during shape removal. This ordering guarantees that when a vertex reaches ref count zero and iterates its outgoing set, those edges have already been cleaned up by their owning shape's release. Violating this order (e.g., calling `releaseVertex` on a vertex whose edges haven't been released) triggers cascading `releaseEdge` calls that can leave the edge cache in an inconsistent state.

## Face Tracking (`faceIds`)

Each half-edge carries an array of face IDs rather than a single nullable face ID. Multiple shapes that share the same directed half-edge each push their face ID onto this array. The convention is that `faceIds[0]` is the "active" face  --  the first shape that registered on that half-edge.

### When face IDs get assigned

During shape registration, `assignFace(startHeId, faceId, walkLoop=true)` walks the entire face loop and pushes `faceId` onto every half-edge in the loop. Only the loop-direction half-edges get stamped  --  the twins remain empty (or get stamped by the shape on the other side).

### The faceId cloning bug

When `splitEdge` splits an existing edge into two, it clones the face IDs from the old half-edges onto the new ones. The direction matters:

```
splitEdge(originId, destId, splitVertexId)
  -> creates [osId, soId, sdId, dsId]
  -> osId = origin->split, gets originToDest faceIds
  -> sdId = split->dest, gets originToDest faceIds
  -> dsId = dest->split, gets destToOrigin faceIds
  -> soId = split->origin, gets destToOrigin faceIds
```

**The bug that burned us:** a shape whose loop direction is **opposite** to `splitEdge`'s argument direction gets the wrong face IDs on its loop half-edges. For example, if a shape uses `dsId` (dest->split) as its loop half-edge, it gets `destToOrigin` faceIds -- but it should get `originToDest` faceIds (since the shape's loop direction through the original edge was `dest->origin`, which corresponds to the `originToDest` flow).

The fix: in the DCELShapeIndex's Phase 4 update code, when the shape's direction is opposite to the splitEdge arguments, swap the face IDs between the loop half-edges and their twins.

This bug manifested as face IDs appearing on the wrong half-edges of shared edges, which in turn caused the merge pass to fail condition checks or produce incorrect merged states.

## Edge Splitting (`splitEdge`)

When a new shape's edge crosses an existing DCEL edge, the existing edge is split at the intersection point. This replaces one undirected edge with two:

```
  A ---------- B      A ----- P ----- B
       splitEdge(A, B, P)
```

`splitEdge` is a DCEL-level primitive. It:
1. Saves faceIds from both old directed half-edges
2. Removes the old half-edge pair from `_halfEdges`, `_outgoing`, and the edge cache
3. Creates two new half-edge pairs: (A->P, P->A) and (P->B, B->P)
4. Clones the saved faceIds onto the corresponding new half-edges (see faceId section above)
5. Transfers the old edge's ref count to both new edges
6. Sets up the edge cache entries for the two new edges

It does **not** relink face loops or update tracked shapes  --  the caller is responsible for that.

### Multi-split on a single edge

When an existing edge has multiple intersection points (e.g., two new edges cross it at different positions), each `splitEdge` call creates new edges. The second call targets the "tail" segment from the first split:

```
  A ----- P1 ----- B    ->    A ----- P1 ----- P2 ----- B
```

The `currentOriginId` and `currentDestId` are updated after each split to track the remaining segment.

## Colinear Edge Merging (`mergeEdges`)

When a shape is removed, edges that were previously split at intersection points become colinear with their neighbors. The `mergeEdges` method is the inverse of `splitEdge`: it replaces two adjacent edges with one.

### Merge conditions

The `_mergeColinearEdges` pass (called at the end of `_removeShape`) checks each tracked shape for consecutive edge pairs that meet ALL of these conditions:

1. **Adjacent**: edge(i).destId === edge(i+1).originId (share the middle vertex)
2. **Exactly 2 outgoing half-edges** at the middle vertex (no other shape uses this vertex)
3. **Colinear**: cross product of direction vectors is near zero
4. **Matching faceIds**: the loop half-edges of both edges have identical faceIds, AND both twin half-edges have identical faceIds

If all conditions are met, the two edges are merged into one and the middle vertex is released.

### The merge-across-shapes trap

When two shapes share an edge (e.g., stacked rectangles with a shared boundary), and that edge was split, BOTH shapes' tracked data references the split segments. When one shape's merge pass runs, it calls `mergeEdges` on the split segments  --  which removes the old edge cache entries and creates one merged entry. When the SECOND shape's merge pass runs for the same edge, it finds the merged entry already in the cache (via `getCachedEdgePair`). Instead of calling `mergeEdges` again, it uses `addEdge` to bump the ref count. This is essential: without the `addEdge` call, the merged edge would have ref count 1 when two shapes share it, and the first shape's removal would cull the edge out from under the second shape.

## Zero-Length Self-Loop Edges

A chronic source of subtle bugs: half-edges where `originId === twin.originId`. These are created when `addHalfEdge(a, a)` is called, which happens when `addEdge` is called with the same vertex for both origin and dest.

### How they were introduced

The intersection detection in Phase 2 of shape registration detects intersections at **existing vertices** (e.g., a new rectangle's corner sits exactly on an existing shape's edge endpoint). Phase 4 correctly skips these (the `splitVId === currentOriginId || splitVId === currentDestId` guard). But Phase 5 (adding the new shape's edges with split points) did NOT have this guard  --  it would call `addVertex(point)` at the intersection point (which returns the EXISTING vertex via dedup), then call `addEdge(prevVId, interVId)` where both were the same vertex ID.

### The fix

In Phase 5, skip the segment when `prevVId === interVId`:
```typescript
if (prevVId === interVId) continue; // coincident with existing vertex
```

This prevents the self-loop from being created in the first place. Also, `allEdgeSegments` now filters out any self-loops that DO exist (from legacy data or other paths) as a safety measure.

## Shape Registration Flow (6 Phases)

When a shape enters the DCEL via `_registerShape`, it goes through these phases:

### Phase 1: Create vertices
Create a vertex for each of the shape's positions via `addVertex` (handles dedup). Build the candidate edge list (origin->dest pairs) that will be used for intersection detection.

### Phase 2: Batch intersection detection
Snapshot ALL existing DCEL edges via `allEdgeSegments()`. For each candidate edge:
1. Compute its bounding box
2. For each existing edge, run Cohen-Sutherland broad-phase rejection (line-segment-vs-AABB)
3. If the broad-phase passes, run exact `computeLineSegmentIntersection`
4. Store each intersection with its t-parameter (along new edge) and u-parameter (along existing edge)

This is the hottest path. With 100+ shapes, every new edge is checked against every existing edge. The shape-level bounding box pre-filter is the most impactful optimization to add next.

### Phase 3: Group intersections
Group the collected intersections by existing edge key (for Phase 4 splitting) and by new edge key (for Phase 5 insertion).

### Phase 4: Split existing edges
For each existing edge with one or more intersections:
- Sort by u along the existing edge
- Create a vertex at each intersection point (may deduplicate with existing vertex)
- Call `splitEdge` on the DCEL
- Update EVERY tracked shape that owned the split edge (both directions  --  search edgePairs with `(a===origin && b===dest) || (a===dest && b===origin)`)
- For each owning shape: insert the split vertex into `vertexIds`, replace the old edge pair entry with two new entries, update `halfEdgeIds`, and if the shape was a "rectangle", change its kind to "polygon"
- After ALL splits, bulk re-link the loops of all affected shapes by iterating their final `halfEdgeIds` arrays

### Phase 5: Add new shape edges with split points
For each candidate edge of the new shape, check if there are intersections on it. If not, add it normally via `addEdge`. If there are, create vertices at each intersection point, add edges between consecutive vertices, and skip zero-length segments (the `prevVId === interVId` guard). The last segment goes from the last intersection point to the original destination.

### Phase 6: Link loop, assign face, store tracked shape
Link the new shape's edges into a CCW loop via `linkNext`, create a new face via `addFace`, stamp it onto the loop via `assignFace(push)`, and store the tracked shape data.

## Shared Edge Lifecycle

Two shapes sharing an edge (e.g., stacked rectangles) is a common case that exercises many of the DCEL's features:

1. **Registration**: The first shape calls `addEdge(A, B)`, creating a new half-edge pair with ref count 1. The second shape calls `addEdge(A, B)` (or `addEdge(B, A)`  --  the cache normalizes by sorted key). The cache returns the existing pair, and ref count becomes 2.

2. **FaceIds**: The first shape's `assignFace` stamps the `origin->dest` loop half-edge. The second shape's `assignFace` stamps the `dest->origin` loop half-edge (the twin of the first). Each directed half-edge now has exactly one faceId.

3. **Splitting**: When a third shape's edge crosses the shared edge, `splitEdge` creates two new segments. Both new segments inherit ref count 2. Both owning shapes get their tracked data updated. The face IDs are cloned to both new segment half-edges.

4. **Removal of the third shape**: Triggers `_mergeColinearEdges`. The first shape's segments are merged, creating a new cache entry for the merged edge. The second shape finds the existing cache entry and calls `addEdge` to bump the ref count.

   The ref count flow: each split segment had ref count 2 (owned by both shapes). `mergeEdges` transfers the ref count from one segment pair to the new edge, giving it ref count 2. When the second shape calls `addEdge` on the already-merged edge, the cache returns the existing half-edges and bumps ref count from 2 to 3. This is correct -- both shapes now hold a reference to the single merged edge.

5. **Removal of one owning shape**: `releaseEdge` decrements ref count from 3 to 2. The edge survives.

6. **Removal of the last owning shape**: `releaseEdge` decrements from 2 to 0 (or 1 to 0, depending on the merge path). Edge is culled.

### The lingering vertex problem

After all shapes are removed, the shared edge's endpoint vertices may persist with ref count > 0. This is a known issue with the current implementation  --  the exact cause is that during the merge pass, `releaseVertex` is called for the middle vertex but the endpoint vertices' ref counts may not reach zero because of the order in which edge releases vs vertex releases interact across the two shapes.

## Debounced DCEL Sync

In `GeometryStore`, the DCEL index is synced differently depending on the operation:
- **Add/delete**: synced immediately (the shape is created or destroyed  --  no intermediate states)
- **Update**: debounced per shape ID via `lodash.debounce` with a 200ms delay. Each shape ID gets its own independent debounce timer. During a drag, the DCEL is updated 200ms after the last change to each specific shape.

This makes the DCEL eventually consistent during rapid interactions. The constraint solver and intersection detection should tolerate stale DCEL data during a drag  --  they only need to recompute when the user pauses.

## `kind` Mutation

When a rectangle's edge is split (Phase 4), its `kind` changes from `"rectangle"` to `"polygon"`. This is necessary because:
- After splitting, the shape has more than 4 vertices and no longer forms a simple axis-aligned rectangle
- The `computeEngineConstraints` method relies on `kind === "rectangle"` to generate auto horizontal/vertical constraints using `vertexIds[0..3]` as `[ul, ur, lr, ll]`  --  this assumption breaks after splitting

When colinear edges are later merged (Phase 5 via merge pass), the shape's edges go back to 4 but the `kind` is NOT changed back to `"rectangle"`. This is intentional: once a shape has been through the intersection pipeline, it's treated as a generic polygon.

## Performance Characteristics

- **Detection phase** scales linearly with the number of existing edges. At 100 shapes (~400 edges), detection takes ~0.15ms per new shape. At 1000 shapes (~4000 edges), it would be ~1.5ms.
- **Cohen-Sutherland** helps per edge-pair but doesn't reduce the number of pairs checked. Each new shape's 4 edges iterate all existing edges regardless of distance.
- **Shape-level bounding box pre-filter** is the biggest potential optimization  --  skip all edges of shapes whose bounding box doesn't overlap the new shape's bounding box. This would reduce the candidate set from "all edges" to "edges of overlapping shapes only" (typically 2-4 shapes instead of 100).
- **Spatial grid** (binning edges into fixed-size cells) would further reduce it to O(1) per edge, but adds maintenance cost on every add/remove/split/merge.

## Common Pitfalls

1. **Direction-dependent cache lookups**: `_edgeKey` uses `sorted(originId, destId)`  --  this is symmetric, so `addEdge(A,B)` and `addEdge(B,A)` use the same key. But the RETURNED half-edge IDs depend on the caller's argument order. The `heAb.originId === originId` check determines which is returned first.

2. **Opposite-direction faceIds**: Shapes using the opposite loop direction from splitEdge's arguments get wrong faceIds. The fix is in the Phase 4 tracked-shape update code.

3. **Zero-length self-loops**: Always guard against `addEdge(a, a)` in Phase 5 (and anywhere else split points are inserted).

4. **Merge pass running over already-merged edges**: When two shapes share an edge, the first shape's merge creates the cache entry. The second shape must NOT call `mergeEdges` again  --  it must use `addEdge` to bump the ref count and update its tracked data.

5. **Dual-direction search for owning shapes**: When finding which tracked shapes own an edge during splitting/merging, always search both directions  --  `(a===origin && b===dest) || (a===dest && b===origin)`.

6. **`releaseVertex` cascading** through `releaseEdge`: When a vertex is culled at ref count 0, it releases all its incident half-edges. This can remove edges from the cache and corrupt other shapes' tracked data if they still reference those edges.
