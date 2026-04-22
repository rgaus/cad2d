import type { Id } from '../tools/types';
import type { Polygon, PolygonSegment } from '../tools/types';
import type { SheetPosition } from '../viewport/types';

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

/** Discriminated union of all undoable operations. */
export type UndoEntry =
  | PolygonInsertEntry
  | PolygonMoveEntry
  | PolygonMoveVertexEntry
  | PolygonMoveControlPointEntry
  | PolygonDeleteEntry;
