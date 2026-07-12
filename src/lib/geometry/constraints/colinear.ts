import { SheetPosition } from '@/lib/viewport/types';
import { Constraint } from '.';
import { type Id } from '../types';
import { ConstraintEndpoint } from './constraint-endpoint';

export type ColinearConstraint = {
  id: Id;
  type: 'colinear';
  /** The point that should lie on the line defined by pointA and pointB. */
  pointTarget: ConstraintEndpoint;
  /** First point of the reference line. */
  pointA: ConstraintEndpoint;
  /** Second point of the reference line. */
  pointB: ConstraintEndpoint;
};

export type ColinearConstraintTemplate = Omit<ColinearConstraint, 'id'>;

export namespace ColinearConstraint {
  export function create(
    pointTarget: ConstraintEndpoint,
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
  ): ColinearConstraintTemplate {
    return {
      type: 'colinear',
      pointTarget,
      pointA,
      pointB,
    };
  }

  export function isColinearConstraint(maybe: Constraint): maybe is ColinearConstraint {
    return maybe.type === 'colinear';
  }

  export function isGeometryLockedTo(constraint: ColinearConstraint, geometryId: Id): boolean {
    const attached = (ep: ConstraintEndpoint) => ep.type !== 'point' && ep.id === geometryId;
    return (
      attached(constraint.pointTarget) || attached(constraint.pointA) || attached(constraint.pointB)
    );
  }

  export function getPositionKeys(): Array<'pointTarget' | 'pointA' | 'pointB'> {
    return ['pointTarget', 'pointA', 'pointB'];
  }

  export function isInConflict(
    constraint: ColinearConstraint,
    resolveEndpoint: (ep: ConstraintEndpoint) => SheetPosition,
  ): boolean {
    const resolvedTarget = resolveEndpoint(constraint.pointTarget);
    const resolvedA = resolveEndpoint(constraint.pointA);
    const resolvedB = resolveEndpoint(constraint.pointB);
    const cross =
      (resolvedB.x - resolvedA.x) * (resolvedTarget.y - resolvedA.y) -
      (resolvedB.y - resolvedA.y) * (resolvedTarget.x - resolvedA.x);
    return Math.abs(cross) > 1e-3;
  }
}
