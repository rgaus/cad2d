import { CubicCurve, LineSegment, Position, QuadraticCurve } from '../viewport/types';

/**
 * Precise segment-segment intersection test using parametric form.
 * Both t and u must be in [0, 1] for the segments (not infinite lines) to intersect.
 *
 * Returns the intersection point P if the segments intersect along with a ratio along the line
 * where the itnersection occurred, or null if not.
 */
export function computeLineSegmentIntersection<P extends Position>(
  one: LineSegment<P>,
  two: LineSegment<P>,
): [point: P, t: number, u: number] | null {
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
  const point = new (one.start as any).constructor(one.start.x + t * dx1, one.start.y + t * dy1);
  return [point, t, u];
}

const EPSILON = 1e-10;

// -- Polynomial solvers --

/**
 * Solves the quadratic at² + bt + c = 0 analytically.
 * Returns all real roots (0, 1, or 2).
 */
export function solveQuadratic(a: number, b: number, c: number): Array<number> {
  if (Math.abs(a) < EPSILON) {
    // Degenerate: linear bt + c = 0
    if (Math.abs(b) < EPSILON) {
      return [];
    }
    return [-c / b];
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) {
    return [];
  }
  if (Math.abs(disc) < EPSILON) {
    return [-b / (2 * a)];
  }
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
export function solveCubic(a: number, b: number, c: number, d: number): Array<number> {
  if (Math.abs(a) < EPSILON) {
    return solveQuadratic(b, c, d);
  }

  // Normalize to monic form, then depress via t = u - B/3 to get u³ + pu + q = 0
  const B = b / a;
  const C = c / a;
  const D = d / a;
  const p = C - (B * B) / 3;
  const q = (2 * B * B * B) / 27 - (B * C) / 3 + D;
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
    const arcCosArg = Math.max(-1, Math.min(1, (3 * q) / (p * m)));
    const theta = Math.acos(arcCosArg) / 3;
    return [
      m * Math.cos(theta) + shift,
      m * Math.cos(theta - (2 * Math.PI) / 3) + shift,
      m * Math.cos(theta - (4 * Math.PI) / 3) + shift,
    ];
  }

  // One or two distinct real roots -- Cardano's formula.
  // cardanoTerm = q²/4 + p³/27; zero means a repeated root exists.
  const cardanoTerm = (q * q) / 4 + (p * p * p) / 27;

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
  sin: number,
): { x: number; y: number } {
  const dx = point.x - segStart.x;
  const dy = point.y - segStart.y;
  return {
    x: dx * cos + dy * sin,
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
): Array<[point: P, t: number, u: number]> {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < EPSILON) {
    return [];
  }

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

  const results: Array<[P, number, number]> = [];
  for (const t of solveQuadratic(a, b, c)) {
    if (t < -EPSILON || t > 1 + EPSILON) {
      continue;
    }
    const tc = Math.max(0, Math.min(1, t));
    const mt = 1 - tc;

    // Verify X lands within the segment's extent [0, len]
    const x = mt * mt * p0.x + 2 * mt * tc * p1.x + tc * tc * p2.x;
    if (x < -EPSILON || x > len + EPSILON) {
      continue;
    }

    // Reconstruct the world-space point from the original (untransformed) curve
    // to avoid accumulating rotation errors
    const point = new (curve.start as any).constructor(
      mt * mt * curve.start.x + 2 * mt * tc * curve.controlPoint.x + tc * tc * curve.end.x,
      mt * mt * curve.start.y + 2 * mt * tc * curve.controlPoint.y + tc * tc * curve.end.y,
    );
    results.push([point, x / len, t]);
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
): Array<[point: P, t: number, u: number]> {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < EPSILON) {
    return [];
  }

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
  const b = 3 * p0.y - 6 * p1.y + 3 * p2.y;
  const c = -3 * p0.y + 3 * p1.y;
  const d = p0.y;

  const results: Array<[P, number, number]> = [];
  for (const t of solveCubic(a, b, c, d)) {
    if (t < -EPSILON || t > 1 + EPSILON) {
      continue;
    }
    const tc = Math.max(0, Math.min(1, t));
    const mt = 1 - tc;

    // Verify X lands within the segment's extent [0, len]
    const x =
      mt * mt * mt * p0.x + 3 * mt * mt * tc * p1.x + 3 * mt * tc * tc * p2.x + tc * tc * tc * p3.x;
    if (x < -EPSILON || x > len + EPSILON) {
      continue;
    }

    // Reconstruct world-space point from original control points
    const point = new (curve.start as any).constructor(
      mt * mt * mt * curve.start.x +
        3 * mt * mt * tc * curve.controlPointA.x +
        3 * mt * tc * tc * curve.controlPointB.x +
        tc * tc * tc * curve.end.x,
      mt * mt * mt * curve.start.y +
        3 * mt * mt * tc * curve.controlPointA.y +
        3 * mt * tc * tc * curve.controlPointB.y +
        tc * tc * tc * curve.end.y,
    );
    results.push([point, x / len, t]);
  }
  return results;
}

