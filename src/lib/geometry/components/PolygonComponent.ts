import { DeCasteljau, boundingBox as computeBoundingBox, convexPolygonWindOrder } from '@/lib/math';
import { KeyPoints, Rect, SheetPosition } from '@/lib/viewport/types';
import { DEFAULT_COLOR } from '../colors';
import {
  type CubicBezierSegment,
  type PointSegment,
  PolygonSegment,
  type QuadraticBezierSegment,
} from '../polygon';
import {
  Geometry,
  GeometryComponent,
  GeometryOmitComponents,
  type ResizeCorner,
  type ResizeEdge,
  type ResizeMode,
  type ResizeParams,
} from '../types';
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

    /** Cached fill color of the polygon when it is open */
    lastFillColor?: number | null;
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

    return { ...geometry, components };
  }

  export function dropLastFillColor<G extends Geometry<PolygonComponent>>(geometry: G): G {
    const polygon = { ...geometry.components.polygon };
    delete polygon.lastFillColor;
    return { ...geometry, components: { ...geometry.components, polygon } };
  }

  export function openPath<G extends Geometry<PolygonComponent & Partial<FillColorComponent>>>(
    geometry: G,
  ): G | GeometryOmitComponents<G, FillColorComponent> {
    const polygon = PolygonComponent.get(geometry);
    if (!polygon.closed || polygon.points.length < 3) {
      return geometry;
    }

    const intermediate = PolygonComponent.update(geometry, {
      points: [
        ...polygon.points.slice(
          polygon.openAtIndex + 1,
          -1 /* remove closed mode "duplicate" point */,
        ),
        ...polygon.points.slice(0, polygon.openAtIndex + 1),
      ],
      closed: false,
      lastFillColor: FillColorComponent.getOptional(geometry),
    });

    // Remove fill color when polygon is open
    return FillColorComponent.remove(intermediate);
  }

  export function closePath<G extends Geometry<PolygonComponent & Partial<FillColorComponent>>>(
    geometry: G,
  ): G {
    const polygonData = PolygonComponent.get(geometry);
    if (polygonData.closed || polygonData.points.length < 3) {
      return geometry;
    }

    const splitAt = polygonData.points.length - (polygonData.openAtIndex + 1);
    const intermediate = PolygonComponent.update(geometry, {
      points: [
        ...polygonData.points.slice(splitAt),
        ...polygonData.points.slice(0, splitAt),
        // Add back in final "closing" point
        { type: 'point', point: polygonData.points[splitAt].point },
      ],
      closed: true,
    });

    // Add back in fill color when polygon is closed
    return PolygonComponent.dropLastFillColor(
      FillColorComponent.update(
        intermediate,
        typeof polygonData.lastFillColor !== 'undefined'
          ? polygonData.lastFillColor
          : DEFAULT_COLOR,
      ),
    );
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

  export function getLayoutState<G extends Geometry<PolygonComponent>>(geometry: G) {
    return { for: 'polygon' as const, points: PolygonComponent.get(geometry).points.slice() };
  }
  export function setLayoutState<G extends Geometry<PolygonComponent>>(
    geometry: G,
    state: ReturnType<typeof getLayoutState>,
  ) {
    if (state.for !== 'polygon') {
      return geometry;
    }
    return PolygonComponent.update(geometry, { points: state.points });
  }
  export function layoutStateTranslate(
    state: ReturnType<typeof getLayoutState>,
    translatePoint: (input: SheetPosition) => SheetPosition,
  ) {
    const newPoints = state.points.map((seg) => {
      const newSeg: typeof seg = { ...seg };
      newSeg.point = translatePoint(seg.point);
      if (PolygonSegment.isQuadratic(seg)) {
        (newSeg as QuadraticBezierSegment).controlPoint = translatePoint(seg.controlPoint);
      }
      if (PolygonSegment.isCubic(seg)) {
        (newSeg as CubicBezierSegment).controlPointA = translatePoint(seg.controlPointA);
        (newSeg as CubicBezierSegment).controlPointB = translatePoint(seg.controlPointB);
      }
      return newSeg;
    });
    return { ...state, points: newPoints };
  }
  export function layoutStateEqual(
    a: ReturnType<typeof getLayoutState>,
    b: ReturnType<typeof getLayoutState>,
  ) {
    if (a.for !== 'polygon' || b.for !== 'polygon') {
      return false;
    }
    return (
      a.points.length === b.points.length &&
      a.points.every((aps, index) => {
        const bps = b.points[index];
        return PolygonSegment.equals(aps, bps);
      })
    );
  }

  export function layoutStateResize(
    state: ReturnType<typeof getLayoutState>,
    params: ResizeParams,
  ): ReturnType<typeof getLayoutState> | null {
    const pointsArray = state.points.map((seg) => seg.point);
    const bbox = computeBoundingBox(pointsArray);

    let pin: SheetPosition;
    if (params.altHeld) {
      pin = boundingBoxCenter(bbox);
    } else if (params.mode.type === 'corner') {
      pin = pinnedCornerPosition(params.mode.corner, bbox);
    } else {
      pin = pinnedEdgePosition(params.mode.edge, bbox);
    }

    let scaleX: number;
    let scaleY: number;

    if (params.mode.type === 'corner') {
      const corner = params.mode.corner;
      let cornerX: number;
      let cornerY: number;
      if (corner === 'top-left') {
        cornerX = bbox.position.x;
        cornerY = bbox.position.y;
      } else if (corner === 'top-right') {
        cornerX = bbox.position.x + bbox.width;
        cornerY = bbox.position.y;
      } else if (corner === 'bottom-left') {
        cornerX = bbox.position.x;
        cornerY = bbox.position.y + bbox.height;
      } else {
        cornerX = bbox.position.x + bbox.width;
        cornerY = bbox.position.y + bbox.height;
      }

      scaleX = (params.to.x - pin.x) / (cornerX - pin.x);
      scaleY = (params.to.y - pin.y) / (cornerY - pin.y);
    } else {
      const edge = params.mode.edge;
      if (edge === 'left' || edge === 'right') {
        if (params.altHeld) {
          scaleX = Math.abs(params.to.x - pin.x) / (bbox.width / 2);
          scaleY = 1;
        } else {
          scaleX = Math.abs(params.to.x - pin.x) / bbox.width;
          scaleY = 1;
        }
      } else {
        if (params.altHeld) {
          scaleX = 1;
          scaleY = Math.abs(params.to.y - pin.y) / (bbox.height / 2);
        } else {
          scaleX = 1;
          scaleY = Math.abs(params.to.y - pin.y) / bbox.height;
        }
      }
    }

    if (params.superHeld) {
      const minScale = Math.min(Math.abs(scaleX), Math.abs(scaleY));
      scaleX = Math.sign(scaleX) * minScale;
      scaleY = Math.sign(scaleY) * minScale;
    }

    const newPoints = state.points.map((seg) => {
      const newSeg: typeof seg = { ...seg };
      newSeg.point = scalePoint(seg.point, pin, scaleX, scaleY);
      if (PolygonSegment.isQuadratic(seg)) {
        (newSeg as QuadraticBezierSegment).controlPoint = scalePoint(
          (seg as typeof seg & { controlPoint: SheetPosition }).controlPoint,
          pin,
          scaleX,
          scaleY,
        );
      }
      if (PolygonSegment.isCubic(seg)) {
        const cubicSeg = seg as typeof seg & {
          controlPointA: SheetPosition;
          controlPointB: SheetPosition;
        };
        const newCubicSeg = newSeg as typeof seg & {
          controlPointA: SheetPosition;
          controlPointB: SheetPosition;
        };
        newCubicSeg.controlPointA = scalePoint(cubicSeg.controlPointA, pin, scaleX, scaleY);
        newCubicSeg.controlPointB = scalePoint(cubicSeg.controlPointB, pin, scaleX, scaleY);
      }
      return newSeg;
    });

    return { for: 'polygon' as const, points: newPoints };
  }
}

