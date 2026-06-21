import { distance } from '@/lib/math';
import { UnitType } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';
import { Constraint } from '.';
import { ConstraintEndpoint } from './constraint-endpoint';

/** A locus of possible positions for a moving point, derived from constraints and fixed geometry. */
export type ConstrainedTrack =
  | { type: 'circle'; center: SheetPosition; radius: number }
  | { type: 'point'; point: SheetPosition }
  | { type: 'line'; slope: number; point: SheetPosition };

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
 * Checks whether a point lies on an infinite line defined by
 * a point and a slope. For vertical lines (slope Infinity/NaN), checks x-coordinate.
 */
function isPointOnLine(point: SheetPosition, linePoint: SheetPosition, slope: number): boolean {
  if (!Number.isFinite(slope)) {
    return Math.abs(point.x - linePoint.x) < EPSILON;
  }
  return Math.abs(point.y - linePoint.y - slope * (point.x - linePoint.x)) < EPSILON;
}

/**
 * Computes the intersection points of two circles.
 * Returns 0, 1, or 2 points. Returns 'coincident' when the circles are the same.
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
 * Returns the y-intercept of a line defined by point + slope.
 * For vertical lines, returns Infinity.
 */
function lineIntercept(linePoint: SheetPosition, slope: number): number {
  if (!Number.isFinite(slope)) {
    return Infinity;
  }
  return linePoint.y - slope * linePoint.x;
}

/**
 * Computes the intersection points of an infinite line (defined by a point and slope)
 * with a circle (center, radius). Returns 0, 1, or 2 points.
 */
function lineCircleIntersection(
  linePoint: SheetPosition,
  slope: number,
  center: SheetPosition,
  radius: number,
): Array<SheetPosition> {
  if (!Number.isFinite(slope)) {
    // Vertical line: x = linePoint.x
    const dx = linePoint.x - center.x;
    const dxSq = dx * dx;
    const rSq = radius * radius;

    if (dxSq > rSq + EPSILON) {
      return [];
    }

    if (Math.abs(dxSq - rSq) < EPSILON) {
      return [new SheetPosition(linePoint.x, center.y)];
    }

    const dy = Math.sqrt(rSq - dxSq);
    return [
      new SheetPosition(linePoint.x, center.y - dy),
      new SheetPosition(linePoint.x, center.y + dy),
    ];
  }

  // y = mx + b
  const b = lineIntercept(linePoint, slope);

  // (x - cx)^2 + (mx + b - cy)^2 = r^2
  // (1 + m^2)*x^2 + 2*(-cx + m*(b-cy))*x + (cx^2 + (b-cy)^2 - r^2) = 0
  const mSq = slope * slope;
  const A = 1 + mSq;
  const B = 2 * (slope * (b - center.y) - center.x);
  const C = center.x * center.x + (b - center.y) * (b - center.y) - radius * radius;

  const discriminant = B * B - 4 * A * C;

  if (discriminant < -EPSILON) {
    return [];
  }

  if (Math.abs(discriminant) < EPSILON) {
    const x = -B / (2 * A);
    return [new SheetPosition(x, slope * x + b)];
  }

  const sqrtD = Math.sqrt(discriminant);
  const x1 = (-B - sqrtD) / (2 * A);
  const x2 = (-B + sqrtD) / (2 * A);
  return [new SheetPosition(x1, slope * x1 + b), new SheetPosition(x2, slope * x2 + b)];
}

/**
 * Computes the intersection of two infinite lines.
 *
 * Each line is defined by a point + slope.
 *
 * Returns:
 *  - A single intersection point if the lines converge.
 *  - 'coincident' if the lines are the same line.
 *  - An empty array if the lines are parallel and distinct.
 */
