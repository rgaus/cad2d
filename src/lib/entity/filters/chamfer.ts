import { Length } from '@/lib/units/length';
import type { UnitType } from '@/lib/units/length';
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

  /**
   * Serializes chamfer filter data to a JSON-safe object for storage in the
   * cad2d-state SVG comment.
   */
  export function toJson(data: ChamferFilterData) {
    if (data.geometryType === 'polygon') {
      return {
        type: 'chamfer' as const,
        geometryType: 'polygon' as const,
        geometryId: data.geometryId,
        offset: { magnitude: data.offset.magnitude, type: data.offset.type },
        pointAIndex: data.pointAIndex,
        pointCenterIndex: data.pointCenterIndex,
        pointBIndex: data.pointBIndex,
      };
    } else {
      return {
        type: 'chamfer' as const,
        geometryType: 'rectangle' as const,
        geometryId: data.geometryId,
        offset: { magnitude: data.offset.magnitude, type: data.offset.type },
        pointAKeyPoint: data.pointAKeyPoint,
        pointCenterKeyPoint: data.pointCenterKeyPoint,
        pointBKeyPoint: data.pointBKeyPoint,
      };
    }
  }

  /**
   * Deserializes a chamfer filter data object from JSON.
   */
  export function fromJson(json: Record<string, unknown>): ChamferFilterData {
    const offsetData = json.offset as { magnitude: number; type: string };
    const offset = Length.fromSheetUnits(offsetData.type as UnitType, offsetData.magnitude);
    if (json.geometryType === 'polygon') {
      return {
        type: 'chamfer',
        offset,
        geometryType: 'polygon',
        geometryId: json.geometryId as string,
        pointAIndex: json.pointAIndex as number,
        pointCenterIndex: json.pointCenterIndex as number,
        pointBIndex: json.pointBIndex as number,
      };
    } else {
      return {
        type: 'chamfer',
        offset,
        geometryType: 'rectangle',
        geometryId: json.geometryId as string,
        pointAKeyPoint: json.pointAKeyPoint as RectangleEndpoint,
        pointCenterKeyPoint: json.pointCenterKeyPoint as RectangleEndpoint,
        pointBKeyPoint: json.pointBKeyPoint as RectangleEndpoint,
      };
    }
  }
}

export type ChamferFilter = Entity<FilterComponent<ChamferFilterData>>;

export type ChamferFilterTemplate = Omit<Entity<FilterComponent<ChamferFilterData>>, 'id'>;
