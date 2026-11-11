import { type Matrix, applyToPoint } from 'transformation-matrix';
import {
  type ConstrainedTrack,
  type ConstrainedTrackPath,
  type ConstrainedTrackPathRotate,
  type ConstrainedTrackPathTranslate,
  type Id,
} from '@/lib/entity';
import { type FilterData } from '@/lib/entity/filters';
import { Vector2, rotateAnchorAroundPivot, rotatePointAround } from '@/lib/math';
import { SheetPosition } from '@/lib/viewport/types';
import {
  ANGLE_SNAP_DEGREES,
  type SnappingOptions,
  applySnapping,
  snapToAngle,
  snapToNearestGrid,
} from '.';

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
  constrainedTrackPath: ConstrainedTrackPath,
  options: SnappingOptions,
  epsilon: number = 1e-10,
): SheetPosition {
  if (constrainedTrackPath.type === 'immobile') {
    return pos;
  }

  const snapped = applySnapping(pos, options);

  if (constrainedTrackPath.type === 'unconstrained') {
    return snapped;
  }

  // Rotation paths are applied by the caller (entity-level transform), not by projecting a
  // single point, so fall back to the normal snapping result here.
  if (constrainedTrackPath.type === 'rotate') {
    return snapped;
  }

  if (constrainedTrackPath.constrainedTracks.length === 0) {
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
  collect(constrainedTrackPath.constrainedTracks);

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

/** A drag target that can participate in a constrained-track rotation. */
export type RotationTarget =
  | {
      id: Id;
      kind: 'geometry' | 'transformable';
      origin: SheetPosition;
      rotationDegrees: number | null;
      inverseRenderMatrix: Matrix;
    }
  | { id: Id; kind: 'datum'; origin: SheetPosition }
  | { id: Id; kind: 'filter'; filter: FilterData }
  | { id: Id; kind: 'frame' };

/** A computed rotation update for one drag target. */
export type RotationUpdate =
  | {
      id: Id;
      kind: 'geometry' | 'transformable';
      position: SheetPosition;
      rotationDegrees: number;
    }
  | { id: Id; kind: 'datum'; position: SheetPosition }
  | { id: Id; kind: 'filter-rotate'; center: SheetPosition; deltaDegrees: number }
  | { id: Id; kind: 'filter-noop' };

export type RotationApplyResult =
  | { type: 'rotation'; updates: Array<RotationUpdate> }
  | { type: 'immobile' };

export type TranslationApplyResult =
  | { type: 'translation'; delta: SheetPosition }
  | { type: 'none' };

/** Result of computing the rotation delta for a `rotate` constrained track path. */
export type ConstrainedRotationDeltaResult =
  | {
      type: 'rotation';
      center: SheetPosition;
      deltaDegrees: number;
      rotationDegrees: number;
    }
  | { type: 'immobile' };

function normalizeAngleDegrees(angleDegrees: number): number {
  const normalized = angleDegrees % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function getTargetRotationDegrees(target: RotationTarget | undefined): number | null {
  if (!target || (target.kind !== 'geometry' && target.kind !== 'transformable')) {
    return null;
  }
  return target.rotationDegrees;
}

function getTargetOrigin(target: RotationTarget | undefined): SheetPosition | null {
  if (!target) {
    return null;
  }
  if (target.kind === 'geometry' || target.kind === 'transformable' || target.kind === 'datum') {
    return target.origin;
  }
  return null;
}

function canRotateTargets(targets: Array<RotationTarget>, moveTargetIds: Array<Id>): boolean {
  for (const id of moveTargetIds) {
    const target = targets.find((candidate) => candidate.id === id);
    if (!target) {
      return false;
    }
    if (target.kind === 'frame' || target.kind === 'filter') {
      return false;
    }
    if (
      (target.kind === 'geometry' || target.kind === 'transformable') &&
      target.rotationDegrees === null
    ) {
      return false;
    }
  }

  for (const target of targets) {
    switch (target.kind) {
      case 'geometry':
      case 'transformable':
        if (target.rotationDegrees === null) {
          return false;
        }
        break;
      case 'filter':
        if (target.filter.type === 'pattern' && target.filter.mode === 'grid') {
          return false;
        }
        break;
      case 'frame':
        return false;
      case 'datum':
        break;
      default:
        target satisfies never;
        return false;
    }
  }

  return true;
}

function buildRotationUpdate(
  target: RotationTarget,
  pivot: SheetPosition,
  deltaDegrees: number,
): RotationUpdate | null {
  switch (target.kind) {
    case 'geometry':
    case 'transformable': {
      if (target.rotationDegrees === null) {
        return null;
      }
      const rawPivot = applyToPoint(target.inverseRenderMatrix, pivot);
      const rotated = rotateAnchorAroundPivot(
        target.origin,
        target.rotationDegrees,
        new SheetPosition(rawPivot.x, rawPivot.y),
        deltaDegrees,
      );
      return {
        id: target.id,
        kind: target.kind,
        position: rotated.position,
        rotationDegrees: normalizeAngleDegrees(rotated.rotationDegrees),
      };
    }
    case 'datum':
      return {
        id: target.id,
        kind: 'datum',
        position: rotatePointAround(target.origin, pivot, deltaDegrees),
      };
    case 'filter':
      switch (target.filter.type) {
        case 'fillet':
        case 'chamfer':
          return { id: target.id, kind: 'filter-noop' };
        case 'mirror':
          return {
            id: target.id,
            kind: 'filter-rotate',
            center: pivot,
            deltaDegrees,
          };
        case 'pattern':
          if (target.filter.mode === 'grid') {
            return null;
          }
          return {
            id: target.id,
            kind: 'filter-rotate',
            center: pivot,
            deltaDegrees,
          };
        default:
          target.filter satisfies never;
          return null;
      }
    case 'frame':
      return null;
    default:
      target satisfies never;
      return null;
  }
}

/**
 * Computes the rotation delta required to follow a `rotate` constrained track path.
 *
 * The pivot nearest the pointer is chosen, the mouse angle delta since drag start determines the
 * rotation change, and the reference target's resulting absolute rotation is snapped to
 * {@link ANGLE_SNAP_DEGREES} unless Ctrl is held. The same returned `deltaDegrees` should be
 * applied to every target in a multi-selection so relative offsets are preserved.
 */
export function computeConstrainedRotationDelta(
  pointer: SheetPosition,
  dragStart: SheetPosition,
  constrainedTrackPath: ConstrainedTrackPathRotate,
  referenceRotationDegrees: number | null,
  options: {
    ctrlHeld: boolean;
    epsilon?: number;
    angleSnapDegrees?: number;
  },
): ConstrainedRotationDeltaResult {
  const epsilon = options.epsilon ?? 1e-10;
  const angleSnapDegrees = options.angleSnapDegrees ?? ANGLE_SNAP_DEGREES;

  if (referenceRotationDegrees === null || constrainedTrackPath.centers.length === 0) {
    return { type: 'immobile' };
  }

  let center: SheetPosition | null = null;
  let bestDistance = Infinity;
  for (const candidate of constrainedTrackPath.centers) {
    const distance = Vector2.distance(pointer, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      center = candidate;
    }
  }
  if (!center) {
    return { type: 'immobile' };
  }

  const pointerDx = pointer.x - center.x;
  const pointerDy = pointer.y - center.y;
  const startDx = dragStart.x - center.x;
  const startDy = dragStart.y - center.y;
  if (
    Math.sqrt(pointerDx * pointerDx + pointerDy * pointerDy) < epsilon ||
    Math.sqrt(startDx * startDx + startDy * startDy) < epsilon
  ) {
    return { type: 'immobile' };
  }

  const pointerAngle = Math.atan2(pointerDy, pointerDx);
  const startAngle = Math.atan2(startDy, startDx);
  const deltaDegrees = ((pointerAngle - startAngle) * 180) / Math.PI;

  let targetRotationDegrees = referenceRotationDegrees + deltaDegrees;
  if (!options.ctrlHeld) {
    targetRotationDegrees = Math.round(targetRotationDegrees / angleSnapDegrees) * angleSnapDegrees;
  }

  return {
    type: 'rotation',
    center,
    deltaDegrees: targetRotationDegrees - referenceRotationDegrees,
    rotationDegrees: targetRotationDegrees,
  };
}

/** Applies snapping and returns the translation delta for a translate/unconstrained path. */
export function applyTranslationOnConstrainedTrack(
  sheet: SheetPosition,
  constrainedTrackPath: ConstrainedTrackPathTranslate | { type: 'unconstrained' },
  snappingOptions: SnappingOptions,
  options: {
    dragStart: SheetPosition;
    selectionOrigin: SheetPosition;
    epsilon?: number;
  },
): TranslationApplyResult {
  const snapped = applySnappingOnConstrainedTrack(
    sheet,
    constrainedTrackPath,
    snappingOptions,
    options.epsilon ?? 1e-10,
  );

  const rawNewOrigin = new SheetPosition(
    options.selectionOrigin.x + snapped.x - options.dragStart.x,
    options.selectionOrigin.y + snapped.y - options.dragStart.y,
  );

  let snappedOrigin = rawNewOrigin;
  if (!snappingOptions.ctrlHeld && constrainedTrackPath.type === 'unconstrained') {
    snappedOrigin = applySnapping(rawNewOrigin, snappingOptions);
  }

  return {
    type: 'translation',
    delta: new SheetPosition(
      snappedOrigin.x - options.selectionOrigin.x,
      snappedOrigin.y - options.selectionOrigin.y,
    ),
  };
}

/**
 * Applies a `rotate` constrained track path to one or more drag targets.
 *
 * Single selections rotate only the first rotatable geometry/transformable target. Multi
 * selections validate every selected target and attached filter, then rotate all targets by the
 * same delta around the shared pivot.
 */
export function applyRotationOnConstrainedTrack(
  sheet: SheetPosition,
  constrainedTrackPath: ConstrainedTrackPathRotate,
  snappingOptions: Pick<SnappingOptions, 'ctrlHeld'>,
  options: {
    dragStart: SheetPosition;
    targets: Array<RotationTarget>;
    moveTargetIds: Array<Id>;
    epsilon?: number;
  },
): RotationApplyResult {
  const epsilon = options.epsilon ?? 1e-10;

  if (options.moveTargetIds.length <= 1) {
    const target = options.targets.find(
      (candidate) =>
        (candidate.kind === 'geometry' || candidate.kind === 'transformable') &&
        candidate.rotationDegrees !== null,
    );
    if (!target) {
      return { type: 'immobile' };
    }

    const delta = computeConstrainedRotationDelta(
      sheet,
      options.dragStart,
      constrainedTrackPath,
      getTargetRotationDegrees(target),
      { ctrlHeld: snappingOptions.ctrlHeld, epsilon },
    );
    if (delta.type === 'immobile') {
      return delta;
    }

    const update = buildRotationUpdate(target, delta.center, delta.deltaDegrees);
    return update ? { type: 'rotation', updates: [update] } : { type: 'immobile' };
  }

  const referenceTarget = constrainedTrackPath.referenceEntityId
    ? options.targets.find((target) => target.id === constrainedTrackPath.referenceEntityId)
    : undefined;
  const referenceRotation = getTargetRotationDegrees(referenceTarget);
  if (referenceRotation === null || getTargetOrigin(referenceTarget) === null) {
    return { type: 'immobile' };
  }

  const delta = computeConstrainedRotationDelta(
    sheet,
    options.dragStart,
    constrainedTrackPath,
    referenceRotation,
    { ctrlHeld: snappingOptions.ctrlHeld, epsilon },
  );
  if (delta.type === 'immobile' || !canRotateTargets(options.targets, options.moveTargetIds)) {
    return { type: 'immobile' };
  }

  const updates: Array<RotationUpdate> = [];
  for (const target of options.targets) {
    const update = buildRotationUpdate(target, delta.center, delta.deltaDegrees);
    if (!update) {
      return { type: 'immobile' };
    }
    updates.push(update);
  }

  return { type: 'rotation', updates };
}
