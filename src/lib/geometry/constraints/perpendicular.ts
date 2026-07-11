import { PerpendicularConstraintComponent } from '../components/PerpendicularConstraintComponent';
import { Geometry } from '../types';
import { type Id } from '../types';
import { ConstraintEndpoint } from './constraint-endpoint';

export type PerpendicularConstraint = Geometry<PerpendicularConstraintComponent>;

export type PerpendicularConstraintTemplate = Omit<PerpendicularConstraint, 'id'>;

export namespace PerpendicularConstraint {
  export function create(
    pointA: ConstraintEndpoint,
    pointCenter: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
  ): PerpendicularConstraintTemplate {
    return {
      components: {
        ...PerpendicularConstraintComponent.create(pointA, pointCenter, pointB),
      },
    };
  }

  export function isPerpendicularConstraint(
    geometry: Geometry,
  ): geometry is PerpendicularConstraint {
    return Geometry.hasComponent(geometry, PerpendicularConstraintComponent);
  }

  export function isGeometryLockedTo(geometry: PerpendicularConstraint, geometryId: Id): boolean {
    const data = PerpendicularConstraintComponent.get(geometry);
    const attached = (ep: ConstraintEndpoint) =>
      (ep.type === 'locked-rectangle' ||
        ep.type === 'locked-ellipse' ||
        ep.type === 'locked-polygon' ||
        ep.type === 'locked-datum') &&
      ep.id === geometryId;
    return attached(data.pointA) || attached(data.pointCenter) || attached(data.pointB);
  }

  export function getPositionKeys(): Array<'pointA' | 'pointCenter' | 'pointB'> {
    return ['pointA', 'pointCenter', 'pointB'];
  }
}
