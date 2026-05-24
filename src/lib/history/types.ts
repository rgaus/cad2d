import { type ConstraintEndpoint, type Id, type Polygon, type PolygonSegment, type Rectangle, type Ellipse, type LinearConstraint } from '@/lib/geometry';
import type { SheetPosition } from '../viewport/types';
import type { Length } from '../units/length';

export type TransactionEntity = {
  type: 'transaction';
  purpose: string;
  forwardsEntries: Array<UndoEntry>;
};

// ==================== POLYGON ENTRIES ====================

/** Recorded when a polygon is inserted into the store. */
export type PolygonInsertEntry = {
  type: 'polygon-insert';
  polygon: Polygon;
};

/** Recorded when a polygon is moved (all vertices shifted). */
export type PolygonMoveEntry = {
  type: 'polygon-move';
  id: Id;
  beforeSegments: Array<PolygonSegment>;
  afterSegments: Array<PolygonSegment>;
};

/** Recorded when a single vertex of a polygon is dragged. */
export type PolygonMoveVertexEntry = {
  type: 'polygon-move-vertex';
  id: Id;
  segmentIndex: number;
  beforePoint: SheetPosition;
  afterPoint: SheetPosition;
};

/** Recorded when multiple vertices of different polygons are moved together (point locking). */
export type PolygonMoveMultipleVerticesEntry = {
  type: 'polygon-move-multiple-vertices';
  moves: Array<{
    id: Id;
    segmentIndex: number;
    beforePoint: SheetPosition;
    afterPoint: SheetPosition;
  }>;
};

/** Recorded when an arc control point of a polygon is dragged. */
export type PolygonMoveControlPointEntry = {
  type: 'polygon-move-control-point';
  id: Id;
  segmentIndex: number;
  pointKey: 'controlPoint' | 'controlPointA' | 'controlPointB';
  beforePoint: SheetPosition;
  afterPoint: SheetPosition;
};

/** Recorded when a polygon is deleted from the store. */
export type PolygonDeleteEntry = {
  type: 'polygon-delete';
  polygon: Polygon;
};

/** Recorded when a point is inserted into a polygon edge. */
export type PolygonInsertPointEntry = {
  type: 'polygon-insert-point';
  id: Id;
  segmentIndex: number;
  newPoint: SheetPosition;
  beforeSegments: Array<PolygonSegment>;
  afterSegments: Array<PolygonSegment>;
};

/** Recorded when a polygon fill color is changed. */
export type PolygonFillColorEntry = {
  type: 'polygon-fill-color';
  id: Id;
  beforeColor: number | null;
  afterColor: number | null;
};

/** Recorded when a polygon is opened or closed. */
export type PolygonCloseEntry = {
  type: 'polygon-close';
  id: Id;
  beforeClosed: boolean;
  afterClosed: boolean;
};

/** Recorded when a polygon openAtIndex is changed. */
export type PolygonOpenAtIndexEntry = {
  type: 'polygon-open-at-index';
  id: Id;
  beforeIndex: number;
  afterIndex: number;
};

/** Recorded when a polygon render order is changed. */
export type PolygonRenderOrderEntry = {
  type: 'polygon-render-order';
  id: Id;
  beforeOrder: number;
  afterOrder: number;
};

// ==================== RECTANGLE ENTRIES ====================

/** Recorded when a rectangle is inserted into the store. */
export type RectangleInsertEntry = {
  type: 'rectangle-insert';
  rectangle: Rectangle;
};

/** Recorded when a rectangle is moved or resized. */
export type RectangleMoveEntry = {
  type: 'rectangle-move';
  id: Id;
  before: Rectangle;
  after: Rectangle;
};

/** Recorded when a rectangle is deleted from the store. */
export type RectangleDeleteEntry = {
  type: 'rectangle-delete';
  rectangle: Rectangle;
};

/** Recorded when a rectangle fill color is changed. */
export type RectangleFillColorEntry = {
  type: 'rectangle-fill-color';
  id: Id;
  beforeColor: number | null;
  afterColor: number | null;
};

/** Recorded when a rectangle linkDimensions is toggled. */
export type RectangleLinkDimensionsEntry = {
  type: 'rectangle-link-dimensions';
  id: Id;
  beforeLink: boolean;
  afterLink: boolean;
};

/** Recorded when a rectangle render order is changed. */
export type RectangleRenderOrderEntry = {
  type: 'rectangle-render-order';
  id: Id;
  beforeOrder: number;
  afterOrder: number;
};

