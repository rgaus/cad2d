import { ConstraintComponent } from '../components/ConstraintComponent';
import { Entity, type Id } from '../types';
import { ColinearConstraint, ColinearConstraintData } from './colinear';
import { computeConstrainedTracksForPoints } from './compute-constrained-tracks';
import { ConstraintEndpoint } from './constraint-endpoint';
import { HorizontalConstraint, HorizontalConstraintData } from './horizontal';
import { LinearConstraint, LinearConstraintData } from './linear';
import { ParallelConstraint, ParallelConstraintData } from './parallel';
import { PerpendicularConstraint, PerpendicularConstraintData } from './perpendicular';
import { VerticalConstraint, VerticalConstraintData } from './vertical';

/** A discriminated union of all types of constraints. */
export type Constraint =
  | LinearConstraint
  | PerpendicularConstraint
  | ParallelConstraint
  | HorizontalConstraint
  | VerticalConstraint
  | ColinearConstraint;

function isGeometryLockedTo(geom: Entity<ConstraintComponent>, geometryId: Id): boolean {
  const constraint = ConstraintComponent.get(geom);
  switch (constraint.type) {
    case 'linear':
      return LinearConstraint.isGeometryLockedTo(geom, geometryId);
    case 'perpendicular':
      return PerpendicularConstraint.isGeometryLockedTo(geom, geometryId);
    case 'parallel':
      return ParallelConstraint.isGeometryLockedTo(geom, geometryId);
    case 'horizontal':
      return HorizontalConstraint.isGeometryLockedTo(geom, geometryId);
    case 'vertical':
      return VerticalConstraint.isGeometryLockedTo(geom, geometryId);
    case 'colinear':
      return ColinearConstraint.isGeometryLockedTo(geom, geometryId);
    default:
      constraint satisfies never;
      throw new Error(`isGeometryLockedTo: unexpected constraint type ${(constraint as any).type}`);
  }
}

function getPositionKeys(geom: Entity<ConstraintComponent>): Array<string> {
  const constraint = ConstraintComponent.get(geom);
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

function getEndpoint(
  geom: Entity<ConstraintComponent>,
  pointKey: string,
): ConstraintEndpoint | undefined {
  const constraint = ConstraintComponent.get(geom);
  switch (constraint.type) {
    case 'linear':
      return LinearConstraint.getEndpoint(geom, pointKey);
    case 'perpendicular':
      return PerpendicularConstraint.getEndpoint(geom, pointKey);
    case 'parallel':
      return ParallelConstraint.getEndpoint(geom, pointKey);
    case 'horizontal':
      return HorizontalConstraint.getEndpoint(geom, pointKey);
    case 'vertical':
      return VerticalConstraint.getEndpoint(geom, pointKey);
    case 'colinear':
      return ColinearConstraint.getEndpoint(geom, pointKey);
    default:
      constraint satisfies never;
      return undefined;
  }
}

export const Constraint = {
  computeConstrainedTracksForPoints,
  isGeometryLockedTo,
  getPositionKeys,
  getEndpoint,
};

export type ConstraintTemplate = Omit<Entity<ConstraintComponent>, 'id'>;

export type ConstraintData =
  | LinearConstraintData
  | PerpendicularConstraintData
  | ParallelConstraintData
  | HorizontalConstraintData
  | VerticalConstraintData
  | ColinearConstraintData;

export { ConstraintEndpoint } from './constraint-endpoint';

export {
  LinearConstraint,
  type LinearConstraintData,
  type LinearConstraintTemplate,
  LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
} from './linear';

export {
  PerpendicularConstraint,
  type PerpendicularConstraintData,
  type PerpendicularConstraintTemplate,
} from './perpendicular';

export {
  ParallelConstraint,
  type ParallelConstraintData,
  type ParallelConstraintTemplate,
} from './parallel';

export {
  HorizontalConstraint,
  type HorizontalConstraintData,
  type HorizontalConstraintTemplate,
} from './horizontal';

export {
  VerticalConstraint,
  type VerticalConstraintData,
  type VerticalConstraintTemplate,
} from './vertical';

export {
  ColinearConstraint,
  type ColinearConstraintData,
  type ColinearConstraintTemplate,
} from './colinear';

export { ConstrainedTrack, type ConstrainedTrackPath } from './compute-constrained-tracks';
