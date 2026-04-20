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
