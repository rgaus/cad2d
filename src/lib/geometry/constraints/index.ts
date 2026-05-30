import { computeConstrainedTracksForPoints } from './compute-constrained-tracks';
import { LinearConstraint, LinearConstraintTemplate } from './linear';

/** A discriminated union of all types of constraints (ie, {@link LinearConstraint}) */
export type Constraint = LinearConstraint;

export const Constraint = {
  computeConstrainedTracksForPoints,
};

export type ConstraintTemplate = LinearConstraintTemplate;

export { ConstraintEndpoint } from './constraint-endpoint';

export {
  LinearConstraint,
  type LinearConstraintTemplate,
  LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
} from './linear';

export { ConstrainedTrack, type ConstrainedTrackPath } from './compute-constrained-tracks';
