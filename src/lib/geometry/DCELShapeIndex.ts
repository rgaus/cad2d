// ============================================================
// DCELShapeIndex
// ============================================================
// A thin layer on top of DCEL<SheetPosition> that knows how to
// translate domain shapes (Rectangle, Ellipse, Polygon) into
// DCEL vertices and edges, and keeps the two in sync.
//
// Vertices are reference-counted at the DCEL level, so two
// shapes whose corners happen to coincide automatically share
// the same vertex and that vertex is only culled once the last
// shape referencing it is removed.
//
// Curved segments (bezier arcs and ellipses) are linearized into
// straight-line edges. Adjust ELLIPSE_SEGMENTS and BEZIER_SAMPLES
// below, or pass them to the constructor, to trade accuracy for
// performance.
//
// Edges are also reference-counted (via addEdge / releaseEdge in the
// DCEL), so two shapes that share both endpoints of an edge will get
// the same half-edge pair back, with the edge surviving until both
// shapes release it.  This mirrors how vertices are shared.
// ============================================================
import { type EngineConstraint, type PointId } from '@/lib/constraint-engine';
import DCEL, { type FaceId, type HalfEdge, type HalfEdgeId, type VertexId } from '@/lib/dcel';
// Adjust the import path to wherever your shape types live.
import {
  type Constraint,
  type ConstraintEndpoint,
  type CubicBezierSegment,
  DatumComponent,
  Ellipse,
  EllipseComponent,
  FillColorComponent,
  Geometry,
  type Id,
  LinkDimensionsComponent,
  type Polygon,
  PolygonComponent,
  PolygonSegment,
  RectangleComponent,
  RenderOrderComponent,
} from '@/lib/geometry';
import {
  BoundingBox,
  CohenSutherland,
  DeCasteljau,
  Intersection,
  Vector2,
  closestPointOnSegment,
  convexPolygonWindOrder,
  ellipseToPolygon,
} from '@/lib/math';
import { boundingBoxContains, boundingBoxContainsPoint } from '@/lib/math';
import { UnitType } from '@/lib/units/length';
import {
  CubicCurve,
  LineSegment,
  QuadraticCurve,
  type Rect,
  SheetPosition,
} from '@/lib/viewport/types';

// ============================================================
// Internal tracking types
// ============================================================

type ShapeKind = 'rectangle' | 'ellipse' | 'polygon' | 'datum';

type EdgeCurveContext =
  | { type: 'quadratic'; controlPoint: SheetPosition }
  | { type: 'cubic'; controlPointA: SheetPosition; controlPointB: SheetPosition };

namespace EdgeCurveContext {
  export function split(
    start: SheetPosition,
    end: SheetPosition,
    ctx: EdgeCurveContext,
    t: number,
  ): [EdgeCurveContext, EdgeCurveContext] {
    switch (ctx.type) {
      case 'quadratic':
        const [startQuadratic, endQuadratic] = DeCasteljau.splitQuadraticBezier(
          QuadraticCurve.create(start, ctx.controlPoint, end),
          t,
        );
        return [
          { type: 'quadratic', controlPoint: startQuadratic.controlPoint },
          { type: 'quadratic', controlPoint: endQuadratic.controlPoint },
        ];
      case 'cubic':
        const [startCubic, endCubic] = DeCasteljau.splitCubicBezier(
          CubicCurve.create(start, ctx.controlPointA, ctx.controlPointB, end),
          t,
        );
        return [
          {
            type: 'cubic',
            controlPointA: startCubic.controlPointA,
            controlPointB: startCubic.controlPointB,
          },
          {
            type: 'cubic',
            controlPointA: endCubic.controlPointA,
            controlPointB: endCubic.controlPointB,
          },
        ];
    }
  }
  export function createSegment(start: SheetPosition, end: SheetPosition, ctx: EdgeCurveContext) {
    switch (ctx.type) {
      case 'quadratic':
        return QuadraticCurve.create(start, ctx.controlPoint, end);
      case 'cubic':
        return CubicCurve.create(start, ctx.controlPointA, ctx.controlPointB, end);
    }
  }
}

// Everything the index needs to remember about a registered shape
// in order to cleanly remove it later.
type TrackedShape = {
  kind: ShapeKind;
  // The kind this shape had at registration time. Never mutated, even
  // when kind is reclassified (e.g. rectangle -> polygon after an edge
  // is split). Useful for constraint inference and shape reconciliation
  // where the original logical type matters.
  originalKind: ShapeKind;
  // All vertex IDs this shape contributed (including shared ones).
  // We hold a reference count slot for each, so each entry here
  // corresponds to exactly one releaseVertex() call on removal.
  vertexIds: Array<VertexId>;
  // Labels parallel to vertexIds. Each entry is the named key point
  // (e.g. 'upperLeft', 'top', 'center') that this vertex represents,
  // or null for unnamed vertices (e.g. polygon vertices, intersection
  // split points).
  vertexLabels: Array<string | null>;
  // Parallel to vertexIds. true for vertices from the shape's original
  // geometry (Phase 1), false for vertices created by intersection
  // splitting (Phase 4 or Phase 5). Used to disambiguate original
  // geometry points from artificial intersection points during
  // constraint reconciliation and trim/split operations.
  vertexIdsOriginal: Array<boolean>;
  // Both half-edges of every undirected edge this shape added.
  // Kept for linkNext / face assignment during registration.
  halfEdgeIds: Array<HalfEdgeId>;
  // Undirected edge pairs for ref-counted release on removal.
  // Each pair maps to one call to releaseEdge().
  edgePairs: Array<{ originId: VertexId; destId: VertexId }>;
  // The face assigned to this shape's loop, used to remove the
  // correct faceId entry from shared half-edges on removal.
  faceId: FaceId;
  // When true, the vertexIds are stored in reversed order relative
  // to the original polygon points (because _polygonPoints reversed
  // a clockwise polygon to make it CCW for the DCEL). Used by
  // computeShapesForVertexId to map solver results back to the
  // correct polygon point indices.
  reversed: boolean;
};

/**
 * Result of intersecting a query segment against the DCEL.
 */
export type QuerySegmentIntersectionPoint = {
  point: SheetPosition;
  /** Parametric position along the query segment (0-1). */
  tOnSegment: number;
  /** Parametric position along the DCEL edge (0-1). */
  uOnDcelEdge: number;
  originPos: SheetPosition;
  destPos: SheetPosition;
  originId: VertexId;
  destId: VertexId;
  /** Shape IDs whose faces are registered on this half-edge. */
  geometries: Array<{ id: Id; segmentIndex: number }>;
};

// ============================================================
// DCELShapeIndex
// ============================================================

export class DCELShapeIndex {
  private _dcel = new DCEL<SheetPosition>();
  private shapes = new Map<Id, TrackedShape>();
  private _faceToShapeIds = new Map<FaceId, Id>();

  private edgeKeyToCurveContext = new Map<string, EdgeCurveContext>();

  // ----------------------------------------------------------
  // Expose the underlying DCEL for external queries
  // ----------------------------------------------------------

  get dcel(): DCEL<SheetPosition> {
    return this._dcel;
  }

  getCurveContext(originId: VertexId, destId: VertexId): EdgeCurveContext | undefined {
    return this.edgeKeyToCurveContext.get(this._dcel.getEdgeKey(originId, destId));
  }

  // ----------------------------------------------------------
  // Spatial queries
  // ----------------------------------------------------------

