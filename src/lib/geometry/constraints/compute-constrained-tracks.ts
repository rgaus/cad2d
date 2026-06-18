import { distance, dotVec2, subVec2 } from '@/lib/math';
import { WorkingConstraint } from '@/lib/tools/types';
import { UnitType } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';
import { ConstraintEndpoint } from './constraint-endpoint';

/** A locus of possible positions for a moving point, derived from constraints and fixed geometry. */
export type ConstrainedTrack =
  | { type: 'circle'; center: SheetPosition; radius: number }
  | { type: 'point'; point: SheetPosition }
  | { type: 'ray'; origin: SheetPosition; direction: SheetPosition };

/**
 * A path that a given point can move along when dragged.
 *
 * This is either:
 * - 'unconstrained' - no restrictions, free movement permitted
 * - `Array<ConstrainedTrack>` - movement allowed along any of these paths. Note this is a logical OR,
 *   snapping to any of these paths is ok and depending on the user's mouse position the chosen
 *   track could "jump".
 * - 'immobile' - fully constrained, no movement allowed
 */
export type ConstrainedTrackPath = 'unconstrained' | Array<ConstrainedTrack> | 'immobile';

const EPSILON = 1e-10;

/**
 * Checks whether two SheetPosition values represent the same point (within epsilon).
 */
function pointsEqual(a: SheetPosition, b: SheetPosition): boolean {
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
}

/**
 * Checks whether a point lies on a circle (within epsilon).
 */
function isPointOnCircle(point: SheetPosition, center: SheetPosition, radius: number): boolean {
  return Math.abs(distance(point, center) - radius) < EPSILON;
}

/**
 * Computes the intersection points of two circles.
 * Returns 0, 1, or 2 points. Returns null when the circles are coincident (same center, same
 * radius) or when there is no intersection.
 */
function circleCircleIntersection(
  c1: SheetPosition,
  r1: number,
  c2: SheetPosition,
  r2: number,
): Array<SheetPosition> | 'coincident' {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const dSq = dx * dx + dy * dy;
  const d = Math.sqrt(dSq);

  // Coincident circles — same center, same radius
  if (d < EPSILON && Math.abs(r1 - r2) < EPSILON) {
    return 'coincident';
  }

  // Concentric but different radii — no intersection
  if (d < EPSILON) {
    return [];
  }

  // Too far apart or one inside the other
  if (d > r1 + r2 + EPSILON || d < Math.abs(r1 - r2) - EPSILON) {
    return [];
  }

  // Tangent (externally or internally)
  if (Math.abs(d - (r1 + r2)) < EPSILON || Math.abs(d - Math.abs(r1 - r2)) < EPSILON) {
    const t = r1 / d;
    return [new SheetPosition(c1.x + dx * t, c1.y + dy * t)];
  }

  // Two intersection points
  const a = (r1 * r1 - r2 * r2 + dSq) / (2 * d);
  const hSq = r1 * r1 - a * a;
  const h = Math.sqrt(hSq);

  const x = c1.x + (a * dx) / d;
  const y = c1.y + (a * dy) / d;

  return [
    new SheetPosition(x + (h * dy) / d, y - (h * dx) / d),
    new SheetPosition(x - (h * dy) / d, y + (h * dx) / d),
  ];
}

/**
 * Checks whether a point lies on a ray (within epsilon).
 * A point is on a ray if (point - origin) is in the direction of
 * the ray (t >= 0) and the perpendicular distance from the ray is negligible.
 */
function isPointOnRay(
  point: SheetPosition,
  origin: SheetPosition,
  direction: SheetPosition,
): boolean {
  const v = subVec2(point, origin);
  const t = dotVec2(v, direction);
  if (t < -EPSILON) {
    return false;
  }
  // Cross product magnitude = |v × direction|
  const perpDist = Math.abs(v.x * direction.y - v.y * direction.x);
  return perpDist < EPSILON;
}

/**
 * Computes the intersection points of a ray (origin + t * direction, t >= 0)
 * with a circle (center, radius). Returns 0, 1, or 2 points.
 */
