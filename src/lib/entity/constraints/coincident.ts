import { Constraint } from '.';
import { ConstraintComponent } from '../components/ConstraintComponent';
import { Entity, type Id } from '../types';
import { ConstraintEndpoint } from './constraint-endpoint';

/** A constraint which forces pointA and pointB to occupy the same sheet position. */
export type CoincidentConstraintData = {
  type: 'coincident';
  pointA: ConstraintEndpoint;
  pointB: ConstraintEndpoint;
};

export type CoincidentConstraint = Entity<ConstraintComponent<CoincidentConstraintData>>;

export type CoincidentConstraintTemplate = Omit<CoincidentConstraint, 'id'>;

export namespace CoincidentConstraint {
  export function create(
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
  ): CoincidentConstraintTemplate {
    return {
      components: {
        ...ConstraintComponent.create({
          type: 'coincident',
          pointA,
          pointB,
        }),
      },
    };
  }

  export function isCoincidentConstraint(maybe: Constraint): maybe is CoincidentConstraint {
    return ConstraintComponent.get(maybe).type === 'coincident';
  }

  export function isGeometryLockedTo(geom: Entity<ConstraintComponent>, geometryId: Id): boolean {
    const constraint = ConstraintComponent.get(geom);
    if (constraint.type !== 'coincident') {
      return false;
    }
    const attached = (ep: ConstraintEndpoint) => ep.type !== 'point' && ep.id === geometryId;
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
    if (constraint.type !== 'coincident') {
      return undefined;
    }
    if (pointKey === 'pointA' || pointKey === 'pointB') {
      return constraint[pointKey];
    }
    return undefined;
  }
}
