import { ConstraintEndpoint } from '../constraints/constraint-endpoint';
import { type Id } from '../types';
import { Geometry, type GeometryComponent } from '../types';

export type PerpendicularConstraintComponent = GeometryComponent<
  'perpendicularConstraint',
  {
    pointA: ConstraintEndpoint;
    pointCenter: ConstraintEndpoint;
    pointB: ConstraintEndpoint;
  }
>;

export namespace PerpendicularConstraintComponent {
  export const key: keyof PerpendicularConstraintComponent = 'perpendicularConstraint';

  export function create(
    pointA: ConstraintEndpoint,
    pointCenter: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
  ): PerpendicularConstraintComponent {
    return {
      perpendicularConstraint: {
        pointA,
        pointCenter,
        pointB,
      },
    };
  }

  export function get(
    geometry: Geometry<PerpendicularConstraintComponent>,
  ): PerpendicularConstraintComponent['perpendicularConstraint'] {
    return geometry.components.perpendicularConstraint;
  }

  export function getOptional(
    geometry: Geometry,
  ): PerpendicularConstraintComponent['perpendicularConstraint'] | undefined {
    if (Geometry.hasComponent(geometry, PerpendicularConstraintComponent)) {
      return geometry.components.perpendicularConstraint;
    }
    return undefined;
  }

  export function update(
    geometry: Geometry<PerpendicularConstraintComponent>,
    partial: Partial<PerpendicularConstraintComponent['perpendicularConstraint']>,
  ): Geometry<PerpendicularConstraintComponent> {
    return {
      ...geometry,
      components: {
        ...geometry.components,
        perpendicularConstraint: {
          ...geometry.components.perpendicularConstraint,
          ...partial,
        },
      },
    };
  }

  export function isGeometryLockedTo(
    constraint: Geometry<PerpendicularConstraintComponent>,
    geometryId: Id,
  ): boolean {
    const data = get(constraint);
    const attached = (ep: ConstraintEndpoint) =>
      (ep.type === 'locked-rectangle' ||
        ep.type === 'locked-ellipse' ||
        ep.type === 'locked-polygon' ||
        ep.type === 'locked-datum') &&
      ep.id === geometryId;
    return attached(data.pointA) || attached(data.pointCenter) || attached(data.pointB);
  }

  export function getPositionKeys(): Array<'pointA' | 'pointCenter' | 'pointB'> {
    return ['pointA', 'pointCenter', 'pointB'];
  }

  export function* getContainingEndpoints(
    g: Geometry<PerpendicularConstraintComponent>,
  ): Generator<[string, ConstraintEndpoint]> {
    const data = get(g);
    yield ['pointA', data.pointA];
    yield ['pointCenter', data.pointCenter];
    yield ['pointB', data.pointB];
  }
}