/**
 * Samples a function at regular intervals and finds the pair of parameters (t, u)
 * that minimize the distance between two curves.
 */
function sampleCurvesForIntersection<P extends Position>(
  evalA: (t: number) => { x: number; y: number },
  evalB: (t: number) => { x: number; y: number },
  samples: number,
): { t: number; u: number; distance: number } {
  let bestT = 0;
  let bestU = 0;
  let bestDist = Infinity;

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const pointA = evalA(t);

    for (let j = 0; j <= samples; j++) {
      const u = j / samples;
      const pointB = evalB(u);

      const dx = pointA.x - pointB.x;
      const dy = pointA.y - pointB.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < bestDist) {
        bestDist = dist;
        bestT = t;
        bestU = u;
      }
    }
  }

  return { t: bestT, u: bestU, distance: bestDist };
}

/**
 * Finds the parameters (t, u) where two quadratic curves are closest/touching using Newton-Raphson.
 * Minimizes |Q1(t) - Q2(u)|².
 */
function refineCurveCurveParameters(
  t: number,
  u: number,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  q0: { x: number; y: number },
  q1: { x: number; y: number },
  q2: { x: number; y: number },
  maxIterations: number = 10,
): { t: number; u: number } {
  let currT = t;
  let currU = u;

  for (let iter = 0; iter < maxIterations; iter++) {
    const mt = 1 - currT;
    const mu = 1 - currU;

    const QA = {
      x: mt * mt * p0.x + 2 * mt * currT * p1.x + currT * currT * p2.x,
      y: mt * mt * p0.y + 2 * mt * currT * p1.y + currT * currT * p2.y,
    };
    const QB = {
      x: mu * mu * q0.x + 2 * mu * currU * q1.x + currU * currU * q2.x,
      y: mu * mu * q0.y + 2 * mu * currU * q1.y + currU * currU * q2.y,
    };

    const dQxdt = 2 * (1 - currT) * (p1.x - p0.x) + 2 * currT * (p2.x - p1.x);
    const dQydt = 2 * (1 - currT) * (p1.y - p0.y) + 2 * currT * (p2.y - p1.y);
    const dQxdu = 2 * (1 - currU) * (q1.x - q0.x) + 2 * currU * (q2.x - q1.x);
    const dQydu = 2 * (1 - currU) * (q1.y - q0.y) + 2 * currU * (q2.y - q1.y);

    const fx = QA.x - QB.x;
    const fy = QA.y - QB.y;

    const denom = dQxdt * dQydu - dQydt * dQxdu;
    if (Math.abs(denom) < 1e-12) {
      break;
    }

    const deltaT = (fx * dQydu - fy * dQxdu) / denom;
    const deltaU = (fy * dQxdt - fx * dQydt) / denom;

    currT = Math.max(0, Math.min(1, currT - deltaT));
    currU = Math.max(0, Math.min(1, currU - deltaU));

    if (Math.abs(deltaT) < 1e-10 && Math.abs(deltaU) < 1e-10) {
      break;
    }
  }

  return { t: currT, u: currU };
}

