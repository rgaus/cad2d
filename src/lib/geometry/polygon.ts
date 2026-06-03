import { convexPolygonWindOrder } from '@/lib/math';
import { CubicCurve, LineSegment, QuadraticCurve, SheetPosition } from '@/lib/viewport/types';
import { type Geometry, FillColorComponent, GeometryOmitComponents, PolygonComponent, RenderOrderComponent } from './types';
import { DEFAULT_COLOR } from './colors';

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

  export function toLineSegmentOrCurve(prevPoint: SheetPosition, segment: PointSegment): LineSegment<SheetPosition>;
  export function toLineSegmentOrCurve(prevPoint: SheetPosition, segment: QuadraticBezierSegment): QuadraticCurve<SheetPosition>;
  export function toLineSegmentOrCurve(prevPoint: SheetPosition, segment: CubicBezierSegment): CubicCurve<SheetPosition>;
  export function toLineSegmentOrCurve(prevPoint: SheetPosition, segment: PolygonSegment): LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition>;
  export function toLineSegmentOrCurve(prevPoint: SheetPosition, segment: PolygonSegment): LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition> {
    switch (segment.type) {
      case "point":
        return { start: prevPoint, end: segment.point };
      case "arc-quadratic":
        return { start: prevPoint, controlPoint: segment.controlPoint, end: segment.point };
      case "arc-cubic":
        return { start: prevPoint, controlPointA: segment.controlPointA, controlPointB: segment.controlPointB, end: segment.point };
    }
  }

  export function fromLineSegmentOrCurve(c: LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition>): [SheetPosition, PolygonSegment] {
    if (QuadraticCurve.isQuadraticCurve(c)) {
      return [c.start, { type: "arc-quadratic", controlPoint: c.controlPoint, point: c.end}];
    } else if (CubicCurve.isCubicCurve(c)) {
      return [c.start, { type: "arc-cubic", controlPointA: c.controlPointA, controlPointB: c.controlPointB, point: c.end}];
    } else if (LineSegment.isLineSegment(c)) {
      return [c.start, { type: "point", point: c.end}];
    } else {
      throw new Error(`Unknown segment type: ${c}`);
    }
  }
}

/** A polygon without params that will be added by the {@link GeometryStore#addPolygon} method */
export type PolygonTemplate = Omit<GeometryOmitComponents<Polygon, RenderOrderComponent>, 'id' | 'renderOrder'>;

/** A completed polygon with an id, segments, and closed state. */
export type Polygon = Geometry<PolygonComponent & FillColorComponent & RenderOrderComponent> & {
  /** A list of points that make up the polygon. NOTE: this list duplicates the start and end point
   * for closed polygons, as there is no other way to represent a polygon where the last segment is
   * not linear. */
  points: Array<PolygonSegment>;
  closed: boolean;
  /** Fill color as a 24-bit integer (0xRRGGBB), or null for no fill. */
  fillColor: number | null;
  /** The index where the gap appears when closed is false. Must be a valid index within points. */
  openAtIndex: number;
  /** Controls rendering order. Higher values render on top of lower values. */
  renderOrder: number;
};

export namespace Polygon {
  /** Create a new {@link RectangleTemplate} which can be created by {@link GeometryStore#addRectangle}. */
  export function create(
    points: Array<PolygonSegment>,
    options?: {
      fillColor?: Polygon['fillColor'];
      closed?: Polygon['closed'];
      openAtIndex?: Polygon['openAtIndex'];
    },
  ): PolygonTemplate {
    if (points.length < 2) {
      throw new Error(`Polygon.create: points.length must be >= 2, found ${points.length}`);
    }
    const fillColor = options?.fillColor;
    return {
      points,
      components: {
        ...FillColorComponent.create(typeof fillColor !== 'undefined' ? fillColor : DEFAULT_COLOR),
        ...PolygonComponent.create(points, {
          closed: options?.closed,
          openAtIndex: options?.openAtIndex,
        }),
      },
      closed: options?.closed ?? (points[0].point === points.at(-1)!.point),
      fillColor: typeof fillColor !== 'undefined' ? fillColor : DEFAULT_COLOR,
      openAtIndex: options?.openAtIndex ?? 0,
    };
  }
  /**
   * Key points that are added as verticies within the DCEL and available for a user to snap other
   * entities like constraints to.
   **/
  export function keyPoints(polygon: Polygon): { perimeter: Array<SheetPosition>; extras: {} } {
    const points = polygon.points.map((p) => p.point);

    // NOTE: it is very important that perimeter winds counter clockwise, as that is what the DCEL
    // expects.
    const windOrder = Polygon.windDirection(polygon);
    if (windOrder === 'clockwise') {
      points.reverse();
    }

    return {
      perimeter: points,
      extras: {},
    };
  }

  /** Compute the signed area via the shoelace formula: https://en.wikipedia.org/wiki/Shoelace_formula
   * A positive result means counter-clockwise (standard math coords),
   * negative means clockwise. */
  export function windDirection(polygon: Polygon) {
    return convexPolygonWindOrder(polygon.points.map((p) => p.point));
  }
}