function lineLineIntersection(
  p1: SheetPosition,
  m1: number,
  p2: SheetPosition,
  m2: number,
): Array<SheetPosition> | 'coincident' {
  const bothVertical = !Number.isFinite(m1) && !Number.isFinite(m2);
  const oneVertical = !Number.isFinite(m1) || !Number.isFinite(m2);

  if (bothVertical) {
    if (Math.abs(p1.x - p2.x) < EPSILON) {
      return 'coincident';
    }
    return [];
  }

  if (oneVertical) {
    // m1 is vertical, m2 is finite (swap if needed)
    const vLine = !Number.isFinite(m1) ? p1 : p2;
    const fLine = !Number.isFinite(m1) ? { point: p2, m: m2 } : { point: p1, m: m1 };
    const x = vLine.x;
    const y = fLine.m * (x - fLine.point.x) + fLine.point.y;
    return [new SheetPosition(x, y)];
  }

  // Both slopes finite
  if (Math.abs(m1 - m2) < EPSILON) {
    const b1 = lineIntercept(p1, m1);
    const b2 = lineIntercept(p2, m2);
    if (Math.abs(b1 - b2) < EPSILON) {
      return 'coincident';
    }
    return [];
  }

  // m1 != m2 — solve m1*x + b1 = m2*x + b2
  const b1 = lineIntercept(p1, m1);
  const b2 = lineIntercept(p2, m2);
  const x = (b2 - b1) / (m1 - m2);
  return [new SheetPosition(x, m1 * x + b1)];
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
    // Normalize: circle > line > point
    if (a.type !== 'circle' && b.type === 'circle') {
      return ConstrainedTrack.intersectTracks(b, a);
    }
    if (a.type === 'point' && b.type === 'line') {
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

    // circle ∩ line (normalized above so a is the circle)
    if (a.type === 'circle' && b.type === 'line') {
      const pts = lineCircleIntersection(b.point, b.slope, a.center, a.radius);
      if (pts.length === 0) {
        return 'immobile';
      }
      return pts.map((p) => ({ type: 'point' as const, point: p }));
    }

    // line ∩ line
    if (a.type === 'line' && b.type === 'line') {
      const lli = lineLineIntersection(a.point, a.slope, b.point, b.slope);
      if (lli === 'coincident') {
        return [a];
      }
      if (lli.length === 0) {
        return 'immobile';
      }
      return lli.map((p) => ({ type: 'point' as const, point: p }));
    }

    // line ∩ point (normalized above so a is the line)
    if (a.type === 'line' && b.type === 'point') {
      if (isPointOnLine(b.point, a.point, a.slope)) {
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
      case 'line': {
        return {
          type: 'line',
          point: new SheetPosition(track.point.x - offset.x, track.point.y - offset.y),
          slope: track.slope,
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
export function computeConstrainedTracksForPoints(
  constraints: Array<Constraint>,
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

        // Exactly one endpoint is moving
        const center = aIsMoving ? resolvedB : resolvedA;
        const radius = constraint.constrainedLength.toSheetUnits(sheetUnit).magnitude;

        if (constraint.axis === 'x') {
          // |dx| = constrainedLength → two vertical lines
          tracks.push({
            type: 'line',
            point: new SheetPosition(center.x - radius, center.y),
            slope: Infinity,
          });
          if (radius > EPSILON) {
            tracks.push({
              type: 'line',
              point: new SheetPosition(center.x + radius, center.y),
              slope: Infinity,
            });
          }
        } else if (constraint.axis === 'y') {
          // |dy| = constrainedLength → two horizontal lines
          tracks.push({
            type: 'line',
            point: new SheetPosition(center.x, center.y - radius),
            slope: 0,
          });
          if (radius > EPSILON) {
            tracks.push({
              type: 'line',
              point: new SheetPosition(center.x, center.y + radius),
              slope: 0,
            });
          }
        } else {
          // Full diagonal → circle around the fixed endpoint
          tracks.push({ type: 'circle', center, radius });
        }
        break;
      }

      case 'perpendicular': {
        const resolvedCenter = resolveEndpoint(constraint.pointCenter);
        const resolvedA = resolveEndpoint(constraint.pointA);
        const resolvedB = resolveEndpoint(constraint.pointB);

        if (!resolvedCenter || !resolvedA || !resolvedB) {
          continue;
        }

        const centerMoving = isMoving(resolvedCenter);
        const aMoving = isMoving(resolvedA);
        const cMoving = isMoving(resolvedB);

        // 0 or 2+ moving: no useful single-endpoint track
        if (!centerMoving && !aMoving && !cMoving) {
          continue;
        }
        if ([centerMoving, aMoving, cMoving].filter(Boolean).length !== 1) {
          continue;
        }

        if (aMoving) {
          // pointA must lie on the line through center perpendicular to (center -> pointB)
          const dx = resolvedB.x - resolvedCenter.x;
          const dy = resolvedB.y - resolvedCenter.y;
          tracks.push({
            type: 'line',
            point: resolvedCenter,
            slope: Math.abs(dy) < EPSILON ? Infinity : -dx / dy,
          });
        } else if (cMoving) {
          // pointB must lie on the line through center perpendicular to (center -> pointA)
          const dx = resolvedA.x - resolvedCenter.x;
          const dy = resolvedA.y - resolvedCenter.y;
          tracks.push({
            type: 'line',
            point: resolvedCenter,
            slope: Math.abs(dy) < EPSILON ? Infinity : -dx / dy,
          });
        }
        // center moving alone: skip (would need circle tracks for both distances)
        break;
      }

      case 'parallel': {
        const resolvedA = resolveEndpoint(constraint.pointA);
        const resolvedB = resolveEndpoint(constraint.pointB);
        const resolvedC = resolveEndpoint(constraint.pointC);
        const resolvedD = resolveEndpoint(constraint.pointD);

        if (!resolvedA || !resolvedB || !resolvedC || !resolvedD) {
          continue;
        }

        const aMoving = isMoving(resolvedA);
        const bMoving = isMoving(resolvedB);
        const cMoving = isMoving(resolvedC);
        const dMoving = isMoving(resolvedD);

        // 0 or 2+ moving: no useful single-endpoint track
        if (!aMoving && !bMoving && !cMoving && !dMoving) {
          continue;
        }
        if ([aMoving, bMoving, cMoving, dMoving].filter(Boolean).length !== 1) {
          continue;
        }

        if (aMoving) {
          // pointA must stay on line through pointB parallel to segment CD
          const dx = resolvedD.x - resolvedC.x;
          const dy = resolvedD.y - resolvedC.y;
          tracks.push({
            type: 'line',
            point: resolvedB,
            slope: Math.abs(dx) < EPSILON ? Infinity : dy / dx,
          });
        } else if (bMoving) {
          // pointB must stay on line through pointA parallel to segment CD
          const dx = resolvedD.x - resolvedC.x;
          const dy = resolvedD.y - resolvedC.y;
          tracks.push({
            type: 'line',
            point: resolvedA,
            slope: Math.abs(dx) < EPSILON ? Infinity : dy / dx,
          });
        } else if (cMoving) {
          // pointC must stay on line through pointD parallel to segment AB
          const dx = resolvedB.x - resolvedA.x;
          const dy = resolvedB.y - resolvedA.y;
          tracks.push({
            type: 'line',
            point: resolvedD,
            slope: Math.abs(dx) < EPSILON ? Infinity : dy / dx,
          });
        } else if (dMoving) {
          // pointD must stay on line through pointC parallel to segment AB
          const dx = resolvedB.x - resolvedA.x;
          const dy = resolvedB.y - resolvedA.y;
          tracks.push({
            type: 'line',
            point: resolvedC,
            slope: Math.abs(dx) < EPSILON ? Infinity : dy / dx,
          });
        }
        break;
      }

      default: {
        constraint satisfies never;
        throw new Error(
          `computeConstrainedTracksForPoints: unexpected constraint type ${(constraint as any).type}`,
        );
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
