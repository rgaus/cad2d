import React from 'react';
import { CornerReplacement, type CornerSegmentFactory } from '@/lib/math';
import { SheetPosition } from '@/lib/viewport/types';
import { BaseCornerGeometryReplacerTool } from './BaseCornerGeometryReplacerTool';

/**
 * Custom chamfer icon: a square with a 45-degree beveled corner (matches the
 * fillet SquareRoundCornerIcon layout but with a straight line instead of an arc).
 */
function ChamferIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="white"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Bevel line replacing the round corner */}
      <path d="M21 11 L13 3" />
      {/* Square outline with top-right corner gap */}
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    </svg>
  );
}

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
    return <ChamferIcon />;
  }

  protected cornerSegmentFactory: CornerSegmentFactory<SheetPosition> =
    CornerReplacement.chamferLine;
}
