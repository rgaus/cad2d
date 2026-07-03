import { SheetPosition } from '../viewport/types';

/** Namespace for point-flipping operations around a center axis. */
export const Flip = {
  /**
   * Flips a SheetPosition horizontally around a given center X coordinate.
   * The Y coordinate remains unchanged.
   */
  horizontal(point: SheetPosition, centerX: number): SheetPosition {
    return new SheetPosition(centerX - (point.x - centerX), point.y);
  },

  /**
   * Flips a SheetPosition vertically around a given center Y coordinate.
   * The X coordinate remains unchanged.
   */
  vertical(point: SheetPosition, centerY: number): SheetPosition {
    return new SheetPosition(point.x, centerY - (point.y - centerY));
  },
};
