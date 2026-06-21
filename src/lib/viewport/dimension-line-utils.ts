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
 *
 * When `axis` is set, the dimension line is drawn parallel to that axis rather than
 * along the diagonal between the two points.
 *   'x' — horizontal dimension line showing x-span, tick marks are vertical
 *   'y' — vertical dimension line showing y-span, tick marks are horizontal
 */
export function computeDimensionLinePoints(
  pointA: { x: number; y: number },
  pointB: { x: number; y: number },
  offsetPx: number,
  axis?: 'x' | 'y' | null,
): DimensionLinePoints {
  if (axis === 'x') {
    return computeXAxisDimensionLinePoints(pointA, pointB, offsetPx);
  }
  if (axis === 'y') {
    return computeYAxisDimensionLinePoints(pointA, pointB, offsetPx);
  }

  const dx = pointB.x - pointA.x;
  const dy = pointB.y - pointA.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const lineDir = len > 0 ? { x: dx / len, y: dy / len } : { x: 0, y: 0 };
  const perpDir = { x: -lineDir.y, y: lineDir.x };

  const offset = { x: perpDir.x * offsetPx, y: perpDir.y * offsetPx };

  const lineStart = { x: pointA.x + offset.x, y: pointA.y + offset.y };
  const lineEnd = { x: pointB.x + offset.x, y: pointB.y + offset.y };

  const midpoint = { x: (lineStart.x + lineEnd.x) / 2, y: (lineStart.y + lineEnd.y) / 2 };

  const tickANormalStart = computeTickStart(offsetPx, lineStart, perpDir, pointA);
  const tickANormalEnd = computeTickEnd(offsetPx, lineStart, perpDir, pointA);
  const tickBNormalStart = computeTickStart(offsetPx, lineEnd, perpDir, pointB);
  const tickBNormalEnd = computeTickEnd(offsetPx, lineEnd, perpDir, pointB);

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

function computeTickStart(
  offsetPx: number,
  linePt: { x: number; y: number },
  perpDir: { x: number; y: number },
  origPt: { x: number; y: number },
): { x: number; y: number } {
  if (offsetPx === 0) {
    return {
      x: linePt.x + perpDir.x * TICK_NO_OFFSET_TAIL_OFFSET_PX,
      y: linePt.y + perpDir.y * TICK_NO_OFFSET_TAIL_OFFSET_PX,
    };
  }
  return origPt;
}

function computeTickEnd(
  offsetPx: number,
  linePt: { x: number; y: number },
  perpDir: { x: number; y: number },
  _origPt: { x: number; y: number },
): { x: number; y: number } {
  if (offsetPx === 0) {
    return {
      x: linePt.x - perpDir.x * TICK_NO_OFFSET_TAIL_OFFSET_PX,
      y: linePt.y - perpDir.y * TICK_NO_OFFSET_TAIL_OFFSET_PX,
    };
  }
  if (offsetPx > 0) {
    return {
      x: linePt.x + perpDir.x * TICK_OFFSET_TAIL_OFFSET_PX,
      y: linePt.y + perpDir.y * TICK_OFFSET_TAIL_OFFSET_PX,
    };
  }
  return {
    x: linePt.x - perpDir.x * TICK_OFFSET_TAIL_OFFSET_PX,
    y: linePt.y - perpDir.y * TICK_OFFSET_TAIL_OFFSET_PX,
  };
}

/** Horizontal dimension line showing x-span. Tick marks are vertical. */
function computeXAxisDimensionLinePoints(
  pointA: { x: number; y: number },
  pointB: { x: number; y: number },
  offsetPx: number,
): DimensionLinePoints {
  const minX = Math.min(pointA.x, pointB.x);
  const maxX = Math.max(pointA.x, pointB.x);
  const midY = (pointA.y + pointB.y) / 2;
  const offsetY = midY + offsetPx;

  const lineStart = { x: minX, y: offsetY };
  const lineEnd = { x: maxX, y: offsetY };
  const midpoint = { x: (minX + maxX) / 2, y: offsetY };

  // Vertical ticks from the dimension line to each endpoint
  const tickANormalStart = { x: pointA.x, y: lineStart.y };
  const tickANormalEnd = { x: pointA.x, y: pointA.y };
  const tickBNormalStart = { x: pointB.x, y: lineEnd.y };
  const tickBNormalEnd = { x: pointB.x, y: pointB.y };

  return {
    lineStart,
    lineEnd,
    tickANormalStart,
    tickANormalEnd,
    tickBNormalStart,
    tickBNormalEnd,
    midpoint,
    labelOffset: { x: 0, y: offsetPx },
  };
}

/** Vertical dimension line showing y-span. Tick marks are horizontal. */
function computeYAxisDimensionLinePoints(
  pointA: { x: number; y: number },
  pointB: { x: number; y: number },
  offsetPx: number,
): DimensionLinePoints {
  const minY = Math.min(pointA.y, pointB.y);
  const maxY = Math.max(pointA.y, pointB.y);
  const midX = (pointA.x + pointB.x) / 2;
  const offsetX = midX + offsetPx;

  const lineStart = { x: offsetX, y: minY };
  const lineEnd = { x: offsetX, y: maxY };
  const midpoint = { x: offsetX, y: (minY + maxY) / 2 };

  // Horizontal ticks from the dimension line to each endpoint
  const tickANormalStart = { x: lineStart.x, y: pointA.y };
  const tickANormalEnd = { x: pointA.x, y: pointA.y };
  const tickBNormalStart = { x: lineEnd.x, y: pointB.y };
  const tickBNormalEnd = { x: pointB.x, y: pointB.y };

  return {
    lineStart,
    lineEnd,
    tickANormalStart,
    tickANormalEnd,
    tickBNormalStart,
    tickBNormalEnd,
    midpoint,
    labelOffset: { x: offsetPx, y: 0 },
  };
}
