import type { Id } from '../tools/types';
import type { Polygon, PolygonSegment, Rectangle, Ellipse } from '../tools/types';
import type { SheetPosition } from '../viewport/types';

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

/** Recorded when a polygon segment is split at a point (adds intersection point, no deletion). */
export type PolygonSplitEntry = {
  type: 'polygon-split';
  id: Id;
  segmentIndex: number;
  newPoint: SheetPosition;
  beforeSegments: Array<PolygonSegment>;
  afterSegments: Array<PolygonSegment>;
  /** If cascading, the other shape that was also split */
  cascadedId?: Id;
  cascadedSegmentIndex?: number;
  cascadedNewPoint?: SheetPosition;
  cascadedBeforeSegments?: Array<PolygonSegment>;
  cascadedAfterSegments?: Array<PolygonSegment>;
};

/** Recorded when a polygon segment is deleted (and cascade to other shapes). */
export type PolygonTrimDeleteEntry = {
  type: 'polygon-trim-delete';
  id: Id;
  segmentIndex: number;
  beforeSegments: Array<PolygonSegment>;
  afterSegments: Array<PolygonSegment>;
  /** Cascaded deletions on intersected shapes */
  cascadedDeletes?: Array<{
    id: Id;
    segmentIndex: number;
    beforeSegments: Array<PolygonSegment>;
    afterSegments: Array<PolygonSegment>;
  }>;
};

/** Recorded when a polygon is opened (broken from closed ring). */
export type PolygonOpenEntry = {
  type: 'polygon-open';
  id: Id;
  segmentIndex: number;
  beforeSegments: Array<PolygonSegment>;
  afterSegments: Array<PolygonSegment>;
  openAtIndex: number;
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

/** Recorded when a rectangle is replaced with a polygon (after trim/split conversion). */
export type RectangleReplaceEntry = {
  type: 'rectangle-replace';
  rectangle: Rectangle;
  polygon: Polygon;
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

/** Recorded when an ellipse is replaced with a polygon (after trim/split conversion). */
export type EllipseReplaceEntry = {
  type: 'ellipse-replace';
  ellipse: Ellipse;
  polygon: Polygon;
};

// ==================== UNION TYPE ====================

/** Discriminated union of all undoable operations. */
export type UndoEntry =
  | PolygonInsertEntry
  | PolygonMoveEntry
  | PolygonMoveVertexEntry
  | PolygonMoveControlPointEntry
  | PolygonDeleteEntry
  | PolygonInsertPointEntry
  | PolygonFillColorEntry
  | PolygonCloseEntry
  | PolygonOpenAtIndexEntry
  | PolygonSplitEntry
  | PolygonTrimDeleteEntry
  | PolygonOpenEntry
  | RectangleInsertEntry
  | RectangleMoveEntry
  | RectangleDeleteEntry
  | RectangleFillColorEntry
  | RectangleLinkDimensionsEntry
  | RectangleReplaceEntry
  | EllipseInsertEntry
  | EllipseMoveEntry
  | EllipseDeleteEntry
  | EllipseFillColorEntry
  | EllipseLinkDimensionsEntry
  | EllipseReplaceEntry;
