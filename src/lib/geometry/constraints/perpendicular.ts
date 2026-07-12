import { Angle, Vector2 } from '@/lib/math';
import { SheetPosition } from '@/lib/viewport/types';
import { Constraint } from '.';
import { type Id } from '../types';
import { ConstraintEndpoint } from './constraint-endpoint';

export type PerpendicularConstraint = {
  id: Id;
  type: 'perpendicular';
  pointA: ConstraintEndpoint;
  pointCenter: ConstraintEndpoint;
  pointB: ConstraintEndpoint;
};

export type PerpendicularConstraintTemplate = Omit<PerpendicularConstraint, 'id'>;

export namespace PerpendicularConstraint {
  export function create(
    pointA: ConstraintEndpoint,
    pointCenter: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
  ): PerpendicularConstraintTemplate {
    return {
      type: 'perpendicular',
      pointA,
      pointCenter,
      pointB,
    };
  }

  export function isPerpendicularConstraint(
    maybePerpendicularConstraint: Constraint,
  ): maybePerpendicularConstraint is PerpendicularConstraint {
    return maybePerpendicularConstraint.type === 'perpendicular';
  }

  export function isGeometryLockedTo(constraint: PerpendicularConstraint, geometryId: Id): boolean {
    const attached = (ep: ConstraintEndpoint) =>
      (ep.type === 'locked-rectangle' ||
        ep.type === 'locked-ellipse' ||
        ep.type === 'locked-polygon' ||
        ep.type === 'locked-datum') &&
      ep.id === geometryId;
    return (
      attached(constraint.pointA) || attached(constraint.pointCenter) || attached(constraint.pointB)
    );
  }

  export function getPositionKeys(): Array<'pointA' | 'pointCenter' | 'pointB'> {
    return ['pointA', 'pointCenter', 'pointB'];
  }

  export function isInConflict(
    constraint: PerpendicularConstraint,
    resolveEndpoint: (ep: ConstraintEndpoint) => SheetPosition,
  ): boolean {
    const resolvedA = resolveEndpoint(constraint.pointA);
    const resolvedCenter = resolveEndpoint(constraint.pointCenter);
    const resolvedB = resolveEndpoint(constraint.pointB);
    const vADir = Vector2.sub(resolvedA, resolvedCenter);
    const vBDir = Vector2.sub(resolvedB, resolvedCenter);
    const dot = vADir.x * vBDir.x + vADir.y * vBDir.y;
    const cross = vADir.x * vBDir.y - vADir.y * vBDir.x;
    const angleDegrees = Math.abs(Angle.toDegrees(Math.atan2(cross, dot)));
    const remainder = Math.abs(angleDegrees % 90);
    const oppositeRemainder = Math.abs(angleDegrees % 180);
    return !(remainder < 1e-3 && oppositeRemainder > 1e-3);
  }
}
