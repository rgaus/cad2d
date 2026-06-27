import { Constraint } from '.';
import { type Id } from '../types';
import { ConstraintEndpoint } from './constraint-endpoint';

export type HorizontalConstraint = {
  id: Id;
  type: 'horizontal';
  pointA: ConstraintEndpoint;
  pointB: ConstraintEndpoint;
};

export type HorizontalConstraintTemplate = Omit<HorizontalConstraint, 'id'>;

export namespace HorizontalConstraint {
  export function create(
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
  ): HorizontalConstraintTemplate {
    return {
      type: 'horizontal',
      pointA,
      pointB,
    };
  }

  export function isHorizontalConstraint(maybe: Constraint): maybe is HorizontalConstraint {
    return maybe.type === 'horizontal';
  }

  export function isGeometryLockedTo(constraint: HorizontalConstraint, geometryId: Id): boolean {
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