function rayCircleIntersection(
  origin: SheetPosition,
  direction: SheetPosition,
  center: SheetPosition,
  radius: number,
): Array<SheetPosition> {
  // f = origin - center
  const fx = origin.x - center.x;
  const fy = origin.y - center.y;

  // Solve t^2 + 2 * t * (f · d) + (f · f - r^2) = 0
  const fDotD = fx * direction.x + fy * direction.y;
  const fDotF = fx * fx + fy * fy;
  const discriminant = fDotD * fDotD - fDotF + radius * radius;

  if (discriminant < -EPSILON) {
    return [];
  }

  if (Math.abs(discriminant) < EPSILON) {
    // Tangent — one intersection
    const t = -fDotD;
    if (t < -EPSILON) {
      return [];
    }
    return [new SheetPosition(origin.x + t * direction.x, origin.y + t * direction.y)];
  }

  const sqrtD = Math.sqrt(discriminant);
  const t1 = -fDotD - sqrtD;
  const t2 = -fDotD + sqrtD;

  const result: Array<SheetPosition> = [];
  if (t1 >= -EPSILON) {
    result.push(new SheetPosition(origin.x + t1 * direction.x, origin.y + t1 * direction.y));
  }
  if (t2 >= -EPSILON) {
    const pt2 = new SheetPosition(origin.x + t2 * direction.x, origin.y + t2 * direction.y);
    // Deduplicate when discriminant is effectively zero (float precision)
    if (result.length === 0 || distance(result[0], pt2) > EPSILON) {
      result.push(pt2);
    }
  }
  return result;
}

/**
 * Computes the intersection of two rays.
 *
 * Returns:
 *  - A single intersection point if the rays converge (both t >= 0).
 *  - 'coincident' if the rays are collinear and overlap.
 *  - 'diverge' if the rays are parallel and non-collinear, or if the
 *    intersection point is behind one of the ray origins.
 */
function rayRayIntersection(
  origin1: SheetPosition,
  dir1: SheetPosition,
  origin2: SheetPosition,
  dir2: SheetPosition,
): Array<SheetPosition> | 'coincident' | 'diverge' {
  const cross = dir1.x * dir2.y - dir2.x * dir1.y;
  const delta = subVec2(origin2, origin1);

  if (Math.abs(cross) < EPSILON) {
    // Parallel rays — check if collinear
    const cross2 = delta.x * dir1.y - delta.y * dir1.x;
    if (Math.abs(cross2) >= EPSILON) {
      return 'diverge';
    }
    return 'coincident';
  }

  // Solve origin1 + t1 * dir1 = origin2 + t2 * dir2
  // t1 = (delta.x * dir2.y - dir2.x * delta.y) / cross
  // t2 = (delta.x * dir1.y - dir1.x * delta.y) / cross
  const t1 = (delta.x * dir2.y - dir2.x * delta.y) / cross;
  const t2 = (delta.x * dir1.y - dir1.x * delta.y) / cross;

  if (t1 < -EPSILON || t2 < -EPSILON) {
    return 'diverge';
  }

  return [new SheetPosition(origin1.x + t1 * dir1.x, origin1.y + t1 * dir1.y)];
}

export namespace ConstrainedTrack {
  /**
   * Intersects two {@link ConstrainedTrack} values and returns the resulting tracks.
   * Returns `'immobile'` when the intersection is empty (no valid positions).
   */
  export function intersectTracks(
    a: ConstrainedTrack,
    b: ConstrainedTrack,
  ): Array<ConstrainedTrack> | 'immobile' {
    // Normalize: circle > ray > point
    if (a.type !== 'circle' && b.type === 'circle') {
      return ConstrainedTrack.intersectTracks(b, a);
    }
    if (a.type === 'point' && b.type === 'ray') {
      return ConstrainedTrack.intersectTracks(b, a);
    }

    if (a.type === 'circle' && b.type === 'circle') {
      const pts = circleCircleIntersection(a.center, a.radius, b.center, b.radius);
      if (pts === 'coincident') {
        return [a];
      }
      if (pts.length === 0) {
        return 'immobile';
      }
      return pts.map((p) => ({ type: 'point' as const, point: p }));
    }

    // circle ∩ point (normalized above so a is the circle)
    if (a.type === 'circle' && b.type === 'point') {
      if (isPointOnCircle(b.point, a.center, a.radius)) {
        return [b];
      }
      return 'immobile';
    }

    // circle ∩ ray (normalized above so a is the circle)
    if (a.type === 'circle' && b.type === 'ray') {
      const pts = rayCircleIntersection(b.origin, b.direction, a.center, a.radius);
      if (pts.length === 0) {
        return 'immobile';
      }
      return pts.map((p) => ({ type: 'point' as const, point: p }));
    }

    // ray ∩ ray
    if (a.type === 'ray' && b.type === 'ray') {
      const rri = rayRayIntersection(a.origin, a.direction, b.origin, b.direction);
      if (rri === 'diverge') {
        return 'immobile';
      }
      if (rri === 'coincident') {
        // Both rays overlap — keep the more restrictive track (pick one, they're the same)
        return [a];
      }
      return rri.map((p) => ({ type: 'point' as const, point: p }));
    }

    // ray ∩ point (normalized above so a is the ray)
    if (a.type === 'ray' && b.type === 'point') {
      if (isPointOnRay(b.point, a.origin, a.direction)) {
        return [b];
      }
      return 'immobile';
    }

    // point ∩ point
    if (a.type === 'point' && b.type === 'point') {
      if (pointsEqual(a.point, b.point)) {
        return [a];
      }
      return 'immobile';
    }

    // Exhaustive check — should never reach here
    return 'immobile';
  }

