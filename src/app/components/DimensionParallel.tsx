'use client';

import { extend } from '@pixi/react';
import { FederatedPointerEvent, Graphics, Sprite } from 'pixi.js';
import { useCallback, useMemo } from 'react';
import { addVec2, normVec2, scaleVec2, subVec2 } from '@/lib/math';
import { CachedIconTexture } from '@/lib/textures';
import { SheetPosition } from '@/lib/viewport/types';

extend({
  Sprite,
  Graphics,
});

type DimensionParallelProps = {
  pointA: SheetPosition;
  pointB: SheetPosition;
  pointC: SheetPosition;
  pointD: SheetPosition;
  viewportScale: number;
  icon: CachedIconTexture;
  conflictIcon: CachedIconTexture;
  color?: number;
  lineWidthPx?: number;
  inConflict?: boolean;
  onPointerDown?: (e: FederatedPointerEvent) => void;
  onPointerUp?: (e: FederatedPointerEvent) => void;
};

const LINE_WIDTH_PX = 1;

/** Renders two line segments with parallel indicators (hash marks) on each segment.
 *  Also shows an icon indicator between the two segments. */
export default function DimensionParallel({
  pointA,
  pointB,
  pointC,
  pointD,
  viewportScale,
  icon,
  conflictIcon,
  color = 0x666666,
  lineWidthPx = LINE_WIDTH_PX,
  inConflict = false,
  onPointerDown,
  onPointerUp,
}: DimensionParallelProps) {
  const vA = useMemo(() => pointA.toWorld(), [pointA]);
  const vB = useMemo(() => pointB.toWorld(), [pointB]);
  const vC = useMemo(() => pointC.toWorld(), [pointC]);
  const vD = useMemo(() => pointD.toWorld(), [pointD]);

  const lineWidth = lineWidthPx / viewportScale;
  const spriteScale = 1 / viewportScale;

  const draw = useCallback(
    (graphics: Graphics) => {
      graphics.clear();

      const strokeColor = inConflict ? 0xe5484d : color;

      graphics.setStrokeStyle({ color: strokeColor, width: lineWidth });

      // Segment AB
      graphics.moveTo(vA.x, vA.y);
      graphics.lineTo(vB.x, vB.y);
      graphics.stroke();

      // Segment CD
      graphics.moveTo(vC.x, vC.y);
      graphics.lineTo(vD.x, vD.y);
      graphics.stroke();

      // Hash marks on segment AB (two short lines perpendicular to AB)
      const abMidX = (vA.x + vB.x) / 2;
      const abMidY = (vA.y + vB.y) / 2;
      const abNorm = normVec2(subVec2(vB, vA));
      // Perpendicular to AB: (-abNorm.y, abNorm.x)
      const hashSize = 6 / viewportScale;
      const hashGap = 4 / viewportScale;

      const perpX = -abNorm.y;
      const perpY = abNorm.x;

      // First hash
      const h1BaseX = abMidX - abNorm.x * hashGap;
      const h1BaseY = abMidY - abNorm.y * hashGap;
      graphics.moveTo(h1BaseX - perpX * hashSize, h1BaseY - perpY * hashSize);
      graphics.lineTo(h1BaseX + perpX * hashSize, h1BaseY + perpY * hashSize);

      // Second hash
      const h2BaseX = abMidX + abNorm.x * hashGap;
      const h2BaseY = abMidY + abNorm.y * hashGap;
      graphics.moveTo(h2BaseX - perpX * hashSize, h2BaseY - perpY * hashSize);
      graphics.lineTo(h2BaseX + perpX * hashSize, h2BaseY + perpY * hashSize);

      // Hash marks on segment CD
      const cdMidX = (vC.x + vD.x) / 2;
      const cdMidY = (vC.y + vD.y) / 2;
      const cdNorm = normVec2(subVec2(vD, vC));
      const cdPerpX = -cdNorm.y;
      const cdPerpY = cdNorm.x;

      const h3BaseX = cdMidX - cdNorm.x * hashGap;
      const h3BaseY = cdMidY - cdNorm.y * hashGap;
      graphics.moveTo(h3BaseX - cdPerpX * hashSize, h3BaseY - cdPerpY * hashSize);
      graphics.lineTo(h3BaseX + cdPerpX * hashSize, h3BaseY + cdPerpY * hashSize);

      const h4BaseX = cdMidX + cdNorm.x * hashGap;
      const h4BaseY = cdMidY + cdNorm.y * hashGap;
      graphics.moveTo(h4BaseX - cdPerpX * hashSize, h4BaseY - cdPerpY * hashSize);
      graphics.lineTo(h4BaseX + cdPerpX * hashSize, h4BaseY + cdPerpY * hashSize);

      graphics.stroke();
    },
    [vA, vB, vC, vD, color, lineWidth, inConflict],
  );

  // Icon on segment AB, offset perpendicular to AB away from CD if possible
  const abIcon = useMemo(() => {
    const abMidX = (vA.x + vB.x) / 2;
    const abMidY = (vA.y + vB.y) / 2;
    const cdMidX = (vC.x + vD.x) / 2;
    const cdMidY = (vC.y + vD.y) / 2;
    const abNorm = normVec2(subVec2(vB, vA));
    const perpX = -abNorm.y;
    const perpY = abNorm.x;
    const offset = 16 / viewportScale;
    const toCDX = cdMidX - abMidX;
    const toCDY = cdMidY - abMidY;
    const dot = toCDX * perpX + toCDY * perpY;
    const sign = dot >= 0 ? -1 : 1;
    return {
      x: abMidX + perpX * offset * sign,
      y: abMidY + perpY * offset * sign,
    };
  }, [vA, vB, vC, vD, viewportScale]);

  // Icon on segment CD, offset perpendicular to CD away from AB if possible
  const cdIcon = useMemo(() => {
    const abMidX = (vA.x + vB.x) / 2;
    const abMidY = (vA.y + vB.y) / 2;
    const cdMidX = (vC.x + vD.x) / 2;
    const cdMidY = (vC.y + vD.y) / 2;
    const cdNorm = normVec2(subVec2(vD, vC));
    const perpX = -cdNorm.y;
    const perpY = cdNorm.x;
    const offset = 16 / viewportScale;
    const toABX = abMidX - cdMidX;
    const toABY = abMidY - cdMidY;
    const dot = toABX * perpX + toABY * perpY;
    const sign = dot >= 0 ? -1 : 1;
    return {
      x: cdMidX + perpX * offset * sign,
      y: cdMidY + perpY * offset * sign,
    };
  }, [vA, vB, vC, vD, viewportScale]);

  const activeIcon = inConflict ? conflictIcon : icon;

  return (
    <>
      <pixiGraphics
        draw={draw}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        eventMode={onPointerDown || onPointerUp ? 'static' : 'none'}
      />
      <pixiSprite
        texture={activeIcon.get()}
        x={abIcon.x}
        y={abIcon.y}
        anchor={0.5}
        scale={spriteScale}
        cursor="pointer"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        eventMode={onPointerDown || onPointerUp ? 'static' : 'none'}
      />
      <pixiSprite
        texture={activeIcon.get()}
        x={cdIcon.x}
        y={cdIcon.y}
        anchor={0.5}
        scale={spriteScale}
        cursor="pointer"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        eventMode={onPointerDown || onPointerUp ? 'static' : 'none'}
      />
    </>
  );
}