function boundingBoxCenter(bbox: Rect<SheetPosition>): SheetPosition {
  return new SheetPosition(bbox.position.x + bbox.width / 2, bbox.position.y + bbox.height / 2);
}

function pinnedCornerPosition(corner: ResizeCorner, bbox: Rect<SheetPosition>): SheetPosition {
  switch (corner) {
    case 'top-left':
      return new SheetPosition(bbox.position.x + bbox.width, bbox.position.y + bbox.height);
    case 'top-right':
      return new SheetPosition(bbox.position.x, bbox.position.y + bbox.height);
    case 'bottom-left':
      return new SheetPosition(bbox.position.x + bbox.width, bbox.position.y);
    case 'bottom-right':
      return new SheetPosition(bbox.position.x, bbox.position.y);
  }
}

function pinnedEdgePosition(edge: ResizeEdge, bbox: Rect<SheetPosition>): SheetPosition {
  switch (edge) {
    case 'top':
      return new SheetPosition(bbox.position.x, bbox.position.y + bbox.height);
    case 'bottom':
      return bbox.position;
    case 'left':
      return new SheetPosition(bbox.position.x + bbox.width, bbox.position.y);
    case 'right':
      return bbox.position;
  }
}

function scalePoint(
  point: SheetPosition,
  pin: SheetPosition,
  scaleX: number,
  scaleY: number,
): SheetPosition {
  const dx = point.x - pin.x;
  const dy = point.y - pin.y;
  return new SheetPosition(pin.x + dx * scaleX, pin.y + dy * scaleY);
}
