import {
  Constraint,
  ConstraintComponent,
  type ConstraintEndpoint,
  DatumComponent,
  type EllipseEndpoint,
  Entity,
  FrameComponent,
  GeometryComponent,
  type RectangleEndpoint,
} from '@/lib/entity';
import { type Geometry } from '@/lib/entity/geometry';
import { PolygonData } from '@/lib/entity/geometry/polygon';
import { Angle, BoundingBox, Vector2, closestPointOnSegment } from '@/lib/math';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { GeometryRelativeSheetPosition, SheetPosition } from '@/lib/viewport/types';
import { FilterComponent } from '../entity/components/FilterComponent';
import { getConstraintEndpointAdapterForEntity } from '../entity/components/templates/TransformableTemplate';
import { PatternFilter } from '../entity/filters/pattern';
import { lineLineIntersection, lineSlope } from '../math/intersection';

export type SnappingOptions = SnapToFilterOptions & {
  superHeld: boolean;
  viewportScale: number;
  selectedGeometryFilters?: Array<Entity<FilterComponent>>;
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

  if (options.selectedGeometryFilters) {
    const threshold = KEY_POINT_SNAP_THRESHOLD_PX / (SHEET_UNITS_TO_PIXELS * options.viewportScale);
    const filterSnapped = snapToFilters(pos, options.selectedGeometryFilters, threshold, options);
    if (filterSnapped) {
      return filterSnapped;
    }
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
    snapped = applySnapping(pos, options);

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

/** Default angular snap increment in degrees. */
export const ANGLE_SNAP_DEGREES = 15;

/**
 * Snaps the end point to the nearest multiple of {@link angleDegrees} from the start point.
 * Preserves the distance from start to end.
 */
export function snapToAngle(
  start: SheetPosition,
  end: SheetPosition,
  angleDegrees = ANGLE_SNAP_DEGREES,
): SheetPosition {
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

  geometries: Array<Geometry>;
  /** All user constraints. Their free-floating (point-type) endpoints are checked as snap targets. */
  constraints: Array<Entity<ConstraintComponent>>;
  /** Existing datums — checked as snap targets after constraint endpoints. */
  datums: Array<Entity<DatumComponent>>;
  /** Transformable entities which expose registered constraint endpoints (e.g. involute gears). */
  constraintEndpointTargets?: Array<Entity>;
  selectedGeometryFilters?: Array<Entity<FilterComponent>>;
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
    constraintId: Constraint['id'];
    key: string;
    position: SheetPosition;
  } | null;
};

/** Returned as part of {@link KeyPointSnappingResult} to indicate if a {@link Datum} should be created or
 * not as part of a key point snapping operation. */
export type KeyPointShouldCreateDatum = {
  constraintId: Constraint['id'];
  key: string;
  position: SheetPosition;
};

/**
 * Finds the nearest geometry key point, constraint free endpoint, or datum point
 * within the given threshold distance (in sheet units).
 *
 * At equal distance, geometry wins over constraint endpoints, which wins over datums.
 */
function snapNearestKeyPoint(
  pos: SheetPosition,
  threshold: number,
  geometries: Array<Geometry>,
  constraints: Array<Entity<ConstraintComponent>>,
  datums: Array<Entity<DatumComponent>>,
  constraintEndpointTargets: Array<Entity>,
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

  for (const geometry of geometries) {
    const data = GeometryComponent.get(geometry);
    switch (data.type) {
      case 'rectangle': {
        const kp = GeometryComponent.keyPoints(geometry);
        for (let i = 0; i < kp.perimeter.length; i += 1) {
          const label = kp.perimeterLabels[i];
          if (label === null) {
            continue;
          }
          const point = kp.perimeter[i].toSheet(geometry);
          consider(
            Vector2.distance(pos, point),
            { type: 'locked-rectangle', id: geometry.id, point: label as RectangleEndpoint },
            point,
          );
        }
        for (const [name, relativePoint] of Object.entries(kp.extras) as Array<
          [RectangleEndpoint, GeometryRelativeSheetPosition]
        >) {
          const point = relativePoint.toSheet(geometry);
          consider(
            Vector2.distance(pos, point),
            { type: 'locked-rectangle', id: geometry.id, point: name },
            point,
          );
        }
        break;
      }
      case 'ellipse': {
        const kp = GeometryComponent.keyPoints(geometry);
        for (let i = 0; i < kp.perimeter.length; i += 1) {
          const label = kp.perimeterLabels[i];
          if (label === null) {
            continue;
          }
          const point = kp.perimeter[i].toSheet(geometry);
          consider(
            Vector2.distance(pos, point),
            { type: 'locked-ellipse', id: geometry.id, point: label as EllipseEndpoint },
            point,
          );
        }
        for (const [name, relativePoint] of Object.entries(kp.extras) as Array<
          [EllipseEndpoint, GeometryRelativeSheetPosition]
        >) {
          const point = relativePoint.toSheet(geometry);
          consider(
            Vector2.distance(pos, point),
            { type: 'locked-ellipse', id: geometry.id, point: name },
            point,
          );
        }
        break;
      }
      case 'polygon': {
        const renderedPoints = PolygonData.renderedSegments(
          geometry as Entity<GeometryComponent<PolygonData>>,
        );
        for (let i = 0; i < renderedPoints.length; i += 1) {
          const point = renderedPoints[i].point;
          consider(
            Vector2.distance(pos, point),
            { type: 'locked-polygon', id: geometry.id, pointIndex: i },
            point,
          );
        }
        break;
      }
      default:
        data satisfies never;
        break;
    }
  }

  for (const constraintGeom of constraints) {
    const keys = Constraint.getPositionKeys(constraintGeom);
    for (const key of keys) {
      const ep = Constraint.getEndpoint(constraintGeom, key);
      if (!ep || typeof ep !== 'object' || !('type' in ep) || ep.type !== 'point') {
        continue;
      }
      consider(Vector2.distance(pos, ep.point), ep, ep.point, {
        constraintId: constraintGeom.id,
        key,
        position: ep.point,
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

  for (const target of constraintEndpointTargets) {
    const adapter = getConstraintEndpointAdapterForEntity(target);
    if (!adapter) {
      continue;
    }
    for (const option of adapter.keyPointOptions) {
      const point = adapter.getKeyPointPosition(target, option.value);
      if (!point) {
        continue;
      }
      consider(Vector2.distance(pos, point), adapter.create(target.id, option.value), point);
    }
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

type SnapToLineWhereIntersectsGridOptions = {
  ctrlHeld: boolean;
  primaryGridSize: number;
  secondaryGridSize: number | null;
};

function snapToLineWhereIntersectsGrid(
  pos: SheetPosition,
  pointA: SheetPosition,
  pointB: SheetPosition,
  threshold: number,
  options: SnapToLineWhereIntersectsGridOptions,
) {
  const result = closestPointOnSegment(pointA, pointB, pos);
  if (result.distance > threshold) {
    return null;
  }
  if (options.ctrlHeld) {
    return result.point;
  }

  // Snap to the line but stop at "detents" at each grid line as well
  const lineSnapped = result.point;
  const gridSnapped = snapToNearestGrid(
    result.point,
    options?.primaryGridSize,
    options?.secondaryGridSize,
  );

  // Find where the grid lines and snap line intersect. Axis-aligned snap lines only intersect one
  // family of grid lines (the other family is parallel), so track each family independently.
  const slope = lineSlope(pointA, pointB);
  const horizontalIntersections = lineLineIntersection(pointA, slope, gridSnapped, 0);
  const verticalIntersections = lineLineIntersection(pointA, slope, gridSnapped, Infinity);

  const candidates: Array<SheetPosition> = [];
  if (horizontalIntersections !== 'coincident') {
    candidates.push(...horizontalIntersections);
  }
  if (verticalIntersections !== 'coincident') {
    candidates.push(...verticalIntersections);
  }

  if (candidates.length === 0) {
    return lineSnapped;
  }

  let best = candidates[0];
  for (const candidate of candidates) {
    if (Vector2.distance(lineSnapped, candidate) < Vector2.distance(lineSnapped, best)) {
      best = candidate;
    }
  }
  return best;
}

type SnapToFilterOptions = SnapToLineWhereIntersectsGridOptions;

/** Given a position on the sheet, attempt to snap it to geometry features of different filters
 * types. Returns null if no snapping was possible or an updated SheetPosition if snapping occurred.
 * */
function snapToFilters(
  pos: SheetPosition,
  filters: Array<Entity<FilterComponent>>,
  threshold: number,
  options: SnapToFilterOptions,
): SheetPosition | null {
  let best: SheetPosition | null = null;
  let bestDistance = Infinity;

  const consider = (candidate: SheetPosition | null) => {
    if (!candidate) {
      return;
    }
    const distance = Vector2.distance(pos, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  };

  for (const filter of filters) {
    const filterData = FilterComponent.get(filter);
    switch (filterData.type) {
      case 'fillet':
      case 'chamfer':
        continue;
      case 'mirror': {
        consider(
          snapToLineWhereIntersectsGrid(
            pos,
            filterData.pointA,
            filterData.pointB,
            threshold,
            options,
          ),
        );
        continue;
      }
      case 'pattern': {
        switch (filterData.mode) {
          case 'grid': {
            if (!Entity.hasComponent(filter, FrameComponent)) {
              continue;
            }
            const frameData = FrameComponent.get(filter);
            const corners = BoundingBox.cornersToArray(
              BoundingBox.corners(
                BoundingBox.fromPoints([frameData.upperLeft, frameData.lowerRight]),
              ),
            );
            for (let i = 0; i < corners.length; i += 1) {
              const start = corners[i];
              const end = corners[(i + 1) % corners.length];
              consider(snapToLineWhereIntersectsGrid(pos, start, end, threshold, options));
            }
            break;
          }
          case 'radial': {
            const [upperLeft, upperRight] = PatternFilter.getRadialCornerPoints(filterData);

            consider(
              snapToLineWhereIntersectsGrid(pos, filterData.center, upperLeft, threshold, options),
            );
            consider(
              snapToLineWhereIntersectsGrid(pos, filterData.center, upperRight, threshold, options),
            );
            break;
          }
          default:
            filterData satisfies never;
            break;
        }
        break;
      }
      default:
        filterData satisfies never;
        continue;
    }
  }
  return best;
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
    viewportScale: options.viewportScale,
    selectedGeometryFilters: options.selectedGeometryFilters,
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
    options.geometries,
    options.constraints,
    options.datums,
    options.constraintEndpointTargets ?? [],
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

export {
  applyRotationOnConstrainedTrack,
  applySnappingOnConstrainedTrack,
  applyTranslationOnConstrainedTrack,
  computeConstrainedRotationDelta,
  type ConstrainedRotationDeltaResult,
  type RotationApplyResult,
  type RotationTarget,
  type RotationUpdate,
  type TranslationApplyResult,
} from './constrained-track-path';
