import { LinearConstraint, LinearConstraintTemplate } from './linear';

/** A discriminated union of all types of constraints (ie, {@link LinearConstraint}) */
export type Constraint = LinearConstraint;

export type ConstraintTemplate = LinearConstraintTemplate;

export { ConstraintEndpoint } from './constraint-endpoint';

export {
  LinearConstraint,
  type LinearConstraintTemplate,
  LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
} from './linear';
