import { distance } from '@/lib/math';
import { WorkingConstraint } from '@/lib/tools/types';
import { UnitType } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';
import { ConstraintEndpoint } from './constraint-endpoint';

/** A locus of possible positions for a moving point, derived from constraints and fixed geometry. */
export type ConstrainedTrack =
  | { type: 'circle'; center: SheetPosition; radius: number }
  | { type: 'point'; point: SheetPosition };

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
 * Intersects two {@link ConstrainedTrack} values and returns the resulting tracks.
 * Returns `'immobile'` when the intersection is empty (no valid positions).
 */
function intersectTracks(
  a: ConstrainedTrack,
  b: ConstrainedTrack,
): Array<ConstrainedTrack> | 'immobile' {
  // Normalize so circles come first for simpler pattern matching
  if (a.type === 'point' && b.type === 'circle') {
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
export const ConstrainedTrack = { intersectTracks };

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
  C extends Pick<WorkingConstraint, 'type' | 'pointA' | 'pointB' | 'constrainedLength'>,
>(
  constraints: Array<C>,
  movingPoints: Array<SheetPosition>,
  sheetUnit: UnitType,
  resolveEndpoint: (endpoint: ConstraintEndpoint) => SheetPosition | null,
): 'unconstrained' | Array<ConstrainedTrack> | 'immobile' {
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
        if (constraint.constrainedLength === null) {
          continue;
        }

        const resolvedA = resolveEndpoint(constraint.pointA);
        const resolvedB = resolveEndpoint(constraint.pointB);

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
        const radius = constraint.constrainedLength.toSheetUnits(sheetUnit).magnitude;
        tracks.push({ type: 'circle', center, radius });
        break;
      }

      default: {
        // Future constraint types will add cases here
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
