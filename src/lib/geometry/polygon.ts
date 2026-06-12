import { CubicCurve, LineSegment, QuadraticCurve, SheetPosition } from '@/lib/viewport/types';
import { DEFAULT_COLOR } from './colors';
import { FillColorComponent } from './components/FillColorComponent';
import { PolygonComponent } from './components/PolygonComponent';
import { RenderOrderComponent } from './components/RenderOrderComponent';
import { type Geometry, GeometryOmitComponents } from './types';

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

/** A polygon without params that will be added by the {@link GeometryStore#addPolygon} method */
export type PolygonTemplate = Omit<GeometryOmitComponents<Polygon, RenderOrderComponent>, 'id'>;

/** A completed polygon with an id, segments, and closed state. */
export type Polygon = Geometry<
  PolygonComponent & Partial<FillColorComponent> & RenderOrderComponent
>;

export namespace Polygon {
  /** Create a new {@link PolygonTemplate} which can be created by {@link GeometryStore#addPolygon}. */
  export function create(
    points: Array<PolygonSegment>,
    options?: {
      fillColor?: number | null;
      closed?: boolean;
      openAtIndex?: number;
    },
  ): PolygonTemplate {
    if (points.length < 2) {
      throw new Error(`Polygon.create: points.length must be >= 2, found ${points.length}`);
    }
    const fillColor = options?.fillColor;
    const closed = options?.closed ?? points[0].point === points.at(-1)!.point;
    return {
      components: {
        ...(closed
          ? FillColorComponent.create(typeof fillColor !== 'undefined' ? fillColor : DEFAULT_COLOR)
          : {}),
        ...PolygonComponent.create(points, {
          closed,
          openAtIndex: options?.openAtIndex,
        }),
      },
    };
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
