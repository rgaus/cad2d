import { Geometry, type PolygonSegment } from '@/lib/geometry';
import { type Position, type Rect, type RectCorners, SheetPosition } from '@/lib/viewport/types';

/** Namespace for axis-aligned bounding box (AABB) operations. */
export const BoundingBox = {
  /** Given a list of points, compute an axis-aligned bounding box (AABB) which wholly contains their
   * convex hull. */
  fromPoints<P extends Position>(points: Array<P>): Rect<P> {
    if (points.length === 0) {
      throw new Error(
        'math.BoundingBox.fromPoints: Cannot compute bounding box of empty array of points!',
      );
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
  },

  /** Inset the given Rect by the given offset. A negative offset performs an "outset" instead. */
  inset<P extends Position>(rect: Rect<P>, offset: number): Rect<P> {
    return {
      position: new (rect.position as any).constructor(
        rect.position.x + offset,
        rect.position.y + offset,
      ),
      width: rect.width - offset * 2,
      height: rect.height - offset * 2,
    };
  },

  /** Returns a boolean indicating of the two bounding boxes intersect. */
  intersects<P extends Position>(a: Rect<P>, b: Rect<P>): boolean {
    return (
      a.position.x < b.position.x + b.width &&
      a.position.x + a.width > b.position.x &&
      a.position.y < b.position.y + b.height &&
      a.position.y + a.height > b.position.y
    );
  },

  /** Returns a boolean indicating if the given point is inside the bounding box. */
  containsPoint<P extends Position>(bbox: Rect<P>, point: P): boolean {
    return (
      point.x >= bbox.position.x &&
      point.x <= bbox.position.x + bbox.width &&
      point.y >= bbox.position.y &&
      point.y <= bbox.position.y + bbox.height
    );
  },

  /** Returns a boolean indicating if bounding box b is wholly contained within bounding box a */
  contains<P extends Position>(a: Rect<P>, b: Rect<P>): boolean {
    return (
      a.position.x < b.position.x &&
      a.position.x + a.width > b.position.x + b.width &&
      a.position.y < b.position.y &&
      a.position.y + a.height > b.position.y + b.height
    );
  },

  /**
   * Computes a bounding box encompassing the convex hull of all passed bounding boxes.
   * Returns null if boxes.length === 0.
   **/
  union<P extends Position>(boxes: Array<Rect<P>>): Rect<P> | null {
    if (boxes.length === 0) {
      return null;
    }

    let union: Rect<P> | null = null;
    for (const bbox of boxes) {
      if (!union) {
        union = bbox;
      } else {
        const minX = Math.min(union.position.x, bbox.position.x);
        const minY = Math.min(union.position.y, bbox.position.y);
        const maxX = Math.max(union.position.x + union.width, bbox.position.x + bbox.width);
        const maxY = Math.max(union.position.y + union.height, bbox.position.y + bbox.height);
        union = {
          position: new (boxes[0].position as any).constructor(minX, minY),
          width: maxX - minX,
          height: maxY - minY,
        };
      }
    }
    return union;
  },

  /**
   * Transforms polygon segments (including control points) from one bounding box to another
   * via an affine scale/translate from the upper-left corner. The upper-left corners of both rects
   * are aligned.
   */
  interpolatePoints(
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
  },

  /**
   * Creates a bounding box centered on a point with a given radius in pixels.
   * The radius is in the same units as center position passed.
   * Returns a Rect in `center`-type coordinates.
   * @param center - The center point of the AABB.
   * @param radius - The radius in `center`-units.
   * @returns A Rect representing the bounding box in `center` units.
   */
  proximity<P extends Position>(center: P, radius: number): Rect<P> {
    return {
      position: new (center as any).constructor(center.x - radius, center.y - radius),
      width: radius * 2,
      height: radius * 2,
    };
  },

  /** Given a rect, generates the corner points which when drawn would visualize the rect. */
  corners<P extends Position>(rect: Rect<P>): RectCorners<P> {
    return {
      upperLeft: rect.position,
      upperRight: new (rect.position as any).constructor(
        rect.position.x + rect.width,
        rect.position.y,
      ),
      lowerLeft: new (rect.position as any).constructor(
        rect.position.x,
        rect.position.y + rect.height,
      ),
      lowerRight: new (rect.position as any).constructor(
        rect.position.x + rect.width,
        rect.position.y + rect.height,
      ),
    };
  },

  /** Given a rect, generates the corner points winding counter-clockwise which when drawn would visualize the rect. */
  cornersToArray<P extends Position>(rect: RectCorners<P>): Array<P> {
    return [rect.upperLeft, rect.upperRight, rect.lowerRight, rect.lowerLeft];
  },
};

// Re-export standalone for backward compat during migration
export function boundingBoxContains<P extends Position>(a: Rect<P>, b: Rect<P>): boolean {
  return BoundingBox.contains(a, b);
}

export function boundingBoxContainsPoint<P extends Position>(bbox: Rect<P>, point: P): boolean {
  return BoundingBox.containsPoint(bbox, point);
}
