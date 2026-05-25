import { type ConstraintEndpoint, type Id, type Polygon, type PolygonSegment, type Rectangle, type Ellipse, type LinearConstraint } from '@/lib/geometry';
import type { SheetPosition } from '@/lib/viewport/types';
import type { Length } from '@/lib/units/length';

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

/** Recorded when a polygon is translated (all vertices + control points shifted by a delta). */
export type PolygonTranslateEntry = {
  type: 'polygon-translate';
  id: Id;
  deltaX: number;
  deltaY: number;
};

/** Recorded when a polygon's bounding box width/height is resized (scaling from upper-left). */
export type PolygonBoundingBoxResizeEntry = {
  type: 'polygon-bounding-box-resize';
  id: Id;
  beforeSegments: Array<PolygonSegment>;
  afterSegments: Array<PolygonSegment>;
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
  | PolygonTranslateEntry
  | PolygonBoundingBoxResizeEntry
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

export namespace UndoEntry {
  /** Creates an entry for translating all vertices and control points of a polygon by a delta. */
  export function polygonTranslate(id: Id, deltaX: number, deltaY: number): PolygonTranslateEntry {
    return { type: 'polygon-translate', id, deltaX, deltaY };
  }

  /** Creates an entry for resizing a polygon's bounding box (scaling from upper-left corner). */
  export function polygonBoundingBoxResize(
    id: Id,
    beforeSegments: Array<PolygonSegment>,
    afterSegments: Array<PolygonSegment>,
  ): PolygonBoundingBoxResizeEntry {
    return { type: 'polygon-bounding-box-resize', id, beforeSegments, afterSegments };
  }

  /** Creates an entry for inserting a polygon into the store. */
  export function polygonInsert(polygon: Polygon): PolygonInsertEntry {
    return { type: 'polygon-insert', polygon };
  }

  /** Creates an entry for moving all vertices of a polygon (full polygon translation). */
  export function polygonMove(
    id: Id,
    beforeSegments: Array<PolygonSegment>,
    afterSegments: Array<PolygonSegment>,
  ): PolygonMoveEntry {
    return { type: 'polygon-move', id, beforeSegments, afterSegments };
  }

  /** Creates an entry for moving a single vertex of a polygon. */
  export function polygonMoveVertex(
    id: Id,
    segmentIndex: number,
    beforePoint: SheetPosition,
    afterPoint: SheetPosition,
  ): PolygonMoveVertexEntry {
    return { type: 'polygon-move-vertex', id, segmentIndex, beforePoint, afterPoint };
  }

  /** Creates an entry for moving an arc control point of a polygon segment. */
  export function polygonMoveControlPoint(
    id: Id,
    segmentIndex: number,
    pointKey: 'controlPoint' | 'controlPointA' | 'controlPointB',
    beforePoint: SheetPosition,
    afterPoint: SheetPosition,
  ): PolygonMoveControlPointEntry {
    return { type: 'polygon-move-control-point', id, segmentIndex, pointKey, beforePoint, afterPoint };
  }

  /** Creates an entry for moving multiple vertices across multiple polygons (point locking). */
  export function polygonMoveMultipleVertices(
    moves: Array<{ id: Id; segmentIndex: number; beforePoint: SheetPosition; afterPoint: SheetPosition }>,
  ): PolygonMoveMultipleVerticesEntry {
    return { type: 'polygon-move-multiple-vertices', moves };
  }

  /** Creates an entry for deleting a polygon from the store. */
  export function polygonDelete(polygon: Polygon): PolygonDeleteEntry {
    return { type: 'polygon-delete', polygon };
  }

  /** Creates an entry for inserting a point into a polygon edge. */
  export function polygonInsertPoint(
    id: Id,
    segmentIndex: number,
    newPoint: SheetPosition,
    beforeSegments: Array<PolygonSegment>,
    afterSegments: Array<PolygonSegment>,
  ): PolygonInsertPointEntry {
    return { type: 'polygon-insert-point', id, segmentIndex, newPoint, beforeSegments, afterSegments };
  }

  /** Creates an entry for changing a polygon's fill color. */
  export function polygonFillColor(id: Id, beforeColor: number | null, afterColor: number | null): PolygonFillColorEntry {
    return { type: 'polygon-fill-color', id, beforeColor, afterColor };
  }

  /** Creates an entry for opening or closing a polygon. */
  export function polygonClose(id: Id, beforeClosed: boolean, afterClosed: boolean): PolygonCloseEntry {
    return { type: 'polygon-close', id, beforeClosed, afterClosed };
  }

  /** Creates an entry for changing a polygon's openAtIndex property. */
  export function polygonOpenAtIndex(id: Id, beforeIndex: number, afterIndex: number): PolygonOpenAtIndexEntry {
    return { type: 'polygon-open-at-index', id, beforeIndex, afterIndex };
  }

  /** Creates an entry for changing a polygon's render order. */
  export function polygonRenderOrder(id: Id, beforeOrder: number, afterOrder: number): PolygonRenderOrderEntry {
    return { type: 'polygon-render-order', id, beforeOrder, afterOrder };
  }

  /** Creates an entry for inserting a rectangle into the store. */
  export function rectangleInsert(rectangle: Rectangle): RectangleInsertEntry {
    return { type: 'rectangle-insert', rectangle };
  }

  /** Creates an entry for moving or resizing a rectangle. */
  export function rectangleMove(id: Id, before: Rectangle, after: Rectangle): RectangleMoveEntry {
    return { type: 'rectangle-move', id, before, after };
  }

  /** Creates an entry for deleting a rectangle from the store. */
  export function rectangleDelete(rectangle: Rectangle): RectangleDeleteEntry {
    return { type: 'rectangle-delete', rectangle };
  }

  /** Creates an entry for changing a rectangle's fill color. */
  export function rectangleFillColor(id: Id, beforeColor: number | null, afterColor: number | null): RectangleFillColorEntry {
    return { type: 'rectangle-fill-color', id, beforeColor, afterColor };
  }

  /** Creates an entry for toggling rectangle linkDimensions. */
  export function rectangleLinkDimensions(id: Id, beforeLink: boolean, afterLink: boolean): RectangleLinkDimensionsEntry {
    return { type: 'rectangle-link-dimensions', id, beforeLink, afterLink };
  }

  /** Creates an entry for changing a rectangle's render order. */
  export function rectangleRenderOrder(id: Id, beforeOrder: number, afterOrder: number): RectangleRenderOrderEntry {
    return { type: 'rectangle-render-order', id, beforeOrder, afterOrder };
  }

  /** Creates an entry for inserting an ellipse into the store. */
  export function ellipseInsert(ellipse: Ellipse): EllipseInsertEntry {
    return { type: 'ellipse-insert', ellipse };
  }

  /** Creates an entry for moving or resizing an ellipse. */
  export function ellipseMove(id: Id, before: Ellipse, after: Ellipse): EllipseMoveEntry {
    return { type: 'ellipse-move', id, before, after };
  }

  /** Creates an entry for deleting an ellipse from the store. */
  export function ellipseDelete(ellipse: Ellipse): EllipseDeleteEntry {
    return { type: 'ellipse-delete', ellipse };
  }

  /** Creates an entry for changing an ellipse's fill color. */
  export function ellipseFillColor(id: Id, beforeColor: number | null, afterColor: number | null): EllipseFillColorEntry {
    return { type: 'ellipse-fill-color', id, beforeColor, afterColor };
  }

  /** Creates an entry for toggling ellipse linkDimensions. */
  export function ellipseLinkDimensions(id: Id, beforeLink: boolean, afterLink: boolean): EllipseLinkDimensionsEntry {
    return { type: 'ellipse-link-dimensions', id, beforeLink, afterLink };
  }

  /** Creates an entry for changing an ellipse's render order. */
  export function ellipseRenderOrder(id: Id, beforeOrder: number, afterOrder: number): EllipseRenderOrderEntry {
    return { type: 'ellipse-render-order', id, beforeOrder, afterOrder };
  }

  /** Creates an entry for converting a rectangle to a polygon. */
  export function rectangleToPolygon(rectangle: Rectangle, polygon: Polygon): RectangleToPolygonEntry {
    return { type: 'rectangle-to-polygon', rectangle, polygon };
  }

  /** Creates an entry for converting an ellipse to a polygon. */
  export function ellipseToPolygon(ellipse: Ellipse, polygon: Polygon): EllipseToPolygonEntry {
    return { type: 'ellipse-to-polygon', ellipse, polygon };
  }

  /** Creates an entry for inserting a linear constraint into the store. */
  export function linearConstraintInsert(constraint: LinearConstraint): LinearConstraintInsertEntry {
    return { type: 'linear-constraint-insert', constraint };
  }

  /** Creates an entry for moving a linear constraint's endpoints (pointA/pointB). */
  export function linearConstraintMoveEndpoints(
    id: Id,
    beforePointA: ConstraintEndpoint,
    beforePointB: ConstraintEndpoint,
    afterPointA: ConstraintEndpoint,
    afterPointB: ConstraintEndpoint,
  ): LinearConstraintMoveEndpointsEntry {
    return { type: 'linear-constraint-move-endpoints', id, beforePointA, beforePointB, afterPointA, afterPointB };
  }

  /** Creates an entry for moving a linear constraint's label offset. */
  export function linearConstraintMoveLabel(id: Id, beforeOffsetPx: number, afterOffsetPx: number): LinearConstraintMoveLabelEntry {
    return { type: 'linear-constraint-move-label', id, beforeOffsetPx, afterOffsetPx };
  }

  /** Creates an entry for changing a linear constraint's constrained length value. */
  export function linearConstraintChangeLength(id: Id, beforeLength: Length, afterLength: Length): LinearConstraintChangeLengthEntry {
    return { type: 'linear-constraint-change-length', id, beforeLength, afterLength };
  }

  /** Creates an entry for deleting a linear constraint from the store. */
  export function linearConstraintDelete(constraint: LinearConstraint): LinearConstraintDeleteEntry {
    return { type: 'linear-constraint-delete', constraint };
  }
}
