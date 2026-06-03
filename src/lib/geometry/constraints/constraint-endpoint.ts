import { SheetPosition } from '@/lib/viewport/types';
import { Ellipse, EllipseEndpoint } from '../ellipse';
import { Polygon } from '../polygon';
import { Rectangle, RectangleEndpoint } from '../rectangle';
import { type Id } from '../types';

/** Maps a RectangleEndpoint to the corresponding polygon point index.
 *  rectangleToPolygon produces points in order: upperLeft(0), upperRight(1), lowerRight(2), lowerLeft(3). */
const RECTANGLE_ENDPOINT_TO_INDEX: Record<RectangleEndpoint, number> = {
  upperLeft: 0,
  upperRight: 1,
  lowerRight: 2,
  lowerLeft: 3,
};

/** Maps an EllipseEndpoint (except center) to the corresponding polygon point index.
 *  ellipseToPolygon produces points in order: right(0), top(1), left(2), bottom(3). */
const ELLIPSE_ENDPOINT_TO_INDEX: Record<EllipseEndpoint, number> = {
  right: 0,
  top: 1,
  left: 2,
  bottom: 3,
  center: -1,
};

/** If endpoint is a locked-rectangle referencing oldRectId, relink it to a locked-polygon
 *  pointing at the corresponding vertex of the new polygon. Otherwise return unchanged. */
export function relinkRectangleEndpoint(
  endpoint: ConstraintEndpoint,
  oldRectId: Id,
  newPolygonId: Id,
): ConstraintEndpoint {
  if (endpoint.type === 'locked-rectangle' && endpoint.id === oldRectId) {
    return {
      type: 'locked-polygon',
      id: newPolygonId,
      pointIndex: RECTANGLE_ENDPOINT_TO_INDEX[endpoint.point],
    };
  }
  return endpoint;
}

/** If endpoint is a locked-ellipse referencing oldEllipseId, relink it to a locked-polygon
 *  pointing at the corresponding vertex of the new polygon. The center endpoint has no corresponding
 *  polygon vertex, so it becomes a free point endpoint using the ellipse center. Otherwise return unchanged. */
export function relinkEllipseEndpoint(
  endpoint: ConstraintEndpoint,
  oldEllipseId: Id,
  newPolygonId: Id,
  ellipseCenter: SheetPosition,
): ConstraintEndpoint {
  if (endpoint.type === 'locked-ellipse' && endpoint.id === oldEllipseId) {
    if (endpoint.point === 'center') {
      return { type: 'point', point: ellipseCenter };
    }
    return {
      type: 'locked-polygon',
      id: newPolygonId,
      pointIndex: ELLIPSE_ENDPOINT_TO_INDEX[endpoint.point],
    };
  }
  return endpoint;
}

/** An endpoint of a linear constraint. Can be a free-floating point, or locked to a specific
 *  point on a rectangle, ellipse, or polygon. When locked, the constraint automatically follows
 *  the geometry when it moves. */
export type ConstraintEndpoint =
  | { type: 'point'; point: SheetPosition }
  | { type: 'locked-rectangle'; id: Id; point: RectangleEndpoint }
  | { type: 'locked-ellipse'; id: Id; point: EllipseEndpoint }
  | { type: 'locked-polygon'; id: Id; pointIndex: number };

export namespace ConstraintEndpoint {
  /** A literal sheet position endpoint. */
  export function point(point: SheetPosition): ConstraintEndpoint {
    return { type: 'point', point };
  }

  /** An endpoint locked to a key point of a rectangle. */
  export function lockedToRectangle(
    id: Rectangle['id'],
    point: RectangleEndpoint,
  ): ConstraintEndpoint {
    return { type: 'locked-rectangle', id, point };
  }

  /** An endpoint locked to a key point of an ellipse. */
  export function lockedToEllipse(id: Ellipse['id'], point: EllipseEndpoint): ConstraintEndpoint {
    return { type: 'locked-ellipse', id, point };
  }

  /** An endpoint locked to a key point of an polygon. */
  export function lockedToPolygon(id: Polygon['id'], pointIndex: number): ConstraintEndpoint {
    return { type: 'locked-polygon', id, pointIndex };
  }

  /** Deep equality check for two ConstraintEndpoint values. */
  export function equal(a: ConstraintEndpoint, b: ConstraintEndpoint): boolean {
    if (a.type !== b.type) {
      return false;
    }
    switch (a.type) {
      case 'point':
        return b.type === 'point' && a.point.x === b.point.x && a.point.y === b.point.y;
      case 'locked-rectangle':
        return b.type === 'locked-rectangle' && a.id === b.id && a.point === b.point;
      case 'locked-ellipse':
        return b.type === 'locked-ellipse' && a.id === b.id && a.point === b.point;
      case 'locked-polygon':
        return b.type === 'locked-polygon' && a.id === b.id && a.pointIndex === b.pointIndex;
    }
  }
}
