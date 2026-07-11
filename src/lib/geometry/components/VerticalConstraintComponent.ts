import { ConstraintEndpoint } from '../constraints/constraint-endpoint';
import { type Id } from '../types';
import { Geometry, type GeometryComponent } from '../types';

export type VerticalConstraintComponent = GeometryComponent<
  'verticalConstraint',
  {
    pointA: ConstraintEndpoint;
    pointB: ConstraintEndpoint;
  }
>;

export namespace VerticalConstraintComponent {
  export const key: keyof VerticalConstraintComponent = 'verticalConstraint';

  export function create(
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
  ): VerticalConstraintComponent {
    return {
      verticalConstraint: {
        pointA,
        pointB,
      },
    };
  }

  export function get(
    geometry: Geometry<VerticalConstraintComponent>,
  ): VerticalConstraintComponent['verticalConstraint'] {
    return geometry.components.verticalConstraint;
  }

  export function getOptional(
    geometry: Geometry,
  ): VerticalConstraintComponent['verticalConstraint'] | undefined {
    if (Geometry.hasComponent(geometry, VerticalConstraintComponent)) {
      return geometry.components.verticalConstraint;
    }
    return undefined;
  }

  export function update(
    geometry: Geometry<VerticalConstraintComponent>,
    partial: Partial<VerticalConstraintComponent['verticalConstraint']>,
  ): Geometry<VerticalConstraintComponent> {
    return {
      ...geometry,
      components: {
        ...geometry.components,
        verticalConstraint: {
          ...geometry.components.verticalConstraint,
          ...partial,
        },
      },
    };
  }

  export function isGeometryLockedTo(
    constraint: Geometry<VerticalConstraintComponent>,
    geometryId: Id,
  ): boolean {
    const data = get(constraint);
    const attached = (ep: ConstraintEndpoint) => ep.type !== 'point' && ep.id === geometryId;
    return attached(data.pointA) || attached(data.pointB);
  }

  export function getPositionKeys(): Array<'pointA' | 'pointB'> {
    return ['pointA', 'pointB'];
  }

  export function* getContainingEndpoints(
    g: Geometry<VerticalConstraintComponent>,
  ): Generator<[string, ConstraintEndpoint]> {
    const data = get(g);
    yield ['pointA', data.pointA];
    yield ['pointB', data.pointB];
  }
}
