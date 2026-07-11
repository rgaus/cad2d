import { ColinearConstraintComponent } from '../components/ColinearConstraintComponent';
import { HorizontalConstraintComponent } from '../components/HorizontalConstraintComponent';
import { LinearConstraintComponent } from '../components/LinearConstraintComponent';
import { ParallelConstraintComponent } from '../components/ParallelConstraintComponent';
import { PerpendicularConstraintComponent } from '../components/PerpendicularConstraintComponent';
import { VerticalConstraintComponent } from '../components/VerticalConstraintComponent';
import { Geometry } from '../types';
import { ColinearConstraint, type ColinearConstraintTemplate } from './colinear';
import { computeConstrainedTracksForPoints } from './compute-constrained-tracks';
import { HorizontalConstraint, type HorizontalConstraintTemplate } from './horizontal';
import { LinearConstraint, type LinearConstraintTemplate } from './linear';
import { ParallelConstraint, type ParallelConstraintTemplate } from './parallel';
import { PerpendicularConstraint, type PerpendicularConstraintTemplate } from './perpendicular';
import { VerticalConstraint, type VerticalConstraintTemplate } from './vertical';

/** A discriminated union of all types of constraints. */
export type Constraint =
  | LinearConstraint
  | PerpendicularConstraint
  | ParallelConstraint
  | HorizontalConstraint
  | VerticalConstraint
  | ColinearConstraint;

export const Constraint = {
  computeConstrainedTracksForPoints,
};

export type ConstraintTemplate =
  | LinearConstraintTemplate
  | PerpendicularConstraintTemplate
  | ParallelConstraintTemplate
  | HorizontalConstraintTemplate
  | VerticalConstraintTemplate
  | ColinearConstraintTemplate;

export { ConstraintEndpoint } from './constraint-endpoint';

export { LinearConstraint, type LinearConstraintTemplate } from './linear';
export { PerpendicularConstraint, type PerpendicularConstraintTemplate } from './perpendicular';
export { ParallelConstraint, type ParallelConstraintTemplate } from './parallel';
export { HorizontalConstraint, type HorizontalConstraintTemplate } from './horizontal';
export { VerticalConstraint, type VerticalConstraintTemplate } from './vertical';
export { ColinearConstraint, type ColinearConstraintTemplate } from './colinear';

export {
  computeConstrainedTracksForPoints,
  ConstrainedTrack,
  type ConstrainedTrackPath,
} from './compute-constrained-tracks';

export {
  LinearConstraintComponent,
  LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
} from '../components/LinearConstraintComponent';
export { PerpendicularConstraintComponent } from '../components/PerpendicularConstraintComponent';
export { ParallelConstraintComponent } from '../components/ParallelConstraintComponent';
export { HorizontalConstraintComponent } from '../components/HorizontalConstraintComponent';
export { VerticalConstraintComponent } from '../components/VerticalConstraintComponent';
export { ColinearConstraintComponent } from '../components/ColinearConstraintComponent';
export { ConstraintComponent, type ConstraintData } from '../components/ConstraintComponent';
