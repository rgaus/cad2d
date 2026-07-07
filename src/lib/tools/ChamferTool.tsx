import { SlashIcon } from 'lucide-react';
import { PolygonSegment } from '@/lib/geometry/polygon';
import { SheetPosition } from '@/lib/viewport/types';
import { BaseCornerGeometryReplacerTool } from './BaseCornerGeometryReplacerTool';

/**
 * A tool for creating chamfers (beveled corners) on polygon shapes.
 *
 * UX flow for polygons:
 *  1. Click a corner vertex (key point on a polygon)
 *  2. Enter the chamfer offset distance in a popup input
 *  3. The corner is replaced with a straight line segment
 *
 * Rectangle shortcut: clicking any rectangle corner jumps directly from step 1
 * to step 2, since the two adjacent corners are always unambiguous.
 */
export class ChamferTool extends BaseCornerGeometryReplacerTool<'chamfer'> {
  type = 'chamfer' as const;
  label = 'Chamfer';
  stability = 'beta' as const;
  focusKeyCombo = 'g c' as const;

  get icon(): React.ReactNode {
    return <SlashIcon size={24} color="white" />;
  }

  protected createCornerSegment(point: SheetPosition): PolygonSegment {
    return { type: 'point', point };
  }
}
