import { type Id } from '../types';
import { computeConstrainedTracksForPoints } from './compute-constrained-tracks';
import { ConstraintEndpoint } from './constraint-endpoint';
import { LinearConstraint, LinearConstraintTemplate } from './linear';
import { ParallelConstraint, ParallelConstraintTemplate } from './parallel';
import { PerpendicularConstraint, PerpendicularConstraintTemplate } from './perpendicular';

/** Maximum depth for recursive resolution of locked-constraint endpoint chains. */
export const CONSTRAINT_ENDPOINT_RESOLVE_MAX_DEPTH = 10_000;

/** A discriminated union of all types of constraints. */
export type Constraint = LinearConstraint | PerpendicularConstraint | ParallelConstraint;

function isGeometryLockedTo(constraint: Constraint, geometryId: Id): boolean {
  switch (constraint.type) {
    case 'linear':
      return LinearConstraint.isGeometryLockedTo(constraint, geometryId);
    case 'perpendicular':
      return PerpendicularConstraint.isGeometryLockedTo(constraint, geometryId);
    case 'parallel':
      return ParallelConstraint.isGeometryLockedTo(constraint, geometryId);
    default:
      constraint satisfies never;
      throw new Error(`isGeometryLockedTo: unexpected constraint type ${(constraint as any).type}`);
  }
}

function getPositionKeys(constraint: Constraint): Array<string> {
  switch (constraint.type) {
    case 'linear':
      return LinearConstraint.getPositionKeys();
    case 'perpendicular':
      return PerpendicularConstraint.getPositionKeys();
    case 'parallel':
      return ParallelConstraint.getPositionKeys();
    default:
      constraint satisfies never;
      throw new Error(`getPositionKeys: unexpected constraint type ${(constraint as any).type}`);
  }
}

function getEndpoint(constraint: Constraint, key: string): ConstraintEndpoint | null {
  switch (constraint.type) {
    case 'linear':
      return LinearConstraint.getEndpoint(constraint, key);
    case 'perpendicular':
      return PerpendicularConstraint.getEndpoint(constraint, key);
    case 'parallel':
      return ParallelConstraint.getEndpoint(constraint, key);
    default:
      constraint satisfies never;
      throw new Error(`getEndpoint: unexpected constraint type ${(constraint as any).type}`);
  }
}

export const Constraint = {
  computeConstrainedTracksForPoints,
  isGeometryLockedTo,
  getPositionKeys,
  getEndpoint,
};

export type ConstraintTemplate =
  | LinearConstraintTemplate
  | PerpendicularConstraintTemplate
  | ParallelConstraintTemplate;

export { ConstraintEndpoint } from './constraint-endpoint';

export {
  LinearConstraint,
  type LinearConstraintTemplate,
  LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
} from './linear';

export { PerpendicularConstraint, type PerpendicularConstraintTemplate } from './perpendicular';

export { ParallelConstraint, type ParallelConstraintTemplate } from './parallel';

export { ConstrainedTrack, type ConstrainedTrackPath } from './compute-constrained-tracks';
