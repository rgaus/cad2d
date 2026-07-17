import { Constraint, type ConstraintData } from '../constraints';
import { type Entity, type EntityComponent } from '../types';

/**
 * Geometry component for a constraint.
 */
export type ConstraintComponent<C extends ConstraintData = ConstraintData> = EntityComponent<
  'constraint',
  C
>;

export namespace ConstraintComponent {
  export const key: keyof ConstraintComponent = 'constraint';

  export function create<C extends ConstraintData>(constraint: C): ConstraintComponent<C> {
    return { constraint };
  }

  export function get<C extends ConstraintData>(geometry: Entity<ConstraintComponent<C>>): C;
  export function get(geometry: Constraint): ConstraintData;
  export function get<C extends ConstraintData>(geometry: Entity<ConstraintComponent<C>>): C {
    return geometry.components.constraint;
  }

  export function update(
    geometry: Entity<ConstraintComponent>,
    partial: Partial<ConstraintData>,
  ): Entity<ConstraintComponent> {
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
