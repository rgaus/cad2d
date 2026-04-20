import type { PolygonPoint } from './types';

export type SnappingOptions = {
  primaryGridSize: number;
  secondaryGridSize: number | null;
  shiftHeld: boolean;
  superHeld: boolean;
};

/**
 * Snaps a point to grid lines (primary or secondary, whichever is closer).
 * If super is held, also applies 45-degree angular snapping from the previous point.
 * Shift disables all snapping.
 */
export function applySnapping(
  pos: PolygonPoint,
  prevPoint: PolygonPoint | null,
  options: SnappingOptions
): PolygonPoint {
  if (options.shiftHeld) {
    return pos;
  }

  let snapped = snapToNearestGrid(pos, options.primaryGridSize, options.secondaryGridSize);

  if (options.superHeld && prevPoint) {
    snapped = snapTo45Degrees(prevPoint, snapped);
  }

  return snapped;
}

/**
 * Snaps to the nearest grid line (primary or secondary, whichever is closer).
 */
function snapToNearestGrid(
  pos: PolygonPoint,
  primarySize: number,
  secondarySize: number | null
): PolygonPoint {
  const primarySnapped = snapToGrid(pos, primarySize);
  const primaryDist = distance(pos, primarySnapped);

  if (secondarySize === null) {
    return primarySnapped;
  }

  const secondarySnapped = snapToGrid(pos, secondarySize);
  const secondaryDist = distance(pos, secondarySnapped);

  if (secondaryDist < primaryDist) {
    return secondarySnapped;
  }
  return primarySnapped;
}

/**
 * Snaps a point to the nearest grid line at the given size.
 */
function snapToGrid(pos: PolygonPoint, gridSize: number): PolygonPoint {
  return {
    x: Math.round(pos.x / gridSize) * gridSize,
    y: Math.round(pos.y / gridSize) * gridSize,
  };
}

/**
 * Snaps the end point to the nearest 45-degree angle from the start point.
 * Preserves the distance from start to end.
 */
function snapTo45Degrees(start: PolygonPoint, end: PolygonPoint): PolygonPoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist === 0) {
    return end;
  }

  const angle = Math.atan2(dy, dx);
  const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);

  return {
    x: start.x + dist * Math.cos(snapAngle),
    y: start.y + dist * Math.sin(snapAngle),
  };
}

/**
 * Euclidean distance between two points.
 */
export function distance(a: PolygonPoint, b: PolygonPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}