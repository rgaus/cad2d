import { type UndoEntry } from '@/lib/history/types';
import {
  BoundingBox,
  DeCasteljau,
  Vector2,
  closestPointOnCubicCurve,
  closestPointOnQuadraticCurve,
  centroid as mathCentroid,
} from '@/lib/math';
import {
  CubicCurve,
  GeometryRelativeSheetPosition,
  KeyPoints,
  LineSegment,
  OrientedRect,
  Position,
  QuadraticCurve,
  Rect,
  SheetPosition,
} from '@/lib/viewport/types';
import { ConstraintComponent } from '../components/ConstraintComponent';
import { GeometryComponent } from '../components/GeometryComponent';
import {
  ColinearConstraintData,
  Constraint,
  ConstraintData,
  HorizontalConstraintData,
  ParallelConstraintData,
  PerpendicularConstraintData,
  VerticalConstraintData,
} from '../constraints';
import { type Entity, ResizeParams } from '../types';

/** A straight line segment from one point to the next. */
export type PointSegment<P extends Position = SheetPosition> = {
  type: 'point';
  point: P;
};

/** A quadratic Bezier arc. The user alt+clicks to place the arc endpoint,
 * then clicks to place the quadratic Bezier control point directly.
 * The curve passes near but not through the control point. */
export type QuadraticBezierSegment<P extends Position = SheetPosition> = {
  type: 'arc-quadratic';
  point: P;
  controlPoint: P;
};

/** A cubic Bezier arc where the user places both off-curve control points.
 * The curve passes through neither control point. */
export type CubicBezierSegment<P extends Position = SheetPosition> = {
  type: 'arc-cubic';
  point: P;
  controlPointA: P;
  controlPointB: P;
};

/** A segment of a polygon — either a straight line or an arc. */
export type PolygonSegment<P extends Position = SheetPosition> =
  | PointSegment<P>
  | QuadraticBezierSegment<P>
  | CubicBezierSegment<P>;

/** A completed polygon with an id, segments, and closed state. */
export type PolygonData = {
  type: 'polygon';
  /** Raw absolute local-frame origin. Polygon points are stored relative to this position. */
  position: SheetPosition;
  points: Array<PolygonSegment<GeometryRelativeSheetPosition>>;
  closed: boolean;
  openAtIndex: number;

  /** Cached fill color of the polygon when it is open */
  lastFillColor?: number | null;
};

export namespace PolygonData {
  /** Builds polygon data from absolute sheet-space segments, choosing the raw bounding-box
   * upper-left (matching the legacy natural origin) as the stable local-frame position. */
  export function fromAbsoluteSegments(
    points: Array<PolygonSegment<SheetPosition>>,
    options?: { closed?: boolean; openAtIndex?: number },
  ): PolygonData {
    if (points.length === 0) {
      throw new Error('PolygonData.fromAbsoluteSegments: points.length must be >= 1');
    }
    const xs = points.map((segment) => segment.point.x);
    const ys = points.map((segment) => segment.point.y);
    const position = new SheetPosition(Math.min(...xs), Math.min(...ys));
    return {
      type: 'polygon',
      position,
      points: points.map((segment) =>
        PolygonSegment.transform(
          segment,
          (point) => new GeometryRelativeSheetPosition(point.x - position.x, point.y - position.y),
        ),
      ),
      closed: options?.closed ?? points[0].point === points.at(-1)!.point,
      openAtIndex: options?.openAtIndex ?? 0,
    };
  }

  /** Returns the polygon segments in raw absolute sheet coordinates by adding `position` to each
   * local point. */
  export function rawSegments(
    geometry: Entity<GeometryComponent<PolygonData>>,
  ): Array<PolygonSegment<SheetPosition>> {
    const polygonData = GeometryComponent.get(geometry);
    const { position } = polygonData;
    return polygonData.points.map((segment) =>
      PolygonSegment.transform(
        segment,
        (point) => new SheetPosition(position.x + point.x, position.y + point.y),
      ),
    );
  }

