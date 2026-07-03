import {
  type Constraint,
  type ConstraintEndpoint,
  EllipseComponent,
  FillColorComponent,
  Geometry,
  type Id,
  Polygon,
  PolygonComponent,
  PolygonSegment,
  RectangleComponent,
  RenderOrderComponent,
} from '@/lib/geometry';
import { type Length, type SerializedLength, type UnitType } from '@/lib/units/length';
import type { SheetPosition } from '@/lib/viewport/types';

export type TransactionEntity = {
  type: 'transaction';
  purpose: string;
  forwardsEntries: Array<UndoEntry>;
};

// ==================== GENERIC GEOMETRY ENTRIES ====================

/** Recorded when a geometry is inserted into the store. */
export type InsertEntry<G extends Geometry = Geometry> = {
  type: 'insert';
  geometry: G;
};

/** Recorded when a geometry is deleted from the store. */
export type DeleteEntry<G extends Geometry = Geometry> = {
  type: 'delete';
  geometry: G;
};

/** Recorded when a geometry fill color is changed. */
export type FillColorEntry = {
  type: 'fill-color';
  id: Id;
  beforeColor: number | null;
  afterColor: number | null;
};

/** Recorded when a geometry render order is changed. */
export type RenderOrderEntry = {
  type: 'render-order';
  id: Id;
  beforeOrder: number;
  afterOrder: number;
};

/** Recorded when a geometry linkDimensions is toggled. */
export type LinkDimensionsEntry = {
  type: 'link-dimensions';
  id: Id;
  beforeLink: boolean;
  afterLink: boolean;
};

/** Recorded when a polygon is moved (all vertices shifted). */
export type PolygonMoveEntry = {
  type: 'polygon-move';
  id: Id;
  beforeSegments: Array<PolygonSegment>;
  afterSegments: Array<PolygonSegment>;
};

/** Recorded when a rectangle is moved or resized. */
export type RectangleMoveEntry = {
  type: 'rectangle-move';
  id: Id;
  before: RectangleComponent[keyof RectangleComponent];
  after: RectangleComponent[keyof RectangleComponent];
};

/** Recorded when an ellipse is moved or resized. */
export type EllipseMoveEntry = {
  type: 'ellipse-move';
  id: Id;
  before: EllipseComponent[keyof EllipseComponent];
  after: EllipseComponent[keyof EllipseComponent];
};

