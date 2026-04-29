import { PointSegment, PolygonSegment } from "../tools/types";
import { CubicCurve, LineSegment, Position, QuadraticCurve, Rect, RectCorners, SheetPosition } from "../viewport/types";
import { solveQuadratic, solveCubic } from './intersection';
import { SHEET_UNITS_TO_PIXELS } from "../sheet/Sheet";

export { Intersection } from './intersection';

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

export function addVec2<P extends Position>(a: P, b: P): P {
  return new ((a as any).constructor)(a.x + b.x, a.y + b.y);
}

export function subVec2<P extends Position>(a: P, b: P): P {
  return new ((a as any).constructor)(a.x - b.x, a.y - b.y);
}

export function scaleVec2<P extends Position>(v: P, s: number): P {
  return new ((v as any).constructor)(v.x * s, v.y * s);
}

export function dotVec2<P extends Position>(a: P, b: P): number {
  return a.x * b.x + a.y * b.y;
}

export function lenVec2(v: Position): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

export function normVec2<P extends Position>(v: P): P {
  const l = lenVec2(v);
  if (l === 0) {
    return new ((v as any).constructor)(0, 0);
  }
  return new ((v as any).constructor)(v.x / l, v.y / l);
}

export function perpVec2<P extends Position>(v: P): P {
  return new ((v as any).constructor)(-1 * v.y, v.x);
}

export function lerpVec2<P extends Position>(a: P, b: P, t: number): P {
  return new ((a as any).constructor)(
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
  );
}

export function distVec2<P extends Position>(a: P, b: P): number {
  return lenVec2(subVec2(b, a));
}

export function degreesToRadians(degrees: number) {
  return degrees * (Math.PI / 180);
}

export function radiansToDegrees(radians: number) {
  return radians / (Math.PI / 180);
}

export function angleBetweenInDegrees<P extends Position>(a: P, b: P): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return radiansToDegrees(Math.atan2(dy, dx));
}

export function angleVec2(v: Position): number {
  return radiansToDegrees(Math.atan2(v.y, v.x));
}

// export function fromAngleVec2(angle: number, length: number = 1, ): Position {
//   return { x: Math.cos(angle) * length, y: Math.sin(angle) * length };
// }

export function midPoint<P extends Position>(a: P, b: P): P {
  return new ((a as any).constructor)(
    (a.x + b.x) / 2,
    (a.y + b.y) / 2,
  );
}

/**
 * Computes the intersection point of two lines (defined by their start/end points).
 * Note: treats the inputs as infinite lines, not line segments - so t/u are not
 * clamped to [0, 1]. If you need segment intersection, add a bounds check on t and u.
 *
 * Returns null if the lines are parallel (or coincident).
 */
export function lineIntersection<P extends Position>(
  one: { start: P; end: P },
  two: { start: P; end: P }
): P | null {
  const dx1 = one.end.x - one.start.x;
  const dy1 = one.end.y - one.start.y;
  const dx2 = two.end.x - two.start.x;
  const dy2 = two.end.y - two.start.y;

  // The denominator is the 2D cross product of the two direction vectors.
  // If it's zero, the lines are parallel (or coincident) and don't intersect.
  const denom = dx1 * dy2 - dy1 * dx2;
  if (denom === 0) {
    return null;
  }

  // Solve for t using Cramer's rule
  const originDx = two.start.x - one.start.x;
  const originDy = two.start.y - one.start.y;
  const t = (originDx * dy2 - originDy * dx2) / denom;

  // Plug t back into the parametric equation for line one
  const x = one.start.x + t * dx1;
  const y = one.start.y + t * dy1;

  return new ((one.start as any).constructor)(x, y);
}

export type CohenSutherlandOutcode = number;

/**
 * Cohen-Sutherland line clipping algorithm for fast rejection tests.
 * Used to efficiently determine if line segments or curves might intersect
 * a bounding box without performing expensive geometric tests.
 */
