import { Position } from "./viewport/types";

export function round(n: number, places: number = 0): number {
  const power = Math.pow(10, places);
  return Math.round(n * power) / power;
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

export function angleVec2(v: Position): number {
  return Math.atan2(v.y, v.x);
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
