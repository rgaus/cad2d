import { ConstraintComponent } from '@/lib/geometry/components/ConstraintComponent';
import { Constraint, ConstraintData } from '.';
import { Geometry, type Id } from '../types';
import { ConstraintEndpoint } from './constraint-endpoint';

export type PerpendicularConstraintData = {
  type: 'perpendicular';
  pointA: ConstraintEndpoint;
  pointCenter: ConstraintEndpoint;
  pointB: ConstraintEndpoint;
};

export type PerpendicularConstraint = Geometry<ConstraintComponent<PerpendicularConstraintData>>;

export type PerpendicularConstraintTemplate = Omit<PerpendicularConstraint, 'id'>;

export namespace PerpendicularConstraint {
  export function create(
    pointA: ConstraintEndpoint,
    pointCenter: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
  ): PerpendicularConstraintTemplate {
    return {
      components: {
        ...ConstraintComponent.create({
          type: 'perpendicular',
          pointA,
          pointCenter,
          pointB,
        }),
      },
    };
  }

  export function isPerpendicularConstraint(
    maybePerpendicularConstraint: ConstraintData,
  ): maybePerpendicularConstraint is PerpendicularConstraintData {
    return maybePerpendicularConstraint.type === 'perpendicular';
  }

  export function isGeometryLockedTo(geom: Geometry<ConstraintComponent>, geometryId: Id): boolean {
    const constraint = ConstraintComponent.get(geom);
    if (constraint.type !== 'perpendicular') {
      return false;
    }
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
}
