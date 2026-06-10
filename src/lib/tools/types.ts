import { Constraint, ConstraintEndpoint, Id, PolygonSegment } from '@/lib/geometry';
import { SheetPosition } from '@/lib/viewport/types';
import { Length } from '../units/length';

/** Tool types available in the application. */
export type ToolType =
  | 'select'
  | 'move'
  | 'polygon'
  | 'rectangle'
  | 'ellipse'
  | 'trim-split'
  | 'constraint';

/** A polygon currently being drawn. */
export type WorkingPolygon = {
  points: Array<PolygonSegment>;
  previewPoint: SheetPosition | null;
  /** If not null, the user alt+clicked to start an arc and is now waiting for the control point click. */
  pendingArcEndPoint: SheetPosition | null;
  /** If not null, the id of a non-closed polygon whose endpoint is being extended.
   * The polygon being extended should be hidden in the viewport while the user works on it. */
  source: WorkingPolygonSource;
};

/** Source of the polygon being drawn - tracks origin of the polygon. */
export type WorkingPolygonSource =
  | { type: 'empty' }
  | {
      type: 'existing-polygon';
      polygonId: Id;
      isStartPoint: boolean;
      autoClosePoint: SheetPosition;
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
  | { type: 'geometry-translation'; ids: Array<Id> }
  | { type: 'polygon'; polygonId: Id }
  | { type: 'polygon-point'; polygonId: Id }
  | { type: 'polygon-curve-control-point'; polygonId: Id }
  | { type: 'polygon-edge'; polygonId: Id; edge: ResizeEdge }
  | { type: 'polygon-corner'; polygonId: Id; corner: ResizeCorner }
  | { type: 'rectangle'; rectangleId: Id }
  | { type: 'rectangle-edge'; rectangleId: Id; edge: ResizeEdge }
  | { type: 'rectangle-corner'; rectangleId: Id; corner: ResizeCorner }
  | { type: 'ellipse'; ellipseId: Id }
  | { type: 'ellipse-edge'; ellipseId: Id; edge: ResizeEdge }
  | { type: 'ellipse-corner'; ellipseId: Id; corner: ResizeCorner };

export type WorkingLinearConstraint = {
  type: 'linear';
  pointA: ConstraintEndpoint;
  pointB: ConstraintEndpoint;
  constrainedLength: Length | null;

  /** Offset in pixels of the line connecting the two points together. This is relative to the line
   * connecting pointA / pointB together - negative goes on one side, positive the other. */
  connectorLineOffsetPx: number;

  disabled: boolean;

  /** If set, whenever this working constraint is visible, the specified constraint will be hidden. */
  shadowsConstraintId: Constraint['id'] | null;
};

export type WorkingConstraint = WorkingLinearConstraint;
