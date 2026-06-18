import { computeConstrainedTracksForPoints } from './compute-constrained-tracks';
import { LinearConstraint, LinearConstraintTemplate } from './linear';
import { AngularConstraint, AngularConstraintTemplate } from './angular';

/** A discriminated union of all types of constraints (ie, {@link LinearConstraint}) */
export type Constraint = LinearConstraint | AngularConstraint;

export const Constraint = {
  computeConstrainedTracksForPoints,
};

export type ConstraintTemplate = LinearConstraintTemplate | AngularConstraintTemplate;

export { ConstraintEndpoint } from './constraint-endpoint';

export {
  LinearConstraint,
  type LinearConstraintTemplate,
  LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
} from './linear';

export {
  AngularConstraint,
  type AngularConstraintTemplate,
} from './angular';

export { ConstrainedTrack, type ConstrainedTrackPath } from './compute-constrained-tracks';
