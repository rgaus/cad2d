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

import DCEL, { type VertexId, type HalfEdgeId, type FaceId } from "@/lib/dcel";
import { SheetPosition } from "@/lib/viewport/types";

// Adjust the import path to wherever your shape types live.
import { type Id, type Rectangle, type Ellipse, type Polygon, type Constraint, PolygonSegment } from "./types";
import { ellipseToPolygon, rectangleToPolygon, Intersection, CohenSutherland, boundingBox } from "@/lib/math";
import { UnitType } from "@/lib/units/length";
import { type EngineConstraint, type PointId } from "@/lib/constraint-engine";

// ============================================================
// Internal tracking types
// ============================================================

type ShapeKind = "rectangle" | "ellipse" | "polygon";

// Everything the index needs to remember about a registered shape
// in order to cleanly remove it later.
type TrackedShape = {
  kind: ShapeKind;
  // All vertex IDs this shape contributed (including shared ones).
  // We hold a reference count slot for each, so each entry here
  // corresponds to exactly one releaseVertex() call on removal.
  vertexIds: Array<VertexId>;
  // Both half-edges of every undirected edge this shape added.
  // Kept for linkNext / face assignment during registration.
  halfEdgeIds: Array<HalfEdgeId>;
  // Undirected edge pairs for ref-counted release on removal.
  // Each pair maps to one call to releaseEdge().
  edgePairs: Array<{ originId: VertexId; destId: VertexId }>;
  // The face assigned to this shape's loop, used to remove the
  // correct faceId entry from shared half-edges on removal.
  faceId: FaceId;
};

// ============================================================
// DCELShapeIndex
// ============================================================

export class DCELShapeIndex {
  private _dcel = new DCEL<SheetPosition>();
  private shapes = new Map<Id, TrackedShape>();

  // ----------------------------------------------------------
  // Expose the underlying DCEL for external queries
  // ----------------------------------------------------------

  get dcel(): DCEL<SheetPosition> {
    return this._dcel;
  }

  // ----------------------------------------------------------
  // Rectangle sync
  // ----------------------------------------------------------

  /**
   * Register a rectangle with the index. The four corners are added as
   * vertices (or shared if they coincide with existing ones) and the four
   * edges are added as half-edge pairs.
   */
  addRectangle(rect: Rectangle): void {
    if (this.shapes.has(rect.id)) {
      // Guard against accidental double-registration
      this.removeRectangle(rect.id);
    }
    this._registerShape(
      rect.id,
      "rectangle",
      rectangleToPolygon(rect.upperLeft, rect.lowerRight),
      /* closed */ true,
    );
  }

  /**
   * Update a rectangle that was previously registered. Internally this is
   * a remove + re-add, which correctly handles vertex sharing.
   */
  updateRectangle(rect: Rectangle): void {
    this.removeRectangle(rect.id);
    this.addRectangle(rect);
  }

  /** Remove a rectangle from the index, releasing its vertices and edges. */
  removeRectangle(id: Id): void {
    this._removeShape(id);
  }

  // ----------------------------------------------------------
  // Ellipse sync
  // ----------------------------------------------------------

  /**
   * Register an ellipse with the index. The ellipse is approximated as a
   * closed polygon with _ellipseSegments evenly-spaced vertices.
   */
  addEllipse(ellipse: Ellipse): void {
    if (this.shapes.has(ellipse.id)) {
      this.removeEllipse(ellipse.id);
    }
    this._registerShape(
      ellipse.id,
      "ellipse",
      ellipseToPolygon(ellipse.center, ellipse.radiusX, ellipse.radiusY),
      /* closed */ true
    );
  }

  /** Update an ellipse that was previously registered. */
  updateEllipse(ellipse: Ellipse): void {
    this.removeEllipse(ellipse.id);
    this.addEllipse(ellipse);
  }

  /** Remove an ellipse from the index. */
  removeEllipse(id: Id): void {
    this._removeShape(id);
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
    this._registerShape(polygon.id, "polygon", polygon.points, polygon.closed);
  }

