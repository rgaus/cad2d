/** Result of computing dimension line rendering points. */
export type DimensionLinePoints = {
  lineStart: { x: number; y: number };
  lineEnd: { x: number; y: number };
  tickANormalStart: { x: number; y: number };
  tickANormalEnd: { x: number; y: number };
  tickBNormalStart: { x: number; y: number };
  tickBNormalEnd: { x: number; y: number };
  midpoint: { x: number; y: number };
  labelOffset: { x: number; y: number };
};

/** Number of pixels the tick lines extend further beyond the line opposite the side the point is on */
export const TICK_OFFSET_TAIL_OFFSET_PX = 8;
/** Number of pixels the tick lines extend symmetrically on either side of the line when there is no offset */
export const TICK_NO_OFFSET_TAIL_OFFSET_PX = 16;
/** Line width used when rendering constraints to SVG */
export const CONSTRAINT_LINE_WIDTH_PX = 1;
/** Color used when rendering constraints to SVG */
export const CONSTRAINT_COLOR = '#666666';

/**
 * Computes all points needed to render a dimension line (constraint label) between two points.
 * Takes two points in any coordinate system and an offset in pixels.
 * Returns all computed points in the same coordinate system as the input.
 */
export function computeDimensionLinePoints(
  pointA: { x: number; y: number },
  pointB: { x: number; y: number },
  offsetPx: number,
): DimensionLinePoints {
  const dx = pointB.x - pointA.x;
  const dy = pointB.y - pointA.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const lineDir = len > 0 ? { x: dx / len, y: dy / len } : { x: 0, y: 0 };
  const perpDir = { x: -lineDir.y, y: lineDir.x };

  const offset = { x: perpDir.x * offsetPx, y: perpDir.y * offsetPx };

  const lineStart = { x: pointA.x + offset.x, y: pointA.y + offset.y };
  const lineEnd = { x: pointB.x + offset.x, y: pointB.y + offset.y };

  const midpoint = { x: (lineStart.x + lineEnd.x) / 2, y: (lineStart.y + lineEnd.y) / 2 };

  const tickANormalStart = (() => {
    if (offsetPx === 0) {
      return {
        x: lineStart.x + perpDir.x * TICK_NO_OFFSET_TAIL_OFFSET_PX,
        y: lineStart.y + perpDir.y * TICK_NO_OFFSET_TAIL_OFFSET_PX,
      };
    }
    return pointA;
  })();

  const tickANormalEnd = (() => {
    if (offsetPx === 0) {
      return {
        x: lineStart.x - perpDir.x * TICK_NO_OFFSET_TAIL_OFFSET_PX,
        y: lineStart.y - perpDir.y * TICK_NO_OFFSET_TAIL_OFFSET_PX,
      };
    }
    if (offsetPx > 0) {
      return {
        x: lineStart.x + perpDir.x * TICK_OFFSET_TAIL_OFFSET_PX,
        y: lineStart.y + perpDir.y * TICK_OFFSET_TAIL_OFFSET_PX,
      };
    }
    return {
      x: lineStart.x - perpDir.x * TICK_OFFSET_TAIL_OFFSET_PX,
      y: lineStart.y - perpDir.y * TICK_OFFSET_TAIL_OFFSET_PX,
    };
  })();

  const tickBNormalStart = (() => {
    if (offsetPx === 0) {
      return {
        x: lineEnd.x + perpDir.x * TICK_NO_OFFSET_TAIL_OFFSET_PX,
        y: lineEnd.y + perpDir.y * TICK_NO_OFFSET_TAIL_OFFSET_PX,
      };
    }
    return pointB;
  })();

  const tickBNormalEnd = (() => {
    if (offsetPx === 0) {
      return {
        x: lineEnd.x - perpDir.x * TICK_NO_OFFSET_TAIL_OFFSET_PX,
        y: lineEnd.y - perpDir.y * TICK_NO_OFFSET_TAIL_OFFSET_PX,
      };
    }
    if (offsetPx > 0) {
      return {
        x: lineEnd.x + perpDir.x * TICK_OFFSET_TAIL_OFFSET_PX,
        y: lineEnd.y + perpDir.y * TICK_OFFSET_TAIL_OFFSET_PX,
      };
    }
    return {
      x: lineEnd.x - perpDir.x * TICK_OFFSET_TAIL_OFFSET_PX,
      y: lineEnd.y - perpDir.y * TICK_OFFSET_TAIL_OFFSET_PX,
    };
  })();

  return {
    lineStart,
    lineEnd,
    tickANormalStart,
    tickANormalEnd,
    tickBNormalStart,
    tickBNormalEnd,
    midpoint,
    labelOffset: offset,
  };
}
