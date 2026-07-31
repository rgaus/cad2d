import { BoundingBox } from '@/lib/math';
import { type UnitType } from '@/lib/units/length';
import { KeyPoints, Rect, SheetPosition } from '@/lib/viewport/types';
import { FilletFilter, Filter, FilterData } from '../filters';
import { MirrorFilter } from '../filters/mirror';
import { PatternFilter } from '../filters/pattern';
import { type Geometry, type GeometryData } from '../geometry';
import { EllipseData } from '../geometry/ellipse';
import { PolygonData, PolygonSegment } from '../geometry/polygon';
import { RectangleData } from '../geometry/rectangle';
import { type Entity, type EntityComponent, ResizeParams } from '../types';
import { ConstraintComponent } from './ConstraintComponent';
import { FilterComponent } from './FilterComponent';
import { FrameComponent } from './FrameComponent';

export type RenderShapePolygon = {
  shape: 'polygon';
  key: string;
  primary: boolean;
  points: Array<PolygonSegment>;
  closed: boolean;
};
export type RenderShapeRectangle = {
  shape: 'rectangle';
  key: string;
  primary: boolean;
  upperLeft: SheetPosition;
  lowerRight: SheetPosition;
};
export type RenderShapeEllipse = {
  shape: 'ellipse';
  key: string;
  primary: boolean;
  center: SheetPosition;
  radiusX: number;
  radiusY: number;
};

export type GetRenderShapesOptions = {
  /** Defaults to true. When set to false, a non closed polygon which would become closed (ie,
   * polygon mirrored over a mirror line) will be returned as two distinct polygons (one
   * primary, one not) so that the two halves can be rendered differently. */
  combineNonClosedPolygons: boolean;
};

export type RenderShape = RenderShapePolygon | RenderShapeRectangle | RenderShapeEllipse;

export namespace RenderShape {
  export function polygon(
    key: string,
    points: Array<PolygonSegment>,
    options?: { closed?: boolean; primary?: boolean },
  ): RenderShape {
    return {
      shape: 'polygon' as const,
      key,
      primary: options?.primary ?? false,
      points,
      closed: options?.closed ?? false,
    };
  }
  export function rectangle(
    key: string,
    upperLeft: SheetPosition,
    lowerRight: SheetPosition,
    options?: { primary?: boolean },
  ): RenderShape {
    return {
      shape: 'rectangle' as const,
      key,
      primary: options?.primary ?? false,
      upperLeft,
      lowerRight,
    };
  }
  export function ellipse(
    key: string,
    center: SheetPosition,
    args: { radiusX: number; radiusY: number; primary?: boolean },
  ): RenderShape {
    return {
      shape: 'ellipse' as const,
      key,
      primary: args?.primary ?? false,
      center,
      radiusX: args.radiusX,
      radiusY: args.radiusY,
    };
  }

  export function boundingBox(renderShape: RenderShape) {
    switch (renderShape.shape) {
      case 'polygon':
        return BoundingBox.fromPoints(renderShape.points.map((p) => p.point));
      case 'rectangle':
        return BoundingBox.fromPoints([renderShape.upperLeft, renderShape.lowerRight]);
      case 'ellipse':
        return BoundingBox.fromPoints([
          renderShape.center,
          new SheetPosition(renderShape.center.x, renderShape.center.y + renderShape.radiusY),
          new SheetPosition(renderShape.center.x, renderShape.center.y - renderShape.radiusY),
          new SheetPosition(renderShape.center.x + renderShape.radiusX, renderShape.center.y),
          new SheetPosition(renderShape.center.x - renderShape.radiusX, renderShape.center.y),
        ]);
      default:
        renderShape satisfies never;
        throw new Error(
          `RenderShape.boundingBox: Unknown render shape ${(renderShape as any).shape}`,
        );
    }
  }
}

/**
 * Entity component for a geometry - a rectangle, ellipse, or polygon.
 */
export type GeometryComponent<D extends GeometryData = GeometryData> = EntityComponent<
  'geometry',
  D
>;

export namespace GeometryComponent {
  export const key: keyof GeometryComponent = 'geometry';

  export function createPolygon(
    points: Array<PolygonSegment>,
    options?: { closed?: boolean; openAtIndex?: number },
  ): GeometryComponent<PolygonData> {
    if (points.length < 2) {
      throw new Error(
        `GeometryComponent.createPolygon: points.length must be >= 2, found ${points.length}`,
      );
    }
    return {
      geometry: {
        type: 'polygon',
        points,
        closed: options?.closed ?? points[0].point === points.at(-1)!.point,
        openAtIndex: options?.openAtIndex ?? 0,
      },
    };
  }

  export function createRectangle(
    upperLeft: SheetPosition,
    lowerRight: SheetPosition,
  ): GeometryComponent<RectangleData> {
    return { geometry: { type: 'rectangle', upperLeft, lowerRight } };
  }

  export function createEllipse(
    center: SheetPosition,
    args: {
      radiusX: number;
      radiusY: number;
    },
  ): GeometryComponent<EllipseData> {
    return {
      geometry: {
        type: 'ellipse',
        center,
        radiusX: args.radiusX,
        radiusY: args.radiusY,
      },
    };
  }

