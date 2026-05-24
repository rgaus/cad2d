import { LinearConstraint } from './linear';
import { type ConstraintEndpoint } from './types';

/** A discriminated union of all types of constraints (ie, {@link LinearConstraint}) */
export type Constraint =
  | LinearConstraint;

/** Deep equality check for two ConstraintEndpoint values. */
export function constraintEndpointsEqual(a: ConstraintEndpoint, b: ConstraintEndpoint): boolean {
  if (a.type !== b.type) {
    return false;
  }
  switch (a.type) {
    case "point":
      return b.type === "point" && a.point.x === b.point.x && a.point.y === b.point.y;
    case "locked-rectangle":
      return b.type === "locked-rectangle" && a.id === b.id && a.point === b.point;
    case "locked-ellipse":
      return b.type === "locked-ellipse" && a.id === b.id && a.point === b.point;
    case "locked-polygon":
      return b.type === "locked-polygon" && a.id === b.id && a.pointIndex === b.pointIndex;
  }
}

export {
  type RectangleEndpoint,
  type EllipseEndpoint,
  type ConstraintEndpoint,
} from './types';

export {
  LinearConstraint,
  LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
} from './linear';
