import { Rect, SheetPosition } from '@/lib/viewport/types';
import { type GeometryData } from '../geometry';
import { EllipseData } from '../geometry/ellipse';
import { PolygonData, PolygonSegment } from '../geometry/polygon';
import { RectangleData } from '../geometry/rectangle';
import { ResizeParams, type Entity, type EntityComponent } from '../types';

/**
 * Entity component for a geometry - a rectangle, ellipse, or polygon.
 */
export type GeometryComponent<D extends GeometryData = GeometryData> = EntityComponent<'geometry', D>;

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

  export function get<D extends GeometryData = GeometryData>(geometry: Entity<GeometryComponent<D>>): D {
    return geometry.components.geometry;
  }

  export function update<
    Data extends GeometryData = GeometryData,
    Ent extends Entity<GeometryComponent<Data>> = Entity<GeometryComponent<Data>>,
  >(
    geometry: Ent,
    partial: Partial<Data>,
  ): Ent {
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
  export function keyPoints(geometry: Entity<GeometryComponent>) {
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
        throw new Error(`GeometryComponent.keyPoints: Unknown polygon data type ${(state as any).type}`);
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
        throw new Error(`GeometryComponent.boundingBox: Unknown polygon data type ${(state as any).type}`);
    }
  }

  export function translate(
    geometry: Entity<GeometryComponent>,
    transform: (input: SheetPosition) => SheetPosition,
  ): Entity<GeometryComponent> {
    const state = GeometryComponent.get(geometry);
    switch (state.type) {
      case 'polygon':
        return PolygonData.translate(geometry as Entity<GeometryComponent<PolygonData>>, transform);
      case 'rectangle':
        return RectangleData.translate(geometry as Entity<GeometryComponent<RectangleData>>, transform);
      case 'ellipse':
        return EllipseData.translate(geometry as Entity<GeometryComponent<EllipseData>>, transform);
      default:
        state satisfies never;
        throw new Error(`GeometryComponent.translate: Unknown polygon data type ${(state as any).type}`);
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
        throw new Error(`GeometryComponent.equals: Unknown polygon data type ${(state as any).type}`);
    }
  }

  export function resize(
    geometry: Entity<GeometryComponent>,
    params: ResizeParams,
    originalBBox?: Rect<SheetPosition>,
  ): Entity<GeometryComponent> | null {
    const state = GeometryComponent.get(geometry);
    switch (state.type) {
      case 'polygon':
        return PolygonData.resize(geometry as Entity<GeometryComponent<PolygonData>>, params, originalBBox);
      case 'rectangle':
        return RectangleData.resize(geometry as Entity<GeometryComponent<RectangleData>>, params, originalBBox);
      case 'ellipse':
        return EllipseData.resize(geometry as Entity<GeometryComponent<EllipseData>>, params, originalBBox);
      default:
        state satisfies never;
        throw new Error(`GeometryComponent.resize: Unknown polygon data type ${(state as any).type}`);
    }
  }
}
