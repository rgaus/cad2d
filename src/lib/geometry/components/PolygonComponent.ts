import { DeCasteljau, convexPolygonWindOrder } from '@/lib/math';
import { KeyPoints, Rect, SheetPosition } from '@/lib/viewport/types';
import { DEFAULT_COLOR } from '../colors';
import {
  type CubicBezierSegment,
  type PointSegment,
  PolygonSegment,
  type QuadraticBezierSegment,
} from '../polygon';
import { Geometry, GeometryComponent } from '../types';
import { FillColorComponent } from './FillColorComponent';

/**
 * Geometry component containing rendering metadata about a polygonal shaped geometry.
 *
 * A component of Polygon, but also could be used by other polygonal shaped geometries if
 * desired. */
export type PolygonComponent = GeometryComponent<
  'polygon',
  {
    points: Array<PolygonSegment>;
    closed: boolean;
    openAtIndex: number;
  }
>;

export namespace PolygonComponent {
  export const key: keyof PolygonComponent = 'polygon';

  export function create(
    points: Array<PolygonSegment>,
    options?: { closed?: boolean; openAtIndex?: number },
  ): PolygonComponent {
    if (points.length < 2) {
      throw new Error(
        `PolygonComponent.create: points.length must be >= 2, found ${points.length}`,
      );
    }
    return {
      polygon: {
        points,
        closed: options?.closed ?? points[0].point === points.at(-1)!.point,
        openAtIndex: options?.openAtIndex ?? 0,
      },
    };
  }

  export function get(
    geometry: Geometry<PolygonComponent>,
  ): PolygonComponent[keyof PolygonComponent] {
    return geometry.components.polygon;
  }

  export function update<G extends Geometry<PolygonComponent>>(
    geometry: G,
    polygon: Partial<PolygonComponent[keyof PolygonComponent]>,
  ): G {
    const merged = { ...geometry.components.polygon, ...polygon };
    merged.openAtIndex = Math.max(0, Math.min(merged.openAtIndex, merged.points.length - 1));

    let components: any = {
      ...geometry.components,
      polygon: merged,
    };

    // Add / remove fill color based on polygon closed state
    if (merged.closed && !FillColorComponent.has(geometry)) {
      components = { ...components, ...FillColorComponent.create(DEFAULT_COLOR) };
    } else if (!merged.closed && FillColorComponent.has(geometry)) {
      components = FillColorComponent.remove(geometry);
    }

    return { ...geometry, components };
  }

  export function openPath<G extends Geometry<PolygonComponent>>(geometry: G): G {
    const polygon = PolygonComponent.get(geometry);
    if (!polygon.closed || polygon.points.length < 3) {
      return geometry;
    }
    return PolygonComponent.update(geometry, {
      points: [
        ...polygon.points.slice(
          polygon.openAtIndex + 1,
          -1 /* remove closed mode "duplicate" point */,
        ),
        ...polygon.points.slice(0, polygon.openAtIndex + 1),
      ],
      closed: false,
    });
  }

  export function closePath<G extends Geometry<PolygonComponent>>(geometry: G): G {
    const polygonData = PolygonComponent.get(geometry);
    if (polygonData.closed || polygonData.points.length < 3) {
      return geometry;
    }

    const splitAt = polygonData.points.length - (polygonData.openAtIndex + 1);
    return PolygonComponent.update(geometry, {
      points: [
        ...polygonData.points.slice(splitAt),
        ...polygonData.points.slice(0, splitAt),
        // Add back in final "closing" point
        { type: 'point', point: polygonData.points[splitAt].point },
      ],
      closed: true,
    });
  }

  export function keyPoints(geometry: Geometry<PolygonComponent>): KeyPoints<SheetPosition, never> {
    const polygonData = PolygonComponent.get(geometry);
    const points = polygonData.points.map((p) => p.point);

    const windOrder = convexPolygonWindOrder(points);
    if (windOrder === 'clockwise') {
      points.reverse();
    }

    return {
      perimeter: points,
      extras: {},
    };
  }

  export function boundingBox(geometry: Geometry<PolygonComponent>): Rect<SheetPosition> {
    const polygonData = PolygonComponent.get(geometry);
    return polygonData.points.reduce(
      (acc, seg) => {
        const x = seg.point.x;
        const y = seg.point.y;
        return {
          position: new SheetPosition(Math.min(acc.position.x, x), Math.min(acc.position.y, y)),
          width: Math.max(acc.width, x),
          height: Math.max(acc.height, y),
        };
      },
      {
        position: new SheetPosition(Infinity, Infinity),
        width: -Infinity,
        height: -Infinity,
      },
    );
  }

  export function addPointOnEdge<G extends Geometry<PolygonComponent>>(
    geometry: G,
    segmentIndex: number,
    newPoint: SheetPosition,
    t?: number,
  ): G | null {
    const polygon = PolygonComponent.get(geometry);
    const segment = polygon.points[segmentIndex];
    const nextSegment = polygon.points[segmentIndex + 1];

    if (!segment || !nextSegment) {
      return null;
    }

    if (nextSegment.type === 'point') {
      if (segment.type !== 'point') {
        return null;
      }
      return PolygonComponent.update(geometry, {
        points: [
          ...polygon.points.slice(0, segmentIndex + 1),
          { type: 'point', point: newPoint } as PointSegment,
          ...polygon.points.slice(segmentIndex + 1),
        ],
      });
    }

    if (typeof t === 'undefined') {
      return null;
    }

    if (nextSegment.type === 'arc-quadratic') {
      if (segment.type !== 'point') {
        return null;
      }
      const curve = {
        start: segment.point,
        controlPoint: nextSegment.controlPoint,
        end: nextSegment.point,
      };
      const [leftCurve, rightCurve] = DeCasteljau.splitQuadraticBezier(curve, t);

      return PolygonComponent.update(geometry, {
        points: [
          ...polygon.points.slice(0, segmentIndex + 1),
          {
            type: 'arc-quadratic',
            point: leftCurve.end,
            controlPoint: leftCurve.controlPoint,
          } as QuadraticBezierSegment,
          {
            type: 'arc-quadratic',
            point: rightCurve.end,
            controlPoint: rightCurve.controlPoint,
          } as QuadraticBezierSegment,
          ...polygon.points.slice(segmentIndex + 2),
        ],
      });
    }

    if (nextSegment.type === 'arc-cubic') {
      if (segment.type !== 'point') {
        return null;
      }
      const curve = {
        start: segment.point,
        controlPointA: nextSegment.controlPointA,
        controlPointB: nextSegment.controlPointB,
        end: nextSegment.point,
      };
      const [leftCurve, rightCurve] = DeCasteljau.splitCubicBezier(curve, t);

      return PolygonComponent.update(geometry, {
        points: [
          ...polygon.points.slice(0, segmentIndex + 1),
          {
            type: 'arc-cubic',
            point: leftCurve.end,
            controlPointA: leftCurve.controlPointA,
            controlPointB: leftCurve.controlPointB,
          } as CubicBezierSegment,
          {
            type: 'arc-cubic',
            point: rightCurve.end,
            controlPointA: rightCurve.controlPointA,
            controlPointB: rightCurve.controlPointB,
          } as CubicBezierSegment,
          ...polygon.points.slice(segmentIndex + 2),
        ],
      });
    }

    return null;
  }
}
