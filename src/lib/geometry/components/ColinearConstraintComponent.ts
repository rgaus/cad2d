import { ConstraintEndpoint } from '../constraints/constraint-endpoint';
import { type Id } from '../types';
import { Geometry, type GeometryComponent } from '../types';

export type ColinearConstraintComponent = GeometryComponent<
  'colinearConstraint',
  {
    /** The point that should lie on the line defined by pointA and pointB. */
    pointTarget: ConstraintEndpoint;
    /** First point of the reference line. */
    pointA: ConstraintEndpoint;
    /** Second point of the reference line. */
    pointB: ConstraintEndpoint;
  }
>;

export namespace ColinearConstraintComponent {
  export const key: keyof ColinearConstraintComponent = 'colinearConstraint';

  export function create(
    pointTarget: ConstraintEndpoint,
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
  ): ColinearConstraintComponent {
    return {
      colinearConstraint: {
        pointTarget,
        pointA,
        pointB,
      },
    };
  }

  export function get(
    geometry: Geometry<ColinearConstraintComponent>,
  ): ColinearConstraintComponent['colinearConstraint'] {
    return geometry.components.colinearConstraint;
  }

  export function getOptional(
    geometry: Geometry,
  ): ColinearConstraintComponent['colinearConstraint'] | undefined {
    if (Geometry.hasComponent(geometry, ColinearConstraintComponent)) {
      return geometry.components.colinearConstraint;
    }
    return undefined;
  }

  export function update(
    geometry: Geometry<ColinearConstraintComponent>,
    partial: Partial<ColinearConstraintComponent['colinearConstraint']>,
  ): Geometry<ColinearConstraintComponent> {
    return {
      ...geometry,
      components: {
        ...geometry.components,
        colinearConstraint: {
          ...geometry.components.colinearConstraint,
          ...partial,
        },
      },
    };
  }

  export function isGeometryLockedTo(
    constraint: Geometry<ColinearConstraintComponent>,
    geometryId: Id,
  ): boolean {
    const data = get(constraint);
    const attached = (ep: ConstraintEndpoint) => ep.type !== 'point' && ep.id === geometryId;
    return attached(data.pointTarget) || attached(data.pointA) || attached(data.pointB);
  }

  export function getPositionKeys(): Array<'pointTarget' | 'pointA' | 'pointB'> {
    return ['pointTarget', 'pointA', 'pointB'];
  }

  export function getEndpoint(
    constraint: Geometry<ColinearConstraintComponent>,
    pointKey: keyof ColinearConstraintComponent[keyof ColinearConstraintComponent],
  ) {
    const data = ColinearConstraintComponent.get(constraint);
    switch (pointKey) {
      case 'pointA':
        return data.pointA;
      case 'pointTarget':
        return data.pointTarget;
      case 'pointB':
        return data.pointB;
      default:
        return null;
    }
  }
}