  /** Returns the polygon segments projected into rendered sheet coordinates. */
  export function renderedSegments(
    geometry: Entity<GeometryComponent<PolygonData>>,
  ): Array<PolygonSegment<SheetPosition>> {
    const polygonData = GeometryComponent.get(geometry);
    return polygonData.points.map((segment) =>
      PolygonSegment.transform(segment, (point) => point.toSheet(geometry)),
    );
  }

  export function rawKeyPoints(
    geometry: Entity<GeometryComponent<PolygonData>>,
  ): KeyPoints<
    GeometryRelativeSheetPosition,
    'boundingBoxUpperLeft' | 'centroid',
    `Point ${number}`
  > {
    const polygonData = GeometryComponent.get(geometry);
    // Polygon key points are labelled in stored point order so that `Point N` always refers to
    // `polygonData.points[N - 1]`. Winding order is handled independently by the DCEL.
    const points = polygonData.points.map((p) => p.point);

    return {
      perimeter: points,
      perimeterLabels: points.map((_, index) => `Point ${index + 1}` as const),
      extras: {
        // The raw natural origin is the stable local-frame zero, even after edits move the
        // polygon's actual bounding box away from it.
        boundingBoxUpperLeft: new GeometryRelativeSheetPosition(0, 0),
        centroid: PolygonData.centroid(geometry),
      },
    };
  }

  /**
   * Computes the area centroid (center of mass) of the polygon's boundary, treating each segment
   * as a straight line between its endpoint vertices. For open polygons the ring is implicitly
   * closed from the last point back to the first. Degenerate polygons with ~zero enclosed area
   * (eg. a single point or collinear points) fall back to the average of the vertices.
   *
   * The result is expressed in local geometry coordinates.
   */
  export function centroid(
    geometry: Entity<GeometryComponent<PolygonData>>,
  ): GeometryRelativeSheetPosition {
    const { points } = GeometryComponent.get(geometry);
    if (points.length === 0) {
      throw new Error('PolygonData.centroid: cannot compute centroid of polygon with 0 points!');
    }
    const result = mathCentroid(points.map((p) => p.point));
    return new GeometryRelativeSheetPosition(result.x, result.y);
  }

  function localBoundingBox(polygonData: PolygonData): Rect<GeometryRelativeSheetPosition> {
    if (polygonData.points.length === 0) {
      throw new Error(
        'PolygonData.boundingBox: cannot compute bounding box of polygon with 0 points!',
      );
    }

    return BoundingBox.fromPoints(polygonData.points.map((segment) => segment.point));
  }

  function rawBoundingBox(polygonData: PolygonData): Rect<SheetPosition> {
    const local = localBoundingBox(polygonData);
    return {
      position: new SheetPosition(
        polygonData.position.x + local.position.x,
        polygonData.position.y + local.position.y,
      ),
      width: local.width,
      height: local.height,
    };
  }

  export function boundingBox(
    geometry: Entity<GeometryComponent<PolygonData>>,
  ): Rect<GeometryRelativeSheetPosition> {
    const local = localBoundingBox(GeometryComponent.get(geometry));
    return {
      position: new GeometryRelativeSheetPosition(local.position.x, local.position.y),
      width: local.width,
      height: local.height,
    };
  }

  export function orientedBoundingBox(
    polygonData: PolygonData,
    angleDegrees: number = 0,
  ): OrientedRect<GeometryRelativeSheetPosition> {
    const local = localBoundingBox(polygonData);
    return {
      position: new GeometryRelativeSheetPosition(local.position.x, local.position.y),
      width: local.width,
      height: local.height,
      angleDegrees,
    };
  }

