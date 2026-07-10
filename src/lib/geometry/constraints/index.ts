import { type Id } from '../types';
import { ColinearConstraint, ColinearConstraintTemplate } from './colinear';
import { computeConstrainedTracksForPoints } from './compute-constrained-tracks';
import { HorizontalConstraint, HorizontalConstraintTemplate } from './horizontal';
import { LinearConstraint, LinearConstraintTemplate } from './linear';
import { ParallelConstraint, ParallelConstraintTemplate } from './parallel';
import { PerpendicularConstraint, PerpendicularConstraintTemplate } from './perpendicular';
import { VerticalConstraint, VerticalConstraintTemplate } from './vertical';

/** A discriminated union of all types of constraints. */
export type Constraint =
  | LinearConstraint
  | PerpendicularConstraint
  | ParallelConstraint
  | HorizontalConstraint
  | VerticalConstraint
  | ColinearConstraint;

function isGeometryLockedTo(constraint: Constraint, geometryId: Id): boolean {
  switch (constraint.type) {
    case 'linear':
      return LinearConstraint.isGeometryLockedTo(constraint, geometryId);
    case 'perpendicular':
      return PerpendicularConstraint.isGeometryLockedTo(constraint, geometryId);
    case 'parallel':
      return ParallelConstraint.isGeometryLockedTo(constraint, geometryId);
    case 'horizontal':
      return HorizontalConstraint.isGeometryLockedTo(constraint, geometryId);
    case 'vertical':
      return VerticalConstraint.isGeometryLockedTo(constraint, geometryId);
    case 'colinear':
      return ColinearConstraint.isGeometryLockedTo(constraint, geometryId);
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
    case 'horizontal':
      return HorizontalConstraint.getPositionKeys();
    case 'vertical':
      return VerticalConstraint.getPositionKeys();
    case 'colinear':
      return ColinearConstraint.getPositionKeys();
    default:
      constraint satisfies never;
      throw new Error(`getPositionKeys: unexpected constraint type ${(constraint as any).type}`);
  }
}

export const Constraint = {
  computeConstrainedTracksForPoints,
  isGeometryLockedTo,
  getPositionKeys,
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
