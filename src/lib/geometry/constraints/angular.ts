import { Angle } from '@/lib/units/angle';
import { type Id } from '../types';
import { ConstraintEndpoint } from './constraint-endpoint';
import { Constraint } from '.';

/** The default distance (in px) that the linear offset label is offset from the connector line
 * between pointA and pointB. */
export const LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX = -12;

export type AngularConstraint = {
  id: Id;
  type: 'angular';
  pointA: ConstraintEndpoint;
  pointCenter: ConstraintEndpoint;
  pointC: ConstraintEndpoint;
  angle: Angle;
};

export type AngularConstraintTemplate = Omit<AngularConstraint, 'id'>;

export namespace AngularConstraint {
  export function create(
    pointA: ConstraintEndpoint,
    pointCenter: ConstraintEndpoint,
    pointC: ConstraintEndpoint,
    angle: Angle,
  ): AngularConstraintTemplate {
    return {
      type: 'angular',
      pointA,
      pointCenter,
      pointC,
      angle,
    };
  }

  export function isAngularConstraint(maybeAngularConstraint: Constraint): maybeAngularConstraint is AngularConstraint {
    return maybeAngularConstraint.type === 'angular';
  }
}