  export function get<D extends GeometryData = GeometryData>(
    geometry: Entity<GeometryComponent<D>>,
  ): D {
    return geometry.components.geometry;
  }

  export function isPolygon(
    geometry: Geometry,
  ): geometry is Entity<GeometryComponent<PolygonData>> {
    return geometry.components.geometry.type === 'polygon';
  }

  export function isRectangle(
    geometry: Geometry,
  ): geometry is Entity<GeometryComponent<RectangleData>> {
    return geometry.components.geometry.type === 'rectangle';
  }

  export function isEllipse(
    geometry: Geometry,
  ): geometry is Entity<GeometryComponent<EllipseData>> {
    return geometry.components.geometry.type === 'ellipse';
  }

  export function update<
    Data extends GeometryData = GeometryData,
    Ent extends Entity<GeometryComponent<Data>> = Entity<GeometryComponent<Data>>,
  >(geometry: Ent, partial: Partial<Data>): Ent {
    return {
      ...geometry,
      components: {
        ...geometry.components,
        geometry: { ...geometry.components.geometry, ...partial },
      },
    };
  }

  /**
   * Key points that are added as verticies within the DCEL and available for a user to snap other
   * entities like constraints to.
   **/
  export function keyPoints(geometry: Entity<GeometryComponent>): KeyPoints<SheetPosition, string> {
    const state = GeometryComponent.get(geometry);
    switch (state.type) {
      case 'polygon':
        return PolygonData.keyPoints(geometry as Entity<GeometryComponent<PolygonData>>);
      case 'rectangle':
        return RectangleData.keyPoints(geometry as Entity<GeometryComponent<RectangleData>>);
      case 'ellipse':
        return EllipseData.keyPoints(geometry as Entity<GeometryComponent<EllipseData>>);
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.keyPoints: Unknown geometry data type ${(state as any).type}`,
        );
    }
  }

  export function boundingBox(geometry: Entity<GeometryComponent>): Rect<SheetPosition> {
    const state = GeometryComponent.get(geometry);
    switch (state.type) {
      case 'polygon':
        return PolygonData.boundingBox(geometry as Entity<GeometryComponent<PolygonData>>);
      case 'rectangle':
        return RectangleData.boundingBox(geometry as Entity<GeometryComponent<RectangleData>>);
      case 'ellipse':
        return EllipseData.boundingBox(geometry as Entity<GeometryComponent<EllipseData>>);
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.boundingBox: Unknown geometry data type ${(state as any).type}`,
        );
    }
  }

  export function translate<E extends Entity<GeometryComponent>>(
    geometry: E,
    transform: (input: SheetPosition) => SheetPosition,
  ): E {
    const state = GeometryComponent.get(geometry);
    switch (state.type) {
      case 'polygon':
        return PolygonData.translate(
          geometry as Entity<GeometryComponent<PolygonData>>,
          transform,
        ) as E;
      case 'rectangle':
        return RectangleData.translate(
          geometry as Entity<GeometryComponent<RectangleData>>,
          transform,
        ) as E;
      case 'ellipse':
        return EllipseData.translate(
          geometry as Entity<GeometryComponent<EllipseData>>,
          transform,
        ) as E;
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.translate: Unknown geometry data type ${(state as any).type}`,
        );
    }
  }

  export function getOrigin(geometry: Entity<GeometryComponent>): SheetPosition {
    const state = GeometryComponent.get(geometry);
    switch (state.type) {
      case 'polygon':
        return PolygonData.getOrigin(geometry as Entity<GeometryComponent<PolygonData>>);
      case 'rectangle':
        return RectangleData.getOrigin(geometry as Entity<GeometryComponent<RectangleData>>);
      case 'ellipse':
        return EllipseData.getOrigin(geometry as Entity<GeometryComponent<EllipseData>>);
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.getOrigin: Unknown geometry data type ${(state as any).type}`,
        );
    }
  }

  export function equals(a: Entity<GeometryComponent>, b: Entity<GeometryComponent>): boolean {
    const state = GeometryComponent.get(a);
    switch (state.type) {
      case 'polygon':
        return PolygonData.equals(a as Entity<GeometryComponent<PolygonData>>, b);
      case 'rectangle':
        return RectangleData.equals(a as Entity<GeometryComponent<RectangleData>>, b);
      case 'ellipse':
        return EllipseData.equals(a as Entity<GeometryComponent<EllipseData>>, b);
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.equals: Unknown geometry data type ${(state as any).type}`,
        );
    }
  }

  /**
   * Returns true if a geometry entity and a render shape are geometrically
   * identical (same type, same positions). Ignores metadata like `primary`
   * and `key` on the render shape.
   *
   * Used during serialization to skip rendering a render shape that is a
   * duplicate of the entity's own native SVG element.
   */
  export function isGeometricallyEqual(
    geometry: Entity<GeometryComponent>,
    renderShape: RenderShape,
  ): boolean {
    const data = GeometryComponent.get(geometry);
    switch (data.type) {
      case 'polygon':
        if (renderShape.shape !== 'polygon') {
          return false;
        }
        return PolygonData.isGeometricallyEqualToRenderShape(data.points, data.closed, renderShape);
      case 'rectangle':
        if (renderShape.shape !== 'rectangle') {
          return false;
        }
        return (
          data.upperLeft.x === renderShape.upperLeft.x &&
          data.upperLeft.y === renderShape.upperLeft.y &&
          data.lowerRight.x === renderShape.lowerRight.x &&
          data.lowerRight.y === renderShape.lowerRight.y
        );
      case 'ellipse':
        if (renderShape.shape !== 'ellipse') {
          return false;
        }
        return (
          data.center.x === renderShape.center.x &&
          data.center.y === renderShape.center.y &&
          data.radiusX === renderShape.radiusX &&
          data.radiusY === renderShape.radiusY
        );
      default:
        data satisfies never;
        return false;
    }
  }

  export function resize<E extends Entity<GeometryComponent>>(
    geometry: E,
    params: ResizeParams,
    originalBBox?: Rect<SheetPosition>,
  ): E {
    const state = GeometryComponent.get(geometry);
    switch (state.type) {
      case 'polygon':
        return PolygonData.resize(
          geometry as Entity<GeometryComponent<PolygonData>>,
          params,
          originalBBox,
        ) as E;
      case 'rectangle':
        return RectangleData.resize(
          geometry as Entity<GeometryComponent<RectangleData>>,
          params,
          originalBBox,
        ) as E;
      case 'ellipse':
        return EllipseData.resize(
          geometry as Entity<GeometryComponent<EllipseData>>,
          params,
          originalBBox,
        ) as E;
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.resize: Unknown geometry data type ${(state as any).type}`,
        );
    }
  }

  export function resizeBBox(
    bbox: Rect<SheetPosition>,
    params: ResizeParams,
  ): Rect<SheetPosition> | null {
    return FrameComponent.resizeBBox(bbox, params);
  }

  export function addPointOnEdge<G extends Entity<GeometryComponent<PolygonData>>>(
    geometry: G,
    constraints: Array<Entity<ConstraintComponent>>,
    segmentIndex: number,
    newPointPosition: { type: 't'; t: number } | { type: 'point'; point: SheetPosition },
  ) {
    return PolygonData.addPointOnEdge(geometry, constraints, segmentIndex, newPointPosition);
  }

  /** A map used to look up each filter and determine the order in which they should be applied.
   * Lower number = applied earlier, larger number = applied later. */
  const FILTER_DATA_TYPE_SORT_ORDER: { [key in FilterData['type']]: number } = {
    fillet: 1,
    chamfer: 1,
    mirror: 2,
    pattern: 2,
  };

  export function getRenderShapes(
    geometry: Entity<GeometryComponent<GeometryData>>,
    sheetDefaultUnit: UnitType,
    filters: Array<Filter> = [],
    options: GetRenderShapesOptions = { combineNonClosedPolygons: true },
  ): Array<RenderShape> {
    let shapes;

    const state = GeometryComponent.get(geometry);
    switch (state.type) {
      case 'polygon':
        shapes = [
          RenderShape.polygon(geometry.id, state.points, { closed: state.closed, primary: true }),
        ];
        break;
      case 'rectangle':
        shapes = [
          RenderShape.rectangle(geometry.id, state.upperLeft, state.lowerRight, { primary: true }),
        ];
        break;
      case 'ellipse':
        shapes = [
          RenderShape.ellipse(geometry.id, state.center, {
            radiusX: state.radiusX,
            radiusY: state.radiusY,
            primary: true,
          }),
        ];
        break;
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.getRenderShapes: Unknown geometry data type ${(state as any).type}`,
        );
    }

    let filterApplicationCounter = 0;
    for (const filter of filters.sort((a, b) => {
      const aScore = FILTER_DATA_TYPE_SORT_ORDER[FilterComponent.get(a).type];
      const bScore = FILTER_DATA_TYPE_SORT_ORDER[FilterComponent.get(b).type];
      return aScore - bScore;
    })) {
      const generateFilterKey = () => {
        filterApplicationCounter += 1;
        return `${filter.id}_${filterApplicationCounter}`;
      };

      const filterData = FilterComponent.get(filter);
      switch (filterData.type) {
        case 'mirror': {
          shapes = MirrorFilter.applyToRenderShape(filterData, shapes, generateFilterKey, options);
          break;
        }
        case 'fillet':
        case 'chamfer': {
          shapes = FilletFilter.applyToRenderShape(
            filterData,
            shapes,
            generateFilterKey,
            sheetDefaultUnit,
          );
          break;
        }
        case 'pattern': {
          shapes = PatternFilter.applyToRenderShape(
            filterData,
            filter,
            shapes,
            generateFilterKey,
            options,
          );
          break;
        }
        default:
          filterData satisfies never;
          break;
      }
    }

    return shapes;
  }
}
