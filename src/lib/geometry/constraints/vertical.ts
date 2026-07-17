import { ConstraintComponent } from '@/lib/geometry/components/ConstraintComponent';
import { Constraint } from '.';
import { Entity, type Id } from '../types';
import { ConstraintEndpoint } from './constraint-endpoint';

export type VerticalConstraintData = {
  type: 'vertical';
  pointA: ConstraintEndpoint;
  pointB: ConstraintEndpoint;
};

export type VerticalConstraint = Entity<ConstraintComponent<VerticalConstraintData>>;

export type VerticalConstraintTemplate = Omit<VerticalConstraint, 'id'>;

export namespace VerticalConstraint {
  export function create(
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
  ): VerticalConstraintTemplate {
    return {
      components: {
        ...ConstraintComponent.create({
          type: 'vertical',
          pointA,
          pointB,
        }),
      },
    };
  }

  export function isVerticalConstraint(maybe: Constraint): maybe is VerticalConstraint {
    return ConstraintComponent.get(maybe).type === 'vertical';
  }

  export function isGeometryLockedTo(geom: Entity<ConstraintComponent>, geometryId: Id): boolean {
    const constraint = ConstraintComponent.get(geom);
    if (constraint.type !== 'vertical') {
      return false;
    }
    const attached = (ep: ConstraintEndpoint) => ep.type !== 'point' && ep.id === geometryId;
    return attached(constraint.pointA) || attached(constraint.pointB);
  }

  export function getPositionKeys(): Array<'pointA' | 'pointB'> {
    return ['pointA', 'pointB'];
  }

  export function getEndpoint(
    geometry: Entity<ConstraintComponent>,
    pointKey: string,
  ): ConstraintEndpoint | undefined {
    const constraint = ConstraintComponent.get(geometry);
    if (constraint.type !== 'vertical') {
      return undefined;
    }
    if (pointKey === 'pointA' || pointKey === 'pointB') {
      return constraint[pointKey];
    }
    return undefined;
  }
}
