'use client';

import { extend } from '@pixi/react';
import { FederatedPointerEvent, Graphics, Sprite } from 'pixi.js';
import { useCallback, useMemo } from 'react';
import { Vector2 } from '@/lib/math';
import { FilletFilterIconTexture } from '@/lib/textures';
import { SheetPosition } from '@/lib/viewport/types';

extend({
  Sprite,
  Graphics,
});

type DimensionLineConstraitProps = {
  pointA: SheetPosition;
  pointCenter: SheetPosition;
  pointB: SheetPosition;
  viewportScale: number;
  color?: number;
  lineWidthPx?: number;
  onPointerDown?: (e: FederatedPointerEvent) => void;
  onPointerUp?: (e: FederatedPointerEvent) => void;
  onPointerEnter?: (e: FederatedPointerEvent) => void;
  onPointerLeave?: (e: FederatedPointerEvent) => void;
};

const LINE_WIDTH_PX = 1;

const REGULAR_ANGLE_ARC_SIZE_PX = 24;
const RIGHT_ANGLE_ARC_SIZE_PX = 16;

const PERPENDICULAR_ICON_OFFSET_PX = 16;

export default function FilletFilter({
  pointA,
  pointCenter,
  pointB,
  viewportScale,
  color = 0x666666,
  lineWidthPx = LINE_WIDTH_PX,
  onPointerDown,
  onPointerUp,
  onPointerEnter,
  onPointerLeave,
}: DimensionLineConstraitProps) {
  const vA = useMemo(() => pointA.toWorld(), [pointA]);
  const vCenter = useMemo(() => pointCenter.toWorld(), [pointCenter]);
  const vB = useMemo(() => pointB.toWorld(), [pointB]);

  const vANormalized = useMemo(() => Vector2.norm(Vector2.sub(vA, vCenter)), [vA, vCenter]);
  const vBNormalized = useMemo(() => Vector2.norm(Vector2.sub(vB, vCenter)), [vB, vCenter]);

  // Exterior bisector direction (opposite the angle interior)
  const exteriorDir = useMemo(() => {
    const sumX = vANormalized.x + vBNormalized.x;
    const sumY = vANormalized.y + vBNormalized.y;
    const len = Math.sqrt(sumX * sumX + sumY * sumY);
    if (len === 0) {
      return new SheetPosition(0, 0);
    }
    return new SheetPosition(-sumX / len, -sumY / len);
  }, [vANormalized, vBNormalized]);

  const lineWidth = lineWidthPx / viewportScale;
  const spriteScale = 1 / viewportScale;

  const draw = useCallback(
    (graphics: Graphics) => {
      graphics.clear();

      graphics.setStrokeStyle({ color, width: lineWidth });

      // Draw line edges
      graphics.moveTo(vA.x, vA.y);
      graphics.lineTo(vCenter.x, vCenter.y);
      graphics.lineTo(vB.x, vB.y);
      graphics.stroke();
    },
    [vA, vCenter, vB, color, lineWidth],
  );

  return (
    <>
      <pixiGraphics
        draw={draw}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        eventMode={onPointerDown || onPointerUp ? 'static' : 'none'}
      />

      <pixiSprite
        texture={FilletFilterIconTexture.get()}
        x={vCenter.x + exteriorDir.x * (PERPENDICULAR_ICON_OFFSET_PX / viewportScale)}
        y={vCenter.y + exteriorDir.y * (PERPENDICULAR_ICON_OFFSET_PX / viewportScale)}
        anchor={0.5}
        scale={spriteScale}
        cursor="pointer"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        eventMode={
          onPointerDown || onPointerUp || onPointerEnter || onPointerLeave ? 'static' : 'none'
        }
      />
    </>
  );
}
