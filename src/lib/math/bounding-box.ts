import { Geometry, type PolygonSegment } from '@/lib/geometry';
import { type Position, type Rect, SheetPosition } from '@/lib/viewport/types';

/** Given a list of points, compute an axis-aligned bounding box (AABB) which wholly contains their
 * convex hull. */
export function boundingBox<P extends Position>(points: Array<P>): Rect<P> {
  if (points.length === 0) {
    throw new Error('math.boundingBox: Cannot compute bounding box of empty array of points!');
  }

  const x = points.map((p) => p.x);
  const y = points.map((p) => p.y);
  const minX = Math.min(...x);
  const minY = Math.min(...y);
  const maxX = Math.max(...x);
  const maxY = Math.max(...y);

  return {
    position: new (points[0] as any).constructor(minX, minY),
    width: maxX - minX,
    height: maxY - minY,
  };
}

/** Inset the given Rect by the given offset. A negative offset performs an "outset" instead. */
export function rectInset<P extends Position>(rect: Rect<P>, offset: number): Rect<P> {
  return {
    position: new (rect.position as any).constructor(
      rect.position.x + offset,
      rect.position.y + offset,
    ),
    width: rect.width - offset * 2,
    height: rect.height - offset * 2,
  };
}

/** Computes the bounding box of a given geometry. */
export function geometryBoundingBox(geometry: Geometry): Rect<SheetPosition> | null {
  try {
    return Geometry.boundingBox(geometry);
  } catch {
    return null;
  }
}

/** Returns a boolean indicating of the two bounding boxes intersect. */
export function boundingBoxesIntersect<P extends Position>(a: Rect<P>, b: Rect<P>): boolean {
  return (
    a.position.x < b.position.x + b.width &&
    a.position.x + a.width > b.position.x &&
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
/**
 * Transforms polygon segments (including control points) from one bounding box to another
 * via an affine scale/translate from the upper-left corner. The upper-left corners of both rects
 * are aligned.
 */
export function interpolatePolygonPoints(
  points: Array<PolygonSegment>,
  oldRect: Rect<SheetPosition>,
  newRect: Rect<SheetPosition>,
): Array<PolygonSegment> {
  const scaleX = newRect.width / oldRect.width;
  const scaleY = newRect.height / oldRect.height;

  return points.map((seg) => {
    switch (seg.type) {
      case 'point': {
        const px = newRect.position.x + (seg.point.x - oldRect.position.x) * scaleX;
        const py = newRect.position.y + (seg.point.y - oldRect.position.y) * scaleY;
        return { ...seg, point: new SheetPosition(px, py) };
      }
      case 'arc-quadratic': {
        const px = newRect.position.x + (seg.point.x - oldRect.position.x) * scaleX;
        const py = newRect.position.y + (seg.point.y - oldRect.position.y) * scaleY;
        const cx = newRect.position.x + (seg.controlPoint.x - oldRect.position.x) * scaleX;
        const cy = newRect.position.y + (seg.controlPoint.y - oldRect.position.y) * scaleY;
        return {
          ...seg,
          point: new SheetPosition(px, py),
          controlPoint: new SheetPosition(cx, cy),
        };
      }
      case 'arc-cubic': {
        const px = newRect.position.x + (seg.point.x - oldRect.position.x) * scaleX;
        const py = newRect.position.y + (seg.point.y - oldRect.position.y) * scaleY;
        const cax = newRect.position.x + (seg.controlPointA.x - oldRect.position.x) * scaleX;
        const cay = newRect.position.y + (seg.controlPointA.y - oldRect.position.y) * scaleY;
        const cbx = newRect.position.x + (seg.controlPointB.x - oldRect.position.x) * scaleX;
        const cby = newRect.position.y + (seg.controlPointB.y - oldRect.position.y) * scaleY;
        return {
          ...seg,
          point: new SheetPosition(px, py),
          controlPointA: new SheetPosition(cax, cay),
          controlPointB: new SheetPosition(cbx, cby),
        };
      }
    }
  });
}

export function proximityBoundingBox<P extends Position>(center: P, radius: number): Rect<P> {
  return {
    position: new (center as any).constructor(center.x - radius, center.y - radius),
    width: radius * 2,
    height: radius * 2,
  };
}
