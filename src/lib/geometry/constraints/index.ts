import { type Id } from '../types';
import { computeConstrainedTracksForPoints } from './compute-constrained-tracks';
import { LinearConstraint, LinearConstraintTemplate } from './linear';
import { PerpendicularConstraint, PerpendicularConstraintTemplate } from './perpendicular';

/** A discriminated union of all types of constraints. */
export type Constraint = LinearConstraint | PerpendicularConstraint;

function isGeometryLockedTo(constraint: Constraint, geometryId: Id): boolean {
  switch (constraint.type) {
    case 'linear':
      return LinearConstraint.isGeometryLockedTo(constraint, geometryId);
    case 'perpendicular':
      return PerpendicularConstraint.isGeometryLockedTo(constraint, geometryId);
  }
}

function getPositionKeys(constraint: Constraint): Array<string> {
  switch (constraint.type) {
    case 'linear':
      return LinearConstraint.getPositionKeys();
    case 'perpendicular':
      return PerpendicularConstraint.getPositionKeys();
  }
}

export const Constraint = {
  computeConstrainedTracksForPoints,
  isGeometryLockedTo,
  getPositionKeys,
};

export type ConstraintTemplate = LinearConstraintTemplate | PerpendicularConstraintTemplate;

export { ConstraintEndpoint } from './constraint-endpoint';

export {
  LinearConstraint,
  type LinearConstraintTemplate,
  LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
} from './linear';

export {
  PerpendicularConstraint,
  type PerpendicularConstraintTemplate,
} from './perpendicular';

export { ConstrainedTrack, type ConstrainedTrackPath } from './compute-constrained-tracks';