export const CohenSutherland = {
  // Cohen-Sutherland region codes - each bit represents a side of the AABB.
  INSIDE: 0b0000,
  LEFT: 0b0001,
  RIGHT: 0b0010,
  BOTTOM: 0b0100,
  TOP: 0b1000,

  /**
   * Computes the Cohen-Sutherland outcode for a point relative to an AABB.
   * Each bit flags which side(s) of the box the point lies outside of.
   */
  computeOutcode<P extends Position>(point: P, boundingBox: Rect<P>): CohenSutherlandOutcode {
    let code = CohenSutherland.INSIDE;

    if (point.x < boundingBox.position.x) {
      code |= CohenSutherland.LEFT;
    } else if (point.x > boundingBox.position.x + boundingBox.width) {
      code |= CohenSutherland.RIGHT;
    }

    if (point.y < boundingBox.position.y) {
      code |= CohenSutherland.BOTTOM;
    } else if (point.y > boundingBox.position.y + boundingBox.height) {
      code |= CohenSutherland.TOP;
    }

    return code;
  },

  /**
   * Cohen-Sutherland fast rejection test.
   *
   * Returns false if the segment is TRIVIALLY outside the AABB - i.e. both
   * endpoints share a common outside region (same side of a boundary). This
   * is determined purely with a bitwise AND, making it very cheap.
   *
   * Returns true if the segment *might* intersect the AABB. Note this is not
   * a guarantee - diagonal segments near corners can slip through as false
   * positives, so always follow up with a precise test.
   */
  lineSegmentMightIntersectBoundingBox<P extends Position>(segment: LineSegment<P>, aabb: Rect<P>): boolean {
    const outcode1 = CohenSutherland.computeOutcode(segment.start, aabb);
    const outcode2 = CohenSutherland.computeOutcode(segment.end, aabb);
    // Non-zero AND means both endpoints are on the same side - trivially outside.
    return (outcode1 & outcode2) === 0;
  },

  quadraticCurveMightIntersectBoundingBox<P extends Position>(curve: QuadraticCurve<P>, aabb: Rect<P>): boolean {
    return (
      CohenSutherland.lineSegmentMightIntersectBoundingBox({ start: curve.start, end: curve.controlPoint }, aabb) ||
      CohenSutherland.lineSegmentMightIntersectBoundingBox({ start: curve.controlPoint, end: curve.end }, aabb)
    );
  },
  cubicCurveMightIntersectBoundingBox<P extends Position>(curve: CubicCurve<P>, aabb: Rect<P>): boolean {
    return (
      CohenSutherland.lineSegmentMightIntersectBoundingBox({ start: curve.start, end: curve.controlPointA }, aabb) ||
      CohenSutherland.lineSegmentMightIntersectBoundingBox({ start: curve.controlPointB, end: curve.end }, aabb)
    );
  }
};

/**
 * Computes the AABB of a segment from its endpoints.
 */
export function lineSegmentBoundingBox<P extends Position>(segment: LineSegment<P>): Rect<P> {
  const minX = Math.min(segment.start.x, segment.end.x);
  const minY = Math.min(segment.start.y, segment.end.y);
  const maxX = Math.max(segment.start.x, segment.end.x);
  const maxY = Math.max(segment.start.y, segment.end.y);

  return {
    position: new ((segment.start as any).constructor)(minX, minY),
    width: maxX - minX,
    height: maxY - minY,
  };
}

/** Given a quadratic Bezier start (S), end (E), and a midpoint (M) that the curve should pass through
 * at t=0.5, returns the control point Q such that the quadratic curve B(t) = (1-t)^2*S + 2(1-t)t*Q + t^2*E
 * passes through M when t=0.5.
 * Formula derived from: M = 0.25*S + 0.5*Q + 0.25*E  =>  Q = 2M - 0.5*S - 0.5*E */
export function quadraticBezierControlFromMidpoint<P extends Position>(start: P, end: P, midpoint: P): P {
  return new ((start as any).constructor)(
    2 * midpoint.x - 0.5 * start.x - 0.5 * end.x,
    2 * midpoint.y - 0.5 * start.y - 0.5 * end.y,
  );
}

