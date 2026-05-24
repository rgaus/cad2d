import { geometryBoundingBox, distance } from '@/lib/math';
import { SheetPosition } from '@/lib/viewport/types';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { Ellipse, Rectangle, type ConstraintEndpoint, type RectangleEndpoint, type EllipseEndpoint, type Polygon } from '@/lib/geometry/types';

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

/** Pixel radius within which a cursor snaps to a geometry key point. */
const KEY_POINT_SNAP_THRESHOLD_PX = 8;

export type KeyPointSnappingOptions = {
  viewportScale: number;
  primaryGridSize: number;
  secondaryGridSize: number | null;
  superHeld: boolean;
  rectangles: Array<Rectangle>;
  ellipses: Array<Ellipse>;
  polygons: Array<Polygon>;
};

/**
 * Finds the nearest geometry key point (rectangle corner, ellipse key point, or polygon vertex)
 * within the given threshold distance (in sheet units).
 */
function snapNearestKeyPoint(
  pos: SheetPosition,
  threshold: number,
  rectangles: Array<Rectangle>,
  ellipses: Array<Ellipse>,
  polygons: Array<Polygon>,
): { endpoint: ConstraintEndpoint; position: SheetPosition; dist: number } | null {
  let best: { endpoint: ConstraintEndpoint; position: SheetPosition; dist: number } | null = null;

  for (const rect of rectangles) {
    const kp = Rectangle.keyPoints(rect);
    const corners: Array<{ name: RectangleEndpoint; point: SheetPosition }> = [
      { name: "upperLeft", point: kp.perimeter[0] },
      { name: "upperRight", point: kp.perimeter[1] },
      { name: "lowerRight", point: kp.perimeter[2] },
      { name: "lowerLeft", point: kp.perimeter[3] },
    ];
    for (const { name, point } of corners) {
      const dist = distance(pos, point);
      if (dist < threshold && (!best || dist < best.dist)) {
        best = { endpoint: { type: "locked-rectangle", id: rect.id, point: name }, position: point, dist };
      }
    }
  }

  for (const ellipse of ellipses) {
    const kp = Ellipse.keyPoints(ellipse);
    const points: Array<{ name: EllipseEndpoint; point: SheetPosition }> = [
      { name: "top", point: kp.perimeter[0] },
      { name: "right", point: kp.perimeter[1] },
      { name: "bottom", point: kp.perimeter[2] },
      { name: "left", point: kp.perimeter[3] },
      { name: "center", point: kp.extras.center },
    ];
    for (const { name, point } of points) {
      const dist = distance(pos, point);
      if (dist < threshold && (!best || dist < best.dist)) {
        best = { endpoint: { type: "locked-ellipse", id: ellipse.id, point: name }, position: point, dist };
      }
    }
  }

  for (const polygon of polygons) {
    for (let i = 0; i < polygon.points.length; i += 1) {
      const point = polygon.points[i].point;
      const dist = distance(pos, point);
      if (dist < threshold && (!best || dist < best.dist)) {
        best = { endpoint: { type: "locked-polygon", id: polygon.id, pointIndex: i }, position: point, dist };
      }
    }
  }

  return best;
}

/**
 * Applies grid snapping followed by key point snapping to a position.
 *
 * First grid-snaps the position using the provided grid settings.
 * Then checks if the grid-snapped position is within KEY_POINT_SNAP_THRESHOLD_PX (screen pixels)
 * of a geometry key point. If so, returns a locked ConstraintEndpoint.
 * Otherwise returns { type: "point", point: <grid-snapped position> }.
 * Shift-held disables both grid and key point snapping.
 */
export function applyKeyPointSnapping(
  pos: SheetPosition,
  shiftHeld: boolean,
  options: KeyPointSnappingOptions,
): ConstraintEndpoint {
  const gridSnapped = applySnapping(pos, null, {
    primaryGridSize: options.primaryGridSize,
    secondaryGridSize: options.secondaryGridSize,
    shiftHeld,
    superHeld: options.superHeld,
  });

  if (shiftHeld) {
    return { type: "point", point: gridSnapped };
  }

  const threshold = KEY_POINT_SNAP_THRESHOLD_PX / (SHEET_UNITS_TO_PIXELS * options.viewportScale);
  const match = snapNearestKeyPoint(gridSnapped, threshold, options.rectangles, options.ellipses, options.polygons);

  if (match) {
    return match.endpoint;
  }

  return { type: "point", point: gridSnapped };
}
