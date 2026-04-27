import { CubicCurve, LineSegment, Position, QuadraticCurve, Rect, RectCorners } from "../viewport/types";

/**
 * Precise segment-segment intersection test using parametric form.
 * Both t and u must be in [0, 1] for the segments (not infinite lines) to intersect.
 *
 * Returns the intersection point P if the segments intersect along with a ratio along the line
 * where the itnersection occurred, or null if not.
 */
export function computeLineSegmentIntersection<P extends Position>(one: LineSegment<P>, two: LineSegment<P>): [point: P, t: number] | null {
  const dx1 = one.end.x - one.start.x;
  const dy1 = one.end.y - one.start.y;
  const dx2 = two.end.x - two.start.x;
  const dy2 = two.end.y - two.start.y;

  // Cross product of direction vectors - zero means parallel/coincident
  const denom = dx1 * dy2 - dy1 * dx2;
  if (denom === 0) {
    return null;
  }

  const originDx = two.start.x - one.start.x;
  const originDy = two.start.y - one.start.y;

  // Parametric positions along each segment - must both be in [0, 1]
  const t = (originDx * dy2 - originDy * dx2) / denom;
  const u = (originDx * dy1 - originDy * dx1) / denom;

  if (t < 0 || t > 1 || u < 0 || u > 1) {
    return null;
  }

  // Plug t back into the parametric equation for segment one to get the point
  const point = new ((one.start as any).constructor)(
    one.start.x + t * dx1,
    one.start.y + t * dy1,
  );
  return [point, t];
}


const EPSILON = 1e-10;

// -- Polynomial solvers --

/**
 * Solves the quadratic at² + bt + c = 0 analytically.
 * Returns all real roots (0, 1, or 2).
 */
function solveQuadratic(a: number, b: number, c: number): Array<number> {
  if (Math.abs(a) < EPSILON) {
    // Degenerate: linear bt + c = 0
    if (Math.abs(b) < EPSILON) { return []; }
    return [-c / b];
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) { return []; }
  if (Math.abs(disc) < EPSILON) { return [-b / (2 * a)]; }
  const sqrtDisc = Math.sqrt(disc);
  return [(-b + sqrtDisc) / (2 * a), (-b - sqrtDisc) / (2 * a)];
}

/**
 * Solves the cubic at^3 + bt^2 + ct + d = 0 analytically.
 * Returns all real roots (1, 2, or 3).
 *
 * Uses the trigonometric method for three-root cases (avoids complex arithmetic),
 * and Cardano's formula for the one-root and repeated-root cases.
 */
function solveCubic(a: number, b: number, c: number, d: number): Array<number> {
  if (Math.abs(a) < EPSILON) {
    return solveQuadratic(b, c, d);
  }

  // Normalize to monic form, then depress via t = u - B/3 to get u³ + pu + q = 0
  const B = b / a;
  const C = c / a;
  const D = d / a;
  const p = C - B * B / 3;
  const q = 2 * B * B * B / 27 - B * C / 3 + D;
  const shift = -B / 3;

  // Discriminant of the depressed cubic:
  //   > 0: three distinct real roots
  //   = 0: repeated root
  //   < 0: one real root, two complex conjugates
  const discriminant = -(4 * p * p * p + 27 * q * q);

  if (discriminant > EPSILON) {
    // Three distinct real roots -- trigonometric method.
    // Guaranteed p < 0 in this branch, so sqrt(-p/3) is real.
    const m = 2 * Math.sqrt(-p / 3);
    // Clamp to [-1, 1] to guard against floating point drift at the boundary
    const arcCosArg = Math.max(-1, Math.min(1, 3 * q / (p * m)));
    const theta = Math.acos(arcCosArg) / 3;
    return [
      m * Math.cos(theta) + shift,
      m * Math.cos(theta - 2 * Math.PI / 3) + shift,
      m * Math.cos(theta - 4 * Math.PI / 3) + shift,
    ];
  }

  // One or two distinct real roots -- Cardano's formula.
  // cardanoTerm = q²/4 + p³/27; zero means a repeated root exists.
  const cardanoTerm = q * q / 4 + p * p * p / 27;

  if (Math.abs(cardanoTerm) < EPSILON) {
    // discriminant ≈ 0: a double root and a simple root (or triple if p = q = 0).
    if (Math.abs(p) < EPSILON) {
      // Triple root at the shift
      return [shift];
    }
    // Double root α = cbrt(q/2), simple root β = -2α.
    // Derivation: factoring (u - α)²(u - β) against u³ + pu + q gives
    // β = -2α, -3α² = p, and 2α³ = q.
    const alpha = Math.cbrt(q / 2);
    return [alpha + shift, -2 * alpha + shift];
  }

  // One real root -- standard Cardano
  const sqrtTerm = Math.sqrt(Math.max(0, cardanoTerm));
  const u = Math.cbrt(-q / 2 + sqrtTerm);
  const v = Math.cbrt(-q / 2 - sqrtTerm);
  return [u + v + shift];
}

// -- Coordinate transform --

/**
 * Rotates a point into segment-local space, where the segment lies along the
 * positive X axis with its start at the origin.
 */
function toSegmentSpace(
  point: Position,
  segStart: Position,
  cos: number,
  sin: number
): { x: number; y: number } {
  const dx = point.x - segStart.x;
  const dy = point.y - segStart.y;
  return {
    x:  dx * cos + dy * sin,
    y: -dx * sin + dy * cos,
  };
}

