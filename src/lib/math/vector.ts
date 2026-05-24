import { type Position } from "@/lib/viewport/types";
import { degreesToRadians, radiansToDegrees } from "./angle";

/**
 * Adds two vectors component-wise (a.x + b.x, a.y + b.y).
 * Useful for applying a displacement or offset to a point,
 * e.g. moving a corner by a drag delta.
 */
export function addVec2<P extends Position>(a: P, ...bs: Array<P>): P {
  let x = a.x;
  let y = a.y;
  for (const b of bs) {
    x += b.x;
    y += b.y;
  }
  return new ((a as any).constructor)(x, y);
}

/**
 * Subtracts vector b from vector a (a.x - b.x, a.y - b.y).
 * Useful for finding the direction/displacement from b to a,
 * e.g. computing the vector from a polygon vertex to the cursor.
 */
export function subVec2<P extends Position>(a: P, ...bs: Array<P>): P {
  let x = a.x;
  let y = a.y;
  for (const b of bs) {
    x -= b.x;
    y -= b.y;
  }
  return new ((a as any).constructor)(x, y);
}

/**
 * Multiplies each component of vector v by scalar s.
 * Useful for scaling a direction vector by a distance,
 * e.g. extending a ray by a fixed length.
 */
export function scaleVec2<P extends Position>(v: P, s: number): P {
  return new ((v as any).constructor)(v.x * s, v.y * s);
}

/**
 * Computes the dot product of two vectors: a.x*b.x + a.y*b.y.
 * A measure of how much two vectors point in the same direction.
 * Result is positive when they point roughly the same way,
 * negative when opposite, and zero when perpendicular.
 * Useful for angle checks without computing actual angles.
 */
export function dotVec2<P extends Position>(a: P, b: P): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * Length (magnitude) of a vector. Equivalent to Euclidean
 * distance from (0, 0) to (v.x, v.y). Useful for determining
 * how far apart two points are after subtracting them, or the
 * strength of a direction vector.
 */
export function lenVec2(v: Position): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

/**
 * Normalises a vector to unit length (length = 1) while
 * preserving its direction. Useful when you only care about
 * direction and not magnitude, e.g. getting a pure heading
 * to aim a constraint line. Returns (0, 0) unchanged.
 */
export function normVec2<P extends Position>(v: P): P {
  const l = lenVec2(v);
  if (l === 0) {
    return new ((v as any).constructor)(0, 0);
  }
  return new ((v as any).constructor)(v.x / l, v.y / l);
}

/**
 * Returns the vector perpendicular (rotated 90 degrees
 * counter-clockwise) from v: (-v.y, v.x). The output has
 * the same length as the input. Useful for computing
 * normals, offsets along an edge, or building bounding
 * volumes around a line.
 */
export function perpVec2<P extends Position>(v: P): P {
  return new ((v as any).constructor)(-1 * v.y, v.x);
}

/**
 * Linearly interpolates between a and b by parameter t.
 * t=0 returns a, t=1 returns b, t=0.5 returns the midpoint.
 * Useful for sampling points along a line segment or
 * animating a smooth transition between two positions.
 */
export function lerpVec2<P extends Position>(a: P, b: P, t: number): P {
  return new ((a as any).constructor)(
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
  );
}

/**
 * Euclidean distance between two points.
 * Shorthand for lenVec2(subVec2(b, a)).
 * Useful for measuring how far apart two geometry points are,
 * e.g. checking if a click is near a vertex.
 */
export function distVec2<P extends Position>(a: P, b: P): number {
  return lenVec2(subVec2(b, a));
}

/**
 * Angle of a vector measured from the positive x-axis,
 * returned in degrees. Uses atan2 internally so it handles
 * all four quadrants correctly. Useful for determining the
 * heading of a line segment or the rotation of an edge.
 */
export function angleVec2(v: Position): number {
  return radiansToDegrees(Math.atan2(v.y, v.x));
}

export function angleToNormVec2<P extends Position>(angle: number, positionClass: new (x: number, y: number) => P): P {
  const rad = degreesToRadians(angle);
  return new positionClass(Math.cos(rad), Math.sin(rad));
}

// export function fromAngleVec2(angle: number, length: number = 1, ): Position {
//   return { x: Math.cos(angle) * length, y: Math.sin(angle) * y };
// }

