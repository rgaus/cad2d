import { HorizontalConstraintComponent } from '../components/HorizontalConstraintComponent';
import { Geometry } from '../types';
import { type Id } from '../types';
import { ConstraintEndpoint } from './constraint-endpoint';

export type HorizontalConstraint = Geometry<HorizontalConstraintComponent>;

export type HorizontalConstraintTemplate = Omit<HorizontalConstraint, 'id'>;

export namespace HorizontalConstraint {
  export function create(
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
  ): HorizontalConstraintTemplate {
    return {
      components: {
        ...HorizontalConstraintComponent.create(pointA, pointB),
      },
    };
  }

  export function isHorizontalConstraint(geometry: Geometry): geometry is HorizontalConstraint {
    return Geometry.hasComponent(geometry, HorizontalConstraintComponent);
  }

  export function isGeometryLockedTo(geometry: HorizontalConstraint, geometryId: Id): boolean {
    const data = HorizontalConstraintComponent.get(geometry);
    const attached = (ep: ConstraintEndpoint) => ep.type !== 'point' && ep.id === geometryId;
    return attached(data.pointA) || attached(data.pointB);
  }

  export function getPositionKeys(): Array<'pointA' | 'pointB'> {
    return ['pointA', 'pointB'];
  }
}
