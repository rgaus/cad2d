import { CubicCurve, LineSegment, Position, QuadraticCurve, Rect, RectCorners } from "../viewport/types";

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
  // cubicCurveMightIntersectBoundingBox<P extends Position>(curve: CubicCurve<P>, aabb: Rect<P>): boolean {
  //   return (
  //     CohenSutherland.lineSegmentMightIntersectBoundingBox({ start: curve.start, end: curve.controlPointA }) ||
  //     CohenSutherland.lineSegmentMightIntersectBoundingBox({ start: curve.controlPoint, end: curve.end })
  //   );
  // }
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
