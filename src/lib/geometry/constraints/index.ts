import { ColinearConstraintComponent } from '../components/ColinearConstraintComponent';
import { HorizontalConstraintComponent } from '../components/HorizontalConstraintComponent';
import { LinearConstraintComponent } from '../components/LinearConstraintComponent';
import { ParallelConstraintComponent } from '../components/ParallelConstraintComponent';
import { PerpendicularConstraintComponent } from '../components/PerpendicularConstraintComponent';
import { VerticalConstraintComponent } from '../components/VerticalConstraintComponent';
import { type Id } from '../types';
import { Geometry } from '../types';
import { ColinearConstraint, type ColinearConstraintTemplate } from './colinear';
import { computeConstrainedTracksForPoints } from './compute-constrained-tracks';
import { ConstraintEndpoint } from './constraint-endpoint';
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

function isGeometryLockedTo(constraint: Constraint, geometryId: Id): boolean {
  if (Geometry.hasComponent(constraint, LinearConstraintComponent)) {
    return LinearConstraint.isGeometryLockedTo(constraint, geometryId);
  } else if (Geometry.hasComponent(constraint, PerpendicularConstraintComponent)) {
    return PerpendicularConstraint.isGeometryLockedTo(constraint, geometryId);
  } else if (Geometry.hasComponent(constraint, ParallelConstraintComponent)) {
    return ParallelConstraint.isGeometryLockedTo(constraint, geometryId);
  } else if (Geometry.hasComponent(constraint, HorizontalConstraintComponent)) {
    return HorizontalConstraint.isGeometryLockedTo(constraint, geometryId);
  } else if (Geometry.hasComponent(constraint, VerticalConstraintComponent)) {
    return VerticalConstraint.isGeometryLockedTo(constraint, geometryId);
  } else if (Geometry.hasComponent(constraint, ColinearConstraintComponent)) {
    return ColinearConstraint.isGeometryLockedTo(constraint, geometryId);
  }
  constraint satisfies never;
  throw new Error(
    `isGeometryLockedTo: unexpected constraint type for id=${(constraint as any).id}`,
  );
}

function getPositionKeys(constraint: Constraint): Array<string> {
  if (Geometry.hasComponent(constraint, LinearConstraintComponent)) {
    return LinearConstraint.getPositionKeys();
  } else if (Geometry.hasComponent(constraint, PerpendicularConstraintComponent)) {
    return PerpendicularConstraint.getPositionKeys();
  } else if (Geometry.hasComponent(constraint, ParallelConstraintComponent)) {
    return ParallelConstraint.getPositionKeys();
  } else if (Geometry.hasComponent(constraint, HorizontalConstraintComponent)) {
    return HorizontalConstraint.getPositionKeys();
  } else if (Geometry.hasComponent(constraint, VerticalConstraintComponent)) {
    return VerticalConstraint.getPositionKeys();
  } else if (Geometry.hasComponent(constraint, ColinearConstraintComponent)) {
    return ColinearConstraint.getPositionKeys();
  }
  throw new Error(`getPositionKeys: unexpected constraint type for id=${(constraint as any).id}`);
}

/** Yields all ConstraintEndpoint values from a constraint Geometry. */
function *getContainingEndpoints(g: Geometry): Generator<[string, ConstraintEndpoint]> {
  if (Geometry.hasComponent(g, LinearConstraintComponent)) {
    const data = LinearConstraintComponent.get(g);
    yield ['pointA', data.pointA];
    yield ['pointB', data.pointB];
  } else if (Geometry.hasComponent(g, PerpendicularConstraintComponent)) {
    const data = PerpendicularConstraintComponent.get(g);
    yield ['pointA', data.pointA];
    yield ['pointCenter', data.pointCenter];
    yield ['pointB', data.pointB];
  } else if (Geometry.hasComponent(g, ParallelConstraintComponent)) {
    const data = ParallelConstraintComponent.get(g);
    yield ['pointA', data.pointA];
    yield ['pointB', data.pointB];
    yield ['pointC', data.pointC];
    yield ['pointD', data.pointD];
  } else if (Geometry.hasComponent(g, HorizontalConstraintComponent)) {
    const data = HorizontalConstraintComponent.get(g);
    yield ['pointA', data.pointA];
    yield ['pointB', data.pointB];
  } else if (Geometry.hasComponent(g, VerticalConstraintComponent)) {
    const data = VerticalConstraintComponent.get(g);
    yield ['pointA', data.pointA];
    yield ['pointB', data.pointB];
  } else if (Geometry.hasComponent(g, ColinearConstraintComponent)) {
    const data = ColinearConstraintComponent.get(g);
    yield ['pointTarget', data.pointTarget];
    yield ['pointA', data.pointA];
    yield ['pointB', data.pointB];
  }
}

export const Constraint = {
  computeConstrainedTracksForPoints,
  isGeometryLockedTo,
  getPositionKeys,
  getContainingEndpoints,
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
