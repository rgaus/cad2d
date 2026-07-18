import { DEFAULT_COLOR } from './colors';
import { FillColorComponent } from './components/FillColorComponent';
import { GeometryComponent } from './components/GeometryComponent';
import { PolygonComponent } from './components/PolygonComponent';
import { RenderOrderComponent } from './components/RenderOrderComponent';
import {
  type CubicBezierSegment,
  type PointSegment,
  PolygonData,
  PolygonSegment,
  type QuadraticBezierSegment,
} from './geometry/polygon';
import { type Entity, EntityOmitComponents } from './types';

/** A polygon without params that will be added by the {@link GeometryStore#addPolygon} method */
export type PolygonTemplate = Omit<EntityOmitComponents<Polygon, RenderOrderComponent>, 'id'>;

/** A completed polygon with an id, segments, and closed state. */
export type Polygon = Entity<
  GeometryComponent<PolygonData> & Partial<FillColorComponent> & RenderOrderComponent
>;

export namespace Polygon {
  /** Create a new {@link PolygonTemplate} which can be created by {@link GeometryStore#addPolygon}. */
  export function create(
    points: Array<PolygonSegment>,
    options?: {
      fillColor?: number | null;
      closed?: boolean;
      openAtIndex?: number;
    },
  ): PolygonTemplate {
    if (points.length < 2) {
      throw new Error(`Polygon.create: points.length must be >= 2, found ${points.length}`);
    }
    const fillColor = options?.fillColor;
    const closed = options?.closed ?? points[0].point === points.at(-1)!.point;
    const openAtIndex = options?.openAtIndex ?? 0;
    return {
      components: {
        ...(closed
          ? FillColorComponent.create(typeof fillColor !== 'undefined' ? fillColor : DEFAULT_COLOR)
          : {}),
        ...GeometryComponent.createPolygon(points, {
          closed,
          openAtIndex,
        }),
        ...PolygonComponent.create(points, {
          closed,
          openAtIndex,
        }),
      },
    };
  }
}

export { PolygonSegment, type PointSegment, type QuadraticBezierSegment, type CubicBezierSegment };
