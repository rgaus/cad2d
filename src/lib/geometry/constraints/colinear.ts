import { ConstraintComponent } from '@/lib/geometry/components/ConstraintComponent';
import { Constraint } from '.';
import { Geometry, type Id } from '../types';
import { ConstraintEndpoint } from './constraint-endpoint';

export type ColinearConstraintData = {
  type: 'colinear';
  /** The point that should lie on the line defined by pointA and pointB. */
  pointTarget: ConstraintEndpoint;
  /** First point of the reference line. */
  pointA: ConstraintEndpoint;
  /** Second point of the reference line. */
  pointB: ConstraintEndpoint;
};

export type ColinearConstraint = Geometry<ConstraintComponent<ColinearConstraintData>>;

export type ColinearConstraintTemplate = Omit<ColinearConstraint, 'id'>;

export namespace ColinearConstraint {
  export function create(
    pointTarget: ConstraintEndpoint,
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
  ): ColinearConstraintTemplate {
    return {
      components: {
        ...ConstraintComponent.create({
          type: 'colinear',
          pointTarget,
          pointA,
          pointB,
        }),
      },
    };
  }

  export function isColinearConstraint(maybe: Constraint): maybe is ColinearConstraint {
    return ConstraintComponent.get(maybe).type === 'colinear';
  }

  export function isGeometryLockedTo(geom: Geometry<ConstraintComponent>, geometryId: Id): boolean {
    const constraint = ConstraintComponent.get(geom);
    if (constraint.type !== 'colinear') {
      return false;
    }
    const attached = (ep: ConstraintEndpoint) => ep.type !== 'point' && ep.id === geometryId;
    return (
      attached(constraint.pointTarget) || attached(constraint.pointA) || attached(constraint.pointB)
    );
  }

  export function getPositionKeys(): Array<'pointTarget' | 'pointA' | 'pointB'> {
    return ['pointTarget', 'pointA', 'pointB'];
  }
}
