import { SquareRoundCornerIcon } from 'lucide-react';
import { PolygonSegment } from '@/lib/entity/polygon';
import { Vector2, computeFilletArcControlPoints } from '@/lib/math';
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
    const { controlPointA, controlPointB } = computeFilletArcControlPoints(
      p0,
      p3,
      tStart,
      tEnd,
      offset,
      step2.centerPos,
      step2.pointAPos,
      step2.pointBPos,
    );

    return {
      type: 'arc-cubic' as const,
      point,
      controlPointA,
      controlPointB,
    };
  }
}
