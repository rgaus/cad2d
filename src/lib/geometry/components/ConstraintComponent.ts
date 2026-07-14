import { type ConstraintData, type ConstraintEndpoint } from '../constraints';
import { type Geometry, type GeometryComponent } from '../types';

/**
 * Geometry component for a constraint.
 */
export type ConstraintComponent<C extends ConstraintData = ConstraintData> = GeometryComponent<
  'constraint',
  C
>;

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

  /** Safely extract a ConstraintEndpoint from a constraint geometry by point key.
   *  Returns undefined if the pointKey is not valid for this constraint type. */
  export function getEndpoint(
    geometry: Geometry<ConstraintComponent>,
    pointKey: string,
  ): ConstraintEndpoint | undefined {
    const c = get(geometry);
    switch (c.type) {
      case 'linear': {
        if (pointKey === 'pointA' || pointKey === 'pointB') {
          return c[pointKey];
        }
        return undefined;
      }
      case 'perpendicular': {
        if (pointKey === 'pointA' || pointKey === 'pointCenter' || pointKey === 'pointB') {
          return c[pointKey];
        }
        return undefined;
      }
      case 'parallel': {
        if (
          pointKey === 'pointA' ||
          pointKey === 'pointB' ||
          pointKey === 'pointC' ||
          pointKey === 'pointD'
        ) {
          return c[pointKey];
        }
        return undefined;
      }
      case 'horizontal':
      case 'vertical': {
        if (pointKey === 'pointA' || pointKey === 'pointB') {
          return c[pointKey];
        }
        return undefined;
      }
      case 'colinear': {
        if (pointKey === 'pointTarget' || pointKey === 'pointA' || pointKey === 'pointB') {
          return c[pointKey];
        }
        return undefined;
      }
      default:
        c satisfies never;
        return undefined;
    }
  }
}
