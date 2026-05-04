/** Tool types available in the application. */
export type ToolType = 'select' | 'move' | 'polygon' | 'rectangle' | 'ellipse' | 'trim-split';

/** A stable unique identifier for a shape. */
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
  /** Fill color as a 24-bit integer (0xRRGGBB), or null for no fill. */
  fillColor: number | null;
};

/** A polygon currently being drawn. */
export type WorkingPolygon = {
  points: Array<PolygonSegment>;
  previewPoint: SheetPosition | null;
  /** If not null, the user alt+clicked to start an arc and is now waiting for the control point click. */
  pendingArcEndPoint: SheetPosition | null;
  /** If not null, the id of a non-closed polygon whose endpoint is being extended.
   * The polygon being extended should be hidden in the viewport while the user works on it. */
  extendingPolygonId?: Id | null;
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
};

/** A rectangle currently being drawn. */
export type WorkingRectangle = {
  /** First clicked point (upper-left corner in corner mode, center in center mode). */
  firstPoint: SheetPosition | null;
  /** Live preview of the second point (lower-right corner). */
  previewLowerRight: SheetPosition | null;
  /** If true, firstPoint is the center; if false, firstPoint is the upper-left corner. */
  isCenterMode: boolean;
};

/** An ellipse currently being drawn. */
export type WorkingEllipse = {
  /** First clicked point (bounding box corner in corner mode, center in center mode). */
  firstPoint: SheetPosition | null;
  /** Live preview of the second point (opposite bounding box corner). */
  previewPoint: SheetPosition | null;
  /** If true, firstPoint is the center; if false, firstPoint is the bounding box corner. */
  isCenterMode: boolean;
};

/** Corner being dragged during shape resize. */
export type ResizeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Edge being dragged during shape resize. */
export type ResizeEdge = 'top' | 'bottom' | 'left' | 'right';

/** Resize mode indicating which handle is being dragged. */
export type ResizeMode =
  | { type: 'corner'; corner: ResizeCorner }
  | { type: 'edge'; edge: ResizeEdge };

/** Union type for all drag states across all shape types. */
export type DraggingShapeState =
  | { type: 'polygon', polygonId: Id }
  | { type: 'polygon-point', polygonId: Id }
  | { type: 'polygon-curve-control-point', polygonId: Id }
  | { type: 'polygon-edge', polygonId: Id, edge: ResizeEdge }
  | { type: 'polygon-corner', polygonId: Id, corner: ResizeCorner }
  | { type: 'rectangle', rectangleId: Id }
  | { type: 'rectangle-edge', rectangleId: Id, edge: ResizeEdge }
  | { type: 'rectangle-corner', rectangleId: Id, corner: ResizeCorner }
  | { type: 'ellipse', ellipseId: Id }
  | { type: 'ellipse-edge', ellipseId: Id, edge: ResizeEdge }
  | { type: 'ellipse-corner', ellipseId: Id, corner: ResizeCorner };
