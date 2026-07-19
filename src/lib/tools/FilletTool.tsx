import { SquareRoundCornerIcon } from 'lucide-react';
import { CornerReplacement, type CornerSegmentFactory } from '@/lib/math';
import { CubicCurve, SheetPosition } from '@/lib/viewport/types';
import { BaseCornerGeometryReplacerTool } from './BaseCornerGeometryReplacerTool';

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

  protected cornerSegmentFactory: CornerSegmentFactory<SheetPosition> = CornerReplacement.filletArc;
}
