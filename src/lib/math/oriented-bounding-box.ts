import type { OrientedRect, Position, Rect, RectCorners } from '@/lib/viewport/types';
import { BoundingBox } from './bounding-box';
import { rotatePointAround } from './rotation';

/** Utilities for working with {@link OrientedRect}s. */
export namespace OrientedBoundingBox {
  /** Builds an unrotated {@link OrientedRect} from an axis-aligned rectangle. */
  export function fromRect<P extends Position>(
    rect: Rect<P>,
    angleDegrees: number = 0,
  ): OrientedRect<P> {
    return {
      position: rect.position,
      width: rect.width,
      height: rect.height,
      angleDegrees,
    };
  }

  /** Returns the four corners of the oriented rectangle, rotating around its upper-left position. */
  export function corners<P extends Position>(rect: OrientedRect<P>): RectCorners<P> {
    const positionClass = rect.position.constructor as new (x: number, y: number) => P;
    return {
      upperLeft: rect.position,
      upperRight: rotatePointAround(
        new positionClass(rect.position.x + rect.width, rect.position.y),
        rect.position,
        rect.angleDegrees,
      ),
      lowerLeft: rotatePointAround(
        new positionClass(rect.position.x, rect.position.y + rect.height),
        rect.position,
        rect.angleDegrees,
      ),
      lowerRight: rotatePointAround(
        new positionClass(rect.position.x + rect.width, rect.position.y + rect.height),
        rect.position,
        rect.angleDegrees,
      ),
    };
  }

  /** Returns the corners in the same winding order as {@link BoundingBox.cornersToArray}. */
  export function cornersToArray<P extends Position>(rect: OrientedRect<P>): Array<P> {
    const c = corners(rect);
    return [c.upperLeft, c.upperRight, c.lowerRight, c.lowerLeft];
  }

  /** Insets the rectangle along its local axes. A negative offset performs an "outset". */
  export function inset<P extends Position>(
    rect: OrientedRect<P>,
    offset: number,
  ): OrientedRect<P> {
    const positionClass = rect.position.constructor as new (x: number, y: number) => P;
    return {
      position: rotatePointAround(
        new positionClass(rect.position.x + offset, rect.position.y + offset),
        rect.position,
        rect.angleDegrees,
      ),
      width: rect.width - offset * 2,
      height: rect.height - offset * 2,
      angleDegrees: rect.angleDegrees,
    };
  }

  /** Returns the axis-aligned bounding box which contains the oriented rectangle. */
  export function toRect<P extends Position>(rect: OrientedRect<P>): Rect<P> {
    return BoundingBox.fromPoints(cornersToArray(rect));
  }

  /** Returns the axis-aligned union of the given oriented rectangles. This deliberately returns a
   * plain {@link Rect} because a union of differently-oriented rectangles cannot stay oriented. */
  export function union<P extends Position>(rects: Array<OrientedRect<P>>): Rect<P> | null {
    return BoundingBox.union(rects.map(toRect));
  }

  /** Returns true when the rectangle's rotation leaves it axis-aligned. */
  export function isAxisAligned(rect: OrientedRect<Position>): boolean {
    const normalized = ((rect.angleDegrees % 90) + 90) % 90;
    return normalized < 1e-6 || normalized > 90 - 1e-6;
  }
}