/**
 * Computes exact intersection points between two quadratic bezier curves.
 *
 * Strategy: sample both curves to find rough (t, u) pairs where they're close,
 * then refine with Newton-Raphson.
 */
export function computeQuadraticQuadraticCurveIntersections<P extends Position>(
  curveA: QuadraticCurve<P>,
  curveB: QuadraticCurve<P>,
): Array<[point: P, t: number, u: number]> {
  const p0 = curveA.start;
  const p1 = curveA.controlPoint;
  const p2 = curveA.end;
  const q0 = curveB.start;
  const q1 = curveB.controlPoint;
  const q2 = curveB.end;

  const evalA = (t: number) => ({
    x: (1 - t) * (1 - t) * p0.x + 2 * t * (1 - t) * p1.x + t * t * p2.x,
    y: (1 - t) * (1 - t) * p0.y + 2 * t * (1 - t) * p1.y + t * t * p2.y,
  });
  const evalB = (u: number) => ({
    x: (1 - u) * (1 - u) * q0.x + 2 * u * (1 - u) * q1.x + u * u * q2.x,
    y: (1 - u) * (1 - u) * q0.y + 2 * u * (1 - u) * q1.y + u * u * q2.y,
  });

  const sampled = sampleCurvesForIntersection(evalA, evalB, 20);

  if (sampled.distance > 0.1) {
    return [];
  }

  const refined = refineCurveCurveParameters(sampled.t, sampled.u, p0, p1, p2, q0, q1, q2);

  const mt = 1 - refined.t;
  const mu = 1 - refined.u;
  const point = new (curveA.start as any).constructor(
    mt * mt * p0.x + 2 * mt * refined.t * p1.x + refined.t * refined.t * p2.x,
    mt * mt * p0.y + 2 * mt * refined.t * p1.y + refined.t * refined.t * p2.y,
  );

  return [[point, refined.t, refined.u]];
}

/**
 * Finds the parameters (t, u) where two cubic curves are closest/touching.
 * Minimizes |C1(t) - C2(u)|² via Newton-Raphson.
 */
function refineCubicCurveParameters(
  t: number,
  u: number,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  q0: { x: number; y: number },
  q1: { x: number; y: number },
  q2: { x: number; y: number },
  q3: { x: number; y: number },
  maxIterations: number = 10,
): { t: number; u: number } {
  let currT = t;
  let currU = u;

  for (let iter = 0; iter < maxIterations; iter++) {
    const mt = 1 - currT;
    const mu = 1 - currU;

    const CA = {
      x:
        mt * mt * mt * p0.x +
        3 * mt * mt * currT * p1.x +
        3 * mt * currT * currT * p2.x +
        currT * currT * currT * p3.x,
      y:
        mt * mt * mt * p0.y +
        3 * mt * mt * currT * p1.y +
        3 * mt * currT * currT * p2.y +
        currT * currT * currT * p3.y,
    };
    const CB = {
      x:
        mu * mu * mu * q0.x +
        3 * mu * mu * currU * q1.x +
        3 * mu * currU * currU * q2.x +
        currU * currU * currU * q3.x,
      y:
        mu * mu * mu * q0.y +
        3 * mu * mu * currU * q1.y +
        3 * mu * currU * currU * q2.y +
        currU * currU * currU * q3.y,
    };

    const dCxdt =
      3 * mt * mt * (p1.x - p0.x) +
      6 * mt * currT * (p2.x - p1.x) +
      3 * currT * currT * (p3.x - p2.x);
    const dCydt =
      3 * mt * mt * (p1.y - p0.y) +
      6 * mt * currT * (p2.y - p1.y) +
      3 * currT * currT * (p3.y - p2.y);
    const dCxdu =
      3 * mu * mu * (q1.x - q0.x) +
      6 * mu * currU * (q2.x - q1.x) +
      3 * currU * currU * (q3.x - q2.x);
    const dCydu =
      3 * mu * mu * (q1.y - q0.y) +
      6 * mu * currU * (q2.y - q1.y) +
      3 * currU * currU * (q3.y - q2.y);

    const fx = CA.x - CB.x;
    const fy = CA.y - CB.y;

    const denom = dCxdt * dCydu - dCydt * dCxdu;
    if (Math.abs(denom) < 1e-12) {
      break;
    }

    const deltaT = (fx * dCydu - fy * dCxdu) / denom;
    const deltaU = (fy * dCxdt - fx * dCydt) / denom;

    currT = Math.max(0, Math.min(1, currT - deltaT));
    currU = Math.max(0, Math.min(1, currU - deltaU));

    if (Math.abs(deltaT) < 1e-10 && Math.abs(deltaU) < 1e-10) {
      break;
    }
  }

  return { t: currT, u: currU };
}

