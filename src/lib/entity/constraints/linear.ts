import { Length } from '@/lib/units/length';
import { Constraint } from '.';
import { ConstraintComponent } from '../components/ConstraintComponent';
import { Entity, type Id } from '../types';
import { ConstraintEndpoint } from './constraint-endpoint';

/** The default distance (in px) that the linear offset label is offset from the connector line
 * between pointA and pointB. */
export const LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX = -12;

export type LinearConstraintData = {
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

export type LinearConstraint = Entity<ConstraintComponent<LinearConstraintData>>;

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
      components: {
        ...ConstraintComponent.create({
          type: 'linear',
          pointA,
          pointB,
          constrainedLength: length,
          connectorLineOffsetPx:
            options?.connectorLineOffsetPx ?? LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
          axis: options?.axis ?? null,
        }),
      },
    };
  }

  export function isLinearConstraint(
    maybeLinearConstraint: Constraint,
  ): maybeLinearConstraint is LinearConstraint {
    return ConstraintComponent.get(maybeLinearConstraint).type === 'linear';
  }

  export function isGeometryLockedTo(geom: Entity<ConstraintComponent>, geometryId: Id): boolean {
    const constraint = ConstraintComponent.get(geom);
    if (constraint.type !== 'linear') {
      return false;
    }
    const attached = (ep: ConstraintEndpoint) =>
      (ep.type === 'locked-rectangle' ||
        ep.type === 'locked-ellipse' ||
        ep.type === 'locked-polygon' ||
        ep.type === 'locked-datum') &&
      ep.id === geometryId;
    return attached(constraint.pointA) || attached(constraint.pointB);
  }

  export function getPositionKeys(): Array<'pointA' | 'pointB'> {
    return ['pointA', 'pointB'];
  }

  export function getEndpoint(
    geometry: Entity<ConstraintComponent>,
    pointKey: string,
  ): ConstraintEndpoint | undefined {
    const constraint = ConstraintComponent.get(geometry);
    if (constraint.type !== 'linear') {
      return undefined;
    }
    if (pointKey === 'pointA' || pointKey === 'pointB') {
      return constraint[pointKey];
    }
    return undefined;
  }
}
