import type { Constraint } from '../constraints';
import type { Geometry, GeometryComponent } from '../types';

/**
 * Geometry component for a constraint.
 */
export type ConstraintComponent = GeometryComponent<'constraint', Constraint>;

export namespace ConstraintComponent {
  export const key: keyof ConstraintComponent = 'constraint';

  export function create(constraint: Constraint): ConstraintComponent {
    return { constraint };
  }

  export function get(geometry: Geometry<ConstraintComponent>): Constraint {
    return geometry.components.constraint;
  }

  export function update(
    geometry: Geometry<ConstraintComponent>,
    partial: Partial<Constraint>,
  ): Geometry<ConstraintComponent> {
    const merged = { ...geometry.components.constraint, ...partial } as Constraint;
    return {
      ...geometry,
      components: {
        ...geometry.components,
        constraint: merged,
      },
    };
  }
}
