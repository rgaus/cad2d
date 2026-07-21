import { SheetPosition } from '@/lib/viewport/types';
import { Entity, type Polygon } from '..';
import { FilterComponent } from '../components/FilterComponent';

export type MirrorFilterData = {
  type: 'mirror';
  geometryId: Polygon['id'];
  pointA: SheetPosition;
  pointB: SheetPosition;
};

export namespace MirrorFilter {
  /** Creates a new mirror filter associated with a single geoemtry and a line made up of pointA/pointB . */
  export function create(
    geometryId: Entity['id'],
    pointA: SheetPosition,
    pointB: SheetPosition,
  ): MirrorFilterTemplate {
    return {
      components: FilterComponent.create({
        type: 'mirror',
        geometryId,
        pointA,
        pointB,
      }),
    };
  }
}

export type MirrorFilter = Entity<FilterComponent<MirrorFilterData>>;

export type MirrorFilterTemplate = Omit<Entity<FilterComponent<MirrorFilterData>>, 'id'>;
