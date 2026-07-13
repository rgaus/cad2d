import { type ConstraintData } from '../constraints';
import { type Geometry, type GeometryComponent } from '../types';

/**
 * Geometry component for a constraint.
 */
export type ConstraintComponent<C extends ConstraintData = ConstraintData> = GeometryComponent<'constraint', C>;

export namespace ConstraintComponent {
  export const key: keyof ConstraintComponent = 'constraint';

  export function create<C extends ConstraintData>(constraint: C): ConstraintComponent<C> {
    return { constraint };
  }

  export function get<C extends ConstraintData>(geometry: Geometry<ConstraintComponent<C>>): C {
    return geometry.components.constraint;
  }

  export function update(
    geometry: Geometry<ConstraintComponent>,
    partial: Partial<ConstraintData>,
  ): Geometry<ConstraintComponent> {
    const merged = { ...geometry.components.constraint, ...partial } as ConstraintData;
    return {
      ...geometry,
      components: {
        ...geometry.components,
        constraint: merged,
      },
    };
  }
}
