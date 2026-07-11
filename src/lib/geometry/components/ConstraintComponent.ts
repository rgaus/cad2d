import { type Constraint } from '../constraints';
import { ConstraintEndpoint } from '../constraints/constraint-endpoint';
import { Geometry, GeometryComponent } from '../types';
import { ColinearConstraintComponent } from './ColinearConstraintComponent';
import { HorizontalConstraintComponent } from './HorizontalConstraintComponent';
import { LinearConstraintComponent } from './LinearConstraintComponent';
import { ParallelConstraintComponent } from './ParallelConstraintComponent';
import { PerpendicularConstraintComponent } from './PerpendicularConstraintComponent';
import { VerticalConstraintComponent } from './VerticalConstraintComponent';

/** Virtual component which allows constraint code to operate on all constraints generically. */
export type ConstraintComponent = GeometryComponent<'constraint', never>;

export type ConstraintData =
  | LinearConstraintComponent['linearConstraint']
  | PerpendicularConstraintComponent['perpendicularConstraint']
  | ParallelConstraintComponent['parallelConstraint']
  | HorizontalConstraintComponent['horizontalConstraint']
  | VerticalConstraintComponent['verticalConstraint']
  | ColinearConstraintComponent['colinearConstraint'];

export namespace ConstraintComponent {
  export const key: keyof ConstraintComponent = 'constraint';
  export const virtual = true;

  export function get(constraint: Constraint): ConstraintData {
    if (Geometry.hasComponent(constraint, LinearConstraintComponent)) {
      return LinearConstraintComponent.get(constraint);
    } else if (Geometry.hasComponent(constraint, HorizontalConstraintComponent)) {
      return HorizontalConstraintComponent.get(constraint);
    } else if (Geometry.hasComponent(constraint, VerticalConstraintComponent)) {
      return VerticalConstraintComponent.get(constraint);
    } else if (Geometry.hasComponent(constraint, PerpendicularConstraintComponent)) {
      return PerpendicularConstraintComponent.get(constraint);
    } else if (Geometry.hasComponent(constraint, ParallelConstraintComponent)) {
      return ParallelConstraintComponent.get(constraint);
    } else if (Geometry.hasComponent(constraint, ColinearConstraintComponent)) {
      return ColinearConstraintComponent.get(constraint);
    }
    throw new Error(`Constraint.get: unexpected constraint with id ${(constraint as any).id}`);
  }

  export function getOptional(geometry: Geometry): ConstraintData | undefined {
    if (Geometry.hasComponent(geometry, LinearConstraintComponent)) {
      return LinearConstraintComponent.get(geometry as Geometry<LinearConstraintComponent>);
    } else if (Geometry.hasComponent(geometry, HorizontalConstraintComponent)) {
      return HorizontalConstraintComponent.get(geometry as Geometry<HorizontalConstraintComponent>);
    } else if (Geometry.hasComponent(geometry, VerticalConstraintComponent)) {
      return VerticalConstraintComponent.get(geometry as Geometry<VerticalConstraintComponent>);
    } else if (Geometry.hasComponent(geometry, PerpendicularConstraintComponent)) {
      return PerpendicularConstraintComponent.get(
        geometry as Geometry<PerpendicularConstraintComponent>,
      );
    } else if (Geometry.hasComponent(geometry, ParallelConstraintComponent)) {
      return ParallelConstraintComponent.get(geometry as Geometry<ParallelConstraintComponent>);
    } else if (Geometry.hasComponent(geometry, ColinearConstraintComponent)) {
      return ColinearConstraintComponent.get(geometry as Geometry<ColinearConstraintComponent>);
    }
    return undefined;
  }

  export function update(constraint: Constraint, partial: Partial<ConstraintData>): Constraint {
    if (Geometry.hasComponent(constraint, LinearConstraintComponent)) {
      return LinearConstraintComponent.update(constraint, partial);
    } else if (Geometry.hasComponent(constraint, HorizontalConstraintComponent)) {
      return HorizontalConstraintComponent.update(constraint, partial);
    } else if (Geometry.hasComponent(constraint, VerticalConstraintComponent)) {
      return VerticalConstraintComponent.update(constraint, partial);
    } else if (Geometry.hasComponent(constraint, PerpendicularConstraintComponent)) {
      return PerpendicularConstraintComponent.update(constraint, partial);
    } else if (Geometry.hasComponent(constraint, ParallelConstraintComponent)) {
      return ParallelConstraintComponent.update(constraint, partial);
    } else if (Geometry.hasComponent(constraint, ColinearConstraintComponent)) {
      return ColinearConstraintComponent.update(constraint, partial);
    }
    throw new Error(`Constraint.update: unexpected constraint with id ${(constraint as any).id}`);
  }

