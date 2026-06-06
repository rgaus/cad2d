import { convexPolygonWindOrder } from '@/lib/math';
import {
  CubicCurve,
  KeyPoints,
  LineSegment,
  QuadraticCurve,
  Rect,
  SheetPosition,
} from '@/lib/viewport/types';
import { DEFAULT_COLOR } from './colors';
import {
  FillColorComponent,
  type Geometry,
  GeometryComponent,
  GeometryOmitComponents,
  RenderOrderComponent,
} from './types';

/** A straight line segment from one point to the next. */
export type PointSegment = {
  type: 'point';
  point: SheetPosition;
};

/** A quadratic Bezier arc. The user alt+clicks to place the arc endpoint,
 * then clicks to place the quadratic Bezier control point directly.
 * The curve passes near but not through the control point. */
export type QuadraticBezierSegment = {
  type: 'arc-quadratic';
  point: SheetPosition;
  controlPoint: SheetPosition;
};

/** A cubic Bezier arc where the user places both off-curve control points.
 * The curve passes through neither control point. */
export type CubicBezierSegment = {
  type: 'arc-cubic';
  point: SheetPosition;
  controlPointA: SheetPosition;
  controlPointB: SheetPosition;
};

/** A segment of a polygon — either a straight line or an arc. */
export type PolygonSegment = PointSegment | QuadraticBezierSegment | CubicBezierSegment;

/**
 * Geometry component containing rendering metadata about a polygonal shaped geometry.
 *
 * A component of {@link Polygon}, but also could be used by other polygonal shaped geometries if
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
}

export namespace PolygonSegment {
  /** Type guard to check if a polygon segment is a quadratic bezier */
  export function isPoint(
    c: PointSegment | QuadraticBezierSegment | CubicBezierSegment,
  ): c is PointSegment {
    return 'point' in c;
  }

  /** Type guard to check if a polygon segment is a quadratic bezier */
  export function isQuadratic(
    c: PointSegment | QuadraticBezierSegment | CubicBezierSegment,
  ): c is QuadraticBezierSegment {
    return 'controlPoint' in c && !('controlPointA' in c);
  }

  /** Type guard to check if a polygon segment is a cubic bezier */
  export function isCubic(
    c: PointSegment | QuadraticBezierSegment | CubicBezierSegment,
  ): c is CubicBezierSegment {
    return 'controlPointA' in c && !('controlPoint' in c);
  }

  export function toLineSegmentOrCurve(
    prevPoint: SheetPosition,
    segment: PointSegment,
  ): LineSegment<SheetPosition>;
  export function toLineSegmentOrCurve(
    prevPoint: SheetPosition,
    segment: QuadraticBezierSegment,
  ): QuadraticCurve<SheetPosition>;
  export function toLineSegmentOrCurve(
    prevPoint: SheetPosition,
    segment: CubicBezierSegment,
  ): CubicCurve<SheetPosition>;
  export function toLineSegmentOrCurve(
    prevPoint: SheetPosition,
    segment: PolygonSegment,
  ): LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition>;
  export function toLineSegmentOrCurve(
    prevPoint: SheetPosition,
    segment: PolygonSegment,
  ): LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition> {
    switch (segment.type) {
      case 'point':
        return { start: prevPoint, end: segment.point };
      case 'arc-quadratic':
        return { start: prevPoint, controlPoint: segment.controlPoint, end: segment.point };
      case 'arc-cubic':
        return {
          start: prevPoint,
          controlPointA: segment.controlPointA,
          controlPointB: segment.controlPointB,
          end: segment.point,
        };
    }
  }

  export function fromLineSegmentOrCurve(
    c: LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition>,
  ): [SheetPosition, PolygonSegment] {
    if (QuadraticCurve.isQuadraticCurve(c)) {
      return [c.start, { type: 'arc-quadratic', controlPoint: c.controlPoint, point: c.end }];
    } else if (CubicCurve.isCubicCurve(c)) {
      return [
        c.start,
        {
          type: 'arc-cubic',
          controlPointA: c.controlPointA,
          controlPointB: c.controlPointB,
          point: c.end,
        },
      ];
    } else if (LineSegment.isLineSegment(c)) {
      return [c.start, { type: 'point', point: c.end }];
    } else {
      throw new Error(`Unknown segment type: ${c}`);
    }
  }
}

/** A polygon without params that will be added by the {@link GeometryStore#addPolygon} method */
export type PolygonTemplate = Omit<GeometryOmitComponents<Polygon, RenderOrderComponent>, 'id'>;

/** A completed polygon with an id, segments, and closed state. */
export type Polygon = Geometry<
  PolygonComponent & Partial<FillColorComponent> & RenderOrderComponent
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
    return {
      components: {
        ...(closed
          ? FillColorComponent.create(typeof fillColor !== 'undefined' ? fillColor : DEFAULT_COLOR)
          : {}),
        ...PolygonComponent.create(points, {
          closed,
          openAtIndex: options?.openAtIndex,
        }),
      },
    };
  }
}