/**
 * Computes exact intersection points between two cubic bezier curves.
 *
 * Strategy: sample both curves to find rough (t, u) pairs where they're close,
 * then refine with Newton-Raphson.
 */
export function computeCubicCubicCurveIntersections<P extends Position>(
  curveA: CubicCurve<P>,
  curveB: CubicCurve<P>,
): Array<[point: P, t: number, u: number]> {
  const p0 = curveA.start;
  const p1 = curveA.controlPointA;
  const p2 = curveA.controlPointB;
  const p3 = curveA.end;
  const q0 = curveB.start;
  const q1 = curveB.controlPointA;
  const q2 = curveB.controlPointB;
  const q3 = curveB.end;

  const evalA = (t: number) => ({
    x:
      (1 - t) * (1 - t) * (1 - t) * p0.x +
      3 * t * (1 - t) * (1 - t) * p1.x +
      3 * t * t * (1 - t) * p2.x +
      t * t * t * p3.x,
    y:
      (1 - t) * (1 - t) * (1 - t) * p0.y +
      3 * t * (1 - t) * (1 - t) * p1.y +
      3 * t * t * (1 - t) * p2.y +
      t * t * t * p3.y,
  });
  const evalB = (u: number) => ({
    x:
      (1 - u) * (1 - u) * (1 - u) * q0.x +
      3 * u * (1 - u) * (1 - u) * q1.x +
      3 * u * u * (1 - u) * q2.x +
      u * u * u * q3.x,
    y:
      (1 - u) * (1 - u) * (1 - u) * q0.y +
      3 * u * (1 - u) * (1 - u) * q1.y +
      3 * u * u * (1 - u) * q2.y +
      u * u * u * q3.y,
  });

  const sampled = sampleCurvesForIntersection(evalA, evalB, 20);

  if (sampled.distance > 0.1) {
    return [];
  }

  const refined = refineCubicCurveParameters(sampled.t, sampled.u, p0, p1, p2, p3, q0, q1, q2, q3);

  const mt = 1 - refined.t;
  const point = new (curveA.start as any).constructor(
    mt * mt * mt * p0.x +
      3 * mt * mt * refined.t * p1.x +
      3 * mt * refined.t * refined.t * p2.x +
      refined.t * refined.t * refined.t * p3.x,
    mt * mt * mt * p0.y +
      3 * mt * mt * refined.t * p1.y +
      3 * mt * refined.t * refined.t * p2.y +
      refined.t * refined.t * refined.t * p3.y,
  );

  return [[point, refined.t, refined.u]];
}

/**
 * Computes exact intersection points between a quadratic and a cubic bezier curve.
 *
 * Strategy: sample both curves to find rough (t, u) pairs where they're close,
 * then refine with Newton-Raphson.
 */
