import { Length } from '@/lib/units/length';
import { LinearConstraintComponent } from '../components/LinearConstraintComponent';
import { Geometry } from '../types';
import { type Id } from '../types';
import { ConstraintEndpoint } from './constraint-endpoint';

/** The default distance (in px) that the linear offset label is offset from the connector line
 * between pointA and pointB. */
export const LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX = -12;

export type LinearConstraint = Geometry<LinearConstraintComponent>;

export type LinearConstraintTemplate = Omit<LinearConstraint, 'id'>;

export namespace LinearConstraint {
  export function create(
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
    length: Length,
    options?: {
      connectorLineOffsetPx?: number;
      axis?: 'x' | 'y' | null;
    },
  ): LinearConstraintTemplate {
    return {
      components: {
        ...LinearConstraintComponent.create(pointA, pointB, length, options),
      },
    };
  }

  export function isLinearConstraint(geometry: Geometry): geometry is LinearConstraint {
    return Geometry.hasComponent(geometry, LinearConstraintComponent);
  }

  export function isGeometryLockedTo(geometry: LinearConstraint, geometryId: Id): boolean {
    const linearConstraint = LinearConstraintComponent.get(geometry);
    const attached = (ep: ConstraintEndpoint) =>
      (ep.type === 'locked-rectangle' ||
        ep.type === 'locked-ellipse' ||
        ep.type === 'locked-polygon' ||
        ep.type === 'locked-datum') &&
      ep.id === geometryId;
    return attached(linearConstraint.pointA) || attached(linearConstraint.pointB);
  }

  export function getPositionKeys(): Array<'pointA' | 'pointB'> {
    return ['pointA', 'pointB'];
  }
}
