import {
  ColinearConstraint,
  Constraint,
  ConstraintEndpoint,
  HorizontalConstraint,
  LinearConstraint,
  ParallelConstraint,
  PerpendicularConstraint,
  VerticalConstraint,
} from '@/lib/geometry/constraints';
import type { UndoEntry } from '@/lib/history/types';
import { DeCasteljau, boundingBox as computeBoundingBox, convexPolygonWindOrder } from '@/lib/math';
import { KeyPoints, Rect, SheetPosition } from '@/lib/viewport/types';
import { DEFAULT_COLOR } from '../colors';
import {
  type CubicBezierSegment,
  type PointSegment,
  PolygonSegment,
  type QuadraticBezierSegment,
} from '../polygon';
import {
  Geometry,
  GeometryComponent,
  GeometryOmitComponents,
  LayoutState,
  type ResizeParams,
} from '../types';
import { FillColorComponent } from './FillColorComponent';

/**
 * Geometry component containing rendering metadata about a polygonal shaped geometry.
 *
 * A component of Polygon, but also could be used by other polygonal shaped geometries if
 * desired. */
export type PolygonComponent = GeometryComponent<
  'polygon',
  {
    points: Array<PolygonSegment>;
    closed: boolean;
    openAtIndex: number;

    /** Cached fill color of the polygon when it is open */
    lastFillColor?: number | null;
  }
>;

export namespace PolygonComponent {
  export const key: keyof PolygonComponent = 'polygon';

  export function create(
    points: Array<PolygonSegment>,
    options?: { closed?: boolean; openAtIndex?: number },
  ): PolygonComponent {
    if (points.length < 2) {
      throw new Error(
        `PolygonComponent.create: points.length must be >= 2, found ${points.length}`,
      );
    }
    return {
      polygon: {
        points,
        closed: options?.closed ?? points[0].point === points.at(-1)!.point,
        openAtIndex: options?.openAtIndex ?? 0,
      },
    };
  }

  export function get(
    geometry: Geometry<PolygonComponent>,
  ): PolygonComponent[keyof PolygonComponent] {
    return geometry.components.polygon;
  }

  export function update<G extends Geometry<PolygonComponent>>(
    geometry: G,
    polygon: Partial<PolygonComponent[keyof PolygonComponent]>,
  ): G {
    const merged = { ...geometry.components.polygon, ...polygon };
    merged.openAtIndex = Math.max(0, Math.min(merged.openAtIndex, merged.points.length - 1));

    let components: any = {
      ...geometry.components,
      polygon: merged,
    };

    return { ...geometry, components };
  }

  export function dropLastFillColor<G extends Geometry<PolygonComponent>>(geometry: G): G {
    const polygon = { ...geometry.components.polygon };
    delete polygon.lastFillColor;
    return { ...geometry, components: { ...geometry.components, polygon } };
  }

  export function openPath<G extends Geometry<PolygonComponent & Partial<FillColorComponent>>>(
    geometry: G,
  ): G | GeometryOmitComponents<G, FillColorComponent> {
    const polygon = PolygonComponent.get(geometry);
    if (!polygon.closed || polygon.points.length < 3) {
      return geometry;
    }

    const intermediate = PolygonComponent.update(geometry, {
      points: [
        ...polygon.points.slice(
          polygon.openAtIndex + 1,
          -1 /* remove closed mode "duplicate" point */,
        ),
        ...polygon.points.slice(0, polygon.openAtIndex + 1),
      ],
      closed: false,
      lastFillColor: FillColorComponent.getOptional(geometry),
    });

    // Remove fill color when polygon is open
    return FillColorComponent.remove(intermediate);
  }

  export function closePath<G extends Geometry<PolygonComponent & Partial<FillColorComponent>>>(
    geometry: G,
  ): G {
    const polygonData = PolygonComponent.get(geometry);
    if (polygonData.closed || polygonData.points.length < 3) {
      return geometry;
    }

    const splitAt = polygonData.points.length - (polygonData.openAtIndex + 1);
    const intermediate = PolygonComponent.update(geometry, {
      points: [
        ...polygonData.points.slice(splitAt),
        ...polygonData.points.slice(0, splitAt),
        // Add back in final "closing" point
        { type: 'point', point: polygonData.points[splitAt].point },
      ],
      closed: true,
    });

    // Add back in fill color when polygon is closed
    return PolygonComponent.dropLastFillColor(
      FillColorComponent.update(
        intermediate,
        typeof polygonData.lastFillColor !== 'undefined'
          ? polygonData.lastFillColor
          : DEFAULT_COLOR,
      ),
    );
  }

