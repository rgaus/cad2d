import { ConstraintComponent } from '@/lib/geometry/components/ConstraintComponent';
import { Constraint } from '.';
import { Geometry, type Id } from '../types';
import { ConstraintEndpoint } from './constraint-endpoint';

export type VerticalConstraint = {
  type: 'vertical';
  pointA: ConstraintEndpoint;
  pointB: ConstraintEndpoint;
};

export type VerticalConstraintTemplate = Omit<Geometry<ConstraintComponent>, 'id'>;

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
    return maybe.type === 'vertical';
  }

  export function isGeometryLockedTo(geom: Geometry<ConstraintComponent>, geometryId: Id): boolean {
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
}
