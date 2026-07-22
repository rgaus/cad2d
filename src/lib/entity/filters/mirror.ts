import { closestPointOnSegment } from '@/lib/math';
import { SheetPosition } from '@/lib/viewport/types';
import { Entity, type Polygon, PolygonSegment } from '..';
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

  /** Given a polygon segment path for an open polygon, returns true if the polygon segment path
   * should be mirrored across the line due to the points touching the mirror line directly. */
  export function arePolygonEndpointsOnMirrorLine<
    F extends {
      pointA: SheetPosition | null;
      pointB: SheetPosition | null;
    },
  >(filterData: F, points: Array<PolygonSegment>): boolean {
    if (points.length < 2 || !filterData.pointA || !filterData.pointB) {
      return false;
    }

    const firstPoint = points[0].point;
    const firstPointResult = closestPointOnSegment(
      filterData.pointA,
      filterData.pointB,
      firstPoint,
    );
    const firstPointOnMirrorLine =
      firstPointResult.distance === 0 && firstPointResult.t > 0 && firstPointResult.t < 1;

    if (!firstPointOnMirrorLine) {
      return false;
    }

    const lastPoint = points.at(-1)!.point;
    const lastPointResult = closestPointOnSegment(filterData.pointA, filterData.pointB, lastPoint);
    const lastPointOnMirrorLine =
      lastPointResult.distance === 0 && lastPointResult.t > 0 && lastPointResult.t < 1;

    if (!lastPointOnMirrorLine) {
      return false;
    }

    return true;
  }
}

export type MirrorFilter = Entity<FilterComponent<MirrorFilterData>>;

export type MirrorFilterTemplate = Omit<Entity<FilterComponent<MirrorFilterData>>, 'id'>;
