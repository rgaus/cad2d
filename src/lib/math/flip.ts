import { SheetPosition } from '../viewport/types';

/**
 * Flips a SheetPosition horizontally around a given center X coordinate.
 * The Y coordinate remains unchanged.
 */
export function flipPointHorizontally(point: SheetPosition, centerX: number): SheetPosition {
  return new SheetPosition(centerX - (point.x - centerX), point.y);
}

/**
 * Flips a SheetPosition vertically around a given center Y coordinate.
 * The X coordinate remains unchanged.
 */
export function flipPointVertically(point: SheetPosition, centerY: number): SheetPosition {
  return new SheetPosition(point.x, centerY - (point.y - centerY));
}
