import { Length } from "@/lib/units/length";
import { FilterComponent } from "../components/FilterComponent";
import { ConstraintEndpoint } from "@/lib/geometry/constraints";
import { Geometry, type Polygon, type Rectangle, RectangleEndpoint } from '@/lib/geometry';

export type FilletFilterData = {
  type: 'fillet';
  offset: Length;
  geometryType: 'polygon';
  geometryId: Polygon['id'];
  pointAIndex: number;
  pointCenterIndex: number;
  pointBIndex: number;
} | {
  type: 'fillet';
  offset: Length;
  geometryType: 'rectangle';
  geometryId: Rectangle['id'];
  pointAKeyPoint: RectangleEndpoint;
  pointCenterKeyPoint: RectangleEndpoint;
  pointBKeyPoint: RectangleEndpoint;
};

export type MirrorFilterData = {
  type: 'mirror';
  geometryId: Geometry['id'];
  pointA: ConstraintEndpoint;
  pointB: ConstraintEndpoint;
};

export type FilterData =
  | FilletFilterData
  | MirrorFilterData;

// FILLET FILTER START

export namespace FilletFilter {
  /** Creates a new fillet filter associated with a polygon's vertex. */
  export function createOnPolygon(
    polygonId: Polygon["id"],
    pointAIndex: number,
    pointCenterIndex: number,
    pointBIndex: number,
    offset: Length,
  ): FilletFilterTemplate {
    return {
      components: FilterComponent.create({
        type: 'fillet',
        offset,

        geometryType: 'polygon',
        geometryId: polygonId,
        pointAIndex,
        pointCenterIndex,
        pointBIndex,
      }),
    };
  }

  /** Creates a new fillet filter associated with a rectangle's corner key points. */
  export function createOnRectangle(
    rectangleId: Rectangle["id"],
    pointAKeyPoint: RectangleEndpoint,
    pointCenterKeyPoint: RectangleEndpoint,
    pointBKeyPoint: RectangleEndpoint,
    offset: Length,
  ): FilletFilterTemplate {
    return {
      components: FilterComponent.create({
        type: 'fillet',
        offset,

        geometryType: 'rectangle',
        geometryId: rectangleId,
        pointAKeyPoint,
        pointCenterKeyPoint,
        pointBKeyPoint,
      }),
    };
  }
}

export type FilletFilter = Geometry<FilterComponent<FilletFilterData>>;

export type FilletFilterTemplate = Omit<Geometry<FilterComponent<FilletFilterData>>, 'id'>;

// FILLET FILTER END

export type Filter = Geometry<FilterComponent>;

export type FilterTemplate = Omit<Geometry<FilterComponent>, 'id'>;
