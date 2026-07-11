import { ParallelConstraintComponent } from '../components/ParallelConstraintComponent';
import { Geometry } from '../types';
import { type Id } from '../types';
import { ConstraintEndpoint } from './constraint-endpoint';

export type ParallelConstraint = Geometry<ParallelConstraintComponent>;

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
        ...ParallelConstraintComponent.create(pointA, pointB, pointC, pointD),
      },
    };
  }

  export function isParallelConstraint(geometry: Geometry): geometry is ParallelConstraint {
    return Geometry.hasComponent(geometry, ParallelConstraintComponent);
  }

  export function isGeometryLockedTo(geometry: ParallelConstraint, geometryId: Id): boolean {
    const data = ParallelConstraintComponent.get(geometry);
    const attached = (ep: ConstraintEndpoint) =>
      (ep.type === 'locked-rectangle' ||
        ep.type === 'locked-ellipse' ||
        ep.type === 'locked-polygon' ||
        ep.type === 'locked-datum') &&
      ep.id === geometryId;
    return (
      attached(data.pointA) ||
      attached(data.pointB) ||
      attached(data.pointC) ||
      attached(data.pointD)
    );
  }

  export function getPositionKeys(): Array<'pointA' | 'pointB' | 'pointC' | 'pointD'> {
    return ['pointA', 'pointB', 'pointC', 'pointD'];
  }
}
