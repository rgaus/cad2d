import { SheetPosition } from '@/lib/viewport/types';
import { Constraint } from '.';
import { type Id } from '../types';
import { ConstraintEndpoint } from './constraint-endpoint';

export type ParallelConstraint = {
  id: Id;
  type: 'parallel';
  pointA: ConstraintEndpoint;
  pointB: ConstraintEndpoint;
  pointC: ConstraintEndpoint;
  pointD: ConstraintEndpoint;
};

export type ParallelConstraintTemplate = Omit<ParallelConstraint, 'id'>;

export namespace ParallelConstraint {
  export function create(
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
    pointC: ConstraintEndpoint,
    pointD: ConstraintEndpoint,
  ): ParallelConstraintTemplate {
    return {
      type: 'parallel',
      pointA,
      pointB,
      pointC,
      pointD,
    };
  }

  export function isParallelConstraint(
    maybeParallelConstraint: Constraint,
  ): maybeParallelConstraint is ParallelConstraint {
    return maybeParallelConstraint.type === 'parallel';
  }

  export function isGeometryLockedTo(constraint: ParallelConstraint, geometryId: Id): boolean {
    const attached = (ep: ConstraintEndpoint) =>
      (ep.type === 'locked-rectangle' ||
        ep.type === 'locked-ellipse' ||
        ep.type === 'locked-polygon' ||
        ep.type === 'locked-datum') &&
      ep.id === geometryId;
    return (
      attached(constraint.pointA) ||
      attached(constraint.pointB) ||
      attached(constraint.pointC) ||
      attached(constraint.pointD)
    );
  }

  export function getPositionKeys(): Array<'pointA' | 'pointB' | 'pointC' | 'pointD'> {
    return ['pointA', 'pointB', 'pointC', 'pointD'];
  }

  export function isInConflict(
    constraint: ParallelConstraint,
    resolveEndpoint: (ep: ConstraintEndpoint) => SheetPosition,
  ): boolean {
    const resolvedA = resolveEndpoint(constraint.pointA);
    const resolvedB = resolveEndpoint(constraint.pointB);
    const resolvedC = resolveEndpoint(constraint.pointC);
    const resolvedD = resolveEndpoint(constraint.pointD);
    const dxAB = resolvedB.x - resolvedA.x;
    const dyAB = resolvedB.y - resolvedA.y;
    const dxCD = resolvedD.x - resolvedC.x;
    const dyCD = resolvedD.y - resolvedC.y;
    const cross = dxAB * dyCD - dyAB * dxCD;
    return Math.abs(cross) > 1e-3;
  }
}
