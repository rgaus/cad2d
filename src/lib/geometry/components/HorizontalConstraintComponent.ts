import { ConstraintEndpoint } from '../constraints/constraint-endpoint';
import { type Id } from '../types';
import { Geometry, type GeometryComponent } from '../types';

export type HorizontalConstraintComponent = GeometryComponent<
  'horizontalConstraint',
  {
    pointA: ConstraintEndpoint;
    pointB: ConstraintEndpoint;
  }
>;

export namespace HorizontalConstraintComponent {
  export const key: keyof HorizontalConstraintComponent = 'horizontalConstraint';

  export function create(
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
  ): HorizontalConstraintComponent {
    return {
      horizontalConstraint: {
        pointA,
        pointB,
      },
    };
  }

  export function get(
    geometry: Geometry<HorizontalConstraintComponent>,
  ): HorizontalConstraintComponent['horizontalConstraint'] {
    return geometry.components.horizontalConstraint;
  }

  export function getOptional(
    geometry: Geometry,
  ): HorizontalConstraintComponent['horizontalConstraint'] | undefined {
    if (Geometry.hasComponent(geometry, HorizontalConstraintComponent)) {
      return geometry.components.horizontalConstraint;
    }
    return undefined;
  }

  export function update(
    geometry: Geometry<HorizontalConstraintComponent>,
    partial: Partial<HorizontalConstraintComponent['horizontalConstraint']>,
  ): Geometry<HorizontalConstraintComponent> {
    return {
      ...geometry,
      components: {
        ...geometry.components,
        horizontalConstraint: {
          ...geometry.components.horizontalConstraint,
          ...partial,
        },
      },
    };
  }

  export function isGeometryLockedTo(
    constraint: Geometry<HorizontalConstraintComponent>,
    geometryId: Id,
  ): boolean {
    const data = get(constraint);
    const attached = (ep: ConstraintEndpoint) => ep.type !== 'point' && ep.id === geometryId;
    return attached(data.pointA) || attached(data.pointB);
  }

  export function getPositionKeys(): Array<'pointA' | 'pointB'> {
    return ['pointA', 'pointB'];
  }

  export function getEndpoint(
    constraint: Geometry<HorizontalConstraintComponent>,
    pointKey: keyof HorizontalConstraintComponent[keyof HorizontalConstraintComponent],
  ) {
    const data = HorizontalConstraintComponent.get(constraint);
    switch (pointKey) {
      case 'pointA':
        return data.pointA;
      case 'pointB':
        return data.pointB;
      default:
        return null;
    }
  }
}
