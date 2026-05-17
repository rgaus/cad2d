import { SheetPosition } from "@/lib/viewport/types";

/** A stable unique identifier for a shape. */
export type Id = string;

/** A straight line segment from one point to the next. */
export type PointSegment = {
  type: "point";
  point: SheetPosition;
};

/** A quadratic Bezier arc. The user alt+clicks to place the arc endpoint,
 * then clicks to place the quadratic Bezier control point directly.
 * The curve passes near but not through the control point. */
export type QuadraticBezierSegment = {
  type: "arc-quadratic";
  point: SheetPosition;
  controlPoint: SheetPosition;
};

/** A cubic Bezier arc where the user places both off-curve control points.
 * The curve passes through neither control point. */
export type CubicBezierSegment = {
  type: "arc-cubic";
  point: SheetPosition;
  controlPointA: SheetPosition;
  controlPointB: SheetPosition;
};

/** A segment of a polygon — either a straight line or an arc. */
export type PolygonSegment = PointSegment | QuadraticBezierSegment | CubicBezierSegment;

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

/** A rectangle defined by its upper-left and lower-right corners. Axis-aligned. */
export type Rectangle = {
  id: Id;
  upperLeft: SheetPosition;
  lowerRight: SheetPosition;
  /** Fill color as a 24-bit integer (0xRRGGBB), or null for no fill. */
  fillColor: number | null;
  /** If true, width and height change together to maintain a square. */
  linkDimensions: boolean;
  /** Controls rendering order. Higher values render on top of lower values. */
  renderOrder: number;
};

/** An ellipse defined by its center and two radii.
 * The semi-major axis is horizontal (radiusX).
 * The semi-minor axis is vertical (radiusY). */
export type Ellipse = {
  id: Id;
  center: SheetPosition;
  radiusX: number;
  radiusY: number;
  /** Fill color as a 24-bit integer (0xRRGGBB), or null for no fill. */
  fillColor: number | null;
  /** If true, radiusX and radiusY change together to maintain a circle. */
  linkDimensions: boolean;
  /** Controls rendering order. Higher values render on top of lower values. */
  renderOrder: number;
};
