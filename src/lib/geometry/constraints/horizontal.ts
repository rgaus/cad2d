import { ConstraintComponent } from '@/lib/geometry/components/ConstraintComponent';
import { Constraint, ConstraintData } from '.';
import { Geometry, type Id } from '../types';
import { ConstraintEndpoint } from './constraint-endpoint';

export type HorizontalConstraintData = {
  type: 'horizontal';
  pointA: ConstraintEndpoint;
  pointB: ConstraintEndpoint;
};

export type HorizontalConstraint = Geometry<ConstraintComponent<HorizontalConstraintData>>;

export type HorizontalConstraintTemplate = Omit<HorizontalConstraint, 'id'>;

export namespace HorizontalConstraint {
  export function create(
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
  ): HorizontalConstraintTemplate {
    return {
      components: {
        ...ConstraintComponent.create({
          type: 'horizontal',
          pointA,
          pointB,
        }),
      },
    };
  }

  export function isHorizontalConstraint(maybe: ConstraintData): maybe is HorizontalConstraintData {
    return maybe.type === 'horizontal';
  }

  export function isGeometryLockedTo(geom: Geometry<ConstraintComponent>, geometryId: Id): boolean {
    const constraint = ConstraintComponent.get(geom);
    if (constraint.type !== 'horizontal') {
      return false;
    }
    const attached = (ep: ConstraintEndpoint) => ep.type !== 'point' && ep.id === geometryId;
    return attached(constraint.pointA) || attached(constraint.pointB);
  }

  export function getPositionKeys(): Array<'pointA' | 'pointB'> {
    return ['pointA', 'pointB'];
  }
}
