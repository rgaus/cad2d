import { Length } from '@/lib/units/length';
import { Constraint } from '.';
import { type Id } from '../types';
import { ConstraintEndpoint } from './constraint-endpoint';

/** The default distance (in px) that the linear offset label is offset from the connector line
 * between pointA and pointB. */
export const LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX = -12;

export type LinearConstraint = {
  id: Id;
  type: 'linear';
  pointA: ConstraintEndpoint;
  pointB: ConstraintEndpoint;
  constrainedLength: Length;

  /** Offset in pixels of the line connecting the two points together. This is relative to the line
   * connecting pointA / pointB together - negative goes on one side, positive the other. */
  connectorLineOffsetPx: number;

  /** When set, the constraint applies to only one axis component of the
   *  distance between pointA and pointB rather than the full diagonal.
   *  'x' = horizontal component only, 'y' = vertical component only, null = full distance. */
  axis: 'x' | 'y' | null;
};

export type LinearConstraintTemplate = Omit<LinearConstraint, 'id'>;

export namespace LinearConstraint {
  export function create(
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
    length: Length,
    options?: {
      connectorLineOffsetPx?: number;
      axis?: 'x' | 'y' | null;
    },
  ): LinearConstraintTemplate {
    return {
      type: 'linear',
      pointA,
      pointB,
      constrainedLength: length,
      connectorLineOffsetPx:
        options?.connectorLineOffsetPx ?? LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
      axis: options?.axis ?? null,
    };
  }

  export function isLinearConstraint(
    maybeLinearConstraint: Constraint,
  ): maybeLinearConstraint is LinearConstraint {
    return maybeLinearConstraint.type === 'linear';
  }

  export function isGeometryLockedTo(constraint: LinearConstraint, geometryId: Id): boolean {
    const attached = (ep: ConstraintEndpoint) =>
      (ep.type === 'locked-rectangle' ||
        ep.type === 'locked-ellipse' ||
        ep.type === 'locked-polygon') &&
      ep.id === geometryId;
    return attached(constraint.pointA) || attached(constraint.pointB);
  }

  export function getPositionKeys(): Array<'pointA' | 'pointB'> {
    return ['pointA', 'pointB'];
  }
}
