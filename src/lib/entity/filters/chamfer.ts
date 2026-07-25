import { Length } from '@/lib/units/length';
import { Entity, type Polygon, type Rectangle, RectangleEndpoint } from '..';
import { FilterComponent } from '../components/FilterComponent';

export type ChamferFilterData =
  | {
      type: 'chamfer';
      offset: Length;
      geometryType: 'polygon';
      geometryId: Polygon['id'];
      pointAIndex: number;
      pointCenterIndex: number;
      pointBIndex: number;
    }
  | {
      type: 'chamfer';
      offset: Length;
      geometryType: 'rectangle';
      geometryId: Rectangle['id'];
      pointAKeyPoint: RectangleEndpoint;
      pointCenterKeyPoint: RectangleEndpoint;
      pointBKeyPoint: RectangleEndpoint;
    };

export namespace ChamferFilter {
  /** Creates a new chamfer filter associated with a polygon's vertex. */
  export function createOnPolygon(
    polygonId: Polygon['id'],
    pointAIndex: number,
    pointCenterIndex: number,
    pointBIndex: number,
    offset: Length,
  ): ChamferFilterTemplate {
    return {
      components: FilterComponent.create({
        type: 'chamfer',
        offset,

        geometryType: 'polygon',
        geometryId: polygonId,
        pointAIndex,
        pointCenterIndex,
        pointBIndex,
      }),
    };
  }

  /** Creates a new chamfer filter associated with a rectangle's corner key points. */
  export function createOnRectangle(
    rectangleId: Rectangle['id'],
    pointAKeyPoint: RectangleEndpoint,
    pointCenterKeyPoint: RectangleEndpoint,
    pointBKeyPoint: RectangleEndpoint,
    offset: Length,
  ): ChamferFilterTemplate {
    return {
      components: FilterComponent.create({
        type: 'chamfer',
        offset,

        geometryType: 'rectangle',
        geometryId: rectangleId,
        pointAKeyPoint,
        pointCenterKeyPoint,
        pointBKeyPoint,
      }),
    };
  }

  export function equals(
    a: Entity<FilterComponent<ChamferFilterData>>,
    b: Entity<FilterComponent>,
  ) {
    const aData = FilterComponent.get(a);
    const bData = FilterComponent.get(b);
    if (bData.type !== 'fillet') {
      return false;
    }
    return (
      aData.geometryId === bData.geometryId &&
      aData.geometryType === bData.geometryType &&
      aData.offset.type === bData.offset.type &&
      aData.offset.magnitude === bData.offset.magnitude
    );
  }
}

export type ChamferFilter = Entity<FilterComponent<ChamferFilterData>>;

export type ChamferFilterTemplate = Omit<Entity<FilterComponent<ChamferFilterData>>, 'id'>;
