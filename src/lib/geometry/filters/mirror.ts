import { Geometry, type Polygon } from '@/lib/geometry';
import { SheetPosition } from '@/lib/viewport/types';
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
    geometryId: Geometry['id'],
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

export type MirrorFilter = Geometry<FilterComponent<MirrorFilterData>>;

export type MirrorFilterTemplate = Omit<Geometry<FilterComponent<MirrorFilterData>>, 'id'>;
