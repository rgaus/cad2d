import { CubicCurve, Position, QuadraticCurve } from '@/lib/viewport/types';
import { Vector2 } from './vector';

/** Computes the point at t along a cubic Bezier curve using De Casteljau's algorithm.
 * Returns the point at parameter t. */
export function cubicBezierAt<P extends Position>(p0: P, p1: P, p2: P, p3: P, t: number): P {
  const q0 = Vector2.lerp(p0, p1, t);
  const q1 = Vector2.lerp(p1, p2, t);
  const q2 = Vector2.lerp(p2, p3, t);
  const r0 = Vector2.lerp(q0, q1, t);
  const r1 = Vector2.lerp(q1, q2, t);
  return Vector2.lerp(r0, r1, t);
}

export const DeCasteljau = {
  /** Splits a quadratic Bezier at parameter t using De Casteljau's algorithm.
   * Returns [leftCurve, rightCurve] where combining them reproduces the original curve exactly.
   *
   * For quadratic B(t) = (1-t)^2*P0 + 2(1-t)t*P1 + t^2*P2:
   * - Left: P0, Q0, S  where Q0 = lerp(P0,P1,t), S = lerp(Q0,Q1,t) where Q1=lerp(P1,P2,t)
   * - Right: S, Q2, P2  where Q2 = lerp(P1,P2,t) */
  splitQuadraticBezier<P extends Position>(
    curve: QuadraticCurve<P>,
    t: number,
  ): [QuadraticCurve<P>, QuadraticCurve<P>] {
    const p0 = curve.start;
    const p1 = curve.controlPoint;
    const p2 = curve.end;

    const q0 = Vector2.lerp(p0, p1, t);
    const q1 = Vector2.lerp(p1, p2, t);
    const q2 = Vector2.lerp(p1, p2, t);
    const s = Vector2.lerp(q0, q1, t);

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
  splitCubicBezier<P extends Position>(
    curve: CubicCurve<P>,
    t: number,
  ): [CubicCurve<P>, CubicCurve<P>] {
    const p0 = curve.start;
    const p1 = curve.controlPointA;
    const p2 = curve.controlPointB;
    const p3 = curve.end;
    const q0 = Vector2.lerp(p0, p1, t);
    const q1 = Vector2.lerp(p1, p2, t);
    const q2 = Vector2.lerp(p2, p3, t);
    const r0 = Vector2.lerp(q0, q1, t);
    const r1 = Vector2.lerp(q1, q2, t);
    const s = Vector2.lerp(r0, r1, t);
    return [
      { start: p0, controlPointA: q0, controlPointB: r0, end: s },
      { start: s, controlPointA: r1, controlPointB: q2, end: p3 },
    ];
  },

  /** Get a point on a quadratic bezier at parameter t (ratio along the curve) using De Casteljau's algorithm. */
  getQuadraticBezierPointAt<P extends Position>(curve: QuadraticCurve<P>, t: number): P {
    const p0 = curve.start;
    const p1 = curve.controlPoint;
    const p2 = curve.end;

    const q0 = Vector2.lerp(p0, p1, t);
    const q1 = Vector2.lerp(p1, p2, t);
    const s = Vector2.lerp(q0, q1, t);

    return s;
  },

  /** Get a point on a cubic bezier at parameter t (ratio along the curve) using De Casteljau's algorithm. */
  getCubicBezierPointAt<P extends Position>(curve: CubicCurve<P>, t: number): P {
    const p0 = curve.start;
    const p1 = curve.controlPointA;
    const p2 = curve.controlPointB;
    const p3 = curve.end;
    const q0 = Vector2.lerp(p0, p1, t);
    const q1 = Vector2.lerp(p1, p2, t);
    const q2 = Vector2.lerp(p2, p3, t);
    const r0 = Vector2.lerp(q0, q1, t);
    const r1 = Vector2.lerp(q1, q2, t);
    const s = Vector2.lerp(r0, r1, t);
    return s;
  },
};
