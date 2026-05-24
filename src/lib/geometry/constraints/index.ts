import { LinearConstraint } from './linear';

/** A discriminated union of all types of constraints (ie, {@link LinearConstraint}) */
export type Constraint =
  | LinearConstraint;

export {
  type RectangleEndpoint,
  type EllipseEndpoint,
  type ConstraintEndpoint,
} from './types';

export {
  LinearConstraint,
  LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
} from './linear';
