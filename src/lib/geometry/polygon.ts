import { convexPolygonWindOrder } from '@/lib/math';
import { SheetPosition } from '@/lib/viewport/types';
import { type Id } from './types';

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
}

/** A polygon without params that will be added by the {@link GeometryStore#addPolygon} method */
export type PolygonTemplate = Omit<Polygon, 'id' | 'renderOrder'>;

/** A completed polygon with an id, segments, and closed state. */
export type Polygon = {
  id: Id;
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