  export function applyOffset(track: ConstrainedTrack, offset: SheetPosition): ConstrainedTrack {
    switch (track.type) {
      case 'circle': {
        return {
          type: 'circle',
          center: new SheetPosition(track.center.x - offset.x, track.center.y - offset.y),
          radius: track.radius,
        };
      }
      case 'point': {
        return {
          type: 'point',
          point: new SheetPosition(track.point.x - offset.x, track.point.y - offset.y),
        };
      }
      case 'ray': {
        return {
          type: 'ray',
          origin: new SheetPosition(track.origin.x - offset.x, track.origin.y - offset.y),
          direction: track.direction,
        };
      }
    }
  }
}

/**
 * Converts a {@link Constraint} or {@link WorkingConstraint} into an array of
 * {@link ConstrainedTrack} values, one per constraint that involves exactly one moving point.
 *
 * Returns `'unconstrained'` if there are no constraints or no moving points, `'immobile'` if the
 * constraints cannot all be simultaneously satisfied, or an array of tracks otherwise.
 *
 * Each constraint is processed by resolving its endpoints to {@link SheetPosition} values via the
 * provided `resolveEndpoint` callback (which should call through to
 * `GeometryStore.resolveConstraintEndpoint`).
 *
 * The tracks are then intersected together: circles that overlap reduce to intersection points,
 * points on circles reduce to points, and incompatible tracks produce `'immobile'`.
 */
export function computeConstrainedTracksForPoints<
  C extends { type: string; pointA: ConstraintEndpoint; pointB: ConstraintEndpoint },
>(
  constraints: Array<C>,
  movingPoints: Array<SheetPosition>,
  sheetUnit: UnitType,
  resolveEndpoint: (endpoint: ConstraintEndpoint) => SheetPosition | null,
): ConstrainedTrackPath {
  if (constraints.length === 0 || movingPoints.length === 0) {
    return 'unconstrained';
  }

  // Build a Set of moving positions for O(1) lookup
  const movingSet = new Set<string>();
  for (const mp of movingPoints) {
    movingSet.add(`${mp.x},${mp.y}`);
  }
  function isMoving(pos: SheetPosition): boolean {
    return movingSet.has(`${pos.x},${pos.y}`);
  }

  const tracks: Array<ConstrainedTrack> = [];

  for (const constraint of constraints) {
    switch (constraint.type) {
      case 'linear': {
        const linearConstraint = constraint as unknown as {
          type: 'linear';
          pointA: ConstraintEndpoint;
          pointB: ConstraintEndpoint;
          constrainedLength: import('@/lib/units/length').Length | null;
        };
        if (linearConstraint.constrainedLength === null) {
          continue;
        }

        const resolvedA = resolveEndpoint(linearConstraint.pointA);
        const resolvedB = resolveEndpoint(linearConstraint.pointB);

        // Both endpoints must be resolvable to produce a meaningful track
        if (resolvedA === null || resolvedB === null) {
          continue;
        }

        const aIsMoving = isMoving(resolvedA);
        const bIsMoving = isMoving(resolvedB);

        // 0 moving = both are fixed (constraint already satisfied, no constraint on moving set)
        // 2 moving = both move together (constraint preserved automatically, no track needed)
        if (aIsMoving === bIsMoving) {
          continue;
        }

        // Exactly one endpoint is moving — produce a circle around the fixed endpoint
        const center = aIsMoving ? resolvedB : resolvedA;
        const radius = linearConstraint.constrainedLength.toSheetUnits(sheetUnit).magnitude;
        tracks.push({ type: 'circle', center, radius });
        break;
      }

      case 'angular': {
        // FIXME: angular constraint track computation — produces a ray track
        // when one endpoint (A or C) moves while center is fixed.
        break;
      }

      default: {
        break;
      }
    }
  }

  if (tracks.length === 0) {
    return 'unconstrained';
  }

  // Fold/reduce: intersect all tracks together
  let result: Array<ConstrainedTrack> = [tracks[0]];
  for (let i = 1; i < tracks.length; i += 1) {
    const next: Array<ConstrainedTrack> = [];
    for (const existing of result) {
      const intersection = ConstrainedTrack.intersectTracks(existing, tracks[i]);
      if (intersection === 'immobile') {
        // This pair produced nothing — skip it; other pairs might still yield results
        continue;
      }
      next.push(...intersection);
    }
    if (next.length === 0) {
      return 'immobile';
    }
    result = next;
  }

  return result;
}