  export function addPointOnEdge<G extends Entity<GeometryComponent<PolygonData>>>(
    geometry: G,
    constraints: Array<Entity<ConstraintComponent>>,
    segmentIndex: number,
    newPointPosition: { type: 't'; t: number } | { type: 'point'; point: SheetPosition },
  ): {
    geometry: G;
    /** A list of constraints that were re-indexed now that the point was added. */
    updatedConstraints: Array<Entity<ConstraintComponent>>;
    /** History events that can be replayed to apply the constraint updated in `updatedConstraints` */
    updatedConstraintHistoryEvents: Array<UndoEntry>;
  } | null {
    const polygon = GeometryComponent.get(geometry);
    const segment = polygon.points[segmentIndex];
    const nextSegment = polygon.points[segmentIndex + 1];

    if (!segment || !nextSegment) {
      return null;
    }

    const requestedLocalPoint =
      newPointPosition.type === 'point'
        ? new GeometryRelativeSheetPosition(
            newPointPosition.point.x - polygon.position.x,
            newPointPosition.point.y - polygon.position.y,
          )
        : null;

    let updatedGeometry: G | null = null;

    switch (nextSegment.type) {
      case 'point': {
        let insertPoint: GeometryRelativeSheetPosition;
        if (newPointPosition.type === 't') {
          insertPoint = Vector2.lerp(segment.point, nextSegment.point, newPointPosition.t);
        } else {
          insertPoint = requestedLocalPoint!;
        }
        updatedGeometry = GeometryComponent.update(geometry, {
          points: [
            ...polygon.points.slice(0, segmentIndex + 1),
            { type: 'point', point: insertPoint } as PointSegment<GeometryRelativeSheetPosition>,
            ...polygon.points.slice(segmentIndex + 1),
          ],
        });
        break;
      }
      case 'arc-quadratic': {
        const curve = {
          start: segment.point,
          controlPoint: nextSegment.controlPoint,
          end: nextSegment.point,
        };
        let t: number;
        if (newPointPosition.type === 't') {
          t = newPointPosition.t;
        } else {
          t = closestPointOnQuadraticCurve(curve, requestedLocalPoint!).t;
        }
        const [leftCurve, rightCurve] = DeCasteljau.splitQuadraticBezier(curve, t);

        updatedGeometry = GeometryComponent.update(geometry, {
          points: [
            ...polygon.points.slice(0, segmentIndex + 1),
            {
              type: 'arc-quadratic',
              point: leftCurve.end,
              controlPoint: leftCurve.controlPoint,
            } as QuadraticBezierSegment<GeometryRelativeSheetPosition>,
            {
              type: 'arc-quadratic',
              point: rightCurve.end,
              controlPoint: rightCurve.controlPoint,
            } as QuadraticBezierSegment<GeometryRelativeSheetPosition>,
            ...polygon.points.slice(segmentIndex + 2),
          ],
        });
        break;
      }
      case 'arc-cubic': {
        const curve = {
          start: segment.point,
          controlPointA: nextSegment.controlPointA,
          controlPointB: nextSegment.controlPointB,
          end: nextSegment.point,
        };
        let t: number;
        if (newPointPosition.type === 't') {
          t = newPointPosition.t;
        } else {
          t = closestPointOnCubicCurve(curve, requestedLocalPoint!).t;
        }
        const [leftCurve, rightCurve] = DeCasteljau.splitCubicBezier(curve, t);

        updatedGeometry = GeometryComponent.update(geometry, {
          points: [
            ...polygon.points.slice(0, segmentIndex + 1),
            {
              type: 'arc-cubic',
              point: leftCurve.end,
              controlPointA: leftCurve.controlPointA,
              controlPointB: leftCurve.controlPointB,
            } as CubicBezierSegment<GeometryRelativeSheetPosition>,
            {
              type: 'arc-cubic',
              point: rightCurve.end,
              controlPointA: rightCurve.controlPointA,
              controlPointB: rightCurve.controlPointB,
            } as CubicBezierSegment<GeometryRelativeSheetPosition>,
            ...polygon.points.slice(segmentIndex + 2),
          ],
        });
        break;
      }
    }

    if (!updatedGeometry) {
      return null;
    }

    // Re-index constraints: any locked-polygon endpoint referencing this polygon
    // with pointIndex >= segmentIndex + 1 must be incremented by 1.
    const polygonId = geometry.id;
    const updatedConstraints: Array<Entity<ConstraintComponent>> = [];
    const updatedConstraintHistoryEvents: Array<UndoEntry> = [];
    for (const constraintGeom of constraints) {
      const c = ConstraintComponent.get(constraintGeom);
      const keys = Constraint.getPositionKeys(constraintGeom);
      let modified: Record<string, unknown> | null = null;
      for (const key of keys) {
        const ep = Constraint.getEndpoint(constraintGeom, key);
        if (
          ep &&
          typeof ep === 'object' &&
          ep.type === 'locked-polygon' &&
          ep.id === polygonId &&
          ep.pointIndex >= segmentIndex + 1
        ) {
          if (modified === null) {
            modified = { ...c };
          }
          modified[key] = { ...ep, pointIndex: ep.pointIndex + 1 };
        }
      }
      if (!modified) {
        updatedConstraints.push(constraintGeom);
      } else {
        const afterGeom = ConstraintComponent.update(
          constraintGeom,
          modified as Partial<ConstraintData>,
        );
        updatedConstraints.push(afterGeom);
        const afterData = ConstraintComponent.get(afterGeom);
        switch (c.type) {
          case 'linear':
            updatedConstraintHistoryEvents.push({
              type: 'linear-constraint-move-endpoints',
              id: constraintGeom.id,
              beforePointA: c.pointA,
              beforePointB: c.pointB,
              afterPointA: afterData.pointA,
              afterPointB: afterData.pointB,
            });
            break;
          case 'perpendicular':
            updatedConstraintHistoryEvents.push({
              type: 'perpendicular-constraint-move-endpoints',
              id: constraintGeom.id,
              beforePointA: c.pointA,
              beforePointCenter: c.pointCenter,
              beforePointC: c.pointB,
              afterPointA: (afterData as PerpendicularConstraintData).pointA,
              afterPointCenter: (afterData as PerpendicularConstraintData).pointCenter,
              afterPointC: (afterData as PerpendicularConstraintData).pointB,
            });
            break;
          case 'parallel':
            updatedConstraintHistoryEvents.push({
              type: 'parallel-constraint-move-endpoints',
              id: constraintGeom.id,
              beforePointA: c.pointA,
              beforePointB: c.pointB,
              beforePointC: c.pointC,
              beforePointD: c.pointD,
              afterPointA: (afterData as ParallelConstraintData).pointA,
              afterPointB: (afterData as ParallelConstraintData).pointB,
              afterPointC: (afterData as ParallelConstraintData).pointC,
              afterPointD: (afterData as ParallelConstraintData).pointD,
            });
            break;
          case 'horizontal':
            updatedConstraintHistoryEvents.push({
              type: 'horizontal-constraint-move-endpoints',
              id: constraintGeom.id,
              beforePointA: c.pointA,
              beforePointB: c.pointB,
              afterPointA: (afterData as HorizontalConstraintData).pointA,
              afterPointB: (afterData as HorizontalConstraintData).pointB,
            });
            break;
          case 'vertical':
            updatedConstraintHistoryEvents.push({
              type: 'vertical-constraint-move-endpoints',
              id: constraintGeom.id,
              beforePointA: c.pointA,
              beforePointB: c.pointB,
              afterPointA: (afterData as VerticalConstraintData).pointA,
              afterPointB: (afterData as VerticalConstraintData).pointB,
            });
            break;
          case 'colinear':
            updatedConstraintHistoryEvents.push({
              type: 'colinear-constraint-move-endpoints',
              id: constraintGeom.id,
              beforePointTarget: c.pointTarget,
              beforePointA: c.pointA,
              beforePointB: c.pointB,
              afterPointTarget: (afterData as ColinearConstraintData).pointTarget,
              afterPointA: (afterData as ColinearConstraintData).pointA,
              afterPointB: (afterData as ColinearConstraintData).pointB,
            });
            break;
          default:
            c satisfies never;
            break;
        }
      }
    }

    const filtered: Array<Entity<ConstraintComponent>> = [];
    for (let i = 0; i < constraints.length; i += 1) {
      if (updatedConstraints[i] !== constraints[i]) {
        filtered.push(updatedConstraints[i]);
      }
    }

    return {
      geometry: updatedGeometry,
      updatedConstraints: filtered,
      updatedConstraintHistoryEvents,
    };
  }

