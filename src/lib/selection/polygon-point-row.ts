import { type PolygonSegment } from '../entity/geometry/polygon';

/** The height of each polygon point row in pixels, keyed by segment type. Used to compute the
 * {@link SplitPointIndicator} position and to translate openAtIndex drag deltas into point indexes. */
export const POINT_ROW_HEIGHT_PX_BY_TYPE: { [key in PolygonSegment['type']]: number } = {
  'arc-cubic': 114,
  'arc-quadratic': 78,
  point: 42,
};

/**
 * Computes the new `openAtIndex` for a polygon given a drag delta in the vertical axis.
 *
 * Starting at `initialOpenAtIndex`, a negative `deltaYPx` (dragging up) walks backwards through the
 * point rows and a positive delta walks forwards, using each row's pixel height to determine when
 * the dividing line has crossed into the next point. The result is clamped to the valid index
 * range.
 *
 * @param initialOpenAtIndex - The openAtIndex captured at the start of the drag.
 * @param initialPoints - The polygon's points captured at the start of the drag.
 * @param deltaYPx - The accumulated vertical drag distance in pixels.
 */
export function computeOpenAtIndex(
  initialOpenAtIndex: number,
  initialPoints: Array<PolygonSegment>,
  deltaYPx: number,
): number {
  let index = 0;
  if (deltaYPx < 0) {
    for (
      let i = initialOpenAtIndex, offsetInPx = 0;
      i >= 0;
      [i, offsetInPx] = [i - 1, offsetInPx - POINT_ROW_HEIGHT_PX_BY_TYPE[initialPoints[i].type]]
    ) {
      const rowHeightInPx = POINT_ROW_HEIGHT_PX_BY_TYPE[initialPoints[i].type];
      if (deltaYPx > offsetInPx - rowHeightInPx / 2) {
        index = i;
        break;
      }
    }
  } else {
    for (
      let i = initialOpenAtIndex, offsetInPx = 0;
      i < initialPoints.length;
      [i, offsetInPx] = [i + 1, offsetInPx + POINT_ROW_HEIGHT_PX_BY_TYPE[initialPoints[i].type]]
    ) {
      const rowHeightInPx = POINT_ROW_HEIGHT_PX_BY_TYPE[initialPoints[i].type];
      if (deltaYPx < offsetInPx + rowHeightInPx / 2) {
        index = i;
        break;
      }
    }
  }
  return Math.min(Math.max(index, 0), initialPoints.length);
}
