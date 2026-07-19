import { SquareRoundCornerIcon } from 'lucide-react';
import { BaseCornerGeometryReplacerTool, CornerState } from './BaseCornerGeometryReplacerTool';
import { FilletFilter } from '../entity/filters';
import { Length } from '../units/length';

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

  protected createFilter(pending: CornerState, offset: Length) {
    if (pending.mode === 'rectangle') {
      return FilletFilter.createOnRectangle(
        pending.geometryId,
        pending.pointAEndpoint,
        pending.centerEndpoint,
        pending.pointBEndpoint,
        offset,
      );
    } else {
      return FilletFilter.createOnPolygon(
        pending.geometryId,
        pending.pointAIndex,
        pending.centerIndex,
        pending.pointBIndex,
        offset,
      );
    }
  }
}
