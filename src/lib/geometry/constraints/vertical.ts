import { SheetPosition } from '@/lib/viewport/types';
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
    const attached = (ep: ConstraintEndpoint) => ep.type !== 'point' && ep.id === geometryId;
    return attached(constraint.pointA) || attached(constraint.pointB);
  }

  export function getPositionKeys(): Array<'pointA' | 'pointB'> {
    return ['pointA', 'pointB'];
  }

  export function isInConflict(
    constraint: VerticalConstraint,
    resolveEndpoint: (ep: ConstraintEndpoint) => SheetPosition,
  ): boolean {
    const resolvedA = resolveEndpoint(constraint.pointA);
    const resolvedB = resolveEndpoint(constraint.pointB);
    return Math.abs(resolvedB.x - resolvedA.x) > 1e-3;
  }
}
