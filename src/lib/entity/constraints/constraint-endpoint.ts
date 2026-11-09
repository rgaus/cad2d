import { type SheetPosition } from '@/lib/viewport/types';
import {
  type TransformableConstraintEndpoint,
  getConstraintEndpointAdapter,
} from '../components/templates/TransformableTemplate';
import { type Ellipse, type EllipseEndpoint } from '../ellipse';
import { type Polygon } from '../polygon';
import { type Rectangle, type RectangleEndpoint } from '../rectangle';
import { type Id } from '../types';

/** An endpoint of a linear constraint. Can be a free-floating point, or locked to a specific
 *  point on a rectangle, ellipse, polygon, or datum. When locked, the constraint automatically
 *  follows the geometry when it moves. */
export type ConstraintEndpoint =
  | { type: 'point'; point: SheetPosition }
  | { type: 'locked-rectangle'; id: Id; point: RectangleEndpoint }
  | { type: 'locked-ellipse'; id: Id; point: EllipseEndpoint }
  | { type: 'locked-polygon'; id: Id; pointIndex: number }
  | { type: 'locked-datum'; id: Id }
  | TransformableConstraintEndpoint<'locked-involute-gear'>;

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

  /** An endpoint locked to a datum. */
  export function lockedToDatum(id: Id): ConstraintEndpoint {
    return { type: 'locked-datum', id };
  }

  /** True for any endpoint which references an entity. */
  export function isLocked(
    endpoint: ConstraintEndpoint,
  ): endpoint is Exclude<ConstraintEndpoint, { type: 'point' }> {
    return endpoint.type !== 'point';
  }

  /** Returns the referenced entity id for locked endpoints, or null for free points. */
  export function getEntityId(endpoint: ConstraintEndpoint): Id | null {
    return endpoint.type === 'point' ? null : endpoint.id;
  }

  /** Returns a stable key for the specific point on the endpoint's entity. */
  export function getKeyPoint(endpoint: ConstraintEndpoint): string | null {
    switch (endpoint.type) {
      case 'point':
        return null;
      case 'locked-rectangle':
        return endpoint.point;
      case 'locked-ellipse':
        return endpoint.point;
      case 'locked-polygon':
        return `${endpoint.pointIndex}`;
      case 'locked-datum':
        return null;
      default:
        return getConstraintEndpointAdapter(endpoint)?.getKeyPoint(endpoint as any) ?? null;
    }
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
      case 'locked-datum':
        return b.type === 'locked-datum' && a.id === b.id;
      default: {
        const adapter = getConstraintEndpointAdapter(a);
        if (adapter) {
          return adapter.equals(a as any, b as any);
        }
        throw new Error(`ConstraintEndpoint.equal: unexpected endpoint type ${(a as any).type}`);
      }
    }
  }
}