/** Computes the point at t along a cubic Bezier curve using De Casteljau's algorithm.
 * Returns the point at parameter t. */
export function cubicBezierAt<P extends Position>(p0: P, p1: P, p2: P, p3: P, t: number): P {
  const q0 = lerpVec2(p0, p1, t);
  const q1 = lerpVec2(p1, p2, t);
  const q2 = lerpVec2(p2, p3, t);
  const r0 = lerpVec2(q0, q1, t);
  const r1 = lerpVec2(q1, q2, t);
  return lerpVec2(r0, r1, t);
}

/** Given a list of points, compute an axis-aligned bounding box (AABB) which wholly contains them. */
export function boundingBox<P extends Position>(points: Array<P>): Rect<P> {
  if (points.length === 0) {
    throw new Error('math.boundingBox: Cannot compute bounding box of empty array of points!');
  }

  const x = points.map(p => p.x);
  const y = points.map(p => p.y);
  const minX = Math.min(...x);
  const minY = Math.min(...y);
  const maxX = Math.max(...x);
  const maxY = Math.max(...y);

  return {
    position: new ((points[0] as any).constructor)(minX, minY),
    width: maxX - minX,
    height: maxY - minY,
  };
}

/** Inset the given Rect by the given offset. A negative offset performs an "outset" instead. */
export function rectInset<P extends Position>(rect: Rect<P>, offset: number): Rect<P> {
  return {
    position: new ((rect.position as any).constructor)(rect.position.x + offset, rect.position.y + offset),
    width: rect.width - (offset * 2),
    height: rect.height - (offset * 2),
  };
}

/**
 * Creates a bounding box centered on a point with a given radius in pixels.
 * The radius is in the same units as center position passed.
 * Returns a Rect in `center`-type coordinates.
 * @param center - The center point of the AABB.
 * @param radius - The radius in `center`-units.
 * @returns A Rect representing the bounding box in `center` units.
 */
export function proximityBoundingBox<P extends Position>(center: P, radius: number): Rect<P> {
  return {
    position: new ((center as any).constructor)(
      center.x - radius,
      center.y - radius,
    ),
    width: radius * 2,
    height: radius * 2,
  };
}

/** Given a rect, generates the corner points which when drawn would visualize the rect. */
export function rectCorners<P extends Position>(rect: Rect<P>): RectCorners<P> {
  return {
    upperLeft: rect.position,
    upperRight: new ((rect.position as any).constructor)(rect.position.x + rect.width, rect.position.y),
    lowerLeft: new ((rect.position as any).constructor)(rect.position.x, rect.position.y + rect.height),
    lowerRight: new ((rect.position as any).constructor)(rect.position.x + rect.width, rect.position.y + rect.height),
  };
}

/** Given a rect, generates the corner points which when drawn would visualize the rect. */
export function cornersToList<P extends Position>(rect: RectCorners<P>): Array<P> {
  return [rect.upperLeft, rect.upperRight, rect.lowerRight, rect.lowerLeft];
}

/** Computes the closest point on a line segment to a given point.
 * Returns the point on the segment (clamped to endpoints) closest to the query point.
 * Uses projection with clamping - if the projection falls outside the segment, clamps to nearest endpoint.
 */
export function closestPointOnSegment<P extends Position>(segmentStart: P, segmentEnd: P, queryPoint: P): P {
  const dx = segmentEnd.x - segmentStart.x;
  const dy = segmentEnd.y - segmentStart.y;

  if (dx === 0 && dy === 0) {
    return segmentStart;
  }

  const t = ((queryPoint.x - segmentStart.x) * dx + (queryPoint.y - segmentStart.y) * dy) / (dx * dx + dy * dy);

  const clampedT = Math.max(0, Math.min(1, t));

  return new ((segmentStart as any).constructor)(
    segmentStart.x + clampedT * dx,
    segmentStart.y + clampedT * dy,
  );
}

