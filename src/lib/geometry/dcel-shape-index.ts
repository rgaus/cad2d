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
// NOTE: edges themselves are NOT reference-counted. If two shapes
// share both endpoints of an edge, the DCEL will contain two
// distinct (but coincident) half-edge pairs for that edge. This
// is intentional: it keeps shape ownership unambiguous and removal
// simple. Add edge ref-counting here if you need to query
// "which shapes share this edge" later.
// ============================================================

import DCEL, { type VertexId, type HalfEdgeId } from "@/lib/dcel";
import { SheetPosition } from "@/lib/viewport/types";

// Adjust the import path to wherever your shape types live.
import { type Id, type Rectangle, type Ellipse, type Polygon, type Constraint, PolygonSegment } from "./types";
import { ellipseToPolygon, rectangleToPolygon } from "@/lib/math";
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
  halfEdgeIds: Array<HalfEdgeId>;
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
   * Order of operations on removal matters: half-edges are deleted before
   * vertices are released, so that releaseVertex() finds an already-clean
   * _outgoing set when it culls at ref count zero.
   */
  private _registerShape(id: Id, kind: ShapeKind, points: Array<PolygonSegment>, closed: boolean): void {
    const positions = this._polygonPoints(points, closed);
    if (positions.length === 0) {
      return;
    }

    const vertexIds: Array<VertexId> = [];
    const halfEdgeIds: Array<HalfEdgeId> = [];

    // Register every position as a vertex. addVertex() handles dedup and
    // increments the ref count for positions that already exist.
    for (const pos of positions) {
      vertexIds.push(this._dcel.addVertex(pos));
    }

    // Build edges between consecutive vertices.
    // For closed shapes the last vertex connects back to the first.
    const edgeCount = closed ? vertexIds.length : vertexIds.length - 1;

    let lastHalfEdgeId: HalfEdgeId | null = null;
    for (let i = 0; i < edgeCount; i += 1) {
      const originId = vertexIds[i];
      const destId = vertexIds[(i + 1) % vertexIds.length];

      // Skip degenerate zero-length edges. These can appear when a
      // closed polygon duplicates its start/end point, or when two
      // consecutive bezier samples happen to map to the same position.
      if (originId === destId) {
        continue;
      }

      const [ab, ba] = this._dcel.addEdge(originId, destId);
      halfEdgeIds.push(ab);
      halfEdgeIds.push(ba);

      if (lastHalfEdgeId) {
        this._dcel.linkNext(lastHalfEdgeId, ab);
      }
      lastHalfEdgeId = ab;
    }

    const faceId = this._dcel.addFace();
    this._dcel.assignFace(halfEdgeIds[0], faceId, true);

    this.shapes.set(id, { kind, vertexIds, halfEdgeIds });
  }

  /**
   * Remove a shape from the DCEL. Half-edges are removed first so that
   * releaseVertex() doesn't try to clean up edges we're about to remove
   * anyway when it culls a zero-ref-count vertex.
   */
  private _removeShape(id: Id): void {
    const shape = this.shapes.get(id);

    if (typeof shape === "undefined") {
      return;
    }

    // Step 1: remove all half-edges belonging to this shape
    for (const heId of shape.halfEdgeIds) {
      this._dcel.removeHalfEdge(heId);
    }

    // Step 2: release all vertex references (culls vertices at ref count 0)
    for (const vId of shape.vertexIds) {
      this._dcel.releaseVertex(vId);
    }

    this.shapes.delete(id);
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
