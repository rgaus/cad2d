import type { Position } from '@/lib/viewport/types';
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