export function computeQuadraticCubicCurveIntersections<P extends Position>(
  quadCurve: QuadraticCurve<P>,
  cubicCurve: CubicCurve<P>,
): Array<[point: P, t: number, u: number]> {
  const p0 = quadCurve.start;
  const p1 = quadCurve.controlPoint;
  const p2 = quadCurve.end;
  const q0 = cubicCurve.start;
  const q1 = cubicCurve.controlPointA;
  const q2 = cubicCurve.controlPointB;
  const q3 = cubicCurve.end;

  const evalQuad = (t: number) => ({
    x: (1 - t) * (1 - t) * p0.x + 2 * t * (1 - t) * p1.x + t * t * p2.x,
    y: (1 - t) * (1 - t) * p0.y + 2 * t * (1 - t) * p1.y + t * t * p2.y,
  });
  const evalCubic = (u: number) => ({
    x:
      (1 - u) * (1 - u) * (1 - u) * q0.x +
      3 * u * (1 - u) * (1 - u) * q1.x +
      3 * u * u * (1 - u) * q2.x +
      u * u * u * q3.x,
    y:
      (1 - u) * (1 - u) * (1 - u) * q0.y +
      3 * u * (1 - u) * (1 - u) * q1.y +
      3 * u * u * (1 - u) * q2.y +
      u * u * u * q3.y,
  });

  const sampled = sampleCurvesForIntersection(evalQuad, evalCubic, 20);

  if (sampled.distance > 0.1) {
    return [];
  }

  const refined = refineMixedCurveParameters(sampled.t, sampled.u, p0, p1, p2, q0, q1, q2, q3);

  const mt = 1 - refined.t;
  const point = new (quadCurve.start as any).constructor(
    mt * mt * p0.x + 2 * mt * refined.t * p1.x + refined.t * refined.t * p2.x,
    mt * mt * p0.y + 2 * mt * refined.t * p1.y + refined.t * refined.t * p2.y,
  );

  return [[point, refined.t, refined.u]];
}

/**
 * Finds the parameters where quadratic and cubic curves are closest/touching.
 */
function refineMixedCurveParameters(
  t: number,
  u: number,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  q0: { x: number; y: number },
  q1: { x: number; y: number },
  q2: { x: number; y: number },
  q3: { x: number; y: number },
  maxIterations: number = 10,
): { t: number; u: number } {
  let currT = t;
  let currU = u;

  for (let iter = 0; iter < maxIterations; iter++) {
    const mt = 1 - currT;
    const mu = 1 - currU;

    const QA = {
      x: mt * mt * p0.x + 2 * mt * currT * p1.x + currT * currT * p2.x,
      y: mt * mt * p0.y + 2 * mt * currT * p1.y + currT * currT * p2.y,
    };
    const CB = {
      x:
        mu * mu * mu * q0.x +
        3 * mu * mu * currU * q1.x +
        3 * mu * currU * currU * q2.x +
        currU * currU * currU * q3.x,
      y:
        mu * mu * mu * q0.y +
        3 * mu * mu * currU * q1.y +
        3 * mu * currU * currU * q2.y +
        currU * currU * currU * q3.y,
    };

    const dQxdt = 2 * (1 - currT) * (p1.x - p0.x) + 2 * currT * (p2.x - p1.x);
    const dQydt = 2 * (1 - currT) * (p1.y - p0.y) + 2 * currT * (p2.y - p1.y);
    const dCxdu =
      3 * mu * mu * (q1.x - q0.x) +
      6 * mu * currU * (q2.x - q1.x) +
      3 * currU * currU * (q3.x - q2.x);
    const dCydu =
      3 * mu * mu * (q1.y - q0.y) +
      6 * mu * currU * (q2.y - q1.y) +
      3 * currU * currU * (q3.y - q2.y);

    const fx = QA.x - CB.x;
    const fy = QA.y - CB.y;

    const denom = dQxdt * dCydu - dQydt * dCxdu;
    if (Math.abs(denom) < 1e-12) {
      break;
    }

    const deltaT = (fx * dCydu - fy * dCxdu) / denom;
    const deltaU = (fy * dQxdt - fx * dQydt) / denom;

    currT = Math.max(0, Math.min(1, currT - deltaT));
    currU = Math.max(0, Math.min(1, currU - deltaU));

    if (Math.abs(deltaT) < 1e-10 && Math.abs(deltaU) < 1e-10) {
      break;
    }
  }

  return { t: currT, u: currU };
}

