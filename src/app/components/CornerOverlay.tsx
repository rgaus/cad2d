'use client';

import { Graphics } from 'pixi.js';
import { useCallback } from 'react';
import { Vector2 } from '@/lib/math';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { SheetPosition } from '@/lib/viewport/types';

/** Default stroke width numerator in pixels. */
const DEFAULT_STROKE_WIDTH = 2;

type CornerOverlayProps = {
  center: SheetPosition;
  pointA: SheetPosition;
  pointB: SheetPosition;
  viewportScale: number;
  magnitude?: number | 'full';
  strokeWidth?: number;
  color?: number;
};

/**
 * Draws two lines from adjacent vertices (pointA, pointB) to the center vertex,
 * plus a filled dot at the center. Used as a preview overlay for fillet/chamfer tools.
 */
export default function CornerOverlay({
  center,
  pointA,
  pointB,
  viewportScale,
  magnitude = 'full',
  strokeWidth = DEFAULT_STROKE_WIDTH,
  color = 0x3366ff,
}: CornerOverlayProps) {
  const draw = useCallback(
    (g: Graphics) => {
      const lineWidth = strokeWidth / viewportScale;
      const dotRadius = (2 * strokeWidth) / viewportScale;

      const cx = center.x * SHEET_UNITS_TO_PIXELS;
      const cy = center.y * SHEET_UNITS_TO_PIXELS;

      let normalizedA = pointA;
      if (magnitude !== 'full') {
        const lengthInSheetUnits = Math.min(
          magnitude / viewportScale,
          Vector2.dist(pointA, center),
        );
        normalizedA = Vector2.add(
          center,
          Vector2.scale(Vector2.norm(Vector2.sub(pointA, center)), lengthInSheetUnits),
        );
      }
      const ax = normalizedA.x * SHEET_UNITS_TO_PIXELS;
      const ay = normalizedA.y * SHEET_UNITS_TO_PIXELS;

      let normalizedB = pointB;
      if (magnitude !== 'full') {
        const lengthInSheetUnits = Math.min(
          magnitude / viewportScale,
          Vector2.dist(pointB, center),
        );
        normalizedB = Vector2.add(
          center,
          Vector2.scale(Vector2.norm(Vector2.sub(pointB, center)), lengthInSheetUnits),
        );
      }
      const bx = normalizedB.x * SHEET_UNITS_TO_PIXELS;
      const by = normalizedB.y * SHEET_UNITS_TO_PIXELS;

      g.clear();

      g.setStrokeStyle({ color, width: lineWidth, alpha: 0.7 });
      g.moveTo(ax, ay);
      g.lineTo(cx, cy);
      g.lineTo(bx, by);
      g.stroke();

      g.setFillStyle({ color, alpha: 0.7 });
      g.circle(cx, cy, dotRadius);
      g.fill();
    },
    [center, pointA, pointB, viewportScale, strokeWidth, color],
  );

  return <pixiGraphics draw={draw} eventMode="none" />;
}
