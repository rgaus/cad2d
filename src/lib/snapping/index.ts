import {
  type ConstrainedTrack,
  type ConstrainedTrackPath,
  type ConstraintEndpoint,
  EllipseComponent,
  type EllipseEndpoint,
  Geometry,
  type Polygon,
  PolygonComponent,
  RectangleComponent,
  type RectangleEndpoint,
} from '@/lib/geometry';
import { distance } from '@/lib/math';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { SheetPosition } from '@/lib/viewport/types';

export type SnappingOptions = {
  primaryGridSize: number;
  secondaryGridSize: number | null;
  shiftHeld: boolean;
  superHeld: boolean;
};

/**
 * Snaps a point to grid lines (primary or secondary, whichever is closer).
 * Shift disables all snapping. Does NOT apply angular snapping — use
 * {@link applySnappingLineSeries} for that.
 */
export function applySnapping(pos: SheetPosition, options: SnappingOptions): SheetPosition {
  if (options.shiftHeld) {
    return pos;
  }

  return snapToNearestGrid(pos, options.primaryGridSize, options.secondaryGridSize);
}

export type SnappingLineSeriesOptions = SnappingOptions & {
  /** If set, scale the snapped result to be exactly this distance from prevPoint. */
  exactDistance?: number;
};

/**
 * Snaps a point to grid lines and, when super is held, also applies 45-degree
 * angular snapping from the previous point (line series mode).
 * Shift disables all snapping.
 */
export function applySnappingLineSeries(
  pos: SheetPosition,
  prevPoint: SheetPosition,
  options: SnappingLineSeriesOptions,
): SheetPosition {
  let snapped = pos;
  if (!options.shiftHeld) {
    snapped = snapToNearestGrid(pos, options.primaryGridSize, options.secondaryGridSize);

    if (options.superHeld) {
      snapped = snapTo45Degrees(prevPoint, snapped);
    }
  }

  // Apply exact distance constraint even if shift isn't being held, since it is due to a
  // constraint, not due to a snap
  if (typeof options.exactDistance === 'number') {
    const dx = snapped.x - prevPoint.x;
    const dy = snapped.y - prevPoint.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0 && dist !== options.exactDistance) {
      snapped = new SheetPosition(
        prevPoint.x + (dx / dist) * options.exactDistance,
        prevPoint.y + (dy / dist) * options.exactDistance,
      );
    }
  }

  return snapped;
}

/**
 * Snaps to the nearest grid line (primary or secondary, whichever is closer).
 */
export function snapToNearestGrid(
  pos: SheetPosition,
  primarySize: number,
  secondarySize: number | null,
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
    Math.round(pos.y / gridSize) * gridSize,
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
    start.y + dist * Math.sin(snapAngle),
  );
}

/** Pixel radius within which a cursor snaps to a geometry key point. */
const KEY_POINT_SNAP_THRESHOLD_PX = 8;

export type KeyPointSnappingOptions = {
  viewportScale: number;
  primaryGridSize: number;
  secondaryGridSize: number | null;
  superHeld: boolean;
  rectangles: Array<Geometry<RectangleComponent>>;
  ellipses: Array<Geometry<EllipseComponent>>;
  polygons: Array<Geometry<PolygonComponent>>;
};

/**
 * Finds the nearest geometry key point (rectangle corner, ellipse key point, or polygon vertex)
 * within the given threshold distance (in sheet units).
 */
