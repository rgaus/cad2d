import { type RectangleEndpoint } from '@/lib/entity/rectangle';
import { CubicCurve, LineSegment, type Position, QuadraticCurve } from '@/lib/viewport/types';
import { Vector2 } from './vector';

/** Factory callback that creates the corner replacement segment (arc or line). */
export type CornerSegmentFactory<P extends Position> = (
  p0: P,
  p3: P,
  tStart: P,
  tEnd: P,
  offset: number,
  farAPos: P,
  cornerPos: P,
  farBPos: P,
) => CubicCurve<P> | LineSegment<P> | QuadraticCurve<P>;

/** Return type for applyToPolygon. */
export type FilletChamferPolygonResult<P extends Position> = {
  segments: Array<LineSegment<P> | QuadraticCurve<P> | CubicCurve<P>>;
  /** Maps old vertex index (0..n-1, where vertex i = segments[i].start) to its index in the new segment list. */
  oldPointToNewPoint: Map<number, number>;
  /** Index of the inserted corner segment in the viewport `segments` array. */
  insertedSegmentIndex: number;
};

/** Return type for applyToRectangle. */
export type FilletChamferRectangleResult<P extends Position> = {
  segments: Array<LineSegment<P> | QuadraticCurve<P> | CubicCurve<P>>;
  /** Maps each rectangle corner label to its vertex index in the new segment list. The corner that was filleted/chamfered is excluded. */
  oldPointToNewPoint: Map<RectangleEndpoint, number>;
};

/**
 * Computes the position of a rectangle corner label given the upper-left and
 * lower-right bounds of an axis-aligned rectangle.
 */
function getRectangleCornerPosition<P extends Position>(
  upperLeft: P,
  lowerRight: P,
  corner: RectangleEndpoint,
): P {
  const Cn = (upperLeft as any).constructor as new (x: number, y: number) => P;
  switch (corner) {
    case 'upperLeft':
      return new Cn(upperLeft.x, upperLeft.y);
    case 'upperRight':
      return new Cn(lowerRight.x, upperLeft.y);
    case 'lowerRight':
      return new Cn(lowerRight.x, lowerRight.y);
    case 'lowerLeft':
      return new Cn(upperLeft.x, lowerRight.y);
    case 'center':
      return new Cn(
        upperLeft.x + (lowerRight.x - upperLeft.x) / 2,
        upperLeft.y + (lowerRight.y - upperLeft.y) / 2,
      );
    default:
      corner satisfies never;
      throw new Error(`getRectangleCornerPosition: No corner ${corner} found.`);
  }
}

/**
 * Given a corner position and the positions of the two adjacent corners,
 * computes the split points along each edge at the given offset distance
 * and the unit tangents at those split points (pointing away from the
 * corner along each edge).
 */
function computeCornerSplitInfo<P extends Position>(
  cornerPos: P,
  adjacentAPos: P,
  adjacentBPos: P,
  offset: number,
): {
  splitA: P;
  splitB: P;
  dirA: P;
  dirB: P;
} {
  const dirA = Vector2.norm(Vector2.sub(adjacentAPos, cornerPos));
  const dirB = Vector2.norm(Vector2.sub(adjacentBPos, cornerPos));
  const splitA = Vector2.add(cornerPos, Vector2.scale(dirA, offset));
  const splitB = Vector2.add(cornerPos, Vector2.scale(dirB, offset));
  return { splitA, splitB, dirA, dirB };
}

/**
 * Computes the cubic bezier control points for an arc that replaces a
 * polygon corner, using the standard cubic bezier arc approximation.
 *
 * The arc runs from start (splitA) to end (splitB). The tangents tell
 * how the incoming and outgoing edges meet at the corner.
 *
 * @param start - Split position on the first edge (p0).
 * @param end - Split position on the second edge (p3).
 * @param tStart - Unit tangent at start, pointing toward the corner.
 * @param tEnd - Unit tangent at end, pointing away from the corner.
 * @param offset - The fillet offset distance (also the arc "radius").
 * @param centerPos - Position of the original corner vertex.
 * @param farAPos - Position of the far end of the first edge.
 * @param farBPos - Position of the far end of the second edge.
 */
