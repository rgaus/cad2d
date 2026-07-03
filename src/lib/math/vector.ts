import { type Position } from '@/lib/viewport/types';
import { Angle } from './angle';

/** Namespace for 2D vector operations. All functions are generic over any Position subclass
 * (SheetPosition, WorldPosition, ViewportPosition, ScreenPosition). */
export const Vector2 = {
  /**
   * Adds two vectors component-wise (a.x + b.x, a.y + b.y).
   * Useful for applying a displacement or offset to a point,
   * e.g. moving a corner by a drag delta.
   */
  add<P extends Position>(a: P, ...bs: Array<P>): P {
    let x = a.x;
    let y = a.y;
    for (const b of bs) {
      x += b.x;
      y += b.y;
    }
    return new (a as any).constructor(x, y);
  },

  /**
   * Subtracts vector b from vector a (a.x - b.x, a.y - b.y).
   * Useful for finding the direction/displacement from b to a,
   * e.g. computing the vector from a polygon vertex to the cursor.
   */
  sub<P extends Position>(a: P, ...bs: Array<P>): P {
    let x = a.x;
    let y = a.y;
    for (const b of bs) {
      x -= b.x;
      y -= b.y;
    }
    return new (a as any).constructor(x, y);
  },

  /**
   * Multiplies each component of vector v by scalar s.
   * Useful for scaling a direction vector by a distance,
   * e.g. extending a ray by a fixed length.
   */
  scale<P extends Position>(v: P, s: number): P {
    return new (v as any).constructor(v.x * s, v.y * s);
  },

  /**
   * Computes the dot product of two vectors: a.x*b.x + a.y*b.y.
   * A measure of how much two vectors point in the same direction.
   * Result is positive when they point roughly the same way,
   * negative when opposite, and zero when perpendicular.
   * Useful for angle checks without computing actual angles.
   */
  dot<P extends Position>(a: P, b: P): number {
    return a.x * b.x + a.y * b.y;
  },

  /**
   * Length (magnitude) of a vector. Equivalent to Euclidean
   * distance from (0, 0) to (v.x, v.y). Useful for determining
   * how far apart two points are after subtracting them, or the
   * strength of a direction vector.
   */
  len(v: Position): number {
    return Math.sqrt(v.x * v.x + v.y * v.y);
  },

  /**
   * Normalises a vector to unit length (length = 1) while
   * preserving its direction. Useful when you only care about
   * direction and not magnitude, e.g. getting a pure heading
   * to aim a constraint line. Returns (0, 0) unchanged.
   */
  norm<P extends Position>(v: P): P {
    const l = Vector2.len(v);
    if (l === 0) {
      return new (v as any).constructor(0, 0);
    }
    return new (v as any).constructor(v.x / l, v.y / l);
  },

  /**
   * Returns the vector perpendicular (rotated 90 degrees
   * counter-clockwise) from v: (-v.y, v.x). The output has
   * the same length as the input. Useful for computing
   * normals, offsets along an edge, or building bounding
   * volumes around a line.
   */
  perp<P extends Position>(v: P): P {
    return new (v as any).constructor(-1 * v.y, v.x);
  },

  /**
   * Linearly interpolates between a and b by parameter t.
   * t=0 returns a, t=1 returns b, t=0.5 returns the midpoint.
   * Useful for sampling points along a line segment or
   * animating a smooth transition between two positions.
   */
  lerp<P extends Position>(a: P, b: P, t: number): P {
    return new (a as any).constructor(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  },

  /**
   * Euclidean distance between two points.
   * Shorthand for Vector2.len(Vector2.sub(b, a)).
   * Useful for measuring how far apart two geometry points are,
   * e.g. checking if a click is near a vertex.
   */
  dist<P extends Position>(a: P, b: P): number {
    return Vector2.len(Vector2.sub(b, a));
  },

  /**
   * Euclidean distance between two points (direct implementation,
   * slightly more efficient than the dist helper for tight loops).
   */
  distance<P extends Position>(a: P, b: P): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  },

  /**
   * Returns the midpoint between two points.
   */
  midpoint<P extends Position>(a: P, b: P): P {
    return new (a as any).constructor((a.x + b.x) / 2, (a.y + b.y) / 2);
  },

  /**
   * Angle of a vector measured from the positive x-axis,
   * returned in degrees. Uses atan2 internally so it handles
   * all four quadrants correctly. Useful for determining the
   * heading of a line segment or the rotation of an edge.
   */
  angle(v: Position): number {
    return Angle.toDegrees(Math.atan2(v.y, v.x));
  },

  /** Returns a normalised vector pointing in the given angle (degrees). */
  angleToNorm<P extends Position>(
    angle: number,
    positionClass: new (x: number, y: number) => P,
  ): P {
    const rad = Angle.toRadians(angle);
    return new positionClass(Math.cos(rad), Math.sin(rad));
  },
};