  export function translate<E extends Entity<GeometryComponent<PolygonData>>>(
    geometry: E,
    translatePoint: (input: SheetPosition) => SheetPosition,
  ): E {
    const polygon = GeometryComponent.get(geometry);
    const oldPosition = polygon.position;
    const newPosition = translatePoint(oldPosition);
    const mapPoint = (point: GeometryRelativeSheetPosition) => {
      const absolute = new SheetPosition(oldPosition.x + point.x, oldPosition.y + point.y);
      const translated = translatePoint(absolute);
      return new GeometryRelativeSheetPosition(
        translated.x - newPosition.x,
        translated.y - newPosition.y,
      );
    };

    const newPoints = polygon.points.map((seg) => PolygonSegment.transform(seg, mapPoint));
    return GeometryComponent.update(geometry, { position: newPosition, points: newPoints });
  }

  export function getOrigin(geometry: Entity<GeometryComponent<PolygonData>>): SheetPosition {
    return GeometryComponent.get(geometry).position;
  }

  /**
   * Detects whether a polygon `points` update is a pure point-type change (segment types changed
   * but no coordinate-only moves and no insert/delete). Returns the list of changed segment
   * indexes, or null when the change is not a pure type change (fall back to polygon-move).
   */
  export function findTypeChangeIndexes(
    before: Array<PolygonSegment>,
    after: Array<PolygonSegment>,
  ): Array<number> | null {
    if (before.length !== after.length) {
      return null;
    }
    const indexes: Array<number> = [];
    for (let i = 0; i < before.length; i += 1) {
      if (before[i].type !== after[i].type) {
        indexes.push(i);
      } else if (!PolygonSegment.equals(before[i], after[i])) {
        return null;
      }
    }
    return indexes;
  }