function snapNearestKeyPoint(
  pos: SheetPosition,
  threshold: number,
  rectangles: Array<Geometry<RectangleComponent>>,
  ellipses: Array<Geometry<EllipseComponent>>,
  polygons: Array<Geometry<PolygonComponent>>,
): { endpoint: ConstraintEndpoint; position: SheetPosition; dist: number } | null {
  let best: { endpoint: ConstraintEndpoint; position: SheetPosition; dist: number } | null = null;

  for (const rect of rectangles) {
    const kp = RectangleComponent.keyPoints(rect);
    const corners: Array<{ name: RectangleEndpoint; point: SheetPosition }> = [
      { name: 'upperLeft', point: kp.perimeter[0] },
      { name: 'upperRight', point: kp.perimeter[1] },
      { name: 'lowerRight', point: kp.perimeter[2] },
      { name: 'lowerLeft', point: kp.perimeter[3] },
    ];
    for (const { name, point } of corners) {
      const dist = distance(pos, point);
      if (dist < threshold && (!best || dist < best.dist)) {
        best = {
          endpoint: { type: 'locked-rectangle', id: rect.id, point: name },
          position: point,
          dist,
        };
      }
    }
  }

  for (const ellipse of ellipses) {
    const kp = EllipseComponent.keyPoints(ellipse);
    const points: Array<{ name: EllipseEndpoint; point: SheetPosition }> = [
      { name: 'top', point: kp.perimeter[0] },
      { name: 'right', point: kp.perimeter[1] },
      { name: 'bottom', point: kp.perimeter[2] },
      { name: 'left', point: kp.perimeter[3] },
      { name: 'center', point: kp.extras.center },
    ];
    for (const { name, point } of points) {
      const dist = distance(pos, point);
      if (dist < threshold && (!best || dist < best.dist)) {
        best = {
          endpoint: { type: 'locked-ellipse', id: ellipse.id, point: name },
          position: point,
          dist,
        };
      }
    }
  }

  for (const polygon of polygons) {
    const polygonData = PolygonComponent.get(polygon);
    for (let i = 0; i < polygonData.points.length; i += 1) {
      const point = polygonData.points[i].point;
      const dist = distance(pos, point);
      if (dist < threshold && (!best || dist < best.dist)) {
        best = {
          endpoint: { type: 'locked-polygon', id: polygon.id, pointIndex: i },
          position: point,
          dist,
        };
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
  const gridSnapped = applySnapping(pos, {
    primaryGridSize: options.primaryGridSize,
    secondaryGridSize: options.secondaryGridSize,
    shiftHeld,
    superHeld: options.superHeld,
  });

  if (shiftHeld) {
    return { type: 'point', point: gridSnapped };
  }

  const threshold = KEY_POINT_SNAP_THRESHOLD_PX / (SHEET_UNITS_TO_PIXELS * options.viewportScale);
  const match = snapNearestKeyPoint(
    gridSnapped,
    threshold,
    options.rectangles,
    options.ellipses,
    options.polygons,
  );

  if (match) {
    return match.endpoint;
  }

  return { type: 'point', point: gridSnapped };
}

const CONSTRAINED_TRACK_EPSILON = 1e-10;

/**
 * Snaps a position to the nearest constrained track path.
 *
 * First applies grid snapping via {@link applySnapping}, then snaps to the closest
 * {@link ConstrainedTrack} (circle perimeter or point) if any tracks are provided.
 * If multiple tracks are provided (logical OR), the closest one wins.
 * If no tracks are provided, behaves identically to {@link applySnapping}.
 */
export function applySnappingOnConstrainedTrack(
  pos: SheetPosition,
  constrainedTracks: ConstrainedTrackPath,
  options: SnappingOptions,
): SheetPosition {
  if (constrainedTracks === 'immobile') {
    return pos;
  }

  let snapped = applySnapping(pos, options);

  if (constrainedTracks === 'unconstrained' || constrainedTracks.length === 0) {
    return snapped;
  }

  // Flatten any `or` tracks so each inner alternative is scanned independently
  const flatTracks: Array<Exclude<ConstrainedTrack, { type: 'or' }>> = [];
  const collect = (items: Array<ConstrainedTrack>): void => {
    for (const t of items) {
      if (t.type === 'or') {
        collect(t.inner);
      } else {
        flatTracks.push(t as unknown as Exclude<ConstrainedTrack, { type: 'or' }>);
      }
    }
  };
  collect(constrainedTracks);

  let bestTarget: SheetPosition | null = null;
  let bestDist = Infinity;

  for (const track of flatTracks) {
    switch (track.type) {
      case 'circle': {
        const dx = pos.x - track.center.x;
        const dy = pos.y - track.center.y;
        const distToCenter = Math.sqrt(dx * dx + dy * dy);

        if (distToCenter < CONSTRAINED_TRACK_EPSILON) {
          // At the exact center — can't determine a projection direction, skip
          continue;
        }

        const snapDist = Math.abs(distToCenter - track.radius);
        if (snapDist < bestDist) {
          bestDist = snapDist;
          bestTarget = new SheetPosition(
            track.center.x + (dx / distToCenter) * track.radius,
            track.center.y + (dy / distToCenter) * track.radius,
          );
        }
        break;
      }

      case 'point': {
        const snapDist = distance(pos, track.point);
        if (snapDist < bestDist) {
          bestDist = snapDist;
          bestTarget = track.point;
        }
        break;
      }

      case 'line': {
        // Project the point onto the infinite line
        let projected: SheetPosition;
        if (Number.isFinite(track.slope) && Math.abs(track.slope) > CONSTRAINED_TRACK_EPSILON) {
          // Perpendicular slope: -1/m
          const mPerp = -1 / track.slope;
          const bLine = track.point.y - track.slope * track.point.x;
          const bPerp = pos.y - mPerp * pos.x;
          const x = (bPerp - bLine) / (track.slope - mPerp);
          projected = new SheetPosition(x, track.slope * x + bLine);
        } else if (Number.isFinite(track.slope)) {
          // Horizontal line (slope ~= 0): closest point has same y
          projected = new SheetPosition(pos.x, track.point.y);
        } else {
          // Vertical line: closest point has same x
          projected = new SheetPosition(track.point.x, pos.y);
        }

        const snapDist = distance(pos, projected);
        if (snapDist < bestDist) {
          bestDist = snapDist;
          bestTarget = projected;
        }
        break;
      }
    }
  }

  if (bestTarget !== null) {
    return bestTarget;
  }

  return snapped;
}
