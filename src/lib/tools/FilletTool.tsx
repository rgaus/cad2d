import { SquareRoundCornerIcon } from 'lucide-react';
import { PolygonSegment } from '@/lib/geometry/polygon';
import { Vector2 } from '@/lib/math';
import { SheetPosition } from '@/lib/viewport/types';
import {
  BaseCornerGeometryReplacerTool,
  type ValidateOffsetResults,
} from './BaseCornerGeometryReplacerTool';

/**
 * A tool for creating fillets (rounded corners) on polygon shapes.
 *
 * UX flow for polygons:
 *  1. Click a corner vertex (key point on a polygon)
 *  2. Enter the fillet offset distance in a popup input
 *  3. The corner is replaced with a circular cubic bezier arc
 *
 * Rectangle shortcut: clicking any rectangle corner jumps directly from step 1
 * to step 2, since the two adjacent corners are always unambiguous.
 */
export class FilletTool extends BaseCornerGeometryReplacerTool<'fillet'> {
  type = 'fillet' as const;
  label = 'Fillet';
  stability = 'beta' as const;
  focusKeyCombo = 'g f' as const;

  get icon(): React.ReactNode {
    return <SquareRoundCornerIcon size={24} color="white" />;
  }

  protected createCornerSegment(
    point: SheetPosition,
    p0: SheetPosition,
    p3: SheetPosition,
    tStart: SheetPosition,
    tEnd: SheetPosition,
    offset: number,
    step2: ValidateOffsetResults,
  ): PolygonSegment {
    // Compute the angle between the two edges for the arc approximation
    const pointAPos = step2.pointAPos;
    const pointBPos = step2.pointBPos;
    const centerPos = step2.centerPos;
    const r = offset;
    const cosTheta = Math.max(
      -1,
      Math.min(
        1,
        Vector2.dot(
          Vector2.norm(Vector2.sub(pointAPos, centerPos)),
          Vector2.norm(Vector2.sub(pointBPos, centerPos)),
        ),
      ),
    );
    const theta = Math.acos(cosTheta);
    const kVal = (4 / 3) * Math.tan(theta / 4);
    const kR = kVal * r;

    const cpA = Vector2.add(p0, Vector2.scale(tStart, kR));
    const cpB = Vector2.sub(p3, Vector2.scale(tEnd, kR));

    return {
      type: 'arc-cubic' as const,
      point,
      controlPointA: cpA,
      controlPointB: cpB,
    };
  }
}