  export function equals(a: Entity<GeometryComponent<PolygonData>>, b: Entity<GeometryComponent>) {
    const aData = GeometryComponent.get(a);
    const bData = GeometryComponent.get(b);
    if (bData.type !== 'polygon') {
      return false;
    }
    return (
      aData.position.x === bData.position.x &&
      aData.position.y === bData.position.y &&
      aData.points.length === bData.points.length &&
      aData.points.every((aps, index) => {
        const bps = bData.points[index];
        return PolygonSegment.equals(aps, bps);
      })
    );
  }

  export function resize<E extends Entity<GeometryComponent<PolygonData>>>(
    geometry: E,
    params: ResizeParams,
    originalBBox?: Rect<SheetPosition>,
  ): E | null {
    const state = GeometryComponent.get(geometry);
    if (!originalBBox) {
      originalBBox = rawBoundingBox(state);
    }
    if (!GeometryComponent.isValidResizeBBox(originalBBox)) {
      return null;
    }

    // FIXME: get rid of layout state, all its functionality should be handled now by the
    // GeometryComponent hierarchy.
    const newBBox = GeometryComponent.resizeBBox(originalBBox, params);
    if (!newBBox) {
      return null;
    }

    const mapPoint = (p: SheetPosition) => {
      const pctX = (p.x - originalBBox.position.x) / originalBBox.width;
      const pctY = (p.y - originalBBox.position.y) / originalBBox.height;
      return new SheetPosition(
        newBBox.position.x + pctX * newBBox.width,
        newBBox.position.y + pctY * newBBox.height,
      );
    };

    const newPoints = state.points.map((seg) =>
      PolygonSegment.transform(seg, (local) => {
        const absolute = new SheetPosition(state.position.x + local.x, state.position.y + local.y);
        const mapped = mapPoint(absolute);
        return new GeometryRelativeSheetPosition(
          mapped.x - state.position.x,
          mapped.y - state.position.y,
        );
      }),
    );

    return GeometryComponent.update(geometry, { points: newPoints });
  }
}