/** Computes all intersections between a pair of segments.
 *
 * NOTE on argument order convention: every helper called here returns
 * `[point, t, u]` where `t` is the parametric position on the *first*
 * argument and `u` is on the *second* argument. When a helper's argument
 * order differs from (segA, segB), the returned (t, u) must be swapped
 * so that the final result is always [point, tOnSegA, tOnSegB].
 *
 * @param segA - First segment.
 * @param segB - Second segment.
 * @returns Array of [intersectionPoint, tOnSegA, tOnSegB].
 */
function computeSegmentPairIntersections<P extends Position>(
  segA: LineSegment<P> | QuadraticCurve<P> | CubicCurve<P>,
  segB: LineSegment<P> | QuadraticCurve<P> | CubicCurve<P>,
): Array<[P, number, number]> {
  const results: Array<[P, number, number]> = [];

  const isLineA = !QuadraticCurve.isQuadraticCurve(segA);
  const isLineB = !QuadraticCurve.isQuadraticCurve(segB);
  const isQuadA = QuadraticCurve.isQuadraticCurve(segA) && !CubicCurve.isCubicCurve(segA);
  const isQuadB = QuadraticCurve.isQuadraticCurve(segB) && !CubicCurve.isCubicCurve(segB);
  const isCubicA = CubicCurve.isCubicCurve(segA);
  const isCubicB = CubicCurve.isCubicCurve(segB);

  if (isLineA && isLineB) {
    const result = Intersection.computeLineSegmentIntersection(segA, segB);
    if (result) {
      results.push([result[0], result[1], result[2]]);
    }
  } else if (isLineA && isQuadB) {
    // (segA, segB) order matches helper — pass through
    return Intersection.computeLineSegmentQuadraticCurveIntersections(segA, segB).map(
      ([point, t, u]) => [point, t, u],
    );
  } else if (isLineA && isCubicB) {
    // (segA, segB) order matches helper — pass through
    return Intersection.computeLineSegmentCubicCurveIntersections(segA, segB).map(
      ([point, t, u]) => [point, t, u],
    );
  } else if (isQuadA && isLineB) {
    // Helper expects (line, curve) — swap args, then swap returned (t, u) to match (segA, segB)
    return Intersection.computeLineSegmentQuadraticCurveIntersections(segB, segA).map(
      ([point, t, u]) => [point, u, t],
    );
  } else if (isQuadA && isQuadB) {
    return Intersection.computeQuadraticQuadraticCurveIntersections(
      segA as QuadraticCurve<P>,
      segB as QuadraticCurve<P>,
    );
  } else if (isQuadA && isCubicB) {
    return Intersection.computeQuadraticCubicCurveIntersections(
      segA as QuadraticCurve<P>,
      segB as CubicCurve<P>,
    );
  } else if (isCubicA && isLineB) {
    // Helper expects (line, curve) — swap args, then swap returned (t, u) to match (segA, segB)
    return Intersection.computeLineSegmentCubicCurveIntersections(segB, segA).map(
      ([point, t, u]) => [point, u, t],
    );
  } else if (isCubicA && isQuadB) {
    // Helper expects (quad, cubic) — swap args, then swap returned (t, u) to match (segA, segB)
    return Intersection.computeQuadraticCubicCurveIntersections(
      segB as QuadraticCurve<P>,
      segA as CubicCurve<P>,
    ).map(([point, t, u]) => [point, u, t]);
  } else if (isCubicA && isCubicB) {
    return Intersection.computeCubicCubicCurveIntersections(
      segA as CubicCurve<P>,
      segB as CubicCurve<P>,
    );
  }

  return results;
}
/** A set of functions for computing the intersection of many types of geometries. */
export const Intersection = {
  computeLineSegmentIntersection,
  computeLineSegmentCubicCurveIntersections,
  computeLineSegmentQuadraticCurveIntersections,
  computeQuadraticQuadraticCurveIntersections,
  computeCubicCubicCurveIntersections,
  computeQuadraticCubicCurveIntersections,
  computeSegmentPairIntersections,
};