  /**
   * Check whether both endpoints of a DCEL edge belong to at least one shape's
   * original geometry (i.e. both vertices have {@link TrackedShape.vertexIdsOriginal}
   * set to true in the same shape). When false, the edge only exists because of
   * intersection splitting and can be filtered out by callers that only care
   * about original geometry.
   */
  private _edgeHasOriginalEndpoints(originId: VertexId, destId: VertexId): boolean {
    for (const [, shape] of this.shapes) {
      const oIdx = shape.vertexIds.indexOf(originId);
      const dIdx = shape.vertexIds.indexOf(destId);
      if (
        oIdx !== -1 &&
        dIdx !== -1 &&
        shape.vertexIdsOriginal[oIdx] &&
        shape.vertexIdsOriginal[dIdx]
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Return all DCEL edge segments whose bounding box might intersect the given
   * axis-aligned bounding box. Uses Cohen-Sutherland broad-phase for fast
   * rejection.
   *
   * If {@link partial} is set to true, then only one end of the edge segment must
   * be in the bounding box to pass the filter.
   *
   * If {@link includeIntersections} is set to false, edges whose endpoints are
   * not part of any shape's original geometry are excluded.
   */
  *queryBoundingBox(
    bbox: Rect<SheetPosition>,
    options: { partial?: boolean; includeIntersections?: boolean } = {},
  ): Generator<{
    originId: VertexId;
    destId: VertexId;
    originPos: SheetPosition;
    destPos: SheetPosition;
    curveContext: EdgeCurveContext | null;
  }> {
    for (const edge of this._dcel.allEdgeSegments()) {
      const dcelLine = LineSegment.create(edge.originPos, edge.destPos);

      let match = false;
      const partial = options?.partial ?? false;
      if (partial && boundingBoxContainsPoint(bbox, edge.originPos)) {
        match = true;
      } else if (partial && boundingBoxContainsPoint(bbox, edge.destPos)) {
        match = true;
      } else if (CohenSutherland.lineSegmentMightIntersectBoundingBox(dcelLine, bbox)) {
        match = true;
      }

      if (match) {
        const includeIntersections = options.includeIntersections ?? true;
        if (!includeIntersections && !this._edgeHasOriginalEndpoints(edge.originId, edge.destId)) {
          continue;
        }
        yield {
          ...edge,
          curveContext:
            this.edgeKeyToCurveContext.get(this._dcel.getEdgeKey(edge.originId, edge.destId)) ??
            null,
        };
      }
    }
  }

  /**
   * Query the DCEL for all intersections with the given arbitrary segment (line, quadratic
   * curve, or cubic curve). Results are yielded as they are found, in no
   * particular order. The caller should sort by tOnSegment if start -> end
   * order is needed.
   *
   * Intersections exactly at DCEL edge endpoints (u === 0 or u === 1) are
   * excluded to avoid double-counting at shared vertices.
   */
  *querySegmentIntersections(
    segment: LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition>,
  ): Generator<QuerySegmentIntersectionPoint> {
    // Compute the query segment's bounding box
    let bbox: Rect<SheetPosition>;
    if (LineSegment.isLineSegment(segment)) {
      bbox = LineSegment.boundingBox(segment);
    } else if (QuadraticCurve.isQuadraticCurve(segment)) {
      bbox = QuadraticCurve.boundingBox(segment);
    } else {
      bbox = CubicCurve.boundingBox(segment);
    }

    for (const edge of this.queryBoundingBox(bbox)) {
      const dcelLine = LineSegment.create(edge.originPos, edge.destPos);

      const intersections = Intersection.computeSegmentPairIntersections(segment, dcelLine);
      for (const [point, tOnSegment, uOnDcelEdge] of intersections) {
        // Exclude exact DCEL edge endpoints to avoid double-counting
        if (uOnDcelEdge <= 0 || uOnDcelEdge >= 1) {
          continue;
        }

        // Look up faceIds from both half-edges
        const cached = this._dcel.getCachedEdgePair(edge.originId, edge.destId);
        const geometries: Array<{ id: Id; segmentIndex: number }> = [];

        if (typeof cached !== 'undefined') {
          const heA = this._dcel.getHalfEdge(cached.originToDest);
          const heB = this._dcel.getHalfEdge(cached.destToOrigin);

          const seen = new Set<Id>();
          if (typeof heA !== 'undefined') {
            for (const fid of heA.faceIds) {
              const shapeId = this._faceToShapeIds.get(fid);
              if (typeof shapeId !== 'undefined' && !seen.has(shapeId)) {
                seen.add(shapeId);
                const segmentIndex =
                  this.shapes
                    .get(shapeId)
                    ?.edgePairs.findIndex(
                      (ep) => ep.originId === edge.originId && ep.destId === edge.destId,
                    ) ?? -1;
                geometries.push({ id: shapeId, segmentIndex });
              }
            }
          }
          if (typeof heB !== 'undefined') {
            for (const fid of heB.faceIds) {
              const shapeId = this._faceToShapeIds.get(fid);
              if (typeof shapeId !== 'undefined' && !seen.has(shapeId)) {
                seen.add(shapeId);
                const segmentIndex =
                  this.shapes
                    .get(shapeId)
                    ?.edgePairs.findIndex(
                      (ep) => ep.originId === edge.destId && ep.destId === edge.originId,
                    ) ?? -1;
                geometries.push({ id: shapeId, segmentIndex });
              }
            }
          }
        }

        yield {
          point,
          tOnSegment,
          uOnDcelEdge,
          originPos: edge.originPos,
          destPos: edge.destPos,
          originId: edge.originId,
          destId: edge.destId,
          geometries,
        };
      }
    }
  }

  /** Given a position, return the segment which is closest.
   *
   * If {@link includingIntersections} is true, then includes shorter segments which take into
   * account intersections with other {@link TrackedShape}s. */
  queryNearestSegment(
    position: SheetPosition,
    includingIntersections: boolean = false,
    options: { maxDistance?: number } = {},
  ) {
    const bbox = BoundingBox.proximity(position, options.maxDistance ?? 5);

    // Step 1: find nearest segment
    let nearest: {
      distance: number;
      pointAId: VertexId;
      pointBId: VertexId;
      segment:
        | LineSegment<SheetPosition>
        | QuadraticCurve<SheetPosition>
        | CubicCurve<SheetPosition>;
      associatedGeometries: Array<Id>;
    } | null = null;
    for (const existing of this.queryBoundingBox(bbox, {
      partial: true,
      includeIntersections: includingIntersections,
    })) {
      const dist = closestPointOnSegment(existing.originPos, existing.destPos, position);
      if (!nearest || nearest.distance > dist.distance) {
        nearest = {
          distance: dist.distance,
          pointAId: existing.originId,
          pointBId: existing.destId,
          segment: existing.curveContext
            ? EdgeCurveContext.createSegment(
                existing.originPos,
                existing.destPos,
                existing.curveContext,
              )
            : LineSegment.create(existing.originPos, existing.destPos),
          associatedGeometries: [],
        };
      }
    }

    // Step 2: Augment with associated geometries
    if (nearest !== null) {
      for (const [shapeId, shape] of this.shapes) {
        const pairIdx = shape.edgePairs.findIndex(
          (ep) =>
            (ep.originId === nearest.pointAId && ep.destId === nearest.pointBId) ||
            (ep.originId === nearest.pointBId && ep.destId === nearest.pointAId),
        );
        if (pairIdx !== -1) {
          nearest.associatedGeometries.push(shapeId);
        }
      }
    }

    return nearest;
  }

  // /** Given a position, return the segment which is closest.
  //   *
  //   * If {@link includingIntersections} is true, then includes shorter segments which take into
  //   * account intersections with other {@link TrackedShape}s. */
  // queryNearestPoint(
  //   position: SheetPosition,
  //   options: { maxDistance?: number } = {},
  // ) {
  //   const bbox = BoundingBox.proximity(position, options.maxDistance ?? 5);

  //   let nearest: {
  //     distance: number;
  //     pointId: VertexId;
  //     pointPos: SheetPosition;
  //     associatedGeometries: Array<{ id: Id; pointIndex: number }>;
  //   } | null = null;
  //   for (const existing of this.queryBoundingBox(bbox, { partial: true })) {
  //     const dist = closestPointOnSegment(existing.originPos, existing.destPos, position);
  //     if (!nearest || nearest.distance > dist.distance) {
  //       nearest = {
  //         distance: dist.distance,
  //         pointAId: existing.originId,
  //         pointBId: existing.destId,
  //         segment: existing.curveContext ? EdgeCurveContext.createSegment(
  //           existing.originPos,
  //           existing.destPos,
  //           existing.curveContext,
  //         ) : LineSegment.create(existing.originPos, existing.destPos),
  //       };
  //     }
  //     dist.distance
  //   }
  //   return nearest;
  // }

  /**
   * Walk a shape's face loop, excluding a set of half-edges.
   *
   * When {@link startAtOriginVertex} is provided, the walk begins from
   * the loop half-edge whose origin matches that vertex (or the first
   * non-excluded edge if none matches). Excluded edges are skipped in
   * the output but their nextId pointers are still followed.
   *
   * Returns an empty array when all loop half-edges are excluded, or
   * null when the shape is not found.
   */
  getFaceLoopExcluding(
    shapeId: Id,
    excludeHalfEdgeIds: Array<HalfEdgeId>,
    startAtOriginVertex?: VertexId,
  ): Array<HalfEdge> | null {
    const tracked = this.shapes.get(shapeId);
    if (typeof tracked === 'undefined') {
      return null;
    }

    let startHeId: HalfEdgeId | null = null;

    // If a start vertex is specified, prefer a loop half-edge that originates there
    // and is NOT in the exclude set (otherwise we'd start from an excluded edge).
    // Loop-direction half-edges are at even indices in halfEdgeIds.
    if (typeof startAtOriginVertex !== 'undefined') {
      for (let i = 0; i < tracked.halfEdgeIds.length; i += 2) {
        const he = this._dcel.getHalfEdge(tracked.halfEdgeIds[i]);
        if (
          typeof he !== 'undefined' &&
          he.originId === startAtOriginVertex &&
          !excludeHalfEdgeIds.includes(he.id)
        ) {
          startHeId = he.id;
          break;
        }
      }
    }

    // Fall back to first non-excluded loop half-edge
    if (startHeId === null) {
      for (let i = 0; i < tracked.halfEdgeIds.length; i += 2) {
        const heId = tracked.halfEdgeIds[i];
        if (!excludeHalfEdgeIds.includes(heId)) {
          startHeId = heId;
          break;
        }
      }
    }

    if (startHeId === null) {
      return [];
    }

    return this._dcel.walkFaceLoop(startHeId, excludeHalfEdgeIds);
  }

  /**
   * Walk a shape's full face loop (no exclusions) starting from the first
   * loop half-edge in the tracked shape record. Returns null when the shape
   * is not found.
   */
  getShapeFaceLoop(shapeId: Id): Array<HalfEdge> | null {
    const tracked = this.shapes.get(shapeId);
    if (typeof tracked === 'undefined' || tracked.halfEdgeIds.length === 0) {
      return null;
    }
    return this._dcel.walkFaceLoop(tracked.halfEdgeIds[0]);
  }

  /**
   * Walk a combined boundary spanning multiple shapes, hopping between face
   * loops at shared vertices when an excluded edge is encountered.
   *
   * Algorithm (stack-based):
   *
   * 1. Build a vertex→edges lookup across ALL shapes in {@link shapeIds}
   *    (forward loop edges AND their twins, so we can enter/exit any vertex
   *    in either direction).
   * 2. Walk from the starting vertex, following the current shape's nextId
   *    chain.  At each vertex:
   *    a. Check for a higher-priority (earlier-on-stack) shape with an edge
   *       starting here → pop stack and switch to that edge.
   *    b. Otherwise follow the current shape's nextId pointer.
   *    c. If blocked (nextId is excluded / not available), push a new shape
   *       onto the stack using an edge starting at the current vertex.
   * 3. Stop when we return to the start vertex.
   *
   * Returns the ordered half-edges forming the combined boundary, or null
   * when the result is degenerate.
   */
  walkCombinedBoundary(
    shapeIds: Array<Id>,
    excludeHalfEdgeIds: Array<HalfEdgeId>,
    startVertexId: VertexId,
  ): { distance: number; isClosed: boolean; result: Array<HalfEdge> } | null {
    const dcel = this._dcel;
    const excludeSet = new Set(excludeHalfEdgeIds);

    // ── Phase 1: Build vertex→edges map ──────────────────────────
    // Map each vertex to a list of (half-edge, shapeId) pairs.
    // For every loop half-edge we also inject its twin, so we can enter
    // a vertex from either direction.
    const byVertex: Map<
      VertexId,
      Array<{ he: HalfEdge; shapeIds: Array<Id>; length: number }>
    > = new Map();
    for (const edge of dcel.allEdgeSegments()) {
      const halfEdges = dcel.getCachedEdgePair(edge.originId, edge.destId);
      if (!halfEdges) {
        continue;
      }

      const originToDest = dcel.getHalfEdge(halfEdges.originToDest);
      const destToOrigin = dcel.getHalfEdge(halfEdges.destToOrigin);
      // console.log('PREP', originToDest, destToOrigin);

      // Compute edge length
      let length = 0;
      if (originToDest && destToOrigin) {
        length = Vector2.distance(
          dcel.getPosition(originToDest.originId)!,
          dcel.getPosition(destToOrigin.originId)!,
        );
      }

      // Store entry for each half edge going in each direction
      if (originToDest) {
        const prev = byVertex.get(originToDest.originId) ?? [];
        byVertex.set(originToDest.originId, [
          ...prev,
          {
            he: originToDest,
            shapeIds: originToDest.faceIds.flatMap((fid) => {
              const entry = Array.from(this.shapes.entries()).find(
                ([_id, shape]) => shape.faceId === fid,
              );
              if (entry) {
                return [entry[0]];
              } else {
                return [];
              }
            }),
            length,
          },
        ]);
      }

      if (destToOrigin) {
        const prev = byVertex.get(destToOrigin.originId) ?? [];
        byVertex.set(destToOrigin.originId, [
          ...prev,
          {
            he: destToOrigin,
            shapeIds: destToOrigin.faceIds.flatMap((fid) => {
              const entry = Array.from(this.shapes.entries()).find(
                ([_id, shape]) => shape.faceId === fid,
              );
              if (entry) {
                return [entry[0]];
              } else {
                return [];
              }
            }),
            length,
          },
        ]);
      }
    }

    if (byVertex.size === 0) {
      return null;
    }

    // ── Phase 2: Walk combined boundary ───────────────────────────
    const stack: Array<Id> = [];

    // Find starting edge: at startVertexId, first non-excluded edge
    // belonging to the top-of-stack shape.
    const startCandidates = byVertex.get(startVertexId);
    console.log('START', startCandidates);
    let currentTriplet: { he: HalfEdge; shapeIds: Array<Id> } | null = null;
    if (typeof startCandidates !== 'undefined') {
      for (const c of startCandidates) {
        if (!excludeSet.has(c.he.id)) {
          stack.push(c.shapeIds[0]);
          currentTriplet = c;
          break;
        }
      }
    }

    if (currentTriplet === null) {
      return null;
    }

    const startOriginId = currentTriplet.he.originId;

    let traversals: Array<{
      he: HalfEdge;
      shapeIds: Array<Id>;
      distance: number;
      shapeIdStack: Array<Id>;
      traversedShapes: number;
      visited: Set<HalfEdgeId>;
      result: Array<HalfEdge>;
      seenVertices: Set<VertexId>;
    }> = [
      {
        he: currentTriplet.he,
        shapeIds: currentTriplet.shapeIds,
        distance: 0,
        shapeIdStack: [shapeIds[0]],
        traversedShapes: 1,
        visited: new Set(),
        result: [],
        seenVertices: new Set([startOriginId]),
      },
    ];
    let complete: Array<{
      distance: number;
      isClosed: boolean;
      isLasso: boolean;
      traversedShapes: number;
      result: Array<HalfEdge>;
    }> = [];

    while (traversals.length > 0) {
      const {
        he: currentHe,
        shapeIds: currentShapeIds,
        distance: currentDistance,
        shapeIdStack,
        traversedShapes,
        visited: visitedOld,
        result: resultOld,
        seenVertices: seenVerticesOld,
      } = traversals.pop()!;

      const visited = new Set(visitedOld);
      visited.add(currentHe.id);
      const seenVertices = seenVerticesOld;
      const result = [...resultOld, currentHe];
      const stepOrigin = dcel.getPosition(currentHe.originId);

      // Destination vertex is the twin's origin
      // WalkCombinedBoundary does NOT use nextId for pathfinding — it uses the byVertex
      // adjacency map built in Phase 1. nextId may legitimately be null on reverse-loop
      // half-edges created by splitEdge, since Phase 4 only relinks forward loops (even
      // halfEdgeIds indices). We determine whether to continue by checking if the
      // destination vertex has valid candidate edges in byVertex — if none exist, the
      // traversal is a true dead end.
      const twin = currentHe.twinId !== null ? dcel.getHalfEdge(currentHe.twinId) : undefined;
      if (typeof twin === 'undefined') {
        // Orphaned half-edge — no twin means we cannot determine the destination vertex.
        // Record as non-closable and move on.
        let length = 0;
        if (currentHe.twinId) {
          const t = dcel.getHalfEdge(currentHe.twinId);
          if (t) {
            length = Vector2.distance(
              dcel.getPosition(currentHe.originId)!,
              dcel.getPosition(t.originId)!,
            );
          }
        }
        complete.push({
          distance: currentDistance + length,
          isClosed: false,
          isLasso: false,
          traversedShapes,
          result,
        });
        continue;
      }
      const destVertexId = twin.originId;

      // Loop-closing check: if we've returned to the start vertex.
      // Guard against false positives — a 1-edge traversal whose twin
      // trivially originates at startOriginId is not a real closed loop.
      if (destVertexId === startOriginId && result.length > 1) {
        // Loop has completed! So now that we know that a loop is in a good state, cull all in
        // flight `traversals` which are longer than this known good complete loop.

        // Compute length of this new edge segment to add to the old score
        let length = 0;
        if (currentHe.twinId) {
          const twin2 = dcel.getHalfEdge(currentHe.twinId);
          if (twin2) {
            length = Vector2.distance(
              dcel.getPosition(currentHe.originId)!,
              dcel.getPosition(twin2.originId)!,
            );
          }
        }
        const totalDistance = currentDistance + length;

        // Remove in flight traversals longer than this one
        traversals = traversals.filter((entry) => entry.distance <= totalDistance);

        complete.push({
          distance: totalDistance,
          isClosed: true,
          isLasso: false,
          traversedShapes,
          result,
        });
        continue;
      }

      // Self-crossing check: if we've arrived at a vertex we've already
      // visited on this traversal, the path forms a lasso / figure-eight
      // and cannot produce a valid simple boundary. Kill it.
      if (seenVertices.has(destVertexId)) {
        let enteredLoop = false;
        let loopResults: Array<HalfEdge> = [];
        let loopDistance = 0;
        let loopShapes = new Set();
        for (const halfEdge of result) {
          if (halfEdge.originId === destVertexId) {
            enteredLoop = true;
          }
          if (!enteredLoop) {
            continue;
          }

          let length = 0;
          if (halfEdge.twinId) {
            const halfEdgeTwin = dcel.getHalfEdge(halfEdge.twinId);
            if (halfEdgeTwin) {
              length = Vector2.distance(
                dcel.getPosition(halfEdge.originId)!,
                dcel.getPosition(halfEdgeTwin.originId)!,
              );
            }
          }
          loopDistance += length;
          loopResults.push(halfEdge);
          loopShapes.add(halfEdge.faceIds[0] ?? null);
        }

        complete.push({
          distance: loopDistance,
          isClosed: true,
          isLasso: true,
          traversedShapes: loopShapes.size,
          result: loopResults,
        });
        continue;
      }

      // ── Collect ALL possible next edges at destVertexId ──
      // Instead of picking one preferred path (higher-priority, forward, or
      // new-shape), we push every valid, non-excluded, non-visited half-edge
      // starting from destVertexId as a separate traversal.  The distance
      // mechanism then selects the shortest closed loop from the competition.
      const candidates = byVertex.get(destVertexId);
      const destPos = dcel.getPosition(destVertexId);
      if (typeof candidates !== 'undefined') {
        let pushedCount = 0;
        for (const c of candidates) {
          if (excludeSet.has(c.he.id)) {
            continue;
          }
          if (visited.has(c.he.id)) {
            continue;
          }
          if (c.he.id === twin.id) {
            // Don't walk backwards along the twin
            continue;
          }

          // Determine the shapeIdStack for this candidate
          let newStack = shapeIdStack;
          let newTraversedShapes = traversedShapes;
          const isOnStack = shapeIdStack.some((sid) => c.shapeIds.includes(sid));
          if (!isOnStack) {
            // New shape — push the first shapeId from this half-edge
            // that isn't already represented
            const toPush = c.shapeIds.find((sid) => !shapeIdStack.includes(sid));
            if (typeof toPush !== 'undefined') {
              newStack = [...shapeIdStack, toPush];
              newTraversedShapes += 1;
            }
          }

          const cDest = c.he.twinId ? dcel.getHalfEdge(c.he.twinId) : undefined;
          const cDestPos = cDest ? dcel.getPosition(cDest.originId) : undefined;
          pushedCount += 1;

          // Add destVertexId to seenVertices for child traversals so
          // they cannot revisit this vertex from another path (prevents
          // self-crossing paths from being considered as closed loops).
          const childSeenVertices = new Set(seenVertices);
          childSeenVertices.add(destVertexId);
          traversals.push({
            he: c.he,
            shapeIds: c.shapeIds,
            distance: currentDistance + c.length,
            shapeIdStack: newStack,
            traversedShapes: newTraversedShapes,
            visited,
            result,
            seenVertices: childSeenVertices,
          });
        }
        if (pushedCount === 0) {
          // Dead end — no valid next edges at this vertex. Record as non-closed.
          let length = 0;
          if (currentHe.twinId) {
            const t2 = dcel.getHalfEdge(currentHe.twinId);
            if (t2) {
              length = Vector2.distance(
                dcel.getPosition(currentHe.originId)!,
                dcel.getPosition(t2.originId)!,
              );
            }
          }
          complete.push({
            distance: currentDistance + length,
            isClosed: false,
            isLasso: false,
            traversedShapes,
            result,
          });
        }
        continue;
      }

      // No candidates at destination vertex — dead end, record as non-closed
      let length = 0;
      if (currentHe.twinId) {
        const t2 = dcel.getHalfEdge(currentHe.twinId);
        if (t2) {
          length = Vector2.distance(
            dcel.getPosition(currentHe.originId)!,
            dcel.getPosition(t2.originId)!,
          );
        }
      }
      complete.push({
        distance: currentDistance + length,
        isClosed: false,
        isLasso: false,
        traversedShapes,
        result,
      });
    }

    // Compute how many distinct shapes the caller expects this walk to cover.
    // The walk should prefer paths whose traversedShapes count matches the
    // number of uniquely-affected shapes as closely as possible.
    //
    // Among tied paths we apply different logic for lasso vs non-lasso:
    //   - Non-lasso paths are clean closed loops — prefer compact ones (A/P³).
    //   - Lasso paths are partial boundary captures from self-crossings —
    //     longer result captures more of the full boundary.
    const targetShapeCount = new Set(shapeIds).size;

    const withMetrics = complete
      .filter((c) => c.isClosed)
      .map((c) => {
        const { area, perimeter } = this._pathAreaPerimeter(c.result, dcel);
        const delta = Math.abs(c.traversedShapes - targetShapeCount);
        return {
          ...c,
          area,
          perimeter,
          resultLen: c.result.length,
          ratio: area / Math.pow(perimeter, 3),
          delta,
        };
      })
      .filter((c) => c.area > 1e-6);

    if (withMetrics.length > 0) {
      withMetrics.sort((a, b) => {
        if (a.delta !== b.delta) {
          return a.delta - b.delta;
        }
        if (b.ratio !== a.ratio) {
          return b.ratio - a.ratio;
        }
        // When A/P³ is effectively tied (floating precision), prefer the
        // longer lasso (captures more boundary) and the shorter non-lasso.
        if (a.isLasso && b.isLasso) {
          return b.resultLen - a.resultLen;
        }
        if (!a.isLasso && !b.isLasso) {
          return a.resultLen - b.resultLen;
        }
        return 0;
      });
      const best = withMetrics[0];
      return best;
    }

    // Fall back to the shortest non-closed path when no closed loop is found.
    // This handles open polygons whose trimmed edge is a terminal edge — the
    // walk necessarily terminates at a leaf vertex (no valid candidates to
    // continue), and the only available path is the remaining chain of edges.
    const nonClosed = complete.filter((c) => !c.isClosed).sort((a, b) => a.distance - b.distance);
    if (nonClosed.length > 0) {
      return nonClosed[0];
    }
    return null;
  }

  /**
   * Compute the approximate area (via shoelace on chord vertices) and
   * perimeter (sum of chord distances) for a closed path of half-edges.
   * Uses chords rather than exact Bezier arcs — good enough for ratio
   * comparison between candidate boundary paths.
   */
  private _pathAreaPerimeter(
    path: Array<HalfEdge>,
    dcel: DCEL<SheetPosition>,
  ): { area: number; perimeter: number } {
    if (path.length === 0) {
      return { area: 0, perimeter: 0 };
    }

    let area = 0;
    let perimeter = 0;

    for (let i = 0; i < path.length; i += 1) {
      const he = path[i];
      const originPos = dcel.getPosition(he.originId);
      if (typeof originPos === 'undefined') {
        continue;
      }

      // Next vertex in the path (wraps around for closed loops)
      const nextIdx = (i + 1) % path.length;
      const nextHe = path[nextIdx];
      const nextPos = dcel.getPosition(nextHe.originId);
      if (typeof nextPos === 'undefined') {
        continue;
      }

      // Shoelace contribution
      area += originPos.x * nextPos.y - nextPos.x * originPos.y;

      // Chord-length perimeter contribution
      const dx = nextPos.x - originPos.x;
      const dy = nextPos.y - originPos.y;
      perimeter += Math.sqrt(dx * dx + dy * dy);
    }

    return { area: Math.abs(area) / 2, perimeter };
  }

  // ----------------------------------------------------------
  // Rectangle sync
  // ----------------------------------------------------------

  /**
   * Register a rectangle with the index. The four corners are added as
   * vertices (or shared if they coincide with existing ones) and the four
   * edges are added as half-edge pairs.
   */
  addRectangle(rect: Geometry<RectangleComponent>): void {
    if (this.shapes.has(rect.id)) {
      // Guard against accidental double-registration
      this.removeRectangle(rect.id);
    }
    const { perimeter, perimeterLabels } = RectangleComponent.keyPoints(rect);
    // Rectangle extras (e.g. center) are derived from perimeter vertices.
    // They are resolved and registered on-demand in constraintEndpointToVertexId
    // when a constraint actually references them.
    this._registerShape(
      rect.id,
      'rectangle',
      perimeter,
      /* extraPositions */ [],
      /* closed */ true,
      /* reversed */ false,
      undefined,
      perimeterLabels,
      /* extraLabels */ [],
    );
  }

  /**
   * Update a rectangle that was previously registered. Internally this is
   * a remove + re-add, which correctly handles vertex sharing.
   */
  updateRectangle(rect: Geometry<RectangleComponent>): void {
    this.updateGeometry(rect);
  }

  /** Remove a rectangle from the index, releasing its vertices and edges. */
  removeRectangle(id: Id): void {
    this.removeGeometry(id);
  }

  // ----------------------------------------------------------
  // Ellipse sync
  // ----------------------------------------------------------

  /**
   * Register an ellipse with the index. The ellipse is approximated as a
   * closed polygon with _ellipseSegments evenly-spaced vertices.
   */
  addEllipse(ellipse: Geometry<EllipseComponent>): void {
    if (this.shapes.has(ellipse.id)) {
      this.removeEllipse(ellipse.id);
    }
    const { perimeter, perimeterLabels } = EllipseComponent.keyPoints(ellipse);
    const ellipseData = EllipseComponent.get(ellipse);
    const ellipseSegs = ellipseToPolygon(
      ellipseData.center,
      ellipseData.radiusX,
      ellipseData.radiusY,
    );
    // segs[1..4] are arc-cubic segments in CCW order (top→right, right→bottom, bottom→left, left→top),
    // aligning 1:1 with DCEL candidate edges built from perimeter [top, right, bottom, left].
    const curveContexts: Array<EdgeCurveContext> = ellipseSegs.slice(1).map((seg) => ({
      type: 'cubic' as const,
      controlPointA: (seg as CubicBezierSegment).controlPointA,
      controlPointB: (seg as CubicBezierSegment).controlPointB,
    }));
    // Ellipse extras (e.g. center) are derived from perimeter vertices.
    // They are resolved and registered on-demand in constraintEndpointToVertexId
    // when a constraint actually references them.
    this._registerShape(
      ellipse.id,
      'ellipse',
      perimeter,
      /* extraPositions */ [],
      true,
      /* reversed */ false,
      curveContexts,
      perimeterLabels,
      /* extraLabels */ [],
    );
  }

  /** Update an ellipse that was previously registered. */
  updateEllipse(ellipse: Ellipse): void {
    this.updateGeometry(ellipse);
  }

  /** Remove an ellipse from the index. */
  removeEllipse(id: Id): void {
    this.removeGeometry(id);
  }

  // ----------------------------------------------------------
  // Polygon sync
  // ----------------------------------------------------------

  /**
   * Register a polygon with the index. Bezier arc segments are linearized
   * into _bezierSamples straight-line segments each.
   */
  addPolygon(polygon: Polygon): void {
    if (this.shapes.has(polygon.id)) {
      this.removePolygon(polygon.id);
    }
    const polygonData = PolygonComponent.get(polygon);
    const { positions, curveContexts, reversed } = this._polygonPoints(
      polygonData.points,
      polygonData.closed,
    );
    this._registerShape(
      polygon.id,
      'polygon',
      positions,
      [],
      polygonData.closed,
      reversed,
      curveContexts,
    );
  }

  /** Update a polygon that was previously registered. */
  updatePolygon(polygon: Polygon): void {
    this.updateGeometry(polygon);
  }

  /** Remove a polygon from the index. */
  removePolygon(id: Id): void {
    this.removeGeometry(id);
  }

  // ----------------------------------------------------------
  // Datum sync
  // ----------------------------------------------------------

  /**
   * Register a datum with the index. A datum is a single anchor point
   * with no edges — just one vertex added to the DCEL.
   */
  addDatum(datum: Geometry<DatumComponent>): void {
    if (this.shapes.has(datum.id)) {
      this.removeGeometry(datum.id);
    }
    const pos = DatumComponent.get(datum);
    const vertexId = this.dcel.addVertex(pos);
    const faceId = this.dcel.addFace();
    this._faceToShapeIds.set(faceId, datum.id);
    this.shapes.set(datum.id, {
      kind: 'datum',
      originalKind: 'datum',
      vertexIds: [vertexId],
      vertexLabels: ['position'],
      vertexIdsOriginal: [true],
      halfEdgeIds: [],
      edgePairs: [],
      faceId,
      reversed: false,
    });
  }

  /** Update a datum that was previously registered. */
  updateDatum(datum: Geometry<DatumComponent>): void {
    this.updateGeometry(datum);
  }

  /** Remove a datum from the index. */
  removeDatum(id: Id): void {
    this.removeGeometry(id);
  }

  // ----------------------------------------------------------
  // Generic shape methods — collapse type-specific add/update/remove
  // ----------------------------------------------------------

  /**
   * Register any geometry shape with the DCEL index. Internally dispatches
   * to the correct per-shape logic based on type guards.
   */
  addGeometry(geometry: Geometry): void {
    if (Geometry.hasComponent(geometry, DatumComponent)) {
      this.addDatum(geometry);
      return;
    }
    if (Geometry.hasComponents(geometry, PolygonComponent, RenderOrderComponent)) {
      this.addPolygon(geometry);
    } else if (
      Geometry.hasComponents(
        geometry,
        RectangleComponent,
        FillColorComponent,
        LinkDimensionsComponent,
        RenderOrderComponent,
      )
    ) {
      this.addRectangle(geometry);
    } else if (Geometry.hasComponent(geometry, EllipseComponent)) {
      this.addEllipse(geometry);
    }
  }

  /**
   * Remove and re-register a geometry shape. Handles vertex sharing correctly.
   */
  updateGeometry(geometry: Geometry): void {
    this.removeGeometry(geometry.id);
    this.addGeometry(geometry);
  }

  /** Remove a geometry shape from the index, releasing its vertices and edges. */
  removeGeometry(id: Id): void {
    this._removeShape(id);
  }

  // ----------------------------------------------------------
  // Engine constraint generation
  // ----------------------------------------------------------

  /**
   * Build engine constraints and a position map from the current DCEL state.
   *
   * For each rectangle in the index, horizontal / vertical constraints are
   * inferred automatically (top/bottom are horizontal, left/right are vertical).
   *
   * User-defined LinearConstraints are converted to DistanceEngineConstraints
   * by resolving their endpoint positions to DCEL VertexIds.
   *
   * The fixedPositions array is converted to FixedPointEngineConstraints
   * (each pins a DCEL vertex to its current position).
   *
   * Returns a parallel positions map that maps every DCEL VertexId to its
   * current SheetPosition — suitable for the iterative solver.
   */
  computeEngineConstraints(
    constraints: Array<Constraint>,
    fixedPositions: Array<SheetPosition>,
    sheetUnits: UnitType,
  ): { engineConstraints: Array<EngineConstraint>; positions: Map<PointId, SheetPosition> } {
    const positions = new Map<PointId, SheetPosition>();
    const engineConstraints: Array<EngineConstraint> = [];

    // 1a — Build an initial set of original vertices. This will be
    //      rebuilt after constraint resolution, which may lazily create
    //      derived vertices (e.g. ellipse/rectangle centers) that need
    //      to be included in the position map.
    const collectOriginalVertices = (): Set<VertexId> => {
      const set = new Set<VertexId>();
      for (const [, tracked] of this.shapes) {
        for (let i = 0; i < tracked.vertexIds.length; i += 1) {
          if (tracked.vertexIdsOriginal[i]) {
            set.add(tracked.vertexIds[i]);
          }
        }
      }
      return set;
    };

    // 1b — Resolve user-defined constraints to engine constraints.
    //  This step runs BEFORE building the position map because
    //  constraintEndpointToVertexId may lazily register derived
    //  vertices (e.g. center for an ellipse or rectangle).
    for (const constraint of constraints) {
      switch (constraint.type) {
        case 'linear': {
          const pointAId = this.constraintEndpointToVertexId(constraint.pointA);
          const pointBId = this.constraintEndpointToVertexId(constraint.pointB);
          if (!pointAId || !pointBId) {
            continue;
          }

          const target = constraint.constrainedLength.toSheetUnits(sheetUnits).magnitude;

          if (constraint.axis === 'x') {
            engineConstraints.push({
              type: 'distanceX',
              pointA: pointAId,
              pointB: pointBId,
              targetDistance: target,
            });
          } else if (constraint.axis === 'y') {
            engineConstraints.push({
              type: 'distanceY',
              pointA: pointAId,
              pointB: pointBId,
              targetDistance: target,
            });
          } else {
            engineConstraints.push({
              type: 'distance',
              pointA: pointAId,
              pointB: pointBId,
              targetDistance: target,
            });
          }
          break;
        }
        case 'perpendicular': {
          const pointAId = this.constraintEndpointToVertexId(constraint.pointA);
          const pointCenterId = this.constraintEndpointToVertexId(constraint.pointCenter);
          const pointBId = this.constraintEndpointToVertexId(constraint.pointB);
          if (!pointAId || !pointCenterId || !pointBId) {
            continue;
          }

          engineConstraints.push({
            type: 'perpendicular',
            segmentA: { pointA: pointCenterId, pointB: pointAId },
            segmentB: { pointA: pointCenterId, pointB: pointBId },
          });
          break;
        }
        case 'parallel': {
          const pointAId = this.constraintEndpointToVertexId(constraint.pointA);
          const pointBId = this.constraintEndpointToVertexId(constraint.pointB);
          const pointCId = this.constraintEndpointToVertexId(constraint.pointC);
          const pointDId = this.constraintEndpointToVertexId(constraint.pointD);
          if (!pointAId || !pointBId || !pointCId || !pointDId) {
            continue;
          }

          engineConstraints.push({
            type: 'parallel',
            segmentA: { pointA: pointAId, pointB: pointBId },
            segmentB: { pointA: pointCId, pointB: pointDId },
          });
          break;
        }
        case 'horizontal': {
          const pointAId = this.constraintEndpointToVertexId(constraint.pointA);
          const pointBId = this.constraintEndpointToVertexId(constraint.pointB);
          if (!pointAId || !pointBId) {
            continue;
          }
          engineConstraints.push({
            type: 'horizontal',
            pointA: pointAId,
            pointB: pointBId,
          });
          break;
        }
        case 'vertical': {
          const pointAId = this.constraintEndpointToVertexId(constraint.pointA);
          const pointBId = this.constraintEndpointToVertexId(constraint.pointB);
          if (!pointAId || !pointBId) {
            continue;
          }
          engineConstraints.push({
            type: 'vertical',
            pointA: pointAId,
            pointB: pointBId,
          });
          break;
        }
        case 'colinear': {
          const pointTargetId = this.constraintEndpointToVertexId(constraint.pointTarget);
          const pointAId = this.constraintEndpointToVertexId(constraint.pointA);
          const pointBId = this.constraintEndpointToVertexId(constraint.pointB);
          if (!pointTargetId || !pointAId || !pointBId) {
            continue;
          }
          engineConstraints.push({
            type: 'colinear',
            pointTarget: pointTargetId,
            pointA: pointAId,
            pointB: pointBId,
          });
          break;
        }
        default:
          constraint satisfies never;
          throw new Error(
            `computeEngineConstraints: unexpected constraint type ${(constraint as any).type}`,
          );
      }
    }

    // 1c — Rebuild the original vertex set. Lazy vertex registration
    //  during constraint resolution (step 1b) may have appended derived
    //  vertices (e.g. center for an ellipse/rectangle) to tracked
    //  shapes' vertexIds.
    const originalVertices = collectOriginalVertices();

    // 1d — Build the position map from every original DCEL vertex
    for (const [vId, pos] of this._dcel.allVertexEntries()) {
      if (originalVertices.has(vId)) {
        positions.set(vId, pos);
      }
    }

    // Auto-infer horizontal/vertical constraints from rectangles.
    // Uses originalKind so auto-constraints still fire after a rectangle has been
    // reclassified as polygon due to edge splitting. Vertex IDs are looked up by label
    // so that extra intersection vertices in vertexIds don't corrupt the mapping.
    for (const [, tracked] of this.shapes) {
      if (tracked.originalKind !== 'rectangle') {
        continue;
      }

      const ulIdx = tracked.vertexLabels.indexOf('upperLeft');
      const urIdx = tracked.vertexLabels.indexOf('upperRight');
      const lrIdx = tracked.vertexLabels.indexOf('lowerRight');
      const llIdx = tracked.vertexLabels.indexOf('lowerLeft');
      if (ulIdx === -1 || urIdx === -1 || lrIdx === -1 || llIdx === -1) {
        continue;
      }
      const ul = tracked.vertexIds[ulIdx];
      const ur = tracked.vertexIds[urIdx];
      const lr = tracked.vertexIds[lrIdx];
      const ll = tracked.vertexIds[llIdx];

      // Top edge: upperLeft -> upperRight
      engineConstraints.push({ type: 'horizontal', pointA: ul, pointB: ur });
      // Bottom edge: lowerRight -> lowerLeft
      engineConstraints.push({ type: 'horizontal', pointA: lr, pointB: ll });
      // Right edge: upperRight -> lowerRight
      engineConstraints.push({ type: 'vertical', pointA: ur, pointB: lr });
      // Left edge: lowerLeft -> upperLeft
      engineConstraints.push({ type: 'vertical', pointA: ll, pointB: ul });
    }

    // Add constraints to keep ellipse edge points colinear.
    // Uses originalKind and vertexLabels for the same reasons as the rectangle block above.
    for (const [, tracked] of this.shapes) {
      if (tracked.originalKind !== 'ellipse') {
        continue;
      }

      const tIdx = tracked.vertexLabels.indexOf('top');
      const rIdx = tracked.vertexLabels.indexOf('right');
      const bIdx = tracked.vertexLabels.indexOf('bottom');
      const lIdx = tracked.vertexLabels.indexOf('left');
      if (tIdx === -1 || rIdx === -1 || bIdx === -1 || lIdx === -1) {
        continue;
      }
      const t = tracked.vertexIds[tIdx];
      const r = tracked.vertexIds[rIdx];
      const b = tracked.vertexIds[bIdx];
      const l = tracked.vertexIds[lIdx];

      engineConstraints.push({ type: 'vertical', pointA: t, pointB: b });
      engineConstraints.push({ type: 'horizontal', pointA: l, pointB: r });
    }

    // Pin fixed positions
    for (const pos of fixedPositions) {
      const vertexId = this._dcel.getVertexId(pos);
      if (typeof vertexId === 'undefined') {
        continue;
      }
      engineConstraints.push({
        type: 'fixedPoint',
        point: vertexId,
        position: pos,
      });
    }

    return { engineConstraints, positions };
  }

  private constraintEndpointToVertexId(constraintEndpoint: ConstraintEndpoint) {
    switch (constraintEndpoint.type) {
      case 'point':
        return this.dcel.getVertexId(constraintEndpoint.point) ?? null;
      case 'locked-polygon': {
        const trackedPolygon = this.shapes.get(constraintEndpoint.id);
        if (!trackedPolygon) {
          return null;
        }
        // Map from polygonData.points index to the corresponding vertex ID
        // in trackedPolygon.vertexIds, accounting for reversed ordering (CW
        // polygons) and interleaved split-point vertices.
        let targetOriginalIndex = constraintEndpoint.pointIndex;
        if (trackedPolygon.reversed) {
          const numOriginal = trackedPolygon.vertexIdsOriginal.filter(Boolean).length;
          targetOriginalIndex = (numOriginal - constraintEndpoint.pointIndex) % numOriginal;
        }
        let count = 0;
        for (let i = 0; i < trackedPolygon.vertexIds.length; i += 1) {
          if (trackedPolygon.vertexIdsOriginal[i]) {
            if (count === targetOriginalIndex) {
              return trackedPolygon.vertexIds[i] ?? null;
            }
            count += 1;
          }
        }
        return null;
      }
      case 'locked-rectangle': {
        const tracked = this.shapes.get(constraintEndpoint.id);
        if (!tracked) {
          return null;
        }
        // Resolve derived extras (e.g. center) from perimeter vertex positions
        if (constraintEndpoint.point === 'center') {
          return this._resolveCenterVertex(tracked, 'upperLeft', 'lowerRight');
        }
        const idx = tracked.vertexLabels.indexOf(constraintEndpoint.point);
        if (idx === -1) {
          return null;
        }
        return tracked.vertexIds[idx] ?? null;
      }
      case 'locked-ellipse': {
        const tracked = this.shapes.get(constraintEndpoint.id);
        if (!tracked) {
          return null;
        }
        // Resolve derived extras (e.g. center) from perimeter vertex positions
        if (constraintEndpoint.point === 'center') {
          return this._resolveEllipseCenterVertex(tracked);
        }
        const idx = tracked.vertexLabels.indexOf(constraintEndpoint.point);
        if (idx === -1) {
          return null;
        }
        return tracked.vertexIds[idx] ?? null;
      }
      case 'locked-datum': {
        const tracked = this.shapes.get(constraintEndpoint.id);
        if (!tracked) {
          return null;
        }
        return tracked.vertexIds[0] ?? null;
      }
    }
  }

  /**
   * Lazily resolves and registers a derived center vertex for a rectangle.
   * The center is computed as the midpoint of the upperLeft and lowerRight
   * perimeter vertices, and registered on-demand in the DCEL. This avoids
   * permanently storing a vertex for every rectangle (only rectangles with
   * constraints referencing the center get one).
   */
  private _resolveCenterVertex(
    tracked: TrackedShape,
    cornerALabel: string,
    cornerBLabel: string,
  ): VertexId | null {
    const idxA = tracked.vertexLabels.indexOf(cornerALabel);
    const idxB = tracked.vertexLabels.indexOf(cornerBLabel);
    if (idxA === -1 || idxB === -1) {
      return null;
    }
    const vIdA = tracked.vertexIds[idxA];
    const vIdB = tracked.vertexIds[idxB];
    if (typeof vIdA === 'undefined' || typeof vIdB === 'undefined') {
      return null;
    }
    const posA = this._dcel.getPosition(vIdA);
    const posB = this._dcel.getPosition(vIdB);
    if (typeof posA === 'undefined' || typeof posB === 'undefined') {
      return null;
    }
    const center = new SheetPosition((posA.x + posB.x) / 2, (posA.y + posB.y) / 2);
    const existing = this._dcel.getVertexId(center);
    if (typeof existing !== 'undefined') {
      if (!tracked.vertexIds.includes(existing)) {
        tracked.vertexIds.push(existing);
        tracked.vertexLabels.push('center');
        tracked.vertexIdsOriginal.push(true);
      }
      return existing;
    }
    const vertexId = this._dcel.addVertex(center);
    tracked.vertexIds.push(vertexId);
    tracked.vertexLabels.push('center');
    tracked.vertexIdsOriginal.push(true);
    return vertexId;
  }

  /**
   * Lazily resolves and registers a derived center vertex for an ellipse.
   * The center is computed from the midpoints of the perimeter axes.
   */
  private _resolveEllipseCenterVertex(tracked: TrackedShape): VertexId | null {
    return this._resolveCenterVertex(tracked, 'top', 'bottom');
  }

  /** After engine constraints are applied, determine which shapes the given vertex id maps back to
   * so they can be updated. */
  computeShapesForVertexId(vertexId: VertexId) {
    const results = [];
    for (const [id, shape] of this.shapes) {
      if (!shape.vertexIds.includes(vertexId)) {
        continue;
      }
      switch (shape.originalKind) {
        case 'polygon': {
          const idx = shape.vertexIds.indexOf(vertexId);
          if (idx === -1) {
            continue;
          }
          // Skip intersection-only vertices — the solver does not independently
          // move split-point vertices; their positions are re-derived when the
          // DCEL is resynced from the updated geometry.
          if (!shape.vertexIdsOriginal[idx]) {
            continue;
          }
          // Compute the index among original vertices only, so that the
          // returned pointIndex correctly maps into PolygonComponent.points
          // (which does not include split-point entries).
          let originalIndex = 0;
          for (let i = 0; i < idx; i += 1) {
            if (shape.vertexIdsOriginal[i]) {
              originalIndex += 1;
            }
          }

          let pointIndex = originalIndex;
          // When _polygonPoints reversed the vertices (clockwise polygon
          // converted to CCW for the DCEL), the vertex ordering is reversed
          // relative to PolygonComponent.points. Remap so the solver's
          // result is applied to the correct point.
          if (shape.reversed) {
            const numOriginal = shape.vertexIdsOriginal.filter(Boolean).length;
            pointIndex = (numOriginal - originalIndex) % numOriginal;
          }

          results.push({
            type: 'polygon' as const,
            id,
            pointIndex,
          });
          break;
        }
        case 'rectangle': {
          const index = shape.vertexIds.indexOf(vertexId);
          if (index === -1) {
            continue;
          }
          const point = shape.vertexLabels[index];
          if (point === null || typeof point === 'undefined') {
            // Split vertex on a shape originally registered as a rectangle.
            // Report as polygon-type so that callers who only need the shape ID
            // (e.g., TrimSplitTool) can still discover this shape. The reconstrain
            // path only processes original vertices (filtered in the position map)
            // so this branch is never reached during reconstrain step 3.
            results.push({ type: 'polygon' as const, id, pointIndex: 0 });
            break;
          }
          results.push({ type: 'rectangle' as const, id, point });
          break;
        }
        case 'ellipse': {
          const index = shape.vertexIds.indexOf(vertexId);
          if (index === -1) {
            continue;
          }
          const point = shape.vertexLabels[index];
          if (point === null || typeof point === 'undefined') {
            // Split vertex on a shape originally registered as an ellipse.
            // Same rationale as the rectangle case above.
            results.push({ type: 'polygon' as const, id, pointIndex: 0 });
            break;
          }
          results.push({ type: 'ellipse' as const, id, point });
          break;
        }
        case 'datum': {
          const index = shape.vertexIds.indexOf(vertexId);
          if (index === -1 || !shape.vertexIdsOriginal[index]) {
            continue;
          }
          results.push({ type: 'datum' as const, id });
          break;
        }
      }
    }
    return results;
  }

  // ----------------------------------------------------------
  // Core registration / removal
  // ----------------------------------------------------------

  /**
   * Register any shape as a list of linearized positions plus a closed flag.
   * This is the single point through which all shapes enter the DCEL.
   *
   * During registration, candidate edges are checked against all existing
   * DCEL edges for intersections (with bounding-box broad-phase culling).
   * When intersections are found, both the pre-existing edge and the new
   * shape's edge are split at the intersection point, creating new vertices
   * and propagating faceIds to the resulting segments.
   *
   * Order of operations on removal matters: edges are released before
   * vertices so that releaseVertex() finds an already-clean outgoing set.
   */
  private _registerShape(
    id: Id,
    kind: ShapeKind,
    perimeterPositions: Array<SheetPosition>,
    extraPositions: Array<SheetPosition>,
    closed: boolean,
    reversed: boolean,
    edgeCurveContexts?: Array<EdgeCurveContext | null>,
    perimeterLabels?: Array<string | null>,
    extraLabels?: Array<string>,
  ): void {
    if (perimeterPositions.length === 0) {
      return;
    }

    // Build the vertexLabels array (parallel to the eventual vertexIds).
    // Perimeter vertices come first (with their labels), then extra vertices.
    const vertexLabels: Array<string | null> = [
      ...(perimeterLabels ?? perimeterPositions.map(() => null)),
      ...(extraLabels ?? extraPositions.map(() => null)),
    ];

    // ----------------------------------------------------------
    // Phase 1 - Create vertices for the shape's original positions
    // ----------------------------------------------------------
    // Phase 1 — Create vertices for the shape's original positions
    // ----------------------------------------------------------

    const vertexIds: Array<VertexId> = [];
    const vertexIdsOriginal: Array<boolean> = [];
    for (const pos of perimeterPositions) {
      vertexIds.push(this._dcel.addVertex(pos));
      vertexIdsOriginal.push(true);
    }

    // Build candidate edge list with positions for intersection detection
    const edgeCount = closed ? vertexIds.length : vertexIds.length - 1;
    const candidateEdges: Array<{
      originId: VertexId;
      destId: VertexId;
      originPos: SheetPosition;
      destPos: SheetPosition;
    }> = [];
    for (let i = 0; i < edgeCount; i += 1) {
      const originId = vertexIds[i];
      const destId = vertexIds[(i + 1) % vertexIds.length];
      if (originId === destId) {
        continue;
      }
      const originPos = this._dcel.getPosition(originId);
      const destPos = this._dcel.getPosition(destId);
      if (typeof originPos !== 'undefined' && typeof destPos !== 'undefined') {
        candidateEdges.push({ originId, destId, originPos, destPos });
      }
    }
    if (candidateEdges.length === 0) {
      return;
    }

    // Add extra positions at the end so they aren't part of any edges
    for (const pos of extraPositions) {
      vertexIds.push(this._dcel.addVertex(pos));
      vertexIdsOriginal.push(true);
    }

    // ----------------------------------------------------------
    // Phase 2 — Detect intersections with existing DCEL edges
    // ----------------------------------------------------------

    type Intersection = {
      point: SheetPosition;
      tOnNew: number; // parametric position along new edge
      uOnExisting: number; // parametric position along existing edge
      existingKey: string;
      existingOriginId: VertexId;
      existingDestId: VertexId;
      existingCurveContext: EdgeCurveContext | null;
      newOriginId: VertexId;
      newDestId: VertexId;
    };
    const allIntersections: Array<Intersection> = [];

    for (let newIdx = 0; newIdx < candidateEdges.length; newIdx += 1) {
      const candidate = candidateEdges[newIdx];
      const newCtx = edgeCurveContexts?.[newIdx] ?? null;
      const newSegment = newCtx
        ? EdgeCurveContext.createSegment(candidate.originPos, candidate.destPos, newCtx)
        : LineSegment.create(candidate.originPos, candidate.destPos);

      const newBBox = BoundingBox.fromPoints([candidate.originPos, candidate.destPos]);

      for (const existing of this.queryBoundingBox(newBBox)) {
        const existingSegment = existing.curveContext
          ? EdgeCurveContext.createSegment(
              existing.originPos,
              existing.destPos,
              existing.curveContext,
            )
          : LineSegment.create(existing.originPos, existing.destPos);

        // Narrow-phase: exact segment intersection
        const allSegmentIntersections = Intersection.computeSegmentPairIntersections(
          newSegment,
          existingSegment,
        );

        for (const [point, tOnNew, uOnExisting] of allSegmentIntersections) {
          // When intersecting against a curved existing edge, the cubic-line
          // solver may return endpoint touches (t≈0/t≈1) for colocated edges.
          // These cause Phase 5 to double-add edges — filter them here.
          // Line-line endpoint touches are safe (Phase 5 handles via
          // prevVId === interVId), so only filter for curved edges.
          if (existing.curveContext && (tOnNew <= 0 || tOnNew >= 1)) {
            continue;
          }

          allIntersections.push({
            point,
            tOnNew,
            uOnExisting,
            existingKey: this._dcel.getEdgeKey(existing.originId, existing.destId),
            existingOriginId: existing.originId,
            existingDestId: existing.destId,
            existingCurveContext: existing.curveContext,
            newOriginId: candidate.originId,
            newDestId: candidate.destId,
          });
        }
      }
    }

    // ----------------------------------------------------------
    // Phase 3 — Group intersections by existing edge key
    // ----------------------------------------------------------

    const intersectionsByExisting = new Map<string, Array<Intersection>>();
    for (const inter of allIntersections) {
      let list = intersectionsByExisting.get(inter.existingKey);
      if (typeof list === 'undefined') {
        list = [];
        intersectionsByExisting.set(inter.existingKey, list);
      }
      list.push(inter);
    }

    // ----------------------------------------------------------
    // Phase 4 — Split existing edges at intersection points
    // ----------------------------------------------------------

    // For each existing edge with intersections, process splits in order
    // along the edge (smallest u first).
    const intersectionsByNewEdgeInput = new Map<string, Array<Intersection>>();
    for (const inter of allIntersections) {
      const newKey = this._dcel.getEdgeKey(inter.newOriginId, inter.newDestId);
      let list = intersectionsByNewEdgeInput.get(newKey);
      if (typeof list === 'undefined') {
        list = [];
        intersectionsByNewEdgeInput.set(newKey, list);
      }
      list.push(inter);
    }

    // Track which existing shapes had edges split, so we can re-link
    // their loops in one pass at the end.
    const affectedShapeIds = new Set<Id>();

    for (const [, splits] of intersectionsByExisting) {
      splits.sort((a, b) => a.uOnExisting - b.uOnExisting);

      let currentOriginId = splits[0].existingOriginId;
      let currentDestId = splits[0].existingDestId;
      let remainingCurveContext: EdgeCurveContext | null = splits[0].existingCurveContext;
      let prevU = 0;

      for (const split of splits) {
        const splitVId = this._dcel.addVertex(split.point);

        // If the intersection point is at an existing vertex that is
        // already an endpoint of this edge, no split is needed — the
        // edges merely meet at a shared vertex, they do not cross.
        if (splitVId === currentOriginId || splitVId === currentDestId) {
          continue;
        }

        // Find all shapes that own this edge (search both directions
        // since edgePairs stores edges in the shape's loop direction,
        // which may differ from allEdgeSegments()'s iteration order).
        const owningShapes: Array<TrackedShape> = [];

        for (const [, shape] of this.shapes) {
          const pairIndex = shape.edgePairs.findIndex(
            (ep) =>
              (ep.originId === currentOriginId && ep.destId === currentDestId) ||
              (ep.originId === currentDestId && ep.destId === currentOriginId),
          );
          if (pairIndex !== -1) {
            owningShapes.push(shape);
          }
        }

        if (owningShapes.length === 0) {
          break;
        }

        // Perform the split on the DCEL
        const [osId, soId, sdId, dsId] = this._dcel.splitEdge(
          currentOriginId,
          currentDestId,
          splitVId,
        );

        // Cascade-split the curve context across the new edges.
        // Track remainingCurveContext across iterations so each split
        // uses the correct sub-curve, not the original full curve.
        if (remainingCurveContext) {
          this.edgeKeyToCurveContext.delete(this._dcel.getEdgeKey(currentOriginId, currentDestId));

          const localU = (split.uOnExisting - prevU) / (1 - prevU);
          const [osCurveContext, sdCurveContext] = EdgeCurveContext.split(
            this._dcel.getPosition(currentOriginId)!,
            this._dcel.getPosition(currentDestId)!,
            remainingCurveContext,
            localU,
          );
          this.edgeKeyToCurveContext.set(
            this._dcel.getEdgeKey(currentOriginId, splitVId),
            osCurveContext,
          );
          remainingCurveContext = sdCurveContext;
        }
        prevU = split.uOnExisting;

        // Apply tracked-shape updates to each owning shape
        for (const shape of owningShapes) {
          // Find the edge in the shape's direction
          const pairIndex = shape.edgePairs.findIndex(
            (ep) =>
              (ep.originId === currentOriginId && ep.destId === currentDestId) ||
              (ep.originId === currentDestId && ep.destId === currentOriginId),
          );
          if (pairIndex === -1) {
            continue;
          }

          const oldPair = shape.edgePairs[pairIndex];
          const isSameDirection =
            oldPair.originId === currentOriginId && oldPair.destId === currentDestId;

          // Update vertexIds — insert splitVId between the edge's endpoints
          const originIdx = shape.vertexIds.indexOf(oldPair.originId);
          const destIdx = shape.vertexIds.indexOf(oldPair.destId);
          if (originIdx !== -1 && destIdx !== -1) {
            const insertAt = originIdx < destIdx ? originIdx + 1 : destIdx + 1;
            shape.vertexIds.splice(insertAt, 0, splitVId);
            shape.vertexLabels.splice(insertAt, 0, null);
            shape.vertexIdsOriginal.splice(insertAt, 0, false);
          }

          // Update edgePairs — replace old edge with two new edges
          // in the shape's own direction order
          shape.edgePairs.splice(
            pairIndex,
            1,
            { originId: oldPair.originId, destId: splitVId },
            { originId: splitVId, destId: oldPair.destId },
          );

          // Update halfEdgeIds — replace [ab, ba] with the correct
          // half-edge order for this shape's loop direction.
          // splitEdge returns [os, so, sd, ds] where:
          //   os = origin→split, so = split→origin
          //   sd = split→dest,   ds = dest→split
          // For the loop direction matching origin→dest the pair is
          //   [os, so, sd, ds] (loop half-edges: os, sd)
          // For the opposite direction (dest→origin) the pair is
          //   [ds, sd, so, os] (loop half-edges: ds, so)
          const heIdx = pairIndex * 2;
          if (isSameDirection) {
            shape.halfEdgeIds.splice(heIdx, 2, osId, soId, sdId, dsId);
          } else {
            shape.halfEdgeIds.splice(heIdx, 2, dsId, sdId, soId, osId);
            // splitEdge assigns faceIds based on the CALLER's argument
            // direction (origin→dest vs dest→origin), but this shape's
            // loop goes the OPPOSITE way. Swap faceIds so the loop
            // half-edges (dsId, soId) get the origin→dest faceIds and
            // the twin half-edges (sdId, osId) get the dest→origin faceIds.
            const osHe = this._dcel.getHalfEdge(osId);
            const soHe = this._dcel.getHalfEdge(soId);
            const sdHe = this._dcel.getHalfEdge(sdId);
            const dsHe = this._dcel.getHalfEdge(dsId);
            if (
              typeof osHe !== 'undefined' &&
              typeof soHe !== 'undefined' &&
              typeof sdHe !== 'undefined' &&
              typeof dsHe !== 'undefined'
            ) {
              const tmpOs = osHe.faceIds;
              osHe.faceIds = dsHe.faceIds;
              dsHe.faceIds = tmpOs;
              const tmpSd = sdHe.faceIds;
              sdHe.faceIds = soHe.faceIds;
              soHe.faceIds = tmpSd;
            }
          }

          // A rectangle whose edge was split is no longer a simple rectangle
          if (shape.kind === 'rectangle') {
            shape.kind = 'polygon';
          }
        }

        // Mark each owning shape for loop re-linking
        for (const shape of owningShapes) {
          const shapeEntry = [...this.shapes].find(([sid, s]) => s === shape);
          if (typeof shapeEntry !== 'undefined') {
            affectedShapeIds.add(shapeEntry[0]);
          }
        }

        currentOriginId = splitVId;
      }

      // Store the remaining curve context for the last segment
      // (from the final split point to the original destination).
      if (remainingCurveContext) {
        this.edgeKeyToCurveContext.set(
          this._dcel.getEdgeKey(currentOriginId, currentDestId),
          remainingCurveContext,
        );
      }
    }

    // Bulk re-link all affected shapes' loops (robust against cross-split
    // pointer invalidation since we iterate the final halfEdgeIds).
    for (const shapeId of affectedShapeIds) {
      const shape = this.shapes.get(shapeId);
      if (typeof shape === 'undefined') {
        continue;
      }
      const { halfEdgeIds } = shape;
      if (halfEdgeIds.length < 2) {
        continue;
      }
      for (let i = 0; i < halfEdgeIds.length; i += 2) {
        const heId = halfEdgeIds[i];
        const nextHeId = halfEdgeIds[(i + 2) % halfEdgeIds.length];
        this._dcel.linkNext(heId, nextHeId);
      }

      // Link the reverse (twin) loop for each affected shape. splitEdge creates new
      // half-edges with nextId=null; this mirrors the Phase 6 reverse loop linking
      // so that twin half-edges also have valid nextId pointers.
      if (halfEdgeIds.length >= 4) {
        const lastTwinIdx = halfEdgeIds.length - 1;
        for (let i = lastTwinIdx; i > 1; i -= 2) {
          this._dcel.linkNext(halfEdgeIds[i], halfEdgeIds[i - 2]);
        }
        // Only close the reverse loop if the shape is closed (last edge dest === first edge origin)
        const isClosed =
          shape.edgePairs.length > 1 &&
          shape.edgePairs[shape.edgePairs.length - 1].destId === shape.edgePairs[0].originId;
        if (isClosed) {
          this._dcel.linkNext(halfEdgeIds[1], halfEdgeIds[lastTwinIdx]);
        }
      }
    }

    // ----------------------------------------------------------
    // Phase 5 — Add new shape edges with split points
    // ----------------------------------------------------------

    const halfEdgeIds: Array<HalfEdgeId> = [];
    const edgePairs: Array<{ originId: VertexId; destId: VertexId }> = [];

    let lastHalfEdgeId: HalfEdgeId | null = null;

    for (let edgeIndex = 0; edgeIndex < candidateEdges.length; edgeIndex += 1) {
      const candidate = candidateEdges[edgeIndex];
      const edgeKey = this._dcel.getEdgeKey(candidate.originId, candidate.destId);
      const splitsOnThisEdge = intersectionsByNewEdgeInput.get(edgeKey);
      const curveCtx = edgeCurveContexts?.[edgeIndex] ?? null;

      if (typeof splitsOnThisEdge === 'undefined') {
        // No intersections — normal edge addition
        const [ab, ba] = this._dcel.addEdge(candidate.originId, candidate.destId);
        halfEdgeIds.push(ab, ba);
        edgePairs.push({ originId: candidate.originId, destId: candidate.destId });

        if (curveCtx) {
          this.edgeKeyToCurveContext.set(edgeKey, curveCtx);
        }

        if (lastHalfEdgeId !== null) {
          this._dcel.linkNext(lastHalfEdgeId, ab);
        }
        lastHalfEdgeId = ab;
      } else {
        // Insert split points along the new edge, sorted by t along the edge
        splitsOnThisEdge.sort((a, b) => a.tOnNew - b.tOnNew);

        let prevVId = candidate.originId;
        let remainingCtx: EdgeCurveContext | null = curveCtx;
        let prevT = 0;

        for (const split of splitsOnThisEdge) {
          const interVId = this._dcel.addVertex(split.point);
          if (prevVId === interVId) {
            // Intersection point coincides with an existing edge endpoint —
            // no split is needed, skip this segment.
            continue;
          }

          if (remainingCtx) {
            const localT = (split.tOnNew - prevT) / (1 - prevT);
            const [segCtx, rest] = EdgeCurveContext.split(
              this._dcel.getPosition(prevVId)!,
              this._dcel.getPosition(candidate.destId)!,
              remainingCtx,
              localT,
            );
            this.edgeKeyToCurveContext.set(this._dcel.getEdgeKey(prevVId, interVId), segCtx);
            remainingCtx = rest;
          }
          prevT = split.tOnNew;

          const [ab, ba] = this._dcel.addEdge(prevVId, interVId);
          halfEdgeIds.push(ab, ba);
          edgePairs.push({ originId: prevVId, destId: interVId });
          vertexIds.push(interVId);
          vertexLabels.push(null);
          vertexIdsOriginal.push(false);

          if (lastHalfEdgeId !== null) {
            this._dcel.linkNext(lastHalfEdgeId, ab);
          }
          lastHalfEdgeId = ab;
          prevVId = interVId;
        }

        // Final segment from last split point to destination
        if (remainingCtx) {
          this.edgeKeyToCurveContext.set(
            this._dcel.getEdgeKey(prevVId, candidate.destId),
            remainingCtx,
          );
        }

        const [ab, ba] = this._dcel.addEdge(prevVId, candidate.destId);
        halfEdgeIds.push(ab, ba);
        edgePairs.push({ originId: prevVId, destId: candidate.destId });

        if (lastHalfEdgeId !== null) {
          this._dcel.linkNext(lastHalfEdgeId, ab);
        }
        lastHalfEdgeId = ab;
      }
    }

    // ----------------------------------------------------------
    // Phase 6 — Link loops, assign face, store tracked shape
    // ----------------------------------------------------------

    // Close the forward (loop-direction) half-edges into a cycle
    // for closed shapes.
    if (closed && halfEdgeIds.length >= 2) {
      this._dcel.linkNext(lastHalfEdgeId!, halfEdgeIds[0]);
    }

    // Link the reverse (twin) half-edges into their own loop.
    // halfEdgeIds layout: [fwd0, rev0, fwd1, rev1, ..., fwdN, revN]
    // Reverse loop order: revN -> rev{N-1} -> ... -> rev0
    // Closed shapes close the reverse loop; open shapes leave it open.
    if (halfEdgeIds.length >= 4) {
      const lastTwinIdx = halfEdgeIds.length - 1;
      for (let i = lastTwinIdx; i > 1; i -= 2) {
        this._dcel.linkNext(halfEdgeIds[i], halfEdgeIds[i - 2]);
      }
      if (closed) {
        this._dcel.linkNext(halfEdgeIds[1], halfEdgeIds[lastTwinIdx]);
      }
    }

    const faceId = this._dcel.addFace();
    this._dcel.assignFace(halfEdgeIds[0], faceId, true);
    this._faceToShapeIds.set(faceId, id);
    // Pad vertexLabels and vertexIdsOriginal to match vertexIds if extra
    // vertices were added during shape registration (e.g. intersection split
    // points in Phase 5).
    while (vertexLabels.length < vertexIds.length) {
      vertexLabels.push(null);
    }
    while (vertexIdsOriginal.length < vertexIds.length) {
      vertexIdsOriginal.push(false);
    }

    // Capture the original kind before any reclassification.
    // A rectangle that gains intersection vertices from splitting becomes a polygon
    // for DCEL purposes (kind), but its originalKind stays 'rectangle' so that
    // constraint inference and shape reconciliation can still use label-based lookup.
    const originalKind = kind;

    // A rectangle that gained intersection vertices is no longer a simple rectangle
    if (
      kind === 'rectangle' &&
      vertexIds.length > perimeterPositions.length + extraPositions.length
    ) {
      kind = 'polygon';
    }

    this.shapes.set(id, {
      kind,
      originalKind,
      vertexIds,
      vertexLabels,
      vertexIdsOriginal,
      halfEdgeIds,
      edgePairs,
      faceId,
      reversed,
    });
  }

  /**
   * Remove a shape from the DCEL. Edges are released first (ref-counted),
   * then vertices are released. This order ensures the edge cache stays
   * consistent: when a vertex reaches ref count zero its outgoing set is
   * already clean.
   */
  private _removeShape(id: Id): void {
    const shape = this.shapes.get(id);

    if (typeof shape === 'undefined') {
      return;
    }

    // Step 1: release all edges belonging to this shape (ref-counted),
    // passing the shape's faceId so shared half-edges can remove the
    // correct entry from their faceIds array.
    for (const { originId, destId } of shape.edgePairs) {
      this._dcel.releaseEdge(originId, destId, shape.faceId);
      // Clean up the curve context only when the edge is fully culled
      // (ref count reached zero), so shared edges keep their context.
      const edgeKey = this._dcel.getEdgeKey(originId, destId);
      if (typeof this._dcel.getCachedEdgePair(originId, destId) === 'undefined') {
        this.edgeKeyToCurveContext.delete(edgeKey);
      }
    }

    // Step 2: release all vertex references (culls vertices at ref count 0)
    for (const vId of shape.vertexIds) {
      this._dcel.releaseVertex(vId);
    }

    this._faceToShapeIds.delete(shape.faceId);
    this.shapes.delete(id);

    // Step 3: merge colinear edges left behind on remaining shapes
    this._mergeColinearEdges();
  }

  /**
   * Iterate all remaining tracked shapes and merge any two consecutive
   * edges in a shape's loop that are colinear and whose directed
   * half-edges have identical faceIds.
   *
   * Repeats until no more merges are found so that 3+ colinear
   * segments collapsed from the outside in.
   */
  private _mergeColinearEdges(): void {
    const COLINEAR_EPSILON = 1e-10;

    for (const [, shape] of this.shapes) {
      let merged = false;
      do {
        merged = false;

        for (let i = 0; i < shape.edgePairs.length - 1; i += 1) {
          const current = shape.edgePairs[i];
          const nextEdge = shape.edgePairs[i + 1];

          // Must be adjacent (share the middle vertex)
          if (current.destId !== nextEdge.originId) {
            continue;
          }

          const middleVId = current.destId;

          // Middle vertex must have exactly two incident half-edges
          // (one back to origin, one forward to dest) — no other shape
          // uses this vertex as a split point.
          const outgoing = this._dcel.getOutgoingFromVertexId(middleVId);
          if (outgoing.length !== 2) {
            continue;
          }

          // Colinearity check: cross product of direction vectors ~ 0
          const originPos = this._dcel.getPosition(current.originId);
          const middlePos = this._dcel.getPosition(middleVId);
          const destPos = this._dcel.getPosition(nextEdge.destId);
          if (
            typeof originPos === 'undefined' ||
            typeof middlePos === 'undefined' ||
            typeof destPos === 'undefined'
          ) {
            continue;
          }

          const dx1 = middlePos.x - originPos.x;
          const dy1 = middlePos.y - originPos.y;
          const dx2 = destPos.x - middlePos.x;
          const dy2 = destPos.y - middlePos.y;
          if (Math.abs(dx1 * dy2 - dy1 * dx2) > COLINEAR_EPSILON) {
            continue;
          }

          // Loop-direction half-edges must have matching faceIds
          const loopHe1 = this._dcel.getHalfEdge(shape.halfEdgeIds[i * 2]);
          const loopHe2 = this._dcel.getHalfEdge(shape.halfEdgeIds[(i + 1) * 2]);
          if (typeof loopHe1 === 'undefined' || typeof loopHe2 === 'undefined') {
            continue;
          }
          if (loopHe1.faceIds.length !== loopHe2.faceIds.length) {
            continue;
          }
          const loopFaceMatch = loopHe1.faceIds.every((fid, idx) => fid === loopHe2.faceIds[idx]);
          if (!loopFaceMatch) {
            continue;
          }

          // Twin half-edges must also have matching faceIds
          const twin1 = this._dcel.getHalfEdge(shape.halfEdgeIds[i * 2 + 1]);
          const twin2 = this._dcel.getHalfEdge(shape.halfEdgeIds[(i + 1) * 2 + 1]);
          if (typeof twin1 === 'undefined' || typeof twin2 === 'undefined') {
            continue;
          }
          if (twin1.faceIds.length !== twin2.faceIds.length) {
            continue;
          }
          const twinFaceMatch = twin1.faceIds.every((fid, idx) => fid === twin2.faceIds[idx]);
          if (!twinFaceMatch) {
            continue;
          }

          // Save relinking pointers before splice (they point into the
          // existing arrays and won't be affected by removing at index i)
          const prevPairIdx = (i + shape.edgePairs.length - 1) % shape.edgePairs.length;
          const nextPairIdx = (i + 2) % shape.edgePairs.length;
          const prevLoopHeId = shape.halfEdgeIds[prevPairIdx * 2];
          const nextLoopHeId = shape.halfEdgeIds[nextPairIdx * 2];

          // Perform the merge in the DCEL.  If the merged edge already
          // exists in the cache (because another ref-counted shape
          // merged it first), just re-use its half-edge IDs.
          const mergeOrigin = current.originId;
          const mergeDest = nextEdge.destId;
          let newAB: HalfEdgeId, newBA: HalfEdgeId;
          const cachedMerged = this._dcel.getCachedEdgePair(mergeOrigin, mergeDest);
          if (typeof cachedMerged !== 'undefined') {
            // Already merged by another shape — bump its ref count.
            // addEdge hits the cache and returns the correct half-edges
            // in the caller's direction order.
            [newAB, newBA] = this._dcel.addEdge(mergeOrigin, mergeDest);
          } else {
            // No stale merge — create the merged edge in the DCEL
            [newAB, newBA] = this._dcel.mergeEdges(mergeOrigin, middleVId, mergeDest);
          }

          // Update edgePairs — replace two entries with one
          shape.edgePairs.splice(i, 2, {
            originId: mergeOrigin,
            destId: mergeDest,
          });

          // Update halfEdgeIds — replace 4 entries with 2
          shape.halfEdgeIds.splice(i * 2, 4, newAB, newBA);

          // Remove middle vertex from vertexIds and release its ref
          const midIdx = shape.vertexIds.indexOf(middleVId);
          if (midIdx !== -1) {
            shape.vertexIds.splice(midIdx, 1);
            shape.vertexLabels.splice(midIdx, 1);
            shape.vertexIdsOriginal.splice(midIdx, 1);
          }
          this._dcel.releaseVertex(middleVId);

          // Relink the loop surgically
          this._dcel.linkNext(prevLoopHeId, newAB);
          this._dcel.linkNext(newAB, nextLoopHeId);

          merged = true;
          break; // restart since indices are now invalid
        }
      } while (merged);
    }
  }

  private _polygonPoints(
    points: Array<PolygonSegment>,
    closed: boolean,
  ): {
    positions: Array<SheetPosition>;
    curveContexts: Array<EdgeCurveContext | null>;
    reversed: boolean;
  } {
    if (points.length === 0) {
      return { positions: [], curveContexts: [], reversed: false };
    }

    const positions = points.map((p) => p.point);

    // Build curve contexts for each edge. Edge i (from positions[i] to
    // positions[(i+1) % N]) corresponds to segment points[i+1] — the segment
    // that ENDS at positions[i+1].
    const curveContexts: Array<EdgeCurveContext | null> = [];
    for (let i = 1; i < points.length; i += 1) {
      curveContexts.push(this._segmentToCurveContext(points[i]));
    }

    let reversed = false;

    // The DCEL expects polygons to wind counterclockwise.
    if (convexPolygonWindOrder(positions) === 'clockwise') {
      reversed = true;
      positions.reverse();
      curveContexts.reverse();
      // For reversed cubic contexts, swap the control points so the
      // curve has the correct tangent direction for the reversed edge.
      for (let i = 0; i < curveContexts.length; i += 1) {
        const ctx = curveContexts[i];
        if (ctx?.type === 'cubic') {
          curveContexts[i] = {
            type: 'cubic',
            controlPointA: ctx.controlPointB,
            controlPointB: ctx.controlPointA,
          };
        }
      }
    }

    // Strip the duplicated closure point that the polygon format requires
    // for non-linear closing segments. _registerShape closes the loop
    // automatically via the modulo index, so a duplicate end == start
    // would produce a zero-length self-loop edge.
    if (closed && positions.length > 1) {
      const first = positions[0];
      const last = positions[positions.length - 1];
      if (last.x === first.x && last.y === first.y) {
        positions.pop();
        curveContexts.pop();
      }
    }

    return { positions, curveContexts, reversed };
  }

  private _segmentToCurveContext(segment: PolygonSegment): EdgeCurveContext | null {
    switch (segment.type) {
      case 'point':
        return null;
      case 'arc-quadratic':
        return { type: 'quadratic', controlPoint: segment.controlPoint };
      case 'arc-cubic':
        return {
          type: 'cubic',
          controlPointA: segment.controlPointA,
          controlPointB: segment.controlPointB,
        };
    }
  }
}
