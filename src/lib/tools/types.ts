/** Tool types available in the application. */
export type ToolType = 'select' | 'move' | 'polygon';

/** A stable unique identifier for a polygon. */
export type Id = string;

import { SheetPosition } from '../viewport/types';
export { SheetPosition };
export type { ScreenPosition } from '../viewport/types';

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
};

/** A polygon currently being drawn. */
export type WorkingPolygon = {
  points: Array<PolygonSegment>;
  previewPoint: SheetPosition | null;
  /** If not null, the user alt+clicked to start an arc and is now waiting for the control point click. */
  pendingArcEndPoint: SheetPosition | null;
};
