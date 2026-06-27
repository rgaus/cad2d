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
        ep.type === 'locked-polygon') &&
      ep.id === geometryId;
    return (
      attached(constraint.pointA) || attached(constraint.pointCenter) || attached(constraint.pointB)
    );
  }

  export function getPositionKeys(): Array<'pointA' | 'pointCenter' | 'pointB'> {
    return ['pointA', 'pointCenter', 'pointB'];
  }

  export function getEndpoint(
    constraint: PerpendicularConstraint,
    key: string,
  ): ConstraintEndpoint | null {
    switch (key) {
      case 'pointA':
        return constraint.pointA;
      case 'pointCenter':
        return constraint.pointCenter;
      case 'pointB':
        return constraint.pointB;
      default:
        return null;
    }
  }
}
