import { type PointSegment, type PolygonSegment } from '@/lib/geometry';
import {
  CubicCurve,
  Position,
  QuadraticCurve,
  Rect,
  RectCorners,
  SheetPosition,
} from '@/lib/viewport/types';
import { DeCasteljau } from './bezier';

export { Intersection } from './intersection';
export { radiansToDegrees, degreesToRadians } from './angle';
export {
  distVec2,
  lerpVec2,
  perpVec2,
  normVec2,
  lenVec2,
  dotVec2,
  scaleVec2,
  subVec2,
  addVec2,
  angleToNormVec2,
  angleVec2,
} from './vector';
export {
  proximityBoundingBox,
  boundingBoxesIntersect,
  geometryBoundingBox,
  rectInset,
  boundingBox,
  interpolatePolygonPoints,
} from './bounding-box';
export { type CohenSutherlandOutcode, CohenSutherland } from './cohen-sutherland';
export { DeCasteljau, cubicBezierAt } from './bezier';

/* Round a number to an arbitrary number of decimal places. */
export function round(n: number, places: number = 0): number {
  const power = Math.pow(10, places);
  return Math.round(n * power) / power;
}

/**
 * Euclidean distance between two points.
 */
export function distance<P extends Position>(a: P, b: P): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function midPoint<P extends Position>(a: P, b: P): P {
  return new (a as any).constructor((a.x + b.x) / 2, (a.y + b.y) / 2);
}

/** Given a rect, generates the corner points which when drawn would visualize the rect. */
export function rectCorners<P extends Position>(rect: Rect<P>): RectCorners<P> {
  return {
    upperLeft: rect.position,
    upperRight: new (rect.position as any).constructor(
      rect.position.x + rect.width,
      rect.position.y,
    ),
    lowerLeft: new (rect.position as any).constructor(
      rect.position.x,
      rect.position.y + rect.height,
    ),
    lowerRight: new (rect.position as any).constructor(
      rect.position.x + rect.width,
      rect.position.y + rect.height,
    ),
  };
}

/** Given a rect, generates the corner points winding counter-clockwise which when drawn would visualize the rect. */
export function cornersToList<P extends Position>(rect: RectCorners<P>): Array<P> {
  return [rect.upperLeft, rect.upperRight, rect.lowerRight, rect.lowerLeft];
}

/** Points on an ellipse used for constraint syncing. */
export type EllipsePoints<P extends Position> = {
  center: P;
  right: P; // center.x + radiusX
  left: P; // center.x - radiusX
  bottom: P; // center.y + radiusY
  top: P; // center.y - radiusY
};

/** Given an ellipse, generates the key points which when drawn would visualize the ellipse bounds.
 *  These points can be matched against constraint endpoints for syncing when the ellipse moves. */
export function ellipsePoints<P extends Position>(ellipse: {
  center: P;
  radiusX: number;
  radiusY: number;
}): EllipsePoints<P> {
  return {
    center: ellipse.center,
    right: new (ellipse.center.constructor as new (x: number, y: number) => P)(
      ellipse.center.x + ellipse.radiusX,
      ellipse.center.y,
    ),
    left: new (ellipse.center.constructor as new (x: number, y: number) => P)(
      ellipse.center.x - ellipse.radiusX,
      ellipse.center.y,
    ),
    bottom: new (ellipse.center.constructor as new (x: number, y: number) => P)(
      ellipse.center.x,
      ellipse.center.y + ellipse.radiusY,
    ),
    top: new (ellipse.center.constructor as new (x: number, y: number) => P)(
      ellipse.center.x,
      ellipse.center.y - ellipse.radiusY,
    ),
  };
}

/** Result of closest point computation on a segment/curve, including the parameter t. */
export type ClosestPointResult<P extends Position> = {
  point: P;
  t: number;
  distance: number;
};

/** Computes the closest point on a line segment to a given point.
 * Returns the point on the segment (clamped to endpoints) closest to the query point.
 * Uses projection with clamping - if the projection falls outside the segment, clamps to nearest endpoint.
 */
