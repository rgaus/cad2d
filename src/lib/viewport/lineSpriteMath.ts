import { SheetPosition, ViewportState } from '../viewport/types';

/**
 * Computes the position, length, and angle for rendering a sprite along a line segment.
 * All values are in pixel coordinates.
 *
 * @param startPosition - First point of the line segment in sheet coordinates
 * @param endPosition - Second point of the line segment in sheet coordinates
 * @returns Object with centerX, centerY (sprite position), length, and angleDegrees
 */
export function computeLineSpriteTransform(startPosition: SheetPosition, endPosition: SheetPosition): {
  centerX: number;
  centerY: number;
  length: number;
  angleDegrees: number;
} {
  const SHEET_UNITS_TO_PIXELS = 64;

  const startX = startPosition.x * SHEET_UNITS_TO_PIXELS;
  const startY = startPosition.y * SHEET_UNITS_TO_PIXELS;
  const endX = endPosition.x * SHEET_UNITS_TO_PIXELS;
  const endY = endPosition.y * SHEET_UNITS_TO_PIXELS;

  const centerX = (startX + endX) / 2;
  const centerY = (startY + endY) / 2;

  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.sqrt(dx * dx + dy * dy);

  const angleRadians = Math.atan2(dy, dx);
  const angleDegrees = angleRadians * (180 / Math.PI);

  return { centerX, centerY, length, angleDegrees };
}