  /** Update a polygon that was previously registered. */
  updatePolygon(polygon: Polygon): void {
    this.removePolygon(polygon.id);
    this.addPolygon(polygon);
  }

  /** Remove a polygon from the index. */
  removePolygon(id: Id): void {
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

    // Build the position map from every DCEL vertex
    for (const [vId, pos] of this._dcel.allVertexEntries()) {
      positions.set(vId, pos);
    }

    // Auto-infer horizontal/vertical constraints from rectangles
    for (const [, tracked] of this.shapes) {
      if (tracked.kind !== "rectangle") {
        continue;
      }

      const [ul, ur, lr, ll] = tracked.vertexIds;

      // Top edge: upperLeft -> upperRight
      engineConstraints.push({ type: "horizontal", pointA: ul, pointB: ur });
      // Bottom edge: lowerRight -> lowerLeft
      engineConstraints.push({ type: "horizontal", pointA: lr, pointB: ll });
      // Right edge: upperRight -> lowerRight
      engineConstraints.push({ type: "vertical", pointA: ur, pointB: lr });
      // Left edge: lowerLeft -> upperLeft
      engineConstraints.push({ type: "vertical", pointA: ll, pointB: ul });
    }

    // Convert user-defined LinearConstraints to DistanceEngineConstraints
    for (const constraint of constraints) {
      if (constraint.type !== "linear") {
        continue;
      }

      const pointAId = this._dcel.getVertexId(constraint.pointA);
      const pointBId = this._dcel.getVertexId(constraint.pointB);

      if (typeof pointAId === "undefined" || typeof pointBId === "undefined") {
        continue;
      }

      engineConstraints.push({
        type: "distance",
        pointA: pointAId,
        pointB: pointBId,
        targetDistance: constraint.constrainedLength.toSheetUnits(sheetUnits).magnitude,
      });
    }

    // Pin fixed positions
    for (const pos of fixedPositions) {
      const vertexId = this._dcel.getVertexId(pos);
      if (typeof vertexId === "undefined") {
        continue;
      }
      engineConstraints.push({
        type: "fixedPoint",
        point: vertexId,
        position: pos,
      });
    }

    return { engineConstraints, positions };
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
  private _registerShape(id: Id, kind: ShapeKind, points: Array<PolygonSegment>, closed: boolean): void {
    const positions = this._polygonPoints(points, closed);
    if (positions.length === 0) {
      return;
    }

    // ----------------------------------------------------------
    // Phase 1 — Create vertices for the shape's original positions
    // ----------------------------------------------------------

    const vertexIds: Array<VertexId> = [];
    for (const pos of positions) {
      vertexIds.push(this._dcel.addVertex(pos));
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
      if (typeof originPos !== "undefined" && typeof destPos !== "undefined") {
        candidateEdges.push({ originId, destId, originPos, destPos });
      }
    }
    if (candidateEdges.length === 0) {
      return;
    }

    // ----------------------------------------------------------
    // Phase 2 — Detect intersections with existing DCEL edges
    // ----------------------------------------------------------

    type Intersection = {
      point: SheetPosition;
      tOnNew: number;               // parametric position along new edge
      uOnExisting: number;          // parametric position along existing edge
      existingKey: string;
      existingOriginId: VertexId;
      existingDestId: VertexId;
      newOriginId: VertexId;
      newDestId: VertexId;
    };
    const allIntersections: Array<Intersection> = [];

    // Compute u (parametric position along a segment) given the intersection point
    const computeU = (
      existingOriginPos: SheetPosition,
      existingDestPos: SheetPosition,
      interPoint: SheetPosition,
    ): number => {
      const dx = existingDestPos.x - existingOriginPos.x;
      const dy = existingDestPos.y - existingOriginPos.y;
      if (Math.abs(dx) > Math.abs(dy)) {
        return (interPoint.x - existingOriginPos.x) / dx;
      }
      return (interPoint.y - existingOriginPos.y) / dy;
    };

    // Snapshot existing edge segments once (before any modifications)
    const existingSegments = this._dcel.allEdgeSegments();

    for (const candidate of candidateEdges) {
      const newSegment = { start: candidate.originPos, end: candidate.destPos };
      const newBBox = boundingBox([candidate.originPos, candidate.destPos]);

      for (const existing of existingSegments) {
        const existingSegment = { start: existing.originPos, end: existing.destPos };

        // Broad-phase: Cohen-Sutherland fast rejection
        if (!CohenSutherland.lineSegmentMightIntersectBoundingBox(existingSegment, newBBox)) {
          continue;
        }

        // Narrow-phase: exact segment intersection
        const result = Intersection.computeLineSegmentIntersection(newSegment, existingSegment);
        if (result !== null) {
          allIntersections.push({
            point: result[0],
            tOnNew: result[1],
            uOnExisting: computeU(existing.originPos, existing.destPos, result[0]),
            existingKey: this._dcel.getEdgeKey(existing.originId, existing.destId),
            existingOriginId: existing.originId,
            existingDestId: existing.destId,
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
      if (typeof list === "undefined") {
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
      if (typeof list === "undefined") {
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

      for (const split of splits) {
        const splitVId = this._dcel.addVertex(split.point);

        // If the intersection point is at an existing vertex that is
        // already an endpoint of this edge, no split is needed — the
        // edges merely meet at a shared vertex, they do not cross.
        if (splitVId === currentOriginId || splitVId === currentDestId) {
          continue;
        }

        // Find all shapes that own this edge
        const owningShapes: Array<TrackedShape> = [];

        for (const [, shape] of this.shapes) {
          const pairIndex = shape.edgePairs.findIndex(
            ep => ep.originId === currentOriginId && ep.destId === currentDestId,
          );
          if (pairIndex !== -1) {
            owningShapes.push(shape);
          }
        }

        if (owningShapes.length === 0) {
          // Edge was already removed — skip remaining splits on this edge
          break;
        }

        // Perform the split on the DCEL
        const [osId, soId, sdId, dsId] = this._dcel.splitEdge(
          currentOriginId,
          currentDestId,
          splitVId,
        );

        // Apply tracked-shape updates to each owning shape
        for (const shape of owningShapes) {
          // Update vertexIds — insert splitVId between origin and dest
          const originIdx = shape.vertexIds.indexOf(currentOriginId);
          const destIdx = shape.vertexIds.indexOf(currentDestId);
          if (originIdx !== -1 && destIdx !== -1) {
            const insertAt = originIdx < destIdx ? originIdx + 1 : destIdx + 1;
            shape.vertexIds.splice(insertAt, 0, splitVId);
          }

          // Update edgePairs — replace old edge with two new edges
          const pairIndex = shape.edgePairs.findIndex(
            ep => ep.originId === currentOriginId && ep.destId === currentDestId,
          );
          if (pairIndex === -1) {
            continue;
          }
          shape.edgePairs.splice(
            pairIndex,
            1,
            { originId: currentOriginId, destId: splitVId },
            { originId: splitVId, destId: currentDestId },
          );

          // Update halfEdgeIds — replace [ab, ba] with [osId, soId, sdId, dsId]
          const heIdx = pairIndex * 2;
          shape.halfEdgeIds.splice(heIdx, 2, osId, soId, sdId, dsId);

          // A rectangle whose edge was split is no longer a simple rectangle
          if (shape.kind === "rectangle") {
            shape.kind = "polygon";
          }
        }

        // Mark each owning shape for loop re-linking
        for (const shape of owningShapes) {
          const shapeEntry = [...this.shapes].find(
            ([sid, s]) => s === shape,
          );
          if (typeof shapeEntry !== "undefined") {
            affectedShapeIds.add(shapeEntry[0]);
          }
        }

        currentOriginId = splitVId;
      }
    }

    // Bulk re-link all affected shapes' loops (robust against cross-split
    // pointer invalidation since we iterate the final halfEdgeIds).
    for (const shapeId of affectedShapeIds) {
      const shape = this.shapes.get(shapeId);
      if (typeof shape === "undefined") {
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
    }

    // ----------------------------------------------------------
    // Phase 5 — Add new shape edges with split points
    // ----------------------------------------------------------

    const halfEdgeIds: Array<HalfEdgeId> = [];
    const edgePairs: Array<{ originId: VertexId; destId: VertexId }> = [];

    let lastHalfEdgeId: HalfEdgeId | null = null;

    for (const candidate of candidateEdges) {
      const edgeKey = this._dcel.getEdgeKey(candidate.originId, candidate.destId);
      const splitsOnThisEdge = intersectionsByNewEdgeInput.get(edgeKey);

      if (typeof splitsOnThisEdge === "undefined") {
        // No intersections — normal edge addition
        const [ab, ba] = this._dcel.addEdge(candidate.originId, candidate.destId);
        halfEdgeIds.push(ab, ba);
        edgePairs.push({ originId: candidate.originId, destId: candidate.destId });

        if (lastHalfEdgeId !== null) {
          this._dcel.linkNext(lastHalfEdgeId, ab);
        }
        lastHalfEdgeId = ab;

      } else {
        // Insert split points along the new edge, sorted by t along the edge
        splitsOnThisEdge.sort((a, b) => a.tOnNew - b.tOnNew);

        let prevVId = candidate.originId;
        for (const split of splitsOnThisEdge) {
          const interVId = this._dcel.addVertex(split.point);
          const [ab, ba] = this._dcel.addEdge(prevVId, interVId);
          halfEdgeIds.push(ab, ba);
          edgePairs.push({ originId: prevVId, destId: interVId });
          vertexIds.push(interVId);

          if (lastHalfEdgeId !== null) {
            this._dcel.linkNext(lastHalfEdgeId, ab);
          }
          lastHalfEdgeId = ab;
          prevVId = interVId;
        }

        // Final segment from last split point to destination
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
    // Phase 6 — Link loop, assign face, store tracked shape
    // ----------------------------------------------------------

    const faceId = this._dcel.addFace();
    this._dcel.assignFace(halfEdgeIds[0], faceId, true);
    this.shapes.set(id, { kind, vertexIds, halfEdgeIds, edgePairs, faceId });
    console.log('DCEL:', this, faceId);
  }

  /**
   * Remove a shape from the DCEL. Edges are released first (ref-counted),
   * then vertices are released. This order ensures the edge cache stays
   * consistent: when a vertex reaches ref count zero its outgoing set is
   * already clean.
   */
  private _removeShape(id: Id): void {
    const shape = this.shapes.get(id);

    if (typeof shape === "undefined") {
      return;
    }

    // Step 1: release all edges belonging to this shape (ref-counted),
    // passing the shape's faceId so shared half-edges can remove the
    // correct entry from their faceIds array.
    for (const { originId, destId } of shape.edgePairs) {
      this._dcel.releaseEdge(originId, destId, shape.faceId);
    }

    // Step 2: release all vertex references (culls vertices at ref count 0)
    for (const vId of shape.vertexIds) {
      this._dcel.releaseVertex(vId);
    }

    this.shapes.delete(id);
    console.log('DCEL:', this);
  }

  private _polygonPoints(points: Array<PolygonSegment>, closed: boolean): Array<SheetPosition> {
    if (points.length === 0) {
      return [];
    }

    const result = points.map(p => p.point);

    // Strip the duplicated closure point that the polygon format requires
    // for non-linear closing segments. _registerShape closes the loop
    // automatically via the modulo index, so a duplicate end == start
    // would produce a zero-length self-loop edge.
    if (closed && result.length > 1) {
      const first = result[0];
      const last = result[result.length - 1];
      if (last.x === first.x && last.y === first.y) {
        result.pop();
      }
    }

    return result;
  }
}