export function closestPointOnSegment<P extends Position>(
  segmentStart: P,
  segmentEnd: P,
  queryPoint: P,
): ClosestPointResult<P> {
  const dx = segmentEnd.x - segmentStart.x;
  const dy = segmentEnd.y - segmentStart.y;

  if (dx === 0 && dy === 0) {
    // Zero length segment
    return { point: segmentStart, t: 0, distance: distance(segmentStart, queryPoint) };
  }

  const t =
    ((queryPoint.x - segmentStart.x) * dx + (queryPoint.y - segmentStart.y) * dy) /
    (dx * dx + dy * dy);

  const clampedT = Math.max(0, Math.min(1, t));

  const point = new (segmentStart as any).constructor(
    segmentStart.x + clampedT * dx,
    segmentStart.y + clampedT * dy,
  );

  return { point, t: clampedT, distance: distance(queryPoint, point) };
}

function distanceSquared(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Newton-Raphson solver for finding t where f(t) = 0, with derivatives f'(t) and f''(t).
 * Uses sampling to find an initial guess, then refines with Newton-Raphson.
 * Returns the t value that minimizes |f(t)| within [0, 1]. */
export const NewtonRaphson = {
  /** Finds t in [0, 1] that minimizes |f(t)| using sampling + Newton-Raphson refinement.
   *
   * @param f - The function to find the root of (should be zero at the minimum)
   * @param df - First derivative of f
   * @param d2f - Second derivative of f
   * @param evalPosition - Function to evaluate position at parameter t
   * @param queryPoint - The point to find the closest position to
   * @param sampleCount - Number of samples for initial search (default 50)
   * @param maxIterations - Max Newton-Raphson iterations (default 10)
   * @param tolerance - Convergence tolerance (default 1e-7)
   */
  findClosestT<P extends Position>(
    f: (t: number) => number,
    df: (t: number) => number,
    evalPosition: (t: number) => { x: number; y: number },
    queryPoint: P,
    sampleCount: number = 50,
    maxIterations: number = 10,
    tolerance: number = 1e-7,
  ): { t: number; point: P; distance: number } {
    const constructor = (queryPoint as any).constructor;

    let bestT = 0;
    let bestDistSq = Infinity;
    for (let i = 0; i <= sampleCount; i++) {
      const t = i / sampleCount;
      const pos = evalPosition(t);
      const dSq = distanceSquared(pos, queryPoint);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestT = t;
      }
    }

    let t = bestT;
    for (let i = 0; i < maxIterations; i++) {
      const ft = f(t);
      const dft = df(t);

      if (Math.abs(dft) < 1e-12) {
        break;
      }

      const tNext = Math.max(0, Math.min(1, t - ft / dft));
      if (Math.abs(tNext - t) < tolerance) {
        t = tNext;
        break;
      }
      t = tNext;
    }

    const finalPos = evalPosition(t);
    return {
      t,
      point: new constructor(finalPos.x, finalPos.y),
      distance: Math.sqrt(distanceSquared(finalPos, queryPoint)),
    };
  },
};

/**
 * Computes the closest point on a quadratic Bezier curve to a given query point.
 * Uses sampling followed by Newton-Raphson refinement to find the parameter t
 * where the tangent is perpendicular to the vector from the curve to the query.
 *
 * Returns { point, t, distance } where t is in [0, 1].
 */
