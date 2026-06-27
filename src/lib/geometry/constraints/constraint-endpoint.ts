import { SheetPosition } from '@/lib/viewport/types';
import { Ellipse, EllipseEndpoint } from '../ellipse';
import { Polygon } from '../polygon';
import { Rectangle, RectangleEndpoint } from '../rectangle';
import { type Id } from '../types';

/** An endpoint of a linear constraint. Can be a free-floating point, or locked to a specific
 *  point on a rectangle, ellipse, or polygon. When locked, the constraint automatically follows
 *  the geometry when it moves. */
export type ConstraintEndpoint =
  | { type: 'point'; point: SheetPosition }
  | { type: 'locked-rectangle'; id: Id; point: RectangleEndpoint }
  | { type: 'locked-ellipse'; id: Id; point: EllipseEndpoint }
  | { type: 'locked-polygon'; id: Id; pointIndex: number }
  | { type: 'locked-constraint'; id: Id; key: string };

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

  /** An endpoint locked to an endpoint of another constraint. */
  export function lockedToConstraint(id: Id, key: string): ConstraintEndpoint {
    return { type: 'locked-constraint', id, key };
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
      case 'locked-constraint':
        return b.type === 'locked-constraint' && a.id === b.id && a.key === b.key;
      default:
        a satisfies never;
        throw new Error(`ConstraintEndpoint.equal: unexpected endpoint type ${(a as any).type}`);
    }
  }
}
