import { Constraint } from '../constraints';
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
}