/** Result of closest point computation on a curve, including the parameter t. */
export interface ClosestPointOnCurveResult<P extends Position> {
  point: P;
  t: number;
  distance: number;
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
    d2f: (t: number) => number,
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
      const d2ft = d2f(t);

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
): ClosestPointOnCurveResult<P> {
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
    return d2.x * (pos.x - queryPoint.x) + d2.y * (pos.y - queryPoint.y) + d1.x * d1.x + d1.y * d1.y;
  }

  const result = NewtonRaphson.findClosestT(f, df, () => 0, evalPosition, queryPoint);
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
): ClosestPointOnCurveResult<P> {
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
    return d2.x * (pos.x - queryPoint.x) + d2.y * (pos.y - queryPoint.y) + d1.x * d1.x + d1.y * d1.y;
  }

  const result = NewtonRaphson.findClosestT(f, df, () => 0, evalPosition, queryPoint);
  return { point: result.point, t: result.t, distance: result.distance };
}


export const DeCasteljau = {
  /** Splits a quadratic Bezier at parameter t using De Casteljau's algorithm.
   * Returns [leftCurve, rightCurve] where combining them reproduces the original curve exactly.
   * 
   * For quadratic B(t) = (1-t)^2*P0 + 2(1-t)t*P1 + t^2*P2:
   * - Left: P0, Q0, S  where Q0 = lerp(P0,P1,t), S = lerp(Q0,Q1,t) where Q1=lerp(P1,P2,t)
   * - Right: S, Q2, P2  where Q2 = lerp(P1,P2,t) */
  splitQuadraticBezier<P extends Position>(curve: QuadraticCurve<P>, t: number): [QuadraticCurve<P>, QuadraticCurve<P>] {
    const p0 = curve.start;
    const p1 = curve.controlPoint;
    const p2 = curve.end;

    const q0 = lerpVec2(p0, p1, t);
    const q1 = lerpVec2(p1, p2, t);
    const q2 = lerpVec2(p1, p2, t);
    const s = lerpVec2(q0, q1, t);

    return [
      { start: p0, controlPoint: q0, end: s },
      { start: s, controlPoint: q2, end: p2 },
    ];
  },

  /** Splits a cubic Bezier at parameter t using De Casteljau's algorithm.
   * Returns [leftCurve, rightCurve] where combining them reproduces the original curve exactly.
   * 
   * For cubic B(t) = (1-t)^3*P0 + 3(1-t)^2*t*P1 + 3(1-t)*t^2*P2 + t^3*P3:
   * - Left: P0, Q0, R0, S
   * - Right: S, R1, Q2, P3
   * where Q0=lerp(P0,P1,t), Q1=lerp(P1,P2,t), Q2=lerp(P2,P3,t)
   *       R0=lerp(Q0,Q1,t), R1=lerp(Q1,Q2,t)
   *       S=lerp(R0,R1,t) */
  splitCubicBezier<P extends Position>(curve: CubicCurve<P>, t: number): [CubicCurve<P>, CubicCurve<P>] {
    const p0 = curve.start;
    const p1 = curve.controlPointA;
    const p2 = curve.controlPointB;
    const p3 = curve.end;
    const q0 = lerpVec2(p0, p1, t);
    const q1 = lerpVec2(p1, p2, t);
    const q2 = lerpVec2(p2, p3, t);
    const r0 = lerpVec2(q0, q1, t);
    const r1 = lerpVec2(q1, q2, t);
    const s  = lerpVec2(r0, r1, t);
    return [
      { start: p0, controlPointA: q0, controlPointB: r0, end: s  },
      { start: s,  controlPointA: r1, controlPointB: q2, end: p3 },
    ];
  },

  /** Get a point on a quadratic bezier at parameter t (ratio along the curve) using De Casteljau's algorithm. */
  getQuadraticBezierPointAt<P extends Position>(curve: QuadraticCurve<P>, t: number): P {
    const p0 = curve.start;
    const p1 = curve.controlPoint;
    const p2 = curve.end;

    const q0 = lerpVec2(p0, p1, t);
    const q1 = lerpVec2(p1, p2, t);
    const s = lerpVec2(q0, q1, t);

    return s;
  },

  /** Get a point on a cubic bezier at parameter t (ratio along the curve) using De Casteljau's algorithm. */
  getCubicBezierPointAt<P extends Position>(curve: CubicCurve<P>, t: number): P {
    const p0 = curve.start;
    const p1 = curve.controlPointA;
    const p2 = curve.controlPointB;
    const p3 = curve.end;
    const q0 = lerpVec2(p0, p1, t);
    const q1 = lerpVec2(p1, p2, t);
    const q2 = lerpVec2(p2, p3, t);
    const r0 = lerpVec2(q0, q1, t);
    const r1 = lerpVec2(q1, q2, t);
    const s  = lerpVec2(r0, r1, t);
    return s;
  },
};