// ==================== ELLIPSE ENTRIES ====================

/** Recorded when an ellipse is inserted into the store. */
export type EllipseInsertEntry = {
  type: 'ellipse-insert';
  ellipse: Ellipse;
};

/** Recorded when an ellipse is moved or resized. */
export type EllipseMoveEntry = {
  type: 'ellipse-move';
  id: Id;
  before: Ellipse;
  after: Ellipse;
};

/** Recorded when an ellipse is deleted from the store. */
export type EllipseDeleteEntry = {
  type: 'ellipse-delete';
  ellipse: Ellipse;
};

/** Recorded when an ellipse fill color is changed. */
export type EllipseFillColorEntry = {
  type: 'ellipse-fill-color';
  id: Id;
  beforeColor: number | null;
  afterColor: number | null;
};

/** Recorded when an ellipse linkDimensions is toggled. */
export type EllipseLinkDimensionsEntry = {
  type: 'ellipse-link-dimensions';
  id: Id;
  beforeLink: boolean;
  afterLink: boolean;
};

/** Recorded when an ellipse render order is changed. */
export type EllipseRenderOrderEntry = {
  type: 'ellipse-render-order';
  id: Id;
  beforeOrder: number;
  afterOrder: number;
};

// ==================== CONVERSION ENTRIES ====================

/** Recorded when a rectangle is converted to a polygon. */
export type RectangleToPolygonEntry = {
  type: 'rectangle-to-polygon';
  rectangle: Rectangle;
  polygon: Polygon;
};

/** Recorded when an ellipse is converted to a polygon. */
export type EllipseToPolygonEntry = {
  type: 'ellipse-to-polygon';
  ellipse: Ellipse;
  polygon: Polygon;
};

// ==================== LINEAR CONSTRAINT ENTRIES ====================

/** Recorded when a linear constraint is inserted. */
export type LinearConstraintInsertEntry = {
  type: 'linear-constraint-insert';
  constraint: LinearConstraint;
};

/** Recorded when a linear constraint's endpoints (pointA/pointB) are moved. */
export type LinearConstraintMoveEndpointsEntry = {
  type: 'linear-constraint-move-endpoints';
  id: Id;
  beforePointA: ConstraintEndpoint;
  beforePointB: ConstraintEndpoint;
  afterPointA: ConstraintEndpoint;
  afterPointB: ConstraintEndpoint;
};

/** Recorded when a linear constraint's label offset is moved. */
export type LinearConstraintMoveLabelEntry = {
  type: 'linear-constraint-move-label';
  id: Id;
  beforeOffsetPx: number;
  afterOffsetPx: number;
};

/** Recorded when a linear constraint's constrained length value is changed. */
export type LinearConstraintChangeLengthEntry = {
  type: 'linear-constraint-change-length';
  id: Id;
  beforeLength: Length;
  afterLength: Length;
};

/** Recorded when a linear constraint is deleted. */
export type LinearConstraintDeleteEntry = {
  type: 'linear-constraint-delete';
  constraint: LinearConstraint;
};

// ==================== UNION TYPE ====================

/** Discriminated union of all undoable operations. */
export type UndoEntry =
  | TransactionEntity
  | PolygonInsertEntry
  | PolygonMoveEntry
  | PolygonMoveVertexEntry
  | PolygonMoveMultipleVerticesEntry
  | PolygonMoveControlPointEntry
  | PolygonDeleteEntry
  | PolygonInsertPointEntry
  | PolygonFillColorEntry
  | PolygonCloseEntry
  | PolygonOpenAtIndexEntry
  | PolygonRenderOrderEntry
  | RectangleInsertEntry
  | RectangleMoveEntry
  | RectangleDeleteEntry
  | RectangleFillColorEntry
  | RectangleLinkDimensionsEntry
  | RectangleRenderOrderEntry
  | EllipseInsertEntry
  | EllipseMoveEntry
  | EllipseDeleteEntry
  | EllipseFillColorEntry
  | EllipseLinkDimensionsEntry
  | EllipseRenderOrderEntry
  | RectangleToPolygonEntry
  | EllipseToPolygonEntry
  | LinearConstraintInsertEntry
  | LinearConstraintMoveEndpointsEntry
  | LinearConstraintMoveLabelEntry
  | LinearConstraintChangeLengthEntry
  | LinearConstraintDeleteEntry;
