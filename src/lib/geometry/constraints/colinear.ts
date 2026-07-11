import { ColinearConstraintComponent } from '../components/ColinearConstraintComponent';
import { Geometry } from '../types';
import { type Id } from '../types';
import { ConstraintEndpoint } from './constraint-endpoint';

export type ColinearConstraint = Geometry<ColinearConstraintComponent>;

export type ColinearConstraintTemplate = Omit<ColinearConstraint, 'id'>;

export namespace ColinearConstraint {
  export function create(
    pointTarget: ConstraintEndpoint,
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
  ): ColinearConstraintTemplate {
    return {
      components: {
        ...ColinearConstraintComponent.create(pointTarget, pointA, pointB),
      },
    };
  }

  export function isColinearConstraint(geometry: Geometry): geometry is ColinearConstraint {
    return Geometry.hasComponent(geometry, ColinearConstraintComponent);
  }

  export function isGeometryLockedTo(geometry: ColinearConstraint, geometryId: Id): boolean {
    const data = ColinearConstraintComponent.get(geometry);
    const attached = (ep: ConstraintEndpoint) => ep.type !== 'point' && ep.id === geometryId;
    return attached(data.pointTarget) || attached(data.pointA) || attached(data.pointB);
  }

  export function getPositionKeys(): Array<'pointTarget' | 'pointA' | 'pointB'> {
    return ['pointTarget', 'pointA', 'pointB'];
  }
}
