import { type UndoEntry } from '@/lib/history/types';
import {
  BoundingBox,
  DeCasteljau,
  Vector2,
  closestPointOnCubicCurve,
  closestPointOnQuadraticCurve,
  convexPolygonWindOrder,
} from '@/lib/math';
import {
  CubicCurve,
  KeyPoints,
  LineSegment,
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
export type PointSegment = {
  type: 'point';
  point: SheetPosition;
};

/** A quadratic Bezier arc. The user alt+clicks to place the arc endpoint,
 * then clicks to place the quadratic Bezier control point directly.
 * The curve passes near but not through the control point. */
export type QuadraticBezierSegment = {
  type: 'arc-quadratic';
  point: SheetPosition;
  controlPoint: SheetPosition;
};

/** A cubic Bezier arc where the user places both off-curve control points.
 * The curve passes through neither control point. */
export type CubicBezierSegment = {
  type: 'arc-cubic';
  point: SheetPosition;
  controlPointA: SheetPosition;
  controlPointB: SheetPosition;
};

/** A segment of a polygon — either a straight line or an arc. */
export type PolygonSegment = PointSegment | QuadraticBezierSegment | CubicBezierSegment;

/** A completed polygon with an id, segments, and closed state. */
export type PolygonData = {
  type: 'polygon';
  points: Array<PolygonSegment>;
  closed: boolean;
  openAtIndex: number;

  /** Cached fill color of the polygon when it is open */
  lastFillColor?: number | null;
};

export namespace PolygonData {
  export function keyPoints(
    geometry: Entity<GeometryComponent<PolygonData>>,
  ): KeyPoints<SheetPosition, never> {
    const polygonData = GeometryComponent.get(geometry);
    const points = polygonData.points.map((p) => p.point);

    const windOrder = convexPolygonWindOrder(points);
    if (windOrder === 'clockwise') {
      points.reverse();
    }

    return {
      perimeter: points,
      perimeterLabels: points.map(() => null),
      extras: {},
    };
  }

  export function boundingBox(
    geometry: Entity<GeometryComponent<PolygonData>>,
  ): Rect<SheetPosition> {
    const polygonData = GeometryComponent.get(geometry);

    if (polygonData.points.length === 0) {
      throw new Error(
        'PolygonData.boundingBox: cannot compute bounding box of polygon with 0 points!',
      );
    }

    let upperLeftX = Infinity,
      upperLeftY = Infinity;
    let lowerRightX = -Infinity,
      lowerRightY = -Infinity;
    for (const seg of polygonData.points) {
      if (seg.point.x < upperLeftX) {
        upperLeftX = seg.point.x;
      }
      if (seg.point.y < upperLeftY) {
        upperLeftY = seg.point.y;
      }
      if (seg.point.x > lowerRightX) {
        lowerRightX = seg.point.x;
      }
      if (seg.point.y > lowerRightY) {
        lowerRightY = seg.point.y;
      }
    }

    return {
      position: new SheetPosition(upperLeftX, upperLeftY),
      width: lowerRightX - upperLeftX,
      height: lowerRightY - upperLeftY,
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

    let updatedGeometry: G | null = null;

    switch (nextSegment.type) {
      case 'point': {
        let insertPoint: SheetPosition;
        if (newPointPosition.type === 't') {
          insertPoint = Vector2.lerp(segment.point, nextSegment.point, newPointPosition.t);
        } else {
          insertPoint = newPointPosition.point;
        }
        updatedGeometry = GeometryComponent.update(geometry, {
          points: [
            ...polygon.points.slice(0, segmentIndex + 1),
            { type: 'point', point: insertPoint } as PointSegment,
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
          t = closestPointOnQuadraticCurve(curve, newPointPosition.point).t;
        }
        const [leftCurve, rightCurve] = DeCasteljau.splitQuadraticBezier(curve, t);

        updatedGeometry = GeometryComponent.update(geometry, {
          points: [
            ...polygon.points.slice(0, segmentIndex + 1),
            {
              type: 'arc-quadratic',
              point: leftCurve.end,
              controlPoint: leftCurve.controlPoint,
            } as QuadraticBezierSegment,
            {
              type: 'arc-quadratic',
              point: rightCurve.end,
              controlPoint: rightCurve.controlPoint,
            } as QuadraticBezierSegment,
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
          t = closestPointOnCubicCurve(curve, newPointPosition.point).t;
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
            } as CubicBezierSegment,
            {
              type: 'arc-cubic',
              point: rightCurve.end,
              controlPointA: rightCurve.controlPointA,
              controlPointB: rightCurve.controlPointB,
            } as CubicBezierSegment,
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

  export function translate(
    geometry: Entity<GeometryComponent<PolygonData>>,
    translatePoint: (input: SheetPosition) => SheetPosition,
  ) {
    const polygon = GeometryComponent.get(geometry);
    const newPoints = polygon.points.map((seg) => {
      const newSeg: typeof seg = { ...seg };
      newSeg.point = translatePoint(seg.point);
      if (PolygonSegment.isQuadratic(seg)) {
        (newSeg as QuadraticBezierSegment).controlPoint = translatePoint(seg.controlPoint);
      }
      if (PolygonSegment.isCubic(seg)) {
        (newSeg as CubicBezierSegment).controlPointA = translatePoint(seg.controlPointA);
        (newSeg as CubicBezierSegment).controlPointB = translatePoint(seg.controlPointB);
      }
      return newSeg;
    });
    return GeometryComponent.update(geometry, { points: newPoints });
  }

  export function equals(a: Entity<GeometryComponent<PolygonData>>, b: Entity<GeometryComponent>) {
    const aData = GeometryComponent.get(a);
    const bData = GeometryComponent.get(b);
    if (bData.type !== 'polygon') {
      return false;
    }
    return (
      aData.points.length === bData.points.length &&
      aData.points.every((aps, index) => {
        const bps = bData.points[index];
        return PolygonSegment.equals(aps, bps);
      })
    );
  }

  export function resize(
    geometry: Entity<GeometryComponent<PolygonData>>,
    params: ResizeParams,
    originalBBox?: Rect<SheetPosition>,
  ): Entity<GeometryComponent<PolygonData>> | null {
    const state = GeometryComponent.get(geometry);
    if (!originalBBox) {
      const pointsArray = state.points.map((seg) => seg.point);
      originalBBox = BoundingBox.fromPoints(pointsArray);
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

    const newPoints = state.points.map((seg) => {
      const newSeg: typeof seg = { ...seg };
      newSeg.point = mapPoint(seg.point);
      if (PolygonSegment.isQuadratic(seg)) {
        (newSeg as QuadraticBezierSegment).controlPoint = mapPoint(
          (seg as typeof seg & { controlPoint: SheetPosition }).controlPoint,
        );
      }
      if (PolygonSegment.isCubic(seg)) {
        const cubicSeg = seg as typeof seg & {
          controlPointA: SheetPosition;
          controlPointB: SheetPosition;
        };
        const newCubicSeg = newSeg as typeof seg & {
          controlPointA: SheetPosition;
          controlPointB: SheetPosition;
        };
        newCubicSeg.controlPointA = mapPoint(cubicSeg.controlPointA);
        newCubicSeg.controlPointB = mapPoint(cubicSeg.controlPointB);
      }
      return newSeg;
    });

    return GeometryComponent.update(geometry, { points: newPoints });
  }
}

export namespace PolygonSegment {
  /** Type guard to check if a polygon segment is a quadratic bezier */
  export function isPoint(
    c: PointSegment | QuadraticBezierSegment | CubicBezierSegment,
  ): c is PointSegment {
    return 'point' in c;
  }

  /** Type guard to check if a polygon segment is a quadratic bezier */
  export function isQuadratic(
    c: PointSegment | QuadraticBezierSegment | CubicBezierSegment,
  ): c is QuadraticBezierSegment {
    return 'controlPoint' in c && !('controlPointA' in c);
  }

  /** Type guard to check if a polygon segment is a cubic bezier */
  export function isCubic(
    c: PointSegment | QuadraticBezierSegment | CubicBezierSegment,
  ): c is CubicBezierSegment {
    return 'controlPointA' in c && !('controlPoint' in c);
  }

  export function equals(a: PolygonSegment, b: PolygonSegment): boolean {
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
          a.controlPoint.x === (b as QuadraticBezierSegment).controlPoint.x &&
          a.controlPoint.y === (b as QuadraticBezierSegment).controlPoint.y
        );
      case 'arc-cubic':
        return (
          a.controlPointA.x === (b as CubicBezierSegment).controlPointA.x &&
          a.controlPointA.y === (b as CubicBezierSegment).controlPointA.y &&
          a.controlPointB.x === (b as CubicBezierSegment).controlPointB.x &&
          a.controlPointB.y === (b as CubicBezierSegment).controlPointB.y
        );
    }
  }

  export function toLineSegmentOrCurve(
    prevPoint: SheetPosition,
    segment: PointSegment,
  ): LineSegment<SheetPosition>;
  export function toLineSegmentOrCurve(
    prevPoint: SheetPosition,
    segment: QuadraticBezierSegment,
  ): QuadraticCurve<SheetPosition>;
  export function toLineSegmentOrCurve(
    prevPoint: SheetPosition,
    segment: CubicBezierSegment,
  ): CubicCurve<SheetPosition>;
  export function toLineSegmentOrCurve(
    prevPoint: SheetPosition,
    segment: PolygonSegment,
  ): LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition>;
  export function toLineSegmentOrCurve(
    prevPoint: SheetPosition,
    segment: PolygonSegment,
  ): LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition> {
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

  export function fromLineSegmentOrCurve(
    c: LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition>,
  ): [SheetPosition, PolygonSegment] {
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
}
