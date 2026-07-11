import { ConstraintEndpoint } from '../constraints/constraint-endpoint';
import { type Id } from '../types';
import { Geometry, type GeometryComponent } from '../types';

export type ParallelConstraintComponent = GeometryComponent<
  'parallelConstraint',
  {
    pointA: ConstraintEndpoint;
    pointB: ConstraintEndpoint;
    pointC: ConstraintEndpoint;
    pointD: ConstraintEndpoint;
  }
>;

export namespace ParallelConstraintComponent {
  export const key: keyof ParallelConstraintComponent = 'parallelConstraint';

  export function create(
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
    pointC: ConstraintEndpoint,
    pointD: ConstraintEndpoint,
  ): ParallelConstraintComponent {
    return {
      parallelConstraint: {
        pointA,
        pointB,
        pointC,
        pointD,
      },
    };
  }

  export function get(
    geometry: Geometry<ParallelConstraintComponent>,
  ): ParallelConstraintComponent['parallelConstraint'] {
    return geometry.components.parallelConstraint;
  }

  export function getOptional(
    geometry: Geometry,
  ): ParallelConstraintComponent['parallelConstraint'] | undefined {
    if (Geometry.hasComponent(geometry, ParallelConstraintComponent)) {
      return geometry.components.parallelConstraint;
    }
    return undefined;
  }

  export function update(
    geometry: Geometry<ParallelConstraintComponent>,
    partial: Partial<ParallelConstraintComponent['parallelConstraint']>,
  ): Geometry<ParallelConstraintComponent> {
    return {
      ...geometry,
      components: {
        ...geometry.components,
        parallelConstraint: {
          ...geometry.components.parallelConstraint,
          ...partial,
        },
      },
    };
  }

  export function isGeometryLockedTo(
    constraint: Geometry<ParallelConstraintComponent>,
    geometryId: Id,
  ): boolean {
    const data = get(constraint);
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