/** Recorded when a datum is moved. */
export type DatumMoveEntry = {
  type: 'datum-move';
  id: Id;
  before: { position: SheetPosition };
  after: { position: SheetPosition };
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

/** Recorded when a point is inserted into a polygon edge. */
export type PolygonInsertPointEntry = {
  type: 'polygon-insert-point';
  id: Id;
  segmentIndex: number;
  newPoint: SheetPosition;
  beforeSegments: Array<PolygonSegment>;
  afterSegments: Array<PolygonSegment>;
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

// ==================== CONVERSION ENTRIES ====================

/** Recorded when a rectangle is converted to a polygon. */
export type RectangleToPolygonEntry<
  R extends Geometry<RectangleComponent> = Geometry<RectangleComponent>,
> = {
  type: 'rectangle-to-polygon';
  rectangle: R;
  polygon: Polygon;
};

/** Recorded when an ellipse is converted to a polygon. */
export type EllipseToPolygonEntry<
  E extends Geometry<EllipseComponent> = Geometry<EllipseComponent>,
> = {
  type: 'ellipse-to-polygon';
  ellipse: E;
  polygon: Polygon;
};

// ==================== PERPENDICULAR CONSTRAINT ENTRIES ====================

/** Recorded when a perpendicular constraint's endpoints (pointA/pointCenter/pointC) are moved. */
export type PerpendicularConstraintMoveEndpointsEntry = {
  type: 'perpendicular-constraint-move-endpoints';
  id: Id;
  beforePointA: ConstraintEndpoint;
  beforePointCenter: ConstraintEndpoint;
  beforePointC: ConstraintEndpoint;
  afterPointA: ConstraintEndpoint;
  afterPointCenter: ConstraintEndpoint;
  afterPointC: ConstraintEndpoint;
};

/** Recorded when a parallel constraint's endpoints (pointA/pointB/pointC/pointD) are moved. */
export type ParallelConstraintMoveEndpointsEntry = {
  type: 'parallel-constraint-move-endpoints';
  id: Id;
  beforePointA: ConstraintEndpoint;
  beforePointB: ConstraintEndpoint;
  beforePointC: ConstraintEndpoint;
  beforePointD: ConstraintEndpoint;
  afterPointA: ConstraintEndpoint;
  afterPointB: ConstraintEndpoint;
  afterPointC: ConstraintEndpoint;
  afterPointD: ConstraintEndpoint;
};

// ==================== LINEAR CONSTRAINT ENTRIES ====================

/** Recorded when a linear constraint is inserted. */
export type ConstraintInsertEntry = {
  type: 'constraint-insert';
  constraint: Constraint;
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

// ==================== HORIZONTAL CONSTRAINT ENTRIES ====================

/** Recorded when a horizontal constraint's endpoints (pointA/pointB) are moved. */
export type HorizontalConstraintMoveEndpointsEntry = {
  type: 'horizontal-constraint-move-endpoints';
  id: Id;
  beforePointA: ConstraintEndpoint;
  beforePointB: ConstraintEndpoint;
  afterPointA: ConstraintEndpoint;
  afterPointB: ConstraintEndpoint;
};

// ==================== VERTICAL CONSTRAINT ENTRIES ====================

/** Recorded when a vertical constraint's endpoints (pointA/pointB) are moved. */
export type VerticalConstraintMoveEndpointsEntry = {
  type: 'vertical-constraint-move-endpoints';
  id: Id;
  beforePointA: ConstraintEndpoint;
  beforePointB: ConstraintEndpoint;
  afterPointA: ConstraintEndpoint;
  afterPointB: ConstraintEndpoint;
};

// ==================== COLINEAR CONSTRAINT ENTRIES ====================

/** Recorded when a colinear constraint's endpoints (pointTarget/pointA/pointB) are moved. */
export type ColinearConstraintMoveEndpointsEntry = {
  type: 'colinear-constraint-move-endpoints';
  id: Id;
  beforePointTarget: ConstraintEndpoint;
  beforePointA: ConstraintEndpoint;
  beforePointB: ConstraintEndpoint;
  afterPointTarget: ConstraintEndpoint;
  afterPointA: ConstraintEndpoint;
  afterPointB: ConstraintEndpoint;
};

/** Recorded when a constraint is deleted. */
export type ConstraintDeleteEntry = {
  type: 'constraint-delete';
  constraint: Constraint;
};

// ==================== SHEET SETTINGS ENTRIES ====================

/** Recorded when the sheet width is changed. */
export type SheetWidthEntry = {
  type: 'sheet-width';
  beforeWidth: SerializedLength;
  afterWidth: SerializedLength;
};

/** Recorded when the sheet height is changed. */
export type SheetHeightEntry = {
  type: 'sheet-height';
  beforeHeight: SerializedLength;
  afterHeight: SerializedLength;
};

/** Recorded when the sheet default unit is changed. */
export type SheetDefaultUnitEntry = {
  type: 'sheet-default-unit';
  beforeDefaultUnit: UnitType;
  afterDefaultUnit: UnitType;
};

/** Recorded when the sheet unit places setting is changed. */
export type SheetUnitPlacesEntry = {
  type: 'sheet-unit-places';
  beforeUnitPlaces: number;
  afterUnitPlaces: number;
};

// ==================== UNION TYPE ====================

/** Discriminated union of all undoable operations. */
export type UndoEntry =
  | TransactionEntity
  | InsertEntry
  | DeleteEntry
  | FillColorEntry
  | RenderOrderEntry
  | LinkDimensionsEntry
  | PolygonMoveEntry
  | RectangleMoveEntry
  | EllipseMoveEntry
  | DatumMoveEntry
  | PolygonMoveVertexEntry
  | PolygonMoveMultipleVerticesEntry
  | PolygonMoveControlPointEntry
  | PolygonInsertPointEntry
  | PolygonCloseEntry
  | PolygonOpenAtIndexEntry
  | PolygonTranslateEntry
  | PolygonBoundingBoxResizeEntry
  | RectangleToPolygonEntry
  | EllipseToPolygonEntry
  | ConstraintInsertEntry
  | PerpendicularConstraintMoveEndpointsEntry
  | ParallelConstraintMoveEndpointsEntry
  | LinearConstraintMoveEndpointsEntry
  | HorizontalConstraintMoveEndpointsEntry
  | VerticalConstraintMoveEndpointsEntry
  | ColinearConstraintMoveEndpointsEntry
  | LinearConstraintMoveLabelEntry
  | LinearConstraintChangeLengthEntry
  | ConstraintDeleteEntry
  | SheetWidthEntry
  | SheetHeightEntry
  | SheetDefaultUnitEntry
  | SheetUnitPlacesEntry;

export namespace UndoEntry {
  /** Creates a raw transaction, useful with historyManager.push. Most likely you want {@link HistoryManager.applyTransaction} instead. */
  export function transaction(
    purpose: string,
    forwardsEntries: Array<UndoEntry>,
  ): TransactionEntity {
    return { type: 'transaction', purpose, forwardsEntries };
  }

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

  /** Creates an entry for inserting a geometry into the store. */
  export function insert<G extends Geometry>(geometry: G): InsertEntry<G> {
    return { type: 'insert', geometry };
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
    return {
      type: 'polygon-move-control-point',
      id,
      segmentIndex,
      pointKey,
      beforePoint,
      afterPoint,
    };
  }

  /** Creates an entry for moving multiple vertices across multiple polygons (point locking). */
  export function polygonMoveMultipleVertices(
    moves: Array<{
      id: Id;
      segmentIndex: number;
      beforePoint: SheetPosition;
      afterPoint: SheetPosition;
    }>,
  ): PolygonMoveMultipleVerticesEntry {
    return { type: 'polygon-move-multiple-vertices', moves };
  }

  /** Creates an entry for inserting a point into a polygon edge. */
  export function polygonInsertPoint(
    id: Id,
    segmentIndex: number,
    newPoint: SheetPosition,
    beforeSegments: Array<PolygonSegment>,
    afterSegments: Array<PolygonSegment>,
  ): PolygonInsertPointEntry {
    return {
      type: 'polygon-insert-point',
      id,
      segmentIndex,
      newPoint,
      beforeSegments,
      afterSegments,
    };
  }

  /** Creates an entry for opening or closing a polygon. */
  export function polygonClose(
    id: Id,
    beforeClosed: boolean,
    afterClosed: boolean,
  ): PolygonCloseEntry {
    return { type: 'polygon-close', id, beforeClosed, afterClosed };
  }

  /** Creates an entry for changing a polygon's openAtIndex property. */
  export function polygonOpenAtIndex(
    id: Id,
    beforeIndex: number,
    afterIndex: number,
  ): PolygonOpenAtIndexEntry {
    return { type: 'polygon-open-at-index', id, beforeIndex, afterIndex };
  }

  /** Creates an entry for moving or resizing a rectangle. */
  export function rectangleMove(
    id: Id,
    before: RectangleComponent[keyof RectangleComponent],
    after: RectangleComponent[keyof RectangleComponent],
  ): RectangleMoveEntry {
    return { type: 'rectangle-move', id, before, after };
  }

  /** Creates an entry for moving or resizing an ellipse. */
  export function ellipseMove(
    id: Id,
    before: EllipseComponent[keyof EllipseComponent],
    after: EllipseComponent[keyof EllipseComponent],
  ): EllipseMoveEntry {
    return { type: 'ellipse-move', id, before, after };
  }

  /** Creates an entry for moving a datum. */
  export function datumMove(
    id: Id,
    before: { position: SheetPosition },
    after: { position: SheetPosition },
  ): DatumMoveEntry {
    return { type: 'datum-move', id, before, after };
  }

  /** Creates an entry for deleting a geometry from the store. */
  export function deleteGeometry<G extends Geometry>(geometry: G): DeleteEntry<G> {
    return { type: 'delete', geometry };
  }

  /** Creates an entry for changing a geometry's fill color. */
  export function fillColor(
    id: Id,
    beforeColor: number | null,
    afterColor: number | null,
  ): FillColorEntry {
    return { type: 'fill-color', id, beforeColor, afterColor };
  }

  /** Creates an entry for changing a geometry's render order. */
  export function renderOrder(id: Id, beforeOrder: number, afterOrder: number): RenderOrderEntry {
    return { type: 'render-order', id, beforeOrder, afterOrder };
  }

  /** Creates an entry for toggling a geometry's linkDimensions. */
  export function linkDimensions(
    id: Id,
    beforeLink: boolean,
    afterLink: boolean,
  ): LinkDimensionsEntry {
    return { type: 'link-dimensions', id, beforeLink, afterLink };
  }

  /** Creates an entry for converting a rectangle to a polygon. */
  export function rectangleToPolygon<R extends Geometry<RectangleComponent>>(
    rectangle: R,
    polygon: Geometry<PolygonComponent & Partial<FillColorComponent> & RenderOrderComponent>,
  ): RectangleToPolygonEntry<R> {
    return { type: 'rectangle-to-polygon', rectangle, polygon };
  }

  /** Creates an entry for converting an ellipse to a polygon. */
  export function ellipseToPolygon<E extends Geometry<EllipseComponent>>(
    ellipse: E,
    polygon: Geometry<PolygonComponent & Partial<FillColorComponent> & RenderOrderComponent>,
  ): EllipseToPolygonEntry {
    return { type: 'ellipse-to-polygon', ellipse, polygon };
  }

  /** Creates an entry for inserting a constraint into the store. */
  export function constraintInsert(constraint: Constraint): ConstraintInsertEntry {
    return { type: 'constraint-insert', constraint };
  }

  /** Creates an entry for moving a perpendicular constraint's endpoints (pointA/pointCenter/pointC). */
  export function perpendicularConstraintMoveEndpoints(
    id: Id,
    beforePointA: ConstraintEndpoint,
    beforePointCenter: ConstraintEndpoint,
    beforePointC: ConstraintEndpoint,
    afterPointA: ConstraintEndpoint,
    afterPointCenter: ConstraintEndpoint,
    afterPointC: ConstraintEndpoint,
  ): PerpendicularConstraintMoveEndpointsEntry {
    return {
      type: 'perpendicular-constraint-move-endpoints',
      id,
      beforePointA,
      beforePointCenter,
      beforePointC,
      afterPointA,
      afterPointCenter,
      afterPointC,
    };
  }

  /** Creates an entry for moving a parallel constraint's endpoints (pointA/pointB/pointC/pointD). */
  export function parallelConstraintMoveEndpoints(
    id: Id,
    beforePointA: ConstraintEndpoint,
    beforePointB: ConstraintEndpoint,
    beforePointC: ConstraintEndpoint,
    beforePointD: ConstraintEndpoint,
    afterPointA: ConstraintEndpoint,
    afterPointB: ConstraintEndpoint,
    afterPointC: ConstraintEndpoint,
    afterPointD: ConstraintEndpoint,
  ): ParallelConstraintMoveEndpointsEntry {
    return {
      type: 'parallel-constraint-move-endpoints',
      id,
      beforePointA,
      beforePointB,
      beforePointC,
      beforePointD,
      afterPointA,
      afterPointB,
      afterPointC,
      afterPointD,
    };
  }

  /** Creates an entry for moving a linear constraint's endpoints (pointA/pointB). */
  export function linearConstraintMoveEndpoints(
    id: Id,
    beforePointA: ConstraintEndpoint,
    beforePointB: ConstraintEndpoint,
    afterPointA: ConstraintEndpoint,
    afterPointB: ConstraintEndpoint,
  ): LinearConstraintMoveEndpointsEntry {
    return {
      type: 'linear-constraint-move-endpoints',
      id,
      beforePointA,
      beforePointB,
      afterPointA,
      afterPointB,
    };
  }

  /** Creates an entry for moving a linear constraint's label offset. */
  export function linearConstraintMoveLabel(
    id: Id,
    beforeOffsetPx: number,
    afterOffsetPx: number,
  ): LinearConstraintMoveLabelEntry {
    return { type: 'linear-constraint-move-label', id, beforeOffsetPx, afterOffsetPx };
  }

  /** Creates an entry for changing a linear constraint's constrained length value. */
  export function linearConstraintChangeLength(
    id: Id,
    beforeLength: Length,
    afterLength: Length,
  ): LinearConstraintChangeLengthEntry {
    return { type: 'linear-constraint-change-length', id, beforeLength, afterLength };
  }

  /** Creates an entry for moving a horizontal constraint's endpoints (pointA/pointB). */
  export function horizontalConstraintMoveEndpoints(
    id: Id,
    beforePointA: ConstraintEndpoint,
    beforePointB: ConstraintEndpoint,
    afterPointA: ConstraintEndpoint,
    afterPointB: ConstraintEndpoint,
  ): HorizontalConstraintMoveEndpointsEntry {
    return {
      type: 'horizontal-constraint-move-endpoints',
      id,
      beforePointA,
      beforePointB,
      afterPointA,
      afterPointB,
    };
  }

  /** Creates an entry for moving a vertical constraint's endpoints (pointA/pointB). */
  export function verticalConstraintMoveEndpoints(
    id: Id,
    beforePointA: ConstraintEndpoint,
    beforePointB: ConstraintEndpoint,
    afterPointA: ConstraintEndpoint,
    afterPointB: ConstraintEndpoint,
  ): VerticalConstraintMoveEndpointsEntry {
    return {
      type: 'vertical-constraint-move-endpoints',
      id,
      beforePointA,
      beforePointB,
      afterPointA,
      afterPointB,
    };
  }

  /** Creates an entry for moving a colinear constraint's endpoints (pointTarget/pointA/pointB). */
  export function colinearConstraintMoveEndpoints(
    id: Id,
    beforePointTarget: ConstraintEndpoint,
    beforePointA: ConstraintEndpoint,
    beforePointB: ConstraintEndpoint,
    afterPointTarget: ConstraintEndpoint,
    afterPointA: ConstraintEndpoint,
    afterPointB: ConstraintEndpoint,
  ): ColinearConstraintMoveEndpointsEntry {
    return {
      type: 'colinear-constraint-move-endpoints',
      id,
      beforePointTarget,
      beforePointA,
      beforePointB,
      afterPointTarget,
      afterPointA,
      afterPointB,
    };
  }

  /** Creates an entry for deleting a linear constraint from the store. */
  export function constraintDelete(constraint: Constraint): ConstraintDeleteEntry {
    return { type: 'constraint-delete', constraint };
  }

  /** Creates an entry for changing the sheet width. */
  export function sheetWidth(
    beforeWidth: SerializedLength,
    afterWidth: SerializedLength,
  ): SheetWidthEntry {
    return { type: 'sheet-width', beforeWidth, afterWidth };
  }

  /** Creates an entry for changing the sheet height. */
  export function sheetHeight(
    beforeHeight: SerializedLength,
    afterHeight: SerializedLength,
  ): SheetHeightEntry {
    return { type: 'sheet-height', beforeHeight, afterHeight };
  }

  /** Creates an entry for changing the sheet default unit. */
  export function sheetDefaultUnit(
    beforeDefaultUnit: UnitType,
    afterDefaultUnit: UnitType,
  ): SheetDefaultUnitEntry {
    return { type: 'sheet-default-unit', beforeDefaultUnit, afterDefaultUnit };
  }

  /** Creates an entry for changing the sheet unit places setting. */
  export function sheetUnitPlaces(
    beforeUnitPlaces: number,
    afterUnitPlaces: number,
  ): SheetUnitPlacesEntry {
    return { type: 'sheet-unit-places', beforeUnitPlaces, afterUnitPlaces };
  }
}
