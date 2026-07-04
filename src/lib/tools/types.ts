import {
  Constraint,
  ConstraintEndpoint,
  Id,
  PolygonSegment,
  type ResizeMode,
} from '@/lib/geometry';
import { SheetPosition } from '@/lib/viewport/types';
import { Length } from '../units/length';
import { TOOLS_BY_TYPE } from './ToolManager';

/** Tool types available in the application. */
export type ToolType = keyof typeof TOOLS_BY_TYPE;

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

/** A datum currently being previewed at the cursor position. */
export type WorkingDatum = {
  position: SheetPosition;
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

/** Union type for all drag states across all shape types. */
export type DraggingShapeState =
  | { type: 'geometry-translation'; ids: Array<Id> }
  | { type: 'geometry-resize'; ids: Array<Id>; mode: ResizeMode }
  | { type: 'polygon'; polygonId: Id }
  | { type: 'polygon-point'; polygonId: Id }
  | { type: 'polygon-curve-control-point'; polygonId: Id }
  | { type: 'rectangle'; rectangleId: Id }
  | { type: 'ellipse'; ellipseId: Id };

export type WorkingLinearConstraint = {
  type: 'linear';
  pointA: ConstraintEndpoint;
  pointB: ConstraintEndpoint;
  constrainedLength: Length | null;

  /** Offset in pixels of the line connecting the two points together. This is relative to the line
   * connecting pointA / pointB together - negative goes on one side, positive the other. */
  connectorLineOffsetPx: number;

  disabled: boolean;

  /** When set, the constraint applies to only one axis component of the
   *  distance between pointA and pointB rather than the full diagonal. */
  axis?: 'x' | 'y' | null;

  /** If set, whenever this working constraint is visible, the specified constraint will be hidden. */
  shadowsConstraintId: Constraint['id'] | null;
};

export type WorkingPerpendicularConstraint = {
  type: 'perpendicular';
  pointA: ConstraintEndpoint;
  pointCenter: ConstraintEndpoint;
  pointB: ConstraintEndpoint;

  disabled: boolean;

  /** If set, whenever this working constraint is visible, the specified constraint will be hidden. */
  shadowsConstraintId: Constraint['id'] | null;
};

export type WorkingParallelConstraint = {
  type: 'parallel';
  pointA: ConstraintEndpoint;
  pointB: ConstraintEndpoint;
  pointC: ConstraintEndpoint;
  pointD: ConstraintEndpoint;

  disabled: boolean;

  /** If set, whenever this working constraint is visible, the specified constraint will be hidden. */
  shadowsConstraintId: Constraint['id'] | null;
};

export type WorkingHorizontalConstraint = {
  type: 'horizontal';
  pointA: ConstraintEndpoint;
  pointB: ConstraintEndpoint;

  disabled: boolean;

  /** If set, whenever this working constraint is visible, the specified constraint will be hidden. */
  shadowsConstraintId: Constraint['id'] | null;
};

export type WorkingVerticalConstraint = {
  type: 'vertical';
  pointA: ConstraintEndpoint;
  pointB: ConstraintEndpoint;

  disabled: boolean;

  /** If set, whenever this working constraint is visible, the specified constraint will be hidden. */
  shadowsConstraintId: Constraint['id'] | null;
};

/** The pending state of a fillet operation, used by the React popup to render
 * the distance input and confirm the fillet. Emitted by FilletCreationTool.
 *
 * When operating on a polygon, all index fields are numbers representing indices
 * into the polygon's points array. When operating on a rectangle (rectangle
 * shortcut), all index fields are null — the conversion to polygon and index
 * lookup happens inside the history transaction.
 */
export type PendingFilletState = {
  geometryId: Id;
  centerEndpoint: ConstraintEndpoint;
  pointAEndpoint: ConstraintEndpoint;
  pointBEndpoint: ConstraintEndpoint;
  centerPos: SheetPosition;
  segmentIndexA: number | null;
  segmentIndexB: number | null;
  centerPointIndex: number | null;
  pointAPointIndex: number | null;
  pointBPointIndex: number | null;
};

export type WorkingColinearConstraint = {
  type: 'colinear';
  pointTarget: ConstraintEndpoint;
  /** Null until the second click (defining the line). */
  pointA: ConstraintEndpoint | null;
  /** Null until the second click. Set equal to pointA on the second click, then tracks mouse. */
  pointB: ConstraintEndpoint | null;

  disabled: boolean;

  /** If set, whenever this working constraint is visible, the specified constraint will be hidden. */
  shadowsConstraintId: Constraint['id'] | null;
};

export type WorkingConstraint =
  | WorkingLinearConstraint
  | WorkingPerpendicularConstraint
  | WorkingParallelConstraint
  | WorkingHorizontalConstraint
  | WorkingVerticalConstraint
  | WorkingColinearConstraint;