export namespace PolygonSegment {
  /** Type guard to check if a polygon segment is a quadratic bezier */
  export function isPoint<P extends Position>(c: PolygonSegment<P>): c is PointSegment<P> {
    return 'point' in c;
  }

  /** Type guard to check if a polygon segment is a quadratic bezier */
  export function isQuadratic<P extends Position>(
    c: PolygonSegment<P>,
  ): c is QuadraticBezierSegment<P> {
    return 'controlPoint' in c && !('controlPointA' in c);
  }

  /** Type guard to check if a polygon segment is a cubic bezier */
  export function isCubic<P extends Position>(c: PolygonSegment<P>): c is CubicBezierSegment<P> {
    return 'controlPointA' in c && !('controlPoint' in c);
  }

  /**
   * Converts a polygon segment to the requested type, preserving naturally-mapping control points
   * and defaulting any newly-introduced control points to the segment's `.point` value.
   */
  export function changePointType<P extends Position>(
    segment: PolygonSegment<P>,
    previousSegment: PolygonSegment<P>,
    type: PolygonSegment['type'],
  ): PolygonSegment<P> {
    switch (type) {
      case 'point':
        return { type: 'point', point: segment.point };
      case 'arc-quadratic':
        if (isQuadratic(segment)) {
          return segment;
        }
        return {
          type: 'arc-quadratic',
          point: segment.point,
          controlPoint: isCubic(segment)
            ? segment.controlPointA
            : Vector2.midpoint(segment.point, previousSegment.point),
        };
      case 'arc-cubic':
        if (isCubic(segment)) {
          return segment;
        }

        const center = Vector2.midpoint(segment.point, previousSegment.point);
        const quarter = Vector2.midpoint(center, segment.point);
        const threeQuarters = Vector2.midpoint(center, previousSegment.point);

        return {
          type: 'arc-cubic',
          point: segment.point,
          controlPointA: isQuadratic(segment) ? segment.controlPoint : threeQuarters,
          controlPointB: quarter,
        };
      default:
        throw new Error(`PolygonSegment.changeType: unknown segment type ${type as any}`);
    }
  }

  /** Are two {@link PolygonSegment}s 100% equal? */
  export function equals<P extends Position>(a: PolygonSegment<P>, b: PolygonSegment<P>): boolean {
    if (a.type !== b.type) {
      return false;
    }
    if (a.point.x !== b.point.x || a.point.y !== b.point.y) {
      return false;
    }
    switch (a.type) {
      case 'point':
        return true;
      case 'arc-quadratic':
        return (
          a.controlPoint.x === (b as QuadraticBezierSegment<P>).controlPoint.x &&
          a.controlPoint.y === (b as QuadraticBezierSegment<P>).controlPoint.y
        );
      case 'arc-cubic':
        return (
          a.controlPointA.x === (b as CubicBezierSegment<P>).controlPointA.x &&
          a.controlPointA.y === (b as CubicBezierSegment<P>).controlPointA.y &&
          a.controlPointB.x === (b as CubicBezierSegment<P>).controlPointB.x &&
          a.controlPointB.y === (b as CubicBezierSegment<P>).controlPointB.y
        );
    }
  }

  /** Apply the given transform function to all {@link SheetPosition}s contained within the
   * passed {@link PolygonSegment. */
  export function transform<P extends Position, Q extends Position>(
    segment: PolygonSegment<P>,
    apply: (old: P) => Q,
  ): PolygonSegment<Q> {
    switch (segment.type) {
      case 'point':
        return { ...segment, point: apply(segment.point) };
      case 'arc-quadratic':
        return {
          ...segment,
          point: apply(segment.point),
          controlPoint: apply(segment.controlPoint),
        };
      case 'arc-cubic':
        return {
          ...segment,
          point: apply(segment.point),
          controlPointA: apply(segment.controlPointA),
          controlPointB: apply(segment.controlPointB),
        };
    }
  }