export function closestPointOnQuadraticCurve<P extends Position>(
  curve: QuadraticCurve<P>,
  queryPoint: P,
): ClosestPointResult<P> {
  const p0 = curve.start;
  const p1 = curve.controlPoint;
  const p2 = curve.end;

  function evalPosition(t: number): { x: number; y: number } {
    const mt = 1 - t;
    return {
      x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
      y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
    };
  }

  function evalDerivative(t: number): { x: number; y: number } {
    return {
      x: 2 * (1 - t) * (p1.x - p0.x) + 2 * t * (p2.x - p1.x),
      y: 2 * (1 - t) * (p1.y - p0.y) + 2 * t * (p2.y - p1.y),
    };
  }

  function evalSecondDerivative(_t: number): { x: number; y: number } {
    return {
      x: 2 * (p2.x - 2 * p1.x + p0.x),
      y: 2 * (p2.y - 2 * p1.y + p0.y),
    };
  }

  function f(t: number): number {
    const pos = evalPosition(t);
    const d1 = evalDerivative(t);
    return d1.x * (pos.x - queryPoint.x) + d1.y * (pos.y - queryPoint.y);
  }

  function df(t: number): number {
    const d1 = evalDerivative(t);
    const d2 = evalSecondDerivative(t);
    const pos = evalPosition(t);
    return (
      d2.x * (pos.x - queryPoint.x) + d2.y * (pos.y - queryPoint.y) + d1.x * d1.x + d1.y * d1.y
    );
  }

  const result = NewtonRaphson.findClosestT(f, df, evalPosition, queryPoint);
  return { point: result.point, t: result.t, distance: result.distance };
}

/**
 * Computes the closest point on a cubic Bezier curve to a given query point.
 * Uses sampling followed by Newton-Raphson refinement to find the parameter t
 * where the tangent is perpendicular to the vector from the curve to the query.
 *
 * Returns { point, t, distance } where t is in [0, 1].
 */
export function closestPointOnCubicCurve<P extends Position>(
  curve: CubicCurve<P>,
  queryPoint: P,
): ClosestPointResult<P> {
  const p0 = curve.start;
  const p1 = curve.controlPointA;
  const p2 = curve.controlPointB;
  const p3 = curve.end;

  function evalPosition(t: number): { x: number; y: number } {
    const mt = 1 - t;
    return {
      x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
      y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
    };
  }

  function evalDerivative(t: number): { x: number; y: number } {
    const mt = 1 - t;
    return {
      x: 3 * mt * mt * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
      y: 3 * mt * mt * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
    };
  }

  function evalSecondDerivative(t: number): { x: number; y: number } {
    const mt = 1 - t;
    return {
      x: 6 * mt * (p2.x - 2 * p1.x + p0.x) + 6 * t * (p3.x - 2 * p2.x + p1.x),
      y: 6 * mt * (p2.y - 2 * p1.y + p0.y) + 6 * t * (p3.y - 2 * p2.y + p1.y),
    };
  }

  function f(t: number): number {
    const pos = evalPosition(t);
    const d1 = evalDerivative(t);
    return d1.x * (pos.x - queryPoint.x) + d1.y * (pos.y - queryPoint.y);
  }

  function df(t: number): number {
    const d1 = evalDerivative(t);
    const d2 = evalSecondDerivative(t);
    const pos = evalPosition(t);
    return (
      d2.x * (pos.x - queryPoint.x) + d2.y * (pos.y - queryPoint.y) + d1.x * d1.x + d1.y * d1.y
    );
  }

  const result = NewtonRaphson.findClosestT(f, df, evalPosition, queryPoint);
  return { point: result.point, t: result.t, distance: result.distance };
}

/** Converts an ellipse to a polygon with 4 cubic Bezier curves (one per quadrant).
 * Uses the standard k = 4/3*(√2-1) ≈ 0.5523 cubic bezier approximation, which
 * works for both circles (rx == ry) and general ellipses.
 * Returns a PointSegment followed by 4 CubicBezierSegments starting from the
 * rightmost point and going counterclockwise: right -> bottom -> left -> top -> right. */
