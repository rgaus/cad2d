/** Tool types available in the application. */
export type ToolType = 'select' | 'move' | 'polygon';

import { SheetPosition } from '../viewport/types';
export { SheetPosition };
export type { ScreenPosition } from '../viewport/types';

/** A straight line segment from one point to the next. */
export type PointSegment = {
  type: "point";
  point: SheetPosition;
};

/** A quadratic Bezier arc where the user places the midpoint of the arc.
 * The control point is computed so the curve passes through the user-placed midpoint at t=0.5. */
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
  id: string;
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