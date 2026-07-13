import { ConstraintComponent } from '@/lib/geometry/components/ConstraintComponent';
import { Constraint, ConstraintData } from '.';
import { Geometry, type Id } from '../types';
import { ConstraintEndpoint } from './constraint-endpoint';

export type ParallelConstraintData = {
  type: 'parallel';
  pointA: ConstraintEndpoint;
  pointB: ConstraintEndpoint;
  pointC: ConstraintEndpoint;
  pointD: ConstraintEndpoint;
};

export type ParallelConstraint = Geometry<ConstraintComponent<ParallelConstraintData>>;

export type ParallelConstraintTemplate = Omit<ParallelConstraint, 'id'>;

export namespace ParallelConstraint {
  export function create(
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
    pointC: ConstraintEndpoint,
    pointD: ConstraintEndpoint,
  ): ParallelConstraintTemplate {
    return {
      components: {
        ...ConstraintComponent.create({
          type: 'parallel',
          pointA,
          pointB,
          pointC,
          pointD,
        }),
      },
    };
  }

  export function isParallelConstraint(
    maybeParallelConstraint: ConstraintData,
  ): maybeParallelConstraint is ParallelConstraintData {
    return maybeParallelConstraint.type === 'parallel';
  }

  export function isGeometryLockedTo(geom: Geometry<ConstraintComponent>, geometryId: Id): boolean {
    const constraint = ConstraintComponent.get(geom);
    if (constraint.type !== 'parallel') {
      return false;
    }
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
}