  /** Update a single endpoint on a constraint by key name. Type-safe: the key must be valid
   *  for the constraint's component type at runtime (validated by internal dispatch). */
  export function updateEndpoint(
    constraint: Constraint,
    key: string,
    value: ConstraintEndpoint,
  ): Constraint {
    if (Geometry.hasComponent(constraint, LinearConstraintComponent)) {
      return LinearConstraintComponent.update(constraint, { [key]: value } as Partial<
        LinearConstraintComponent['linearConstraint']
      >);
    } else if (Geometry.hasComponent(constraint, HorizontalConstraintComponent)) {
      return HorizontalConstraintComponent.update(constraint, { [key]: value } as Partial<
        HorizontalConstraintComponent['horizontalConstraint']
      >);
    } else if (Geometry.hasComponent(constraint, VerticalConstraintComponent)) {
      return VerticalConstraintComponent.update(constraint, { [key]: value } as Partial<
        VerticalConstraintComponent['verticalConstraint']
      >);
    } else if (Geometry.hasComponent(constraint, PerpendicularConstraintComponent)) {
      return PerpendicularConstraintComponent.update(constraint, { [key]: value } as Partial<
        PerpendicularConstraintComponent['perpendicularConstraint']
      >);
    } else if (Geometry.hasComponent(constraint, ParallelConstraintComponent)) {
      return ParallelConstraintComponent.update(constraint, { [key]: value } as Partial<
        ParallelConstraintComponent['parallelConstraint']
      >);
    } else if (Geometry.hasComponent(constraint, ColinearConstraintComponent)) {
      return ColinearConstraintComponent.update(constraint, { [key]: value } as Partial<
        ColinearConstraintComponent['colinearConstraint']
      >);
    }
    throw new Error(
      `Constraint.updateEndpoint: unexpected constraint with id ${(constraint as any).id}`,
    );
  }

  /** Apply a partial update from a `Record<string, ConstraintEndpoint>` by matching keys to
   *  the constraint's component type at runtime. */
  export function updateEndpoints(
    constraint: Constraint,
    updates: Record<string, ConstraintEndpoint>,
  ): Constraint {
    if (Geometry.hasComponent(constraint, LinearConstraintComponent)) {
      return LinearConstraintComponent.update(
        constraint,
        updates as Partial<LinearConstraintComponent['linearConstraint']>,
      );
    } else if (Geometry.hasComponent(constraint, HorizontalConstraintComponent)) {
      return HorizontalConstraintComponent.update(
        constraint,
        updates as Partial<HorizontalConstraintComponent['horizontalConstraint']>,
      );
    } else if (Geometry.hasComponent(constraint, VerticalConstraintComponent)) {
      return VerticalConstraintComponent.update(
        constraint,
        updates as Partial<VerticalConstraintComponent['verticalConstraint']>,
      );
    } else if (Geometry.hasComponent(constraint, PerpendicularConstraintComponent)) {
      return PerpendicularConstraintComponent.update(
        constraint,
        updates as Partial<PerpendicularConstraintComponent['perpendicularConstraint']>,
      );
    } else if (Geometry.hasComponent(constraint, ParallelConstraintComponent)) {
      return ParallelConstraintComponent.update(
        constraint,
        updates as Partial<ParallelConstraintComponent['parallelConstraint']>,
      );
    } else if (Geometry.hasComponent(constraint, ColinearConstraintComponent)) {
      return ColinearConstraintComponent.update(
        constraint,
        updates as Partial<ColinearConstraintComponent['colinearConstraint']>,
      );
    }
    throw new Error(
      `Constraint.updateEndpoints: unexpected constraint with id ${(constraint as any).id}`,
    );
  }
}