export function computeFilletArcControlPoints<P extends Position>(
  start: P,
  end: P,
  tStart: P,
  tEnd: P,
  offset: number,
  centerPos: P,
  farAPos: P,
  farBPos: P,
): { controlPointA: P; controlPointB: P } {
  // Compute the angle between the two edges meeting at the corner
  const cosTheta = Math.max(
    -1,
    Math.min(
      1,
      Vector2.dot(
        Vector2.norm(Vector2.sub(farAPos, centerPos)),
        Vector2.norm(Vector2.sub(farBPos, centerPos)),
      ),
    ),
  );
  const theta = Math.acos(cosTheta);
  // Magic constant for cubic bezier quarter-arc approximation: 4/3 * tan(angle/4)
  const kVal = (4 / 3) * Math.tan(theta / 4);
  const kR = kVal * offset;

  const controlPointA = Vector2.add(start, Vector2.scale(tStart, kR));
  const controlPointB = Vector2.sub(end, Vector2.scale(tEnd, kR));

  return { controlPointA, controlPointB };
}

/** The four rectangle corners in CCW perimeter order. */
const RECTANGLE_PERIMETER_ORDER: Array<RectangleEndpoint> = [
  'upperLeft',
  'upperRight',
  'lowerRight',
  'lowerLeft',
];

/**
 * Converts an axis-aligned rectangle into an array of four line segments
 * representing its perimeter edges in CCW order.
 *
 *   Segment 0: upperLeft -> upperRight
 *   Segment 1: upperRight -> lowerRight
 *   Segment 2: lowerRight -> lowerLeft
 *   Segment 3: lowerLeft -> upperLeft
 */
function rectangleToSegments<P extends Position>(
  upperLeft: P,
  lowerRight: P,
): Array<LineSegment<P>> {
  const ul = getRectangleCornerPosition(upperLeft, lowerRight, 'upperLeft');
  const ur = getRectangleCornerPosition(upperLeft, lowerRight, 'upperRight');
  const lr = getRectangleCornerPosition(upperLeft, lowerRight, 'lowerRight');
  const ll = getRectangleCornerPosition(upperLeft, lowerRight, 'lowerLeft');

  return [
    { start: ul, end: ur },
    { start: ur, end: lr },
    { start: lr, end: ll },
    { start: ll, end: ul },
  ];
}

/**
 * Returns the segment index whose `end` is the given rectangle corner.
 * The fillet/chamfer is applied at the junction between this segment
 * (index) and the next (index + 1 mod 4).
 */
function getRectangleCornerSegmentIndex(corner: RectangleEndpoint): number {
  const idx = RECTANGLE_PERIMETER_ORDER.indexOf(corner);
  // The corner sits at the end of segment (idx - 1), wrapping for idx=0.
  return (idx + 3) % 4;
}

/**
 * Computes the old-to-new vertex index mapping for a corner replacement
 * operation on a polygon.
 *
 * Vertex i corresponds to segments[i].start (= segments[(i-1+n)%n].end).
 * The corner vertex (at nextIdx) is removed; all vertices after it shift
 * by +1 in the non-wrap case and are unchanged in the wrap case.
 */
