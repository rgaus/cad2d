import {
  ColinearConstraintComponent,
  type ConstrainedTrack,
  type ConstrainedTrackPath,
  type ConstraintEndpoint,
  DatumComponent,
  EllipseComponent,
  type EllipseEndpoint,
  Geometry,
  HorizontalConstraintComponent,
  type Id,
  LinearConstraintComponent,
  ParallelConstraintComponent,
  PerpendicularConstraintComponent,
  PolygonComponent,
  RectangleComponent,
  type RectangleEndpoint,
  VerticalConstraintComponent,
} from '@/lib/geometry';
import { Angle, Vector2 } from '@/lib/math';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { SheetPosition } from '@/lib/viewport/types';

export type SnappingOptions = {
  primaryGridSize: number;
  secondaryGridSize: number | null;
  ctrlHeld: boolean;
  superHeld: boolean;
};

/**
 * Snaps a point to grid lines (primary or secondary, whichever is closer).
 * Ctrl disables all snapping. Does NOT apply angular snapping — use
 * {@link applySnappingLineSeries} for that.
 */
export function applySnapping(pos: SheetPosition, options: SnappingOptions): SheetPosition {
  if (options.ctrlHeld) {
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
 * Ctrl disables all snapping.
 */
export function applySnappingLineSeries(
  pos: SheetPosition,
  prevPoint: SheetPosition,
  options: SnappingLineSeriesOptions,
): SheetPosition {
  let snapped = pos;
  if (!options.ctrlHeld) {
    snapped = snapToNearestGrid(pos, options.primaryGridSize, options.secondaryGridSize);

    if (options.superHeld) {
      snapped = snapToAngle(prevPoint, snapped);
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
  const primaryDist = Vector2.distance(pos, primarySnapped);

  if (secondarySize === null) {
    return primarySnapped;
  }

  const secondarySnapped = snapToGrid(pos, secondarySize);
  const secondaryDist = Vector2.distance(pos, secondarySnapped);

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
 * Snaps the end point to the nearest multiple of {@link angleDegrees} from the start point.
 * Preserves the distance from start to end.
 */
function snapToAngle(start: SheetPosition, end: SheetPosition, angleDegrees = 15): SheetPosition {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist === 0) {
    return end;
  }

  const angleStep = Angle.toRadians(angleDegrees);
  const angle = Math.atan2(dy, dx);
  const snapAngle = Math.round(angle / angleStep) * angleStep;

  return new SheetPosition(
    start.x + dist * Math.cos(snapAngle),
    start.y + dist * Math.sin(snapAngle),
  );
}

/** Pixel radius within which a cursor snaps to a geometry key point. */
const KEY_POINT_SNAP_THRESHOLD_PX = 16;

/** Payload for a {@link KeyPointSnapManager.keyPointSnapChange} event. Non-null when the
 *  cursor is within snapping range of a geometry key point. */
export type KeyPointSnapInfo = {
  endpoint: ConstraintEndpoint;
  sheetPosition: SheetPosition;
  shouldCreateDatum: boolean;
} | null;

/** Minimal manager interface that {@link applyKeyPointSnapping} uses to emit
 *  `keyPointSnapChange` events. Tools implement this via their `emit` method. */
export interface KeyPointSnapManager {
  emit(event: 'keyPointSnapChange', snapInfo: KeyPointSnapInfo): boolean;
}

export type KeyPointSnappingOptions = {
  viewportScale: number;
  primaryGridSize: number;
  secondaryGridSize: number | null;
  superHeld: boolean;

  /** Manager on which {@link applyKeyPointSnapping} emits `keyPointSnapChange` events. */
  manager: KeyPointSnapManager;

  rectangles: Array<Geometry<RectangleComponent>>;
  ellipses: Array<Geometry<EllipseComponent>>;
  polygons: Array<Geometry<PolygonComponent>>;
  /** All user constraints. Their free-floating (point-type) endpoints are checked as snap targets. */
  constraints: Array<Geometry>;
  /** Existing datums — checked as snap targets after constraint endpoints. */
  datums: Array<Geometry<DatumComponent>>;
};

export type KeyPointSnappingResult = {
  /** The constraint endpoint to use for the new constraint. May be a placeholder
   *  `point` type if `shouldCreateDatum` is set (the caller must create the datum
   *  and replace this with a `locked-datum` endpoint). */
  endpoint: ConstraintEndpoint;
  /** When non-null, snapping landed on a constraint's free endpoint.
   *  The caller should create a Datum at `position`, update ALL constraint
   *  endpoints at this position to `locked-datum`, and use `locked-datum` as
   *  the new constraint's endpoint. */
  shouldCreateDatum: {
    constraintId: Id;
    key: string;
    position: SheetPosition;
  } | null;
};

/** Returned as part of {@link KeyPointSnappingResult} to indicate if a {@link Datum} should be created or
 * not as part of a key point snapping operation. */
export type KeyPointShouldCreateDatum = {
  constraintId: Id;
  key: string;
  position: SheetPosition;
};

function getPositionKeys(constraint: Geometry): Array<string> {
  if (Geometry.hasComponent(constraint, LinearConstraintComponent)) {
    return LinearConstraintComponent.getPositionKeys();
  } else if (Geometry.hasComponent(constraint, PerpendicularConstraintComponent)) {
    return PerpendicularConstraintComponent.getPositionKeys();
  } else if (Geometry.hasComponent(constraint, ParallelConstraintComponent)) {
    return ParallelConstraintComponent.getPositionKeys();
  } else if (Geometry.hasComponent(constraint, HorizontalConstraintComponent)) {
    return HorizontalConstraintComponent.getPositionKeys();
  } else if (Geometry.hasComponent(constraint, VerticalConstraintComponent)) {
    return VerticalConstraintComponent.getPositionKeys();
  } else if (Geometry.hasComponent(constraint, ColinearConstraintComponent)) {
    return ColinearConstraintComponent.getPositionKeys();
  }
  return [];
}

/**
 * Finds the nearest geometry key point, constraint free endpoint, or datum point
 * within the given threshold distance (in sheet units).
 *
 * Check order: rectangles → ellipses → polygons → constraint endpoints → datums.
 * At equal distance, geometry wins over constraint endpoints, which wins over datums.
 */
function snapNearestKeyPoint(
  pos: SheetPosition,
  threshold: number,
  rectangles: Array<Geometry<RectangleComponent>>,
  ellipses: Array<Geometry<EllipseComponent>>,
  polygons: Array<Geometry<PolygonComponent>>,
  constraints: Array<Geometry>,
  datums: Array<Geometry<DatumComponent>>,
): {
  endpoint: ConstraintEndpoint;
  position: SheetPosition;
  dist: number;
  shouldCreateDatum: KeyPointShouldCreateDatum | null;
} | null {
  let bestEndpoint: ConstraintEndpoint | null = null;
  let bestPosition: SheetPosition | null = null;
  let bestDist = Infinity;
  let bestShouldCreateDatum: KeyPointShouldCreateDatum | null = null;

  function consider(
    dist: number,
    endpoint: ConstraintEndpoint,
    position: SheetPosition,
    shouldCreateDatum: KeyPointShouldCreateDatum | null = null,
  ) {
    if (dist < threshold && dist < bestDist) {
      bestDist = dist;
      bestEndpoint = endpoint;
      bestPosition = position;
      bestShouldCreateDatum = shouldCreateDatum;
    }
  }

  for (const rect of rectangles) {
    const kp = RectangleComponent.keyPoints(rect);
    for (let i = 0; i < kp.perimeter.length; i += 1) {
      const label = kp.perimeterLabels[i];
      if (label === null) {
        continue;
      }
      const point = kp.perimeter[i];
      consider(
        Vector2.distance(pos, point),
        {
          type: 'locked-rectangle',
          id: rect.id,
          point: label as RectangleEndpoint,
        },
        point,
      );
    }
    for (const [name, point] of Object.entries(kp.extras) as Array<
      [RectangleEndpoint, SheetPosition]
    >) {
      consider(
        Vector2.distance(pos, point),
        {
          type: 'locked-rectangle',
          id: rect.id,
          point: name,
        },
        point,
      );
    }
  }

  for (const ellipse of ellipses) {
    const kp = EllipseComponent.keyPoints(ellipse);
    for (let i = 0; i < kp.perimeter.length; i += 1) {
      const label = kp.perimeterLabels[i];
      if (label === null) {
        continue;
      }
      const point = kp.perimeter[i];
      consider(
        Vector2.distance(pos, point),
        {
          type: 'locked-ellipse',
          id: ellipse.id,
          point: label as EllipseEndpoint,
        },
        point,
      );
    }
    for (const [name, point] of Object.entries(kp.extras) as Array<
      [EllipseEndpoint, SheetPosition]
    >) {
      consider(
        Vector2.distance(pos, point),
        {
          type: 'locked-ellipse',
          id: ellipse.id,
          point: name,
        },
        point,
      );
    }
  }

  for (const polygon of polygons) {
    const polygonData = PolygonComponent.get(polygon);
    for (let i = 0; i < polygonData.points.length; i += 1) {
      const point = polygonData.points[i].point;
      consider(
        Vector2.distance(pos, point),
        {
          type: 'locked-polygon',
          id: polygon.id,
          pointIndex: i,
        },
        point,
      );
    }
  }

  for (const constraint of constraints) {
    for (const key of getPositionKeys(constraint)) {
      const components = constraint.components as Record<string, Record<string, unknown>>;
      let endpoint: ConstraintEndpoint | undefined;
      for (const compKey of Object.keys(components)) {
        const data = components[compKey];
        if (data && key in data) {
          endpoint = data[key] as ConstraintEndpoint;
          break;
        }
      }
      if (!endpoint || endpoint.type !== 'point') {
        continue;
      }
      consider(Vector2.distance(pos, endpoint.point), endpoint, endpoint.point, {
        constraintId: constraint.id,
        key,
        position: endpoint.point,
      });
    }
  }

  for (const datum of datums) {
    const point = DatumComponent.get(datum);
    consider(
      Vector2.distance(pos, point),
      {
        type: 'locked-datum',
        id: datum.id,
      },
      point,
    );
  }

  if (bestEndpoint === null || bestPosition === null) {
    return null;
  }
  return {
    endpoint: bestEndpoint,
    position: bestPosition,
    dist: bestDist,
    shouldCreateDatum: bestShouldCreateDatum,
  };
}

/**
 * Applies grid snapping and key point snapping to a position.
 *
 * **Important**: {@link pos} must be the **raw unsnapped** cursor position. The function
 * internally grid-snaps {@link pos} for the fallback result, but uses the raw {@link pos}
 * for the key-point proximity check so that nearby geometry key points are detected even
 * when the grid would snap the cursor away from them.
 *
 * Returns a {@link KeyPointSnappingResult} with the endpoint to use and optionally
 * {@link KeyPointSnappingResult.shouldCreateDatum} which the caller must handle
 * by creating a datum and consolidating all constraint endpoints at that position.
 */
export function applyKeyPointSnapping(
  pos: SheetPosition,
  ctrlHeld: boolean,
  options: KeyPointSnappingOptions,
): KeyPointSnappingResult {
  const gridSnapped = applySnapping(pos, {
    primaryGridSize: options.primaryGridSize,
    secondaryGridSize: options.secondaryGridSize,
    ctrlHeld,
    superHeld: options.superHeld,
  });

  if (ctrlHeld) {
    options.manager.emit('keyPointSnapChange', null);
    return { endpoint: { type: 'point', point: gridSnapped }, shouldCreateDatum: null };
  }

  const threshold = KEY_POINT_SNAP_THRESHOLD_PX / (SHEET_UNITS_TO_PIXELS * options.viewportScale);
  // Use raw pos (not gridSnapped) so key-point detection is not distorted by grid snapping
  const match = snapNearestKeyPoint(
    pos,
    threshold,
    options.rectangles,
    options.ellipses,
    options.polygons,
    options.constraints,
    options.datums,
  );

  if (match) {
    options.manager.emit('keyPointSnapChange', {
      endpoint: match.endpoint,
      sheetPosition: match.position,
      shouldCreateDatum: match.shouldCreateDatum !== null,
    });
    return { endpoint: match.endpoint, shouldCreateDatum: match.shouldCreateDatum };
  }

  options.manager.emit('keyPointSnapChange', null);
  return { endpoint: { type: 'point', point: gridSnapped }, shouldCreateDatum: null };
}

/**
 * Snaps a position to the nearest constrained track path.
 *
 * First applies grid snapping via {@link applySnapping}, then snaps to the closest
 * {@link ConstrainedTrack} (circle perimeter or point) if any tracks are provided.
 * If multiple tracks are provided (logical OR), the closest one wins.
 * If no tracks are provided, behaves identically to {@link applySnapping}.
 *
 * @param epsilon — geometric tolerance in sheet units for track membership and
 *   projection tests (e.g. checking if the cursor is at the center of a circle,
 *   or whether a slope should be treated as exactly zero).
 */
export function applySnappingOnConstrainedTrack(
  pos: SheetPosition,
  constrainedTracks: ConstrainedTrackPath,
  options: SnappingOptions,
  epsilon: number = 1e-10,
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

        if (distToCenter < epsilon) {
          // At the exact center — can't determine a projection direction, skip
          continue;
        }

        let target = new SheetPosition(
          track.center.x + (dx / distToCenter) * track.radius,
          track.center.y + (dy / distToCenter) * track.radius,
        );

        if (!options.ctrlHeld) {
          target = snapToAngle(track.center, target);
        }

        const snapDist = Vector2.distance(pos, target);
        if (snapDist < bestDist) {
          bestDist = snapDist;
          bestTarget = target;
        }
        break;
      }

      case 'point': {
        const snapDist = Vector2.distance(pos, track.point);
        if (snapDist < bestDist) {
          bestDist = snapDist;
          bestTarget = track.point;
        }
        break;
      }

      case 'line': {
        // Project the point onto the infinite line
        let projected: SheetPosition;
        if (Number.isFinite(track.slope) && Math.abs(track.slope) > epsilon) {
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

        let target = projected;

        // Snap axis-aligned lines to the perpendicular grid when ctrl is not held
        if (!options.ctrlHeld) {
          if (Number.isFinite(track.slope) && Math.abs(track.slope) < epsilon) {
            // Horizontal line: snap x to grid
            const gridSnapped = snapToNearestGrid(
              new SheetPosition(target.x, 0),
              options.primaryGridSize,
              options.secondaryGridSize,
            );
            target = new SheetPosition(gridSnapped.x, target.y);
          } else if (!Number.isFinite(track.slope)) {
            // Vertical line: snap y to grid
            const gridSnapped = snapToNearestGrid(
              new SheetPosition(0, target.y),
              options.primaryGridSize,
              options.secondaryGridSize,
            );
            target = new SheetPosition(target.x, gridSnapped.y);
          }
        }

        const snapDist = Vector2.distance(pos, target);
        if (snapDist < bestDist) {
          bestDist = snapDist;
          bestTarget = target;
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