// -- Intersection functions --

/**
 * Computes exact intersection points between a line segment and a quadratic bezier curve.
 *
 * Strategy: rotate into segment space so the segment lies on the X axis, then find
 * parameter values t where the bezier Y(t) = 0 -- a quadratic equation. Filter by
 * t in [0, 1] (on the curve) and X in [0, segmentLength] (within the segment).
 *
 * Extra fields on P beyond x/y are sourced from curve.start as a best-effort default.
 */
export function computeLineSegmentQuadraticCurveIntersections<P extends Position>(
  segment: LineSegment<P>,
  curve: QuadraticCurve<P>,
): Array<[point: P, t: number]> {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < EPSILON) { return []; }

  const cos = dx / len;
  const sin = dy / len;

  // Transform control points into segment space
  const p0 = toSegmentSpace(curve.start, segment.start, cos, sin);
  const p1 = toSegmentSpace(curve.controlPoint, segment.start, cos, sin);
  const p2 = toSegmentSpace(curve.end, segment.start, cos, sin);

  // Quadratic bezier Y(t) = (1-t)²y₀ + 2t(1-t)y₁ + t²y₂ = 0
  // Expanded: (y₀ - 2y₁ + y₂)t² + 2(y₁ - y₀)t + y₀ = 0
  const a = p0.y - 2 * p1.y + p2.y;
  const b = 2 * (p1.y - p0.y);
  const c = p0.y;

  const results: Array<[P, number]> = [];
  for (const t of solveQuadratic(a, b, c)) {
    if (t < -EPSILON || t > 1 + EPSILON) { continue; }
    const tc = Math.max(0, Math.min(1, t));
    const mt = 1 - tc;

    // Verify X lands within the segment's extent [0, len]
    const x = mt * mt * p0.x + 2 * mt * tc * p1.x + tc * tc * p2.x;
    if (x < -EPSILON || x > len + EPSILON) { continue; }

    // Reconstruct the world-space point from the original (untransformed) curve
    // to avoid accumulating rotation errors
    const point = new ((curve.start as any).constructor)(
      mt * mt * curve.start.x + 2 * mt * tc * curve.controlPoint.x + tc * tc * curve.end.x,
      mt * mt * curve.start.y + 2 * mt * tc * curve.controlPoint.y + tc * tc * curve.end.y,
    );
    results.push([point, t]);
  }
  return results;
}

/**
 * Computes exact intersection points between a line segment and a cubic bezier curve.
 *
 * Same strategy as the quadratic case, but Y(t) = 0 is now a cubic equation,
 * solved analytically via Cardano's formula and the trigonometric method.
 *
 * Extra fields on P beyond x/y are sourced from curve.start as a best-effort default.
 */
export function computeLineSegmentCubicCurveIntersections<P extends Position>(
  segment: LineSegment<P>,
  curve: CubicCurve<P>,
): Array<[point: P, t: number]> {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < EPSILON) { return []; }

  const cos = dx / len;
  const sin = dy / len;

  const p0 = toSegmentSpace(curve.start, segment.start, cos, sin);
  const p1 = toSegmentSpace(curve.controlPointA, segment.start, cos, sin);
  const p2 = toSegmentSpace(curve.controlPointB, segment.start, cos, sin);
  const p3 = toSegmentSpace(curve.end, segment.start, cos, sin);

  // Cubic bezier Y(t) = (1-t)³y₀ + 3t(1-t)²y₁ + 3t²(1-t)y₂ + t³y₃ = 0
  // Expanded polynomial coefficients:
  //   t³: -y₀ + 3y₁ - 3y₂ + y₃
  //   t²:  3y₀ - 6y₁ + 3y₂
  //   t¹: -3y₀ + 3y₁
  //   t⁰:  y₀
  const a = -p0.y + 3 * p1.y - 3 * p2.y + p3.y;
  const b =  3 * p0.y - 6 * p1.y + 3 * p2.y;
  const c = -3 * p0.y + 3 * p1.y;
  const d =  p0.y;

  const results: Array<[P, number]> = [];
  for (const t of solveCubic(a, b, c, d)) {
    if (t < -EPSILON || t > 1 + EPSILON) { continue; }
    const tc = Math.max(0, Math.min(1, t));
    const mt = 1 - tc;

    // Verify X lands within the segment's extent [0, len]
    const x = mt*mt*mt * p0.x + 3*mt*mt*tc * p1.x + 3*mt*tc*tc * p2.x + tc*tc*tc * p3.x;
    if (x < -EPSILON || x > len + EPSILON) { continue; }

    // Reconstruct world-space point from original control points
    const point = new ((curve.start as any).constructor)(
      mt*mt*mt * curve.start.x + 3*mt*mt*tc * curve.controlPointA.x + 3*mt*tc*tc * curve.controlPointB.x + tc*tc*tc * curve.end.x,
      mt*mt*mt * curve.start.y + 3*mt*mt*tc * curve.controlPointA.y + 3*mt*tc*tc * curve.controlPointB.y + tc*tc*tc * curve.end.y,
    );
    results.push([point, t]);
  }
  return results;
}

/** A set of functions for computing the intersection of many types of geometries. */
export const Intersection = {
  computeLineSegmentIntersection,
  computeLineSegmentCubicCurveIntersections,
  computeLineSegmentQuadraticCurveIntersections,
};