export function ellipseToPolygon(
  center: SheetPosition,
  radiusX: number,
  radiusY: number,
): Array<PolygonSegment> {
  // Magic constant for cubic bezier quarter-arc approximation: 4/3 * (sqrt(2) - 1).
  // Gives a max radial error of ~0.027% which is imperceptible in practice.
  const k = 0.5522847498;

  const right = new SheetPosition(center.x + radiusX, center.y);
  const top = new SheetPosition(center.x, center.y - radiusY);
  const left = new SheetPosition(center.x - radiusX, center.y);
  const bottom = new SheetPosition(center.x, center.y + radiusY);

  // Each quarter needs two control points. The pattern is: the first CP stays
  // at the full radius on the departing axis, the second CP stays at full radius
  // on the arriving axis -- both offset by k on the perpendicular axis.

  // Q1: right -> top (x decreases, y decreases)
  const q1cpA = new SheetPosition(center.x + radiusX, center.y - radiusY * k);
  const q1cpB = new SheetPosition(center.x + radiusX * k, center.y - radiusY);

  // Q2: top -> left (x decreases, y increases)
  const q2cpA = new SheetPosition(center.x - radiusX * k, center.y - radiusY);
  const q2cpB = new SheetPosition(center.x - radiusX, center.y - radiusY * k);

  // Q3: left -> bottom (x increases, y increases)
  const q3cpA = new SheetPosition(center.x - radiusX, center.y + radiusY * k);
  const q3cpB = new SheetPosition(center.x - radiusX * k, center.y + radiusY);

  // Q4: bottom -> right (x increases, y decreases)
  const q4cpA = new SheetPosition(center.x + radiusX * k, center.y + radiusY);
  const q4cpB = new SheetPosition(center.x + radiusX, center.y + radiusY * k);

  return [
    { type: 'point', point: right },
    { type: 'arc-cubic', point: bottom, controlPointA: q4cpB, controlPointB: q4cpA },
    { type: 'arc-cubic', point: left, controlPointA: q3cpB, controlPointB: q3cpA },
    { type: 'arc-cubic', point: top, controlPointA: q2cpB, controlPointB: q2cpA },
    { type: 'arc-cubic', point: right, controlPointA: q1cpB, controlPointB: q1cpA },
  ];
}

/** Converts a rectangle to a polygon (array of point segments).
 * Returns 3 PointSegments in order: upperLeft, upperRight, lowerRight.
 * The polygon is NOT closed - caller should add closing point if needed. */
export function rectangleToPolygon(
  upperLeft: SheetPosition,
  lowerRight: SheetPosition,
): Array<PointSegment> {
  const upperRight = new SheetPosition(lowerRight.x, upperLeft.y);
  const lowerLeft = new SheetPosition(upperLeft.x, lowerRight.y);

  return [
    { type: 'point', point: upperLeft },
    { type: 'point', point: upperRight },
    { type: 'point', point: lowerRight },
    { type: 'point', point: lowerLeft },
    { type: 'point', point: upperLeft },
  ];
}

/** Rasterizes a quadratic or cubic Bezier curve into an array of points.
 *  Generic over any Position subclass (SheetPosition, WorldPosition, etc.).
 *  Uses the De Casteljau algorithm to sample at uniform t intervals. */
export function arcToLineSegments<P extends Position>(
  curve: QuadraticCurve<P> | CubicCurve<P>,
  numSamples: number = 20,
): Array<P> {
  const points: Array<P> = [];
  for (let i = 0; i <= numSamples; i++) {
    const t = i / numSamples;
    if (QuadraticCurve.isQuadraticCurve(curve)) {
      points.push(DeCasteljau.getQuadraticBezierPointAt(curve, t));
    } else {
      points.push(DeCasteljau.getCubicBezierPointAt(curve, t));
    }
  }
  return points;
}

/** Compute the signed area via the shoelace formula: https://en.wikipedia.org/wiki/Shoelace_formula
 * A positive result means counter-clockwise (standard math coords),
 * negative means clockwise. */
export function convexPolygonWindOrder<P extends { x: number; y: number }>(
  points: Array<P>,
): 'clockwise' | 'counter-clockwise' {
  let signedArea = 0;

  for (const [i, point] of points.entries()) {
    const next = points[(i + 1) % points.length];
    signedArea += point.x * next.y - next.x * point.y;
  }

  // The shoelace formula gives 2x the signed area, but we only need the sign
  return signedArea > 0 ? 'counter-clockwise' : 'clockwise';
}
