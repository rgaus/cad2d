import { Constraint } from '.';
import { type Id } from '../types';
import { ConstraintEndpoint } from './constraint-endpoint';

export type VerticalConstraint = {
  id: Id;
  type: 'vertical';
  pointA: ConstraintEndpoint;
  pointB: ConstraintEndpoint;
};

export type VerticalConstraintTemplate = Omit<VerticalConstraint, 'id'>;

export namespace VerticalConstraint {
  export function create(
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
  ): VerticalConstraintTemplate {
    return {
      type: 'vertical',
      pointA,
      pointB,
    };
  }

  export function isVerticalConstraint(maybe: Constraint): maybe is VerticalConstraint {
    return maybe.type === 'vertical';
  }

  export function isGeometryLockedTo(constraint: VerticalConstraint, geometryId: Id): boolean {
    const attached = (ep: ConstraintEndpoint) =>
      (ep.type === 'locked-rectangle' ||
        ep.type === 'locked-ellipse' ||
        ep.type === 'locked-polygon' ||
        ep.type === 'locked-datum') &&
      ep.id === geometryId;
    return attached(constraint.pointA) || attached(constraint.pointB);
  }

  export function getPositionKeys(): Array<'pointA' | 'pointB'> {
    return ['pointA', 'pointB'];
  }
}