  export function toLineSegmentOrCurve<P extends Position>(
    prevPoint: P,
    segment: PointSegment<P>,
  ): LineSegment<P>;
  export function toLineSegmentOrCurve<P extends Position>(
    prevPoint: P,
    segment: QuadraticBezierSegment<P>,
  ): QuadraticCurve<P>;
  export function toLineSegmentOrCurve<P extends Position>(
    prevPoint: P,
    segment: CubicBezierSegment<P>,
  ): CubicCurve<P>;
  export function toLineSegmentOrCurve<P extends Position>(
    prevPoint: P,
    segment: PolygonSegment<P>,
  ): LineSegment<P> | QuadraticCurve<P> | CubicCurve<P>;
  export function toLineSegmentOrCurve<P extends Position>(
    prevPoint: P,
    segment: PolygonSegment<P>,
  ): LineSegment<P> | QuadraticCurve<P> | CubicCurve<P> {
    switch (segment.type) {
      case 'point':
        return { start: prevPoint, end: segment.point };
      case 'arc-quadratic':
        return { start: prevPoint, controlPoint: segment.controlPoint, end: segment.point };
      case 'arc-cubic':
        return {
          start: prevPoint,
          controlPointA: segment.controlPointA,
          controlPointB: segment.controlPointB,
          end: segment.point,
        };
    }
  }

  export function fromLineSegmentOrCurve<P extends Position>(
    c: LineSegment<P> | QuadraticCurve<P> | CubicCurve<P>,
  ): [P, PolygonSegment<P>] {
    if (QuadraticCurve.isQuadraticCurve(c)) {
      return [c.start, { type: 'arc-quadratic', controlPoint: c.controlPoint, point: c.end }];
    } else if (CubicCurve.isCubicCurve(c)) {
      return [
        c.start,
        {
          type: 'arc-cubic',
          controlPointA: c.controlPointA,
          controlPointB: c.controlPointB,
          point: c.end,
        },
      ];
    } else if (LineSegment.isLineSegment(c)) {
      return [c.start, { type: 'point', point: c.end }];
    } else {
      throw new Error(`Unknown segment type: ${c}`);
    }
  }

  /**
   * Reverses the direction of a polygon path, so that it is traversed from the last
   * point back to the first. For cubic Bezier segments, controlPointA and
   * controlPointB are swapped so the curve retains its geometric shape when drawn
   * backwards. Quadratic and line segments require no control-point adjustments.
   *
   * A polygon path is stored as an array where the first element is the moveTo
   * start point, and each subsequent element is a curve/line whose `.point` is
   * its endpoint. This function shifts the `.point` values by one position in the
   * reversed array so that the new first element is a proper moveTo start point.
   */
  export function reverseList<P extends Position>(
    segments: Array<PolygonSegment<P>>,
  ): Array<PolygonSegment<P>> {
    if (segments.length <= 1) {
      if (segments.length === 0) {
        return [];
      }
      return [{ type: 'point' as const, point: segments[0].point }];
    }

    const n = segments.length;
    const reversed: Array<PolygonSegment<P>> = [];

    // The last point of the original path becomes the moveTo start of the reversed path.
    reversed.push({ type: 'point' as const, point: segments[n - 1].point });

    // For each remaining position, the reversed segment comes from the forward segment
    // at index j = n - i, with the endpoint shifted to the earlier point.
    for (let i = 1; i < n; i += 1) {
      const forwardSeg = segments[n - i];
      const newPoint = segments[n - i - 1].point;

      switch (forwardSeg.type) {
        case 'point':
          reversed.push({ type: 'point', point: newPoint });
          break;
        case 'arc-quadratic':
          reversed.push({
            type: 'arc-quadratic',
            point: newPoint,
            controlPoint: forwardSeg.controlPoint,
          });
          break;
        case 'arc-cubic':
          reversed.push({
            type: 'arc-cubic',
            point: newPoint,
            controlPointA: forwardSeg.controlPointB,
            controlPointB: forwardSeg.controlPointA,
          });
          break;
        default:
          forwardSeg satisfies never;
          throw new Error(
            `PolygonSegment.reverse: unknown segment type ${(forwardSeg as any).type}`,
          );
      }
    }

    return reversed;
  }
}
