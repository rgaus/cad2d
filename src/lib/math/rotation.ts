import { GeometryRelativeSheetPosition, Position, SheetPosition } from '@/lib/viewport/types';
import { Angle } from './angle';

/** Rotates a point around a center point by the given angle in degrees, preserving the point's
 * position class. */
export function rotatePointAround<P extends Position>(
  point: P,
  center: P,
  angleDegrees: number,
): P {
  const rad = Angle.toRadians(angleDegrees);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return new (point.constructor as new (x: number, y: number) => P)(
    center.x + dx * cos - dy * sin,
    center.y + dx * sin + dy * cos,
  );
}

/**
 * Computes where a geometry's anchor and rotation must move to rotate the geometry by
 * `rotationDeltaDegrees` around a pivot.
 *
 * The geometry is assumed to be positioned with its raw origin at `origin` and rotated by
 * `entityAngleDegrees`. `pivot` is the point the geometry should be rotated around, which can
 * differ from `origin`. The returned anchor/rotation keep the pivot fixed in
 * place while rotating the rest of the geometry by the requested delta.
 *
 * @param entityPosition The geometry's raw origin before the rotation.
 * @param entityAngleDegrees The geometry's absolute rotation before the rotation, in degrees.
 * @param pivot The pivot point to perform the rotation around
 * @param rotationDeltaDegrees The amount to rotate by, in degrees.
 */
export function rotateAnchorAroundPivot<P extends Position>(
  entityPosition: P,
  entityAngleDegrees: number,
  pivot: P,
  rotationDeltaDegrees: number,
): {
  /** New entity position (raw origin) of the geometry. */
  position: P;
  /** New absolute rotation of the geometry, in degrees. */
  rotationDegrees: number;
} {
  const PositionClass = entityPosition.constructor as new (x: number, y: number) => P;
  const newRotationDegrees = entityAngleDegrees + rotationDeltaDegrees;

  // The pivot's world position before and after the rotation.
  const pivotWorld = rotatePointAround(pivot, entityPosition, entityAngleDegrees);
  const rotatedPivot = rotatePointAround(pivot, entityPosition, newRotationDegrees);

  // Move the anchor so the rotated pivot lands back on its original world position.
  return {
    position: new PositionClass(
      pivotWorld.x - rotatedPivot.x + entityPosition.x,
      pivotWorld.y - rotatedPivot.y + entityPosition.y,
    ),
    rotationDegrees: newRotationDegrees,
  };
}
