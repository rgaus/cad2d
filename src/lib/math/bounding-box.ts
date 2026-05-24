import { SheetPosition, type LineSegment, type Position, type Rect } from "@/lib/viewport/types";
import { type Rectangle, type Ellipse, type Polygon } from "@/lib/geometry";

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

/** Given a list of points, compute an axis-aligned bounding box (AABB) which wholly contains their
 * convex hull. */
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

/** Computes the bounding box of a given geometry. */
export function geometryBoundingBox(geometry: Rectangle | Ellipse | Polygon): Rect<SheetPosition> | null {
  if ('closed' in geometry) {
    return boundingBox(geometry.points.map(p => p.point));
  } else if ('radiusX' in geometry) {
    return {
      position: new SheetPosition(geometry.center.x - geometry.radiusX, geometry.center.y - geometry.radiusY),
      width: geometry.radiusX * 2,
      height: geometry.radiusY * 2,
    };
  } else if ('lowerRight' in geometry) {
    return {
      position: geometry.upperLeft,
      width: geometry.lowerRight.x - geometry.upperLeft.x,
      height: geometry.lowerRight.y - geometry.upperLeft.y,
    };
  } else {
    return null;
  }
}

/** Returns a boolean indicating of the two bounding boxes intersect. */
export function boundingBoxesIntersect<P extends Position>(a: Rect<P>, b: Rect<P>): boolean {
  return (
    a.position.x < b.position.x + b.width  &&
    a.position.x + a.width  > b.position.x &&
    a.position.y < b.position.y + b.height &&
    a.position.y + a.height > b.position.y
  );
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