function buildOldToNewMap(n: number, cornerIndex: number): Map<number, number> {
  const map = new Map<number, number>();
  const nextIdx = (cornerIndex + 1) % n;
  for (let i = 0; i < n; i += 1) {
    if (i === nextIdx) {
      // The corner vertex is removed - do not include in the map
      continue;
    }
    if (nextIdx > cornerIndex) {
      // Non-wrap: vertices beyond the removed one shift by +1
      if (i < nextIdx) {
        map.set(i, i);
      } else {
        map.set(i, i + 1);
      }
    } else {
      // Wrap: vertices 1..n-1 stay at the same index
      map.set(i, i);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// CornerReplacement namespace
// ---------------------------------------------------------------------------

export namespace CornerReplacement {
  /** Pre-built factory: cubic bezier arc for a fillet. */
  export function filletArc<P extends Position>(
    p0: P,
    p3: P,
    tStart: P,
    tEnd: P,
    offset: number,
    farAPos: P,
    cornerPos: P,
    farBPos: P,
  ): CubicCurve<P> {
    const { controlPointA, controlPointB } = computeFilletArcControlPoints(
      p0,
      p3,
      tStart,
      tEnd,
      offset,
      cornerPos,
      farAPos,
      farBPos,
    );
    return { start: p0, end: p3, controlPointA, controlPointB };
  }

  /** Pre-built factory: straight line for a chamfer. */
  export function chamferLine<P extends Position>(
    p0: P,
    p3: P,
    _tStart: P,
    _tEnd: P,
    _offset: number,
    _farAPos: P,
    _cornerPos: P,
    _farBPos: P,
  ): LineSegment<P> {
    return { start: p0, end: p3 };
  }

  /**
   * Applies a corner replacement to a rectangle corner, returning the full
   * polygon segment list that results from converting the rectangle to a
   * polygon and replacing the specified corner with a segment created by
   * the provided factory.
   */
  export function applyToRectangle<P extends Position>(
    upperLeft: P,
    lowerRight: P,
    corner: RectangleEndpoint,
    offset: number,
    segmentFactory: CornerSegmentFactory<P>,
  ): FilletChamferRectangleResult<P> {
    const segments = rectangleToSegments(upperLeft, lowerRight);
    const cornerIndex = getRectangleCornerSegmentIndex(corner);
    const result = applyToPolygon(segments, cornerIndex, offset, segmentFactory);

    // Convert vertex-index map to RectangleEndpoint map
    const labelMap = new Map<RectangleEndpoint, number>();
    for (const [oldIdx, newIdx] of result.oldPointToNewPoint) {
      labelMap.set(RECTANGLE_PERIMETER_ORDER[oldIdx], newIdx);
    }

    return { segments: result.segments, oldPointToNewPoint: labelMap };
  }

  /**
   * Applies a corner replacement (fillet or chamfer) to a polygon corner
   * by replacing the two edge segments that meet at the given index with
   * truncated versions and a new segment created by the factory callback.
   *
   * The corner is at the junction between segments[cornerIndex] and the next
   * segment (wrapping around). Both edge segments must be plain line
   * segments (no control points); otherwise returns the input unchanged.
   */
  export function applyToPolygon<P extends Position>(
    segments: Array<LineSegment<P> | QuadraticCurve<P> | CubicCurve<P>>,
    cornerIndex: number,
    offset: number,
    segmentFactory: CornerSegmentFactory<P>,
  ): FilletChamferPolygonResult<P> {
    const n = segments.length;
    if (n < 2) {
      return { segments, oldPointToNewPoint: new Map(), insertedSegmentIndex: -1 };
    }
    const nextIdx = (cornerIndex + 1) % n;

    const segA = segments[cornerIndex];
    const segB = segments[nextIdx];

    // Both segments must be plain line segments for the replacement to be applied
    if (
      CubicCurve.isCubicCurve(segA) ||
      QuadraticCurve.isQuadraticCurve(segA) ||
      CubicCurve.isCubicCurve(segB) ||
      QuadraticCurve.isQuadraticCurve(segB)
    ) {
      return { segments, oldPointToNewPoint: new Map(), insertedSegmentIndex: -1 };
    }

    const cornerPos = segA.end;
    const farAPos = segA.start;
    const farBPos = segB.end;

    const { splitA, splitB, dirA, dirB } = computeCornerSplitInfo(
      cornerPos,
      farAPos,
      farBPos,
      offset,
    );

    // Tangent at splitA points toward the corner (opposite of dirA)
    const tStart = Vector2.scale(dirA, -1);
    // Tangent at splitB points toward farBPos (same as dirB)
    const tEnd = dirB;

    const cornerSegment = segmentFactory(
      splitA,
      splitB,
      tStart,
      tEnd,
      offset,
      farAPos,
      cornerPos,
      farBPos,
    );

    const truncatedA: LineSegment<P> = { start: farAPos, end: splitA };
    const truncatedB: LineSegment<P> = { start: splitB, end: farBPos };

    const isWrapping = nextIdx < cornerIndex;
    let result: Array<LineSegment<P> | QuadraticCurve<P> | CubicCurve<P>>;
    let insertedSegmentIndex: number;

    if (isWrapping) {
      result = [truncatedB, ...segments.slice(nextIdx + 1, cornerIndex), truncatedA, cornerSegment];
      insertedSegmentIndex = result.length - 1;
    } else {
      result = [
        ...segments.slice(0, cornerIndex),
        truncatedA,
        cornerSegment,
        truncatedB,
        ...segments.slice(nextIdx + 1),
      ];
      insertedSegmentIndex = cornerIndex + 1;
    }

    return {
      segments: result,
      oldPointToNewPoint: buildOldToNewMap(n, cornerIndex),
      insertedSegmentIndex,
    };
  }
}
