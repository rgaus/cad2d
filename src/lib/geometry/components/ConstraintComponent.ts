import type { Constraint } from '../constraints';
import type { Geometry, GeometryComponent } from '../types';

/**
 * Geometry component for a constraint.
 */
export type ConstraintComponent<C extends Constraint = Constraint> = GeometryComponent<'constraint', C>;

export namespace ConstraintComponent {
  export const key: keyof ConstraintComponent = 'constraint';

  export function create<C extends Constraint>(constraint: C): ConstraintComponent<C> {
    return { constraint };
  }

  export function get<C extends Constraint>(geometry: Geometry<ConstraintComponent<C>>): C {
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
