import { Vector2 } from '@/lib/math';
import { UnitType } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';
import { Constraint } from '.';
import { type Id } from '../types';
import { ConstraintEndpoint } from './constraint-endpoint';

/** A locus of possible positions for a moving point, derived from constraints and fixed geometry. */
export type ConstrainedTrack =
  | { type: 'circle'; center: SheetPosition; radius: number }
  | { type: 'point'; point: SheetPosition }
  | { type: 'line'; slope: number; point: SheetPosition }
  | { type: 'or'; inner: Array<ConstrainedTrack> };

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

/**
 * Checks whether two SheetPosition values represent the same point (within epsilon).
 */
function pointsEqual(a: SheetPosition, b: SheetPosition, epsilon: number): boolean {
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;
}

/**
 * Checks whether a point lies on a circle (within epsilon).
 */
function isPointOnCircle(
  point: SheetPosition,
  center: SheetPosition,
  radius: number,
  epsilon: number,
): boolean {
  return Math.abs(Vector2.distance(point, center) - radius) < epsilon;
}

/**
 * Checks whether a point lies on an infinite line defined by
 * a point and a slope. For vertical lines (slope Infinity/NaN), checks x-coordinate.
 */
function isPointOnLine(
  point: SheetPosition,
  linePoint: SheetPosition,
  slope: number,
  epsilon: number,
): boolean {
  if (!Number.isFinite(slope)) {
    return Math.abs(point.x - linePoint.x) < epsilon;
  }
  return Math.abs(point.y - linePoint.y - slope * (point.x - linePoint.x)) < epsilon;
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
  epsilon: number,
): Array<SheetPosition> | 'coincident' {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const dSq = dx * dx + dy * dy;
  const d = Math.sqrt(dSq);

  // Coincident circles — same center, same radius
  if (d < epsilon && Math.abs(r1 - r2) < epsilon) {
    return 'coincident';
  }

  // Concentric but different radii — no intersection
  if (d < epsilon) {
    return [];
  }

  // Too far apart or one inside the other
  if (d > r1 + r2 + epsilon || d < Math.abs(r1 - r2) - epsilon) {
    return [];
  }

  // Tangent (externally or internally)
  if (Math.abs(d - (r1 + r2)) < epsilon || Math.abs(d - Math.abs(r1 - r2)) < epsilon) {
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
  epsilon: number,
): Array<SheetPosition> {
  if (!Number.isFinite(slope)) {
    // Vertical line: x = linePoint.x
    const dx = linePoint.x - center.x;
    const dxSq = dx * dx;
    const rSq = radius * radius;

    if (dxSq > rSq + epsilon) {
      return [];
    }

    if (Math.abs(dxSq - rSq) < epsilon) {
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

  if (discriminant < -epsilon) {
    return [];
  }

  if (Math.abs(discriminant) < epsilon) {
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
  epsilon: number,
): Array<SheetPosition> | 'coincident' {
  const bothVertical = !Number.isFinite(m1) && !Number.isFinite(m2);
  const oneVertical = !Number.isFinite(m1) || !Number.isFinite(m2);

  if (bothVertical) {
    if (Math.abs(p1.x - p2.x) < epsilon) {
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
  if (Math.abs(m1 - m2) < epsilon) {
    const b1 = lineIntercept(p1, m1);
    const b2 = lineIntercept(p2, m2);
    if (Math.abs(b1 - b2) < epsilon) {
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
   * Recursively flattens nested `or` tracks so that `or(A, or(B, C))` becomes `or(A, B, C)`.
   * Safe to call on non-`or` tracks (returns the track unchanged).
   */
  function flattenOr(track: ConstrainedTrack): ConstrainedTrack {
    if (track.type !== 'or') {
      return track;
    }
    const flat: Array<ConstrainedTrack> = [];
    const collect = (items: Array<ConstrainedTrack>): void => {
      for (const t of items) {
        if (t.type === 'or') {
          collect(t.inner);
        } else {
          flat.push(t);
        }
      }
    };
    collect(track.inner);
    // Avoid wrapping a single element in an unnecessary `or`
    if (flat.length === 1) {
      return flat[0];
    }
    return { type: 'or', inner: flat };
  }

  /**
   * Intersects two {@link ConstrainedTrack} values and returns the resulting tracks.
   * Returns `'immobile'` when the intersection is empty (no valid positions).
   */
  export function intersectTracks(
    a: ConstrainedTrack,
    b: ConstrainedTrack,
    epsilon: number = 1e-10,
  ): Array<ConstrainedTrack> | 'immobile' {
    // Logical OR distribution: intersect every inner alternative of each `or`
    // with the cross product of the other operand.
    if (a.type === 'or' || b.type === 'or') {
      const innersA = a.type === 'or' ? a.inner : [a];
      const innersB = b.type === 'or' ? b.inner : [b];
      const results: Array<ConstrainedTrack> = [];
      for (const ai of innersA) {
        for (const bi of innersB) {
          const intersection = ConstrainedTrack.intersectTracks(ai, bi, epsilon);
          if (intersection !== 'immobile') {
            results.push(...intersection);
          }
        }
      }
      if (results.length === 0) {
        return 'immobile';
      }
      if (results.length === 1) {
        return results;
      }
      return [flattenOr({ type: 'or', inner: results })];
    }

    // Normalize: circle > line > point
    if (a.type !== 'circle' && b.type === 'circle') {
      return ConstrainedTrack.intersectTracks(b, a, epsilon);
    }
    if (a.type === 'point' && b.type === 'line') {
      return ConstrainedTrack.intersectTracks(b, a, epsilon);
    }

    if (a.type === 'circle' && b.type === 'circle') {
      const pts = circleCircleIntersection(a.center, a.radius, b.center, b.radius, epsilon);
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
      if (isPointOnCircle(b.point, a.center, a.radius, epsilon)) {
        return [b];
      }
      return 'immobile';
    }

    // circle ∩ line (normalized above so a is the circle)
    if (a.type === 'circle' && b.type === 'line') {
      const pts = lineCircleIntersection(b.point, b.slope, a.center, a.radius, epsilon);
      if (pts.length === 0) {
        return 'immobile';
      }
      return pts.map((p) => ({ type: 'point' as const, point: p }));
    }

    // line ∩ line
    if (a.type === 'line' && b.type === 'line') {
      const lli = lineLineIntersection(a.point, a.slope, b.point, b.slope, epsilon);
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
      if (isPointOnLine(b.point, a.point, a.slope, epsilon)) {
        return [b];
      }
      return 'immobile';
    }

    // point ∩ point
    if (a.type === 'point' && b.type === 'point') {
      if (pointsEqual(a.point, b.point, epsilon)) {
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
      case 'or': {
        return {
          type: 'or',
          inner: track.inner.map((t) => ConstrainedTrack.applyOffset(t, offset)),
        };
      }
    }
  }

  /**
   * Restricts a 2D constraint track to 1D along a single axis.
   *
   * When {@link axis} is `'y'`, the endpoint's x-coordinate is fixed and movement is vertical;
   * the track is intersected with the vertical line x = {@link fixedCoord} and horizontal line
   * tracks are returned for the cursor.  When `'x'`, y is fixed, movement is horizontal, and
   * vertical line tracks are returned.
   *
   * Returns null when the constraint places no restriction (track coincident with the
   * movement axis).  Returns 'immobile' when the constraint cannot be satisfied in the
   * allowed axis.
   */
  export function restrictToAxis(
    track: ConstrainedTrack,
    fixedCoord: number,
    axis: 'x' | 'y',
    epsilon: number = 1e-10,
  ): ConstrainedTrack | 'immobile' | null {
    const isFixedX = axis === 'y';

    switch (track.type) {
      case 'circle': {
        const centerCoord = isFixedX ? track.center.x : track.center.y;
        const dx = fixedCoord - centerCoord;
        const rSq = track.radius * track.radius;
        const dxSq = dx * dx;

        if (dxSq > rSq + epsilon) {
          return 'immobile';
        }

        if (Math.abs(dxSq - rSq) < epsilon) {
          const otherCoord = isFixedX ? track.center.y : track.center.x;
          return {
            type: 'line',
            point: isFixedX ? new SheetPosition(0, otherCoord) : new SheetPosition(otherCoord, 0),
            slope: isFixedX ? 0 : Infinity,
          };
        }

        const dy = Math.sqrt(rSq - dxSq);
        const centerOther = isFixedX ? track.center.y : track.center.x;
        return {
          type: 'or',
          inner: [
            {
              type: 'line',
              point: isFixedX
                ? new SheetPosition(0, centerOther - dy)
                : new SheetPosition(centerOther - dy, 0),
              slope: isFixedX ? 0 : Infinity,
            },
            {
              type: 'line',
              point: isFixedX
                ? new SheetPosition(0, centerOther + dy)
                : new SheetPosition(centerOther + dy, 0),
              slope: isFixedX ? 0 : Infinity,
            },
          ],
        };
      }

      case 'line': {
        if (!Number.isFinite(track.slope)) {
          if (isFixedX) {
            if (Math.abs(fixedCoord - track.point.x) < epsilon) {
              return null;
            }
            return 'immobile';
          }
          return {
            type: 'line',
            point: new SheetPosition(track.point.x, 0),
            slope: Infinity,
          };
        }

        if (Math.abs(track.slope) < epsilon) {
          if (isFixedX) {
            return {
              type: 'line',
              point: new SheetPosition(0, track.point.y),
              slope: 0,
            };
          }
          if (Math.abs(fixedCoord - track.point.y) < epsilon) {
            return null;
          }
          return 'immobile';
        }

        if (isFixedX) {
          const y = track.slope * (fixedCoord - track.point.x) + track.point.y;
          return { type: 'line', point: new SheetPosition(0, y), slope: 0 };
        }
        const x = (fixedCoord - track.point.y) / track.slope + track.point.x;
        return { type: 'line', point: new SheetPosition(x, 0), slope: Infinity };
      }

      case 'point': {
        if (isFixedX) {
          if (Math.abs(fixedCoord - track.point.x) < epsilon) {
            return { type: 'line', point: new SheetPosition(0, track.point.y), slope: 0 };
          }
        } else {
          if (Math.abs(fixedCoord - track.point.y) < epsilon) {
            return { type: 'line', point: new SheetPosition(track.point.x, 0), slope: Infinity };
          }
        }
        return 'immobile';
      }

      case 'or': {
        const inner: Array<ConstrainedTrack> = [];
        for (const t of track.inner) {
          const restricted = ConstrainedTrack.restrictToAxis(t, fixedCoord, axis, epsilon);
          if (restricted === 'immobile') {
            continue;
          }
          if (restricted !== null) {
            if (restricted.type === 'or') {
              inner.push(...restricted.inner);
            } else {
              inner.push(restricted);
            }
          }
        }
        if (inner.length === 0) {
          return 'immobile';
        }
        if (inner.length === 1) {
          return inner[0];
        }
        return { type: 'or', inner };
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
  epsilon: number = 1e-10,
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
          // |dx| = constrainedLength → two vertical lines, OR'd together
          const inner: Array<ConstrainedTrack> = [];
          inner.push({
            type: 'line',
            point: new SheetPosition(center.x - radius, center.y),
            slope: Infinity,
          });
          if (radius > epsilon) {
            inner.push({
              type: 'line',
              point: new SheetPosition(center.x + radius, center.y),
              slope: Infinity,
            });
          }
          tracks.push(inner.length === 1 ? inner[0] : { type: 'or', inner });
        } else if (constraint.axis === 'y') {
          // |dy| = constrainedLength → two horizontal lines, OR'd together
          const inner: Array<ConstrainedTrack> = [];
          inner.push({
            type: 'line',
            point: new SheetPosition(center.x, center.y - radius),
            slope: 0,
          });
          if (radius > epsilon) {
            inner.push({
              type: 'line',
              point: new SheetPosition(center.x, center.y + radius),
              slope: 0,
            });
          }
          tracks.push(inner.length === 1 ? inner[0] : { type: 'or', inner });
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
            slope: Math.abs(dy) < epsilon ? Infinity : -dx / dy,
          });
        } else if (cMoving) {
          // pointB must lie on the line through center perpendicular to (center -> pointA)
          const dx = resolvedA.x - resolvedCenter.x;
          const dy = resolvedA.y - resolvedCenter.y;
          tracks.push({
            type: 'line',
            point: resolvedCenter,
            slope: Math.abs(dy) < epsilon ? Infinity : -dx / dy,
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
            slope: Math.abs(dx) < epsilon ? Infinity : dy / dx,
          });
        } else if (bMoving) {
          // pointB must stay on line through pointA parallel to segment CD
          const dx = resolvedD.x - resolvedC.x;
          const dy = resolvedD.y - resolvedC.y;
          tracks.push({
            type: 'line',
            point: resolvedA,
            slope: Math.abs(dx) < epsilon ? Infinity : dy / dx,
          });
        } else if (cMoving) {
          // pointC must stay on line through pointD parallel to segment AB
          const dx = resolvedB.x - resolvedA.x;
          const dy = resolvedB.y - resolvedA.y;
          tracks.push({
            type: 'line',
            point: resolvedD,
            slope: Math.abs(dx) < epsilon ? Infinity : dy / dx,
          });
        } else if (dMoving) {
          // pointD must stay on line through pointC parallel to segment AB
          const dx = resolvedB.x - resolvedA.x;
          const dy = resolvedB.y - resolvedA.y;
          tracks.push({
            type: 'line',
            point: resolvedC,
            slope: Math.abs(dx) < epsilon ? Infinity : dy / dx,
          });
        }
        break;
      }

      case 'horizontal': {
        const resolvedA = resolveEndpoint(constraint.pointA);
        const resolvedB = resolveEndpoint(constraint.pointB);

        if (!resolvedA || !resolvedB) {
          continue;
        }

        const aMoving = isMoving(resolvedA);
        const bMoving = isMoving(resolvedB);

        if (aMoving === bMoving) {
          continue;
        }

        // Track is a horizontal line through the fixed endpoint
        const center = aMoving ? resolvedB : resolvedA;
        tracks.push({ type: 'line', point: center, slope: 0 });
        break;
      }

      case 'vertical': {
        const resolvedA = resolveEndpoint(constraint.pointA);
        const resolvedB = resolveEndpoint(constraint.pointB);

        if (!resolvedA || !resolvedB) {
          continue;
        }

        const aMoving = isMoving(resolvedA);
        const bMoving = isMoving(resolvedB);

        if (aMoving === bMoving) {
          continue;
        }

        // Track is a vertical line through the fixed endpoint
        const center = aMoving ? resolvedB : resolvedA;
        tracks.push({ type: 'line', point: center, slope: Infinity });
        break;
      }

      case 'colinear': {
        const resolvedTarget = resolveEndpoint(constraint.pointTarget);
        const resolvedA = resolveEndpoint(constraint.pointA);
        const resolvedB = resolveEndpoint(constraint.pointB);

        if (!resolvedTarget || !resolvedA || !resolvedB) {
          continue;
        }

        const targetMoving = isMoving(resolvedTarget);
        const aMoving = isMoving(resolvedA);
        const bMoving = isMoving(resolvedB);

        // Only produce a track when exactly one endpoint is moving
        if ([targetMoving, aMoving, bMoving].filter(Boolean).length !== 1) {
          continue;
        }

        if (targetMoving) {
          // Track is the line through pointA and pointB
          const dx = resolvedB.x - resolvedA.x;
          const dy = resolvedB.y - resolvedA.y;
          tracks.push({
            type: 'line',
            point: resolvedA,
            slope: Math.abs(dx) < epsilon ? Infinity : dy / dx,
          });
        } else if (aMoving) {
          // Track is the line through pointB and pointTarget
          const dx = resolvedTarget.x - resolvedB.x;
          const dy = resolvedTarget.y - resolvedB.y;
          tracks.push({
            type: 'line',
            point: resolvedB,
            slope: Math.abs(dx) < epsilon ? Infinity : dy / dx,
          });
        } else {
          // bMoving: track is the line through pointA and pointTarget
          const dx = resolvedTarget.x - resolvedA.x;
          const dy = resolvedTarget.y - resolvedA.y;
          tracks.push({
            type: 'line',
            point: resolvedA,
            slope: Math.abs(dx) < epsilon ? Infinity : dy / dx,
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
      const intersection = ConstrainedTrack.intersectTracks(existing, tracks[i], epsilon);
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

/**
 * Builds a single raw ConstrainedTrack from a constraint where exactly one endpoint is attached
 * to the given geometry ID. Returns the raw track (in the constrained endpoint's own coordinate
 * space), the resolved position of the shape's endpoint, and the shape endpoint itself.
 * Returns null when the constraint does not apply (both/neither attached, unresolvable, etc.).
 */
export function buildSingleConstrainedTrack(
  c: Constraint,
  geometryId: Id,
  sheetUnit: UnitType,
  resolveEndpoint: (ep: ConstraintEndpoint) => SheetPosition | null,
  excludeConstraintsAttachedToGeometryIds: Array<Id> = [],
): {
  track: ConstrainedTrack;
  endpointPos: SheetPosition;
  shapeEndpoint: ConstraintEndpoint;
} | null {
  switch (c.type) {
    case 'linear': {
      if (c.constrainedLength === null) {
        return null;
      }

      // If a constraint is attached to an excluded endpoint, then it shouldn't take effect
      //
      // Example case where this is used: three geometries are all selected and are being moved
      // together with constraints all internally between them all.
      const excluded = (ep: ConstraintEndpoint): boolean =>
        ep.type !== 'point' && excludeConstraintsAttachedToGeometryIds.includes(ep.id);

      if (excluded(c.pointA) || excluded(c.pointB)) {
        return null;
      }

      const attached = (ep: ConstraintEndpoint): boolean =>
        ep.type !== 'point' &&
        ep.id === geometryId &&
        !excludeConstraintsAttachedToGeometryIds.includes(ep.id);

      const aAttached = attached(c.pointA);
      const bAttached = attached(c.pointB);

      // Skip if both or neither are attached - no single moving endpoint
      if (aAttached === bAttached) {
        return null;
      }

      const shapeEndpoint = aAttached ? c.pointA : c.pointB;
      const fixedEndpoint = aAttached ? c.pointB : c.pointA;

      const endpointPos = resolveEndpoint(shapeEndpoint);
      const fixedPos = resolveEndpoint(fixedEndpoint);
      if (!endpointPos || !fixedPos) {
        return null;
      }

      const radius = c.constrainedLength.toSheetUnits(sheetUnit).magnitude;

      if (c.axis === 'x') {
        // |dx| = constrainedLength → two vertical lines
        return {
          track: {
            type: 'or',
            inner: [
              {
                type: 'line',
                point: new SheetPosition(fixedPos.x - radius, fixedPos.y),
                slope: Infinity,
              },
              {
                type: 'line',
                point: new SheetPosition(fixedPos.x + radius, fixedPos.y),
                slope: Infinity,
              },
            ],
          },
          endpointPos,
          shapeEndpoint,
        };
      }
      if (c.axis === 'y') {
        // |dy| = constrainedLength → two horizontal lines
        return {
          track: {
            type: 'or',
            inner: [
              { type: 'line', point: new SheetPosition(fixedPos.x, fixedPos.y - radius), slope: 0 },
              { type: 'line', point: new SheetPosition(fixedPos.x, fixedPos.y + radius), slope: 0 },
            ],
          },
          endpointPos,
          shapeEndpoint,
        };
      }

      return {
        track: { type: 'circle', center: fixedPos, radius },
        endpointPos,
        shapeEndpoint,
      };
    }

    case 'horizontal': {
      // If any endpoint is on another geometry being dragged, skip — the constraint
      // is internally satisfied by the rigid translation of the whole group.
      const excluded = (ep: ConstraintEndpoint): boolean =>
        ep.type !== 'point' && excludeConstraintsAttachedToGeometryIds.includes(ep.id);
      if (excluded(c.pointA) || excluded(c.pointB)) {
        return null;
      }

      const attached = (ep: ConstraintEndpoint): boolean =>
        ep.type !== 'point' &&
        ep.id === geometryId &&
        !excludeConstraintsAttachedToGeometryIds.includes(ep.id);

      const aAttached = attached(c.pointA);
      const bAttached = attached(c.pointB);

      if (aAttached === bAttached) {
        return null;
      }

      const shapeEndpoint = aAttached ? c.pointA : c.pointB;
      const fixedEndpoint = aAttached ? c.pointB : c.pointA;

      const endpointPos = resolveEndpoint(shapeEndpoint);
      const fixedPos = resolveEndpoint(fixedEndpoint);
      if (!endpointPos || !fixedPos) {
        return null;
      }

      return {
        track: { type: 'line', point: fixedPos, slope: 0 },
        endpointPos,
        shapeEndpoint,
      };
    }

    case 'vertical': {
      // If any endpoint is on another geometry being dragged, skip.
      const excluded = (ep: ConstraintEndpoint): boolean =>
        ep.type !== 'point' && excludeConstraintsAttachedToGeometryIds.includes(ep.id);
      if (excluded(c.pointA) || excluded(c.pointB)) {
        return null;
      }

      const attached = (ep: ConstraintEndpoint): boolean =>
        ep.type !== 'point' &&
        ep.id === geometryId &&
        !excludeConstraintsAttachedToGeometryIds.includes(ep.id);

      const aAttached = attached(c.pointA);
      const bAttached = attached(c.pointB);

      if (aAttached === bAttached) {
        return null;
      }

      const shapeEndpoint = aAttached ? c.pointA : c.pointB;
      const fixedEndpoint = aAttached ? c.pointB : c.pointA;

      const endpointPos = resolveEndpoint(shapeEndpoint);
      const fixedPos = resolveEndpoint(fixedEndpoint);
      if (!endpointPos || !fixedPos) {
        return null;
      }

      return {
        track: { type: 'line', point: fixedPos, slope: Infinity },
        endpointPos,
        shapeEndpoint,
      };
    }

    case 'colinear': {
      // If any endpoint is on another geometry being dragged, skip.
      const excluded = (ep: ConstraintEndpoint): boolean =>
        ep.type !== 'point' && excludeConstraintsAttachedToGeometryIds.includes(ep.id);
      if (excluded(c.pointTarget) || excluded(c.pointA) || excluded(c.pointB)) {
        return null;
      }

      const attached = (ep: ConstraintEndpoint): boolean =>
        ep.type !== 'point' &&
        ep.id === geometryId &&
        !excludeConstraintsAttachedToGeometryIds.includes(ep.id);

      const targetAttached = attached(c.pointTarget);
      const aAttached = attached(c.pointA);
      const bAttached = attached(c.pointB);

      const movingCount = [targetAttached, aAttached, bAttached].filter(Boolean).length;

      // 0 or 3 attached: no net positional constraint
      if (movingCount === 0 || movingCount === 3) {
        return null;
      }

      // 2 endpoints attached to the same moving geometry — they move rigidly together,
      // so their relative vector is constant. The constraint reduces to the moving
      // pair passing through the single fixed point.
      if (movingCount === 2) {
        if (aAttached && bAttached) {
          // Both segment endpoints on the moving geometry; target is fixed externally.
          // The line through A and B must pass through the fixed target.
          const endpointPos = resolveEndpoint(c.pointA);
          const resolvedA = resolveEndpoint(c.pointA);
          const resolvedB = resolveEndpoint(c.pointB);
          const fixedT = resolveEndpoint(c.pointTarget);
          if (!endpointPos || !resolvedA || !resolvedB || !fixedT) {
            return null;
          }
          const dx = resolvedB.x - resolvedA.x;
          const dy = resolvedB.y - resolvedA.y;
          return {
            track: {
              type: 'line',
              point: fixedT,
              slope: Math.abs(dx) < 1e-10 ? Infinity : dy / dx,
            },
            endpointPos,
            shapeEndpoint: c.pointA,
          };
        }
        if (aAttached && targetAttached) {
          // A and target on the moving geometry; B is fixed externally.
          // The line through A and target must pass through fixed B.
          const endpointPos = resolveEndpoint(c.pointA);
          const resolvedA = resolveEndpoint(c.pointA);
          const resolvedT = resolveEndpoint(c.pointTarget);
          const fixedB = resolveEndpoint(c.pointB);
          if (!endpointPos || !resolvedA || !resolvedT || !fixedB) {
            return null;
          }
          const dx = resolvedT.x - resolvedA.x;
          const dy = resolvedT.y - resolvedA.y;
          return {
            track: {
              type: 'line',
              point: fixedB,
              slope: Math.abs(dx) < 1e-10 ? Infinity : dy / dx,
            },
            endpointPos,
            shapeEndpoint: c.pointA,
          };
        }
        // bAttached && targetAttached: B and target on moving geometry; A is fixed.
        {
          const endpointPos = resolveEndpoint(c.pointB);
          const resolvedB = resolveEndpoint(c.pointB);
          const resolvedT = resolveEndpoint(c.pointTarget);
          const fixedA = resolveEndpoint(c.pointA);
          if (!endpointPos || !resolvedB || !resolvedT || !fixedA) {
            return null;
          }
          const dx = resolvedT.x - resolvedB.x;
          const dy = resolvedT.y - resolvedB.y;
          return {
            track: {
              type: 'line',
              point: fixedA,
              slope: Math.abs(dx) < 1e-10 ? Infinity : dy / dx,
            },
            endpointPos,
            shapeEndpoint: c.pointB,
          };
        }
      }

      // Exactly 1 endpoint attached — track is the line through the two fixed endpoints

      if (targetAttached) {
        const endpointPos = resolveEndpoint(c.pointTarget);
        const fixedA = resolveEndpoint(c.pointA);
        const fixedB = resolveEndpoint(c.pointB);
        if (!endpointPos || !fixedA || !fixedB) {
          return null;
        }
        const dx = fixedB.x - fixedA.x;
        const dy = fixedB.y - fixedA.y;
        return {
          track: {
            type: 'line',
            point: fixedA,
            slope: Math.abs(dx) < 1e-10 ? Infinity : dy / dx,
          },
          endpointPos,
          shapeEndpoint: c.pointTarget,
        };
      }

      if (aAttached) {
        const endpointPos = resolveEndpoint(c.pointA);
        const fixedTarget = resolveEndpoint(c.pointTarget);
        const fixedB = resolveEndpoint(c.pointB);
        if (!endpointPos || !fixedTarget || !fixedB) {
          return null;
        }
        const dx = fixedTarget.x - fixedB.x;
        const dy = fixedTarget.y - fixedB.y;
        return {
          track: {
            type: 'line',
            point: fixedB,
            slope: Math.abs(dx) < 1e-10 ? Infinity : dy / dx,
          },
          endpointPos,
          shapeEndpoint: c.pointA,
        };
      }

      // bAttached
      {
        const endpointPos = resolveEndpoint(c.pointB);
        const fixedTarget = resolveEndpoint(c.pointTarget);
        const fixedA = resolveEndpoint(c.pointA);
        if (!endpointPos || !fixedTarget || !fixedA) {
          return null;
        }
        const dx = fixedTarget.x - fixedA.x;
        const dy = fixedTarget.y - fixedA.y;
        return {
          track: {
            type: 'line',
            point: fixedA,
            slope: Math.abs(dx) < 1e-10 ? Infinity : dy / dx,
          },
          endpointPos,
          shapeEndpoint: c.pointB,
        };
      }
    }

    case 'parallel': {
      const attached = (ep: ConstraintEndpoint): boolean =>
        ep.type !== 'point' &&
        ep.id === geometryId &&
        !excludeConstraintsAttachedToGeometryIds.includes(ep.id);

      const aAttached = attached(c.pointA);
      const bAttached = attached(c.pointB);
      const cAttached = attached(c.pointC);
      const dAttached = attached(c.pointD);

      const movingCount = [aAttached, bAttached, cAttached, dAttached].filter(Boolean).length;
      if (movingCount !== 1) {
        return null;
      }

      const resolvedA = resolveEndpoint(c.pointA);
      const resolvedB = resolveEndpoint(c.pointB);
      const resolvedC = resolveEndpoint(c.pointC);
      const resolvedD = resolveEndpoint(c.pointD);
      if (!resolvedA || !resolvedB || !resolvedC || !resolvedD) {
        return null;
      }

      // The reference direction comes from the segment that is NOT being moved
      let refDx: number;
      let refDy: number;
      let fixedPoint: SheetPosition;
      let endpointPos: SheetPosition;
      let shapeEndpoint: ConstraintEndpoint;

      if (aAttached) {
        refDx = resolvedD.x - resolvedC.x;
        refDy = resolvedD.y - resolvedC.y;
        fixedPoint = resolvedB;
        endpointPos = resolvedA;
        shapeEndpoint = c.pointA;
      } else if (bAttached) {
        refDx = resolvedD.x - resolvedC.x;
        refDy = resolvedD.y - resolvedC.y;
        fixedPoint = resolvedA;
        endpointPos = resolvedB;
        shapeEndpoint = c.pointB;
      } else if (cAttached) {
        refDx = resolvedB.x - resolvedA.x;
        refDy = resolvedB.y - resolvedA.y;
        fixedPoint = resolvedD;
        endpointPos = resolvedC;
        shapeEndpoint = c.pointC;
      } else {
        // dAttached
        refDx = resolvedB.x - resolvedA.x;
        refDy = resolvedB.y - resolvedA.y;
        fixedPoint = resolvedC;
        endpointPos = resolvedD;
        shapeEndpoint = c.pointD;
      }

      return {
        track: {
          type: 'line',
          point: fixedPoint,
          slope: Math.abs(refDx) < 1e-10 ? Infinity : refDy / refDx,
        },
        endpointPos,
        shapeEndpoint,
      };
    }

    case 'perpendicular': {
      const attached = (ep: ConstraintEndpoint): boolean =>
        ep.type !== 'point' &&
        ep.id === geometryId &&
        !excludeConstraintsAttachedToGeometryIds.includes(ep.id);

      const aAttached = attached(c.pointA);
      const centerAttached = attached(c.pointCenter);
      const bAttached = attached(c.pointB);

      const movingCount = [aAttached, centerAttached, bAttached].filter(Boolean).length;
      if (movingCount !== 1) {
        return null;
      }

      const resolvedA = resolveEndpoint(c.pointA);
      const resolvedCenter = resolveEndpoint(c.pointCenter);
      const resolvedB = resolveEndpoint(c.pointB);
      if (!resolvedA || !resolvedCenter || !resolvedB) {
        return null;
      }

      if (centerAttached) {
        // centerAttached — the center is moving. Both A and B are fixed.
        // The center must lie on a circle through A and B, i.e. the set of points
        // equidistant from A and B → the perpendicular bisector of AB.
        // Actually we need to keep the distances equal — which means center stays on the
        // perpendicular bisector of A-B. That's a line.
        const midAB = {
          x: (resolvedA.x + resolvedB.x) / 2,
          y: (resolvedA.y + resolvedB.y) / 2,
        };
        const dxAB = resolvedB.x - resolvedA.x;
        const dyAB = resolvedB.y - resolvedA.y;
        return {
          track: {
            type: 'line',
            point: new SheetPosition(midAB.x, midAB.y),
            slope: Math.abs(dyAB) < 1e-10 ? Infinity : -dxAB / dyAB,
          },
          endpointPos: resolvedCenter,
          shapeEndpoint: c.pointCenter,
        };
      }

      let endpointPos: SheetPosition;
      let shapeEndpoint: ConstraintEndpoint;
      let refDx: number;
      let refDy: number;
      // The moving point must stay on a line through the center that is perpendicular
      // to the segment from center to the OTHER non-moving endpoint
      let through: SheetPosition;

      if (aAttached) {
        refDx = resolvedB.x - resolvedCenter.x;
        refDy = resolvedB.y - resolvedCenter.y;
        through = resolvedCenter;
        endpointPos = resolvedA;
        shapeEndpoint = c.pointA;
      } else {
        // bAttached
        refDx = resolvedA.x - resolvedCenter.x;
        refDy = resolvedA.y - resolvedCenter.y;
        through = resolvedCenter;
        endpointPos = resolvedB;
        shapeEndpoint = c.pointB;
      }

      // Moving point must lie on the line through `through` perpendicular to (refDx, refDy)
      return {
        track: {
          type: 'line',
          point: through,
          slope: Math.abs(refDy) < 1e-10 ? Infinity : -refDx / refDy,
        },
        endpointPos,
        shapeEndpoint,
      };
    }

    default:
      c satisfies never;
      throw new Error(`buildSingleConstrainedTrack: unexpected constraint type ${(c as any).type}`);
  }
}
