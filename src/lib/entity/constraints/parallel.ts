import { Constraint } from '.';
import { ConstraintComponent } from '../components/ConstraintComponent';
import { Entity, type Id } from '../types';
import { ConstraintEndpoint } from './constraint-endpoint';

export type ParallelConstraintData = {
  type: 'parallel';
  pointA: ConstraintEndpoint;
  pointB: ConstraintEndpoint;
  pointC: ConstraintEndpoint;
  pointD: ConstraintEndpoint;
};

export type ParallelConstraint = Entity<ConstraintComponent<ParallelConstraintData>>;

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
    maybeParallelConstraint: Constraint,
  ): maybeParallelConstraint is ParallelConstraint {
    return ConstraintComponent.get(maybeParallelConstraint).type === 'parallel';
  }

  export function isGeometryLockedTo(geom: Entity<ConstraintComponent>, geometryId: Id): boolean {
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

  export function getEndpoint(
    geometry: Entity<ConstraintComponent>,
    pointKey: string,
  ): ConstraintEndpoint | undefined {
    const constraint = ConstraintComponent.get(geometry);
    if (constraint.type !== 'parallel') {
      return undefined;
    }
    if (
      pointKey === 'pointA' ||
      pointKey === 'pointB' ||
      pointKey === 'pointC' ||
      pointKey === 'pointD'
    ) {
      return constraint[pointKey];
    }
    return undefined;
  }
}