/** Converts an ellipse to a polygon with 4 cubic Bezier curves (one per quadrant).
 * Uses the standard k = 4/3*(√2-1) ≈ 0.5523 cubic bezier approximation, which
 * works for both circles (rx == ry) and general ellipses.
 * Returns a PointSegment followed by 4 CubicBezierSegments starting from the
 * rightmost point and going clockwise: right -> top -> left -> bottom -> right. */
export function ellipseToPolygon(
  center: SheetPosition,
  radiusX: number,
  radiusY: number
): Array<PolygonSegment> {
  // Magic constant for cubic bezier quarter-arc approximation: 4/3 * (sqrt(2) - 1).
  // Gives a max radial error of ~0.027% which is imperceptible in practice.
  const k = 0.5522847498;

  const right  = new SheetPosition(center.x + radiusX, center.y);
  const top    = new SheetPosition(center.x,            center.y - radiusY);
  const left   = new SheetPosition(center.x - radiusX, center.y);
  const bottom = new SheetPosition(center.x,            center.y + radiusY);

  // Each quarter needs two control points. The pattern is: the first CP stays
  // at the full radius on the departing axis, the second CP stays at full radius
  // on the arriving axis -- both offset by k on the perpendicular axis.

  // Q1: right -> top (x decreases, y decreases)
  const q1cpA = new SheetPosition(center.x + radiusX,     center.y - radiusY * k);
  const q1cpB = new SheetPosition(center.x + radiusX * k, center.y - radiusY);

  // Q2: top -> left (x decreases, y increases)
  const q2cpA = new SheetPosition(center.x - radiusX * k, center.y - radiusY);
  const q2cpB = new SheetPosition(center.x - radiusX,     center.y - radiusY * k);

  // Q3: left -> bottom (x increases, y increases)
  const q3cpA = new SheetPosition(center.x - radiusX,     center.y + radiusY * k);
  const q3cpB = new SheetPosition(center.x - radiusX * k, center.y + radiusY);

  // Q4: bottom -> right (x increases, y decreases)
  const q4cpA = new SheetPosition(center.x + radiusX * k, center.y + radiusY);
  const q4cpB = new SheetPosition(center.x + radiusX,     center.y + radiusY * k);

  return [
    { type: 'point',     point: right },
    { type: 'arc-cubic', point: top,    controlPointA: q1cpA, controlPointB: q1cpB },
    { type: 'arc-cubic', point: left,   controlPointA: q2cpA, controlPointB: q2cpB },
    { type: 'arc-cubic', point: bottom, controlPointA: q3cpA, controlPointB: q3cpB },
    { type: 'arc-cubic', point: right,  controlPointA: q4cpA, controlPointB: q4cpB },
  ];
}

/** Converts a rectangle to a polygon (array of point segments).
 * Returns 3 PointSegments in order: upperLeft, upperRight, lowerRight.
 * The polygon is NOT closed - caller should add closing point if needed. */
export function rectangleToPolygon(
  upperLeft: SheetPosition,
  lowerRight: SheetPosition
): Array<PointSegment> {
  const upperRight = new SheetPosition(lowerRight.x, upperLeft.y);
  const lowerLeft = new SheetPosition(upperLeft.x, lowerRight.y);

  return [
    { type: 'point', point: upperLeft },
    { type: 'point', point: upperRight },
    { type: 'point', point: lowerRight },
    { type: 'point', point: lowerLeft },
  ];
}
