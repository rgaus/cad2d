import { distance } from '../math';
import { SheetPosition } from '../viewport/types';

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
  pos: SheetPosition,
  prevPoint: SheetPosition | null,
  options: SnappingOptions
): SheetPosition {
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
  pos: SheetPosition,
  primarySize: number,
  secondarySize: number | null
): SheetPosition {
  const primarySnapped = snapToGrid(pos, primarySize);
  const primaryDist = distance(pos, primarySnapped);

  if (secondarySize === null) {
    return primarySnapped;
  }

  const secondarySnapped = snapToGrid(pos, secondarySize);
  const secondaryDist = distance(pos, secondarySnapped);

  if (secondaryDist < primaryDist) {
    return secondarySnapped;
  } else {
    return primarySnapped;
  }
}

/**
 * Snaps a point to the nearest grid line at the given size.
 */
function snapToGrid(pos: SheetPosition, gridSize: number): SheetPosition {
  return new SheetPosition(
    Math.round(pos.x / gridSize) * gridSize,
    Math.round(pos.y / gridSize) * gridSize
  );
}

/**
 * Snaps the end point to the nearest 45-degree angle from the start point.
 * Preserves the distance from start to end.
 */
function snapTo45Degrees(start: SheetPosition, end: SheetPosition): SheetPosition {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist === 0) {
    return end;
  }

  const angle = Math.atan2(dy, dx);
  const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);

  return new SheetPosition(
    start.x + dist * Math.cos(snapAngle),
    start.y + dist * Math.sin(snapAngle)
  );
}
