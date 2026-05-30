import {
  type CubicCurve,
  type LineSegment,
  type Position,
  type QuadraticCurve,
  type Rect,
} from '@/lib/viewport/types';

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
  lineSegmentMightIntersectBoundingBox<P extends Position>(
    segment: LineSegment<P>,
    aabb: Rect<P>,
  ): boolean {
    const outcode1 = CohenSutherland.computeOutcode(segment.start, aabb);
    const outcode2 = CohenSutherland.computeOutcode(segment.end, aabb);
    // Non-zero AND means both endpoints are on the same side - trivially outside.
    return (outcode1 & outcode2) === 0;
  },

  quadraticCurveMightIntersectBoundingBox<P extends Position>(
    curve: QuadraticCurve<P>,
    aabb: Rect<P>,
  ): boolean {
    return (
      CohenSutherland.lineSegmentMightIntersectBoundingBox(
        { start: curve.start, end: curve.controlPoint },
        aabb,
      ) ||
      CohenSutherland.lineSegmentMightIntersectBoundingBox(
        { start: curve.controlPoint, end: curve.end },
        aabb,
      )
    );
  },
  cubicCurveMightIntersectBoundingBox<P extends Position>(
    curve: CubicCurve<P>,
    aabb: Rect<P>,
  ): boolean {
    return (
      CohenSutherland.lineSegmentMightIntersectBoundingBox(
        { start: curve.start, end: curve.controlPointA },
        aabb,
      ) ||
      CohenSutherland.lineSegmentMightIntersectBoundingBox(
        { start: curve.controlPointA, end: curve.controlPointB },
        aabb,
      ) ||
      CohenSutherland.lineSegmentMightIntersectBoundingBox(
        { start: curve.controlPointB, end: curve.end },
        aabb,
      )
    );
  },
};