  export function keyPoints(geometry: Geometry<PolygonComponent>): KeyPoints<SheetPosition, never> {
    const polygonData = PolygonComponent.get(geometry);
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

  export function boundingBox(geometry: Geometry<PolygonComponent>): Rect<SheetPosition> {
    const polygonData = PolygonComponent.get(geometry);

    if (polygonData.points.length === 0) {
      throw new Error(
        'PolygonComponent.boundingBox: cannot compute bounding box of polygon with 0 points!',
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

  export function addPointOnEdge<G extends Geometry<PolygonComponent>>(
    geometry: G,
    constraints: Array<Constraint>,
    segmentIndex: number,
    newPoint: SheetPosition,
    t?: number,
  ): {
    geometry: G;
    /** A list of constraints that were re-indexed now that the point was added. */
    updatedConstraints: Array<Constraint>;
    /** History events that can be replayed to apply the constraint updated in `updatedConstraints` */
    updatedConstraintHistoryEvents: Array<UndoEntry>;
  } | null {
    const polygon = PolygonComponent.get(geometry);
    const segment = polygon.points[segmentIndex];
    const nextSegment = polygon.points[segmentIndex + 1];

    if (!segment || !nextSegment) {
      return null;
    }

    let updatedGeometry: G | null = null;

    switch (nextSegment.type) {
      case 'point':
        if (segment.type !== 'point') {
          return null;
        }
        updatedGeometry = PolygonComponent.update(geometry, {
          points: [
            ...polygon.points.slice(0, segmentIndex + 1),
            { type: 'point', point: newPoint } as PointSegment,
            ...polygon.points.slice(segmentIndex + 1),
          ],
        });
        break;
      case 'arc-quadratic': {
        if (typeof t === 'undefined') {
          return null;
        }
        if (segment.type !== 'point') {
          return null;
        }
        const curve = {
          start: segment.point,
          controlPoint: nextSegment.controlPoint,
          end: nextSegment.point,
        };
        const [leftCurve, rightCurve] = DeCasteljau.splitQuadraticBezier(curve, t);

        updatedGeometry = PolygonComponent.update(geometry, {
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
        if (typeof t === 'undefined') {
          return null;
        }
        if (segment.type !== 'point') {
          return null;
        }
        const curve = {
          start: segment.point,
          controlPointA: nextSegment.controlPointA,
          controlPointB: nextSegment.controlPointB,
          end: nextSegment.point,
        };
        const [leftCurve, rightCurve] = DeCasteljau.splitCubicBezier(curve, t);

        updatedGeometry = PolygonComponent.update(geometry, {
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
    const updatedConstraints: Array<Constraint> = [];
    const updatedConstraintHistoryEvents: Array<UndoEntry> = [];
    for (const c of constraints) {
      const keys = Constraint.getPositionKeys(c);
      let changed = false;
      for (const key of keys) {
        const ep = (c as any)[key] as ConstraintEndpoint;
        if (
          ep &&
          typeof ep === 'object' &&
          ep.type === 'locked-polygon' &&
          ep.id === polygonId &&
          ep.pointIndex >= segmentIndex + 1
        ) {
          if (!changed) {
            // Shallow-copy constraint first time it needs a change
            updatedConstraints.push({ ...c, [key]: { ...ep, pointIndex: ep.pointIndex + 1 } });
            changed = true;
          } else {
            // Apply additional change on the already-copied constraint
            const last = updatedConstraints[updatedConstraints.length - 1];
            (last as any)[key] = { ...ep, pointIndex: ep.pointIndex + 1 };
          }
        }
      }
      if (!changed) {
        updatedConstraints.push(c);
      } else {
        // Constraint was modified — create a per-type undo entry
        const after = updatedConstraints[updatedConstraints.length - 1];
        switch (c.type) {
          case 'linear':
            updatedConstraintHistoryEvents.push({
              type: 'linear-constraint-move-endpoints',
              id: c.id,
              beforePointA: c.pointA,
              beforePointB: c.pointB,
              afterPointA: (after as LinearConstraint).pointA,
              afterPointB: (after as LinearConstraint).pointB,
            });
            break;
          case 'perpendicular':
            updatedConstraintHistoryEvents.push({
              type: 'perpendicular-constraint-move-endpoints',
              id: c.id,
              beforePointA: c.pointA,
              beforePointCenter: c.pointCenter,
              beforePointC: c.pointB,
              afterPointA: (after as PerpendicularConstraint).pointA,
              afterPointCenter: (after as PerpendicularConstraint).pointCenter,
              afterPointC: (after as PerpendicularConstraint).pointB,
            });
            break;
          case 'parallel':
            updatedConstraintHistoryEvents.push({
              type: 'parallel-constraint-move-endpoints',
              id: c.id,
              beforePointA: c.pointA,
              beforePointB: c.pointB,
              beforePointC: c.pointC,
              beforePointD: c.pointD,
              afterPointA: (after as ParallelConstraint).pointA,
              afterPointB: (after as ParallelConstraint).pointB,
              afterPointC: (after as ParallelConstraint).pointC,
              afterPointD: (after as ParallelConstraint).pointD,
            });
            break;
          case 'horizontal':
            updatedConstraintHistoryEvents.push({
              type: 'horizontal-constraint-move-endpoints',
              id: c.id,
              beforePointA: c.pointA,
              beforePointB: c.pointB,
              afterPointA: (after as HorizontalConstraint).pointA,
              afterPointB: (after as HorizontalConstraint).pointB,
            });
            break;
          case 'vertical':
            updatedConstraintHistoryEvents.push({
              type: 'vertical-constraint-move-endpoints',
              id: c.id,
              beforePointA: c.pointA,
              beforePointB: c.pointB,
              afterPointA: (after as VerticalConstraint).pointA,
              afterPointB: (after as VerticalConstraint).pointB,
            });
            break;
          case 'colinear':
            updatedConstraintHistoryEvents.push({
              type: 'colinear-constraint-move-endpoints',
              id: c.id,
              beforePointTarget: c.pointTarget,
              beforePointA: c.pointA,
              beforePointB: c.pointB,
              afterPointTarget: (after as ColinearConstraint).pointTarget,
              afterPointA: (after as ColinearConstraint).pointA,
              afterPointB: (after as ColinearConstraint).pointB,
            });
            break;
          default:
            c satisfies never;
            break;
        }
      }
    }

    const filtered: Array<Constraint> = [];
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

  export function getLayoutState<G extends Geometry<PolygonComponent>>(geometry: G) {
    return { for: 'polygon' as const, points: PolygonComponent.get(geometry).points.slice() };
  }
  export function setLayoutState<G extends Geometry<PolygonComponent>>(
    geometry: G,
    state: ReturnType<typeof getLayoutState>,
  ) {
    if (state.for !== 'polygon') {
      return geometry;
    }
    return PolygonComponent.update(geometry, { points: state.points });
  }
  export function layoutStateTranslate(
    state: ReturnType<typeof getLayoutState>,
    translatePoint: (input: SheetPosition) => SheetPosition,
  ) {
    const newPoints = state.points.map((seg) => {
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
    return { ...state, points: newPoints };
  }
  export function layoutStateEqual(
    a: ReturnType<typeof getLayoutState>,
    b: ReturnType<typeof getLayoutState>,
  ) {
    if (a.for !== 'polygon' || b.for !== 'polygon') {
      return false;
    }
    return (
      a.points.length === b.points.length &&
      a.points.every((aps, index) => {
        const bps = b.points[index];
        return PolygonSegment.equals(aps, bps);
      })
    );
  }

  export function layoutStateResize(
    state: ReturnType<typeof getLayoutState>,
    params: ResizeParams,
    originalBBox?: Rect<SheetPosition>,
  ): ReturnType<typeof getLayoutState> | null {
    if (!originalBBox) {
      const pointsArray = state.points.map((seg) => seg.point);
      originalBBox = computeBoundingBox(pointsArray);
    }

    const newBBox = LayoutState.resizeBBox(originalBBox, params);
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

    return { for: 'polygon' as const, points: newPoints };
  }
}
