import { Constraint } from '.';
import { ConstraintComponent } from '../components/ConstraintComponent';
import { Entity, type Id } from '../types';
import { ConstraintEndpoint } from './constraint-endpoint';

export type PerpendicularConstraintData = {
  type: 'perpendicular';
  pointA: ConstraintEndpoint;
  pointCenter: ConstraintEndpoint;
  pointB: ConstraintEndpoint;
};

export type PerpendicularConstraint = Entity<ConstraintComponent<PerpendicularConstraintData>>;

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
    maybePerpendicularConstraint: Constraint,
  ): maybePerpendicularConstraint is PerpendicularConstraint {
    return ConstraintComponent.get(maybePerpendicularConstraint).type === 'perpendicular';
  }

  export function isGeometryLockedTo(geom: Entity<ConstraintComponent>, geometryId: Id): boolean {
    const constraint = ConstraintComponent.get(geom);
    if (constraint.type !== 'perpendicular') {
      return false;
    }
    const attached = (ep: ConstraintEndpoint) => ep.type !== 'point' && ep.id === geometryId;
    return (
      attached(constraint.pointA) || attached(constraint.pointCenter) || attached(constraint.pointB)
    );
  }

  export function getPositionKeys(): Array<'pointA' | 'pointCenter' | 'pointB'> {
    return ['pointA', 'pointCenter', 'pointB'];
  }

  export function getEndpoint(
    geometry: Entity<ConstraintComponent>,
    pointKey: string,
  ): ConstraintEndpoint | undefined {
    const constraint = ConstraintComponent.get(geometry);
    if (constraint.type !== 'perpendicular') {
      return undefined;
    }
    if (pointKey === 'pointA' || pointKey === 'pointCenter' || pointKey === 'pointB') {
      return constraint[pointKey];
    }
    return undefined;
  }
}
