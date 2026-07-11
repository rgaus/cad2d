import { VerticalConstraintComponent } from '../components/VerticalConstraintComponent';
import { Geometry } from '../types';
import { type Id } from '../types';
import { ConstraintEndpoint } from './constraint-endpoint';

export type VerticalConstraint = Geometry<VerticalConstraintComponent>;

export type VerticalConstraintTemplate = Omit<VerticalConstraint, 'id'>;

export namespace VerticalConstraint {
  export function create(
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
  ): VerticalConstraintTemplate {
    return {
      components: {
        ...VerticalConstraintComponent.create(pointA, pointB),
      },
    };
  }

  export function isVerticalConstraint(geometry: Geometry): geometry is VerticalConstraint {
    return Geometry.hasComponent(geometry, VerticalConstraintComponent);
  }

  export function isGeometryLockedTo(geometry: VerticalConstraint, geometryId: Id): boolean {
    const data = VerticalConstraintComponent.get(geometry);
    const attached = (ep: ConstraintEndpoint) => ep.type !== 'point' && ep.id === geometryId;
    return attached(data.pointA) || attached(data.pointB);
  }

  export function getPositionKeys(): Array<'pointA' | 'pointB'> {
    return ['pointA', 'pointB'];
  }
}
