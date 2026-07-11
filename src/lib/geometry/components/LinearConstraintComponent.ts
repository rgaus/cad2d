import { type Length } from '@/lib/units/length';
import { ConstraintEndpoint } from '../constraints/constraint-endpoint';
import { type Id } from '../types';
import { Geometry, type GeometryComponent } from '../types';

/** The default distance (in px) that the linear offset label is offset from the connector line
 * between pointA and pointB. */
export const LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX = -12;

export type LinearConstraintComponent = GeometryComponent<
  'linearConstraint',
  {
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
  }
>;

export namespace LinearConstraintComponent {
  export const key: keyof LinearConstraintComponent = 'linearConstraint';

  export function create(
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
    constrainedLength: Length,
    options?: {
      connectorLineOffsetPx?: number;
      axis?: 'x' | 'y' | null;
    },
  ): LinearConstraintComponent {
    return {
      linearConstraint: {
        pointA,
        pointB,
        constrainedLength,
        connectorLineOffsetPx:
          options?.connectorLineOffsetPx ?? LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
        axis: options?.axis ?? null,
      },
    };
  }

  export function get(
    geometry: Geometry<LinearConstraintComponent>,
  ): LinearConstraintComponent['linearConstraint'] {
    return geometry.components.linearConstraint;
  }

  export function update(
    geometry: Geometry<LinearConstraintComponent>,
    partial: Partial<LinearConstraintComponent['linearConstraint']>,
  ): Geometry<LinearConstraintComponent> {
    return {
      ...geometry,
      components: {
        ...geometry.components,
        linearConstraint: {
          ...geometry.components.linearConstraint,
          ...partial,
        },
      },
    };
  }

  export function isGeometryLockedTo(
    constraint: Geometry<LinearConstraintComponent>,
    geometryId: Id,
  ): boolean {
    const data = get(constraint);
    const attached = (ep: ConstraintEndpoint) =>
      (ep.type === 'locked-rectangle' ||
        ep.type === 'locked-ellipse' ||
        ep.type === 'locked-polygon' ||
        ep.type === 'locked-datum') &&
      ep.id === geometryId;
    return attached(data.pointA) || attached(data.pointB);
  }

  export function getPositionKeys(): Array<'pointA' | 'pointB'> {
    return ['pointA', 'pointB'];
  }
}
